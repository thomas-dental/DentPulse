/**
 * Backfill event_ledger.location_id from patients (matched + orphan payload pt_id).
 */

const { supabaseAdmin } = require('../../../config/supabase');

async function backfillEventLedgerLocationBatch(practiceId, batchSize = 5000) {
  const { data, error } = await supabaseAdmin.rpc('pe_event_ledger_backfill_location_batch', {
    p_practice_id: practiceId,
    p_batch_size: batchSize,
  });

  if (error) {
    throw new Error(`pe_event_ledger_backfill_location_batch: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    matchedUpdated: Number(row?.matched_updated ?? 0),
    orphanUpdated: Number(row?.orphan_updated ?? 0),
  };
}

async function backfillEventLedgerLocation(practiceId = null, options = {}) {
  if (!practiceId) {
    const { data, error } = await supabaseAdmin.rpc('pe_event_ledger_backfill_location', {
      p_practice_id: null,
    });
    if (error) {
      throw new Error(`pe_event_ledger_backfill_location: ${error.message}`);
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      matchedUpdated: Number(row?.matched_updated ?? 0),
      orphanUpdated: Number(row?.orphan_updated ?? 0),
      batches: 1,
    };
  }

  const batchSize = options.batchSize ?? 500;
  const maxBatches = options.maxBatches ?? 500;
  let matchedUpdated = 0;
  let orphanUpdated = 0;
  let batches = 0;

  for (let i = 0; i < maxBatches; i++) {
    const result = await backfillEventLedgerLocationBatch(practiceId, batchSize);
    matchedUpdated += result.matchedUpdated;
    orphanUpdated += result.orphanUpdated;
    batches += 1;
    if (result.matchedUpdated === 0 && result.orphanUpdated === 0) break;
  }

  return { matchedUpdated, orphanUpdated, batches };
}

module.exports = {
  backfillEventLedgerLocation,
  backfillEventLedgerLocationBatch,
};
