/**
 * Liquidity & Solvency for the Growth page.
 *
 * Step 1 (always available from cashflow + EBITDA mappings):
 *   - Days of Cash, Interest Coverage, monthly trends for both
 *
 * Step 2 (requires full Xero Balance Sheet sync):
 *   - Current / Quick / Cash ratios, Working Capital
 *   - Debt/Equity, Debt/Assets, Equity Ratio, Capital Structure
 *   - Headline ratios use the latest BS month-end at or before the selected
 *     period end (sync often lags the calendar). Monthly trend points stay
 *     exact so empty months render as gaps.
 *
 * Step 3 (loan schedules — not available yet):
 *   - Debt Maturity & DSCR stay unavailable
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { fetchEbitdaAddBacks } from '@/hooks/useEbitdaBridge';
import { getProfitBenchmark } from '@/services/profitBenchmarkService';
import { deriveActualProfit } from '@/utils/profitBenchmarkActual';
import type { CashflowGrowthMonth } from '@/hooks/useCashflowGrowth';

export type RatioStatus = 'Strong' | 'Healthy' | 'Watch' | 'Weak' | 'N/A';

export interface RatioMetric {
  current: number;
  prior: number | null;
  benchmark: number;
  status: RatioStatus;
  available: boolean;
}

export interface LiquiditySolvencyData {
  // Liquidity
  currentRatio: RatioMetric;
  quickRatio: RatioMetric;
  cashRatio: RatioMetric;
  daysOfCash: RatioMetric;
  workingCapital: {
    current: number;
    prior: number | null;
    change: number | null;
    available: boolean;
  };
  liquidityTrends: Array<{
    month: string;
    monthFull: string;
    currentRatio: number | null;
    quickRatio: number | null;
    cashRatio: number | null;
    daysOfCash: number | null;
  }>;

  // Solvency
  debtToEquity: RatioMetric;
  debtToAssets: RatioMetric;
  interestCoverage: RatioMetric;
  equityRatio: RatioMetric;
  debtServiceCoverage: RatioMetric; // Step 3 — unavailable
  solvencyTrends: Array<{
    month: string;
    monthFull: string;
    debtToEquity: number | null;
    debtToAssets: number | null;
    interestCoverage: number | null;
  }>;

  // Capital structure
  capitalStructure: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    currentAssets: number;
    currentLiabilities: number;
    longTermDebt: number;
    shortTermDebt: number;
    available: boolean;
  };

  hasFullBalanceSheet: boolean;
  /** Actual BS month-end used (may lag the selected period end). */
  balanceSheetAsOf: string | null;
  isLoading: boolean;
  error: unknown;
}

const PAGE = 1000;

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysInclusive(start: Date, end: Date): number {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate();
}

function monthEndIso(year: number, monthIdx: number): string {
  const d = new Date(Date.UTC(year, monthIdx + 1, 0));
  return d.toISOString().slice(0, 10);
}

function statusHigherBetter(value: number, benchmark: number): RatioStatus {
  if (!Number.isFinite(value)) return 'N/A';
  if (value >= benchmark * 1.25) return 'Strong';
  if (value >= benchmark) return 'Healthy';
  if (value >= benchmark * 0.75) return 'Watch';
  return 'Weak';
}

function statusLowerBetter(value: number, benchmark: number): RatioStatus {
  if (!Number.isFinite(value)) return 'N/A';
  if (value <= benchmark * 0.75) return 'Strong';
  if (value <= benchmark) return 'Healthy';
  if (value <= benchmark * 1.25) return 'Watch';
  return 'Weak';
}

function metric(
  current: number,
  benchmark: number,
  higherIsBetter: boolean,
  available: boolean,
  prior: number | null = null,
): RatioMetric {
  if (!available || !Number.isFinite(current)) {
    return { current: 0, prior, benchmark, status: 'N/A', available: false };
  }
  return {
    current,
    prior,
    benchmark,
    status: higherIsBetter ? statusHigherBetter(current, benchmark) : statusLowerBetter(current, benchmark),
    available: true,
  };
}

