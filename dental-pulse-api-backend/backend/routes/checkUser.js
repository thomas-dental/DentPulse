/**
 * @swagger
 * /api/auth/check-user:
 *   get:
 *     summary: Check user provisioning status before login
 *     description: Returns whether a user exists in DentPulse, their source platform, and whether their password is set. Used by frontend to decide login flow. No authentication required — only non-sensitive flags are returned.
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         description: The email address to check
 *     responses:
 *       200:
 *         description: User status returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     exists:
 *                       type: boolean
 *                     source_platform:
 *                       type: string
 *                       nullable: true
 *                       description: "null = own user, 'dentledger'/'skmarketing' = provisioned"
 *                     password_set:
 *                       type: boolean
 *       400:
 *         description: Missing email query param
 *       500:
 *         description: Server error
 */
const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const email = (req.query.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ status: false, response: 'email query param is required' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('user_id, source_platform, password_set, central_auth_id')
      .eq('email', email)
      .maybeSingle();

    if (!profile) {
      return res.json({
        status: true,
        data: { exists: false, source_platform: null, password_set: false },
      });
    }

    return res.json({
      status: true,
      data: {
        exists: true,
        source_platform: profile.source_platform,  // null = own user, 'dentledger'/'skmarketing' = provisioned
        password_set: profile.password_set ?? true, // default true for existing users
        central_auth_id: profile.central_auth_id || null,
      },
    });
  } catch (err) {
    console.error('[CheckUser] Error:', err.message);
    return res.status(500).json({ status: false, response: err.message });
  }
});

module.exports = router;
