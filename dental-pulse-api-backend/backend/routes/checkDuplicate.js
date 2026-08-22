const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

/**
 * POST /api/check-duplicate
 * Check if email exists in Supabase auth and/or Central Auth.
 * Called by frontend before signUp to prevent cross-platform duplicates.
 */
router.post('/', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ status: false, response: 'email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Check Supabase auth.users
    let supabaseExists = false;
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserByEmail(normalizedEmail);
      if (data?.user) {
        supabaseExists = true;
      }
    } catch {
      // getUserByEmail throws if not found — that's fine
    }

    if (supabaseExists) {
      return res.json({
        status: true,
        data: {
          exists: true,
          source: 'local',
          message: 'An account with this email already exists. Please sign in instead.',
        },
      });
    }

    // 2. Check Central Auth
    const baseUrl = process.env.CENTRAL_AUTH_BASE_URL;
    const apiKey = process.env.PASSWORD_SYNC_SECRET;

    if (!baseUrl || !apiKey) {
      // Central Auth not configured — no duplicate found locally
      return res.json({ status: true, data: { exists: false } });
    }

    const caResponse = await fetch(`${baseUrl}/auth/check-duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ email: normalizedEmail }),
    });

    const caBody = await caResponse.json().catch(() => ({}));
    const caData = caBody.data || {};

    if (!caData.exists) {
      return res.json({ status: true, data: { exists: false } });
    }

    // User exists in Central Auth — check their role
    const systemRole = caData.system_role || 'member';
    const platformNames = (caData.platform_names || []).join(', ') || 'another platform';

    if (['admin', 'master_admin'].includes(systemRole)) {
      return res.json({
        status: true,
        data: {
          exists: true,
          source: 'central_auth',
          system_role: systemRole,
          platforms: caData.platforms || [],
          platform_names: caData.platform_names || [],
          message: `An account was found on ${platformNames}. Your access to DentPulse has been activated. Please login with your existing credentials.`,
        },
      });
    } else {
      return res.json({
        status: true,
        data: {
          exists: true,
          source: 'central_auth',
          system_role: systemRole,
          platforms: caData.platforms || [],
          platform_names: caData.platform_names || [],
          message: `You already have an account on ${platformNames}. Please contact your admin to get access to DentPulse.`,
        },
      });
    }
  } catch (err) {
    console.error('[check-duplicate] Error:', err.message);
    // Non-blocking — if check fails, allow signup to proceed
    return res.json({ status: true, data: { exists: false } });
  }
});

module.exports = router;