function isCashSection(section: string): boolean {
  const t = section.trim().toLowerCase();
  return t.includes('cash at bank') || t === 'bank' || t.includes('bank and in hand') || t.includes('bank account');
}

function isNonCurrentLabel(s: string): boolean {
  return (
    s.includes('non-current') ||
    s.includes('non current') ||
    s.includes('noncurrent') ||
    s.includes('long-term') ||
    s.includes('long term') ||
    s.includes('fixed asset')
  );
}

function classifySection(section: string, accountType: string | null): {
  bucket:
    | 'cash'
    | 'inventory'
    | 'currentAsset'
    | 'nonCurrentAsset'
    | 'currentLiability'
    | 'nonCurrentLiability'
    | 'equity'
    | 'other';
} {
  const s = section.trim().toLowerCase();
  const t = String(accountType || '').trim().toUpperCase();

  if (isCashSection(section) || t === 'BANK' || t === 'CREDITCARD') return { bucket: 'cash' };
  if (t === 'INVENTORY' || s.includes('inventory') || s.includes('stock')) return { bucket: 'inventory' };
  if (t === 'EQUITY' || s.includes('equity') || s.includes('retained') || s.includes('capital') || s.includes('shareholder')) {
    return { bucket: 'equity' };
  }
  // Non-current MUST be checked before "current" — "Non-Current Liabilities" contains "current".
  if (
    t === 'TERMLIAB' ||
    t === 'LIABILITY' ||
    (isNonCurrentLabel(s) && (s.includes('liabilit') || s.includes('creditor') || s.includes('loan')))
  ) {
    return { bucket: 'nonCurrentLiability' };
  }
  if (t === 'CURRLIAB' || (s.includes('current') && (s.includes('liabilit') || s.includes('creditor')))) {
    return { bucket: 'currentLiability' };
  }
  if (s.includes('liabilit') || s.includes('creditor') || s.includes('loan')) {
    return { bucket: 'nonCurrentLiability' };
  }
  if (t === 'FIXED' || t === 'NONCURRENT' || (isNonCurrentLabel(s) && s.includes('asset'))) {
    return { bucket: 'nonCurrentAsset' };
  }
  if (t === 'CURRENT' || (s.includes('current') && s.includes('asset'))) {
    return { bucket: 'currentAsset' };
  }
  if (s.includes('asset')) return { bucket: 'nonCurrentAsset' };
  return { bucket: 'other' };
}

interface BsSnapshot {
  cash: number;
  inventory: number;
  currentAssets: number;
  nonCurrentAssets: number;
  currentLiabilities: number;
  nonCurrentLiabilities: number;
  equity: number;
  totalAssets: number;
  totalLiabilities: number;
  hasFullBs: boolean;
}

function emptySnapshot(): BsSnapshot {
  return {
    cash: 0,
    inventory: 0,
    currentAssets: 0,
    nonCurrentAssets: 0,
    currentLiabilities: 0,
    nonCurrentLiabilities: 0,
    equity: 0,
    totalAssets: 0,
    totalLiabilities: 0,
    hasFullBs: false,
  };
}

