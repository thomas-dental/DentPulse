import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { StatusType } from '@/data/mockData';
import { getCashflowReport } from '@/services/cashflowService';
import { getProfitBenchmark } from '@/services/profitBenchmarkService';
import { fetchEbitdaAddBacks } from './useEbitdaBridge';
import { fetchAllProvidersNetProduction } from './useAllProvidersNetProduction';
import { fetchLocationIncomeAccountingTotals } from './useLocationIncomeAccountingTotals';
import { composeIncomeBreakdown, deriveActualProfit, splitProfitBenchmarkCostExpense } from '@/utils/profitBenchmarkActual';

const PAGE_SIZE = 1000;
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const round1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;
/** Cap parallel location edge/RPC work — avoids storms while cutting sequential wait. */
const LOCATION_CONCURRENCY = 3;

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Run async work over items with a fixed concurrency pool. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** Paginated fetch helper — same pattern as useTreatmentInsights. */
async function fetchAll<T>(buildQuery: () => any, pageSize = PAGE_SIZE): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) {
      console.error('[fetchAll] error:', error);
      break;
    }
    const rows = (data ?? []) as T[];
    all.push(...rows);
    hasMore = rows.length === pageSize;
    offset += pageSize;
  }
  return all;
}

export interface LocationMetrics {
  locationId: string;
  /** Profit Benchmark Production Income for the header date range. */
  revenue: number;
  /** Treatment-Insights-style TPI revenue — the pre-override figure, kept so
   *  consumers (Group Dashboard site league) can opt back into the PMS total. */
  pmsRevenue?: number;
  previousRevenue: number;
  paidInvoiceCount: number;
  totalInvoiceCount: number;
  collectionRate: number;
  /** Cash Flow Statement → Total Received (period total). */
  collectionAmount: number;
  totalOutstanding: number;
  totalCreditSales: number;
  arDays: number;
  /** EBITDA Margin % = EBITDA ÷ Production Income × 100. */
  ebitdaPercent: number | null;
  totalCosts: number;
  /** Profitability → Total Costs Of Treatment Delivery (group_type 2). */
  treatmentCost: number;
  /** Profitability → Total Expenses To Run Your Business (group_type 3). */
  operatingExpense: number;
  /** Profit Benchmark Actual Profit amount. */
  netProfit: number | null;
  /** Cash Flow Statement → Net Cashflow (period total). */
  netCashFlow: number | null;
  status: StatusType;
  rank: number;
}

interface CashflowOverride {
  collectionAmount: number;
  netCashFlow: number;
}

interface ProfitOverride {
  revenue: number;
  previousRevenue: number;
  netProfit: number | null;
  ebitdaPercent: number | null;
  totalCosts: number;
  treatmentCost: number;
  operatingExpense: number;
}

function deriveProfitFromBenchmark(
  productionIncome: number,
  rows: Array<{
    isProfitRow?: boolean;
    metric?: string;
    actualAmount?: number | null;
    groupType?: number | null;
    groupAccountMasterId?: number | null;
  }>,
): {
  netProfit: number;
  totalCosts: number;
  treatmentCost: number;
  operatingExpense: number;
} {
  const { actualProfit, totalExpenses } = deriveActualProfit(productionIncome, rows);
  const { totalCost, totalExpense } = splitProfitBenchmarkCostExpense(rows);
  return {
    netProfit: actualProfit,
    totalCosts: totalExpenses,
    treatmentCost: totalCost,
    operatingExpense: totalExpense,
  };
}

function totalCol(
  row: { colData: Array<{ column?: string; value: number | string }> } | undefined,
): number {
  if (!row?.colData?.length) return 0;
  const totalCell = row.colData.find((c) => c.column === 'Total');
  if (totalCell != null) return Number(totalCell.value) || 0;
  return row.colData.reduce((sum, c) => sum + (Number(c.value) || 0), 0);
}

/**
 * Fetches aggregated metrics for ALL locations in the organization.
 *
 * Sources (aligned with product screens):
 *   • Revenue / Net Profit / EBITDA % ← Profit Benchmark SCREEN formula
 *     (Private + Membership + NHS composition + expense actuals)
 *   • Collection Amount / Net Cash Flow ← Cash Flow Statement totals
 *   • AR / collection rate ← invoices (supplementary)
 */
