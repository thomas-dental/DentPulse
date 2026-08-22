/**
 * autoSyncCron — nightly incremental Dentally sync at a fixed time (default
 * 00:00 UK), with a legacy after-clinic-close mode.
 *
 * A lightweight cron ticks every 15 minutes (no timezone option needed — all
 * time math is done explicitly in AUTO_SYNC_TIMEZONE, default Europe/London,
 * since Dentally practices are UK-based). On each tick, for every org with a
 * connected Dentally integration:
 *
 *   1. Work out when the org is due. Default: the fixed auto_sync_at_time
 *      (00:00 — every org comes due on the first tick after midnight UK;
 *      client request 2026-07-30). Setting auto_sync_at_time to null in
 *      sync_settings restores the legacy heuristic: the LATEST `close` across
 *      the org's active practice_locations' operating_hours (synced from
 *      Dentally /v1/sites) for today's weekday, falling back to
 *      auto_sync_default_close_time, plus auto_sync_delay_minutes.
 *   2. If now >= close + auto_sync_delay_minutes and this org hasn't auto-synced
 *      today, CLAIM the run (insert into auto_sync_runs; the unique
 *      (organization_id, run_date) index makes the claim race- and
 *      restart-proof) and call the existing queue triggerSync() with a short
 *      rolling window: [today - auto_sync_lookback_days .. today].
 *
 * Why a date window is all that's needed for "new + updated records": the
 * Dentally entity config already uses created_after / updated_after filters,
 * so a recent window fetches exactly the records created OR updated in it,
 * and the sync layer upserts them. Reference entities with no date filter
 * (locations, treatments, practitioners, ...) are small full-list fetches and
 * are re-synced nightly so price/hours/staff changes land too. Excluded by
 * default: `accounts` (one detail API call per record — too slow for nightly)
 * and `appointments_current_month` (redundant here — state changes bump
 * updated_at, so the plain `appointments` entity already catches them).
 *
 * Safety rails:
 *   - Skips (and retries next tick) while the org still has queued/running
 *     Dentally jobs — never stacks onto, or cancels, a manual sync.
 *   - Passing an explicit `entities` list to triggerSync() also routes around
 *     its full-sync path, which cancels in-flight jobs — auto-sync must never
 *     do that.
 *   - On failure the claim row is marked 'failed' (kept for history) and the
 *     next tick atomically reclaims it to retry; all sync writes are upserts,
 *     so a retried partial run is merely redundant, never corrupting.
 */
const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');
const { triggerSync, sweepStaleJobs } = require('../queue');
const { ENTITIES } = require('../api/dentally/config');
const { getSyncSettings } = require('./sync/settingsStore');

// Tick frequency only controls how soon after close the sync starts (worst
// case: delay + 15 min). The once-per-day claim makes extra ticks free.
const CHECK_SCHEDULE = process.env.AUTO_SYNC_CHECK_SCHEDULE || '*/15 * * * *';
const TIMEZONE = process.env.AUTO_SYNC_TIMEZONE || 'Europe/London';

// Settings defaults (flat keys in sync_settings JSONB, same convention as
// sync_start_date / xero_start_date — see routes/settings.js).
const DEFAULTS = {
  auto_sync_enabled: true,
  // Fixed daily run time (HH:MM in AUTO_SYNC_TIMEZONE). When set, EVERY org
  // comes due at this wall-clock time and the per-org clinic-close logic is
  // bypassed (delay buffer included — 00:00 means 00:00, not 00:30). Set to
  // null in sync_settings to revert to the legacy after-close behaviour.
  auto_sync_at_time: '00:00',
  auto_sync_delay_minutes: 30,        // buffer after close before triggering
  auto_sync_default_close_time: '18:00',
  auto_sync_lookback_days: 3,         // window start = today - N days
  auto_sync_entities: null,           // null = built-in default list below
  // Most orgs have no operating_hours synced and fall back to the same
  // default close time, so they all come due on the same tick. Cap how many
  // fire per tick; the rest start on the next tick (15 min later) — the
  // once-per-day claim makes the spillover exact, not duplicated.
  auto_sync_max_orgs_per_tick: 25,
};

const DEFAULT_ENTITY_ALIASES = ENTITIES
  .map((e) => e.alias)
  .filter((a) => a !== 'accounts' && a !== 'appointments_current_month');

// Epoch ms when the in-flight cron check started, null when idle. A plain
// boolean here once risked a permanently-dead cron: if a check hung (e.g. DB
// calls that never resolve), the flag stayed true forever and every later
// tick returned early. The timestamp lets a tick reclaim after a hard limit.
let checkStartedAt = null;
const CHECK_HANG_LIMIT_MS = 30 * 60 * 1000;