function rollupBsRows(
  rows: Array<{ section: string; amount: number; account_type: string | null }>,
): BsSnapshot {
  const snap = emptySnapshot();
  let nonCashRows = 0;

  for (const row of rows) {
    const amt = Number(row.amount) || 0;
    const { bucket } = classifySection(row.section || '', row.account_type);
    if (bucket !== 'cash') nonCashRows += 1;

    switch (bucket) {
      case 'cash':
        snap.cash += amt;
        snap.currentAssets += amt;
        break;
      case 'inventory':
        snap.inventory += amt;
        snap.currentAssets += amt;
        break;
      case 'currentAsset':
        snap.currentAssets += amt;
        break;
      case 'nonCurrentAsset':
        snap.nonCurrentAssets += amt;
        break;
      case 'currentLiability':
        snap.currentLiabilities += amt;
        break;
      case 'nonCurrentLiability':
        snap.nonCurrentLiabilities += amt;
        break;
      case 'equity':
        snap.equity += amt;
        break;
      default:
        break;
    }
  }

  snap.totalAssets = snap.currentAssets + snap.nonCurrentAssets;
  snap.totalLiabilities = Math.abs(snap.currentLiabilities) + Math.abs(snap.nonCurrentLiabilities);
  snap.currentLiabilities = Math.abs(snap.currentLiabilities);
  snap.nonCurrentLiabilities = Math.abs(snap.nonCurrentLiabilities);
  snap.equity = Math.abs(snap.equity);
  // Full BS if we saw non-cash classified rows (CA/CL/equity/etc.)
  snap.hasFullBs = nonCashRows > 0 && (snap.currentLiabilities > 0 || snap.equity > 0 || snap.nonCurrentAssets > 0);
  return snap;
}

