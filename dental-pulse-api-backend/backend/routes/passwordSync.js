const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// JWKS setup for Central Auth JWT verification
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

function getKey() {
  const secret = process.env.PASSWORD_SYNC_SECRET;
  if (!secret) throw new Error('PASSWORD_SYNC_SECRET is not set');
  return Buffer.from(secret, 'hex');
}

function decryptPassword(payload) {
  const key = getKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length <= 16) throw new Error('Invalid encrypted payload');
  const iv = buf.subarray(0, 16);
  const ciphertext = buf.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// Rate limiter: max 10 per email per 5 minutes
const rateLimitMap = new Map();
function checkRateLimit(email) {
  const now = Date.now();
  const key = `password-sync:${email}`;
  const timestamps = rateLimitMap.get(key) || [];
  const recent = timestamps.filter(t => now - t < 300000);
  if (recent.length >= 10) return false;
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}

/**
 * @swagger
 * /api/password-sync:
 *   post:
 *     summary: Receive encrypted password from Central Auth
 *     description: Central Auth calls this endpoint to sync a password change to DentPulse. Protected by three layers — Central Auth JWT (service role), HMAC signature verification, and timestamp check. The password is AES-256-CBC encrypted.
 *     tags: [Password Sync]
 *     security:
 *       - centralAuthJwt: []
 *     parameters:
 *       - in: header
 *         name: X-Password-Sync-Signature
 *         required: true
 *         schema:
 *           type: string
 *         description: HMAC-SHA256 signature of the request body
 *       - in: header
 *         name: X-Timestamp
 *         required: true
 *         schema:
 *           type: string
 *         description: Unix timestamp in milliseconds (must be within 5 minutes)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, new_password_encrypted]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               new_password_encrypted:
 *                 type: string
 *                 description: AES-256-CBC encrypted password (base64)
 *     responses:
 *       200:
 *         description: Password synced successfully
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
 *       400:
 *         description: Missing fields or decryption failed
 *       401:
 *         description: Invalid or missing token
 *       403:
 *         description: Invalid signature, missing signature, or expired request
 *       404:
 *         description: User not found in DentPulse
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  try {
    // Layer 1: JWT verification + service role check
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ status: false, response: 'No token provided' });
    }

    let payload;
    try {
      payload = await verifyToken(token);
    } catch (err) {
      console.error('[PasswordSync] Token verification failed:', err.message);
      return res.status(401).json({ status: false, response: 'Invalid or expired token' });
    }

    if (payload.role !== 'service') {
      return res.status(403).json({ status: false, response: 'Forbidden: service role required' });
    }

    // Layer 2: HMAC signature verification
    const signature = req.headers['x-password-sync-signature'];
    if (!signature) {
      return res.status(403).json({ status: false, response: 'Missing signature' });
    }

    // Use raw body (captured by express.json verify callback) to avoid re-serialization mismatch
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const expectedSig = crypto.createHmac('sha256', getKey()).update(rawBody).digest('hex');
    try {
      if (!crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(signature, 'hex'))) {
        return res.status(403).json({ status: false, response: 'Invalid signature' });
      }
    } catch {
      return res.status(403).json({ status: false, response: 'Invalid signature' });
    }

    // Layer 3: Timestamp check
    const timestamp = parseInt(req.headers['x-timestamp'], 10);
    if (!timestamp || Math.abs(Date.now() - timestamp) > 300000) {
      return res.status(403).json({ status: false, response: 'Request expired' });
    }

    // Rate limit
    const { email, new_password_encrypted } = req.body;
    if (!email || !new_password_encrypted) {
      return res.status(400).json({ status: false, response: 'email and new_password_encrypted are required' });
    }

    if (!checkRateLimit(email)) {
      return res.status(429).json({ status: false, response: 'Rate limit exceeded' });
    }

    // Decrypt password
    let plainPassword;
    try {
      plainPassword = decryptPassword(new_password_encrypted);
    } catch (err) {
      console.error('[PasswordSync] Decryption failed:', err.message);
      return res.status(400).json({ status: false, response: 'Decryption failed' });
    }

    // Find Supabase user by email via profiles table
    const { data: profile, error: findError } = await supabaseAdmin
      .from('profiles')
      .select('user_id, email')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (findError || !profile) {
      console.warn(`[PasswordSync] User not found in DentPulse: ${email}`);
      return res.status(404).json({ status: false, response: 'User not found in DentPulse' });
    }

    // Update Supabase auth user password via Admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      profile.user_id,
      { password: plainPassword }
    );

    if (updateError) {
      console.error('[PasswordSync] Supabase password update failed:', updateError.message);
      return res.status(500).json({ status: false, response: 'Failed to update Supabase password' });
    }

    console.log(`[PasswordSync] Password updated for ${email} (Supabase user: ${profile.user_id})`);

    return res.json({
      status: true,
      response: 'Password synced',
      data: { updated: true, user_id: profile.user_id },
    });
  } catch (err) {
    console.error('[PasswordSync] Error:', err.message);
    return res.status(500).json({ status: false, response: err.message });
  }
});

module.exports = router;
