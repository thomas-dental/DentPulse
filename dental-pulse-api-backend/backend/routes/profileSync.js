const express = require('express');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// Reuse JWKS verification from Central Auth (same as adminPanel.js)
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
    console.error('[ProfileSync] Token verification failed:', err.message);
    return res.status(401).json({ status: false, response: 'Invalid or expired token' });
  }
}

/**
 * @swagger
 * /api/profile-sync:
 *   post:
 *     summary: Receive profile updates from Central Auth
 *     description: Central Auth calls this endpoint to push profile field changes (name, avatar) to DentPulse when a user updates their profile on another platform.
 *     tags: [Profile Sync]
 *     security:
 *       - centralAuthJwt: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, changes]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               changes:
 *                 type: object
 *                 properties:
 *                   full_name:
 *                     type: string
 *                   first_name:
 *                     type: string
 *                   last_name:
 *                     type: string
 *                   avatar_url:
 *                     type: string
 *               source_platform:
 *                 type: string
 *                 description: Platform that originated the change
 *     responses:
 *       200:
 *         description: Profile sync result
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
 *                     updated:
 *                       type: boolean
 *                     user_id:
 *                       type: string
 *                     updated_fields:
 *                       type: array
 *                       items:
 *                         type: string
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Invalid or missing token
 *       404:
 *         description: User not found in DentPulse
 *       500:
 *         description: Server error
 */
router.post('/', requireBearerToken, async (req, res) => {
  try {
    const { email, changes, source_platform } = req.body;

    if (!email || !changes) {
      return res.status(400).json({ status: false, response: 'email and changes are required' });
    }

    // Find user profile by email
    const { data: profile, error: findError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, email, full_name, avatar_url')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (findError || !profile) {
      return res.status(404).json({ status: false, response: 'User not found in DentPulse' });
    }

    // Map changes to profiles table columns
    const updateData = {};

    if (changes.full_name) {
      updateData.full_name = changes.full_name;
    } else if (changes.first_name || changes.last_name) {
      const firstName = changes.first_name || profile.full_name?.split(' ')[0] || '';
      const lastName = changes.last_name || '';
      updateData.full_name = `${firstName} ${lastName}`.trim();
    }

    if (changes.avatar_url !== undefined) {
      updateData.avatar_url = changes.avatar_url;
    }

    if (Object.keys(updateData).length === 0) {
      return res.json({ status: true, data: { updated: false, message: 'No applicable fields' } });
    }

    // Update the profile
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('user_id', profile.user_id);

    if (updateError) {
      console.error('[ProfileSync] Update failed:', updateError);
      return res.status(500).json({ status: false, response: 'Failed to update profile' });
    }

    console.log(`[ProfileSync] Updated profile for ${email} from ${source_platform}`);

    return res.json({
      status: true,
      response: 'Profile synced',
      data: {
        updated: true,
        user_id: profile.user_id,
        updated_fields: Object.keys(updateData),
      },
    });
  } catch (err) {
    console.error('[ProfileSync] Error:', err.message);
    return res.status(500).json({ status: false, response: err.message });
  }
});

module.exports = router;