async function fetchAll<T>(build: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

/**
 * Resolve the latest Balance Sheet month-end at or before `toDate`.
 * Sync often lags the selected calendar period (e.g. "This Year" → Dec while
 * data only exists through July), so exact equality would leave ratios empty.
 */
async function resolveLatestBsToDate(
  organizationId: string,
  toDate: string,
  tenantIds: string[] | null,
): Promise<string | null> {
  let q = (supabase as any)
    .from('xero_balance_sheet')
    .select('to_date')
    .eq('organization_id', organizationId)
    .lte('to_date', toDate)
    .order('to_date', { ascending: false })
    .limit(1);

  if (tenantIds && tenantIds.length === 1) q = q.eq('xero_tenant_id', tenantIds[0]);
  else if (tenantIds && tenantIds.length > 1) q = q.in('xero_tenant_id', tenantIds);

  const { data, error } = await q;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const resolved = row?.to_date ? String(row.to_date).slice(0, 10) : null;
  return resolved;
}

async function loadBsSnapshot(
  organizationId: string,
  toDate: string,
  tenantIds: string[] | null,
  options?: { exact?: boolean },
): Promise<{ snap: BsSnapshot; asOf: string | null }> {
  const exact = options?.exact === true;
  const resolvedToDate = exact
    ? toDate
    : (await resolveLatestBsToDate(organizationId, toDate, tenantIds));

  if (!resolvedToDate) return { snap: emptySnapshot(), asOf: null };

  const bsRows = await fetchAll<{
    section: string;
    amount: number;
    xero_account_id: string;
    xero_tenant_id: string;
  }>(async (from, to) => {
    let q = (supabase as any)
      .from('xero_balance_sheet')
      .select('section, amount, xero_account_id, xero_tenant_id')
      .eq('organization_id', organizationId)
      .eq('to_date', resolvedToDate);

    if (tenantIds && tenantIds.length === 1) q = q.eq('xero_tenant_id', tenantIds[0]);
    else if (tenantIds && tenantIds.length > 1) q = q.in('xero_tenant_id', tenantIds);

    return q.range(from, to);
  });

  if (bsRows.length === 0) return { snap: emptySnapshot(), asOf: null };

  const accountIds = [...new Set(bsRows.map((r) => r.xero_account_id).filter(Boolean))];
  const coaTypeByAccount = new Map<string, string | null>();
  if (accountIds.length > 0) {
    for (let i = 0; i < accountIds.length; i += 200) {
      const chunk = accountIds.slice(i, i + 200);
      const { data } = await (supabase as any)
        .from('xero_chart_of_accounts')
        .select('xero_account_id, account_type')
        .eq('organization_id', organizationId)
        .in('xero_account_id', chunk);
      for (const c of (data ?? []) as Array<{ xero_account_id: string; account_type: string | null }>) {
        coaTypeByAccount.set(String(c.xero_account_id), c.account_type);
      }
    }
  }

  return {
    snap: rollupBsRows(
      bsRows.map((r) => ({
        section: r.section || '',
        amount: Number(r.amount) || 0,
        account_type: coaTypeByAccount.get(String(r.xero_account_id)) ?? null,
      })),
    ),
    asOf: resolvedToDate,
  };
}

async function resolveTenantIds(
  organizationId: string,
  locationIds: string[] | null,
): Promise<string[] | null> {
  if (!locationIds || locationIds.length === 0) {
    // All locations → all mapped practice tenants
    const { data } = await (supabase as any)
      .from('platform_integration_organization_mapping')
      .select('platform_integration_organizations_id, location_id')
      .eq('organization_id', organizationId)
      .not('location_id', 'is', null);
    const ids = [
      ...new Set(
        ((data ?? []) as Array<{ platform_integration_organizations_id: string | null }>)
          .map((r) => r.platform_integration_organizations_id)
          .filter(Boolean)
          .map(String),
      ),
    ];
    return ids.length > 0 ? ids : null;
  }

  const { data } = await (supabase as any)
    .from('platform_integration_organization_mapping')
    .select('platform_integration_organizations_id, location_id')
    .eq('organization_id', organizationId)
    .in('location_id', locationIds);

  const ids = [
    ...new Set(
      ((data ?? []) as Array<{ platform_integration_organizations_id: string | null }>)
        .map((r) => r.platform_integration_organizations_id)
        .filter(Boolean)
        .map(String),
    ),
  ];
  return ids.length > 0 ? ids : [];
}

async function sumInterestByMonth(
  organizationId: string,
  locationId: string | null,
  fromDate: string,
  toDate: string,
): Promise<Map<string, number>> {
  const addBacksAccounts = await (async () => {
    let locQ = (supabase as any)
      .from('practice_locations')
      .select('ebitda_interest_accounts')
      .eq('organization_id', organizationId)
      .is('deleted_at', null);
    if (locationId) locQ = locQ.eq('id', locationId);
    const { data: locs } = await locQ;
    const ids = new Set<string>();
    for (const row of (locs ?? []) as Array<{ ebitda_interest_accounts?: unknown }>) {
      const arr = Array.isArray(row.ebitda_interest_accounts) ? row.ebitda_interest_accounts : [];
      for (const id of arr) {
        const s = String(id || '').trim();
        if (s) ids.add(s);
      }
    }
    return [...ids];
  })();

  const out = new Map<string, number>();
  if (addBacksAccounts.length === 0) return out;

  const [{ data: byId }, { data: byXero }] = await Promise.all([
    (supabase as any)
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id')
      .eq('organization_id', organizationId)
      .in('id', addBacksAccounts),
    (supabase as any)
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id')
      .eq('organization_id', organizationId)
      .in('xero_account_id', addBacksAccounts),
  ]);

  const xeroIds = new Set<string>();
  for (const c of [...(byId ?? []), ...(byXero ?? [])] as Array<{ xero_account_id: string | null }>) {
    if (c.xero_account_id) xeroIds.add(String(c.xero_account_id));
  }
  // Also allow raw GUIDs stored directly
  for (const id of addBacksAccounts) xeroIds.add(id);
  const accountIds = [...xeroIds];
  if (accountIds.length === 0) return out;

  const journals = await fetchAll<{ journal_date: string; net_amount: number | null }>((from, to) =>
    (supabase as any)
      .from('xero_journal_details')
      .select('journal_date, net_amount')
      .eq('organization_id', organizationId)
      .in('account_id', accountIds)
      .gte('journal_date', fromDate)
      .lte('journal_date', toDate)
      .range(from, to),
  );

  for (const j of journals) {
    const key = String(j.journal_date || '').slice(0, 7);
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + (Number(j.net_amount) || 0));
  }

  // abs for expense display
  for (const [k, v] of out) out.set(k, Math.abs(v));
  return out;
}

