import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { getCashflowReport } from '@/services/cashflowService';
import type { CashflowReportVM } from '@/data/preparingCashflowStatementData';

export interface CashflowMetric {
  thisWeek: number;
  lastWeek: number;
  change: number;
  changePct: number;
  /** True for balance snapshots (Closing Balance). UI suppresses % change. */
  isBalance?: boolean;
}

export interface CashflowOverviewData {
  totalReceived: CashflowMetric;
  totalPaid: CashflowMetric;
  netCashflow: CashflowMetric;
  closingBalance: CashflowMetric;
  isLoading: boolean;
  error: unknown;
}

const ZERO_METRIC: CashflowMetric = { thisWeek: 0, lastWeek: 0, change: 0, changePct: 0 };

function diff(thisVal: number, lastVal: number, opts: { isBalance?: boolean } = {}): CashflowMetric {
  const change = thisVal - lastVal;
  const changePct = lastVal !== 0 ? (change / Math.abs(lastVal)) * 100 : 0;
  return {
    thisWeek: thisVal,
    lastWeek: lastVal,
    change,
    changePct,
    isBalance: opts.isBalance,
  };
}

function startOfWeekMonday(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay();
  const diffDays = (day + 6) % 7;
  r.setDate(r.getDate() - diffDays);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseColumnKey(key: string): { year: number; month: number } | null {
  const parts = (key || '').split('-');
  if (parts.length !== 2) return null;
  const monthIdx = MONTH_ABBR.indexOf(parts[0]);
  if (monthIdx < 0) return null;
  const yy = parseInt(parts[1], 10);
  if (!Number.isFinite(yy)) return null;
  const fullYear = yy < 100 ? 2000 + yy : yy;
  return { year: fullYear, month: monthIdx };
}

function monthOverlapsRange(year: number, month: number, start: Date, end: Date): boolean {
  const monthStart = new Date(year, month, 1).getTime();
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
  return monthEnd >= start.getTime() && monthStart <= end.getTime();
}

function aggregateRange(
  report: CashflowReportVM | null,
  rangeStart: Date,
  rangeEnd: Date,
): { received: number; paid: number; net: number; closing: number } {
  if (!report) return { received: 0, paid: 0, net: 0, closing: 0 };
  const findRow = (name: string) =>
    report.totalRowDataSet?.find((r) => r.name === name);
  const recRow = findRow('Total Received');
  const paidRow = findRow('Total Paid');
  const netRow = findRow('Net Cashflow');
  const closingRow = findRow('Closing Balance');

  let received = 0, paid = 0, netflow = 0, closing = 0;
  let lastInRangeIdx = -1;
  const num = (v: unknown) => Number(v) || 0;
  (report.columns ?? []).forEach((col, i) => {
    const m = parseColumnKey(col);
    if (!m) return;
    if (!monthOverlapsRange(m.year, m.month, rangeStart, rangeEnd)) return;
    received += num(recRow?.colData?.[i]?.value);
    paid     += num(paidRow?.colData?.[i]?.value);
    netflow  += num(netRow?.colData?.[i]?.value);
    if (i > lastInRangeIdx) {
      lastInRangeIdx = i;
      closing = num(closingRow?.colData?.[i]?.value);
    }
  });
  return { received, paid, net: netflow, closing };
}

export interface CashflowOverviewOverrides {
  /** Override the "This Week" column date range. */
  thisStart?: Date | null;
  thisEnd?: Date | null;
  /** Override the "Last Week" column date range. */
  lastStart?: Date | null;
  lastEnd?: Date | null;
}

/**
 * Powers the Cashflow Overview table on the dashboard.
 *
 * Two data sources, dispatched by whether the user has overridden a column:
 *
 *   • DEFAULT (no override): Monday-anchored "this week" / "last week"
 *     against `dateRange.endDate`. Uses the day-level RPC
 *     `get_cashflow_overview_weekly` for accurate weekly numbers — the
 *     `cashflow-report` edge function only returns calendar-month columns
 *     and would over-count when summed for sub-monthly ranges.
 *
 *   • OVERRIDDEN (Last Month / This Month / custom range): the SAME
 *     `cashflow-report` edge function the Statement of Cash Flows page
 *     uses, with the same `today − 210 days` anchor. For each column we
 *     sum the matching monthly columns; closing balance is the last
 *     in-range month's closing snapshot. The dashboard values then equal
 *     the Statement's monthly columns exactly.
 *
 *     Sub-monthly custom ranges include the full calendar month they
 *     overlap (the cashflow-report has no sub-monthly granularity).
 */
export function useCashflowOverview(
  overrides?: CashflowOverviewOverrides,
): CashflowOverviewData {
  const { organizationId } = useOrganization();
  const { selectedLocationId, selectedRegionId, dateRange } = useFilters();
  const { allAvailableLocations } = useLocations();

  const ovThisStartMs = overrides?.thisStart ? overrides.thisStart.getTime() : null;
  const ovThisEndMs   = overrides?.thisEnd   ? overrides.thisEnd.getTime()   : null;
  const ovLastStartMs = overrides?.lastStart ? overrides.lastStart.getTime() : null;
  const ovLastEndMs   = overrides?.lastEnd   ? overrides.lastEnd.getTime()   : null;

  // True when the user has overridden any of the four bounds. Drives the
  // data-source dispatch (weekly RPC vs cashflow-report).
  const hasOverride =
    ovThisStartMs != null || ovThisEndMs != null ||
    ovLastStartMs != null || ovLastEndMs != null;

  const locationIdsForQuery = useMemo<string[] | null>(() => {
    if (selectedLocationId) return [selectedLocationId];
    if (selectedRegionId) {
      const ids = allAvailableLocations
        .filter(l => l.region_id === selectedRegionId)
        .map(l => l.id);
      return ids.length > 0 ? ids : [];
    }
    return null;
  }, [selectedLocationId, selectedRegionId, allAvailableLocations]);

  const locationKey = locationIdsForQuery
    ? locationIdsForQuery.slice().sort().join(',')
    : 'all';

  // Default: Monday-anchored week against the global date filter.
  // Overrides replace either column independently.
  const { thisStart, thisEnd, lastStart, lastEnd, balanceAnchor } = useMemo(() => {
    const anchor = dateRange.endDate;
    const tStart = ovThisStartMs ? new Date(ovThisStartMs) : startOfWeekMonday(anchor);
    const tEnd   = ovThisEndMs   ? new Date(ovThisEndMs)   : addDays(tStart, 6);
    const lStart = ovLastStartMs ? new Date(ovLastStartMs) : addDays(tStart, -7);
    const lEnd   = ovLastEndMs   ? new Date(ovLastEndMs)   : addDays(lStart, 6);
    const latestEnd = tEnd.getTime() > lEnd.getTime() ? tEnd : lEnd;
    const balAnchor = new Date(latestEnd.getFullYear(), 0, 1);
    return {
      thisStart: tStart, thisEnd: tEnd,
      lastStart: lStart, lastEnd: lEnd,
      balanceAnchor: balAnchor,
    };
  }, [dateRange.endDate, ovThisStartMs, ovThisEndMs, ovLastStartMs, ovLastEndMs]);

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'cashflow-overview-v14',
      organizationId,
      locationKey,
      hasOverride ? 'report' : 'weekly',
      thisStart.toISOString(),
      thisEnd.toISOString(),
      lastStart.toISOString(),
      lastEnd.toISOString(),
      balanceAnchor.toISOString(),
    ],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{
      totalReceived: CashflowMetric;
      totalPaid: CashflowMetric;
      netCashflow: CashflowMetric;
      closingBalance: CashflowMetric;
    }> => {
      const empty = {
        totalReceived: ZERO_METRIC,
        totalPaid: ZERO_METRIC,
        netCashflow: ZERO_METRIC,
        closingBalance: { ...ZERO_METRIC, isBalance: true },
      };
      if (!organizationId) return empty;
      if (locationIdsForQuery && locationIdsForQuery.length === 0) return empty;

      // ── Path A: overrides set → match Statement of Cash Flows ────
      // The cashflow-report's Closing Balance is cumulative from fromDate
      // (starts at £0 on that day). To match the Statement page exactly,
      // anchor fromDate to the same point the Statement uses: the first
      // day of the same month, one year ago. (For a UK dental practice
      // the Statement view typically starts at April 1 of the previous
      // calendar year — this 13-month rolling anchor matches that and
      // hides any small pre-FY-start carry that the Statement also
      // ignores.) If the user picks a range that begins earlier than
      // this anchor, fall back to the range's own start so we don't
      // crop the user's selection.
      if (hasOverride) {
        const today = new Date();
        const statementAnchor = new Date(today.getFullYear() - 1, today.getMonth(), 1);
        const earliestRangeStart = lastStart.getTime() < thisStart.getTime() ? lastStart : thisStart;
        const fromDateObj = earliestRangeStart.getTime() < statementAnchor.getTime()
          ? earliestRangeStart
          : statementAnchor;
        const latestRangeEnd = lastEnd.getTime() > thisEnd.getTime() ? lastEnd : thisEnd;
        const fromDate = toIsoDate(fromDateObj);
        const toDate   = toIsoDate(latestRangeEnd);

        const fetchOne = async (locId: string | undefined) =>
          getCashflowReport(organizationId, { fromDate, toDate, locationId: locId });

        let reports: Array<CashflowReportVM | null> = [];
        if (locationIdsForQuery && locationIdsForQuery.length === 1) {
          reports = [await fetchOne(locationIdsForQuery[0])];
        } else if (locationIdsForQuery && locationIdsForQuery.length > 1) {
          reports = await Promise.all(locationIdsForQuery.map((id) => fetchOne(id)));
        } else {
          reports = [await fetchOne(undefined)];
        }

        let lastTot = { received: 0, paid: 0, net: 0, closing: 0 };
        let thisTot = { received: 0, paid: 0, net: 0, closing: 0 };
        for (const report of reports) {
          const lastAgg = aggregateRange(report, lastStart, lastEnd);
          const thisAgg = aggregateRange(report, thisStart, thisEnd);
          lastTot.received += lastAgg.received;
          lastTot.paid     += lastAgg.paid;
          lastTot.net      += lastAgg.net;
          lastTot.closing  += lastAgg.closing;
          thisTot.received += thisAgg.received;
          thisTot.paid     += thisAgg.paid;
          thisTot.net      += thisAgg.net;
          thisTot.closing  += thisAgg.closing;
        }

        return {
          totalReceived:  diff(thisTot.received, lastTot.received),
          totalPaid:      diff(thisTot.paid,     lastTot.paid),
          netCashflow:    diff(thisTot.net,      lastTot.net),
          closingBalance: diff(thisTot.closing,  lastTot.closing, { isBalance: true }),
        };
      }

      // ── Path B: default Mon-anchored week → weekly RPC ──────────
      // Resolve xero_tenant_id list for region/location scope.
      let tenantIds: string[] | null = null;
      if (locationIdsForQuery && locationIdsForQuery.length > 0) {
        const { data: mappingRows } = await (supabase as any)
          .from('platform_integration_organization_mapping')
          .select('platform_integration_organizations_id')
          .eq('organization_id', organizationId)
          .in('location_id', locationIdsForQuery);
        const set = new Set<string>();
        for (const row of (mappingRows ?? []) as Array<{
          platform_integration_organizations_id: string;
        }>) {
          if (row.platform_integration_organizations_id) {
            set.add(row.platform_integration_organizations_id);
          }
        }
        tenantIds = [...set];
        if (tenantIds.length === 0) return empty;
      }

      const { data: rpcData, error: rpcError } = await (supabase as any).rpc(
        'get_cashflow_overview_weekly',
        {
          p_organization_id: organizationId,
          p_tenant_ids: tenantIds,
          p_anchor_date: toIsoDate(balanceAnchor),
          p_last_start: toIsoDate(lastStart),
          p_last_end: toIsoDate(lastEnd),
          p_this_start: toIsoDate(thisStart),
          p_this_end: toIsoDate(thisEnd),
        },
      );
      if (rpcError) {
        console.error('[CashflowOverview] weekly RPC error:', rpcError);
        throw rpcError;
      }

      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      const num = (v: unknown) => Number(v) || 0;
      return {
        totalReceived:  diff(num(row?.received_this), num(row?.received_last)),
        totalPaid:      diff(num(row?.paid_this),     num(row?.paid_last)),
        netCashflow:    diff(num(row?.net_this),      num(row?.net_last)),
        closingBalance: diff(num(row?.closing_this),  num(row?.closing_last), { isBalance: true }),
      };
    },
  });

  return {
    totalReceived: data?.totalReceived ?? ZERO_METRIC,
    totalPaid: data?.totalPaid ?? ZERO_METRIC,
    netCashflow: data?.netCashflow ?? ZERO_METRIC,
    closingBalance: data?.closingBalance ?? { ...ZERO_METRIC, isBalance: true },
    isLoading,
    error,
  };
}
