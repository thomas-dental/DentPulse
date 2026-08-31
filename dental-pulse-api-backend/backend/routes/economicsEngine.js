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
const { syncPractitioners } = require('../services/patientEconomics/sync/syncPractitioners');
const { syncInvoices, syncInvoiceItems } = require('../services/patientEconomics/sync/syncInvoices');
const { syncPayments } = require('../services/patientEconomics/sync/syncPayments');
const {
  kickoffIncremental,
  kickoffFull,
  runIncrementalKickoffTick,
  runFullKickoffTick,
} = require('../services/patientEconomics/sync/peScheduleKickoff');
const { getSyncStatusByPractice } = require('../services/patientEconomics/sync/cursorStore');
const { getDevOverview, getDevCounts, browseDevRows } = require('../services/patientEconomics/sync/peDevOverview');
const { listTicks } = require('../services/patientEconomics/sync/peTickHistory');
const {
  listPractitionerRates,
  insertPractitionerRate,
} = require('../services/patientEconomics/practitionerPrivateShareRates');
const {
  getTreatmentEconomicJourney,
} = require('../services/patientEconomics/treatmentEconomicJourney');
const {
  runModelledComputeTick,
} = require('../services/patientEconomics/computePatientModelledScores');
const {
  getPatientContributionList,
  getPatientFinancialRecordList,
  getPatientFinancialRecord,
  fetchPatientTreatmentLines,
  fetchPatientInvoices,
  getInvoiceContributionSummary,
} = require('../services/patientEconomics/patientEconomicsRead');
const {
  getPlannedUnscheduledLeakage,
} = require('../services/patientEconomics/plannedUnscheduledLeakage');
const {
  getValueLeakageSummary,
} = require('../services/patientEconomics/valueLeakageSummary');
const {
  getGrowthLeversSummary,
} = require('../services/patientEconomics/growthLeversSummary');
const {
  getGrowthLeversByPractice,
} = require('../services/patientEconomics/growthLeversByPractice');
const {
  getRetentionContributionAtRisk,
} = require('../services/patientEconomics/retentionContributionAtRisk');
const {
  getRetentionRecoveryLoop,
} = require('../services/patientEconomics/peReactivationFlags');
const {
  getCltvByAcquisitionSource,
} = require('../services/patientEconomics/cltvByAcquisitionSource');
const {
  getGoalSettingsSummary,
  saveGoalSettings,
} = require('../services/patientEconomics/goalSettings');
const {
  getEconomicAssumptionsSummary,
  saveEconomicAssumptions,
} = require('../services/patientEconomics/peEconomicAssumptions');
const {
  getConversionProbabilitiesSummary,
} = require('../services/patientEconomics/conversionProbabilities');

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
 * POST /api/economics-engine/sync/practitioners
 * Body: { practiceId }
 * Processes one practitioners chunk (1 Dentally page). Call repeatedly while hasMore=true.
 */
router.post('/sync/practitioners', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncPractitioners, '/sync/practitioners')
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

/**
 * POST /api/economics-engine/sync/invoices
 * Body: { practiceId }
 * One invoices page (+ detail enrich for invoice_items). Call while hasMore=true.
 */
router.post('/sync/invoices', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncInvoices, '/sync/invoices')
);

/**
 * POST /api/economics-engine/sync/invoice-items
 * Alias of /sync/invoices — items are nested under invoice detail, same cursor.
 */
router.post('/sync/invoice-items', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncInvoiceItems, '/sync/invoice-items')
);

/**
 * POST /api/economics-engine/sync/payments
 * Body: { practiceId }
 * One payments page (+ nested explanations → invoices). Call while hasMore=true.
 */
router.post('/sync/payments', syncAuthMiddleware, (req, res) =>
  handleSyncChunkRoute(req, res, syncPayments, '/sync/payments')
);

