/**
 * useCashflowGrowth
 * Live Growth-page KPIs + monthly cashflow series from cashflow-report,
 * scoped to TopBar region / location / date filters.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { getCashflowReport } from '@/services/cashflowService';
import type { CashflowReportVM } from '@/data/preparingCashflowStatementData';

export interface CashflowGrowthMonth {
  /** Chart/table key, e.g. "Jan-25" */
  month: string;
  /** Short axis label, e.g. "Jan" */
  monthLabel: string;
  sortKey: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  netFlow: number;
  closingBalance: number;
}

export interface CashflowGrowthScenario {
  scenario: 'Base Case' | 'Conservative' | 'Optimistic';
  endBalance: number;
  growthRate: number;
}

export interface CashflowGrowthData {
  openingBalance: number;
  totalNetCashFlow: number;
  /** Last in-range closing balance (period / year-end). */
  closingBalance: number;
  /** Last month column label in range, e.g. "Dec-25". */
  periodEndLabel: string | null;
  monthlySeries: CashflowGrowthMonth[];
  scenarios: CashflowGrowthScenario[];
  currencySymbol: string;
  isLoading: boolean;
  isEmpty: boolean;
  error: unknown;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseColumnKey(key: string): { year: number; month: number; monthLabel: string } | null {
  const parts = (key || '').split('-');
  if (parts.length !== 2) return null;
  const monthIdx = MONTH_ABBR.indexOf(parts[0]);
  if (monthIdx < 0) return null;
  const yy = parseInt(parts[1], 10);
  if (!Number.isFinite(yy)) return null;
  const fullYear = yy < 100 ? 2000 + yy : yy;
  return { year: fullYear, month: monthIdx, monthLabel: parts[0] };
}

function monthOverlapsRange(year: number, month: number, start: Date, end: Date): boolean {
  const monthStart = new Date(year, month, 1).getTime();
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
  return monthEnd >= start.getTime() && monthStart <= end.getTime();
}

function findRow(report: CashflowReportVM, name: string) {
  return report.totalRowDataSet?.find((r) => r.name === name);
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function growthPct(opening: number, closing: number): number {
  if (!Number.isFinite(opening) || opening === 0) return 0;
  return round2(((closing - opening) / Math.abs(opening)) * 100);
}

/** Extract in-range monthly rows from one report. */
function extractMonthlySeries(
  report: CashflowReportVM | null,
  rangeStart: Date,
  rangeEnd: Date,
): CashflowGrowthMonth[] {
  if (!report) return [];

  const openingRow = findRow(report, 'Opening Balance');
  const receivedRow = findRow(report, 'Total Received');
  const paidRow = findRow(report, 'Total Paid');
  const netRow = findRow(report, 'Net Cashflow');
  const closingRow = findRow(report, 'Closing Balance');

  const months: CashflowGrowthMonth[] = [];

  (report.columns ?? []).forEach((col, i) => {
    if (col === 'Total') return;
    const m = parseColumnKey(col);
    if (!m) return;
    if (!monthOverlapsRange(m.year, m.month, rangeStart, rangeEnd)) return;

    const sortKey = `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
    months.push({
      month: col,
      monthLabel: m.monthLabel,
      sortKey,
      openingBalance: num(openingRow?.colData?.[i]?.value),
      inflows: num(receivedRow?.colData?.[i]?.value),
      outflows: num(paidRow?.colData?.[i]?.value),
      netFlow: num(netRow?.colData?.[i]?.value),
      closingBalance: num(closingRow?.colData?.[i]?.value),
    });
  });

  return months;
}

/** Merge multi-location month rows by sortKey (sum all money fields). */
function mergeMonthlySeries(seriesList: CashflowGrowthMonth[][]): CashflowGrowthMonth[] {
  const byKey = new Map<string, CashflowGrowthMonth>();

  for (const series of seriesList) {
    for (const row of series) {
      const existing = byKey.get(row.sortKey);
      if (!existing) {
        byKey.set(row.sortKey, { ...row });
        continue;
      }
      existing.openingBalance += row.openingBalance;
      existing.inflows += row.inflows;
      existing.outflows += row.outflows;
      existing.netFlow += row.netFlow;
      existing.closingBalance += row.closingBalance;
    }
  }

  return [...byKey.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/**
 * Reduce a set of locations to one representative per accounting tenant.
 *
 * Balance-sheet cash is held at Xero-tenant level, so a report fetched for any
 * location of a tenant already returns that tenant's whole cash position.
 * Summing every location would count the same balance once per location.
 * Locations with no accounting mapping carry no cash and are dropped.
 */
async function resolveTenantRepresentativeLocations(
  organizationId: string,
  locationIds: string[],
): Promise<string[]> {
  const { data, error } = await (supabase as any)
    .from('platform_integration_organization_mapping')
    .select('platform_integration_organizations_id, location_id')
    .eq('organization_id', organizationId)
    .in('location_id', locationIds);

  if (error) {
    console.warn('[useCashflowGrowth] tenant mapping lookup failed:', error.message);
    return locationIds;
  }

  const rows = (data ?? []) as Array<{
    platform_integration_organizations_id: string | null;
    location_id: string | null;
  }>;

  const firstLocationByTenant = new Map<string, string>();
  for (const row of rows) {
    const tenantId = row.platform_integration_organizations_id;
    const locationId = row.location_id;
    if (!tenantId || !locationId) continue;
    if (!firstLocationByTenant.has(tenantId)) {
      firstLocationByTenant.set(tenantId, locationId);
    }
  }

  if (firstLocationByTenant.size === 0) return locationIds;

  // Preserve caller order so the query key stays stable.
  const representatives = new Set(firstLocationByTenant.values());
  return locationIds.filter((id) => representatives.has(id));
}

function buildScenarios(
  openingBalance: number,
  closingBalance: number,
  totalNetCashFlow: number,
): CashflowGrowthScenario[] {
  const baseGrowth = growthPct(openingBalance, closingBalance);
  const conservativeEnd = round2(openingBalance + totalNetCashFlow * 0.7);
  const optimisticEnd = round2(openingBalance + totalNetCashFlow * 1.3);

  return [
    {
      scenario: 'Base Case',
      endBalance: round2(closingBalance),
      growthRate: baseGrowth,
    },
    {
      scenario: 'Conservative',
      endBalance: conservativeEnd,
      growthRate: growthPct(openingBalance, conservativeEnd),
    },
    {
      scenario: 'Optimistic',
      endBalance: optimisticEnd,
      growthRate: growthPct(openingBalance, optimisticEnd),
    },
  ];
}

export function useCashflowGrowth(): CashflowGrowthData {
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

  const { data, isLoading, error } = useQuery({
    queryKey: ['cashflow-growth-v2', organizationId, locationKey, fromDate, toDate],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{
      openingBalance: number;
      totalNetCashFlow: number;
      closingBalance: number;
      periodEndLabel: string | null;
      monthlySeries: CashflowGrowthMonth[];
      scenarios: CashflowGrowthScenario[];
      currencySymbol: string;
    }> => {
      const empty = {
        openingBalance: 0,
        totalNetCashFlow: 0,
        closingBalance: 0,
        periodEndLabel: null as string | null,
        monthlySeries: [] as CashflowGrowthMonth[],
        scenarios: buildScenarios(0, 0, 0),
        currencySymbol: '£',
      };
      if (!organizationId) return empty;
      if (locationIdsForQuery && locationIdsForQuery.length === 0) return empty;

      const fetchOne = async (locId: string | undefined) =>
        getCashflowReport(organizationId, {
          fromDate,
          toDate,
          locationId: locId,
          periodGranularity: 'monthly',
        });

      let reports: Array<CashflowReportVM | null> = [];
      if (locationIdsForQuery && locationIdsForQuery.length === 1) {
        reports = [await fetchOne(locationIdsForQuery[0])];
      } else if (locationIdsForQuery && locationIdsForQuery.length > 1) {
        const scopedLocationIds = await resolveTenantRepresentativeLocations(
          organizationId,
          locationIdsForQuery,
        );
        reports = await Promise.all(scopedLocationIds.map((id) => fetchOne(id)));
      } else {
        // All locations: the edge function already scopes to every mapped tenant once.
        reports = [await fetchOne(undefined)];
      }

      const rangeStart = new Date(`${fromDate}T00:00:00`);
      const rangeEnd = new Date(`${toDate}T23:59:59`);

      let currencySymbol = '£';
      const perLocationSeries: CashflowGrowthMonth[][] = [];

      for (const report of reports) {
        if (report?.currencySymbol) currencySymbol = report.currencySymbol;
        perLocationSeries.push(extractMonthlySeries(report, rangeStart, rangeEnd));
      }

      const monthlySeries = mergeMonthlySeries(perLocationSeries);
      const openingBalance = monthlySeries[0]?.openingBalance ?? 0;
      const closingBalance = monthlySeries[monthlySeries.length - 1]?.closingBalance ?? 0;
      const totalNetCashFlow = round2(monthlySeries.reduce((s, m) => s + m.netFlow, 0));
      const periodEndLabel = monthlySeries[monthlySeries.length - 1]?.month ?? null;

      return {
        openingBalance: round2(openingBalance),
        totalNetCashFlow,
        closingBalance: round2(closingBalance),
        periodEndLabel,
        monthlySeries,
        scenarios: buildScenarios(openingBalance, closingBalance, totalNetCashFlow),
        currencySymbol,
      };
    },
  });

  const monthlySeries = data?.monthlySeries ?? [];

  return {
    openingBalance: data?.openingBalance ?? 0,
    totalNetCashFlow: data?.totalNetCashFlow ?? 0,
    closingBalance: data?.closingBalance ?? 0,
    periodEndLabel: data?.periodEndLabel ?? null,
    monthlySeries,
    scenarios: data?.scenarios ?? buildScenarios(0, 0, 0),
    currencySymbol: data?.currencySymbol ?? '£',
    isLoading,
    isEmpty: !isLoading && monthlySeries.length === 0,
    error,
  };
}
