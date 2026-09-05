import { useMemo } from 'react';
import { useGrowthLeversSummary } from '@/hooks/useGrowthLeversSummary';
import { estimateTrailingContribution } from '@/lib/peGrowthLeversSimulator';

export type GrowthLeversSimulatorBaseline = {
  visitFrequency: number | null;
  valuePerVisit: number | null;
  projectedLifetimeYears: number | null;
  tenureYears: number | null;
  trailingRevenuePrivatePlan: number;
  trailingContribution: number | null;
  trailingMonths: number;
  activePatientCount: number;
  marginPct: number | null;
};

export function useGrowthLeversSimulatorBaseline() {
  const leversQuery = useGrowthLeversSummary();

  const baseline = useMemo((): GrowthLeversSimulatorBaseline | null => {
    if (!leversQuery.data) return null;

    const marginPct =
      leversQuery.data.marginPct == null ? null : Number(leversQuery.data.marginPct);
    const trailingRevenue = leversQuery.data.totalRevenuePrivatePlan;
    const trailingContributionDirect = leversQuery.data.totalContribution;

    return {
      visitFrequency: leversQuery.data.visitFrequency,
      valuePerVisit: leversQuery.data.valuePerVisit,
      projectedLifetimeYears: leversQuery.data.projectedLifetimeYears,
      tenureYears: leversQuery.data.tenureYears,
      trailingRevenuePrivatePlan: trailingRevenue,
      trailingContribution:
        trailingContributionDirect > 0
          ? trailingContributionDirect
          : estimateTrailingContribution(trailingRevenue, marginPct),
      trailingMonths: leversQuery.data.trailingMonths,
      activePatientCount: leversQuery.data.activePatientCount,
      marginPct: Number.isFinite(marginPct) ? marginPct : null,
    };
  }, [leversQuery.data]);

  const isLoading = leversQuery.isLoading;
  const isError = leversQuery.isError;
  const error = leversQuery.error;

  const hasBaseline =
    baseline != null &&
    (baseline.trailingContribution != null || baseline.trailingRevenuePrivatePlan > 0);

  return {
    baseline,
    hasBaseline,
    isLoading,
    isError,
    error,
    refetch: () => leversQuery.refetch(),
    isFetching: leversQuery.isFetching,
  };
}
