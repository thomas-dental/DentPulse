/**
 * Pure diff logic for PE Event Ledger transitions (no DB dependencies).
 * Used by eventLedgerWriter during sync upserts and by unit tests.
 *
 * Resume-safe: pass `existingLedgerKeys` (Set of idempotency keys already in
 * event_ledger). If the source row was upserted but the ledger write failed
 * mid-chunk, a resumed sync still emits the missing key; the writer upserts
 * with ignoreDuplicates so successful prior writes are not duplicated.
 */

function normalizeBigInt(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toEventTimestamp(value, fallback) {
  if (value) return value;
  return fallback || new Date().toISOString();
}

/**
 * @param {object|null} oldRow
 * @param {object} newRow
 * @param {Set<string>|null} [existingLedgerKeys]
 * @returns {object[]}
 */
function diffTreatmentPlanEvents(oldRow, newRow, existingLedgerKeys = null) {
  const events = [];
  const tpId = normalizeBigInt(newRow.tp_id);
  if (tpId == null) return events;

  const planCreatedKey = `plan_created:${tpId}`;
  const treatmentStartedKey = `treatment_started:${tpId}`;
  const basePayload = {
    source_record_id: String(tpId),
    source_table: 'treatment_plans',
    tp_id: tpId,
    plan_id: tpId,
    tp_nickname: newRow.tp_nickname ?? null,
    tp_private_treatment_value: newRow.tp_private_treatment_value ?? null,
    planned_value: newRow.tp_private_treatment_value ?? null,
    tp_patient_id: normalizeBigInt(newRow.tp_patient_id),
  };

  const isNew = !oldRow;
  const needsHeal =
    existingLedgerKeys instanceof Set && !existingLedgerKeys.has(planCreatedKey);

  if (isNew || needsHeal) {
    events.push({
      event_type: 'PLAN_CREATED',
      created_at: toEventTimestamp(newRow.tp_created_at, newRow.created_at),
      idempotency_key: planCreatedKey,
      payload: { ...basePayload, tp_created_at: newRow.tp_created_at ?? null },
    });
  }

  // Observable Dentally start_date → tp_start_date (not presented/accepted/committed).
  const oldStart = oldRow?.tp_start_date || null;
  const newStart = newRow.tp_start_date || null;
  const startedTransition = !oldStart && !!newStart;
  const startedHeal =
    !!newStart &&
    existingLedgerKeys instanceof Set &&
    !existingLedgerKeys.has(treatmentStartedKey);

  if (startedTransition || startedHeal) {
    events.push({
      event_type: 'TREATMENT_STARTED',
      created_at: toEventTimestamp(newStart, newRow.tp_updated_at || newRow.updated_at),
      idempotency_key: treatmentStartedKey,
      payload: {
        ...basePayload,
        start_date: newStart,
        tp_start_date: newStart,
      },
    });
  }

  return events;
}

/**
 * APPOINTMENT_LINKED / UNLINKED from treatment_appointments.ta_appointment_id.
 *
 * @param {object|null} oldRow
 * @param {object} newRow
 * @param {Set<string>|null} [existingLedgerKeys]
 * @returns {object[]}
 */
function diffTreatmentAppointmentEvents(oldRow, newRow, existingLedgerKeys = null) {
  const events = [];
  const taId = normalizeBigInt(newRow.ta_id);
  if (taId == null) return events;

  const oldApptId = normalizeBigInt(oldRow?.ta_appointment_id);
  const newApptId = normalizeBigInt(newRow.ta_appointment_id);

  const basePayload = {
    source_record_id: String(taId),
    source_table: 'treatment_appointments',
    ta_id: taId,
    ta_patient_id: normalizeBigInt(newRow.ta_patient_id),
    ta_treatment_plan_id: normalizeBigInt(newRow.ta_treatment_plan_id),
    plan_id: normalizeBigInt(newRow.ta_treatment_plan_id),
    previous_ta_appointment_id: oldApptId,
  };

  const eventTime = toEventTimestamp(newRow.ta_updated_at, newRow.updated_at);

  const linkedKey = (apptId) => `appointment_linked:${taId}:${apptId}`;
  const unlinkedKey = (apptId) => `appointment_unlinked:${taId}:${apptId}`;

  if (oldApptId === newApptId) {
    // Unchanged — heal missing LINKED after mid-chunk ledger failure.
    if (
      newApptId != null &&
      existingLedgerKeys instanceof Set &&
      !existingLedgerKeys.has(linkedKey(newApptId))
    ) {
      events.push({
        event_type: 'APPOINTMENT_LINKED',
        created_at: eventTime,
        idempotency_key: linkedKey(newApptId),
        payload: {
          ...basePayload,
          ta_appointment_id: newApptId,
          appointment_id: newApptId,
        },
      });
    }
    return events;
  }

  if (oldApptId == null && newApptId != null) {
    events.push({
      event_type: 'APPOINTMENT_LINKED',
      created_at: eventTime,
      idempotency_key: linkedKey(newApptId),
      payload: {
        ...basePayload,
        ta_appointment_id: newApptId,
        appointment_id: newApptId,
      },
    });
  } else if (oldApptId != null && newApptId == null) {
    events.push({
      event_type: 'APPOINTMENT_UNLINKED',
      created_at: eventTime,
      idempotency_key: unlinkedKey(oldApptId),
      payload: {
        ...basePayload,
        ta_appointment_id: null,
        appointment_id: null,
        previous_ta_appointment_id: oldApptId,
      },
    });
  } else if (oldApptId != null && newApptId != null) {
    events.push({
      event_type: 'APPOINTMENT_UNLINKED',
      created_at: eventTime,
      idempotency_key: unlinkedKey(oldApptId),
      payload: {
        ...basePayload,
        ta_appointment_id: null,
        appointment_id: null,
        previous_ta_appointment_id: oldApptId,
      },
    });
    events.push({
      event_type: 'APPOINTMENT_LINKED',
      created_at: eventTime,
      idempotency_key: linkedKey(newApptId),
      payload: {
        ...basePayload,
        ta_appointment_id: newApptId,
        appointment_id: newApptId,
        previous_ta_appointment_id: oldApptId,
      },
    });
  }

  return events;
}

function diffRowEvents(entityAlias, oldRow, newRow, existingLedgerKeys = null) {
  if (entityAlias === 'treatment_plans') {
    return diffTreatmentPlanEvents(oldRow, newRow, existingLedgerKeys);
  }
  if (entityAlias === 'treatment_appointments') {
    return diffTreatmentAppointmentEvents(oldRow, newRow, existingLedgerKeys);
  }
  return [];
}

module.exports = {
  diffTreatmentPlanEvents,
  diffTreatmentAppointmentEvents,
  diffRowEvents,
  normalizeBigInt,
};
