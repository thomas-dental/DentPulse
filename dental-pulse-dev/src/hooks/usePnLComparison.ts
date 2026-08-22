/**
 * Live P&L Period Comparison + P&L vs Group data.
 *
 * Costs/expenses come from Profit Benchmark category rows.
 * Revenue uses the same client-side Production Income formula as the
 * Profit Benchmark tab (Private + Membership + NHS via
 * fetchProfitBenchmarkProductionIncome) — not the edge-function total,
 * which can under-report (e.g. Membership only).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useFilters } from '@/contexts/FilterContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useProfitBenchmark } from '@/hooks/useProfitBenchmark';
import { useEbitdaBridge } from '@/hooks/useEbitdaBridge';
import { getPreviousDateRange } from '@/utils/dateRangeUtils';
import { fetchProfitBenchmarkProductionIncome } from '@/utils/fetchProfitBenchmarkProductionIncome';
import {
  aggregatePnLBuckets,
  buildEntityVsGroupRows,
  buildPeriodComparisonRows,
  ppDelta,
  sharePct,
  type PnLBucketAmounts,
  type PnLComparisonRow,
  type PnLEntityVsGroupRow,
} from '@/utils/pnlComparison';

export interface PnLComparisonResult {
  isLoading: boolean;
  hasData: boolean;
  periodRows: PnLComparisonRow[];
  entityVsGroupRows: PnLEntityVsGroupRow[];
  current: PnLBucketAmounts;
  prior: PnLBucketAmounts;
  group: PnLBucketAmounts;
  entityEbitda: number;
  groupEbitda: number;
  contribution: {
    revenueShare: number;
    profitShare: number;
    ebitdaShare: number;
  };
  vsGroup: {
    ebitdaMarginPp: number;
    netProfitMarginPp: number;
    /** Group total-cost% − entity total-cost% (positive = entity leaner). */
    costEfficiencyPp: number;
  };
  priorLabel: string;
}