function isServiceKeyAuth(req) {
  const serviceKey = req.headers['x-service-key'];
  return (
    typeof serviceKey === 'string' &&
    serviceKey.length > 0 &&
    serviceKey === process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * JWT or x-service-key (pg_cron / machine). Service key may omit practiceId
 * to kick off all candidate practices.
 */
async function handleKickoffRoute(req, res, mode) {
  try {
    const serviceAuth = isServiceKeyAuth(req);
    if (!serviceAuth) {
      // Fall through to JWT if Authorization present — caller used syncAuthMiddleware
      if (!req.user?.id) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
    }

    const practiceId = req.body?.practiceId || req.query?.practiceId || null;

    if (practiceId) {
      if (!isUuid(practiceId)) {
        return res.status(400).json({ success: false, error: 'practiceId must be a UUID' });
      }
      if (!serviceAuth) {
        const access = await verifyPracticeAccess(req.user.id, practiceId);
        if (!access.ok) {
          return res.status(access.status).json({ success: false, error: access.error });
        }
      }
      const result =
        mode === 'incremental'
          ? await kickoffIncremental(practiceId)
          : await kickoffFull(practiceId);
      return res.json({ success: true, ...result });
    }

    if (!serviceAuth) {
      return res.status(400).json({
        success: false,
        error: 'practiceId (UUID) is required',
      });
    }

    const tick =
      mode === 'incremental'
        ? await runIncrementalKickoffTick()
        : await runFullKickoffTick();
    return res.json({ success: true, ...tick });
  } catch (err) {
    console.error(`[EconomicsEngine] kickoff-${mode} error:`, err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

/**
 * GET /api/economics-engine/sync/status?practiceId=
 * Per-resource cursor status for ops visibility.
 */
router.get('/sync/status', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const resources = await getSyncStatusByPractice(practiceId);
    return res.json({ success: true, practiceId, resources });
  } catch (err) {
    console.error('[EconomicsEngine] GET /sync/status error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/**
 * GET /api/economics-engine/sync/dev/counts?practiceId=
 * Row counts only — fast first paint for the inspector.
 */
router.get('/sync/dev/counts', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const result = await getDevCounts(practiceId);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[EconomicsEngine] GET /sync/dev/counts error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/**
 * GET /api/economics-engine/sync/dev/overview?practiceId=
 * Eng inspector: PAT + sync_cursors status (no row counts — use /dev/counts).
 */
router.get('/sync/dev/overview', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const overview = await getDevOverview(practiceId);
    return res.json({ success: true, ...overview });
  } catch (err) {
    console.error('[EconomicsEngine] GET /sync/dev/overview error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/**
 * GET /api/economics-engine/sync/dev/browse?practiceId=&resource=&page=&pageSize=
 * Paginated synced rows (service-role) — includes data written by onboarding sync.
 */
router.get('/sync/dev/browse', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    const resource = req.query?.resource;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }
    if (!resource || typeof resource !== 'string') {
      return res.status(400).json({ success: false, error: 'resource is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const result = await browseDevRows(
      practiceId,
      resource,
      req.query?.page,
      req.query?.pageSize
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    console.error('[EconomicsEngine] GET /sync/dev/browse error:', err.message);
    return res.status(status).json({
      success: false,
      error: status === 400 ? err.message : 'Internal error',
    });
  }
});

/**
 * GET /api/economics-engine/sync/dev/ticks
 * In-memory recent scheduler tick summaries (cleared on process restart).
 */
router.get('/sync/dev/ticks', syncAuthMiddleware, async (req, res) => {
  try {
    return res.json({ success: true, ticks: listTicks() });
  } catch (err) {
    console.error('[EconomicsEngine] GET /sync/dev/ticks error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/**
 * POST /api/economics-engine/sync/kickoff-incremental
 * Body: { practiceId } (required for JWT; optional for x-service-key → all practices)
 */
router.post('/sync/kickoff-incremental', async (req, res, next) => {
  if (isServiceKeyAuth(req)) {
    return handleKickoffRoute(req, res, 'incremental');
  }
  return syncAuthMiddleware(req, res, () => handleKickoffRoute(req, res, 'incremental'));
});

/**
 * POST /api/economics-engine/sync/kickoff-full
 * Body: { practiceId } (required for JWT; optional for x-service-key → all practices)
 */
router.post('/sync/kickoff-full', async (req, res, next) => {
  if (isServiceKeyAuth(req)) {
    return handleKickoffRoute(req, res, 'full');
  }
  return syncAuthMiddleware(req, res, () => handleKickoffRoute(req, res, 'full'));
});

/**
 * POST /api/economics-engine/modelled/compute
 * Body: { practiceId } (optional for x-service-key → all candidate practices)
 * Runs Modelled-tier CLTV projection + Quality Score materialization.
 */
async function handleModelledComputeRoute(req, res) {
  try {
    const serviceAuth = isServiceKeyAuth(req);
    if (!serviceAuth && !req.user?.id) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const practiceId = req.body?.practiceId || req.query?.practiceId || null;

    if (practiceId) {
      if (!isUuid(practiceId)) {
        return res.status(400).json({ success: false, error: 'practiceId must be a UUID' });
      }
      if (!serviceAuth) {
        const access = await verifyPracticeAccess(req.user.id, practiceId);
        if (!access.ok) {
          return res.status(access.status).json({ success: false, error: access.error });
        }
      }
      const result = await runModelledComputeTick({ practiceId });
      return res.json({ success: true, ...result });
    }

    if (!serviceAuth) {
      return res.status(400).json({
        success: false,
        error: 'practiceId (UUID) is required',
      });
    }

    const result = await runModelledComputeTick();
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[EconomicsEngine] POST /modelled/compute error:', err.message);
    return res.status(500).json({ success: false, error: 'Modelled compute failed' });
  }
}

router.post('/modelled/compute', async (req, res) => {
  if (isServiceKeyAuth(req)) {
    return handleModelledComputeRoute(req, res);
  }
  return syncAuthMiddleware(req, res, () => handleModelledComputeRoute(req, res));
});

/**
 * GET /api/economics-engine/assumptions/practitioner-rates?practiceId=
 * Lists practitioners with current effective private-share rate or explicit not-configured state.
 */
router.get('/assumptions/practitioner-rates', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(req.query?.pageSize, 10) || 10));
    const search = typeof req.query?.search === 'string' ? req.query.search : '';
    const sortBy = typeof req.query?.sortBy === 'string' ? req.query.sortBy : 'name';
    const sortDir = req.query?.sortDir === 'desc' ? 'desc' : 'asc';

    const payload = await listPractitionerRates(practiceId, {
      page,
      pageSize,
      search,
      sortBy,
      sortDir,
    });
    return res.json({ success: true, ...payload });
  } catch (err) {
    if (err.code === 'TABLE_NOT_FOUND') {
      return res.status(503).json({ success: false, error: err.message, code: err.code });
    }
    console.error('[EconomicsEngine] GET /assumptions/practitioner-rates error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load practitioner rates' });
  }
});

/**
 * POST /api/economics-engine/assumptions/practitioner-rates
 * Body: { practiceId, practitionerId, rate, effectiveFrom }
 * Append-only INSERT — never updates an existing rate row.
 */
router.post('/assumptions/practitioner-rates', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.body?.practiceId;
    const practitionerId = req.body?.practitionerId;
    const { rate, effectiveFrom } = req.body || {};

    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }
    if (!practitionerId || !isUuid(practitionerId)) {
      return res.status(400).json({ success: false, error: 'practitionerId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const result = await insertPractitionerRate({
      practiceId,
      practitionerId,
      rate,
      effectiveFrom,
      createdBy: req.user.id,
    });

    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    if (err.code === 'TABLE_NOT_FOUND') {
      return res.status(503).json({ success: false, error: err.message, code: err.code });
    }
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    console.error('[EconomicsEngine] POST /assumptions/practitioner-rates error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to save practitioner rate' });
  }
});

/**
 * GET /api/economics-engine/journey/treatment-economic?practiceId=
 * Aggregated Treatment Economic Journey™ stages from event_ledger (server-side).
 */
router.get('/journey/treatment-economic', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const journey = await getTreatmentEconomicJourney(practiceId);
    return res.json({ success: true, practiceId, ...journey });
  } catch (err) {
    console.error('[EconomicsEngine] GET /journey/treatment-economic error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load treatment economic journey' });
  }
});

/**
 * GET /api/economics-engine/read/patient-contribution-list?practiceId=
 */
router.get('/read/patient-contribution-list', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getPatientContributionList(practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/patient-contribution-list error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load patient list' });
  }
});

/**
 * GET /api/economics-engine/read/patient-financial-records?practiceId=
 */
router.get('/read/patient-financial-records', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getPatientFinancialRecordList(practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/patient-financial-records error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load patient financial records' });
  }
});

/**
 * GET /api/economics-engine/read/patient-financial-record?practiceId=&patientId=
 */
router.get('/read/patient-financial-record', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    const patientId = req.query?.patientId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }
    if (!patientId || !isUuid(patientId)) {
      return res.status(400).json({ success: false, error: 'patientId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const record = await getPatientFinancialRecord(practiceId, patientId);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Patient not found in contribution data' });
    }
    return res.json({ success: true, practiceId, patientId, ...record });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/patient-financial-record error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load patient financial record' });
  }
});

