/**
 * Global TopBar read scope for Patient Economics (location + calendar period).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isYmd(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * @param {Record<string, unknown>} query
 * @returns {{ locationId: string | null, startDate: string | null, endDate: string | null }}
 */
function parseReadScope(query = {}) {
  const locationId =
    query.locationId != null && isUuid(String(query.locationId))
      ? String(query.locationId)
      : null;
  const startDate = isYmd(query.startDate) ? String(query.startDate) : null;
  const endDate = isYmd(query.endDate) ? String(query.endDate) : null;

  if (startDate && endDate && startDate > endDate) {
    return { locationId, startDate: endDate, endDate: startDate };
  }

  return { locationId, startDate, endDate };
}

/**
 * @param {{ locationId?: string | null, startDate?: string | null, endDate?: string | null }} scope
 */
function scopeCacheExtra(scope = {}) {
  const loc = scope.locationId || 'all';
  const start = scope.startDate || '';
  const end = scope.endDate || '';
  return `${loc}:${start}:${end}`;
}

/**
 * @param {{ locationId?: string | null, startDate?: string | null, endDate?: string | null }} scope
 */
function hasDateScope(scope = {}) {
  return Boolean(scope.startDate && scope.endDate);
}

/**
 * @param {{ locationId?: string | null, startDate?: string | null, endDate?: string | null }} scope
 */
function hasLocationScope(scope = {}) {
  return Boolean(scope.locationId);
}

/**
 * @param {{ locationId?: string | null, startDate?: string | null, endDate?: string | null }} scope
 */
function hasAnyScope(scope = {}) {
  return hasLocationScope(scope) || hasDateScope(scope);
}

/** Exclusive end date (YYYY-MM-DD) for half-open [start, end) claim filters. */
function dayAfterYmd(ymd) {
  if (!isYmd(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Prorate an annual NHS contract figure across whole calendar months in range. */
function prorateAnnualByMonthRange(annualValue, startDate, endDate) {
  const annual = Number(annualValue);
  if (!Number.isFinite(annual) || annual <= 0) return 0;
  const months = buildMonthKeysFromRange(startDate, endDate);
  if (months.length === 0) return 0;
  return (annual * months.length) / 12;
}

/** Month keys (YYYY-MM) covering [startDate, endDate] inclusive. */
function buildMonthKeysFromRange(startDate, endDate) {
  if (!isYmd(startDate) || !isYmd(endDate)) return [];
  const keys = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= endMonth) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    keys.push(`${y}-${m}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

module.exports = {
  parseReadScope,
  scopeCacheExtra,
  hasDateScope,
  hasLocationScope,
  hasAnyScope,
  buildMonthKeysFromRange,
  dayAfterYmd,
  prorateAnnualByMonthRange,
  isUuid,
  isYmd,
};
