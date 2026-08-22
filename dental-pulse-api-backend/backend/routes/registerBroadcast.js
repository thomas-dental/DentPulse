/**
 * @swagger
 * /api/register-broadcast:
 *   post:
 *     summary: Register new DentPulse user in Central Auth
 *     description: |
 *       Called by DentPulse frontend after a user signs up. Backend verifies user exists
 *       in Supabase (via admin API), then forwards to Central Auth with API key auth.
 *       Accepts either Supabase JWT OR user_id for signup flow (where session doesn't exist yet).
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               full_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               user_id:
 *                 type: string
 *                 description: Supabase user UUID (for signup flow when no session exists)
 *     responses:
 *       200:
 *         description: Registration broadcast result
 *       400:
 *         description: Missing email
 *       401:
 *         description: User not found in Supabase
 */
const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { email, full_name, phone, user_id, password } = req.body;

    if (!email) {
      return res.status(400).json({ status: false, response: 'email is required' });
    }

    // Verify user exists in Supabase using admin API
    // This works even before email verification (user exists in auth.users immediately after signUp)
    let supabaseUserId = user_id;

    if (supabaseUserId) {
      // Verify the provided user_id actually exists in Supabase
      const { data: userData, error } = await supabaseAdmin.auth.admin.getUserById(supabaseUserId);
      if (error || !userData?.user) {
        return res.status(401).json({ status: false, response: 'User not found in Supabase' });
      }
      // Also verify email matches to prevent spoofing
      if (userData.user.email?.toLowerCase() !== email.toLowerCase().trim()) {
        return res.status(401).json({ status: false, response: 'Email mismatch' });
      }
    } else {
      // Fallback: try to find user by email via Supabase JWT in Authorization header
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        try {
          const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
          if (!error && user) {
            supabaseUserId = user.id;
          }
        } catch {
          // Token verification failed — continue without it
        }
      }

      // If still no user ID, look up by email using admin API
      if (!supabaseUserId) {
        const { data: users } = await supabaseAdmin.auth.admin.listUsers();
        const found = users?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase().trim());
        if (found) {
          supabaseUserId = found.id;
        }
      }
    }

    if (!supabaseUserId) {
      return res.status(401).json({ status: false, response: 'Could not verify user in Supabase' });
    }

    const baseUrl = process.env.CENTRAL_AUTH_BASE_URL;
    if (!baseUrl) {
      console.warn('[register-broadcast] CENTRAL_AUTH_BASE_URL not set, skipping');
      return res.json({ status: true, response: 'Skipped — no Central Auth URL' });
    }

    const apiKey = process.env.PASSWORD_SYNC_SECRET;
    if (!apiKey) {
      console.warn('[register-broadcast] PASSWORD_SYNC_SECRET not set, skipping');
      return res.json({ status: true, response: 'Skipped — no API key' });
    }

    const response = await fetch(`${baseUrl}/auth/register-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        full_name: full_name || null,
        first_name: full_name ? full_name.split(' ')[0] : null,
        last_name: full_name ? full_name.split(' ').slice(1).join(' ') || null : null,
        phone: phone || null,
        password: password || null, // Plain password — Central Auth will hash it
        platform: 'dentalpulse',
        platform_user_id: supabaseUserId,
        tenant_name: null, // No org yet — user will create during onboarding
        tenant_id: null,
        role: 'owner',
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      const centralAuthId = body?.data?.user_id;
      console.log(`[register-broadcast] User ${email} registered in Central Auth, central_auth_id: ${centralAuthId}`);

      // Store universal ID in profiles table
      if (centralAuthId && supabaseUserId) {
        await supabaseAdmin
          .from('profiles')
          .update({ central_auth_id: centralAuthId })
          .eq('user_id', supabaseUserId)
          .is('central_auth_id', null);
      }

      return res.json({ status: true, response: 'User registered in Central Auth', data: body.data });
    } else {
      console.warn(`[register-broadcast] Central Auth returned ${response.status}:`, body);
      return res.json({ status: true, response: 'Central Auth registration attempted', data: body });
    }
  } catch (err) {
    console.error('[register-broadcast] Error:', err.message);
    // Non-blocking — don't fail the signup
    return res.json({ status: true, response: 'Central Auth registration failed (non-blocking)' });
  }
});

/**
 * @swagger
 * /api/register-broadcast/update-tenant:
 *   post:
 *     summary: Update Central Auth with tenant/org details after onboarding
 *     description: |
 *       Called after DentPulse onboarding completes. Sends the org name and ID
 *       to Central Auth so it can create DP_Tenants + DP_UserTenants records.
 *       Re-uses the register-user endpoint (idempotent — user/link already exist,
 *       only tenant gets created).
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, tenant_name, tenant_id]
 *             properties:
 *               email:
 *                 type: string
 *               tenant_name:
 *                 type: string
 *               tenant_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tenant updated
 *       400:
 *         description: Missing fields
 */
router.post('/update-tenant', async (req, res) => {
  try {
    const { email, tenant_name, tenant_id } = req.body;

    if (!email || !tenant_name || !tenant_id) {
      return res.status(400).json({ status: false, response: 'email, tenant_name, and tenant_id are required' });
    }

    const baseUrl = process.env.CENTRAL_AUTH_BASE_URL;
    if (!baseUrl) {
      return res.json({ status: true, response: 'Skipped — no Central Auth URL' });
    }

    const apiKey = process.env.PASSWORD_SYNC_SECRET;
    if (!apiKey) {
      return res.json({ status: true, response: 'Skipped — no API key' });
    }

    // Call register-user again — it's idempotent.
    // User + platform link already exist (created at signup).
    // Only the tenant + user-tenant records will be created.
    const response = await fetch(`${baseUrl}/auth/register-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        platform: 'dentalpulse',
        tenant_name,
        tenant_id,
        role: 'owner',
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      const centralAuthId = body?.data?.user_id;
      console.log(`[register-broadcast] Tenant updated for ${email}: ${tenant_name}`);

      // Backfill universal ID if not already set
      if (centralAuthId) {
        await supabaseAdmin
          .from('profiles')
          .update({ central_auth_id: centralAuthId })
          .eq('email', email.toLowerCase().trim())
          .is('central_auth_id', null);
      }

      return res.json({ status: true, response: 'Tenant updated in Central Auth', data: body.data });
    } else {
      console.warn(`[register-broadcast] Tenant update failed:`, response.status, body);
      return res.json({ status: true, response: 'Tenant update attempted', data: body });
    }
  } catch (err) {
    console.error('[register-broadcast] Tenant update error:', err.message);
    return res.json({ status: true, response: 'Tenant update failed (non-blocking)' });
  }
});

