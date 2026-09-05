/**
 * PE event_ledger hook for legacy JobQueue sync (onboarding, auto-sync, manual sync).
 *
 * Mirrors upsertPePage: prefetch source + ledger keys before upsert, write after.
 * Ledger failures are logged only — source rows are already committed.
 */

const {
  isLedgerEntity,
  loadLedgerExistingState,
  writeLedgerEventsFromUpsert,
} = require('./eventLedgerWriter');

function snapshotPaymentLedgerRows(rows) {
  return rows.map((r) => ({
    ...r,
    _explanations: Array.isArray(r._explanations) ? [...r._explanations] : [],
  }));
}

/**
 * @param {string} entityAlias
 * @param {string} practiceId
 * @param {object[]} transformedRecords
 * @returns {Promise<{ ledgerRows: object[], existingByEntityId: Map, existingLedgerKeys: Set }|null>}
 */
async function preloadLegacySyncLedgerState(entityAlias, practiceId, transformedRecords) {
  if (!isLedgerEntity(entityAlias) || transformedRecords.length === 0) {
    return null;
  }

  const ledgerRows =
    entityAlias === 'payments'
      ? snapshotPaymentLedgerRows(transformedRecords)
      : transformedRecords;

  const ledgerState = await loadLedgerExistingState(practiceId, entityAlias, ledgerRows);
  return { ledgerRows, ...ledgerState };
}

/**
 * @param {{
 *   entityAlias: string,
 *   practiceId: string,
 *   preload: { ledgerRows: object[], existingByEntityId: Map, existingLedgerKeys: Set }|null,
 *   processed: number,
 *   failed?: number,
 * }} opts
 */
async function writeLegacySyncLedgerAfterUpsert({
  entityAlias,
  practiceId,
  preload,
  processed,
  failed = 0,
}) {
  if (!preload || !(processed > 0) || failed > 0) return;

  try {
    await writeLedgerEventsFromUpsert({
      practiceId,
      entityAlias,
      syncRunId: 'legacy_sync',
      newRows: preload.ledgerRows,
      existingByEntityId: preload.existingByEntityId,
      existingLedgerKeys: preload.existingLedgerKeys,
      payloadSource: 'dentally_sync',
    });
  } catch (err) {
    console.error(
      `[PE ledger] Legacy sync ledger write failed (${entityAlias}, ` +
        `practice=${practiceId.slice(0, 8)}…): ${err.message}`,
    );
  }
}

module.exports = {
  preloadLegacySyncLedgerState,
  writeLegacySyncLedgerAfterUpsert,
};