export function useLocationMetrics() {
  const { organizationId } = useOrganization();
  const { dateRange } = useFilters();

  const startDate = toDateStr(dateRange.startDate);
  const endDate = toDateStr(dateRange.endDate);

  const periodMs = dateRange.endDate.getTime() - dateRange.startDate.getTime();
  const prevStart = new Date(dateRange.startDate.getTime() - periodMs);
  const prevEnd = new Date(dateRange.startDate.getTime() - 1);
  const prevStartDate = toDateStr(prevStart);
  const prevEndDate = toDateStr(prevEnd);

  const daysInPeriod = Math.max(1, Math.ceil(periodMs / (1000 * 60 * 60 * 24)));

  // ── Core AR / invoice metrics + raw TPI revenue (fast) ─────────────────
  const coreQuery = useQuery({
    queryKey: ['location-metrics-core-v4', organizationId, startDate, endDate],
    queryFn: async (): Promise<Map<string, LocationMetrics>> => {
      if (!organizationId) return new Map();

      const [locations, invoices, providerRows, tpiRows] = await Promise.all([
        fetchAll<{ id: string }>(() =>
          (supabase as any)
            .from('practice_locations')
            .select('id')
            .eq('organization_id', organizationId)
            .is('deleted_at', null),
        ),
        fetchAll<{
          location_id: string | null;
          subtotal: number | null;
          amount_outstanding: number | null;
          is_paid: boolean | null;
        }>(() =>
          (supabase as any)
            .from('platform_integration_invoices')
            .select('location_id, subtotal, amount_outstanding, is_paid')
            .eq('organization_id', organizationId)
            .gte('invoice_date', startDate)
            .lte('invoice_date', endDate)
            .is('deleted_at', null),
        ),
        // Provider → location_id map. Used to attribute TPIs whose own
        // `location_id` column is NULL (legacy / unsynced rows).
        fetchAll<{ external_id: number | string | null; location_id: string | null }>(() =>
          (supabase as any)
            .from('providers')
            .select('external_id, location_id')
            .eq('organization_id', organizationId)
            .is('deleted_at', null),
        ),
        // TPIs — Treatment-Insights-style revenue, kept as `pmsRevenue`
        // alongside the Profit Benchmark override (Group Dashboard league).
        // Including negative prices nets out refunds/credits the same way
        // Dentally's Practitioner Activity report does.
        fetchAll<{
          id: string;
          tpi_price: number | null;
          location_id: string | null;
          tpi_practitioner_id: number | null;
          tpi_completed_at: string | null;
        }>(() =>
          (supabase as any)
            .from('treatment_plan_items')
            .select('id, tpi_price, location_id, tpi_practitioner_id, tpi_completed_at')
            .eq('organization_id', organizationId)
            .eq('tpi_completed', true)
            .not('tpi_completed_at', 'is', null)
            .not('tpi_payment_plan_id', 'is', null)
            // London day-boundary instants — bare 'YYYY-MM-DD' strings are cast
            // as UTC by the DB, one hour late during BST.
            .gte('tpi_completed_at', ukDayStartInstant(dateRange.startDate))
            .lte('tpi_completed_at', ukDayEndInstant(dateRange.endDate)),
        ),
      ]);

      // Provider external_id → location_id (for the TPI location fallback).
      const providerLocationMap = new Map<string, string>();
      for (const row of providerRows) {
        if (row.external_id != null && row.location_id) {
          providerLocationMap.set(String(row.external_id), row.location_id);
        }
      }

      const metricsMap = new Map<string, LocationMetrics>();
      const ensureMetrics = (locId: string): LocationMetrics => {
        let m = metricsMap.get(locId);
        if (!m) {
          m = {
            locationId: locId,
            revenue: 0,
            pmsRevenue: 0,
            previousRevenue: 0,
            paidInvoiceCount: 0,
            totalInvoiceCount: 0,
            collectionRate: 0,
            collectionAmount: 0,
            totalOutstanding: 0,
            totalCreditSales: 0,
            arDays: 0,
            ebitdaPercent: null,
            totalCosts: 0,
            treatmentCost: 0,
            operatingExpense: 0,
            netProfit: null,
            netCashFlow: null,
            status: 'success',
            rank: 0,
          };
          metricsMap.set(locId, m);
        }
        return m;
      };

      for (const loc of locations) {
        if (loc.id) ensureMetrics(loc.id);
      }

      // Aggregate TPI revenue by location — dedupe by row id, fall back to
      // the provider's location when the TPI has no location_id stamped.
      const seenRowIds = new Set<string>();
      for (const tpi of tpiRows) {
        if (seenRowIds.has(tpi.id)) continue;
        seenRowIds.add(tpi.id);
        let locId = tpi.location_id;
        if (!locId && tpi.tpi_practitioner_id != null) {
          locId = providerLocationMap.get(String(tpi.tpi_practitioner_id)) ?? null;
        }
        if (!locId) continue;
        const m = ensureMetrics(locId);
        m.pmsRevenue = (m.pmsRevenue ?? 0) + asNumber(tpi.tpi_price);
      }

      for (const inv of invoices) {
        const locId = inv.location_id;
        if (!locId) continue;
        const m = ensureMetrics(locId);
        m.totalInvoiceCount++;
        const subtotal = asNumber(inv.subtotal);
        const outstanding = asNumber(inv.amount_outstanding);
        m.totalCreditSales += subtotal;
        if (inv.is_paid) m.paidInvoiceCount++;
        m.totalOutstanding += outstanding;
        m.collectionAmount += Math.max(0, subtotal - outstanding);
      }

      for (const m of metricsMap.values()) {
        m.collectionRate =
          m.totalInvoiceCount > 0
            ? Math.round((m.paidInvoiceCount / m.totalInvoiceCount) * 1000) / 10
            : 0;
        m.arDays =
          m.totalCreditSales > 0
            ? Math.round((m.totalOutstanding / m.totalCreditSales) * daysInPeriod)
            : 0;
        if (m.collectionRate < 90 || m.arDays > 45) m.status = 'danger';
        else if (m.collectionRate < 95 || m.arDays > 35) m.status = 'warning';
        else m.status = 'success';
      }

      return metricsMap;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // ── Profit Benchmark screen formula + EBITDA Margin (per location) ───
  // B2: org-wide production fetched once (curr + prev), then each location
  // runs accounting + profit-benchmark + add-backs with limited concurrency.
  // Same compose/derive formulas as before — fewer sequential round-trips.
  const profitQuery = useQuery({
    queryKey: [
      'location-metrics-profit-v5',
      organizationId,
      startDate,
      endDate,
      prevStartDate,
      prevEndDate,
    ],
    queryFn: async (): Promise<Map<string, ProfitOverride>> => {
      const out = new Map<string, ProfitOverride>();
      if (!organizationId) return out;

      const { data: locs } = await (supabase as any)
        .from('practice_locations')
        .select('id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);
      const locationIds = ((locs ?? []) as Array<{ id: string }>)
        .map((l) => l.id)
        .filter(Boolean);
      if (locationIds.length === 0) return out;

      const currStart = parseYmd(startDate);
      const currEnd = parseYmd(endDate);
      const prevStartD = parseYmd(prevStartDate);
      const prevEndD = parseYmd(prevEndDate);

      // One org-wide production sweep per period (internally fans out by location
      // with NHS overlay). Providers keep locationId for per-site composition.
      const [currProd, prevProd] = await Promise.all([
        fetchAllProvidersNetProduction(organizationId, {
          startDate: currStart,
          endDate: currEnd,
          locationId: null,
        }),
        fetchAllProvidersNetProduction(organizationId, {
          startDate: prevStartD,
          endDate: prevEndD,
          locationId: null,
        }).catch(() => ({ providers: [], months: [] as string[] })),
      ]);

      const providersByLoc = new Map<string, typeof currProd.providers>();
      for (const p of currProd.providers ?? []) {
        const locId = p.locationId;
        if (!locId) continue;
        const list = providersByLoc.get(locId) ?? [];
        list.push(p);
        providersByLoc.set(locId, list);
      }
      const prevProvidersByLoc = new Map<string, typeof prevProd.providers>();
      for (const p of prevProd.providers ?? []) {
        const locId = p.locationId;
        if (!locId) continue;
        const list = prevProvidersByLoc.get(locId) ?? [];
        list.push(p);
        prevProvidersByLoc.set(locId, list);
      }

      await mapPool(locationIds, LOCATION_CONCURRENCY, async (locId) => {
        try {
          const [acct, prevAcct, curr, addBacks] = await Promise.all([
            fetchLocationIncomeAccountingTotals(
              organizationId,
              startDate,
              endDate,
              locId,
            ),
            fetchLocationIncomeAccountingTotals(
              organizationId,
              prevStartDate,
              prevEndDate,
              locId,
            ).catch(() => null),
            getProfitBenchmark(organizationId, {
              fromDate: startDate,
              toDate: endDate,
              locationId: locId,
            }),
            fetchEbitdaAddBacks(organizationId, locId, startDate, endDate),
          ]);

          const monthProviders = (providersByLoc.get(locId) ?? []).map((p) => ({
            totalPrivate: Number(p.totalPrivate) || 0,
            totalMembership: Number(p.totalMembership) || 0,
            totalNhs: Number(p.totalNhs) || 0,
          }));
          const prevMonthProviders = (prevProvidersByLoc.get(locId) ?? []).map((p) => ({
            totalPrivate: Number(p.totalPrivate) || 0,
            totalMembership: Number(p.totalMembership) || 0,
            totalNhs: Number(p.totalNhs) || 0,
          }));

          const income = composeIncomeBreakdown(monthProviders, acct);
          const previousIncome = composeIncomeBreakdown(
            prevMonthProviders,
            prevAcct,
          );
          const revenue = income.total;
          const { netProfit, totalCosts, treatmentCost, operatingExpense } =
            deriveProfitFromBenchmark(revenue, curr.rows || []);
          const ebitda = round2(netProfit + addBacks.total);
          const ebitdaPercent =
            revenue > 0 ? round1((ebitda / revenue) * 100) : null;

          out.set(locId, {
            revenue: round2(Math.abs(revenue)),
            previousRevenue: round2(Math.abs(previousIncome.total)),
            netProfit,
            ebitdaPercent,
            totalCosts,
            treatmentCost,
            operatingExpense,
          });
        } catch (err) {
          console.error(`[LocationMetrics] profit-benchmark error for ${locId}:`, err);
        }
      });

      return out;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // ── Cashflow: Total Received + Net Cashflow (per location) ─────────────
  // B2: bounded concurrency (was Promise.all over every site = N full journal dumps).
  const cashflowQuery = useQuery({
    queryKey: ['location-metrics-cashflow-v4', organizationId, startDate, endDate],
    queryFn: async (): Promise<Map<string, CashflowOverride>> => {
      const overrides = new Map<string, CashflowOverride>();
      if (!organizationId) return overrides;

      const { data: locs } = await (supabase as any)
        .from('practice_locations')
        .select('id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);
      const locationIds = ((locs ?? []) as Array<{ id: string }>)
        .map((l) => l.id)
        .filter(Boolean);
      if (locationIds.length === 0) return overrides;

      await mapPool(locationIds, LOCATION_CONCURRENCY, async (locId) => {
        try {
          const report = await getCashflowReport(organizationId, {
            fromDate: startDate,
            toDate: endDate,
            locationId: locId,
          });
          const totalReceivedRow = report.totalRowDataSet?.find(
            (r) => r.name === 'Total Received',
          );
          const netCashflowRow = report.totalRowDataSet?.find(
            (r) => r.name === 'Net Cashflow',
          );
          overrides.set(locId, {
            collectionAmount: totalCol(totalReceivedRow),
            netCashFlow: totalCol(netCashflowRow),
          });
        } catch (err) {
          console.error(
            `[LocationMetrics] cashflow-report error for location ${locId}:`,
            err,
          );
        }
      });

      return overrides;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const mergedData = useMemo(() => {
    if (!coreQuery.data) return coreQuery.data;

    const profitMap = profitQuery.data;
    const cashflowMap = cashflowQuery.data;
    const merged = new Map<string, LocationMetrics>();

    const allIds = new Set<string>([
      ...coreQuery.data.keys(),
      ...(profitMap ? [...profitMap.keys()] : []),
      ...(cashflowMap ? [...cashflowMap.keys()] : []),
    ]);

    for (const locId of allIds) {
      const base = coreQuery.data.get(locId) ?? {
        locationId: locId,
        revenue: 0,
        previousRevenue: 0,
        paidInvoiceCount: 0,
        totalInvoiceCount: 0,
        collectionRate: 0,
        collectionAmount: 0,
        totalOutstanding: 0,
        totalCreditSales: 0,
        arDays: 0,
        ebitdaPercent: null,
        totalCosts: 0,
        treatmentCost: 0,
        operatingExpense: 0,
        netProfit: null,
        netCashFlow: null,
        status: 'success' as StatusType,
        rank: 0,
      };

      const profit = profitMap?.get(locId);
      const cashflow = cashflowMap?.get(locId);

      merged.set(locId, {
        ...base,
        pmsRevenue: base.pmsRevenue ?? 0,
        revenue: profit?.revenue ?? base.revenue,
        previousRevenue: profit?.previousRevenue ?? base.previousRevenue,
        netProfit: profit?.netProfit ?? base.netProfit,
        ebitdaPercent: profit?.ebitdaPercent ?? base.ebitdaPercent,
        totalCosts: profit?.totalCosts ?? base.totalCosts,
        treatmentCost: profit?.treatmentCost ?? base.treatmentCost ?? 0,
        operatingExpense: profit?.operatingExpense ?? base.operatingExpense ?? 0,
        collectionAmount: cashflow?.collectionAmount ?? base.collectionAmount,
        netCashFlow: cashflow?.netCashFlow ?? base.netCashFlow,
      });
    }

    const sorted = [...merged.values()].sort((a, b) => b.revenue - a.revenue);
    sorted.forEach((m, i) => {
      m.rank = i + 1;
    });

    return merged;
  }, [coreQuery.data, profitQuery.data, cashflowQuery.data]);

  return {
    data: mergedData,
    isLoading: coreQuery.isLoading,
    isCostsLoading: profitQuery.isLoading,
    isCashflowLoading: cashflowQuery.isLoading || profitQuery.isLoading,
    error: coreQuery.error ?? profitQuery.error ?? cashflowQuery.error,
  };
}