/**
 * GET /api/economics-engine/read/patient-treatment-lines?practiceId=&patientId=&ptId=
 */
router.get('/read/patient-treatment-lines', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    const patientId = req.query?.patientId;
    const ptIdRaw = req.query?.ptId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }
    if (!patientId || !isUuid(patientId)) {
      return res.status(400).json({ success: false, error: 'patientId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const ptId =
      ptIdRaw == null || ptIdRaw === ''
        ? null
        : Number.isFinite(Number(ptIdRaw))
          ? Number(ptIdRaw)
          : null;

    const lines = await fetchPatientTreatmentLines(practiceId, patientId, ptId);
    return res.json({ success: true, practiceId, patientId, lines });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/patient-treatment-lines error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load treatment lines' });
  }
});

/**
 * GET /api/economics-engine/read/patient-invoices?practiceId=&patientId=
 */
router.get('/read/patient-invoices', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    const patientId = req.query?.patientId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }
    if (!patientId || !isUuid(patientId)) {
      return res.status(400).json({ success: false, error: 'patientId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const invoices = await fetchPatientInvoices(practiceId, patientId);
    return res.json({ success: true, practiceId, patientId, invoices });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/patient-invoices error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load patient invoices' });
  }
});

/**
 * GET /api/economics-engine/read/invoice-contribution-summary?practiceId=
 */
