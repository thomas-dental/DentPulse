/**
 * Utility functions for calculating date ranges based on filter selections
 */

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Format a Date as `YYYY-MM-DD` using its LOCAL calendar components.
 *
 * Do NOT use `date.toISOString().slice(0, 10)` for this: filter ranges are
 * built at local midnight (startDate) / local end-of-day (endDate), and
 * `toISOString()` converts to UTC. In any timezone ahead of UTC (e.g. IST
 * +5:30) a local-midnight startDate rolls back to the previous calendar day
 * — that's why "May 2026" was reaching the chatbot as 2026-04-30 → 2026-05-31.
 */
export function toLocalYMD(d: Date | null | undefined): string | null {
  if (!d || isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * UTC instant of 00:00 Europe/London for a `YYYY-MM-DD` UK calendar date.
 * Treats the wall-clock midnight as UTC, then measures how far Europe/London
 * actually sits from UTC at that moment (handles GMT ↔ BST). Independent of the
 * viewer's browser timezone. (Mirrors the helper proven in ProviderActivity.)
 */
function ukDayStartUTCFromYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const naiveUTC = Date.UTC(y, m - 1, d, 0, 0, 0);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(naiveUTC));
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const londonAsUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return new Date(naiveUTC - (londonAsUTC - naiveUTC));
}

/**
 * Given a Date whose LOCAL calendar date is the intended day, return the UTC ISO
 * instant of that UK day's 00:00 (Europe/London). Use for the START bound of a
 * timestamptz filter so the window is the practice's UK day regardless of the
 * viewer's browser timezone. For a UK viewer this equals `d.toISOString()` on a
 * local-midnight Date, so it changes nothing for UK users — it only fixes viewers
 * outside the UK (e.g. IST +5:30) whose local midnight isn't London midnight.
 */
export function ukDayStartInstant(d: Date): string {
  if (!d || isNaN(d.getTime())) return '';
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return ukDayStartUTCFromYMD(ymd).toISOString();
}

/**
 * Companion to ukDayStartInstant: the LAST instant of the UK day for `d`'s local
 * calendar date (1 ms before the next UK midnight), as UTC ISO. Use for the END
 * bound of an inclusive `.lte` timestamptz filter.
 */
export function ukDayEndInstant(d: Date): string {
  if (!d || isNaN(d.getTime())) return '';
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const next = new Date(Date.UTC(y, m - 1, day + 1)); // rolls month/year over
  const nextYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return new Date(ukDayStartUTCFromYMD(nextYmd).getTime() - 1).toISOString();
}

/**
 * Europe/London calendar date (YYYY-MM-DD) of a stored timestamptz value.
 * Use when bucketing rows by day/month: in BST a timestamp at 23:30Z belongs
 * to the NEXT London day, so slicing the raw UTC string files it a day early.
 */
const LONDON_YMD_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});
export function londonYMD(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : LONDON_YMD_FMT.format(d);
}

/**
 * Calculate date range based on date range selection ID
 * @param rangeId - The date range ID (e.g., 'mtd', 'last-month', 'qtd', etc.)
 * @returns DateRange object with startDate and endDate
 */
export function getDateRangeFromId(rangeId: string): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  let startDate: Date;
  let endDate: Date = new Date(today);
  endDate.setHours(23, 59, 59, 999);

  switch (rangeId) {
    case 'mtd': // Month to Date
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
      break;

    case 'last-month': // Last Month
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      endDate.setHours(23, 59, 59, 999);
      break;

    case 'qtd': // Quarter to Date
      const currentQuarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
      startDate.setHours(0, 0, 0, 0);
      break;

    case 'ytd': // Year to Date
      startDate = new Date(now.getFullYear(), 0, 1);
      startDate.setHours(0, 0, 0, 0);
      break;

    case 'last-12m': // Last 12 Months
      startDate = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
      startDate.setHours(0, 0, 0, 0);
      break;

    case 'yoy': // Year over Year (last year same period)
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
      break;

    case 'custom': // Custom Range - defaults to last 12 months for now
    default:
      startDate = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
      startDate.setHours(0, 0, 0, 0);
      break;
  }

  return { startDate, endDate };
}

/**
 * Get date range for custom date selection
 * @param customStartDate - Custom start date
 * @param customEndDate - Custom end date
 * @returns DateRange object
 */
export function getCustomDateRange(customStartDate: Date, customEndDate: Date): DateRange {
  const startDate = new Date(customStartDate);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(customEndDate);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
}

/**
 * Given the active filter's range id and its resolved { startDate, endDate },
 * return the IMMEDIATELY PRECEDING period of comparable length. Used by the
 * Cost Impact "Detailed Cost Breakdown" for its period-over-period
 * "% Change" / "Cost Change" columns.
 *
 * Calendar-aware for the month / quarter / year presets (so "Last Month"
 * compares cleanly against the whole previous calendar month); for custom or
 * rolling ranges it falls back to an equal-length window ending the instant
 * before the current one starts.
 */
export function getPreviousDateRange(rangeId: string, current: DateRange): DateRange {
  const s = current.startDate;

  // Whole-calendar-month span starting at (year, monthIdx), `count` months long.
  const monthSpan = (year: number, monthIdx: number, count: number): DateRange => ({
    startDate: new Date(year, monthIdx, 1, 0, 0, 0, 0),
    endDate: new Date(year, monthIdx + count, 0, 23, 59, 59, 999),
  });

  switch (rangeId) {
    case 'this-month':
    case 'mtd':
    case 'last-month':
      return monthSpan(s.getFullYear(), s.getMonth() - 1, 1);

    case 'this-quarter':
    case 'qtd':
    case 'last-quarter':
      return monthSpan(s.getFullYear(), s.getMonth() - 3, 3);

    case 'this-year':
    case 'ytd':
    case 'last-year':
    case 'yoy':
      return {
        startDate: new Date(s.getFullYear() - 1, 0, 1, 0, 0, 0, 0),
        endDate: new Date(s.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
      };

    default: {
      // last-12m / custom / anything else — same-length window ending the
      // instant before the current period begins.
      const durationMs = current.endDate.getTime() - s.getTime();
      const endDate = new Date(s.getTime() - 1);
      const startDate = new Date(endDate.getTime() - durationMs);
      return { startDate, endDate };
    }
  }
}
