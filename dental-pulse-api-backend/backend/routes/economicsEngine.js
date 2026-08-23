const express = require('express');
const syncAuthMiddleware = require('../middleware/syncAuth');
const { supabaseAdmin } = require('../config/supabase');
const { encryptPAT } = require('../services/patientEconomics/patEncryption');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * POST /api/economics-engine/credentials
 * Body: { practiceId, pat }
 * Encrypts + upserts dentally_credentials. Does not set validated_at.
 */
router.post('/credentials', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.body?.practiceId;
    const pat = typeof req.body?.pat === 'string' ? req.body.pat.trim() : '';

    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }
    if (!pat) {
      return res.status(400).json({ success: false, error: 'pat is required' });
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('user_id', req.user.id)
      .eq('organization_id', practiceId)
      .maybeSingle();

    if (membershipError) {
      console.error('[EconomicsEngine] membership check failed:', membershipError.message);
      return res.status(500).json({ success: false, error: 'Failed to verify practice access' });
    }
    if (!membership) {
      return res.status(403).json({ success: false, error: 'Not authorized for this practice' });
    }

    let ciphertext;
    let iv;
    try {
      ({ ciphertext, iv } = encryptPAT(pat));
    } catch (encErr) {
      console.error('[EconomicsEngine] encryptPAT failed:', encErr.message);
      return res.status(500).json({ success: false, error: 'Failed to encrypt credentials' });
    }

    const now = new Date().toISOString();
    const { error: upsertError } = await supabaseAdmin
      .from('dentally_credentials')
      .upsert(
        {
          practice_id: practiceId,
          encrypted_pat: ciphertext,
          encrypted_pat_iv: iv,
          updated_at: now,
          // validated_at intentionally omitted (Step 3)
        },
        { onConflict: 'practice_id' }
      );

    if (upsertError) {
      console.error('[EconomicsEngine] upsert failed:', upsertError.message);
      return res.status(500).json({ success: false, error: 'Failed to save credentials' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[EconomicsEngine] /credentials error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

module.exports = router;