router.get('/read/invoice-contribution-summary', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const summary = await getInvoiceContributionSummary(practiceId);
    return res.json({ success: true, practiceId, summary });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/invoice-contribution-summary error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load invoice contribution summary' });
  }
});

/**
 * GET /api/economics-engine/read/planned-unscheduled-leakage?practiceId=
 * Private planned items unscheduled beyond leakage_unscheduled_threshold_days (default 60).
 */
router.get('/read/planned-unscheduled-leakage', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getPlannedUnscheduledLeakage(practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/planned-unscheduled-leakage error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to load planned unscheduled leakage',
    });
  }
});

/**
 * GET /api/economics-engine/read/value-leakage-summary?practiceId=
 * Gross/weighted opportunity, Commitment Rate 30d, by-window and by-clinician breakdowns.
 */
router.get('/read/value-leakage-summary', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const summary = await getValueLeakageSummary(practiceId);
    return res.json({ success: true, ...summary });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/value-leakage-summary error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to load value & leakage summary',
    });
  }
});

/**
 * GET /api/economics-engine/read/growth-levers-summary?practiceId=
 * Practice visit frequency and value per visit (Derived tier, trailing window configurable).
 */
router.get('/read/growth-levers-summary', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const summary = await getGrowthLeversSummary(practiceId);
    return res.json({ success: true, ...summary });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/growth-levers-summary error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to load growth levers summary',
    });
  }
});

/**
 * GET /api/economics-engine/read/growth-levers-by-practice?practiceId=
 * Multi-practice lever values + headroom vs configurable benchmark (context practiceId).
 */
router.get('/read/growth-levers-by-practice', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getGrowthLeversByPractice(req.user.id, practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/growth-levers-by-practice error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to load growth levers by practice',
    });
  }
});

