/**
 * PE page upsert: transform + upsert with per-record skip logging.
 * One bad record must not fail the whole chunk.
 */

const { supabaseAdmin } = require('../../../config/supabase');
const { transformRecord } = require('../../transformers/dentally');
const {
  TABLE_MAP,
  ON_CONFLICT_MAP,
  ENTITIES_NEEDING_LOCATION_MAP,
} = require('../../../api/dentally/config');
const {
  getCategoryMap,
  getLocationMap,
  getCancellationReasonMap,
  getAcquisitionSourceMap,
  upsertInvoicesWithLineItems,
  upsertPaymentsWithExplanations,
} = require('../../sync/upsert');
const { logSkippedRecords } = require('./skippedRecordStore');
const {
  isLedgerEntity,
  loadLedgerExistingState,
  writeLedgerEventsFromUpsert,
} = require('./eventLedgerWriter');

async function buildMaps(entityAlias, organizationId) {
  const maps = {
    categoryMap: new Map(),
    locationMap: new Map(),
    cancellationReasonMap: new Map(),
    acquisitionSourceMap: new Map(),
  };

  if (entityAlias === 'treatments') {
    maps.categoryMap = await getCategoryMap(organizationId);
  }
  if (ENTITIES_NEEDING_LOCATION_MAP.includes(entityAlias)) {
    maps.locationMap = await getLocationMap(organizationId);
  }
  if (entityAlias === 'appointments' || entityAlias === 'appointments_current_month') {
    maps.cancellationReasonMap = await getCancellationReasonMap(organizationId);
  }
  if (entityAlias === 'patients') {
    maps.acquisitionSourceMap = await getAcquisitionSourceMap(organizationId);
  }

  return maps;
}

async function upsertOne(tableName, onConflict, row) {
  const { error } = await supabaseAdmin.from(tableName).upsert(row, { onConflict });
  if (error) throw new Error(error.message);
}

/**
 * @returns {{ processed: number, failed: number, skipped: number }}
 */
async function upsertPeEntityPage({
  entityAlias,
  practiceId,
  userId,
  rawRecords,
  syncRunId,
  resourceType,
}) {
  const tableName = TABLE_MAP[entityAlias];
  const onConflict = ON_CONFLICT_MAP[entityAlias];
  if (!tableName || !onConflict) {
    throw new Error(`Unknown PE entity for upsert: ${entityAlias}`);
  }

  const maps = await buildMaps(entityAlias, practiceId);
  const ctx = {
    organizationId: practiceId,
    userId,
    ...maps,
  };

  const transformed = [];
  const skips = [];

  for (const record of rawRecords) {
    try {
      const row = transformRecord(entityAlias, record, ctx);
      if (!row) {
        skips.push({
          practiceId,
          syncRunId,
          resourceType,
          entityAlias,
          reason: 'transform_null',
          errorMessage: `Transformer returned null for ${entityAlias}`,
          record,
        });
        continue;
      }
      transformed.push({ row, record });
    } catch (err) {
      skips.push({
        practiceId,
        syncRunId,
        resourceType,
        entityAlias,
        reason: 'transform_error',
        errorMessage: err.message,
        record,
      });
    }
  }

  let processed = 0;
  let failed = 0;

  if (transformed.length > 0) {
    // Invoices: header + nested invoice_items (from detail enrich). Strip
    // _invoice_items and write line items via shared JobQueue helper.
    if (entityAlias === 'invoices') {
      const rows = transformed.map((t) => t.row);
      try {
        const result = await upsertInvoicesWithLineItems(
          tableName,
          onConflict,
          rows,
          practiceId,
          null
        );
        if (skips.length > 0) await logSkippedRecords(skips);
        return {
          processed: result.processed,
          failed: result.failed,
          skipped: skips.length,
        };
      } catch (err) {
        console.error(`[PE sync] Invoice upsert failed: ${err.message}`);
        for (const { record } of transformed) {
          skips.push({
            practiceId,
            syncRunId,
            resourceType,
            entityAlias,
            reason: 'upsert_error',
            errorMessage: err.message,
            record,
          });
        }
        if (skips.length > 0) await logSkippedRecords(skips);
        return { processed: 0, failed: transformed.length, skipped: skips.length };
      }
    }

    // Payments: header + nested explanations (invoice allocations).
    if (entityAlias === 'payments') {
      const rows = transformed.map((t) => t.row);
      try {
        const result = await upsertPaymentsWithExplanations(
          tableName,
          onConflict,
          rows,
          practiceId
        );
        if (skips.length > 0) await logSkippedRecords(skips);
        return {
          processed: result.processed,
          failed: result.failed,
          skipped: skips.length,
        };
      } catch (err) {
        console.error(`[PE sync] Payment upsert failed: ${err.message}`);
        for (const { record } of transformed) {
          skips.push({
            practiceId,
            syncRunId,
            resourceType,
            entityAlias,
            reason: 'upsert_error',
            errorMessage: err.message,
            record,
          });
        }
        if (skips.length > 0) await logSkippedRecords(skips);
        return { processed: 0, failed: transformed.length, skipped: skips.length };
      }
    }

    const rows = transformed.map((t) => t.row);

    const ledgerState = isLedgerEntity(entityAlias)
      ? await loadLedgerExistingState(practiceId, entityAlias, rows)
      : null;

    const { error } = await supabaseAdmin.from(tableName).upsert(rows, { onConflict });

    let upsertedRows = [];

    if (!error) {
      processed = rows.length;
      upsertedRows = rows;
    } else {
      // Fall back to individual upserts — skip only the bad ones
      console.warn(
        `[PE sync] Batch upsert failed for ${entityAlias} (${error.message}); falling back to per-record`
      );
      for (const { row, record } of transformed) {
        try {
          await upsertOne(tableName, onConflict, row);
          processed += 1;
          upsertedRows.push(row);
        } catch (err) {
          failed += 1;
          skips.push({
            practiceId,
            syncRunId,
            resourceType,
            entityAlias,
            reason: 'upsert_error',
            errorMessage: err.message,
            record,
          });
        }
      }
    }

    // Ledger write after source upsert. Failure throws → chunk is not silently
    // successful. Idempotency keys + heal-on-resume prevent duplicates/misses.
    if (ledgerState && upsertedRows.length > 0) {
      await writeLedgerEventsFromUpsert({
        practiceId,
        entityAlias,
        syncRunId,
        newRows: upsertedRows,
        existingByEntityId: ledgerState.existingByEntityId,
        existingLedgerKeys: ledgerState.existingLedgerKeys,
      });
    }
  }

  if (skips.length > 0) {
    await logSkippedRecords(skips);
  }

  return { processed, failed, skipped: skips.length };
}

module.exports = { upsertPeEntityPage };
