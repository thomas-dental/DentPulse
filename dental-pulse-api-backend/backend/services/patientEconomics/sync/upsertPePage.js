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
} = require('../../sync/upsert');
const { logSkippedRecords } = require('./skippedRecordStore');

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
    const rows = transformed.map((t) => t.row);
    const { error } = await supabaseAdmin.from(tableName).upsert(rows, { onConflict });

    if (!error) {
      processed = rows.length;
    } else {
      // Fall back to individual upserts — skip only the bad ones
      console.warn(
        `[PE sync] Batch upsert failed for ${entityAlias} (${error.message}); falling back to per-record`
      );
      for (const { row, record } of transformed) {
        try {
          await upsertOne(tableName, onConflict, row);
          processed += 1;
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
  }

  if (skips.length > 0) {
    await logSkippedRecords(skips);
  }

  return { processed, failed, skipped: skips.length };
}

module.exports = { upsertPeEntityPage };
