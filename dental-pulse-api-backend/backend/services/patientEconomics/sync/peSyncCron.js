/**
 * peSyncCron — PE Dentally sync scheduler (node-cron).
 *
 * Three schedules:
 * 1. Resume (default every 2 min) — drain in_progress / retryable cursors
 * 2. Incremental kickoff (default every 15 min) — reset cursors with lookback
 * 3. Full kickoff (default 02:00 UTC daily) — reset from PE_SYNC_*_START
 *
 * No Redis/BullMQ. Skips practices without a valid PAT (writes sync_runs skip).
 * Overlap: kickoff skips if non-stale in_progress exists for the practice.
 */

const cron = require('node-cron');
const {
  listSchedulableCursors,
  SCHEDULED_RESOURCE_TYPES,
  updateCursor,
} = require('./cursorStore');
const { getSyncFn, listRegisteredResourceTypes } = require('./resourceRegistry');
const { practiceNeedsReconnection } = require('./credentialsStatus');
const {
  runIncrementalKickoffTick,
  runFullKickoffTick,
} = require('./peScheduleKickoff');
const { recordTick } = require('./peTickHistory');

const RESUME_SCHEDULE = process.env.PE_SYNC_CRON_SCHEDULE || '*/2 * * * *';
const INCREMENTAL_SCHEDULE =
  process.env.PE_SYNC_INCREMENTAL_SCHEDULE || '*/15 * * * *';
const FULL_SCHEDULE = process.env.PE_SYNC_FULL_SCHEDULE || '0 2 * * *';
const MAX_CHUNKS_PER_TICK = Number(process.env.PE_SYNC_CRON_MAX_CHUNKS_PER_TICK || 10);
const STALE_MS = Number(process.env.PE_SYNC_IN_PROGRESS_STALE_MS || 120_000);

let resumeInFlight = false;
let kickoffInFlight = false;
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
  if (resumeInFlight) {
    console.log('[PE sync cron] Previous resume tick still running — skip');
    return { skipped: true, reason: 'in_flight' };
  }

  resumeInFlight = true;
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

    const processed = results.filter((r) => !r.skipped && !r.error).length;
    recordTick({
      kind: 'resume',
      practicesConsidered: new Set(results.map((r) => r.practiceId)).size,
      processed,
      results: results.map((r) => ({
        practiceId: r.practiceId,
        resourceType: r.resourceType,
        skipped: r.skipped === true,
        reason: r.reason || r.error || null,
        status: r.result?.cursorStatus || null,
      })),
    });

    return {
      processed,
      results,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    resumeInFlight = false;
  }
}

async function withKickoffGuard(label, fn) {
  if (kickoffInFlight) {
    console.log(`[PE sync cron] ${label} skipped — another kickoff in flight`);
    return { skipped: true, reason: 'kickoff_in_flight' };
  }
  kickoffInFlight = true;
  try {
    return await fn();
  } finally {
    kickoffInFlight = false;
  }
}

function isPeSyncCronEnabled() {
  return process.env.PE_SYNC_CRON_ENABLED === 'true';
}

function startPeSyncCron() {
  if (started) {
    console.log('[PE sync cron] Already started');
    return;
  }

  if (!isPeSyncCronEnabled()) {
    console.log(
      '[PE sync cron] Disabled — set PE_SYNC_CRON_ENABLED=true to auto-resume/kickoff. ' +
        'Inspector Sync button runs one chunk per click.'
    );
    return;
  }

  for (const [name, schedule] of [
    ['PE_SYNC_CRON_SCHEDULE', RESUME_SCHEDULE],
    ['PE_SYNC_INCREMENTAL_SCHEDULE', INCREMENTAL_SCHEDULE],
    ['PE_SYNC_FULL_SCHEDULE', FULL_SCHEDULE],
  ]) {
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid ${name}: ${schedule}`);
    }
  }

  cron.schedule(RESUME_SCHEDULE, () => {
    runPeSyncTick().catch((err) => {
      console.error('[PE sync cron] Resume tick failed:', err.message);
    });
  });

  cron.schedule(INCREMENTAL_SCHEDULE, () => {
    withKickoffGuard('Incremental kickoff', runIncrementalKickoffTick).catch((err) => {
      console.error('[PE sync cron] Incremental kickoff failed:', err.message);
    });
  });

  cron.schedule(FULL_SCHEDULE, () => {
    withKickoffGuard('Full kickoff', runFullKickoffTick).catch((err) => {
      console.error('[PE sync cron] Full kickoff failed:', err.message);
    });
  });

  started = true;
  console.log(
    `[PE sync cron] Resume "${RESUME_SCHEDULE}" | Incremental "${INCREMENTAL_SCHEDULE}" | ` +
      `Full "${FULL_SCHEDULE}" — resources: ${SCHEDULED_RESOURCE_TYPES.join(', ')}`
  );
}

module.exports = {
  isPeSyncCronEnabled,
  startPeSyncCron,
  runPeSyncTick,
  processOneCursor,
  runIncrementalKickoffTick,
  runFullKickoffTick,
};
