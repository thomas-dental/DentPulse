/**
 * Append-only PE event ledger writer.
 *
 * Called from upsertPePage after successful upserts for:
 *   syncTreatmentPlans        → treatment_plans
 *     PLAN_CREATED, TREATMENT_STARTED, PLAN_COMPLETED
 *   syncTreatmentAppointments → treatment_appointments
 *     APPOINTMENT_LINKED / UNLINKED
 *   syncTreatmentItems        → treatment_plan_items
 *     ITEM_COMPLETED
 *   syncInvoices              → platform_integration_invoices
 *     INVOICE_RAISED
 *   syncPayments              → dentally_payments
 *     PAYMENT_ALLOCATED (explanation with invoice_id)
 *   syncPatients / syncRecalls → patients
 *     PATIENT_REACTIVATED (is_active false→true),
 *     RECALL_DUE / RECALL_OVERDUE (dentist/hygienist recall dates vs UTC today)
 *
 * Diary syncAppointments is intentionally not hooked — plan link state lives on
 * treatment_appointments.ta_appointment_id (Step 1 payload contract).
 *
 * Patient match (Treatment Economic Journey™):
 *   - Resolve source pt_id → patients.id when possible.
 *   - No match → still insert with patient_id NULL and pt_id in payload (orphan grain).
 *   - Missing pt_id on source row → skip (cannot attribute the event).
 *
 * Resume / chunk safety:
 *   - Prefetch source rows before upsert (diff baseline).
 *   - Prefetch existing ledger idempotency keys (heal mid-chunk failures).
 *   - Ledger upsert on (practice_id, idempotency_key) with ignoreDuplicates.
 *   - Ledger write failures throw so the chunk is not silently marked complete.
 *   - PATIENT_REACTIVATED is transition-only (no durable heal after upsert).
 */

const { supabaseAdmin } = require('../../../config/supabase');
const {
  diffRowEvents,
  normalizeBigInt,
  isPlanCompleted,
  isItemCompleted,
  toDateOnly,
  todayUtcDate,
} = require('./eventLedgerDiff');
const {
  resolveLedgerPatientBinding,
  resolveLedgerLocationId,
  buildLedgerInsertRow,
} = require('./eventLedgerPatientBinding');

const LEDGER_ENTITIES = new Set([
  'treatment_plans',
  'treatment_appointments',
  'treatment_plan_items',
  'invoices',
  'payments',
  'patients',
]);

const ENTITY_TABLE = {
  treatment_plans: 'treatment_plans',
  treatment_appointments: 'treatment_appointments',
  treatment_plan_items: 'treatment_plan_items',
  invoices: 'platform_integration_invoices',
  payments: 'dentally_payments',
  patients: 'patients',
};

const ENTITY_ID_FIELD = {
  treatment_plans: 'tp_id',
  treatment_appointments: 'ta_id',
  treatment_plan_items: 'tpi_id',
  invoices: 'platform_invoice_id',
  payments: 'dp_id',
  patients: 'pt_id',
};

const ENTITY_PATIENT_FIELD = {
  treatment_plans: 'tp_patient_id',
  treatment_appointments: 'ta_patient_id',
  treatment_plan_items: 'tpi_patient_id',
  invoices: 'patient_id',
  payments: 'dp_patient_id',
  patients: 'pt_id',
};

function isLedgerEntity(entityAlias) {
  return LEDGER_ENTITIES.has(entityAlias);
}

function normalizeEntityId(entityAlias, value) {
  return normalizeBigInt(value);
}

function paymentAllocationKeys(row) {
  const keys = [];
  const dpId = normalizeBigInt(row.dp_id);
  if (dpId == null) return keys;
  const explanations = Array.isArray(row._explanations) ? row._explanations : [];
  const seen = new Set();
  for (const exp of explanations) {
    const invoiceId = normalizeBigInt(exp?.invoice_id);
    if (invoiceId == null || seen.has(invoiceId)) continue;
    seen.add(invoiceId);
    keys.push(`payment_allocated:${dpId}:${invoiceId}`);
  }
  return keys;
}

function patientRecallKeys(row, asOfDate = todayUtcDate()) {
  const keys = [];
  const ptId = normalizeBigInt(row.pt_id);
  if (ptId == null) return keys;
  const asOf = toDateOnly(asOfDate) || todayUtcDate();

  for (const [recallType, field] of [
    ['dentist', 'pt_dentist_recall_date'],
    ['hygienist', 'pt_hygienist_recall_date'],
  ]) {
    const dueDate = toDateOnly(row[field]);
    if (!dueDate) continue;
    const overdue = dueDate < asOf;
    const prefix = overdue ? 'recall_overdue' : 'recall_due';
    keys.push(`${prefix}:${recallType}:${ptId}:${dueDate}`);
  }
  return keys;
}

