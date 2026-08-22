/**
 * cashflowThresholdCron
 *
 * Raises the "Cash flow below minimum" bell notification ONCE PER DAY at a fixed
 * time (default 08:00 Europe/London) — never on page reload.
 *
 * Why a cron + a persisted status (not a live browser insert):
 *  - The 13-week forecast is computed in the FRONTEND, so the breach can only be
 *    DETECTED there. The browser writes its latest verdict into
 *    `cashflow_forecast_overrides` (section 'threshold_status', line_key
 *    'cash_threshold_status', JSON payload in `line_label`) — see the frontend
 *    hook useThresholdStatusSync.
 *  - This cron reads that persisted verdict each morning and inserts a single
 *    `cashflow_alert` per user when cash is below threshold, deduped to once per
 *    calendar day. When the breach has cleared it resolves any open alert.
 *
 * Trade-off: the status is only as fresh as the last time someone opened the
 * forecast page. We therefore IGNORE statuses older than STALE_DAYS so a long-
 * stale projection can't fire a misleading alert.
 */
const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');

// The cron now TICKS HOURLY and fires each location at 08:00 IN ITS OWN TIMEZONE on
// one of that location's WORKING DAYS — so a multi-site (or future overseas) group
// gets its alert at the right local morning, not a single global 08:00.
const SCHEDULE = process.env.CASHFLOW_CRON_SCHEDULE || '0 * * * *'; // every hour, on the hour
const DEFAULT_TIMEZONE = process.env.CASHFLOW_CRON_TIMEZONE || 'Europe/London'; // fallback when a location has none
const ALERT_HOUR = Number(process.env.CASHFLOW_CRON_HOUR || 8);     // local hour to fire (0–23)
const STALE_DAYS = Number(process.env.CASHFLOW_CRON_STALE_DAYS || 8);

// Country → IANA timezone, used when a location has no explicit `timezone`. Large
// multi-zone countries fall back to a primary zone (good enough for a daily alert).
const COUNTRY_TZ = {
  'united kingdom': 'Europe/London', uk: 'Europe/London', gb: 'Europe/London', 'great britain': 'Europe/London',
  england: 'Europe/London', scotland: 'Europe/London', wales: 'Europe/London', 'northern ireland': 'Europe/London',
  ireland: 'Europe/Dublin', ie: 'Europe/Dublin', 'republic of ireland': 'Europe/Dublin',
  france: 'Europe/Paris', germany: 'Europe/Berlin', spain: 'Europe/Madrid', portugal: 'Europe/Lisbon',
  netherlands: 'Europe/Amsterdam', belgium: 'Europe/Brussels', italy: 'Europe/Rome',
  'united states': 'America/New_York', usa: 'America/New_York', us: 'America/New_York',
  canada: 'America/Toronto', australia: 'Australia/Sydney', 'new zealand': 'Pacific/Auckland',
  india: 'Asia/Kolkata', uae: 'Asia/Dubai', 'united arab emirates': 'Asia/Dubai',
};

const MON_FRI = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

// Validate an IANA timezone string (so a bad column value can't crash Intl).
function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Resolve a location's timezone: its own `timezone` column if set, else derived
// from its country, else the global default (Europe/London).
function deriveTimezone(loc) {
  if (loc && isValidTz(loc.timezone)) return loc.timezone;
  const country = (loc && loc.country ? String(loc.country) : '').trim().toLowerCase();
  if (country && COUNTRY_TZ[country]) return COUNTRY_TZ[country];
  return DEFAULT_TIMEZONE;
}

// The local hour (0–23) and weekday name ('monday'…) for `date` in timezone `tz`.
function localHourAndWeekday(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', hour12: false, weekday: 'long',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour').value) % 24; // 24 → 0 at midnight
  const weekday = (parts.find((p) => p.type === 'weekday').value || '').toLowerCase();
  return { hour, weekday };
}

// Is `weekday` a working day for this location? Uses its operating_hours (the days
// it's actually open); falls back to Mon–Fri when no hours are recorded.
function isWorkingDay(loc, weekday) {
  const oh = loc && loc.operating_hours;
  if (oh && typeof oh === 'object' && Object.keys(oh).length > 0) return !!oh[weekday];
  return MON_FRI.includes(weekday);
}

