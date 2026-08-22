import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { useOrganization } from '@/hooks/useOrganization';
import { usePlanAccess } from '@/hooks/usePlanAccess';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { useLocationMetrics } from '@/hooks/useLocationMetrics';
import { useLocationCostsImpact, type LocationCostBuckets } from '@/hooks/useLocationCostsImpact';
import { useChairMetrics, type ChairMetric } from '@/hooks/useChairMetrics';
import { useCashflowOverview } from '@/hooks/useCashflowOverview';
import { useNHSContractPerformance } from '@/hooks/useNHSContractPerformance';
import { useAllProvidersNetProduction } from '@/hooks/useAllProvidersNetProduction';
import { useProfitBenchmark } from '@/hooks/useProfitBenchmark';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { useEbitdaBridge } from '@/hooks/useEbitdaBridge';
import { useLocationIncomeAccountingTotals, fetchLocationIncomeAccountingTotalsByMonth } from '@/hooks/useLocationIncomeAccountingTotals';
import { getCashflowReport } from '@/services/cashflowService';
import { getProfitBenchmarkMonthlySeries } from '@/services/profitBenchmarkService';
import {
  getDashboardMonthFacts,
  profitTrendFromFacts,
  refreshDashboardMonthFacts,
} from '@/services/dashboardMonthFactsService';
import {
  composeIncomeBreakdown,
  composeProductionIncome,
  deriveActualProfit,
  isProfitBenchmarkRow,
  splitProfitBenchmarkCostExpense,
} from '@/utils/profitBenchmarkActual';
import { computeBreakEvenSales } from '@/utils/breakEvenSales';

/* ── View-model types ──────────────────────────────────────────────── */

export interface GroupSiteRow {
  locationId: string;
  name: string;
  chairs: number | null;
  revenue: number;
  costs: number;
  /** Cost Impact buckets (site league cost / profit-per-chair basis). */
  costBuckets: LocationCostBuckets | null;
  /** Profitability → Total Costs Of Treatment Delivery (for break-even). */
  treatmentCost: number;
  /** Profitability → Total Expenses To Run Your Business (for break-even). */
  operatingExpense: number;
  profit: number;
  /** % of revenue kept as operating profit; null when revenue is 0 */
  margin: number | null;
  /** chair utilisation %, from the Chairs module RPC; null when unavailable */
  utilisation: number | null;
  chairDays: number | null;
  /** total chair hours available in the period (from the Chairs module) */
  availableHours: number | null;
  /** chair hours filled with appointments in the period */
  bookedHours: number | null;
  revPerChairDay: number | null;
  profitPerChairDay: number | null;
  /** cost share of revenue 0..1 (may exceed 1 when loss-making); null when revenue is 0 */
  costShare: number | null;
  /** Sales needed to break even (Expense ÷ Gross Profit % from Profitability); null when undefined */
  breakEvenSales: number | null;
  openHoursPerDay: number;
  /** 0-100 composite health score (margin + utilisation + collections) */
  score: number | null;
  outstanding: number;
  arDays: number;
  collectionRate: number;
  isSelected: boolean;
}

export interface GroupAlert {
  sev: 'r' | 'a' | 's';
  title: string;
  chips: string[];
  sub: string;
  value: string;
}

export interface GroupMove {
  flag: 'r' | 'a' | 'g';
  due: string;
  title: string;
  impact: string;
  why: string;
  owner: string;
  initials: string;
}

export interface GroupTrendData {
  /** month keys 'MMM-yy' oldest → newest (24 months) */
  keys: string[];
  /** display labels 'Aug 24' */
  labels: string[];
  revenue: number[];
  /** monthly Profit Benchmark Actual Profit; null while loading / unavailable */
  profit: number[] | null;
  /** monthly Net Cashflow from the cashflow statement; null when no accounting data */
  cashflow: number[] | null;
  /** monthly Total Received (Collection) from the cashflow statement; null when no accounting data */
  collection: number[] | null;
  loading: boolean;
}

export interface NhsRowVM {
  name: string;
  expected: number;
  awarded: number;
  deliveredPct: number;
  status: 'on-track' | 'behind' | 'at-risk';
  exposure: number;
}

const MONTH_KEY = 'MMM-yy';
const DAY_MS = 86_400_000;
/** Sector benchmarks used for meters/RAG — indicative framing only. */
export const MARGIN_TARGET = 24;
export const CASH_COVER_TARGET = 3;
/** Year-on-year revenue growth used to derive the Business Pulse revenue target. */
export const REVENUE_GROWTH_TARGET = 10;
/** TEMP: static Business Pulse revenue target (£3m) until a real per-period target is wired up. */
export const REVENUE_TARGET_STATIC = 3_000_000;
const VALUE_MULTIPLE_LOW = 4.5;
const VALUE_MULTIPLE_MID = 5.5;
const VALUE_MULTIPLE_HIGH = 6.5;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const parseGBP = (s: string | null | undefined): number =>
  Number(String(s ?? '').replace(/[^0-9.-]/g, '')) || 0;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Month keys ('MMM-yy') covered by a date range, at month granularity. */