async function fetchExistingSourceRows(practiceId, entityAlias, entityIds) {
  const idField = ENTITY_ID_FIELD[entityAlias];
  const tableName = ENTITY_TABLE[entityAlias];
  const map = new Map();
  if (!idField || !tableName || entityIds.length === 0) return map;

  // Invoices store platform_invoice_id as text; query with string form.
  const queryIds =
    entityAlias === 'invoices' ? entityIds.map((id) => String(id)) : entityIds;

  let query = supabaseAdmin
    .from(tableName)
    .select('*')
    .eq('organization_id', practiceId)
    .in(idField, queryIds);

  if (entityAlias === 'invoices') {
    query = query.eq('platform_type', 'dentally');
  }
  if (entityAlias === 'patients') {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`[PE ledger] Failed to load existing ${entityAlias}: ${error.message}`);
  }

  for (const row of data || []) {
    map.set(normalizeEntityId(entityAlias, row[idField]), row);
  }
  return map;
}

async function resolvePatientMetaByPtId(practiceId, ptIds) {
  const unique = [...new Set(ptIds.filter((id) => id != null))];
  const map = new Map();
  if (unique.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('patients')
    .select('id, pt_id, location_id')
    .eq('organization_id', practiceId)
    .is('deleted_at', null)
    .in('pt_id', unique);

  if (error) {
    throw new Error(`[PE ledger] Patient meta lookup failed: ${error.message}`);
  }

  for (const row of data || []) {
    map.set(normalizeBigInt(row.pt_id), {
      id: row.id,
      location_id: row.location_id ?? null,
    });
  }
  return map;
}

/**
 * Load idempotency keys already present for this practice (for heal-on-resume).
 * Scoped by key prefixes for the entity ids in this page.
 */
async function loadExistingLedgerKeys(practiceId, candidateKeys) {
  const keys = [...new Set(candidateKeys.filter(Boolean))];
  const found = new Set();
  if (keys.length === 0) return found;

  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const { data, error } = await supabaseAdmin
      .from('event_ledger')
      .select('idempotency_key')
      .eq('practice_id', practiceId)
      .in('idempotency_key', chunk);

    if (error) {
      throw new Error(`[PE ledger] Failed to load ledger keys: ${error.message}`);
    }
    for (const row of data || []) {
      if (row.idempotency_key) found.add(row.idempotency_key);
    }
  }
  return found;
}

function candidateKeysForRows(entityAlias, rows) {
  const keys = [];
  for (const row of rows) {
    if (entityAlias === 'treatment_plans') {
      const tpId = normalizeBigInt(row.tp_id);
      if (tpId != null) {
        keys.push(`plan_created:${tpId}`);
        if (row.tp_start_date) keys.push(`treatment_started:${tpId}`);
        if (isPlanCompleted(row)) keys.push(`plan_completed:${tpId}`);
      }
    } else if (entityAlias === 'treatment_appointments') {
      const taId = normalizeBigInt(row.ta_id);
      const apptId = normalizeBigInt(row.ta_appointment_id);
      if (taId != null && apptId != null) {
        keys.push(`appointment_linked:${taId}:${apptId}`);
      }
    } else if (entityAlias === 'treatment_plan_items') {
      const tpiId = normalizeBigInt(row.tpi_id);
      if (tpiId != null && isItemCompleted(row)) {
        keys.push(`item_completed:${tpiId}`);
      }
    } else if (entityAlias === 'invoices') {
      const invoiceId = normalizeBigInt(row.platform_invoice_id);
      if (invoiceId != null) {
        keys.push(`invoice_raised:${invoiceId}`);
      }
    } else if (entityAlias === 'payments') {
      keys.push(...paymentAllocationKeys(row));
    } else if (entityAlias === 'patients') {
      const ptId = normalizeBigInt(row.pt_id);
      if (ptId != null) {
        keys.push(`patient_reactivated:${ptId}`);
        keys.push(...patientRecallKeys(row));
      }
    }
  }
  return keys;
}

async function loadLedgerExistingState(practiceId, entityAlias, rows) {
  if (!isLedgerEntity(entityAlias) || rows.length === 0) {
    return { existingByEntityId: new Map(), existingLedgerKeys: new Set() };
  }

  const idField = ENTITY_ID_FIELD[entityAlias];
  const entityIds = rows
    .map((row) => normalizeEntityId(entityAlias, row[idField]))
    .filter((id) => id != null);

  const existingByEntityId = await fetchExistingSourceRows(
    practiceId,
    entityAlias,
    entityIds,
  );
  const existingLedgerKeys = await loadExistingLedgerKeys(
    practiceId,
    candidateKeysForRows(entityAlias, rows),
  );

  return { existingByEntityId, existingLedgerKeys };
}

