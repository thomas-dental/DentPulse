const express = require('express');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// JWKS verification (same pattern as profileSync.js)
const JWKS_URL = process.env.AUTH_JWKS_URL;
const jwks = jwksClient({ jwksUri: JWKS_URL, cache: true, rateLimit: true });

function getSigningKey(header) {
  return new Promise((resolve, reject) => {
    jwks.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

async function verifyToken(token) {
  const decodedHeader = jwt.decode(token, { complete: true });
  if (!decodedHeader) throw new Error('Malformed token');
  const pubKey = await getSigningKey(decodedHeader.header);
  return jwt.verify(token, pubKey, { algorithms: ['RS256'] });
}

async function requireBearerToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ status: false, response: 'No token provided' });
  }
  try {
    const payload = await verifyToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    console.error('[Provisioning] Token verification failed:', err.message);
    return res.status(401).json({ status: false, response: 'Invalid or expired token' });
  }
}

/**
 * @swagger
 * /api/provision-user:
 *   post:
 *     summary: Provision a new user from another platform
 *     description: Creates a Supabase auth user and profile for a user provisioned from another platform (DentLedger, SK Marketing). The user will land on onboarding with no organization assigned.
 *     tags: [Cross-Platform Provisioning]
 *     security:
 *       - centralAuthJwt: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, full_name, source_platform, source_user_id]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               full_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               source_platform:
 *                 type: string
 *                 example: dentledger
 *               source_user_id:
 *                 type: string
 *               password:
 *                 type: string
 *                 description: Optional. If omitted, a random password is generated.
 *     responses:
 *       201:
 *         description: User provisioned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     user_id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     already_exists:
 *                       type: boolean
 *                     generated_password:
 *                       type: string
 *                       description: Only present if no password was provided
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Invalid or missing token
 *       500:
 *         description: Server error
 */
router.post('/', requireBearerToken, async (req, res) => {
  try {
    const { email, full_name, phone, source_platform, source_user_id, password } = req.body;

    if (!email || !full_name || !source_platform || !source_user_id) {
      return res.status(400).json({
        status: false,
        response: 'email, full_name, source_platform, and source_user_id are required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists in profiles
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, email, full_name')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingProfile) {
      return res.json({
        status: true,
        response: 'User with this email already exists in DentPulse',
        data: {
          user_id: existingProfile.user_id,
          email: existingProfile.email,
          already_exists: true,
        },
      });
    }

    // Also check auth.users (profile might not exist yet)
    let existingAuthUser = null;
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserByEmail(normalizedEmail);
      existingAuthUser = data?.user || null;
    } catch {
      // getUserByEmail throws if not found — that's fine
    }

    if (existingAuthUser) {
      // Auth user exists but no profile — ensure profile exists
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .upsert(
          {
            user_id: existingAuthUser.id,
            email: normalizedEmail,
            full_name: full_name,
            current_organization_id: null,
            password_set: false,
            source_platform: source_platform || null,
          },
          { onConflict: 'user_id' }
        );

      if (profileError) {
        console.error('[Provisioning] Profile upsert error:', profileError);
      }

      return res.json({
        status: true,
        response: 'User already exists in DentPulse auth, profile ensured',
        data: {
          user_id: existingAuthUser.id,
          email: normalizedEmail,
          already_exists: true,
        },
      });
    }

    // Generate password if not provided
    const userPassword = password || generatePassword();
    const generatedPassword = password ? null : userPassword;

    // Create Supabase auth user (auto-confirmed, skips email verification)
    const createUserPayload = {
      email: normalizedEmail,
      password: userPassword,
      email_confirm: true,
      user_metadata: { full_name },
    };
    if (phone) createUserPayload.phone = phone;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser(createUserPayload);

    if (authError) {
      console.error('[Provisioning] Supabase createUser error:', authError);
      return res.status(500).json({
        status: false,
        response: 'Failed to create auth user: ' + authError.message,
      });
    }

    const userId = authData.user.id;

    // Create profile (current_organization_id = null → user lands on onboarding)
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
      {
        user_id: userId,
        email: normalizedEmail,
        full_name: full_name,
        current_organization_id: null, // NULL = triggers onboarding redirect
        onboarding_skipped: false,
        password_set: false,           // Not set yet — will be set on first login via Central Auth
        source_platform: source_platform || null,
      },
      { onConflict: 'user_id' }
    );

    if (profileError) {
      console.error('[Provisioning] Profile creation error:', profileError);
      // Don't fail — the DB trigger might have created it already
    }

    console.log(`[Provisioning] User provisioned: ${normalizedEmail} (${userId}) from ${source_platform}`);

    const responseData = {
      user_id: userId,
      email: normalizedEmail,
      already_exists: false,
    };

    if (generatedPassword) {
      responseData.generated_password = generatedPassword;
    }

    return res.status(201).json({
      status: true,
      response: 'User provisioned successfully',
      data: responseData,
    });
  } catch (err) {
    console.error('[Provisioning] Error:', err.message);
    return res.status(500).json({ status: false, response: err.message });
  }
});

/**
 * @swagger
 * /api/provision-user/toggle-status:
 *   patch:
 *     summary: Ban or unban a Supabase user
 *     description: Activates or deactivates a DentPulse user by banning/unbanning them in Supabase auth. Also updates user_roles is_active flag.
 *     tags: [Cross-Platform Provisioning]
 *     security:
 *       - centralAuthJwt: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, is_active]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     user_id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     is_active:
 *                       type: boolean
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Invalid or missing token
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.patch('/toggle-status', requireBearerToken, async (req, res) => {
  try {
    const { email, is_active } = req.body;

    if (!email || is_active === undefined) {
      return res.status(400).json({
        status: false,
        response: 'email and is_active are required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('user_id, email')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!profile) {
      return res.status(404).json({ status: false, response: 'User not found in DentPulse' });
    }

    // Ban or unban the Supabase auth user
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.user_id, {
      ban_duration: is_active ? 'none' : '876000h', // ~100 years = effectively permanent ban
    });

    if (updateError) {
      console.error('[Provisioning] Toggle status error:', updateError);
      return res.status(500).json({
        status: false,
        response: 'Failed to update user status: ' + updateError.message,
      });
    }

    // Also update user_roles is_active flag if user has any
    await supabaseAdmin
      .from('user_roles')
      .update({ is_active })
      .eq('user_id', profile.user_id);

    console.log(`[Provisioning] User ${normalizedEmail} ${is_active ? 'activated' : 'deactivated'}`);

    return res.json({
      status: true,
      response: is_active ? 'User activated' : 'User deactivated',
      data: {
        user_id: profile.user_id,
        email: normalizedEmail,
        is_active,
      },
    });
  } catch (err) {
    console.error('[Provisioning] Toggle error:', err.message);
    return res.status(500).json({ status: false, response: err.message });
  }
});

function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password + '!1Aa'; // ensure complexity: special + number + upper + lower
}

module.exports = router;