/** Merge stored settings over defaults, sanitising types. */
function getAutoSyncSettings() {
  const stored = getSyncSettings();
  const s = { ...DEFAULTS };
  if (typeof stored.auto_sync_enabled === 'boolean') s.auto_sync_enabled = stored.auto_sync_enabled;
  if (stored.auto_sync_at_time === null) {
    s.auto_sync_at_time = null; // explicit opt-out → legacy after-close mode
  } else if (typeof stored.auto_sync_at_time === 'string' && /^\d{1,2}:\d{2}$/.test(stored.auto_sync_at_time)) {
    s.auto_sync_at_time = stored.auto_sync_at_time;
  }
  if (Number.isFinite(stored.auto_sync_delay_minutes)) s.auto_sync_delay_minutes = stored.auto_sync_delay_minutes;
  if (typeof stored.auto_sync_default_close_time === 'string' && /^\d{1,2}:\d{2}$/.test(stored.auto_sync_default_close_time)) {
    s.auto_sync_default_close_time = stored.auto_sync_default_close_time;
  }
  if (Number.isFinite(stored.auto_sync_lookback_days) && stored.auto_sync_lookback_days >= 1) {
    s.auto_sync_lookback_days = stored.auto_sync_lookback_days;
  }
  if (Array.isArray(stored.auto_sync_entities) && stored.auto_sync_entities.length > 0) {
    s.auto_sync_entities = stored.auto_sync_entities;
  }
  if (Number.isFinite(stored.auto_sync_max_orgs_per_tick) && stored.auto_sync_max_orgs_per_tick >= 1) {
    s.auto_sync_max_orgs_per_tick = stored.auto_sync_max_orgs_per_tick;
  }
  return s;
}

/** Current wall-clock in the clinic timezone: date ISO, minutes since midnight, weekday name. */
function nowInTimezone() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'long',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour = Number(get('hour')) % 24; // Intl can emit '24' at midnight
  return {
    dateIso: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + Number(get('minute')),
    weekday: (get('weekday') || '').toLowerCase(),
  };
}

/** '17:30' -> 1050 minutes, null when unparseable. */
function parseTimeToMinutes(str) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(str || '').trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

/** 'YYYY-MM-DD' minus N days (safe across month/year boundaries). */
function minusDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split('T')[0];
}

/**
 * Latest closing time (minutes) across the org's active locations for the
 * given weekday. Returns { minutes, label } or null when no location has
 * hours today (caller falls back to the default close time).
 */
async function getOrgCloseTime(orgId, weekday) {
  const { data: locations, error } = await supabaseAdmin
    .from('practice_locations')
    .select('operating_hours')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .not('operating_hours', 'is', null);
  if (error) throw new Error(`read practice_locations: ${error.message}`);

  let latest = null;
  let label = null;
  for (const loc of locations || []) {
    const hours = loc.operating_hours?.[weekday];
    const closeMin = hours ? parseTimeToMinutes(hours.close) : null;
    if (closeMin !== null && (latest === null || closeMin > latest)) {
      latest = closeMin;
      label = hours.close;
    }
  }
  return latest === null ? null : { minutes: latest, label };
}

/** True if the org still has queued/running Dentally jobs (skip this tick). */
async function orgHasActiveJobs(orgId, integrationIds) {
  const { data, error } = await supabaseAdmin
    .from('sync_jobs')
    .select('id')
    .eq('organization_id', orgId)
    .in('integration_id', integrationIds)
    .in('status', ['queued', 'running'])
    .limit(1);
  if (error) throw new Error(`read sync_jobs: ${error.message}`);
  return (data || []).length > 0;
}

/**
 * Evaluate every Dentally-connected org and trigger the after-close sync for
 * those that are due. Returns per-org decisions (used by the admin check
 * endpoint for observability).
 */