async function loadPlanPrivateValues(practiceId, planIds) {
  const map = new Map();
  const ids = [...new Set(planIds.filter((id) => id != null))];
  if (ids.length === 0) return map;

  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from('treatment_plans')
      .select('tp_id, tp_private_treatment_value')
      .eq('organization_id', practiceId)
      .in('tp_id', chunk);

    if (error) {
      throw new Error(`[PE ledger] Plan value lookup failed: ${error.message}`);
    }
    for (const row of data || []) {
      const tpId = normalizeBigInt(row.tp_id);
      if (tpId == null) continue;
      const v = row.tp_private_treatment_value;
      if (v == null) continue;
      const n = Number(v);
      if (Number.isFinite(n)) map.set(tpId, n);
    }
  }
  return map;
}

/**
 * Attach treatment_plans.tp_private_treatment_value onto appointment rows so
 * APPOINTMENT_LINKED payloads can carry planned_value (Journey Scheduled £).
 */
async function enrichAppointmentRowsWithPlanValue(practiceId, rows) {
  const planIds = rows.map((r) => normalizeBigInt(r.ta_treatment_plan_id));
  const values = await loadPlanPrivateValues(practiceId, planIds);
  return rows.map((row) => {
    const planId = normalizeBigInt(row.ta_treatment_plan_id);
    const planned = planId != null ? values.get(planId) : undefined;
    if (planned == null) return row;
    return {
      ...row,
      planned_value: planned,
      tp_private_treatment_value: planned,
    };
  });
}

/**
 * Diff + insert ledger events. Throws if the ledger write fails so the sync
 * chunk is not treated as successful without durable ledger rows.
 */
async function writeLedgerEventsFromUpsert({
  practiceId,
  entityAlias,
  syncRunId,
  newRows,
  existingByEntityId,
  existingLedgerKeys,
  payloadSource = 'dentally_sync',
}) {
  if (!isLedgerEntity(entityAlias) || newRows.length === 0) return { written: 0 };

  let rows = newRows;
  if (entityAlias === 'treatment_appointments') {
    rows = await enrichAppointmentRowsWithPlanValue(practiceId, newRows);
  }

  const patientField = ENTITY_PATIENT_FIELD[entityAlias];
  const idField = ENTITY_ID_FIELD[entityAlias];
  const ptIds = rows.map((row) => normalizeBigInt(row[patientField]));
  const patientMetaByPtId = await resolvePatientMetaByPtId(practiceId, ptIds);

  const inserts = [];
  let skippedNoPatient = 0;
  let orphanedNoPatient = 0;

  for (const newRow of rows) {
    const entityId = normalizeEntityId(entityAlias, newRow[idField]);
    const oldRow = existingByEntityId.get(entityId) ?? null;
    const ptId = normalizeBigInt(newRow[patientField]);
    const patientMeta = patientMetaByPtId.get(ptId);
    const patientId = patientMeta?.id;
    const binding = resolveLedgerPatientBinding(ptId, patientId);
    const locationId = resolveLedgerLocationId(entityAlias, newRow, patientMeta);

    if (binding.skip) {
      skippedNoPatient += 1;
      console.warn(
        `[PE ledger] Skip events for ${entityAlias} ${entityId}: no pt_id on source row`,
      );
      continue;
    }

    if (binding.patientMatch === 'orphan') {
      orphanedNoPatient += 1;
      console.warn(
        `[PE ledger] Orphan events for ${entityAlias} ${entityId}: no patients row for pt_id=${ptId}`,
      );
    }

    const rowEvents = diffRowEvents(
      entityAlias,
      oldRow,
      newRow,
      existingLedgerKeys,
    );
    for (const evt of rowEvents) {
      inserts.push(
        buildLedgerInsertRow({
          practiceId,
          patientId: binding.patientId,
          patientMatch: binding.patientMatch,
          ptId,
          locationId,
          evt,
          payloadSource,
          syncRunId,
        }),
      );
    }
  }

  if (inserts.length === 0) {
    return { written: 0, skippedNoPatient, orphanedNoPatient };
  }

  const { error } = await supabaseAdmin.from('event_ledger').upsert(inserts, {
    onConflict: 'practice_id,idempotency_key',
    ignoreDuplicates: true,
  });

  if (error) {
    throw new Error(`[PE ledger] Insert failed: ${error.message}`);
  }

  return { written: inserts.length, skippedNoPatient, orphanedNoPatient };
}

module.exports = {
  isLedgerEntity,
  loadLedgerExistingState,
  writeLedgerEventsFromUpsert,
  enrichAppointmentRowsWithPlanValue,
  loadExistingLedgerKeys,
  candidateKeysForRows,
  normalizeEntityId,
  resolveLedgerPatientBinding,
  resolveLedgerLocationId,
  buildLedgerInsertRow,
  resolvePatientMetaByPtId,
};
