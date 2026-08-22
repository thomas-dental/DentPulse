/**
 * Xero sync window / progressive watermark helpers.
 *
 * First sync (no last_synced_at, or force=true):
 *   - Uses configured xero_start_date / xero_modified_since, or defaults to
 *     INITIAL_LOOKBACK_MONTHS (18 ≈ 1.5 years) of history.
 *
 * Subsequent syncs:
 *   - If-Modified-Since entities use last_synced_at minus OVERLAP_DAYS.
 *   - Date-range reports (P&L / Balance Sheet) re-pull from the start of the
 *     month containing that overlap cutoff through today.
 *
 * The window is snapshotted onto sync_jobs at trigger time so mid-batch
 * updates to platform_integrations.last_synced_at cannot shrink sibling jobs.
 */

const { getSyncSettings } = require('../../services/sync/settingsStore');
const {
  INITIAL_LOOKBACK_MONTHS,
  INCREMENTAL_OVERLAP_DAYS,
} = require('../../api/xero/config');

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcMonths(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function addUtcDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function startOfMonthYmd(ymd) {
  const s = String(ymd).slice(0, 10);
  return `${s.slice(0, 7)}-01`;
}

/**
 * Read raw Xero date settings (DB-backed, JSON file fallback).
 */
function getXeroSettingsDates() {
  try {
    const s = getSyncSettings();
    return {
      startDate:     s.xero_start_date || null,
      endDate:       s.xero_end_date || null,
      modifiedSince: s.xero_modified_since || null,
    };
  } catch {
    return { startDate: null, endDate: null, modifiedSince: null };
  }
}

/**
 * Resolve the sync window for a Xero trigger.
 *
 * @param {object}  opts
 * @param {string|null} opts.lastSyncedAt  platform_integrations.last_synced_at
 * @param {boolean}     [opts.force=false] force full/initial window
 * @returns {{
 *   isInitialSync: boolean,
 *   modifiedSince: string|null,
 *   reportStartDate: string|null,
 *   reportEndDate: string|null,
 * }}
 */
function resolveXeroSyncWindow({ lastSyncedAt, force = false } = {}) {
  const settings = getXeroSettingsDates();
  const today = toYmd(new Date());
  const isInitialSync = Boolean(force) || !lastSyncedAt;

  if (isInitialSync) {
    const defaultStart = toYmd(addUtcMonths(new Date(), -INITIAL_LOOKBACK_MONTHS));
    const reportStartDate = settings.startDate
      ? String(settings.startDate).slice(0, 10)
      : defaultStart;
    const reportEndDate = settings.endDate
      ? String(settings.endDate).slice(0, 10)
      : today;

    const modifiedSince = settings.modifiedSince
      || `${reportStartDate}T00:00:00Z`;

    return {
      isInitialSync: true,
      modifiedSince,
      reportStartDate,
      reportEndDate,
    };
  }

  const watermark = new Date(lastSyncedAt);
  if (Number.isNaN(watermark.getTime())) {
    // Corrupt watermark — fall back to initial window
    return resolveXeroSyncWindow({ lastSyncedAt: null, force: true });
  }

  const overlapStart = addUtcDays(watermark, -INCREMENTAL_OVERLAP_DAYS);
  let reportStartDate = startOfMonthYmd(toYmd(overlapStart));
  if (settings.startDate) {
    const configuredStart = String(settings.startDate).slice(0, 10);
    if (configuredStart > reportStartDate) reportStartDate = configuredStart;
  }

  return {
    isInitialSync: false,
    modifiedSince: overlapStart.toISOString(),
    reportStartDate,
    reportEndDate: today,
  };
}

/**
 * Resolve If-Modified-Since for a running job.
 * Prefers the snapshotted job.start_date from trigger time.
 *
 * @param {object} job
 * @param {object} [integration]  may include last_synced_at for recovered jobs
 * @returns {string|null}
 */
function resolveModifiedSinceForJob(job, integration = null) {
  if (job?.start_date) {
    const raw = String(job.start_date).trim();
    if (!raw) return null;
    if (raw.includes('T')) {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? `${raw.slice(0, 10)}T00:00:00Z` : d.toISOString();
    }
    return `${raw.slice(0, 10)}T00:00:00Z`;
  }

  // Recovered / legacy jobs without a snapshot — derive from connection watermark
  if (integration?.last_synced_at) {
    const watermark = new Date(integration.last_synced_at);
    if (!Number.isNaN(watermark.getTime())) {
      return addUtcDays(watermark, -INCREMENTAL_OVERLAP_DAYS).toISOString();
    }
  }

  // Final fallback: settings / default lookback (treat as initial)
  return resolveXeroSyncWindow({ lastSyncedAt: null, force: true }).modifiedSince;
}

module.exports = {
  INITIAL_LOOKBACK_MONTHS,
  INCREMENTAL_OVERLAP_DAYS,
  getXeroSettingsDates,
  resolveXeroSyncWindow,
  resolveModifiedSinceForJob,
};
