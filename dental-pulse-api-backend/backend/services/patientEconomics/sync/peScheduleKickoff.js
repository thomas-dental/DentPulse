/**
 * peScheduleKickoff — start incremental (lookback) or full (historical) PE syncs
 * by resetting sync_cursors to in_progress. peSyncCron resume ticks drain chunks.
 *
 * Membership import is not scheduled here (manual / upload-triggered).
 */

const {
  SCHEDULED_RESOURCE_TYPES,
  resetCursor,
  hasActiveInProgress,
  todayUtc,
} = require('./cursorStore');
const {
  getPracticePatValidity,
  listPracticesWithEncryptedPat,
} = require('./credentialsStatus');
const { savePracticeSyncRange, getPracticeSyncRange } = require('./practiceSyncRange');
const { createSyncRun, completeSyncRun } = require('./syncRunStore');
const { recordTick } = require('./peTickHistory');

const LOOKBACK_DAYS = Number(process.env.PE_SYNC_INCREMENTAL_LOOKBACK_DAYS || 3);
const STALE_MS = Number(process.env.PE_SYNC_IN_PROGRESS_STALE_MS || 120_000);
const MAX_PRACTICES =
  Number(process.env.PE_SYNC_KICKOFF_MAX_PRACTICES || 20);

/**
 * Resources that use dateChunking in syncHelpers — incremental kickoff seeds a
 * lookback date window. Others reset to page 1 (full list re-fetch).
 */
const DATE_WINDOW_RESOURCES = new Set([
  'patients',
  'recalls',
  'appointments',
  'treatment_appointments',
  'treatment_plans',
  'treatment_items',
  'invoices',
  'payments',
]);

