/**
 * Process Dentally appointment webhook events: upsert diary appointment,
 * cascade-refresh linked treatment_appointments, and write event_ledger link events.
 *
 * DB fast path: discovery + ledger prefetch via Supabase RPCs; batch upsert/ledger write.
 */

const { supabaseAdmin } = require('../../../config/supabase');
const { transformRecord } = require('../../transformers/dentally');
const {
  TABLE_MAP,
  ON_CONFLICT_MAP,
} = require('../../../api/dentally/config');
const {
  getCancellationReasonMap,
  upsertAppointments,
} = require('../../sync/upsert');
const {
  fetchAppointmentDetail,
  fetchTreatmentAppointmentDetail,
  fetchDentallyPage,
  extractRecords,
} = require('../../../api/dentally/client');
const { writeLedgerEventsFromUpsert } = require('../sync/eventLedgerWriter');
const { invalidatePeReadCache } = require('../peReadCache');
const { loadWebhookContext } = require('./processPaymentWebhook');
const {
  discoverTreatmentAppointmentIdsRpc,
  loadTreatmentAppointmentLedgerPrefetchRpc,
} = require('./webhookAppointmentRefresh');
const {
  parseAppointmentAction,
  extractAppointmentId,
  normalizePatientId,
  mergeTreatmentAppointmentIds,
  extractTreatmentAppointmentIdsForAppointment,
} = require('./appointmentWebhookHelpers');

const WEBHOOK_SYNC_RUN_ID = 'dentally-appointment-webhook';
const LOOKBACK_DAYS = Number(process.env.PE_SYNC_INCREMENTAL_LOOKBACK_DAYS || 3);
const MAX_TA_API_PAGES = 3;
const TA_FETCH_CONCURRENCY = Number(process.env.APPOINTMENT_WEBHOOK_TA_CONCURRENCY || 3);

function daysAgoUtc(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Math.max(0, days));
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} practiceId
 */
async function loadAppointmentWebhookContext(practiceId) {
  const ctx = await loadWebhookContext(practiceId);
  const cancellationReasonMap = await getCancellationReasonMap(practiceId);
  return {
    ...ctx,
    transformCtx: {
      ...ctx.transformCtx,
      cancellationReasonMap,
    },
  };
}

/**
 * @param {string} practiceId
 * @param {object} ctx
 * @param {object} appointmentRecord
 */
async function upsertAppointmentFromRecord(practiceId, ctx, appointmentRecord) {
  const row = transformRecord('appointments', appointmentRecord, ctx.transformCtx);
  if (!row) {
    throw new Error('Appointment transform returned null');
  }

  const result = await upsertAppointments(
    TABLE_MAP.appointments,
    ON_CONFLICT_MAP.appointments,
    [row],
  );

  if (result.processed === 0) {
    throw new Error('Appointment upsert failed');
  }

  return { row, result };
}

/**
 * @param {string} practiceId
 * @param {number} appointmentId
 */