async function runAutoSyncCheck(triggeredBy = 'cron') {
  const settings = getAutoSyncSettings();
  if (!settings.auto_sync_enabled) {
    return { enabled: false, decisions: [] };
  }

  const now = nowInTimezone();
  const decisions = [];

  // All connected Dentally integrations, grouped by org.
  const { data: integrations, error: intErr } = await supabaseAdmin
    .from('integrations')
    .select('id, organization_id')
    .ilike('integration_name', 'dentally')
    .eq('is_connected', true)
    .is('deleted_at', null);
  if (intErr) {
    console.error('[auto-sync] read integrations failed:', intErr.message);
    return { enabled: true, decisions, error: intErr.message };
  }

  const integrationsByOrg = new Map();
  for (const i of integrations || []) {
    if (!integrationsByOrg.has(i.organization_id)) integrationsByOrg.set(i.organization_id, []);
    integrationsByOrg.get(i.organization_id).push(i.id);
  }

  // Watchdog first: clear orphaned queued/running rows (backend crashed or
  // restarted under another process, DB writes failed mid-run, ...) so a dead
  // job can never leave auto-sync "waiting" forever. Live jobs — including a
  // running manual sync — are never touched, so auto-sync still waits for
  // them and starts on the first tick after they finish.
  try {
    await sweepStaleJobs((integrations || []).map((i) => i.id));
  } catch (e) {
    console.error('[auto-sync] stale-job sweep failed:', e.message);
  }

  let triggeredThisTick = 0;
  for (const [orgId, integrationIds] of integrationsByOrg) {
    const decision = { orgId, action: 'skipped', reason: null };
    decisions.push(decision);
    try {
      // 1. Already ran today? (claim row present as 'triggered' or 'completed')
      const { data: existingRun, error: runErr } = await supabaseAdmin
        .from('auto_sync_runs')
        .select('id, status')
        .eq('organization_id', orgId)
        .eq('run_date', now.dateIso)
        .in('status', ['triggered', 'completed'])
        .maybeSingle();
      if (runErr) throw new Error(`read auto_sync_runs: ${runErr.message}`);
      if (existingRun) {
        decision.reason = `already ${existingRun.status} today`;
        continue;
      }

      // 2. Due yet? Fixed daily time when configured (default 00:00 UK —
      //    client request 2026-07-30), otherwise the legacy per-org
      //    clinic-close (+ delay) heuristic.
      let closeLabel;
      let dueMinutes;
      const fixedMinutes = settings.auto_sync_at_time !== null ? parseTimeToMinutes(settings.auto_sync_at_time) : null;
      if (fixedMinutes !== null) {
        closeLabel = settings.auto_sync_at_time;
        dueMinutes = fixedMinutes; // no delay buffer — 00:00 means 00:00
      } else {
        const close = await getOrgCloseTime(orgId, now.weekday);
        closeLabel = close ? close.label : settings.auto_sync_default_close_time;
        const closeMinutes = close ? close.minutes : parseTimeToMinutes(settings.auto_sync_default_close_time);
        // Cap at 23:59 so a late close + delay can't push the trigger past
        // midnight into a day that never fires.
        dueMinutes = Math.min(closeMinutes + settings.auto_sync_delay_minutes, 24 * 60 - 1);
      }
      decision.closeTime = closeLabel;
      if (now.minutes < dueMinutes) {
        decision.reason = fixedMinutes !== null
          ? `fixed run time ${closeLabel} — due after ${Math.floor(dueMinutes / 60)}:${String(dueMinutes % 60).padStart(2, '0')}`
          : `clinic closes at ${closeLabel} — due after ${Math.floor(dueMinutes / 60)}:${String(dueMinutes % 60).padStart(2, '0')}`;
        continue;
      }

      // 3. Per-tick cap: spread the after-close herd across ticks. Deferred
      //    orgs are left unclaimed, so the next tick picks them up.
      if (triggeredThisTick >= settings.auto_sync_max_orgs_per_tick) {
        decision.reason = `deferred — per-tick cap of ${settings.auto_sync_max_orgs_per_tick} reached, next tick continues`;
        continue;
      }

      // 4. Don't stack onto (or implicitly interfere with) an in-flight sync —
      //    e.g. a manual sync. The unclaimed run makes this a WAITING state:
      //    every subsequent tick re-checks, and the first tick after the
      //    in-flight sync finishes triggers the auto-sync. Stale/orphaned jobs
      //    can't hold this forever — the watchdog sweep above fails them.
      if (await orgHasActiveJobs(orgId, integrationIds)) {
        decision.action = 'waiting';
        decision.reason = 'a sync is already in flight (e.g. manual) — auto-sync waiting; it will start on the first 15-min check after that sync finishes';
        continue;
      }

      // 5. Claim the run. A 23505 means a row for (org, today) already exists —
      //    either a concurrent tick won the race (skip) or an earlier attempt
      //    failed (reclaim it; the .eq status guard keeps the reclaim atomic).
      const windowStart = minusDays(now.dateIso, settings.auto_sync_lookback_days);
      const windowEnd = now.dateIso;
      const claimRow = {
        close_time: closeLabel,
        window_start: windowStart,
        window_end: windowEnd,
        status: 'triggered',
        triggered_by: triggeredBy,
        triggered_at: new Date().toISOString(),
        error_message: null,
      };
      let claimId = null;
      const { data: claim, error: claimErr } = await supabaseAdmin
        .from('auto_sync_runs')
        .insert({ organization_id: orgId, run_date: now.dateIso, ...claimRow })
        .select('id')
        .single();
      if (claim) {
        claimId = claim.id;
      } else if (claimErr && claimErr.code === '23505') {
        const { data: reclaimed, error: reclaimErr } = await supabaseAdmin
          .from('auto_sync_runs')
          .update(claimRow)
          .eq('organization_id', orgId)
          .eq('run_date', now.dateIso)
          .eq('status', 'failed')
          .select('id');
        if (reclaimErr) throw new Error(`reclaim run: ${reclaimErr.message}`);
        if (!reclaimed || reclaimed.length === 0) {
          decision.reason = 'claimed by a concurrent run';
          continue;
        }
        claimId = reclaimed[0].id;
      } else {
        throw new Error(`claim run: ${claimErr.message}`);
      }

      // 6. Trigger the incremental sync (jobs get the org owner as user_id,
      //    same as the admin/dev trigger routes).
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('user_id')
        .eq('id', orgId)
        .single();

      try {
        const result = await triggerSync(orgId, null, org?.user_id || null, false, {
          startDate: windowStart,
          endDate: windowEnd,
          entities: settings.auto_sync_entities || DEFAULT_ENTITY_ALIASES,
        });
        await supabaseAdmin
          .from('auto_sync_runs')
          .update({ status: 'completed', job_count: result.jobCount, skipped_count: result.skipped, completed_at: new Date().toISOString() })
          .eq('id', claimId);
        triggeredThisTick++;
        decision.action = 'triggered';
        decision.reason = `created ${result.jobCount} jobs (window ${windowStart} → ${windowEnd}, closed ${closeLabel})`;
        console.log(`[auto-sync] org ${orgId.slice(0, 8)}: ${decision.reason}`);
      } catch (syncErr) {
        // Mark failed (kept for history); the next tick reclaims and retries.
        // Sync writes are upserts, so a retried partial run is merely
        // redundant, never corrupting.
        await supabaseAdmin
          .from('auto_sync_runs')
          .update({ status: 'failed', error_message: String(syncErr.message || syncErr).slice(0, 500) })
          .eq('id', claimId);
        throw syncErr;
      }
    } catch (err) {
      decision.action = 'error';
      decision.reason = err.message;
      console.error(`[auto-sync] org ${orgId.slice(0, 8)} failed: ${err.message}`);
    }
  }

  return { enabled: true, decisions };
}