function ratiosFromSnapshot(snap: BsSnapshot, prior: BsSnapshot | null) {
  const cl = snap.currentLiabilities;
  const ca = snap.currentAssets;
  const cash = snap.cash;
  const inventory = snap.inventory;
  const equity = snap.equity;
  const assets = snap.totalAssets;
  const liabilities = snap.totalLiabilities;
  const available = snap.hasFullBs && cl > 0;

  const currentRatioVal = available ? ca / cl : 0;
  const quickRatioVal = available ? (ca - inventory) / cl : 0;
  const cashRatioVal = available ? cash / cl : 0;
  const wc = available ? ca - cl : 0;
  const priorWc = prior?.hasFullBs ? prior.currentAssets - prior.currentLiabilities : null;
  const wcChange =
    priorWc != null && priorWc !== 0 ? round1(((wc - priorWc) / Math.abs(priorWc)) * 100) : null;

  const debtToEquityVal = snap.hasFullBs && equity > 0 ? liabilities / equity : 0;
  const debtToAssetsVal = snap.hasFullBs && assets > 0 ? liabilities / assets : 0;
  const equityRatioVal = snap.hasFullBs && assets > 0 ? equity / assets : 0;

  return {
    currentRatio: metric(round2(currentRatioVal), 2.0, true, available),
    quickRatio: metric(round2(quickRatioVal), 1.5, true, available),
    cashRatio: metric(round2(cashRatioVal), 0.5, true, available),
    workingCapital: {
      current: round2(wc),
      prior: priorWc != null ? round2(priorWc) : null,
      change: wcChange,
      available,
    },
    debtToEquity: metric(round2(debtToEquityVal), 0.6, false, snap.hasFullBs && equity > 0),
    debtToAssets: metric(round2(debtToAssetsVal), 0.4, false, snap.hasFullBs && assets > 0),
    equityRatio: metric(round2(equityRatioVal), 0.6, true, snap.hasFullBs && assets > 0),
    capitalStructure: {
      totalAssets: round2(assets),
      totalLiabilities: round2(liabilities),
      totalEquity: round2(equity),
      currentAssets: round2(ca),
      currentLiabilities: round2(cl),
      longTermDebt: round2(snap.nonCurrentLiabilities),
      shortTermDebt: round2(cl),
      available: snap.hasFullBs,
    },
  };
}

