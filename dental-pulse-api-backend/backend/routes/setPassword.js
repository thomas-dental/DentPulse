/**
 * @swagger
 * /api/set-password:
 *   post:
 *     summary: Set password for provisioned user on first login
 *     description: Called by DentPulse frontend after Central Auth verifies a provisioned user's credentials. Sets the password in Supabase so subsequent logins work directly. Protected by Central Auth JWT.
 *     tags: [Authentication]
 *     security:
 *       - centralAuthJwt: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password set successfully
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
 *         description: Invalid or missing token
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// JWKS verification (Central Auth JWT)
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

router.post('/', async (req, res) => {
  try {
    // Verify Central Auth JWT
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ status: false, response: 'No token provided' });
    }

    let payload;
    try {
      payload = await verifyToken(token);
    } catch (err) {
      return res.status(401).json({ status: false, response: 'Invalid or expired token' });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: false, response: 'email and password are required' });
    }

    // Find user in profiles
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (!profile) {
      return res.status(404).json({ status: false, response: 'User not found' });
    }

    // Set password via Supabase admin API
    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.user_id, { password });

    if (error) {
      console.error('[SetPassword] Supabase update failed:', error.message);
      return res.status(500).json({ status: false, response: 'Failed to set password' });
    }

    // Update password_set flag in profiles
    await supabaseAdmin
      .from('profiles')
      .update({ password_set: true })
      .eq('user_id', profile.user_id);

    console.log(`[SetPassword] Password set for ${email} (first-login sync from Central Auth)`);
    return res.json({ status: true, response: 'Password set successfully' });
  } catch (err) {
    console.error('[SetPassword] Error:', err.message);
    return res.status(500).json({ status: false, response: err.message });
  }
});

module.exports = router;
