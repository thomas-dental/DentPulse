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

function isPlanCompleted(row) {
  return !!(row?.tp_completed_at || row?.tp_is_completed);
}

function isItemCompleted(row) {
  return !!(row?.tpi_completed || row?.tpi_completed_at);
}

/** YYYY-MM-DD in UTC (for recall due vs overdue). */
function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Normalize Dentally date / timestamp to YYYY-MM-DD. */
function toDateOnly(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
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
  const planCompletedKey = `plan_completed:${tpId}`;
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

  // Dentally completed_at → tp_completed_at / tp_is_completed.
  const wasCompleted = isPlanCompleted(oldRow);
  const nowCompleted = isPlanCompleted(newRow);
  const completedTransition = !wasCompleted && nowCompleted;
  const completedHeal =
    nowCompleted &&
    existingLedgerKeys instanceof Set &&
    !existingLedgerKeys.has(planCompletedKey);

  if (completedTransition || completedHeal) {
    const completedAt = newRow.tp_completed_at || null;
    events.push({
      event_type: 'PLAN_COMPLETED',
      created_at: toEventTimestamp(
        completedAt,
        newRow.tp_updated_at || newRow.updated_at,
      ),
      idempotency_key: planCompletedKey,
      payload: {
        ...basePayload,
        completed_at: completedAt,
        tp_completed_at: completedAt,
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

/**
 * ITEM_COMPLETED from treatment_plan_items.tpi_completed / tpi_completed_at.
 *
 * @param {object|null} oldRow
 * @param {object} newRow
 * @param {Set<string>|null} [existingLedgerKeys]
 * @returns {object[]}
 */
function diffTreatmentItemEvents(oldRow, newRow, existingLedgerKeys = null) {
  const events = [];
  const tpiId = normalizeBigInt(newRow.tpi_id);
  if (tpiId == null) return events;

  const itemCompletedKey = `item_completed:${tpiId}`;
  const planId = normalizeBigInt(newRow.tpi_treatment_plan_id);
  const completedAt = newRow.tpi_completed_at || null;
  const basePayload = {
    source_record_id: String(tpiId),
    source_table: 'treatment_plan_items',
    treatment_item_id: tpiId,
    tpi_id: tpiId,
    plan_id: planId,
    tpi_treatment_plan_id: planId,
    tpi_patient_id: normalizeBigInt(newRow.tpi_patient_id),
    value: newRow.tpi_price ?? null,
    completed_at: completedAt,
    completed_date: completedAt,
  };

  const wasCompleted = isItemCompleted(oldRow);
  const nowCompleted = isItemCompleted(newRow);
  const completedTransition = !wasCompleted && nowCompleted;
  const completedHeal =
    nowCompleted &&
    existingLedgerKeys instanceof Set &&
    !existingLedgerKeys.has(itemCompletedKey);

  if (completedTransition || completedHeal) {
    events.push({
      event_type: 'ITEM_COMPLETED',
      created_at: toEventTimestamp(
        completedAt,
        newRow.tpi_updated_at || newRow.updated_at,
      ),
      idempotency_key: itemCompletedKey,
      payload: basePayload,
    });
  }

  return events;
}

/**
 * INVOICE_RAISED on first insert of a platform invoice (or heal if ledger key missing).
 *
 * @param {object|null} oldRow
 * @param {object} newRow
 * @param {Set<string>|null} [existingLedgerKeys]
 * @returns {object[]}
 */
function diffInvoiceEvents(oldRow, newRow, existingLedgerKeys = null) {
  const events = [];
  const invoiceId = normalizeBigInt(newRow.platform_invoice_id);
  if (invoiceId == null) return events;

  const invoiceRaisedKey = `invoice_raised:${invoiceId}`;
  const amount = newRow.subtotal ?? null;
  const raisedAt = newRow.invoice_date || newRow.api_record_created_at || null;

  const isNew = !oldRow;
  const needsHeal =
    existingLedgerKeys instanceof Set && !existingLedgerKeys.has(invoiceRaisedKey);

  if (isNew || needsHeal) {
    events.push({
      event_type: 'INVOICE_RAISED',
      created_at: toEventTimestamp(
        raisedAt,
        newRow.api_record_created_at || newRow.created_at,
      ),
      idempotency_key: invoiceRaisedKey,
      payload: {
        source_record_id: String(invoiceId),
        source_table: 'platform_integration_invoices',
        invoice_id: invoiceId,
        platform_invoice_id: String(invoiceId),
        amount,
        total: amount,
        raised_at: raisedAt,
        invoice_date: newRow.invoice_date ?? null,
        patient_id: normalizeBigInt(newRow.patient_id),
      },
    });
  }

  return events;
}

/**
 * PAYMENT_ALLOCATED — payment explanation with invoice_id (allocation to invoice).
 * One event per (payment, invoice). Heal when key missing.
 *
 * @param {object|null} oldRow
 * @param {object} newRow — may include `_explanations` (pre-upsert snapshot)
 * @param {Set<string>|null} [existingLedgerKeys]
 * @returns {object[]}
 */
function diffPaymentEvents(oldRow, newRow, existingLedgerKeys = null) {
  const events = [];
  const dpId = normalizeBigInt(newRow.dp_id);
  if (dpId == null) return events;

  const explanations = Array.isArray(newRow._explanations) ? newRow._explanations : [];
  const seenInvoices = new Set();

  for (const exp of explanations) {
    const invoiceId = normalizeBigInt(exp?.invoice_id);
    if (invoiceId == null || seenInvoices.has(invoiceId)) continue;
    seenInvoices.add(invoiceId);

    const key = `payment_allocated:${dpId}:${invoiceId}`;
    const isNew = !oldRow;
    const needsHeal =
      existingLedgerKeys instanceof Set && !existingLedgerKeys.has(key);

    if (!isNew && !needsHeal) continue;

    const expAmount =
      exp.amount != null && exp.amount !== ''
        ? parseFloat(exp.amount)
        : null;
    const amount = Number.isFinite(expAmount) ? expAmount : (newRow.dp_amount ?? null);
    const allocatedAt = newRow.dp_dated_on || null;

    events.push({
      event_type: 'PAYMENT_ALLOCATED',
      created_at: toEventTimestamp(allocatedAt, newRow.created_at),
      idempotency_key: key,
      payload: {
        source_record_id: String(dpId),
        source_table: 'dentally_payments',
        payment_id: dpId,
        dp_id: dpId,
        invoice_id: invoiceId,
        amount,
        allocated_at: allocatedAt,
        payment_date: allocatedAt,
        dp_patient_id: normalizeBigInt(newRow.dp_patient_id),
      },
    });
  }

  return events;
}

/**
 * Emit RECALL_DUE or RECALL_OVERDUE for one recall type/date on a patient.
 * Dentally has no recall status — overdue = due_date < asOfDate (UTC day).
 */
function pushRecallEvent(
  events,
  {
    ptId,
    recallType,
    dueDate,
    asOfDate,
    existingLedgerKeys,
    recallMethod,
    eventTime,
  },
) {
  if (!dueDate) return;

  const overdue = dueDate < asOfDate;
  const eventType = overdue ? 'RECALL_OVERDUE' : 'RECALL_DUE';
  const keyPrefix = overdue ? 'recall_overdue' : 'recall_due';
  const key = `${keyPrefix}:${recallType}:${ptId}:${dueDate}`;

  // Heal pattern: skip when key already present in the prefetch Set.
  if (existingLedgerKeys instanceof Set && existingLedgerKeys.has(key)) {
    return;
  }

  const recallId = `${ptId}:${recallType}`;
  events.push({
    event_type: eventType,
    created_at: eventTime,
    idempotency_key: key,
    payload: {
      source_record_id: String(ptId),
      source_table: 'patients',
      recall_id: recallId,
      recall_type: recallType,
      due_date: dueDate,
      overdue_as_of: overdue ? asOfDate : null,
      pt_id: ptId,
      recall_method: recallMethod ?? null,
    },
  });
}

/**
 * PATIENT_REACTIVATED + RECALL_DUE / RECALL_OVERDUE from patients rows.
 * Used by patients sync and recalls sync (both entityAlias: patients).
 *
 * @param {object|null} oldRow
 * @param {object} newRow
 * @param {Set<string>|null} [existingLedgerKeys]
 * @param {string} [asOfDate] YYYY-MM-DD UTC; defaults to today
 * @returns {object[]}
 */
function diffPatientEvents(
  oldRow,
  newRow,
  existingLedgerKeys = null,
  asOfDate = todayUtcDate(),
) {
  const events = [];
  const ptId = normalizeBigInt(newRow.pt_id);
  if (ptId == null) return events;

  const asOf = toDateOnly(asOfDate) || todayUtcDate();
  const eventTime = toEventTimestamp(newRow.pt_updated_at, newRow.updated_at);
  const recallMethod = newRow.pt_recall_method ?? null;

  // PATIENT_REACTIVATED — is_active false → true only (no durable heal).
  const wasInactive = oldRow != null && oldRow.is_active === false;
  const nowActive = newRow.is_active !== false;
  if (wasInactive && nowActive) {
    const key = `patient_reactivated:${ptId}`;
    const already =
      existingLedgerKeys instanceof Set && existingLedgerKeys.has(key);
    if (!already) {
      events.push({
        event_type: 'PATIENT_REACTIVATED',
        created_at: eventTime,
        idempotency_key: key,
        payload: {
          source_record_id: String(ptId),
          source_table: 'patients',
          pt_id: ptId,
          reactivated_at: eventTime,
          prior_inactive_since: null,
        },
      });
    }
  }

  pushRecallEvent(events, {
    ptId,
    recallType: 'dentist',
    dueDate: toDateOnly(newRow.pt_dentist_recall_date),
    asOfDate: asOf,
    existingLedgerKeys,
    recallMethod,
    eventTime,
  });
  pushRecallEvent(events, {
    ptId,
    recallType: 'hygienist',
    dueDate: toDateOnly(newRow.pt_hygienist_recall_date),
    asOfDate: asOf,
    existingLedgerKeys,
    recallMethod,
    eventTime,
  });

  return events;
}

function diffRowEvents(
  entityAlias,
  oldRow,
  newRow,
  existingLedgerKeys = null,
  asOfDate = null,
) {
  if (entityAlias === 'treatment_plans') {
    return diffTreatmentPlanEvents(oldRow, newRow, existingLedgerKeys);
  }
  if (entityAlias === 'treatment_appointments') {
    return diffTreatmentAppointmentEvents(oldRow, newRow, existingLedgerKeys);
  }
  if (entityAlias === 'treatment_plan_items') {
    return diffTreatmentItemEvents(oldRow, newRow, existingLedgerKeys);
  }
  if (entityAlias === 'invoices') {
    return diffInvoiceEvents(oldRow, newRow, existingLedgerKeys);
  }
  if (entityAlias === 'payments') {
    return diffPaymentEvents(oldRow, newRow, existingLedgerKeys);
  }
  if (entityAlias === 'patients') {
    return diffPatientEvents(
      oldRow,
      newRow,
      existingLedgerKeys,
      asOfDate || todayUtcDate(),
    );
  }
  return [];
}

module.exports = {
  diffTreatmentPlanEvents,
  diffTreatmentAppointmentEvents,
  diffTreatmentItemEvents,
  diffInvoiceEvents,
  diffPaymentEvents,
  diffPatientEvents,
  diffRowEvents,
  normalizeBigInt,
  isPlanCompleted,
  isItemCompleted,
  todayUtcDate,
  toDateOnly,
};
