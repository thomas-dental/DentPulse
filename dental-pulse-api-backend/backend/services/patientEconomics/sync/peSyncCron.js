/**
 * peSyncCron — resume PE Dentally syncs that are in_progress or retryable.
 *
 * Uses node-cron (same pattern as autoSyncCron / cashflowThresholdCron).
 * No Redis/BullMQ — polls sync_cursors and re-invokes the registered sync
 * function for each due row (one chunk per invocation).
 *
 * Skips practices with integrations.needs_reconnection = true.
 */

const cron = require('node-cron');
const {
  listSchedulableCursors,
  SCHEDULED_RESOURCE_TYPES,
  updateCursor,
} = require('./cursorStore');
const { getSyncFn, listRegisteredResourceTypes } = require('./resourceRegistry');
const { practiceNeedsReconnection } = require('./credentialsStatus');

const SCHEDULE = process.env.PE_SYNC_CRON_SCHEDULE || '*/2 * * * *';
const MAX_CHUNKS_PER_TICK = Number(process.env.PE_SYNC_CRON_MAX_CHUNKS_PER_TICK || 10);
const STALE_MS = Number(process.env.PE_SYNC_IN_PROGRESS_STALE_MS || 120_000);

let tickInFlight = false;
let started = false;

async function processOneCursor(row) {
  const practiceId = row.practice_id;
  const resourceType = row.resource_type;
  const syncFn = getSyncFn(resourceType);

  if (!syncFn) {
    console.warn(`[PE sync cron] No sync fn registered for resource_type=${resourceType}`);
    return { skipped: true, reason: 'unregistered' };
  }

  if (await practiceNeedsReconnection(practiceId)) {
    console.log(
      `[PE sync cron] Skip ${resourceType} for ${practiceId.slice(0, 8)}… — PAT needs reconnection`
    );
    return { skipped: true, reason: 'needs_reconnection' };
  }

  // Claim retryable → in_progress so overlapping ticks don't double-run
  if (row.status === 'retryable') {
    await updateCursor(practiceId, resourceType, { status: 'in_progress' });
  } else {
    // Touch updated_at so other ticks won't re-pick this stale in_progress immediately
    await updateCursor(practiceId, resourceType, {});
  }

  const result = await syncFn(practiceId);
  console.log(
    `[PE sync cron] ${resourceType} practice=${practiceId.slice(0, 8)}… ` +
      `success=${result.success} status=${result.cursorStatus} ` +
      `page=${result.page} autoRetry=${result.autoRetry === true}`
  );
  return { skipped: false, result };
}

async function runPeSyncTick() {
  if (tickInFlight) {
    console.log('[PE sync cron] Previous tick still running — skip');
    return { skipped: true, reason: 'in_flight' };
  }

  tickInFlight = true;
  const startedAt = Date.now();
  try {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const staleBeforeIso = new Date(now - STALE_MS).toISOString();
    const resourceTypes = listRegisteredResourceTypes();

    const due = await listSchedulableCursors({
      staleBeforeIso,
      nowIso,
      resourceTypes,
      limit: MAX_CHUNKS_PER_TICK,
    });

    if (due.length === 0) {
      return { processed: 0, results: [] };
    }

    console.log(`[PE sync cron] ${due.length} cursor(s) due`);
    const results = [];
    for (const row of due) {
      try {
        results.push({
          practiceId: row.practice_id,
          resourceType: row.resource_type,
          ...(await processOneCursor(row)),
        });
      } catch (err) {
        console.error(
          `[PE sync cron] Error on ${row.resource_type}/${row.practice_id}:`,
          err.message
        );
        results.push({
          practiceId: row.practice_id,
          resourceType: row.resource_type,
          error: err.message,
        });
      }
    }

    return {
      processed: results.filter((r) => !r.skipped).length,
      results,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    tickInFlight = false;
  }
}

function startPeSyncCron() {
  if (started) {
    console.log('[PE sync cron] Already started');
    return;
  }
  if (!cron.validate(SCHEDULE)) {
    throw new Error(`Invalid PE_SYNC_CRON_SCHEDULE: ${SCHEDULE}`);
  }

  cron.schedule(SCHEDULE, () => {
    runPeSyncTick().catch((err) => {
      console.error('[PE sync cron] Tick failed:', err.message);
    });
  });

  started = true;
  console.log(
    `[PE sync cron] Scheduled "${SCHEDULE}" — resources: ${SCHEDULED_RESOURCE_TYPES.join(', ')}`
  );
}

module.exports = {
  startPeSyncCron,
  runPeSyncTick,
  processOneCursor,
};
