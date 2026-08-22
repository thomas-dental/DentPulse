/**
 * POST /api/password-broadcast
 * Called by DentPulse Frontend after a user changes their password or signs up.
 * Frontend sends the plain password over Supabase JWT auth (already HTTPS).
 * Backend encrypts it and forwards to Central Auth.
 * This keeps PASSWORD_SYNC_SECRET out of the frontend bundle.
 */
const express = require('express');
const crypto = require('crypto');
const syncAuthMiddleware = require('../middleware/syncAuth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

function getKey() {
  const secret = process.env.PASSWORD_SYNC_SECRET;
  if (!secret) throw new Error('PASSWORD_SYNC_SECRET is not set');
  return Buffer.from(secret, 'hex');
}

function encryptPassword(plainPassword) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainPassword, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function signBody(body) {
  return crypto.createHmac('sha256', getKey()).update(body).digest('hex');
}

/**
 * @swagger
 * /api/password-broadcast:
 *   post:
 *     summary: Broadcast password change to Central Auth
 *     description: Called by DentPulse frontend after a user changes their password. Backend encrypts the password with AES-256-CBC and forwards it to Central Auth. Non-blocking — the user's action succeeds even if broadcast fails.
 *     tags: [Password Sync]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, new_password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               new_password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Broadcast result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 response:
 *                   type: string
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Invalid or missing Supabase JWT
 *       403:
 *         description: Email mismatch with authenticated user
 */
router.post('/', syncAuthMiddleware, async (req, res) => {
  try {
    const { email, new_password } = req.body;

    if (!email || !new_password) {
      return res.status(400).json({ status: false, response: 'email and new_password are required' });
    }

    // Verify the authenticated user matches the email (prevent changing someone else's password)
    if (req.user.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ status: false, response: 'Email mismatch with authenticated user' });
    }

    const baseUrl = process.env.CENTRAL_AUTH_BASE_URL;
    if (!baseUrl) {
      console.warn('[password-broadcast] CENTRAL_AUTH_BASE_URL not set, skipping');
      return res.json({ status: true, response: 'Skipped — no Central Auth URL' });
    }

    // Look up central_auth_id for this user
    let centralAuthId = null;
    if (req.user?.id) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('central_auth_id')
        .eq('user_id', req.user.id)
        .maybeSingle();
      centralAuthId = profile?.central_auth_id || null;
    }

    // Get Central Auth token from localStorage (passed by frontend) or obtain via platform-login
    let centralAuthToken = req.headers['x-central-auth-token'];

    if (!centralAuthToken) {
      // Try to get a token via platform-login
      try {
        const loginPayload = { email, password: new_password, platform: 'dentalpulse' };
        if (centralAuthId) loginPayload.universal_id = centralAuthId;
        const loginRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/auth/platform-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loginPayload),
        });
        if (loginRes.ok) {
          const loginData = await loginRes.json();
          centralAuthToken = loginData?.data?.access_token;
        }
      } catch (err) {
        console.warn('[password-broadcast] Platform login failed:', err.message);
      }
    }

    if (!centralAuthToken) {
      console.warn('[password-broadcast] Could not obtain Central Auth token');
      return res.json({ status: true, response: 'Skipped — no Central Auth token' });
    }

    // Encrypt password and send to Central Auth
    const encrypted = encryptPassword(new_password);
    const bodyData = {
      email,
      new_password_encrypted: encrypted,
      source_platform: 'dentalpulse',
    };
    if (centralAuthId) bodyData.universal_id = centralAuthId;
    const body = JSON.stringify(bodyData);
    const signature = signBody(body);

    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/auth/password-changed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${centralAuthToken}`,
        'X-Password-Sync-Signature': signature,
        'X-Timestamp': String(Date.now()),
      },
      body,
    });

    if (response.ok) {
      console.log(`[password-broadcast] Password change broadcast for ${email}`);
      return res.json({ status: true, response: 'Password broadcast sent' });
    } else {
      const errBody = await response.text().catch(() => '');
      console.warn(`[password-broadcast] Central Auth rejected: ${response.status} ${errBody}`);
      return res.json({ status: true, response: 'Broadcast attempted' });
    }
  } catch (err) {
    console.error('[password-broadcast] Error:', err.message);
    // Don't fail the user's request — broadcast is best-effort
    return res.json({ status: true, response: 'Broadcast error (non-blocking)' });
  }
});

module.exports = router;
