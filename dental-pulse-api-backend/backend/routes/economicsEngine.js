const express = require('express');
const syncAuthMiddleware = require('../middleware/syncAuth');
const { supabaseAdmin } = require('../config/supabase');
const { encryptPAT, decryptPAT } = require('../services/patientEconomics/patEncryption');
const { validatePatWithDentally } = require('../services/patientEconomics/validatePat');
const {
  DENTALLY_NAME,
  findDentallyIntegration,
  findEncryptedDentallyCredential,
} = require('../services/patientEconomics/integrationCredentials');
const { syncPatients } = require('../services/patientEconomics/sync/syncPatients');
const { syncAccounts } = require('../services/patientEconomics/sync/syncAccounts');
const { syncRecalls } = require('../services/patientEconomics/sync/syncRecalls');
const { syncAppointments } = require('../services/patientEconomics/sync/syncAppointments');
const { syncTreatmentAppointments } = require('../services/patientEconomics/sync/syncTreatmentAppointments');
const { syncTreatmentPlans } = require('../services/patientEconomics/sync/syncTreatmentPlans');
const { syncTreatmentItems } = require('../services/patientEconomics/sync/syncTreatmentItems');
const { syncAcquisitionSources } = require('../services/patientEconomics/sync/syncAcquisitionSources');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CREDENTIAL_SELECT =
  'id, organization_id, integration_name, integration_description, pat_hint, validated_at, needs_reconnection, auth_error_message, auth_failed_at, created_at, updated_at, encrypted_pat';

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
  if (!row || !row.encrypted_pat) return null;
  return {
    id: row.id,
    accountLabel: row.integration_description || null,
    patHint: row.pat_hint && row.pat_hint !== '••••••••' ? row.pat_hint : null,
    validatedAt: row.validated_at || null,
    needsReconnection: row.needs_reconnection === true,
    authErrorMessage: row.auth_error_message || null,
    authFailedAt: row.auth_failed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchCredentialForPractice(practiceId) {
  const row = await findEncryptedDentallyCredential(practiceId);
  return serializeCredential(row);
}

async function validateAndUpdateCredential(credentialId, practiceId, decryptedPat) {
  const validation = await validatePatWithDentally(decryptedPat);

  if (validation.status === 'valid') {
    const validatedAt = new Date().toISOString();
    const updatePayload = {
      validated_at: validatedAt,
      updated_at: validatedAt,
      needs_reconnection: false,
      auth_error_message: null,
      auth_failed_at: null,
      is_connected: true,
    };
    if (validation.dentallyEmail) {
      updatePayload.integration_description = validation.dentallyEmail;
    }

    const { error: validateUpdateError } = await supabaseAdmin
      .from('integrations')
      .update(updatePayload)
      .eq('id', credentialId)
      .eq('organization_id', practiceId);

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
    const failedAt = new Date().toISOString();
    const { error: authUpdateError } = await supabaseAdmin
      .from('integrations')
      .update({
        validated_at: null,
        needs_reconnection: true,
        auth_error_message: validation.message || 'PAT rejected by Dentally',
        auth_failed_at: failedAt,
        updated_at: failedAt,
      })
      .eq('id', credentialId)
      .eq('organization_id', practiceId);

    if (authUpdateError) {
      console.error('[EconomicsEngine] needs_reconnection update failed:', authUpdateError.message);
    }

    return {
      httpStatus: 200,
      body: {
        success: true,
        validated: false,
        needsReconnection: true,
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
 * Returns the Dentally credential for this practice when encrypted_pat is set.
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
 * Upserts encrypted PAT onto integrations (Dentally), then validates via Dentally GET /v1/user.
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

    let existing = await findDentallyIntegration(practiceId);
    let savedId;

    if (existing) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('integrations')
        .update({
          encrypted_pat: ciphertext,
          encrypted_pat_iv: iv,
          pat_hint: patHint,
          validated_at: null,
          needs_reconnection: false,
          auth_error_message: null,
          auth_failed_at: null,
          api_key: null,
          updated_at: now,
        })
        .eq('id', existing.id)
        .eq('organization_id', practiceId)
        .select('id')
        .single();

      if (updateError) {
        console.error('[EconomicsEngine] update failed:', updateError.message);
        return res.status(500).json({ success: false, error: 'Failed to save credentials' });
      }
      savedId = updated.id;
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('integrations')
        .insert({
          organization_id: practiceId,
          user_id: req.user.id,
          created_by: req.user.id,
          integration_name: DENTALLY_NAME,
          integration_description: 'Cloud-based dental practice management software',
          is_connected: false,
          api_endpoints: 'https://api.dentally.co',
          api_key: null,
          encrypted_pat: ciphertext,
          encrypted_pat_iv: iv,
          pat_hint: patHint,
          validated_at: null,
          needs_reconnection: false,
          sync_frequency: '15min',
          updated_at: now,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[EconomicsEngine] insert failed:', insertError.message);
        return res.status(500).json({ success: false, error: 'Failed to save credentials' });
      }
      savedId = inserted.id;
    }

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

    const row = await findEncryptedDentallyCredential(practiceId);
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
 * Clears encrypted PAT fields on the Dentally integration row (does not delete the row,
 * and does not revoke the token on Dentally's side).
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

    const row = await findEncryptedDentallyCredential(practiceId);
    if (!row) {
      return res.json({ success: true });
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('integrations')
      .update({
        encrypted_pat: null,
        encrypted_pat_iv: null,
        validated_at: null,
        pat_hint: null,
        needs_reconnection: false,
        auth_error_message: null,
        auth_failed_at: null,
        api_key: null,
        updated_at: now,
      })
      .eq('id', row.id)
      .eq('organization_id', practiceId);

    if (error) {
      console.error('[EconomicsEngine] delete/clear failed:', error.message);
      return res.status(500).json({ success: false, error: 'Failed to remove credential' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[EconomicsEngine] DELETE /credentials error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

function resolveSyncHttpStatus(result) {
  if (result.success) return 200;
  if (result.errorCode === 'PAT_EXPIRED_OR_INVALID') return 401;
  if (result.errorCode === 'NO_CREDENTIAL') return 404;
  return 503;
}

async function handleSyncChunkRoute(req, res, syncFn, routeLabel) {
  try {
    const practiceId = req.body?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const result = await syncFn(practiceId);
    return res.status(resolveSyncHttpStatus(result)).json({ success: result.success, ...result });
  } catch (err) {
    console.error(`[EconomicsEngine] POST ${routeLabel} error:`, err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

/**
 * POST /api/economics-engine/sync/acquisition-sources
 * Body: { practiceId }
 * Processes one acquisition_sources chunk. Call repeatedly while hasMore=true.
 * Sync before patients so pt_acquisition_source_name can resolve at upsert time.
 */
router.post('/sync/acquisition-sources', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncAcquisitionSources, '/sync/acquisition-sources')
);

/**
 * POST /api/economics-engine/sync/patients
 * Body: { practiceId }
 * Processes one patients chunk (1 Dentally page). Call repeatedly while hasMore=true.
 */
router.post('/sync/patients', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncPatients, '/sync/patients')
);

/**
 * POST /api/economics-engine/sync/accounts
 * Body: { practiceId }
 * Processes one accounts chunk (1 Dentally page). Call repeatedly while hasMore=true.
 */
router.post('/sync/accounts', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncAccounts, '/sync/accounts')
);

/**
 * POST /api/economics-engine/sync/recalls
 * Body: { practiceId }
 * Processes one recalls chunk (1 Dentally patients page). Call repeatedly while hasMore=true.
 */
router.post('/sync/recalls', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncRecalls, '/sync/recalls')
);

/**
 * POST /api/economics-engine/sync/appointments
 * Body: { practiceId }
 * Processes one appointments chunk (1 Dentally page). Call repeatedly while hasMore=true.
 */
router.post('/sync/appointments', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncAppointments, '/sync/appointments')
);

/**
 * POST /api/economics-engine/sync/treatment-appointments
 * Body: { practiceId }
 * Processes one treatment_appointments chunk. Call repeatedly while hasMore=true.
 */
router.post('/sync/treatment-appointments', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncTreatmentAppointments, '/sync/treatment-appointments')
);

/**
 * POST /api/economics-engine/sync/treatment-plans
 * Body: { practiceId }
 * Processes one treatment_plans chunk. Call repeatedly while hasMore=true.
 */
router.post('/sync/treatment-plans', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncTreatmentPlans, '/sync/treatment-plans')
);

/**
 * POST /api/economics-engine/sync/treatment-items
 * Body: { practiceId }
 * Processes one treatment_items (Dentally treatment_plan_items) chunk.
 */
router.post('/sync/treatment-items', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncTreatmentItems, '/sync/treatment-items')
);

module.exports = router;
