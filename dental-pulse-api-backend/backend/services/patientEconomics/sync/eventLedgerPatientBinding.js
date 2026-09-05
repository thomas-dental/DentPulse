/**
 * Pure helpers for binding Dentally pt_id → event_ledger patient_id on write.
 */

function resolveLedgerPatientBinding(ptId, patientId) {
  if (ptId == null) {
    return { skip: true, reason: 'no_pt_id' };
  }
  if (patientId) {
    return { skip: false, patientId, patientMatch: 'matched' };
  }
  return { skip: false, patientId: null, patientMatch: 'orphan' };
}

function resolveLedgerLocationId(entityAlias, sourceRow, patientMeta) {
  if (entityAlias === 'patients' && sourceRow?.location_id) {
    return sourceRow.location_id;
  }
  if (entityAlias === 'invoices' && sourceRow?.location_id) {
    return sourceRow.location_id;
  }
  if (patientMeta?.location_id) {
    return patientMeta.location_id;
  }
  return null;
}

function buildLedgerInsertRow({
  practiceId,
  patientId,
  patientMatch,
  ptId,
  locationId,
  evt,
  payloadSource,
  syncRunId,
}) {
  return {
    practice_id: practiceId,
    patient_id: patientId,
    location_id: locationId ?? null,
    event_type: evt.event_type,
    payload: {
      ...evt.payload,
      pt_id: ptId,
      patient_id: patientId,
      location_id: locationId ?? null,
      patient_match: patientMatch,
      source: payloadSource,
      sync_run_id: syncRunId ?? null,
    },
    created_at: evt.created_at,
    idempotency_key: evt.idempotency_key,
  };
}

module.exports = {
  resolveLedgerPatientBinding,
  resolveLedgerLocationId,
  buildLedgerInsertRow,
};