function startAutoSyncCron() {
  if (!cron.validate(CHECK_SCHEDULE)) {
    console.error(`[auto-sync] invalid AUTO_SYNC_CHECK_SCHEDULE "${CHECK_SCHEDULE}" — cron not started`);
    return;
  }
  cron.schedule(CHECK_SCHEDULE, async () => {
    if (checkStartedAt) {
      if (Date.now() - checkStartedAt < CHECK_HANG_LIMIT_MS) return; // a slow previous tick is still evaluating
      console.warn('[auto-sync] previous check appears hung (>30 min) — starting a fresh one');
    }
    checkStartedAt = Date.now();
    try {
      await runAutoSyncCheck('cron');
    } catch (e) {
      console.error('[auto-sync] check failed:', e.message);
    } finally {
      checkStartedAt = null;
    }
  }, { timezone: TIMEZONE });
  console.log(`[auto-sync] scheduled "${CHECK_SCHEDULE}" (${TIMEZONE}) — nightly incremental sync after clinic close`);
}

/**
 * Manually trigger the same last-updated incremental window the nightly cron
 * uses, for one org (and optionally one Dentally integration). Skips the
 * once-per-day claim and clinic-close gate so the Integrations screen can
 * re-run it on demand without waiting until 00:00 UK.
 */
async function triggerProgressiveSync(orgId, userId = null, integrationId = null) {
  const settings = getAutoSyncSettings();
  const now = nowInTimezone();
  const windowStart = minusDays(now.dateIso, settings.auto_sync_lookback_days);
  const windowEnd = now.dateIso;
  const result = await triggerSync(orgId, null, userId, false, {
    startDate: windowStart,
    endDate: windowEnd,
    entities: settings.auto_sync_entities || DEFAULT_ENTITY_ALIASES,
    ...(integrationId ? { integrationId } : {}),
  });
  return { ...result, windowStart, windowEnd, lookbackDays: settings.auto_sync_lookback_days };
}

module.exports = {
  startAutoSyncCron,
  runAutoSyncCheck,
  getAutoSyncSettings,
  triggerProgressiveSync,
  DEFAULT_ENTITY_ALIASES,
};
