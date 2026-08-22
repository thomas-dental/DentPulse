/**
 * Shared helpers for Dentally-matched activity reports (per-practitioner
 * ProviderActivity page and the all-practitioners PractitionerActivityReport
 * page): UK-calendar-day date windowing, display formatting, and paginated/
 * chunked Supabase fetch helpers. Extracted from ProviderActivity so both
 * pages stay reconciled the same way instead of drifting apart.
 */
import { supabase } from '@/integrations/supabase/client';

const PAGE_SIZE = 1000;

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// UTC instant of 00:00 in Europe/London for a given YYYY-MM-DD.
// The filter window must be the PRACTICE's UK calendar day — Dentally reports
// by UK local date. `new Date('YYYY-MM-DDT00:00:00')` is parsed in the
// VIEWER's browser timezone, so a viewer outside the UK (e.g. IST +5:30) gets
// a window shifted by hours: an evening-UK appointment then falls outside its
// own day (this is why "3 in Dentally" showed as "2 in our system").
export function ukDayStartUTC(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  // Treat the wall-clock midnight as if it were UTC, then measure how far
  // Europe/London actually sits from UTC at that moment (handles GMT/BST).
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

// Return the UTC instants bounding the UK calendar days [from .. to] inclusive.
export function localDayRange(from: string, to: string): { start: string; endExclusive: string } {
  const start = ukDayStartUTC(from);
  // First UK-midnight strictly after `to` = start of the next calendar day.
  const [ty, tm, td] = to.split('-').map(Number);
  const next = new Date(Date.UTC(ty, tm - 1, td + 1)); // rolls month/year over
  const toNext = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  const endExclusive = ukDayStartUTC(toNext);
  return { start: start.toISOString(), endExclusive: endExclusive.toISOString() };
}

// Render in the practice's timezone (UK), NOT the viewer's browser locale.
// Appointment timestamps are stored in UTC; Dentally shows them in UK local
// time. Without an explicit timeZone, toLocaleString uses the browser's zone,
// so a viewer outside the UK sees times shifted by hours (e.g. IST +5:30) and
// dates can roll across midnight — both mismatch Dentally's report.
export const PRACTICE_TZ = 'Europe/London';

export function fmtDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: PRACTICE_TZ,
  });
}

export function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: '2-digit',
    timeZone: PRACTICE_TZ,
  });
}

export function fmtCurrency(v: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

export function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'completed') return 'bg-green-100 text-green-700 border-green-200';
  if (s === 'cancelled') return 'bg-red-100 text-red-700 border-red-200';
  if (s === 'did not attend' || s === 'dna') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-blue-100 text-blue-700 border-blue-200';
}

export async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) { console.error('[activityReportUtils] fetch error:', error); break; }
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

/**
 * Fetch rows where `col` IN ids, chunked to stay within URL/IN limits.
 *
 * `integrationId` MUST be passed when `col` is a Dentally id (pt_id,
 * external_id, pp_id, platform_invoice_id): those ids are only unique PER
 * INTEGRATION (per Dentally practice). An org with multiple Dentally practices
 * connected reuses the same numeric ids for completely different records — so
 * a lookup scoped only by organization_id resolves to a same-id row from the
 * wrong practice (e.g. patient pt_id 11284 = "Jamie-Leigh Davies" in one
 * practice and "Ian Yeats" in another). Scoping by integration_id fixes that.
 */
export async function inChunks<T>(table: string, select: string, col: string, ids: (number | string)[], orgId: string, integrationId?: string | null): Promise<T[]> {
  const uniq = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += 300) {
    const slice = uniq.slice(i, i + 300);
    let q = (supabase as any)
      .from(table).select(select).eq('organization_id', orgId).in(col, slice);
    if (integrationId) q = q.eq('integration_id', integrationId);
    const { data, error } = await q;
    if (error) { console.error(`[activityReportUtils] ${table} chunk error:`, error); continue; }
    out.push(...((data ?? []) as T[]));
  }
  return out;
}
