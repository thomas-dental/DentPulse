const express = require('express');
const syncAuthMiddleware = require('../middleware/syncAuth');
const { supabaseAdmin } = require('../config/supabase');
const { encryptPAT, decryptPAT } = require('../services/patientEconomics/patEncryption');
const { validatePatWithDentally } = require('../services/patientEconomics/validatePat');
const { syncPatients } = require('../services/patientEconomics/sync/syncPatients');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CREDENTIAL_COLUMNS = 'id, label, pat_hint, validated_at, created_at, updated_at';

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function buildPatHint(pat) {
  const trimmed = pat.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

async function verifyPracticeAccess(userId, practiceId) {
  const { data: membership, error } = await supabaseAdmin
    .from('user_roles')
    .select('user_id')
    .eq('user_id', userId)
    .eq('organization_id', practiceId)
    .maybeSingle();

  if (error) {
    console.error('[EconomicsEngine] membership check failed:', error.message);
    return { ok: false, status: 500, error: 'Failed to verify practice access' };
  }
  if (!membership) {
    return { ok: false, status: 403, error: 'Not authorized for this practice' };
  }
  return { ok: true };
}

function serializeCredential(row) {
  return {
    id: row.id,
    accountLabel: row.label || null,
    patHint: row.pat_hint && row.pat_hint !== '••••••••' ? row.pat_hint : null,
    validatedAt: row.validated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchCredentialForPractice(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('dentally_credentials')
    .select(CREDENTIAL_COLUMNS)
    .eq('practice_id', practiceId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data ? serializeCredential(data) : null;
}

async function validateAndUpdateCredential(credentialId, practiceId, decryptedPat) {
  const validation = await validatePatWithDentally(decryptedPat);

  if (validation.status === 'valid') {
    const validatedAt = new Date().toISOString();
    const updatePayload = { validated_at: validatedAt, updated_at: validatedAt };
    if (validation.dentallyEmail) {
      updatePayload.label = validation.dentallyEmail;
    }

    const { error: validateUpdateError } = await supabaseAdmin
      .from('dentally_credentials')
      .update(updatePayload)
      .eq('id', credentialId)
      .eq('practice_id', practiceId);

    if (validateUpdateError) {
      console.error('[EconomicsEngine] validated_at update failed:', validateUpdateError.message);
      return {
        httpStatus: 500,
        body: { success: false, error: 'Token validated but status could not be saved' },
      };
    }

    return {
      httpStatus: 200,
      body: { success: true, validated: true, validatedAt },
    };
  }

  if (validation.status === 'auth_error') {
    return {
      httpStatus: 200,
      body: {
        success: true,
        validated: false,
        error: validation.message,
      },
    };
  }

  return {
    httpStatus: 503,
    body: {
      success: false,
      code: 'DENTALLY_UNREACHABLE',
      error: validation.message,
    },
  };
}

/**
 * GET /api/economics-engine/credentials?practiceId=
 * Returns the single saved PAT for a practice (one per practice).
 */
router.get('/credentials', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const credential = await fetchCredentialForPractice(practiceId);
    return res.json({ success: true, credential });
  } catch (err) {
    console.error('[EconomicsEngine] GET /credentials error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load credentials' });
  }
});

/**
 * POST /api/economics-engine/credentials
 * Body: { practiceId, pat }
 * Upserts the single PAT for a practice, then validates via Dentally GET /v1/user.
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

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
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
    const patHint = buildPatHint(pat);

    const { data: savedRow, error: upsertError } = await supabaseAdmin
      .from('dentally_credentials')
      .upsert(
        {
          practice_id: practiceId,
          encrypted_pat: ciphertext,
          encrypted_pat_iv: iv,
          pat_hint: patHint,
          validated_at: null,
          updated_at: now,
        },
        { onConflict: 'practice_id' }
      )
      .select('id')
      .single();

    if (upsertError) {
      console.error('[EconomicsEngine] upsert failed:', upsertError.message);
      return res.status(500).json({ success: false, error: 'Failed to save credentials' });
    }

    const savedId = savedRow.id;

    let decryptedPat;
    try {
      decryptedPat = decryptPAT(ciphertext, iv);
    } catch (decErr) {
      console.error('[EconomicsEngine] decryptPAT after save failed:', decErr.message);
      return res.status(500).json({ success: false, error: 'Credentials saved but validation could not run' });
    }

    const result = await validateAndUpdateCredential(savedId, practiceId, decryptedPat);
    decryptedPat = null;

    const credential = await fetchCredentialForPractice(practiceId);

    return res.status(result.httpStatus).json({
      ...result.body,
      credential,
    });
  } catch (err) {
    console.error('[EconomicsEngine] POST /credentials error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/**
 * POST /api/economics-engine/credentials/validate
 * Re-validates the stored PAT for a practice without re-entering it.
 */
router.post('/credentials/validate', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.body?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const { data: row, error: fetchError } = await supabaseAdmin
      .from('dentally_credentials')
      .select('id, encrypted_pat, encrypted_pat_iv')
      .eq('practice_id', practiceId)
      .maybeSingle();

    if (fetchError) {
      console.error('[EconomicsEngine] credential fetch failed:', fetchError.message);
      return res.status(500).json({ success: false, error: 'Failed to load credential' });
    }
    if (!row) {
      return res.status(404).json({ success: false, error: 'No credential saved for this practice' });
    }

    let decryptedPat;
    try {
      decryptedPat = decryptPAT(row.encrypted_pat, row.encrypted_pat_iv);
    } catch (decErr) {
      console.error('[EconomicsEngine] decryptPAT failed:', decErr.message);
      return res.status(500).json({ success: false, error: 'Could not decrypt stored credential' });
    }

    const result = await validateAndUpdateCredential(row.id, practiceId, decryptedPat);
    decryptedPat = null;

    const credential = await fetchCredentialForPractice(practiceId);

    return res.status(result.httpStatus).json({
      ...result.body,
      credential,
    });
  } catch (err) {
    console.error('[EconomicsEngine] POST /credentials/validate error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/**
 * DELETE /api/economics-engine/credentials
 * Body: { practiceId }
 * Removes the single stored PAT for a practice.
 */
router.delete('/credentials', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.body?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const { error } = await supabaseAdmin
      .from('dentally_credentials')
      .delete()
      .eq('practice_id', practiceId);

    if (error) {
      console.error('[EconomicsEngine] delete failed:', error.message);
      return res.status(500).json({ success: false, error: 'Failed to remove credential' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[EconomicsEngine] DELETE /credentials error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/**
 * POST /api/economics-engine/sync/patients
 * Body: { practiceId }
 * Processes one patients chunk (1 Dentally page). Call repeatedly while hasMore=true.
 */
router.post('/sync/patients', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.body?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const result = await syncPatients(practiceId);

    if (result.errorCode === 'NO_CREDENTIAL') {
      return res.status(404).json({ success: false, ...result });
    }

    const httpStatus = result.success ? 200 : result.errorCode === 'PAT_EXPIRED_OR_INVALID' ? 401 : 503;
    return res.status(httpStatus).json({ success: result.success, ...result });
  } catch (err) {
    console.error('[EconomicsEngine] POST /sync/patients error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

module.exports = router;
