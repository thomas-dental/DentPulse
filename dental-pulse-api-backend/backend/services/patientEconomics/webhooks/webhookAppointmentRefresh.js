/**
 * Fast-path Supabase RPCs for Dentally appointment webhooks.
 */

const { supabaseAdmin } = require('../../../config/supabase');
const { normalizeBigInt } = require('../sync/eventLedgerDiff');
const { candidateKeysForRows } = require('../sync/eventLedgerWriter');

/**
 * @param {string} practiceId
 * @param {number} appointmentId
 * @param {number|null} patientId
 * @returns {Promise<number[]>}
 */
async function discoverTreatmentAppointmentIdsRpc(practiceId, appointmentId, patientId) {
  const { data, error } = await supabaseAdmin.rpc('pe_webhook_discover_ta_ids', {
    p_practice_id: practiceId,
    p_appointment_id: appointmentId,
    p_patient_id: patientId ?? null,
  });

  if (error) {
    throw new Error(`pe_webhook_discover_ta_ids: ${error.message}`);
  }

  if (!Array.isArray(data)) return [];
  return data
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * Load existing TA rows + ledger idempotency keys in one RPC, then merge
 * candidate keys from new rows (second small query if needed).
 *
 * @param {string} practiceId
 * @param {object[]} newRows — transformed treatment_appointments rows
 * @returns {Promise<{ existingByEntityId: Map<number, object>, existingLedgerKeys: Set<string> }>}
 */
async function loadTreatmentAppointmentLedgerPrefetchRpc(practiceId, newRows) {
  const taIds = newRows
    .map((row) => normalizeBigInt(row.ta_id))
    .filter((id) => id != null);

  if (taIds.length === 0) {
    return { existingByEntityId: new Map(), existingLedgerKeys: new Set() };
  }

  const { data, error } = await supabaseAdmin.rpc('pe_webhook_ta_ledger_prefetch', {
    p_practice_id: practiceId,
    p_ta_ids: taIds,
  });

  if (error) {
    throw new Error(`pe_webhook_ta_ledger_prefetch: ${error.message}`);
  }

  const payload = data && typeof data === 'object' ? data : {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const ledgerKeysFromRpc = Array.isArray(payload.ledger_keys) ? payload.ledger_keys : [];

  const existingByEntityId = new Map();
  for (const row of rows) {
    const taId = normalizeBigInt(row.ta_id);
    if (taId != null) existingByEntityId.set(taId, row);
  }

  const existingLedgerKeys = new Set(
    ledgerKeysFromRpc.filter((key) => typeof key === 'string' && key.length > 0),
  );

  const candidateKeys = candidateKeysForRows('treatment_appointments', newRows);
  const keysToLookup = candidateKeys.filter((key) => !existingLedgerKeys.has(key));

  for (let i = 0; i < keysToLookup.length; i += 200) {
    const chunk = keysToLookup.slice(i, i + 200);
    if (chunk.length === 0) continue;

    const { data: keyRows, error: keyError } = await supabaseAdmin
      .from('event_ledger')
      .select('idempotency_key')
      .eq('practice_id', practiceId)
      .in('idempotency_key', chunk);

    if (keyError) {
      throw new Error(`[PE ledger] Failed to load ledger keys: ${keyError.message}`);
    }

    for (const row of keyRows || []) {
      if (row.idempotency_key) existingLedgerKeys.add(row.idempotency_key);
    }
  }

  return { existingByEntityId, existingLedgerKeys };
}

module.exports = {
  discoverTreatmentAppointmentIdsRpc,
  loadTreatmentAppointmentLedgerPrefetchRpc,
};
