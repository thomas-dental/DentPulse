/**
 * Reviewable log of records skipped during PE sync (transform / upsert).
 */

const { supabaseAdmin } = require('../../../config/supabase');

const MAX_SNAPSHOT_CHARS = 4000;

function truncateSnapshot(record) {
  if (record == null) return null;
  try {
    const json = JSON.stringify(record);
    if (json.length <= MAX_SNAPSHOT_CHARS) return record;
    return { _truncated: true, preview: json.slice(0, MAX_SNAPSHOT_CHARS) };
  } catch {
    return { _truncated: true, preview: String(record).slice(0, 500) };
  }
}

function extractExternalId(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.id != null) return String(record.id);
  if (record.uuid != null) return String(record.uuid);
  if (record.external_id != null) return String(record.external_id);
  return null;
}

/**
 * @param {object} entry
 * @param {string} entry.practiceId
 * @param {string|null} entry.syncRunId
 * @param {string} entry.resourceType
 * @param {string} entry.entityAlias
 * @param {string} entry.reason
 * @param {string} [entry.errorMessage]
 * @param {object} [entry.record]
 * @param {string|null} [entry.externalId]
 */
async function logSkippedRecord(entry) {
  const row = {
    practice_id: entry.practiceId,
    sync_run_id: entry.syncRunId || null,
    resource_type: entry.resourceType,
    entity_alias: entry.entityAlias,
    external_id: entry.externalId != null ? entry.externalId : extractExternalId(entry.record),
    reason: entry.reason,
    error_message: entry.errorMessage || null,
    record_snapshot: truncateSnapshot(entry.record),
  };

  const { error } = await supabaseAdmin.from('sync_skipped_records').insert(row);
  if (error) {
    console.error('[PE sync] Failed to log skipped record:', error.message);
  }
}

/**
 * @param {Array<object>} entries — same shape as logSkippedRecord
 */
async function logSkippedRecords(entries) {
  if (!entries || entries.length === 0) return;

  const rows = entries.map((entry) => ({
    practice_id: entry.practiceId,
    sync_run_id: entry.syncRunId || null,
    resource_type: entry.resourceType,
    entity_alias: entry.entityAlias,
    external_id: entry.externalId != null ? entry.externalId : extractExternalId(entry.record),
    reason: entry.reason,
    error_message: entry.errorMessage || null,
    record_snapshot: truncateSnapshot(entry.record),
  }));

  const { error } = await supabaseAdmin.from('sync_skipped_records').insert(rows);
  if (error) {
    console.error(`[PE sync] Failed to log ${rows.length} skipped records:`, error.message);
    // Fall back to one-by-one so a single bad snapshot doesn't drop the batch
    for (const entry of entries) {
      await logSkippedRecord(entry);
    }
  }
}

module.exports = {
  logSkippedRecord,
  logSkippedRecords,
  extractExternalId,
  truncateSnapshot,
};
