/**
 * Append-only PE event ledger writer.
 *
 * Called from upsertPePage after successful upserts for:
 *   syncTreatmentPlans        → treatment_plans
 *     PLAN_CREATED, TREATMENT_STARTED (tp_start_date null→set)
 *   syncTreatmentAppointments → treatment_appointments
 *     APPOINTMENT_LINKED / UNLINKED
 *
 * Diary syncAppointments is intentionally not hooked — plan link state lives on
 * treatment_appointments.ta_appointment_id (Step 1 payload contract).
 *
 * Resume / chunk safety:
 *   - Prefetch source rows before upsert (diff baseline).
 *   - Prefetch existing ledger idempotency keys (heal mid-chunk failures).
 *   - Ledger upsert on (practice_id, idempotency_key) with ignoreDuplicates.
 *   - Ledger write failures throw so the chunk is not silently marked complete.
 */

const { supabaseAdmin } = require('../../../config/supabase');
const { diffRowEvents, normalizeBigInt } = require('./eventLedgerDiff');

const LEDGER_ENTITIES = new Set(['treatment_plans', 'treatment_appointments']);

const ENTITY_ID_FIELD = {
  treatment_plans: 'tp_id',
  treatment_appointments: 'ta_id',
};

const ENTITY_PATIENT_FIELD = {
  treatment_plans: 'tp_patient_id',
  treatment_appointments: 'ta_patient_id',
};

function isLedgerEntity(entityAlias) {
  return LEDGER_ENTITIES.has(entityAlias);
}

async function fetchExistingSourceRows(practiceId, entityAlias, entityIds) {
  const idField = ENTITY_ID_FIELD[entityAlias];
  const map = new Map();
  if (!idField || entityIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from(entityAlias)
    .select('*')
    .eq('organization_id', practiceId)
    .in(idField, entityIds);

  if (error) {
    throw new Error(`[PE ledger] Failed to load existing ${entityAlias}: ${error.message}`);
  }

  for (const row of data || []) {
    map.set(normalizeBigInt(row[idField]), row);
  }
  return map;
}

async function resolvePatientUuidMap(practiceId, ptIds) {
  const unique = [...new Set(ptIds.filter((id) => id != null))];
  const map = new Map();
  if (unique.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('patients')
    .select('id, pt_id')
    .eq('organization_id', practiceId)
    .is('deleted_at', null)
    .in('pt_id', unique);

  if (error) {
    throw new Error(`[PE ledger] Patient UUID lookup failed: ${error.message}`);
  }

  for (const row of data || []) {
    map.set(normalizeBigInt(row.pt_id), row.id);
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
      }
    } else if (entityAlias === 'treatment_appointments') {
      const taId = normalizeBigInt(row.ta_id);
      const apptId = normalizeBigInt(row.ta_appointment_id);
      if (taId != null && apptId != null) {
        keys.push(`appointment_linked:${taId}:${apptId}`);
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
    .map((row) => normalizeBigInt(row[idField]))
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
}) {
  if (!isLedgerEntity(entityAlias) || newRows.length === 0) return { written: 0 };

  const patientField = ENTITY_PATIENT_FIELD[entityAlias];
  const idField = ENTITY_ID_FIELD[entityAlias];
  const ptIds = newRows.map((row) => normalizeBigInt(row[patientField]));
  const patientUuidByPtId = await resolvePatientUuidMap(practiceId, ptIds);

  const inserts = [];
  let skippedNoPatient = 0;

  for (const newRow of newRows) {
    const entityId = normalizeBigInt(newRow[idField]);
    const oldRow = existingByEntityId.get(entityId) ?? null;
    const ptId = normalizeBigInt(newRow[patientField]);
    const patientId = patientUuidByPtId.get(ptId);

    if (!patientId) {
      skippedNoPatient += 1;
      console.warn(
        `[PE ledger] Skip events for ${entityAlias} ${entityId}: no patients row for pt_id=${ptId}`,
      );
      continue;
    }

    const rowEvents = diffRowEvents(
      entityAlias,
      oldRow,
      newRow,
      existingLedgerKeys,
    );
    for (const evt of rowEvents) {
      inserts.push({
        practice_id: practiceId,
        patient_id: patientId,
        event_type: evt.event_type,
        payload: {
          ...evt.payload,
          source: 'dentally_sync',
          sync_run_id: syncRunId ?? null,
        },
        created_at: evt.created_at,
        idempotency_key: evt.idempotency_key,
      });
    }
  }

  if (inserts.length === 0) {
    return { written: 0, skippedNoPatient };
  }

  const { error } = await supabaseAdmin.from('event_ledger').upsert(inserts, {
    onConflict: 'practice_id,idempotency_key',
    ignoreDuplicates: true,
  });

  if (error) {
    throw new Error(`[PE ledger] Insert failed: ${error.message}`);
  }

  return { written: inserts.length, skippedNoPatient };
}

module.exports = {
  isLedgerEntity,
  loadLedgerExistingState,
  writeLedgerEventsFromUpsert,
};