function monthKeysInRange(start: Date, end: Date): string[] {
  const keys: string[] = [];
  let cur = startOfMonth(start);
  const last = startOfMonth(end);
  while (cur <= last) {
    keys.push(format(cur, MONTH_KEY));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return keys;
}

/**
 * Pull a monthly series from a cashflow-report total row.
 * Prefer matching colData.column labels (same as the statement UI) so a
 * misaligned Total column cannot shift individual months (e.g. February).
 */
function seriesFromCashflowTotalRow(
  report: {
    columns?: string[];
    totalRowDataSet?: Array<{
      name: string;
      colData?: Array<{ column?: string; value?: number | string | null }>;
    }>;
  } | null | undefined,
  rowName: string,
  keys: string[],
): number[] | null {
  if (!report) return null;
  const row = report.totalRowDataSet?.find((r) => r.name === rowName);
  if (!row?.colData?.length) return null;

  const byLabel = new Map<string, number>();
  for (const cell of row.colData) {
    const label = String(cell.column ?? '').trim();
    if (!label || label.toLowerCase() === 'total') continue;
    const n = Number(cell.value);
    byLabel.set(label, Number.isFinite(n) ? n : 0);
  }

  // Case-insensitive fallback (locale / spacing quirks).
  const byLabelLower = new Map<string, number>();
  for (const [k, v] of byLabel) byLabelLower.set(k.toLowerCase(), v);

  const series = keys.map((k) => {
    if (byLabel.has(k)) return byLabel.get(k)!;
    const lower = k.toLowerCase();
    if (byLabelLower.has(lower)) return byLabelLower.get(lower)!;
    return 0;
  });

  if (!series.some((v) => v !== 0)) return null;
  return series;
}

/** Net Cashflow = Total Received − Total Paid (same formula as cashflow-report). */
function netCashflowSeriesFromReport(
  report: {
    columns?: string[];
    totalRowDataSet?: Array<{
      name: string;
      colData?: Array<{ column?: string; value?: number | string | null }>;
    }>;
  } | null | undefined,
  keys: string[],
): number[] | null {
  const fromRow = seriesFromCashflowTotalRow(report, 'Net Cashflow', keys);
  const received = seriesFromCashflowTotalRow(report, 'Total Received', keys);
  const paid = seriesFromCashflowTotalRow(report, 'Total Paid', keys);
  if (received && paid) {
    const derived = keys.map((_, i) => (received[i] ?? 0) - (paid[i] ?? 0));
    // Prefer Received − Paid when both rows exist — matches statement definition
    // and avoids any stale/mis-labeled Net Cashflow cell.
    if (derived.some((v) => v !== 0) || fromRow == null) return derived;
  }
  return fromRow;
}

export function useGroupDashboardData() {
  const { organization, organizationId } = useOrganization();
  const { selectedLocationId, dateRange } = useFilters();
  const { locations } = useLocations();
  // Match ProfitBenchmark: treat "all" / empty as org-wide (null).
  const locationIdForIncome =
    selectedLocationId && String(selectedLocationId).toLowerCase() !== 'all'
      ? selectedLocationId
      : null;

  const locationMetrics = useLocationMetrics();
  // Cost Impact bucket totals per location — the site league / Operational
  // Efficiency cost basis (client spec 2026-07-25). useLocationMetrics'
  // totalCosts is now a Profit Benchmark override, so fetch the buckets here.
  const costsImpact = useLocationCostsImpact();
  const chairQuery = useChairMetrics({ startDate: dateRange.startDate, endDate: dateRange.endDate });
  const cashflowOverview = useCashflowOverview({
    lastStart: null, lastEnd: null, thisStart: null, thisEnd: null,
  });
  const nhs = useNHSContractPerformance();

  /* ── Trend window: last 24 calendar months, one fetch serves the trend
     chart, the associates card, the income mix and the vs-last-year compare ── */
  const now = new Date();
  const trendStart = startOfMonth(subMonths(now, 23));
  const trendEnd = endOfMonth(now);
  const production = useAllProvidersNetProduction(null, trendStart, trendEnd, locationIdForIncome);

  // Basic plan is intended for solo-practice orgs (one provider, one
  // location) — for those, the org-wide aggregate this hook already computes
  // IS the one provider's Financial Position, so no separate scoping query is
  // needed. If a Basic-plan org unexpectedly has more than one provider or
  // location, fail open (keep showing the org-wide aggregate) rather than
  // guessing which one to show, but flag it instead of silently mismatching
  // the plan's "provider only" promise.
  const { planTier, isModuleAllowedByPlan } = usePlanAccess();
  // Business Valuation (EBITDA × multiple) is an Accelerate-only add-on beyond
  // Financial Position itself (see PLAN_FEATURES) — everything else on this
  // dashboard is the "Financial Position" feature all plans above Basic get.
  const valuationAllowed = isModuleAllowedByPlan('ebitda_to_value');
  // "Operational Efficiency — Locations, Accounts Payable, Budget" is its own
  // Accelerate-only PLAN_FEATURES bullet (bundled with 'locations' since
  // essential/growth never have more than the org's single location, same as
  // basic) — gates the per-chair-day KPIs + ranked site league zone below.
  const operationalEfficiencyAllowed = isModuleAllowedByPlan('locations');
  useEffect(() => {
    if (planTier !== 'basic') return;
    const providerGroupCount = production.data?.providers?.length ?? 0;
    if (providerGroupCount > 1) {
      console.warn(
        `[useGroupDashboardData] Basic-plan org "${organization?.name ?? organizationId}" has ${providerGroupCount} providers — expected exactly one for solo-practice Financial Position scoping. Showing org-wide data instead of a single provider.`,
      );
    }
    if (locations.length > 1) {
      console.warn(
        `[useGroupDashboardData] Basic-plan org "${organization?.name ?? organizationId}" has ${locations.length} locations — expected exactly one for solo-practice Financial Position scoping. Showing org-wide data instead of a single provider.`,
      );
    }
  }, [planTier, production.data, locations.length, organization?.name, organizationId]);

  // Cash Flow Statement default window (PreparingCashflowStatement): today − 210 days.
  // Trend Net Cashflow / Collection (Total Received) must use this same window so months match.
  const cashflowRangeStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 210);
    return d;
  }, []);
  const cashflowRangeEnd = useMemo(() => new Date(), []);

  /* Trend-chart REVENUE + PROFIT — Phase D facts first (org×location×month),
     else Phase B live compose (monthly profit-benchmark + accounting RPC). */
  const profitTrendQuery = useQuery({
    queryKey: [
      'group-dashboard-profit-trend-v5',
      organizationId,
      locationIdForIncome ?? 'all',
      ymd(trendStart),
      ymd(trendEnd),
      // Re-compose live fallback when provider production finishes / refreshes
      production.dataUpdatedAt,
    ],
    enabled: !!organizationId && !production.isLoading && !!production.data,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ revenue: Map<string, number>; profit: Map<string, number> }> => {
      const revenue = new Map<string, number>();
      const profit = new Map<string, number>();
      if (!organizationId) return { revenue, profit };

      const providers = production.data?.providers ?? [];
      const months: Array<{ key: string; from: string; to: string }> = [];
      {
        let cur = startOfMonth(trendStart);
        const last = startOfMonth(trendEnd);
        while (cur <= last) {
          months.push({
            key: format(cur, MONTH_KEY),
            from: ymd(cur),
            to: ymd(endOfMonth(cur)),
          });
          cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        }
      }
      const monthKeys = months.map((m) => m.key);
      const fromYmd = ymd(trendStart);
      const toYmd = ymd(trendEnd);

      // Phase D: prefer pre-aggregated facts when the full window is covered.
      try {
        const facts = await getDashboardMonthFacts(
          organizationId,
          fromYmd,
          toYmd,
          locationIdForIncome,
        );
        const fromFacts = profitTrendFromFacts(facts, monthKeys);
        if (fromFacts) return fromFacts;
        // Warm the cache for the next load (do not block this request).
        void refreshDashboardMonthFacts(
          organizationId,
          fromYmd,
          toYmd,
          locationIdForIncome,
        ).catch((err) => {
          console.warn('[GroupDashboard] dashboard month facts refresh failed:', err);
        });
      } catch (err) {
        console.warn('[GroupDashboard] dashboard month facts read failed:', err);
      }

      const [acctByMonth, benchMonthly] = await Promise.all([
        fetchLocationIncomeAccountingTotalsByMonth(
          organizationId,
          fromYmd,
          toYmd,
          monthKeys,
          locationIdForIncome,
        ),
        getProfitBenchmarkMonthlySeries(organizationId, {
          fromDate: fromYmd,
          toDate: toYmd,
          locationId: locationIdForIncome,
        }),
      ]);

      const benchByKey = new Map(benchMonthly.map((b) => [b.monthKey, b]));

      for (const m of months) {
        try {
          const acct = acctByMonth.get(m.key) ?? {
            private: null,
            membership: null,
            nhs: null,
            sources: { private: 'pms' as const, membership: 'pms' as const, nhs: 'pms' as const },
            levels: { private: 'practice' as const, membership: 'practice' as const, nhs: 'practice' as const },
          };
          const bench = benchByKey.get(m.key);
          const monthProviders = providers.map((p) => {
            const md = p.monthlyData?.[m.key];
            return {
              totalPrivate: Number(md?.private) || 0,
              totalMembership: Number(md?.membership) || 0,
              totalNhs: Number(md?.nhs) || 0,
            };
          });
          const income = composeProductionIncome(monthProviders, acct);
          const { actualProfit } = deriveActualProfit(income, bench?.rows ?? []);
          revenue.set(m.key, income);
          profit.set(m.key, actualProfit);
        } catch (err) {
          console.error(`[GroupDashboard] profit trend error (${m.key}):`, err);
          revenue.set(m.key, 0);
          profit.set(m.key, 0);
        }
      }
      return { revenue, profit };
    },
  });

  const cashflowTrendQuery = useQuery({
    // Use the SAME date window as Cash Flow Statement (today − 210 → today) so
    // monthly Net Cashflow / Total Received match that page £-for-£. A 24-month
    // window can truncate or diverge under load and was shifting Feb 2026
    // (~−£13.3k balance move vs −£18,507 Net Cashflow on the statement).
    queryKey: [
      'group-dashboard-cashflow-trend-v5',
      organizationId,
      locationIdForIncome ?? 'all',
      ymd(cashflowRangeStart),
      ymd(cashflowRangeEnd),
    ],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        return await getCashflowReport(organizationId!, {
          fromDate: ymd(cashflowRangeStart),
          toDate: ymd(cashflowRangeEnd),
          locationId: locationIdForIncome,
        });
      } catch (err) {
        console.error('[GroupDashboard] cashflow trend error:', err);
        return null;
      }
    },
  });

  const periodDays = Math.max(1, Math.round((dateRange.endDate.getTime() - dateRange.startDate.getTime()) / DAY_MS));

  /* ── Scorecard sources (client spec): Statement of Cash Flows, Profit
     Benchmarking (Xero categories), EBITDA Valuation ────────────────── */

  // Cash in bank = LAST MONTH's closing balance from the Statement of Cash
  // Flows. The Closing Balance row is cumulative from the report's fromDate,
  // so this call MUST use the statement page's own anchor (today − 210 days)
  // or the balances diverge (docs gotcha #3).
  // The window runs to the END OF THE CURRENT MONTH so the same report also
  // yields the CURRENT closing balance (the statement page's last column) —
  // used by the Cash in bank scoreboard tile (Business Pulse Cash now uses
  // period Net Cashflow instead).
  const statementAnchor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 210);
  const currentMonthEnd = endOfMonth(now);
  const statementQuery = useQuery({
    queryKey: ['group-dashboard-cash-statement', organizationId, locationIdForIncome ?? 'all', ymd(statementAnchor), ymd(currentMonthEnd)],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        return await getCashflowReport(organizationId!, {
          fromDate: ymd(statementAnchor),
          toDate: ymd(currentMonthEnd),
          locationId: locationIdForIncome,
        });
      } catch (err) {
        console.error('[GroupDashboard] cash statement error:', err);
        return null;
      }
    },
  });

  // Operating profit / margin vs benchmark — the Profit Benchmarking module
  // (accounting-category rows = Xero CoA buckets), scoped to the global
  // period + location so it reconciles with /profit-benchmark on the same range.
  const benchmark = useProfitBenchmark(
    ymd(dateRange.startDate), ymd(dateRange.endDate), undefined, locationIdForIncome,
  );

  // Production Income composition — same hooks as ProfitBenchmark.tsx
  // (Provider Net Production + Location Settings Accounting App overrides).
  const periodAccountingIncome = useLocationIncomeAccountingTotals(
    ymd(dateRange.startDate),
    ymd(dateRange.endDate),
    locationIdForIncome,
  );

  // Period Actual Profit (Profit Benchmark screen formula) — feeds the EBITDA
  // bridge so Estimated group value matches Profitability → EBITDA Impact.
  const periodScreenProfit = useMemo(() => {
    const periodKeysForIncome = new Set(
      monthKeysInRange(dateRange.startDate, dateRange.endDate),
    );
    const periodProviderTotals = (production.data?.providers ?? []).map((p) => {
      let totalPrivate = 0;
      let totalMembership = 0;
      let totalNhs = 0;
      for (const [k, v] of Object.entries(p.monthlyData ?? {})) {
        if (!periodKeysForIncome.has(k)) continue;
        totalPrivate += Number(v.private) || 0;
        totalMembership += Number(v.membership) || 0;
        totalNhs += Number(v.nhs) || 0;
      }
      return { totalPrivate, totalMembership, totalNhs };
    });
    const income = composeProductionIncome(
      periodProviderTotals,
      periodAccountingIncome.data,
    );
    return deriveActualProfit(income, benchmark.rows ?? []);
  }, [
    production.data,
    periodAccountingIncome.data,
    benchmark.rows,
    dateRange.startDate,
    dateRange.endDate,
  ]);

  // Net Profit → EBITDA bridge (same as Profitability → EBITDA Impact tab).
  const ebitdaBridge = useEbitdaBridge(
    ymd(dateRange.startDate),
    ymd(dateRange.endDate),
    periodScreenProfit.actualProfit,
    locationIdForIncome,
  );

  // Final Multiple + net debt from EBITDA to value module.
  const ebitdaValuation = useEbitdaValuation();

  return useMemo(() => {
    const metricsMap = locationMetrics.data;
    const costsImpactMap = costsImpact.data;
    const chairRows: ChairMetric[] = (chairQuery.data as ChairMetric[] | undefined) ?? [];
    const chairByLoc = new Map(chairRows.map((c) => [c.location_id, c]));
    const locName = (id: string) => locations.find((l) => l.id === id)?.location_name || 'Location';

    /* ── Site league rows (always all sites; scoreboard scopes below) ── */
    const sites: GroupSiteRow[] = [];
    if (metricsMap) {
      for (const [locId, m] of metricsMap) {
        const chair = chairByLoc.get(locId);
        const chairs = chair?.chairs_count ?? null;
        const openHours = chair?.clinic_opening_hours_per_day || 8;
        const chairDays = chair && chairs && openHours > 0 && chair.available_hours > 0
          ? chair.available_hours / openHours
          : null;
        // Site figures: revenue = Profit Benchmark Production Income (client
        // re-sourced 2026-07-30, confirmed after a same-day revert — this zone
        // must match the Profitability page / Business Pulse REVENUE, not the
        // TPI total it used before). Costs stay Cost Impact buckets (settled
        // 2026-07-27, reconciles with /cost-impact) — never PB expense rows or
        // useLocationMetrics.totalCosts. Break-even uses PB Cost vs Expense.
        const revenue = m.revenue;
        const costBuckets = costsImpactMap?.get(locId);
        const costs = costBuckets?.totalCosts ?? 0;
        const treatmentCost = m.treatmentCost ?? 0;
        const operatingExpense = m.operatingExpense ?? 0;
        const profit = revenue - costs;
        const margin = revenue > 0 ? (profit / revenue) * 100 : null;
        const costShare = revenue > 0 ? costs / revenue : null;
        const { breakEvenSales } = computeBreakEvenSales(
          revenue,
          treatmentCost,
          operatingExpense,
        );
        const utilisation = chair?.utilisation_pct ?? null;
        const score = margin == null
          ? null
          : Math.round(100 * (
              0.4 * clamp01(margin / 25) +
              0.3 * (utilisation != null ? clamp01(utilisation / 90) : clamp01(margin / 25)) +
              0.3 * clamp01(m.collectionRate / 100)
            ));
        if (revenue === 0 && costs === 0 && !chairs) continue;
        sites.push({
          locationId: locId,
          name: locName(locId),
          chairs,
          revenue,
          costs,
          costBuckets: costBuckets ?? null,
          treatmentCost,
          operatingExpense,
          profit,
          margin,
          utilisation,
          chairDays,
          availableHours: chair && chair.available_hours > 0 ? chair.available_hours : null,
          bookedHours: chair ? chair.completed_hours : null,
          revPerChairDay: chairDays && chairDays > 0 ? revenue / chairDays : null,
          profitPerChairDay: chairDays && chairDays > 0 ? profit / chairDays : null,
          costShare,
          breakEvenSales,
          openHoursPerDay: openHours,
          score,
          outstanding: m.totalOutstanding,
          arDays: m.arDays,
          collectionRate: m.collectionRate,
          isSelected: selectedLocationId === locId,
        });
      }
    }
    sites.sort((a, b) => (b.profitPerChairDay ?? b.profit) - (a.profitPerChairDay ?? a.profit));

    /* ── Scoreboard aggregates (respect the selected location) ── */
    const scoped = selectedLocationId ? sites.filter((s) => s.locationId === selectedLocationId) : sites;
    const revenue = scoped.reduce((s, r) => s + r.revenue, 0);
    const costs = scoped.reduce((s, r) => s + r.costs, 0);
    const profitInternal = revenue - costs;
    const marginInternal = revenue > 0 ? (profitInternal / revenue) * 100 : null;
    let prevRevenue = 0;
    if (metricsMap) {
      for (const [locId, m] of metricsMap) {
        if (selectedLocationId && locId !== selectedLocationId) continue;
        prevRevenue += m.previousRevenue;
      }
    }
    let netCashFlow = 0;
    let hasNetCashFlow = false;
    if (metricsMap) {
      for (const [locId, m] of metricsMap) {
        if (selectedLocationId && locId !== selectedLocationId) continue;
        if (m.netCashFlow != null) { netCashFlow += m.netCashFlow; hasNetCashFlow = true; }
      }
    }

    const cash = cashflowOverview.isLoading ? null : cashflowOverview.closingBalance.thisWeek;
    const cashLastWeek = cashflowOverview.isLoading ? null : cashflowOverview.closingBalance.lastWeek;

    /* ── Cash in bank tile: LAST MONTH closing balance from the Statement of
       Cash Flows ('Closing Balance' row, statement anchor). Falls back to the
       weekly closing balance while the statement loads / has no data. ── */
    const lastMonthKey = format(startOfMonth(subMonths(new Date(), 1)), MONTH_KEY);
    const cashLastMonthLabel = lastMonthKey.replace('-', ' ');
    let cashLastMonth: number | null = null;
    // Current closing balance from the SAME statement report (its last
    // column) — feeds the Business Pulse CASH stage so it matches the Cash
    // Flow Statement page £-for-£ instead of the weekly bank-transaction
    // widget (whose anchor/source differ).
    const currentMonthKey = format(startOfMonth(new Date()), MONTH_KEY);
    const cashStatementLabel = currentMonthKey.replace('-', ' ');
    let cashStatement: number | null = null;
    {
      const rep = statementQuery.data;
      const cols: string[] = rep?.columns ?? [];
      const closing = rep?.totalRowDataSet?.find((r: { name: string }) => r.name === 'Closing Balance');
      const i = cols.indexOf(lastMonthKey);
      if (closing && i >= 0) cashLastMonth = Number(closing.colData?.[i]?.value) || 0;
      const j = cols.indexOf(currentMonthKey);
      if (closing && j >= 0) cashStatement = Number(closing.colData?.[j]?.value) || 0;
    }

    const monthlyCostRate = costs > 0 ? (costs / periodDays) * 30.44 : 0;
    // Months of cover is framed on the bank balance the tile shows.
    const cashForCover = cashLastMonth ?? cash;
    const monthsCover = cashForCover != null && monthlyCostRate > 0 ? cashForCover / monthlyCostRate : null;

    /* ── Operating profit & margin — Profit Benchmark SCREEN formula
       (not the edge PROFIT row alone):
         Production Income = Private + Membership + NHS
           (Accounting App COA when mapped; else Provider Net Production)
         Actual Profit     = Production Income − Σ |expense category actuals|
       Scoped to the same period + location as /profit-benchmark. ── */
    const periodKeysForIncome = new Set(monthKeysInRange(dateRange.startDate, dateRange.endDate));
    const periodProviderTotals = (production.data?.providers ?? []).map((p) => {
      let totalPrivate = 0;
      let totalMembership = 0;
      let totalNhs = 0;
      for (const [k, v] of Object.entries(p.monthlyData ?? {})) {
        if (!periodKeysForIncome.has(k)) continue;
        totalPrivate += Number(v.private) || 0;
        totalMembership += Number(v.membership) || 0;
        totalNhs += Number(v.nhs) || 0;
      }
      return { totalPrivate, totalMembership, totalNhs };
    });
    const screenProductionIncome = composeProductionIncome(
      periodProviderTotals,
      periodAccountingIncome.data,
    );
    const benchRows = benchmark.rows ?? [];
    const {
      actualProfit: screenActualProfit,
      marginPct: screenMarginPct,
    } = deriveActualProfit(screenProductionIncome, benchRows);
    // Group-scoped Cost vs Expense for Operational Efficiency break-even.
    // Must use the same Profitability (PB) rows as Business Pulse — never the
    // sum of per-site splits (shared/org costs get double-counted that way).
    const {
      totalCost: beTreatmentCost,
      totalExpense: beOperatingExpense,
    } = splitProfitBenchmarkCostExpense(benchRows);
    const groupBreakEven = computeBreakEvenSales(
      screenProductionIncome,
      beTreatmentCost,
      beOperatingExpense,
    );

    const incomeReady =
      !production.isLoading && !periodAccountingIncome.isLoading && !benchmark.isLoading;
    // Prefer Profit Benchmark screen Production Income whenever composition is
    // ready (even if expense mappings are empty — income still matches PB).
    const useScreenProfit = incomeReady;
    const opProfit = useScreenProfit ? screenActualProfit : profitInternal;
    const opRevenue = useScreenProfit
      ? screenProductionIncome
      : (Number(benchmark.productionIncome) || revenue);
    const opMargin = useScreenProfit
      ? screenMarginPct
      : (opRevenue > 0 ? (opProfit / opRevenue) * 100 : null);
    const opSource = useScreenProfit ? ('benchmark' as const) : ('internal' as const);
    // Keep exported profit/margin aligned with the scoreboard tiles so Action
    // Center "group margin" matches Operating profit / Profit margin.
    const profit = opProfit;
    const margin = opMargin ?? marginInternal;
    const benchCategoryMode = benchRows.some(
      (r) => r.isProfitRow === true || (r.groupAccountMasterId != null && Number.isFinite(r.groupAccountMasterId)),
    );
    let benchTargetPct: number | null = null;
    if (benchRows.length > 0) {
      if (benchCategoryMode) {
        const expenseBenchSum = benchRows
          .filter((r) => !isProfitBenchmarkRow(r))
          .reduce((s, r) => s + (Number(r.benchmark) || 0), 0);
        benchTargetPct = Math.max(0, Math.min(100, 100 - expenseBenchSum));
      } else {
        const profitRow = benchRows.find(isProfitBenchmarkRow);
        if (profitRow) benchTargetPct = Number(profitRow.benchmark) || null;
      }
    }
    const marginBenchmark = benchTargetPct ?? MARGIN_TARGET;

    /* ── Estimated group value — Profitability EBITDA Impact tab:
       bridge EBITDA × Final Multiple (from EBITDA to value).
       Falls back to Sustainable EBITDA × multiple, then indicative band. ── */
    const val = ebitdaValuation.valuation;
    const finalMultiple = val?.multiple.finalMultiple ?? null;
    const bridgeEbitda = ebitdaBridge.data?.ebitda;
    const netDebt = val?.netDebt ?? 0;
    const useBridgeValue =
      !ebitdaBridge.isLoading &&
      bridgeEbitda != null &&
      Number.isFinite(bridgeEbitda) &&
      finalMultiple != null &&
      finalMultiple > 0;
    const useSustainableFallback =
      !useBridgeValue &&
      !ebitdaValuation.isLoading &&
      val &&
      val.enterpriseValue > 0;
    const groupValue = useBridgeValue
      ? {
          enterpriseValue: bridgeEbitda! * finalMultiple!,
          equityValue: bridgeEbitda! * finalMultiple! - netDebt,
          ebitda: bridgeEbitda!,
          multiple: finalMultiple!,
          dataSource: 'Profitability EBITDA Impact',
        }
      : useSustainableFallback
        ? {
            enterpriseValue: val!.enterpriseValue,
            equityValue: val!.equityValue,
            ebitda: val!.sustainableEBITDA,
            multiple: val!.multiple.finalMultiple,
            dataSource: val!.dataSource,
          }
        : null;

    const annualProfit = (opProfit / periodDays) * 365;
    const estValue = annualProfit > 0
      ? { low: annualProfit * VALUE_MULTIPLE_LOW, mid: annualProfit * VALUE_MULTIPLE_MID, high: annualProfit * VALUE_MULTIPLE_HIGH }
      : null;
    const safeToDraw = hasNetCashFlow ? netCashFlow : null;

    /* ── Trend series ── */
    const keys = monthKeysInRange(trendStart, trendEnd);
    const labels = keys.map((k) => k.replace('-', ' '));
    const provs = production.data?.providers ?? [];
    // Revenue / Profit come fully composed from profitTrendQuery (PB formula).
    // While that query is loading, expose empty series so the chart does not
    // flash PMS-only partials (e.g. £63k vs £109k Production Income).
    const trendReady = !production.isLoading && !profitTrendQuery.isLoading && !!profitTrendQuery.data;
    const pbMonthly = profitTrendQuery.data;
    const revenueSeries = trendReady
      ? keys.map((k) => pbMonthly!.revenue.get(k) ?? 0)
      : keys.map(() => 0);
    const profitSeries = trendReady
      ? keys.map((k) => pbMonthly!.profit.get(k) ?? 0)
      : null;

    const report = cashflowTrendQuery.data ?? null;
    const cashflowSeries = netCashflowSeriesFromReport(report, keys);
    const collectionSeries = seriesFromCashflowTotalRow(report, 'Total Received', keys);

    const trend: GroupTrendData = {
      keys,
      labels,
      revenue: revenueSeries,
      profit: profitSeries,
      cashflow: cashflowSeries,
      collection: collectionSeries,
      loading: !trendReady || cashflowTrendQuery.isLoading,
    };

    // Previous period Net Cashflow (same length as the filter window), from
    // the monthly CFS series — powers Business Pulse Cash "vs prev period".
    let prevNetCashFlow: number | null = null;
    if (cashflowSeries) {
      const keyIdx = new Map(keys.map((k, i) => [k, i]));
      const prevEnd = new Date(dateRange.startDate.getTime() - DAY_MS);
      const prevStart = new Date(prevEnd.getTime() - (periodDays - 1) * DAY_MS);
      const prevKeys = monthKeysInRange(prevStart, prevEnd);
      let sum = 0;
      let any = false;
      for (const k of prevKeys) {
        const i = keyIdx.get(k);
        if (i == null) continue;
        sum += cashflowSeries[i];
        any = true;
      }
      if (any) prevNetCashFlow = sum;
    }

    const lastActiveIdx = (() => {
      for (let i = revenueSeries.length - 1; i >= 0; i--) if (revenueSeries[i] > 0) return i;
      return -1;
    })();
    const dataToLabel = lastActiveIdx >= 0 ? `Data to ${labels[lastActiveIdx]}` : null;

    /* ── Period-scoped slices of the production sweep ── */
    const periodKeys = new Set(monthKeysInRange(dateRange.startDate, dateRange.endDate));
    const associates = provs
      .map((p) => ({
        name: p.providerName,
        total: Object.entries(p.monthlyData)
          .filter(([k]) => periodKeys.has(k))
          .reduce((s, [, v]) => s + v.amount, 0),
      }))
      .filter((a) => a.total > 0)
      .sort((a, b) => b.total - a.total);
    const associatesTotal = associates.reduce((s, a) => s + a.total, 0);

    // Same Private / Membership / NHS as Profit Benchmark (Accounting App
    // COA when mapped; else Provider Net Production payor split).
    const incomeMix = (() => {
      const b = composeIncomeBreakdown(
        periodProviderTotals,
        periodAccountingIncome.data,
      );
      return { private: b.private, membership: b.membership, nhs: b.nhs };
    })();

    // Same months last year, when the 24-month window covers them.
    let revenueLY: number | null = null;
    {
      const keyIdx = new Map(keys.map((k, i) => [k, i]));
      let sum = 0;
      let ok = true;
      for (const k of periodKeys) {
        const i = keyIdx.get(k);
        if (i == null || i - 12 < 0) { ok = false; break; }
        sum += revenueSeries[i - 12];
      }
      if (ok && periodKeys.size > 0) revenueLY = sum;
    }

    /* ── Chairs insight ── */
    const chairTotal = chairRows.reduce((s, c) => s + (c.chairs_count || 0), 0);
    const groupUtil = chairTotal > 0
      ? chairRows.reduce((s, c) => s + (c.utilisation_pct || 0) * (c.chairs_count || 0), 0) / chairTotal
      : null;
    const underused = sites
      .filter((s) => s.utilisation != null && groupUtil != null && s.utilisation < groupUtil)
      .sort((a, b) => (a.utilisation ?? 0) - (b.utilisation ?? 0));
    const recoverable = groupUtil != null
      ? underused.reduce((sum, s) => {
          if (!s.utilisation || s.utilisation <= 0) return sum;
          return sum + s.revenue * (groupUtil / s.utilisation - 1);
        }, 0) * (365 / periodDays)
      : null;

    /* ── NHS rows ── */
    const nhsRows: NhsRowVM[] = (nhs.contractCards ?? []).map((c) => {
      const expected = parseGBP(c.contractValue);
      const awarded = parseGBP(c.ytdCosts);
      const exposure = Math.max(0, expected - awarded);
      return {
        name: c.name,
        expected,
        awarded,
        deliveredPct: c.deliveryProgress,
        status: c.deliveryStatus,
        exposure: c.deliveryStatus === 'on-track' ? 0 : exposure,
      };
    });
    const nhsExposure = nhsRows.reduce((s, r) => s + r.exposure, 0);

    /* ── Alerts (derived from live figures, ranked by severity) ── */
    const alerts: GroupAlert[] = [];
    const fmtK = (v: number) => `£${Math.round(Math.abs(v) / 1000).toLocaleString('en-GB')}k`;
    if (monthsCover != null && monthsCover < 1.5) {
      alerts.push({
        sev: 'r',
        title: 'Cash cover below 1.5 months of running costs',
        chips: ['Group'],
        sub: `Bank balance covers ${monthsCover.toFixed(1)} months at the current cost rate`,
        value: `${monthsCover.toFixed(1)} mo`,
      });
    }
    for (const r of nhsRows.filter((r) => r.status !== 'on-track' && r.exposure > 0)) {
      alerts.push({
        sev: r.deliveredPct < 30 ? 'r' : 'a',
        title: `NHS delivery behind — ${r.name}`,
        chips: ['NHS'],
        sub: `${r.deliveredPct}% of expected fees awarded so far this period`,
        value: fmtK(r.exposure),
      });
    }
    const worstMargin = sites
      .filter((s) => s.margin != null && margin != null && s.revenue > 0 && (s.margin as number) < (margin as number) - 5)
      .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0))[0];
    if (worstMargin && margin != null) {
      const gapAnnual = ((margin - (worstMargin.margin as number)) / 100) * worstMargin.revenue * (365 / periodDays);
      alerts.push({
        sev: 's',
        title: `Margin well below group average — ${worstMargin.name}`,
        chips: [worstMargin.name],
        sub: `${(worstMargin.margin as number).toFixed(1)}% vs ${margin.toFixed(1)}% group — closing the gap is worth ~${fmtK(gapAnnual)}/yr`,
        value: `${((worstMargin.margin as number) - margin).toFixed(1)}pt`,
      });
    }
    for (const s of underused.slice(0, 2)) {
      if (s.utilisation == null || groupUtil == null) continue;
      alerts.push({
        sev: 'a',
        title: `Chairs underused — ${s.name}`,
        chips: [s.name],
        sub: `${Math.round(s.utilisation)}% utilised vs ${Math.round(groupUtil)}% group average`,
        value: `${Math.round(s.utilisation)}%`,
      });
    }
    const totalOutstanding = sites.reduce((s, r) => s + r.outstanding, 0);
    if (totalOutstanding > 0) {
      const worstAr = [...sites].sort((a, b) => b.outstanding - a.outstanding)[0];
      alerts.push({
        sev: 'a',
        title: 'Outstanding patient balances to chase',
        chips: ['Group'],
        sub: worstAr ? `Largest share at ${worstAr.name} (${fmtK(worstAr.outstanding)})` : '',
        value: fmtK(totalOutstanding),
      });
    }
    const sevRank = { r: 0, s: 1, a: 2 } as const;
    alerts.sort((a, b) => sevRank[a.sev] - sevRank[b.sev]);

    /* ── Next 3 moves (top opportunities by estimated impact) ── */
    const moves: GroupMove[] = [];
    const initialsOf = (name: string) =>
      name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'PM';
    if (nhsExposure > 0) {
      const worst = nhsRows.filter((r) => r.exposure > 0).sort((a, b) => b.exposure - a.exposure)[0];
      moves.push({
        flag: 'r',
        due: 'this quarter',
        title: `Protect ${fmtK(worst.exposure)} of NHS fees — ${worst.name}`,
        impact: `+${fmtK(worst.exposure)}`,
        why: `Only ${worst.deliveredPct}% of expected NHS fees have been awarded so far. Rebook missed capacity and chase outstanding claims before the recovery window closes.`,
        owner: 'Practice Manager',
        initials: 'PM',
      });
    }
    if (worstMargin && margin != null) {
      const gapAnnual = ((margin - (worstMargin.margin as number)) / 100) * worstMargin.revenue * (365 / periodDays);
      moves.push({
        flag: 'a',
        due: 'next 60 days',
        title: `Close ${worstMargin.name}'s margin gap to the group average`,
        impact: `+${fmtK(gapAnnual)}/yr`,
        why: `${worstMargin.name} runs at ${(worstMargin.margin as number).toFixed(1)}% vs the ${margin.toFixed(1)}% group margin. Review its biggest cost lines and legacy pricing to close most of the gap.`,
        owner: `${worstMargin.name} · Site lead`,
        initials: initialsOf(worstMargin.name),
      });
    }
    if (recoverable != null && recoverable > 0 && underused[0]) {
      moves.push({
        flag: 'g',
        due: 'this quarter',
        title: 'Fill underused chairs to the group average',
        impact: `+${fmtK(recoverable)}/yr`,
        why: `Lifting every below-average site to ${Math.round(groupUtil ?? 0)}% utilisation recovers this capacity — the biggest share sits at ${underused[0].name}.`,
        owner: 'Group Operations',
        initials: 'GO',
      });
    }
    if (moves.length < 3 && totalOutstanding > 0) {
      moves.push({
        flag: 'a',
        due: 'this month',
        title: 'Chase the outstanding patient balances',
        impact: `+${fmtK(totalOutstanding)}`,
        why: 'Money already earned but not yet collected. A focused chase converts it straight to cash without new production.',
        owner: 'Front of house teams',
        initials: 'FH',
      });
    }

    /* Top up to exactly three moves. £-quantified opportunities are preferred,
       with evergreen plays as a backstop, so the group always sees three ranked
       next steps even when fewer alerts have fired this period. */
    const fillers: GroupMove[] = [];
    if (margin != null && margin < marginBenchmark && revenue > 0) {
      const benchGap = ((marginBenchmark - margin) / 100) * revenue * (365 / periodDays);
      fillers.push({
        flag: 'a',
        due: 'this quarter',
        title: `Lift the group margin to the ${marginBenchmark.toFixed(0)}% benchmark`,
        impact: `+${fmtK(benchGap)}/yr`,
        why: `The group runs at ${margin.toFixed(1)}% against a ${marginBenchmark.toFixed(0)}% benchmark. Closing that on current revenue is worth about ${fmtK(benchGap)} a year — start with the biggest cost lines and any legacy private pricing.`,
        owner: 'Group Operations',
        initials: 'GO',
      });
    }
    if (margin != null && sites.length > 1) {
      const best = [...sites]
        .filter((s) => s.margin != null && s.revenue > 0)
        .sort((a, b) => (b.margin as number) - (a.margin as number))[0];
      if (best && (best.margin as number) > margin) {
        const uplift = (((best.margin as number) - margin) / 100) * revenue * (365 / periodDays);
        fillers.push({
          flag: 'g',
          due: 'this quarter',
          title: `Roll ${best.name}'s playbook out to the other sites`,
          impact: `+${fmtK(uplift)}/yr`,
          why: `${best.name} is the strongest site at ${(best.margin as number).toFixed(1)}% margin. Documenting its recall, pricing and cost discipline and applying it group-wide is the highest-leverage lift.`,
          owner: 'Group Operations',
          initials: 'GO',
        });
      }
    }
    fillers.push({
      flag: 'g',
      due: 'this quarter',
      title: 'Tighten recall and reactivation across the group',
      impact: 'Fill the book',
      why: 'Re-engaging patients overdue for hygiene and check-ups is the lowest-cost way to use spare capacity. Standardise the recall cadence and run a reactivation campaign for anyone six or more months overdue.',
      owner: 'Practice Managers',
      initials: 'PM',
    });
    fillers.push({
      flag: 'a',
      due: 'this month',
      title: 'Cut short-notice cancellations and DNAs',
      impact: 'Reclaim lost hours',
      why: 'Every failed appointment is paid-for chair time lost. Tighter reminders and a short cancellation policy convert wasted slots back into production.',
      owner: 'Front of house teams',
      initials: 'FH',
    });
    fillers.push({
      flag: 'a',
      due: 'this quarter',
      title: 'Review the group’s biggest supplier and lab costs',
      impact: 'Protect margin',
      why: 'Consolidating labs and renegotiating the largest supplier lines is a direct margin lever that needs no extra production.',
      owner: 'Group Operations',
      initials: 'GO',
    });
    for (const f of fillers) {
      if (moves.length >= 3) break;
      moves.push(f);
    }

    /* ── Verdict lines ── */
    const revDeltaPct = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;
    let verdict = '';
    if (revenue > 0) {
      const revBit = revDeltaPct != null ? `Revenue ${revDeltaPct >= 0 ? '+' : ''}${revDeltaPct.toFixed(0)}% vs the previous period` : 'Revenue holding';
      const marginBit = margin != null ? `margin ${margin.toFixed(1)}%` : 'margin unavailable';
      // Mirror the pulse CASH stage: statement closing balance vs last month
      // when available, weekly widget movement otherwise.
      const cashBit = cashStatement != null && cashLastMonth != null
        ? `cash ${cashStatement - cashLastMonth >= 0 ? 'up' : 'down'} ${fmtK(cashStatement - cashLastMonth)} on last month`
        : cash != null && cashLastWeek != null
          ? `cash ${cash - cashLastWeek >= 0 ? 'up' : 'down'} ${fmtK(cash - cashLastWeek)} on last week`
          : '';
      const weak = margin != null && margin < marginBenchmark
        ? ` Profitability is the watch-point — the group is below the ${marginBenchmark.toFixed(0)}% benchmark.`
        : nhsExposure > 0 ? ' NHS delivery is the watch-point — fees are at risk if the run-rate holds.' : '';
      verdict = `${revBit} · ${marginBit}${cashBit ? ` · ${cashBit}` : ''}.${weak}`;
    }

    return {
      isLoading: locationMetrics.isLoading,
      isCostsLoading: locationMetrics.isCostsLoading || costsImpact.isLoading,
      orgName: organization?.name ?? '',
      siteCount: sites.length,
      chairTotal: chairTotal || null,
      dataToLabel,
      periodDays,
      // scoreboard
      cash, cashLastWeek, monthsCover,
      cashLastMonth, cashLastMonthLabel, statementLoading: statementQuery.isLoading,
      cashStatement, cashStatementLabel,
      revenue, prevRevenue, revenueLY, costs, profit, margin,
      opProfit, opRevenue, opMargin, opSource, marginBenchmark,
      /** Profitability Cost / Expense for group (or selected-location) break-even. */
      beTreatmentCost,
      beOperatingExpense,
      groupBreakEvenSales: groupBreakEven.breakEvenSales,
      groupBreakEvenGap: groupBreakEven.breakEvenGap,
      groupGrossProfit: groupBreakEven.grossProfit,
      groupGrossProfitPct: groupBreakEven.grossProfitPct,
      groupGrossProfitRatio: groupBreakEven.grossProfitRatio,
      benchLoading:
        benchmark.isLoading || production.isLoading || periodAccountingIncome.isLoading,
      safeToDraw, prevNetCashFlow, estValue, groupValue, valuationAllowed,
      operationalEfficiencyAllowed,
      valueLoading: ebitdaValuation.isLoading || ebitdaBridge.isLoading,
      // trend
      trend,
      // engine
      associates, associatesTotal, incomeMix,
      groupUtil, underused, recoverable,
      // league
      sites,
      // nhs
      nhsRows, nhsExposure, nhsHasClaims: nhs.hasClaims, nhsLoading: nhs.isLoading,
      // narrative
      alerts, moves, verdict,
      chairsLoading: chairQuery.isLoading,
    };
  }, [
    locationMetrics.data, locationMetrics.isLoading, locationMetrics.isCostsLoading,
    costsImpact.data, costsImpact.isLoading,
    chairQuery.data, chairQuery.isLoading,
    cashflowOverview, nhs.contractCards, nhs.hasClaims, nhs.isLoading,
    production.data, production.isLoading,
    periodAccountingIncome.data, periodAccountingIncome.isLoading,
    profitTrendQuery.data, profitTrendQuery.isLoading,
    cashflowTrendQuery.data, cashflowTrendQuery.isLoading,
    statementQuery.data, statementQuery.isLoading,
    benchmark.rows, benchmark.productionIncome, benchmark.isLoading,
    ebitdaValuation.valuation, ebitdaValuation.isLoading,
    ebitdaBridge.data, ebitdaBridge.isLoading,
    periodScreenProfit.actualProfit,
    locations, selectedLocationId, organization?.name, periodDays,
    dateRange.startDate, dateRange.endDate, valuationAllowed, operationalEfficiencyAllowed,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ymd(trendStart), ymd(trendEnd),
  ]);
}

export type GroupDashboardVM = ReturnType<typeof useGroupDashboardData>;