export function useLiquiditySolvency(monthlySeries: CashflowGrowthMonth[]): LiquiditySolvencyData {
  const { organizationId } = useOrganization();
  const { selectedLocationId, selectedRegionId, dateRange } = useFilters();
  const { allAvailableLocations } = useLocations();

  const locationIdsForQuery = useMemo<string[] | null>(() => {
    if (selectedLocationId) return [selectedLocationId];
    if (selectedRegionId) {
      const ids = allAvailableLocations
        .filter((l) => l.region_id === selectedRegionId)
        .map((l) => l.id);
      return ids.length > 0 ? ids : [];
    }
    return null;
  }, [selectedLocationId, selectedRegionId, allAvailableLocations]);

  const locationKey = locationIdsForQuery
    ? locationIdsForQuery.slice().sort().join(',')
    : 'all';

  const fromDate = toIsoDate(dateRange.startDate);
  const toDate = toIsoDate(dateRange.endDate);
  const periodDays = daysInclusive(dateRange.startDate, dateRange.endDate);

  // ── Days of Cash from cashflow monthly series (Step 1) ──────────
  const daysOfCashComputed = useMemo(() => {
    const closing = monthlySeries[monthlySeries.length - 1]?.closingBalance ?? 0;
    const totalPaid = monthlySeries.reduce((s, m) => s + m.outflows, 0);
    const avgDailyOutflow = totalPaid / periodDays;
    const days = avgDailyOutflow > 0 ? closing / avgDailyOutflow : 0;

    const trends = monthlySeries.map((m) => {
      const [yy, mm] = m.sortKey.split('-').map(Number);
      const dim = daysInMonth(yy, mm - 1);
      const daily = m.outflows / dim;
      return {
        month: m.monthLabel,
        monthFull: m.month,
        sortKey: m.sortKey,
        daysOfCash: daily > 0 ? round1(m.closingBalance / daily) : 0,
        closing: m.closingBalance,
      };
    });

    return {
      days: round1(days),
      trends,
      closing,
      totalPaid,
    };
  }, [monthlySeries, periodDays]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['liquidity-solvency-v2', organizationId, locationKey, fromDate, toDate],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!organizationId) {
        return {
          interestCoverage: 0,
          interestAvailable: false,
          interestByMonth: {} as Record<string, number>,
          ebitda: 0,
          periodSnap: emptySnapshot(),
          priorSnap: emptySnapshot(),
          balanceSheetAsOf: null as string | null,
          monthlySnaps: {} as Record<string, BsSnapshot>,
        };
      }

      const locId =
        locationIdsForQuery && locationIdsForQuery.length === 1
          ? locationIdsForQuery[0]
          : null;

      // Interest coverage (Step 1)
      let netProfit = 0;
      try {
        const bench = await getProfitBenchmark(organizationId, {
          fromDate,
          toDate,
          locationId: locId,
        });
        netProfit = deriveActualProfit(bench.productionIncome, bench.rows ?? []).actualProfit;
      } catch (e) {
        console.warn('[useLiquiditySolvency] profit benchmark unavailable:', e);
      }

      const addBacks = await fetchEbitdaAddBacks(organizationId, locId, fromDate, toDate);
      const ebitda = round2(netProfit + addBacks.total);
      const interest = addBacks.interest;
      const interestCoverage = interest > 0 ? round2(ebitda / interest) : 0;
      const interestAvailable = interest > 0 && addBacks.interest > 0;

      const interestByMonthMap = await sumInterestByMonth(organizationId, locId, fromDate, toDate);
      const interestByMonth: Record<string, number> = {};
      for (const [k, v] of interestByMonthMap) interestByMonth[k] = round2(v);

      // Balance sheet snapshots (Step 2 — may be cash-only until re-sync)
      const tenantIds = await resolveTenantIds(organizationId, locationIdsForQuery);
      const endMonthIdx = dateRange.endDate.getMonth();
      const endYear = dateRange.endDate.getFullYear();
      const periodEndDate = monthEndIso(endYear, endMonthIdx);

      // Headline ratios: use latest BS month-end at or before the selected period end
      // (sync typically lags the calendar, e.g. "This Year" ends Dec while data stops at Jul).
      const periodResult = await loadBsSnapshot(organizationId, periodEndDate, tenantIds);
      const balanceSheetAsOf = periodResult.asOf;

      // Prior-year WC: same calendar month as the resolved as-of date, one year earlier
      let priorTarget = monthEndIso(endYear - 1, endMonthIdx);
      if (balanceSheetAsOf) {
        const [ay, am] = balanceSheetAsOf.split('-').map(Number);
        priorTarget = monthEndIso(ay - 1, am - 1);
      }
      const priorResult = await loadBsSnapshot(organizationId, priorTarget, tenantIds);

      // Monthly snaps for trend charts — exact month-end only so future/empty
      // months stay null instead of repeating the latest available snapshot.
      const monthlySnaps: Record<string, BsSnapshot> = {};
      const monthKeys = new Set<string>();
      {
        let y = dateRange.startDate.getFullYear();
        let m = dateRange.startDate.getMonth();
        const endY = dateRange.endDate.getFullYear();
        const endM = dateRange.endDate.getMonth();
        while (y < endY || (y === endY && m <= endM)) {
          monthKeys.add(`${y}-${String(m + 1).padStart(2, '0')}`);
          m += 1;
          if (m > 11) {
            m = 0;
            y += 1;
          }
        }
      }

      await Promise.all(
        [...monthKeys].map(async (key) => {
          const [yStr, mStr] = key.split('-');
          const result = await loadBsSnapshot(
            organizationId,
            monthEndIso(Number(yStr), Number(mStr) - 1),
            tenantIds,
            { exact: true },
          );
          monthlySnaps[key] = result.snap;
        }),
      );

      return {
        interestCoverage,
        interestAvailable,
        interestByMonth,
        ebitda,
        periodSnap: periodResult.snap,
        priorSnap: priorResult.snap,
        balanceSheetAsOf,
        monthlySnaps,
      };
    },
  });

  return useMemo((): LiquiditySolvencyData => {
    const periodSnap = data?.periodSnap ?? emptySnapshot();
    const priorSnap = data?.priorSnap ?? emptySnapshot();
    const fromSnap = ratiosFromSnapshot(periodSnap, priorSnap);

    const daysMetric = metric(daysOfCashComputed.days, 30, true, monthlySeries.length > 0);

    // Monthly interest coverage: allocate period EBITDA by month days, ÷ monthly interest
    const interestByMonth = data?.interestByMonth ?? {};
    const ebitda = data?.ebitda ?? 0;
    const monthCount = Math.max(1, monthlySeries.length);
    const ebitdaPerMonth = ebitda / monthCount;

    const liquidityTrends = monthlySeries.map((m) => {
      const snap = data?.monthlySnaps?.[m.sortKey];
      const cl = snap?.currentLiabilities ?? 0;
      const available = !!(snap?.hasFullBs && cl > 0);
      const dayTrend = daysOfCashComputed.trends.find((t) => t.sortKey === m.sortKey);
      return {
        month: m.monthLabel,
        monthFull: m.month,
        currentRatio: available ? round2(snap!.currentAssets / cl) : null,
        quickRatio: available ? round2((snap!.currentAssets - snap!.inventory) / cl) : null,
        cashRatio: available ? round2(snap!.cash / cl) : null,
        daysOfCash: dayTrend?.daysOfCash ?? null,
      };
    });

    const solvencyTrends = monthlySeries.map((m) => {
      const snap = data?.monthlySnaps?.[m.sortKey];
      const interestM = interestByMonth[m.sortKey] ?? 0;
      const coverage =
        interestM > 0 ? round2(ebitdaPerMonth / interestM) : data?.interestAvailable ? data.interestCoverage : null;
      return {
        month: m.monthLabel,
        monthFull: m.month,
        debtToEquity:
          snap?.hasFullBs && snap.equity > 0
            ? round2(snap.totalLiabilities / snap.equity)
            : null,
        debtToAssets:
          snap?.hasFullBs && snap.totalAssets > 0
            ? round2(snap.totalLiabilities / snap.totalAssets)
            : null,
        interestCoverage: coverage,
      };
    });

    return {
      currentRatio: fromSnap.currentRatio,
      quickRatio: fromSnap.quickRatio,
      cashRatio: fromSnap.cashRatio,
      daysOfCash: daysMetric,
      workingCapital: fromSnap.workingCapital,
      liquidityTrends,

      debtToEquity: fromSnap.debtToEquity,
      debtToAssets: fromSnap.debtToAssets,
      interestCoverage: metric(
        data?.interestCoverage ?? 0,
        5.0,
        true,
        !!data?.interestAvailable,
      ),
      equityRatio: fromSnap.equityRatio,
      debtServiceCoverage: metric(0, 1.5, true, false),
      solvencyTrends,

      capitalStructure: fromSnap.capitalStructure,
      hasFullBalanceSheet: periodSnap.hasFullBs,
      balanceSheetAsOf: data?.balanceSheetAsOf ?? null,
      isLoading,
      error,
    };
  }, [data, daysOfCashComputed, monthlySeries, isLoading, error]);
}
