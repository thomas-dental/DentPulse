const express = require('express');
const syncAuthMiddleware = require('../middleware/syncAuth');
const { supabaseAdmin } = require('../config/supabase');
const { encryptPAT, decryptPAT } = require('../services/patientEconomics/patEncryption');
const { validatePatWithDentally } = require('../services/patientEconomics/validatePat');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * POST /api/economics-engine/credentials
 * Body: { practiceId, pat }
 * Encrypts, upserts, then validates via Dentally GET /v1/user.
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
          validated_at: null,
        },
        { onConflict: 'practice_id' }
      );

    if (upsertError) {
      console.error('[EconomicsEngine] upsert failed:', upsertError.message);
      return res.status(500).json({ success: false, error: 'Failed to save credentials' });
    }

    let decryptedPat;
    try {
      decryptedPat = decryptPAT(ciphertext, iv);
    } catch (decErr) {
      console.error('[EconomicsEngine] decryptPAT after save failed:', decErr.message);
      return res.status(500).json({ success: false, error: 'Credentials saved but validation could not run' });
    }

    const validation = await validatePatWithDentally(decryptedPat);
    decryptedPat = null;

    if (validation.status === 'valid') {
      const validatedAt = new Date().toISOString();
      const { error: validateUpdateError } = await supabaseAdmin
        .from('dentally_credentials')
        .update({ validated_at: validatedAt, updated_at: validatedAt })
        .eq('practice_id', practiceId);

      if (validateUpdateError) {
        console.error('[EconomicsEngine] validated_at update failed:', validateUpdateError.message);
        return res.status(500).json({ success: false, error: 'Token validated but status could not be saved' });
      }

      return res.json({ success: true, validated: true });
    }

    if (validation.status === 'auth_error') {
      return res.json({
        success: true,
        validated: false,
        error: validation.message,
      });
    }

    return res.status(503).json({
      success: false,
      code: 'DENTALLY_UNREACHABLE',
      error: validation.message,
    });
  } catch (err) {
    console.error('[EconomicsEngine] /credentials error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

module.exports = router;
