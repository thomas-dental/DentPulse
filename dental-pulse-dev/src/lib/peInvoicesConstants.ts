/**
 * PE Invoices — aging buckets and collection-rate window defaults.
 * Aligned with supabase/migrations/20260830220001_collection_rate_trailing_months.sql
 */

export const PE_COLLECTION_RATE_DEFAULT_TRAILING_MONTHS = 12;
export const PE_CASH_LEAKAGE_DEFAULT_WINDOW_DAYS = 30;

export type PeAgingBucketId = '0-30' | '31-60' | '61-90' | '90+';

export const PE_AGING_BUCKET_ORDER: PeAgingBucketId[] = ['0-30', '31-60', '61-90', '90+'];

export const PE_AGING_BUCKET_LABELS: Record<PeAgingBucketId, string> = {
  '0-30': '0–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': '90+ days',
};

/** Short labels for aged-debt chart (mockup: Current, 31–60d, …). */
export const PE_AGING_BUCKET_CHART_LABELS: Record<PeAgingBucketId, string> = {
  '0-30': 'Current',
  '31-60': '31–60d',
  '61-90': '61–90d',
  '90+': '90d+',
};

export const PE_COLLECTION_RATE_TARGET_DEFAULT = 0.93;

export type PeInvoiceDisplayStatus = 'paid' | 'current' | 'part-paid' | 'overdue';

export function deriveInvoiceDisplayStatus(row: {
  isPaid: boolean;
  isOutstanding: boolean;
  outstandingGbp: number;
  amountGbp: number;
  daysPastDue: number;
  agingBucket: PeAgingBucketId;
}): PeInvoiceDisplayStatus {
  if (row.isPaid || !row.isOutstanding || row.outstandingGbp <= 0) return 'paid';
  if (row.agingBucket !== '0-30' || row.daysPastDue > 30) return 'overdue';
  if (row.amountGbp > 0 && row.outstandingGbp < row.amountGbp) return 'part-paid';
  return 'current';
}

export const PE_INVOICE_DISPLAY_STATUS_LABELS: Record<PeInvoiceDisplayStatus, string> = {
  paid: 'Paid',
  current: 'Current',
  'part-paid': 'Part-paid',
  overdue: 'Overdue',
};

/** Days past due anchor (due_date, else invoice_date). Not-yet-due → 0 (current bucket). */
export function daysPastDue(
  dueDate: string | null | undefined,
  invoiceDate: string | null | undefined,
  todayYmd: string,
): number {
  const anchor = (dueDate && dueDate.slice(0, 10)) || (invoiceDate && invoiceDate.slice(0, 10));
  if (!anchor) return 0;
  const a = new Date(`${anchor}T00:00:00.000Z`);
  const b = new Date(`${todayYmd}T00:00:00.000Z`);
  const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

export function agingBucketForDaysPastDue(
  days: number,
  boundaries: number[] = [30, 60, 90],
): PeAgingBucketId {
  const b0 = boundaries[0] ?? 30;
  const b1 = boundaries[1] ?? 60;
  const b2 = boundaries[2] ?? 90;
  if (days <= b0) return '0-30';
  if (days <= b1) return '31-60';
  if (days <= b2) return '61-90';
  return '90+';
}

export function trailingSinceIsoDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Calendar days from invoice_date (charged) to today. */
export function daysSinceInvoiceDate(
  invoiceDate: string | null | undefined,
  todayYmd: string,
): number {
  const anchor = invoiceDate && invoiceDate.slice(0, 10);
  if (!anchor) return 0;
  const a = new Date(`${anchor}T00:00:00.000Z`);
  const b = new Date(`${todayYmd}T00:00:00.000Z`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function isChargedInvoiceStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase();
  return s !== 'draft' && s !== 'voided' && s !== 'deleted';
}