/**
 * POST /api/register-broadcast/invite
 * Called by invite-team-member Edge Function to register invited user in Central Auth.
 * Sends full details: user, tenant, role, custom role.
 */
router.post('/invite', async (req, res) => {
  try {
    const { email, full_name, user_id, organization_name, organization_id, app_role, role_type, custom_role_name, password } = req.body;

    if (!email) {
      return res.status(400).json({ status: false, response: 'email is required' });
    }

    const baseUrl = process.env.CENTRAL_AUTH_BASE_URL;
    if (!baseUrl) {
      return res.json({ status: true, response: 'Skipped — no Central Auth URL' });
    }

    const apiKey = process.env.PASSWORD_SYNC_SECRET;
    if (!apiKey) {
      return res.json({ status: true, response: 'Skipped — no API key' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const adminRoles = ['owner', 'admin'];
    const roleMapping = adminRoles.includes(app_role) ? 'admin' : 'member';
    const nameParts = (full_name || '').trim().split(' ');

    const response = await fetch(`${baseUrl}/auth/register-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        email: normalizedEmail,
        first_name: nameParts[0] || null,
        last_name: nameParts.slice(1).join(' ') || null,
        full_name: full_name || null,
        phone: null,
        password: password || null,
        platform: 'dentalpulse',
        platform_user_id: user_id || null,
        tenant_name: organization_name || null,
        tenant_id: organization_id || null,
        role: roleMapping,
        role_type: role_type || null,
        custom_role_name: custom_role_name || null,
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      const centralAuthId = body?.data?.user_id;
      console.log(`[register-broadcast/invite] ${normalizedEmail} registered in Central Auth, central_auth_id: ${centralAuthId}`);

      // Store universal ID in profiles table for invited user
      if (centralAuthId && user_id) {
        await supabaseAdmin
          .from('profiles')
          .update({ central_auth_id: centralAuthId })
          .eq('user_id', user_id)
          .is('central_auth_id', null);
      }

      return res.json({ status: true, response: 'Invited user registered in Central Auth', data: body.data });
    } else {
      console.warn(`[register-broadcast/invite] Failed for ${normalizedEmail}:`, response.status, body);
      return res.json({ status: true, response: 'Central Auth registration attempted', data: body });
    }
  } catch (err) {
    console.error('[register-broadcast/invite] Error:', err.message);
    return res.json({ status: true, response: 'Central Auth registration failed (non-blocking)' });
  }
});

module.exports = router;