export function usePnLComparison(): PnLComparisonResult {
  const { organizationId } = useOrganization();
  const { dateRange, selectedDateRangeId, selectedLocationId } = useFilters();

  const locationId =
    selectedLocationId && String(selectedLocationId).toLowerCase() !== 'all'
      ? selectedLocationId
      : null;

  const fromDate = format(dateRange.startDate, 'yyyy-MM-dd');
  const toDate = format(dateRange.endDate, 'yyyy-MM-dd');

  const previous = useMemo(
    () => getPreviousDateRange(selectedDateRangeId, dateRange),
    [selectedDateRangeId, dateRange],
  );
  const priorFrom = format(previous.startDate, 'yyyy-MM-dd');
  const priorTo = format(previous.endDate, 'yyyy-MM-dd');
  const priorLabel = `${format(previous.startDate, 'dd MMM yyyy')} – ${format(previous.endDate, 'dd MMM yyyy')}`;

  // Cost/expense category actuals from Profit Benchmark.
  const currentBm = useProfitBenchmark(fromDate, toDate, undefined, locationId);
  const priorBm = useProfitBenchmark(priorFrom, priorTo, undefined, locationId);
  const groupBm = useProfitBenchmark(fromDate, toDate, undefined, null);

  // Production Income — same path as Profit Benchmark tab (not edge-function total).
  const incomeQuery = useQuery({
    queryKey: [
      'pnl-comparison-production-income',
      organizationId,
      fromDate,
      toDate,
      priorFrom,
      priorTo,
      locationId ?? 'all',
    ],
    enabled: !!organizationId && !!fromDate && !!toDate,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!organizationId) {
        return {
          current: 0,
          prior: 0,
          group: 0,
        };
      }
      const [current, prior, group] = await Promise.all([
        fetchProfitBenchmarkProductionIncome(
          organizationId,
          fromDate,
          toDate,
          locationId,
        ),
        fetchProfitBenchmarkProductionIncome(
          organizationId,
          priorFrom,
          priorTo,
          locationId,
        ),
        fetchProfitBenchmarkProductionIncome(
          organizationId,
          fromDate,
          toDate,
          null,
        ),
      ]);
      return {
        current: current.total,
        prior: prior.total,
        group: group.total,
      };
    },
  });

  const currentBuckets = useMemo(
    () =>
      aggregatePnLBuckets(
        currentBm.rows,
        incomeQuery.data?.current ?? 0,
      ),
    [currentBm.rows, incomeQuery.data?.current],
  );
  const priorBuckets = useMemo(
    () =>
      aggregatePnLBuckets(priorBm.rows, incomeQuery.data?.prior ?? 0),
    [priorBm.rows, incomeQuery.data?.prior],
  );
  const groupBuckets = useMemo(
    () =>
      aggregatePnLBuckets(groupBm.rows, incomeQuery.data?.group ?? 0),
    [groupBm.rows, incomeQuery.data?.group],
  );

  const {
    data: entityBridge,
    isLoading: entityBridgeLoading,
  } = useEbitdaBridge(fromDate, toDate, currentBuckets.netProfit, locationId);

  const {
    data: groupBridge,
    isLoading: groupBridgeLoading,
  } = useEbitdaBridge(fromDate, toDate, groupBuckets.netProfit, null);

  const entityEbitda = entityBridge?.ebitda ?? currentBuckets.netProfit;
  const groupEbitda = groupBridge?.ebitda ?? groupBuckets.netProfit;

  const periodRows = useMemo(
    () => buildPeriodComparisonRows(currentBuckets, priorBuckets),
    [currentBuckets, priorBuckets],
  );

  const entityVsGroupRows = useMemo(
    () =>
      buildEntityVsGroupRows(
        currentBuckets,
        groupBuckets,
        entityEbitda,
        groupEbitda,
      ),
    [currentBuckets, groupBuckets, entityEbitda, groupEbitda],
  );

  const entityTotalCostPct =
    currentBuckets.revenue > 0
      ? ((currentBuckets.clinicianCosts +
          currentBuckets.staffCosts +
          currentBuckets.labMaterials +
          currentBuckets.overhead) /
          currentBuckets.revenue) *
        100
      : 0;
  const groupTotalCostPct =
    groupBuckets.revenue > 0
      ? ((groupBuckets.clinicianCosts +
          groupBuckets.staffCosts +
          groupBuckets.labMaterials +
          groupBuckets.overhead) /
          groupBuckets.revenue) *
        100
      : 0;

  const entityEbitdaMargin =
    currentBuckets.revenue > 0
      ? (entityEbitda / currentBuckets.revenue) * 100
      : 0;
  const groupEbitdaMargin =
    groupBuckets.revenue > 0 ? (groupEbitda / groupBuckets.revenue) * 100 : 0;
  const entityNetMargin =
    currentBuckets.revenue > 0
      ? (currentBuckets.netProfit / currentBuckets.revenue) * 100
      : 0;
  const groupNetMargin =
    groupBuckets.revenue > 0
      ? (groupBuckets.netProfit / groupBuckets.revenue) * 100
      : 0;

  const isLoading =
    currentBm.isLoading ||
    priorBm.isLoading ||
    groupBm.isLoading ||
    incomeQuery.isLoading ||
    entityBridgeLoading ||
    groupBridgeLoading;

  const hasData =
    currentBuckets.revenue > 0 ||
    currentBuckets.netProfit !== 0 ||
    currentBuckets.clinicianCosts > 0 ||
    currentBuckets.staffCosts > 0 ||
    currentBuckets.labMaterials > 0 ||
    currentBuckets.overhead > 0;

  return {
    isLoading,
    hasData,
    periodRows,
    entityVsGroupRows,
    current: currentBuckets,
    prior: priorBuckets,
    group: groupBuckets,
    entityEbitda,
    groupEbitda,
    contribution: {
      revenueShare: sharePct(currentBuckets.revenue, groupBuckets.revenue),
      profitShare: sharePct(currentBuckets.netProfit, groupBuckets.netProfit),
      ebitdaShare: sharePct(entityEbitda, groupEbitda),
    },
    vsGroup: {
      ebitdaMarginPp: ppDelta(entityEbitdaMargin, groupEbitdaMargin),
      netProfitMarginPp: ppDelta(entityNetMargin, groupNetMargin),
      costEfficiencyPp: ppDelta(groupTotalCostPct, entityTotalCostPct),
    },
    priorLabel,
  };
}