/**
 * GET /api/economics-engine/read/retention-contribution-at-risk?practiceId=
 * Contribution £ rollup by 4-tier retention segment — practice + group.
 */
router.get('/read/retention-contribution-at-risk', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getRetentionContributionAtRisk(req.user.id, practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error(
      '[EconomicsEngine] GET /read/retention-contribution-at-risk error:',
      err.message,
    );
    return res.status(500).json({
      success: false,
      error: 'Failed to load retention contribution at risk',
    });
  }
});

/**
 * GET /api/economics-engine/read/retention-recovery-loop?practiceId=
 * Reactivation flags, value by practice, recovery rate + patient list.
 */
router.get('/read/retention-recovery-loop', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getRetentionRecoveryLoop(req.user.id, practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/retention-recovery-loop error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to load retention recovery loop',
    });
  }
});

/**
 * GET /api/economics-engine/read/cltv-by-acquisition-source?practiceId=
 * Day 3 modelled CLTV rollup by acquisition source (thin samples flagged).
 */
router.get('/read/cltv-by-acquisition-source', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getCltvByAcquisitionSource(practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/cltv-by-acquisition-source error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to load CLTV by acquisition source',
    });
  }
});

/**
 * GET /api/economics-engine/read/goal-settings?practiceId=
 * Group defaults + per-practice overrides with actual vs target rollups.
 */
router.get('/read/goal-settings', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getGoalSettingsSummary(req.user.id, practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/goal-settings error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load goal settings' });
  }
});

/**
 * POST /api/economics-engine/assumptions/goal-settings
 * Body: { contextPracticeId, defaults, practiceOverrides }
 */
router.post('/assumptions/goal-settings', syncAuthMiddleware, async (req, res) => {
  try {
    const contextPracticeId = req.body?.contextPracticeId;
    if (!contextPracticeId || !isUuid(contextPracticeId)) {
      return res.status(400).json({ success: false, error: 'contextPracticeId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, contextPracticeId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const overrides = Array.isArray(req.body?.practiceOverrides)
      ? req.body.practiceOverrides
      : [];

    for (const row of overrides) {
      const pid = row?.practiceId;
      if (!pid || !isUuid(pid)) {
        return res.status(400).json({ success: false, error: 'Each override needs practiceId (UUID)' });
      }
      const overrideAccess = await verifyPracticeAccess(req.user.id, pid);
      if (!overrideAccess.ok) {
        return res.status(overrideAccess.status).json({
          success: false,
          error: overrideAccess.error || 'Not authorized for override practice',
        });
      }
    }

    const payload = await saveGoalSettings(req.user.id, contextPracticeId, {
      defaults: req.body?.defaults ?? {},
      practiceOverrides: overrides,
    });

    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] POST /assumptions/goal-settings error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to save goal settings' });
  }
});

/**
 * GET /api/economics-engine/assumptions/economic-assumptions?practiceId=
 */
router.get('/assumptions/economic-assumptions', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getEconomicAssumptionsSummary(practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] GET /assumptions/economic-assumptions error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load economic assumptions' });
  }
});

/**
 * POST /api/economics-engine/assumptions/economic-assumptions
 * Body: { practiceId, assumptions }
 */
router.post('/assumptions/economic-assumptions', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.body?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await saveEconomicAssumptions(req.user.id, practiceId, req.body);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] POST /assumptions/economic-assumptions error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to save economic assumptions' });
  }
});

/**
 * GET /api/economics-engine/read/conversion-probabilities?practiceId=
 */
router.get('/read/conversion-probabilities', syncAuthMiddleware, async (req, res) => {
  try {
    const practiceId = req.query?.practiceId;
    if (!practiceId || !isUuid(practiceId)) {
      return res.status(400).json({ success: false, error: 'practiceId (UUID) is required' });
    }

    const access = await verifyPracticeAccess(req.user.id, practiceId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const payload = await getConversionProbabilitiesSummary(practiceId);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[EconomicsEngine] GET /read/conversion-probabilities error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load conversion probabilities' });
  }
});

module.exports = router;