// YYYY-MM-DD for a date in a given timezone — used to enforce "once per (local) day".
function dayKey(date, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// Every user who can see an org: user_roles + organizations.user_id + created_by.
async function orgUserIds(org) {
  const ids = new Set();
  if (org.user_id) ids.add(org.user_id);
  if (org.created_by) ids.add(org.created_by);
  const { data: roles } = await supabaseAdmin
    .from('user_roles')
    .select('user_id')
    .eq('organization_id', org.id);
  for (const r of roles || []) if (r.user_id) ids.add(r.user_id);
  return [...ids];
}

// A stable per-location key for deduping alerts (null location = the org-wide /
// "all locations" forecast scope). Stamped into the notification's `data` so each
// location's alert is tracked independently.
function locKeyOf(locationId) { return locationId || 'all'; }

// Collapse a user's unread cash-flow alerts FOR ONE (location, threshold) to AT MOST
// ONE (keep the newest, mark the rest read), so a given threshold never piles up the
// bell while OTHER locations/thresholds keep their own alert.
async function dedupeUserThresholdAlerts(userId, locKey, thrKey) {
  const { data: unread } = await supabaseAdmin
    .from('general_notification')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('notification_type', 'cashflow_alert')
    .eq('data->>location_key', locKey)
    .eq('data->>threshold_key', thrKey)
    .is('read_at', null)
    .order('created_at', { ascending: false });
  const stale = (unread || []).slice(1).map((r) => r.id);
  if (stale.length) {
    await supabaseAdmin.from('general_notification')
      .update({ read_at: new Date().toISOString() })
      .in('id', stale);
  }
}

// Insert one cashflow_alert for a user+location+threshold, unless one already exists
// for that SAME threshold today. Either way, collapse older unread duplicates.
async function alertUserThresholdOncePerDay(userId, organizationId, locKey, thrKey, title, message, payload, todayKey, tz) {
  const { data: recent } = await supabaseAdmin
    .from('general_notification')
    .select('created_at')
    .eq('user_id', userId)
    .eq('notification_type', 'cashflow_alert')
    .eq('data->>location_key', locKey)
    .eq('data->>threshold_key', thrKey)
    .order('created_at', { ascending: false })
    .limit(1);
  const lastAt = recent && recent[0] ? recent[0].created_at : null;
  if (lastAt && dayKey(new Date(lastAt), tz) === todayKey) {
    await dedupeUserThresholdAlerts(userId, locKey, thrKey); // already alerted for this threshold today
    return false;
  }

  const { error } = await supabaseAdmin.from('general_notification').insert({
    user_id: userId,
    organization_id: organizationId,
    notification_type: 'cashflow_alert',
    module_type: 'cashflow',
    title,
    message,
    data: payload,
  });
  if (!error) await dedupeUserThresholdAlerts(userId, locKey, thrKey); // keep only the one we just raised
  return !error;
}

// Resolve (mark read) any open cashflow_alert for a user at ONE (location, threshold)
// — that threshold's breach has cleared (others are left untouched).
async function resolveUserThresholdAlerts(userId, locKey, thrKey) {
  await supabaseAdmin
    .from('general_notification')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('notification_type', 'cashflow_alert')
    .eq('data->>location_key', locKey)
    .eq('data->>threshold_key', thrKey)
    .is('read_at', null);
}

async function runCashflowThresholdCheck() {
  const now = new Date();
  const staleBefore = now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000;

  // Pull every persisted forecast breach verdict (one row per org+location).
  const { data: statuses, error } = await supabaseAdmin
    .from('cashflow_forecast_overrides')
    .select('organization_id, location_id, line_label, updated_at')
    .eq('section', 'threshold_status')
    .eq('line_key', 'cash_threshold_status');
  if (error) { console.error('[cashflow-cron] read statuses failed:', error.message); return; }

  // Keep each fresh status as its OWN (org, location) decision — no per-org collapse,
  // so every breaching location raises (or resolves) its own alert.
  const fresh = []; // { orgId, locationId, parsed }
  const orgIdsSet = new Set();
  const locIdsSet = new Set();
  for (const row of statuses || []) {
    let parsed;
    try { parsed = JSON.parse(row.line_label || '{}'); } catch { continue; }
    const computedAt = parsed.computedAt ? new Date(parsed.computedAt).getTime() : 0;
    if (computedAt < staleBefore) continue; // too old to trust
    fresh.push({ orgId: row.organization_id, locationId: row.location_id ?? null, parsed });
    orgIdsSet.add(row.organization_id);
    if (row.location_id) locIdsSet.add(row.location_id);
  }

  if (fresh.length === 0) return;

  // Resolve org owners/members once per org (cached), then act per (org, location).
  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select('id, user_id, created_by')
    .in('id', [...orgIdsSet]);
  const orgById = new Map((orgs || []).map((o) => [o.id, o]));

  // Per-location timezone + working-day inputs (used to gate each location to its
  // OWN 08:00 working-day). A null-location ("all locations") status has no row here
  // and falls back to the default timezone + Mon–Fri.
  const locById = new Map();
  if (locIdsSet.size > 0) {
    const { data: locs } = await supabaseAdmin
      .from('practice_locations')
      .select('id, timezone, country, operating_hours')
      .in('id', [...locIdsSet]);
    for (const l of locs || []) locById.set(l.id, l);
  }

  const usersByOrg = new Map();
  const getUsers = async (org) => {
    if (!usersByOrg.has(org.id)) usersByOrg.set(org.id, await orgUserIds(org));
    return usersByOrg.get(org.id);
  };

  let raised = 0, resolved = 0, dueNow = 0;
  for (const st of fresh) {
    const org = orgById.get(st.orgId);
    if (!org) continue;

    // Gate: only act on a location when it is ALERT_HOUR (08:00) on one of its
    // working days, in that location's own timezone. Every other hourly tick is a
    // no-op for this location.
    const loc = st.locationId ? locById.get(st.locationId) : null;
    const tz = deriveTimezone(loc);
    const { hour, weekday } = localHourAndWeekday(now, tz);
    if (hour !== ALERT_HOUR) continue;
    if (!isWorkingDay(loc, weekday)) continue;
    dueNow++;

    const users = await getUsers(org);
    const locKey = locKeyOf(st.locationId);
    const todayKey = dayKey(now, tz);

    // Normalise to the thresholds[] list. Back-compat: an old status row stored a
    // single End Cash verdict at the top level — wrap it as one threshold entry.
    const p = st.parsed;
    const thresholds = Array.isArray(p.thresholds) && p.thresholds.length
      ? p.thresholds
      : [{
          key: 'end_cash_threshold', label: 'End Cash', kind: 'min',
          inBreach: !!p.inBreach, breachWeekIso: p.breachWeekIso, weekLabel: p.weekLabel,
          weekIndex: p.weekIndex, value: p.endCash, limit: p.threshold, title: p.title, message: p.message,
        }];

    for (const t of thresholds) {
      const thrKey = t.key || 'end_cash_threshold';
      if (t.inBreach) {
        const payload = {
          signature: `${st.orgId}|${locKey}|${thrKey}|${t.breachWeekIso}|${Math.round(t.value || 0)}|${Math.round(t.limit || 0)}`,
          location_id: st.locationId,        // real id (null = all-locations scope)
          location_key: locKey,              // dedupe/resolve key ('all' when null)
          location_name: p.locationName || null,
          threshold_key: thrKey,             // which threshold (row key / 'end_cash_threshold')
          threshold_label: t.label || null,
          threshold_kind: t.kind || null,    // 'min' (floor) | 'max' (cap)
          timezone: tz,
          week_start: t.breachWeekIso,
          week_label: t.weekLabel,
          week_index: t.weekIndex,
          value: Math.round(t.value || 0),
          threshold: Math.round(t.limit || 0),
        };
        for (const uid of users) {
          if (await alertUserThresholdOncePerDay(uid, org.id, locKey, thrKey, t.title || `${t.label || 'Cash flow'} threshold breached`, t.message || '', payload, todayKey, tz)) raised++;
        }
      } else {
        for (const uid of users) { await resolveUserThresholdAlerts(uid, locKey, thrKey); resolved++; }
      }
    }
  }
  if (dueNow > 0) {
    console.log(`[cashflow-cron] done — ${dueNow}/${fresh.length} location status(es) due at local ${ALERT_HOUR}:00, ${raised} alert(s) raised, ${resolved} resolve-pass(es)`);
  }
}

function startCashflowThresholdCron() {
  if (!cron.validate(SCHEDULE)) {
    console.error(`[cashflow-cron] invalid CASHFLOW_CRON_SCHEDULE "${SCHEDULE}" — cron not started`);
    return;
  }
  cron.schedule(SCHEDULE, () => {
    runCashflowThresholdCheck().catch((e) => console.error('[cashflow-cron] run failed:', e.message));
  }, { timezone: DEFAULT_TIMEZONE });
  console.log(`[cashflow-cron] scheduled "${SCHEDULE}" (${DEFAULT_TIMEZONE})`);
}

module.exports = { startCashflowThresholdCron, runCashflowThresholdCheck };
