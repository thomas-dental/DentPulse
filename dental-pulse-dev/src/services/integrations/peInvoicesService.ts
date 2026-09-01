/**
 * PE Invoices — direct Supabase reads (RLS-scoped), aged debt + collection rate + invoice list.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  agingBucketForDaysPastDue,
  daysPastDue,
  daysSinceInvoiceDate,
  isChargedInvoiceStatus,
  PE_AGING_BUCKET_ORDER,
  PE_CASH_LEAKAGE_DEFAULT_WINDOW_DAYS,
  PE_COLLECTION_RATE_DEFAULT_TRAILING_MONTHS,
  PE_AGING_BUCKET_LABELS,
  type PeAgingBucketId,
  todayUtcYmd,
  trailingSinceIsoDate,
} from '@/lib/peInvoicesConstants';

const PAGE_SIZE = 1000;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type PeAgedDebtBucket = {
  bucket: PeAgingBucketId;
  label: string;
  outstandingGbp: number;
  invoiceCount: number;
};

export type PeInvoiceListRow = {
  practiceId: string;
  practiceName: string;
  platformInvoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amountGbp: number;
  outstandingGbp: number;
  daysPastDue: number;
  daysSinceRaised: number;
  agingBucket: PeAgingBucketId;
  status: string;
  isPaid: boolean;
  isOutstanding: boolean;
  isCashLeakage: boolean;
  patientId: number | null;
  patientUuid: string | null;
  patientName: string | null;
  onPaymentPlan: boolean;
  locationId: string | null;
  locationName: string | null;
};

export type PeCollectionRatePracticeRow = {
  practiceId: string;
  practiceName: string;
  invoicedGbp: number;
  collectedGbp: number;
  collectionRate: number | null;
};

export type PeInvoicesSummary = {
  trailingMonths: number;
  trailingSince: string;
  cashLeakageWindowDays: number;
  cashLeakageCount: number;
  cashLeakageGbp: number;
  totalOutstandingGbp: number;
  overdue60PlusGbp: number;
  collectedTrailingGbp: number;
  invoicedTrailingGbp: number;
  collectionRate: number | null;
  onPaymentPlanOutstandingGbp: number;
  onPaymentPlanArrangementCount: number;
  agedBuckets: PeAgedDebtBucket[];
  invoiceListRows: PeInvoiceListRow[];
  collectionByPractice: PeCollectionRatePracticeRow[];
  rollupMode: 'location' | 'practice';
};

async function fetchAllPages<T>(
  buildQuery: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export async function loadPeEconomicAssumptions(practiceId: string): Promise<{
  trailingMonths: number;
  cashLeakageWindowDays: number;
  agingBucketBoundaryDays: number[];
}> {
  const { data, error } = await (supabase as any)
    .from('pe_economic_assumptions')
    .select(
      'collection_rate_trailing_months, cash_leakage_collection_window_days, aging_bucket_boundary_days',
    )
    .eq('practice_id', practiceId)
    .maybeSingle();

  const parseBoundaries = (raw: unknown): number[] => {
    if (Array.isArray(raw)) {
      const nums = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
      if (nums.length >= 3) return nums.slice(0, 3);
    }
    return [30, 60, 90];
  };

  const defaultAssumptions = {
    trailingMonths: PE_COLLECTION_RATE_DEFAULT_TRAILING_MONTHS,
    cashLeakageWindowDays: PE_CASH_LEAKAGE_DEFAULT_WINDOW_DAYS,
    agingBucketBoundaryDays: [30, 60, 90],
  };

  if (error) {
    const msg = String(error.message || '');
    if (
      msg.includes('collection_rate_trailing_months') ||
      msg.includes('cash_leakage_collection_window_days') ||
      msg.includes('aging_bucket_boundary_days')
    ) {
      return defaultAssumptions;
    }
    throw error;
  }

  const trailingRaw = data?.collection_rate_trailing_months;
  const trailingN = Number(trailingRaw);
  const windowRaw = data?.cash_leakage_collection_window_days;
  const windowN = Number(windowRaw);

  return {
    trailingMonths:
      Number.isFinite(trailingN) && trailingN > 0
        ? Math.round(trailingN)
        : PE_COLLECTION_RATE_DEFAULT_TRAILING_MONTHS,
    cashLeakageWindowDays:
      Number.isFinite(windowN) && windowN > 0
        ? Math.round(windowN)
        : PE_CASH_LEAKAGE_DEFAULT_WINDOW_DAYS,
    agingBucketBoundaryDays: parseBoundaries(data?.aging_bucket_boundary_days),
  };
}

export async function loadUserPracticeIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('organization_id')
    .eq('user_id', userId);

  if (error) throw error;

  return [
    ...new Set(
      (data ?? [])
        .map((r) => r.organization_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
}

async function loadPracticeNames(practiceIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (practiceIds.length === 0) return map;

  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .in('id', practiceIds);

  if (error) throw error;

  for (const row of data ?? []) {
    map.set(String(row.id), String(row.name || 'Practice').trim() || 'Practice');
  }
  return map;
}

type RawInvoiceRow = {
  organization_id: string;
  platform_invoice_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  subtotal: number | string | null;
  amount_outstanding: number | string | null;
  status: string | null;
  is_paid: boolean | null;
  patient_id: number | string | null;
  location_id: string | null;
};

function outstandingGbpFromRow(row: RawInvoiceRow): number {
  const outstanding = num(row.amount_outstanding);
  if (outstanding > 0) return outstanding;
  if (row.is_paid) return 0;
  return num(row.subtotal);
}

function isOutstandingInvoice(row: RawInvoiceRow): boolean {
  return outstandingGbpFromRow(row) > 0 && String(row.status || '').toLowerCase() !== 'voided';
}

function isChargedInvoice(row: RawInvoiceRow): boolean {
  if (!row.invoice_date) return false;
  if (num(row.subtotal) <= 0) return false;
  return isChargedInvoiceStatus(row.status);
}

function isCashLeakageInvoice(
  row: RawInvoiceRow,
  today: string,
  windowDays: number,
): boolean {
  if (!isChargedInvoice(row)) return false;
  if (!isOutstandingInvoice(row)) return false;
  return daysSinceInvoiceDate(row.invoice_date, today) >= windowDays;
}

function listInvoiceScope(row: RawInvoiceRow, trailingSince: string): boolean {
  const date = row.invoice_date ? String(row.invoice_date).slice(0, 10) : null;
  if (date && date >= trailingSince) return true;
  return isOutstandingInvoice(row);
}

async function loadInvoicesForPractices(practiceIds: string[]): Promise<RawInvoiceRow[]> {
  if (practiceIds.length === 0) return [];

  return fetchAllPages<RawInvoiceRow>((from, to) =>
    (supabase as any)
      .from('platform_integration_invoices')
      .select(
        'organization_id, platform_invoice_id, invoice_number, invoice_date, due_date, subtotal, amount_outstanding, status, is_paid, patient_id, location_id',
      )
      .in('organization_id', practiceIds)
      .eq('platform_type', 'dentally')
      .is('deleted_at', null)
      .order('invoice_date', { ascending: false })
      .range(from, to),
  );
}

async function loadPatientMetaByOrg(
  orgPatientIds: Map<string, number[]>,
): Promise<Map<string, Map<number, { name: string | null; patientUuid: string | null; onPaymentPlan: boolean }>>> {
  const result = new Map<
    string,
    Map<number, { name: string | null; patientUuid: string | null; onPaymentPlan: boolean }>
  >();

  for (const [orgId, ids] of orgPatientIds) {
    const map = new Map<
      number,
      { name: string | null; patientUuid: string | null; onPaymentPlan: boolean }
    >();
    const uniq = [...new Set(ids)].filter((id) => id > 0);
    if (uniq.length === 0) {
      result.set(orgId, map);
      continue;
    }

    for (let i = 0; i < uniq.length; i += 300) {
      const slice = uniq.slice(i, i + 300);
      const { data, error } = await (supabase as any)
        .from('patients')
        .select('id, pt_id, pt_first_name, pt_last_name, pt_payment_plan_id')
        .eq('organization_id', orgId)
        .in('pt_id', slice)
        .is('deleted_at', null);

      if (error) throw error;

      for (const row of data ?? []) {
        const id = num(row.pt_id);
        if (!id) continue;
        const name = [row.pt_first_name, row.pt_last_name].filter(Boolean).join(' ').trim();
        map.set(id, {
          name: name || null,
          patientUuid: row.id != null ? String(row.id) : null,
          onPaymentPlan: row.pt_payment_plan_id != null && num(row.pt_payment_plan_id) > 0,
        });
      }
    }
    result.set(orgId, map);
  }

  return result;
}

async function loadLocationNamesByOrg(orgIds: string[]): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();

  for (const orgId of orgIds) {
    const map = new Map<string, string>();
    const { data, error } = await (supabase as any)
      .from('practice_locations')
      .select('id, location_name')
      .eq('organization_id', orgId)
      .is('deleted_at', null);

    if (error) throw error;

    for (const row of data ?? []) {
      if (row.id) map.set(String(row.id), String(row.location_name || 'Site').trim());
    }
    result.set(orgId, map);
  }

  return result;
}

function buildAgedBuckets(
  invoices: Array<{ outstandingGbp: number; bucket: PeAgingBucketId }>,
): PeAgedDebtBucket[] {
  const totals = new Map<PeAgingBucketId, { gbp: number; count: number }>();
  for (const id of PE_AGING_BUCKET_ORDER) {
    totals.set(id, { gbp: 0, count: 0 });
  }
  for (const row of invoices) {
    const t = totals.get(row.bucket)!;
    t.gbp += row.outstandingGbp;
    t.count += 1;
  }
  return PE_AGING_BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: PE_AGING_BUCKET_LABELS[bucket],
    outstandingGbp: Math.round(totals.get(bucket)!.gbp * 100) / 100,
    invoiceCount: totals.get(bucket)!.count,
  }));
}

function mapRawToListRow(
  row: RawInvoiceRow,
  practiceName: string,
  patientMeta: Map<number, { name: string | null; patientUuid: string | null; onPaymentPlan: boolean }>,
  locationNames: Map<string, string>,
  today: string,
  cashLeakageWindowDays: number,
  agingBucketBoundaryDays: number[],
): PeInvoiceListRow {
  const outstandingGbp = Math.round(outstandingGbpFromRow(row) * 100) / 100;
  const dpd = daysPastDue(row.due_date, row.invoice_date, today);
  const daysSinceRaised = daysSinceInvoiceDate(row.invoice_date, today);
  const ptId = num(row.patient_id) || null;
  const orgId = String(row.organization_id);
  const meta = ptId != null ? patientMeta.get(ptId) : undefined;

  return {
    practiceId: orgId,
    practiceName,
    platformInvoiceId: String(row.platform_invoice_id),
    invoiceNumber: row.invoice_number != null ? String(row.invoice_number) : null,
    invoiceDate: row.invoice_date ? String(row.invoice_date).slice(0, 10) : null,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    amountGbp: num(row.subtotal),
    outstandingGbp,
    daysPastDue: dpd,
    daysSinceRaised,
    agingBucket: agingBucketForDaysPastDue(dpd, agingBucketBoundaryDays),
    status: String(row.status || (row.is_paid ? 'paid' : 'outstanding')),
    isPaid: Boolean(row.is_paid) || outstandingGbp <= 0,
    isOutstanding: isOutstandingInvoice(row),
    isCashLeakage: isCashLeakageInvoice(row, today, cashLeakageWindowDays),
    patientId: ptId,
    patientUuid: meta?.patientUuid ?? null,
    patientName: meta?.name ?? null,
    onPaymentPlan: meta?.onPaymentPlan ?? false,
    locationId: row.location_id != null ? String(row.location_id) : null,
    locationName:
      row.location_id != null ? locationNames.get(String(row.location_id)) ?? null : null,
  };
}

async function loadLocationsForOrg(organizationId: string): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await (supabase as any)
    .from('practice_locations')
    .select('id, location_name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('location_name');

  if (error) throw error;

  return (data ?? [])
    .map((row: { id: string; location_name: string | null }) => ({
      id: String(row.id),
      name: String(row.location_name || 'Site').trim() || 'Site',
    }))
    .filter((row) => row.id.length > 0);
}

type PeRollupUnit = {
  unitId: string;
  unitName: string;
  unitType: 'location' | 'practice';
  organizationId: string;
  locationId: string | null;
};

async function resolvePeRollupUnits(
  userId: string,
  contextPracticeId: string,
): Promise<{ rollupMode: 'location' | 'practice'; units: PeRollupUnit[] }> {
  const practiceIds = await loadUserPracticeIds(userId);
  const organizationIds =
    practiceIds.length > 0
      ? practiceIds.includes(contextPracticeId)
        ? practiceIds
        : [...practiceIds, contextPracticeId]
      : [contextPracticeId];

  const practiceNames = await loadPracticeNames(organizationIds);
  const units: PeRollupUnit[] = [];

  for (const orgId of organizationIds) {
    const orgName = practiceNames.get(orgId) ?? 'Practice';
    const locations = await loadLocationsForOrg(orgId);

    if (locations.length > 1) {
      for (const loc of locations) {
        units.push({
          unitId: loc.id,
          unitName: loc.name,
          unitType: 'location',
          organizationId: orgId,
          locationId: loc.id,
        });
      }
    } else {
      units.push({
        unitId: orgId,
        unitName: orgName,
        unitType: 'practice',
        organizationId: orgId,
        locationId: locations[0]?.id ?? null,
      });
    }
  }

  units.sort((a, b) => a.unitName.localeCompare(b.unitName));
  const rollupMode = units.some((u) => u.unitType === 'location') ? 'location' : 'practice';

  return { rollupMode, units };
}

async function sumInvoicedInPeriod(
  organizationId: string,
  since: string,
  today: string,
  locationId: string | null = null,
): Promise<number> {
  const rows = await fetchAllPages<{ subtotal: number | string | null }>((from, to) => {
    let query = (supabase as any)
      .from('platform_integration_invoices')
      .select('subtotal')
      .eq('organization_id', organizationId)
      .eq('platform_type', 'dentally')
      .gte('invoice_date', since)
      .lte('invoice_date', today)
      .is('deleted_at', null);

    if (locationId) query = query.eq('location_id', locationId);

    return query.range(from, to);
  });
  return rows.reduce((s, r) => s + num(r.subtotal), 0);
}

async function sumCollectedInPeriod(
  organizationId: string,
  since: string,
  today: string,
  locationId: string | null = null,
): Promise<number> {
  const rows = await fetchAllPages<{ dp_amount: number | string | null }>((from, to) => {
    let query = (supabase as any)
      .from('dentally_payments')
      .select('dp_amount')
      .eq('organization_id', organizationId)
      .gte('dp_dated_on', since)
      .lte('dp_dated_on', today)
      .is('deleted_at', null);

    if (locationId) query = query.eq('location_id', locationId);

    return query.range(from, to);
  });
  return rows.reduce((s, r) => s + num(r.dp_amount), 0);
}

export async function fetchPeInvoicesSummary(
  contextPracticeId: string,
  userId: string,
): Promise<PeInvoicesSummary> {
  const { trailingMonths, cashLeakageWindowDays, agingBucketBoundaryDays } =
    await loadPeEconomicAssumptions(contextPracticeId);
  const trailingSince = trailingSinceIsoDate(trailingMonths);
  const today = todayUtcYmd();

  const { rollupMode, units } = await resolvePeRollupUnits(userId, contextPracticeId);
  const scopedIds = [...new Set(units.map((u) => u.organizationId))];
  const practiceNames = await loadPracticeNames(scopedIds);

  const rawAll = await loadInvoicesForPractices(scopedIds);
  const rawScoped = rawAll.filter((r) => listInvoiceScope(r, trailingSince));

  const orgPatientIds = new Map<string, number[]>();
  for (const row of rawScoped) {
    const orgId = String(row.organization_id);
    const ptId = num(row.patient_id);
    if (!ptId) continue;
    const list = orgPatientIds.get(orgId) ?? [];
    list.push(ptId);
    orgPatientIds.set(orgId, list);
  }

  const patientMetaByOrg = await loadPatientMetaByOrg(orgPatientIds);
  const locationNamesByOrg = await loadLocationNamesByOrg(scopedIds);

  const invoiceListRows: PeInvoiceListRow[] = rawScoped.map((row) => {
    const orgId = String(row.organization_id);
    return mapRawToListRow(
      row,
      practiceNames.get(orgId) ?? 'Practice',
      patientMetaByOrg.get(orgId) ?? new Map(),
      locationNamesByOrg.get(orgId) ?? new Map(),
      today,
      cashLeakageWindowDays,
      agingBucketBoundaryDays,
    );
  });

  invoiceListRows.sort((a, b) => {
    if (a.isCashLeakage !== b.isCashLeakage) return a.isCashLeakage ? -1 : 1;
    if (b.daysPastDue !== a.daysPastDue) return b.daysPastDue - a.daysPastDue;
    if (b.outstandingGbp !== a.outstandingGbp) return b.outstandingGbp - a.outstandingGbp;
    return (b.invoiceDate ?? '').localeCompare(a.invoiceDate ?? '');
  });

  const contextOutstanding = invoiceListRows.filter(
    (r) => r.practiceId === contextPracticeId && r.isOutstanding,
  );

  const agedBuckets = buildAgedBuckets(
    contextOutstanding.map((r) => ({
      outstandingGbp: r.outstandingGbp,
      bucket: r.agingBucket,
    })),
  );

  const totalOutstandingGbp = contextOutstanding.reduce((s, r) => s + r.outstandingGbp, 0);
  const overdue60PlusGbp = contextOutstanding
    .filter((r) => r.daysPastDue > 60)
    .reduce((s, r) => s + r.outstandingGbp, 0);

  const cashLeakageRows = invoiceListRows.filter((r) => r.isCashLeakage);
  const cashLeakageGbp = cashLeakageRows.reduce((s, r) => s + r.outstandingGbp, 0);

  const paymentPlanPatients = new Set<string>();
  let onPaymentPlanOutstandingGbp = 0;
  for (const row of invoiceListRows) {
    if (!row.isOutstanding || !row.onPaymentPlan) continue;
    onPaymentPlanOutstandingGbp += row.outstandingGbp;
    if (row.patientId != null) {
      paymentPlanPatients.add(`${row.practiceId}:${row.patientId}`);
    }
  }

  const collectionByPractice: PeCollectionRatePracticeRow[] = await Promise.all(
    units.map(async (unit) => {
      const invoicedGbp = await sumInvoicedInPeriod(
        unit.organizationId,
        trailingSince,
        today,
        unit.locationId,
      );
      const collectedGbp = await sumCollectedInPeriod(
        unit.organizationId,
        trailingSince,
        today,
        unit.locationId,
      );
      const collectionRate =
        invoicedGbp > 0 ? Math.round((collectedGbp / invoicedGbp) * 1000) / 1000 : null;
      return {
        practiceId: unit.unitId,
        practiceName: unit.unitName,
        invoicedGbp: Math.round(invoicedGbp * 100) / 100,
        collectedGbp: Math.round(collectedGbp * 100) / 100,
        collectionRate,
      };
    }),
  );

  collectionByPractice.sort((a, b) => a.practiceName.localeCompare(b.practiceName));

  const contextRow =
    collectionByPractice.find((r) => r.practiceId === contextPracticeId) ??
    collectionByPractice.find((r) => scopedIds.includes(r.practiceId)) ??
    collectionByPractice[0];

  return {
    trailingMonths,
    trailingSince,
    cashLeakageWindowDays,
    rollupMode,
    cashLeakageCount: cashLeakageRows.length,
    cashLeakageGbp: Math.round(cashLeakageGbp * 100) / 100,
    totalOutstandingGbp: Math.round(totalOutstandingGbp * 100) / 100,
    overdue60PlusGbp: Math.round(overdue60PlusGbp * 100) / 100,
    collectedTrailingGbp: contextRow?.collectedGbp ?? 0,
    invoicedTrailingGbp: contextRow?.invoicedGbp ?? 0,
    collectionRate: contextRow?.collectionRate ?? null,
    onPaymentPlanOutstandingGbp: Math.round(onPaymentPlanOutstandingGbp * 100) / 100,
    onPaymentPlanArrangementCount: paymentPlanPatients.size,
    agedBuckets,
    invoiceListRows,
    collectionByPractice,
  };
}