async function softDeleteLocalAppointment(practiceId, appointmentId) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('appointments')
    .update({ deleted_at: now, updated_at: now })
    .eq('organization_id', practiceId)
    .eq('apmt_id', appointmentId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to soft-delete local appointment ${appointmentId}: ${error.message}`);
  }
}

/**
 * Scan recent treatment_appointments API pages for rows linked to appointmentId.
 * @param {object} ctx
 * @param {number} appointmentId
 * @returns {Promise<number[]>}
 */
async function discoverTreatmentAppointmentIdsFromApi(ctx, appointmentId) {
  const lookbackStart = daysAgoUtc(LOOKBACK_DAYS);
  const ids = [];

  for (let page = 1; page <= MAX_TA_API_PAGES; page += 1) {
    const responseData = await fetchDentallyPage(
      ctx.apiKey,
      ctx.apiEndpoint,
      'treatment_appointments',
      page,
      lookbackStart,
      null,
    );
    const { records, totalPages } = extractRecords(responseData, 'treatment_appointments');
    ids.push(...extractTreatmentAppointmentIdsForAppointment(records, appointmentId));

    if (!records.length) break;
    if (totalPages != null && page >= totalPages) break;
  }

  return ids;
}

/**
 * @param {string} practiceId
 * @param {object} ctx
 * @param {number} appointmentId
 * @param {number|null} patientId
 * @returns {Promise<number[]>}
 */
async function discoverTreatmentAppointmentIds(practiceId, ctx, appointmentId, patientId) {
  const [localIds, apiMatches] = await Promise.all([
    discoverTreatmentAppointmentIdsRpc(practiceId, appointmentId, patientId),
    discoverTreatmentAppointmentIdsFromApi(ctx, appointmentId),
  ]);

  return mergeTreatmentAppointmentIds(localIds, apiMatches);
}

/**
 * Fetch Dentally TA details with bounded concurrency.
 * @param {object} ctx
 * @param {number[]} taIds
 * @returns {Promise<object[]>}
 */
async function fetchTreatmentAppointmentDetails(ctx, taIds) {
  const rows = [];
  const concurrency = Math.max(1, Math.min(TA_FETCH_CONCURRENCY, taIds.length || 1));

  for (let i = 0; i < taIds.length; i += concurrency) {
    const batch = taIds.slice(i, i + concurrency);
    const details = await Promise.all(
      batch.map((taId) => fetchTreatmentAppointmentDetail(ctx.apiKey, ctx.apiEndpoint, taId)),
    );

    for (const detail of details) {
      if (!detail) continue;
      const row = transformRecord('treatment_appointments', detail, ctx.transformCtx);
      if (row) rows.push(row);
    }
  }

  return rows;
}

/**
 * @param {string} practiceId
 * @param {object} ctx
 * @param {number[]} taIds
 * @returns {Promise<{ refreshed: number, ledgerEventsWritten: number }>}
 */
async function refreshTreatmentAppointmentsByIds(practiceId, ctx, taIds) {
  if (!taIds.length) {
    return { refreshed: 0, ledgerEventsWritten: 0 };
  }

  const rows = await fetchTreatmentAppointmentDetails(ctx, taIds);
  if (!rows.length) {
    return { refreshed: 0, ledgerEventsWritten: 0 };
  }

  const ledgerState = await loadTreatmentAppointmentLedgerPrefetchRpc(practiceId, rows);

  const { error } = await supabaseAdmin
    .from(TABLE_MAP.treatment_appointments)
    .upsert(rows, { onConflict: ON_CONFLICT_MAP.treatment_appointments });

  if (error) {
    throw new Error(`Failed to batch upsert treatment appointments: ${error.message}`);
  }

  const ledgerResult = await writeLedgerEventsFromUpsert({
    practiceId,
    entityAlias: 'treatment_appointments',
    syncRunId: WEBHOOK_SYNC_RUN_ID,
    newRows: rows,
    existingByEntityId: ledgerState.existingByEntityId,
    existingLedgerKeys: ledgerState.existingLedgerKeys,
    payloadSource: 'dentally_webhook',
  });

  return {
    refreshed: rows.length,
    ledgerEventsWritten: ledgerResult.written || 0,
  };
}

/**
 * @param {string} practiceId
 * @param {object} ctx
 * @param {number} appointmentId
 * @param {number|null} patientId
 */
async function refreshTreatmentAppointmentsForDiaryAppointment(
  practiceId,
  ctx,
  appointmentId,
  patientId,
) {
  const taIds = await discoverTreatmentAppointmentIds(
    practiceId,
    ctx,
    appointmentId,
    patientId,
  );
  return refreshTreatmentAppointmentsByIds(practiceId, ctx, taIds);
}

function invalidateAppointmentPeCaches(practiceId) {
  invalidatePeReadCache(practiceId, 'treatment-economic-journey');
  invalidatePeReadCache(practiceId, 'value-leakage-summary');
  invalidatePeReadCache(practiceId, 'planned-unscheduled-leakage');
  invalidatePeReadCache(practiceId, 'growth-levers');
}

/**
 * @param {object} params
 * @param {string} params.practiceId
 * @param {string} params.eventName — appointment.created | appointment.updated | appointment.deleted
 * @param {object|null} params.data — webhook data object
 */
async function processAppointmentWebhook({ practiceId, eventName, data }) {
  const action = parseAppointmentAction(eventName);
  if (!action) {
    const err = new Error(`Unsupported appointment event: ${eventName}`);
    err.code = 'UNSUPPORTED_EVENT';
    throw err;
  }

  const appointmentId = extractAppointmentId(data);
  if (!appointmentId) {
    const err = new Error('Appointment webhook missing data.id');
    err.code = 'MISSING_APPOINTMENT_ID';
    throw err;
  }

  const ctx = await loadAppointmentWebhookContext(practiceId);
  let appointmentUpserted = false;
  let patientId = normalizePatientId(data?.patient_id);
  let cascade = { refreshed: 0, ledgerEventsWritten: 0 };

  if (action === 'deleted') {
    const fetchedAppointment = await fetchAppointmentDetail(
      ctx.apiKey,
      ctx.apiEndpoint,
      appointmentId,
    );

    if (fetchedAppointment) {
      const { row } = await upsertAppointmentFromRecord(practiceId, ctx, fetchedAppointment);
      appointmentUpserted = true;
      patientId = patientId ?? normalizePatientId(row.apmt_patient_id);
    } else {
      await softDeleteLocalAppointment(practiceId, appointmentId);
    }

    cascade = await refreshTreatmentAppointmentsForDiaryAppointment(
      practiceId,
      ctx,
      appointmentId,
      patientId,
    );
  } else {
    const fetchedAppointment = await fetchAppointmentDetail(
      ctx.apiKey,
      ctx.apiEndpoint,
      appointmentId,
    );

    if (!fetchedAppointment) {
      const err = new Error(`Appointment ${appointmentId} not found in Dentally API`);
      err.code = 'APPOINTMENT_NOT_FOUND';
      throw err;
    }

    const { row } = await upsertAppointmentFromRecord(practiceId, ctx, fetchedAppointment);
    appointmentUpserted = true;
    patientId = patientId ?? normalizePatientId(row.apmt_patient_id);

    cascade = await refreshTreatmentAppointmentsForDiaryAppointment(
      practiceId,
      ctx,
      appointmentId,
      patientId,
    );
  }

  if (appointmentUpserted || cascade.refreshed > 0 || cascade.ledgerEventsWritten > 0) {
    invalidateAppointmentPeCaches(practiceId);
  }

  return {
    appointmentId,
    appointmentUpserted,
    treatmentAppointmentsRefreshed: cascade.refreshed,
    ledgerEventsWritten: cascade.ledgerEventsWritten,
  };
}

module.exports = {
  processAppointmentWebhook,
  loadAppointmentWebhookContext,
  discoverTreatmentAppointmentIds,
  refreshTreatmentAppointmentsForDiaryAppointment,
  fetchTreatmentAppointmentDetails,
};