function daysAgoUtc(days) {
  const d = new Date(`${todayUtc()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - Math.max(0, days));
  return d.toISOString().slice(0, 10);
}

function incrementalDateWindow() {
  const chunkEnd = todayUtc();
  let chunkStart = daysAgoUtc(LOOKBACK_DAYS);
  if (chunkStart > chunkEnd) chunkStart = chunkEnd;
  return { chunkStart, chunkEnd };
}

async function recordSkipSyncRun(practiceId, reason) {
  try {
    const run = await createSyncRun(practiceId);
    await completeSyncRun(run.id, 'failed', `skipped_no_valid_credential:${reason}`);
    return run.id;
  } catch (err) {
    // practice_id FK may fail for unknown UUIDs on manual kickoff
    console.warn(
      `[PE kickoff] Could not write skip sync_run for ${practiceId.slice(0, 8)}…:`,
      err.message
    );
    return null;
  }
}

/**
 * @param {string} practiceId
 * @param {'incremental'|'full'} mode
 * @returns {Promise<{
 *   practiceId: string,
 *   mode: string,
 *   action: 'kicked'|'skipped',
 *   reason?: string,
 *   resourcesReset?: string[],
 *   syncRunId?: string,
 * }>}
 */
async function kickoffPractice(practiceId, mode) {
  const validity = await getPracticePatValidity(practiceId);
  if (!validity.ok) {
    const syncRunId = await recordSkipSyncRun(practiceId, validity.reason || 'invalid');
    console.log(
      `[PE kickoff] Skip ${mode} practice=${practiceId.slice(0, 8)}… — ${validity.reason}`
    );
    return {
      practiceId,
      mode,
      action: 'skipped',
      reason: `skipped_no_valid_credential:${validity.reason}`,
      syncRunId,
    };
  }

  const staleBeforeIso = new Date(Date.now() - STALE_MS).toISOString();
  if (await hasActiveInProgress(practiceId, SCHEDULED_RESOURCE_TYPES, staleBeforeIso)) {
    console.log(
      `[PE kickoff] Skip ${mode} practice=${practiceId.slice(0, 8)}… — overlap (in_progress)`
    );
    return {
      practiceId,
      mode,
      action: 'skipped',
      reason: 'overlap_in_progress',
    };
  }

  const dateWindow = mode === 'incremental' ? incrementalDateWindow() : null;
  const resourcesReset = [];

  for (const resourceType of SCHEDULED_RESOURCE_TYPES) {
    const opts = { kickoffMode: mode };
    if (mode === 'incremental' && DATE_WINDOW_RESOURCES.has(resourceType)) {
      opts.dateWindow = dateWindow;
    }
    await resetCursor(practiceId, resourceType, opts);
    resourcesReset.push(resourceType);
  }

  console.log(
    `[PE kickoff] ${mode} practice=${practiceId.slice(0, 8)}… ` +
      `resources=${resourcesReset.length}` +
      (dateWindow
        ? ` window=${dateWindow.chunkStart}→${dateWindow.chunkEnd}`
        : ' (full from practice sync_start_date → today)')
  );

  return {
    practiceId,
    mode,
    action: 'kicked',
    resourcesReset,
    dateWindow: dateWindow || undefined,
  };
}

async function kickoffIncremental(practiceId) {
  return kickoffPractice(practiceId, 'incremental');
}

async function kickoffFull(practiceId) {
  return kickoffPractice(practiceId, 'full');
}

/**
 * Sync only a selected calendar period (TopBar date filter modal).
 * @param {string} practiceId
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 */
async function kickoffPeriod(practiceId, startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) {
    throw new Error('kickoffPeriod requires valid startDate and endDate (YYYY-MM-DD)');
  }

  const validity = await getPracticePatValidity(practiceId);
  if (!validity.ok) {
    const syncRunId = await recordSkipSyncRun(practiceId, validity.reason || 'invalid');
    return {
      practiceId,
      mode: 'period',
      action: 'skipped',
      reason: `skipped_no_valid_credential:${validity.reason}`,
      syncRunId,
      startDate,
      endDate,
    };
  }

  const staleBeforeIso = new Date(Date.now() - STALE_MS).toISOString();
  if (await hasActiveInProgress(practiceId, SCHEDULED_RESOURCE_TYPES, staleBeforeIso)) {
    return {
      practiceId,
      mode: 'period',
      action: 'skipped',
      reason: 'overlap_in_progress',
      startDate,
      endDate,
    };
  }

  const syncRange = await getPracticeSyncRange(practiceId);
  if (startDate < syncRange.startDate) {
    await savePracticeSyncRange(practiceId, startDate, syncRange.endDate);
  }

  const dateWindow = { chunkStart: startDate, chunkEnd: endDate };
  const resourcesReset = [];

  for (const resourceType of SCHEDULED_RESOURCE_TYPES) {
    const opts = {
      kickoffMode: 'period',
      periodSyncEnd: endDate,
    };
    if (DATE_WINDOW_RESOURCES.has(resourceType)) {
      opts.dateWindow = dateWindow;
    }
    await resetCursor(practiceId, resourceType, opts);
    resourcesReset.push(resourceType);
  }

  console.log(
    `[PE kickoff] period practice=${practiceId.slice(0, 8)}… window=${startDate}→${endDate} ` +
      `resources=${resourcesReset.length}`,
  );

  return {
    practiceId,
    mode: 'period',
    action: 'kicked',
    resourcesReset,
    dateWindow,
    startDate,
    endDate,
  };
}

/**
 * Cron/HTTP: kickoff all candidate practices (encrypted PAT present).
 * Invalid PAT → sync_runs skip row; valid → reset cursors.
 */
async function runKickoffTick(mode) {
  const practices = await listPracticesWithEncryptedPat(MAX_PRACTICES);
  const results = [];

  for (const p of practices) {
    try {
      results.push(await kickoffPractice(p.practiceId, mode));
    } catch (err) {
      console.error(
        `[PE kickoff] Error ${mode} practice=${p.practiceId}:`,
        err.message
      );
      results.push({
        practiceId: p.practiceId,
        mode,
        action: 'skipped',
        reason: `error:${err.message}`,
      });
    }
  }

  const kicked = results.filter((r) => r.action === 'kicked').length;
  const skipped = results.filter((r) => r.action === 'skipped').length;
  console.log(
    `[PE kickoff] ${mode} tick done — practices=${practices.length} kicked=${kicked} skipped=${skipped}`
  );

  recordTick({
    kind: mode === 'incremental' ? 'kickoff_incremental' : 'kickoff_full',
    practicesConsidered: practices.length,
    kicked,
    skipped,
    results: results.map((r) => ({
      practiceId: r.practiceId,
      action: r.action,
      reason: r.reason || null,
    })),
  });

  return { mode, practices: practices.length, kicked, skipped, results };
}

async function runIncrementalKickoffTick() {
  return runKickoffTick('incremental');
}

async function runFullKickoffTick() {
  return runKickoffTick('full');
}

module.exports = {
  LOOKBACK_DAYS,
  DATE_WINDOW_RESOURCES,
  daysAgoUtc,
  incrementalDateWindow,
  kickoffIncremental,
  kickoffFull,
  kickoffPeriod,
  runIncrementalKickoffTick,
  runFullKickoffTick,
};
