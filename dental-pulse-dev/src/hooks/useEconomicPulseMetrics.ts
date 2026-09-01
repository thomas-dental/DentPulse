import { useMemo } from 'react';
import { useValueLeakageSummary } from '@/hooks/useValueLeakageSummary';
import { useRetentionContributionAtRisk } from '@/hooks/useRetentionContributionAtRisk';
import { useRetentionRecoveryLoop } from '@/hooks/useRetentionRecoveryLoop';
import { useGrowthLeversSummary } from '@/hooks/useGrowthLeversSummary';
import { usePlannedUnscheduledLeakage } from '@/hooks/usePlannedUnscheduledLeakage';
import { useGoalSettings } from '@/hooks/useGoalSettings';
import { useTreatmentEconomicJourney } from '@/hooks/useTreatmentEconomicJourney';
import { useEconomicAssumptions } from '@/hooks/useEconomicAssumptions';
import { computePatientEconomicValueGbp } from '@/lib/peGrowthLeversDisplay';
import type { PeGoalPracticeRow } from '@/types/peGoalSettings';

export type EconomicPulseMetrics = {
  opportunityWeighted: number;
  opportunityGross: number;
  opportunityWeightedTier: string;
  atRiskContributionGbp: number;
  retentionTier: string;
  commitmentRate30d: number;
  commitmentRate30dTier: string;
  avgAnnualContribution: number | null;
  projectedLtv: number | null;
  projectedLtvTier: string;
  highValueCount: number;
  highValueThresholdGbp: number;
  retentionOpenAtRiskGbp: number;
  plannedContributionGbp: number | null;
  plannedTotalValueGbp: number;
  plannedItemCount: number;
  billingContributionGbp: number | null;
  billingRevenueGapGbp: number;
  billingItemCount: number;
  billingPending: boolean;
  totalIdentifiedGbp: number;
};

function avgContributionPerActive(practices: PeGoalPracticeRow[]): number | null {
  const vals = practices
    .map((p) => p.actuals.contributionPerActiveGbp)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function avgAnnualFromGrowth(
  growth: {
    activePatientCount: number;
    totalRevenuePrivatePlan: number;
    trailingMonths: number;
  } | null | undefined,
): number | null {
  if (!growth || growth.activePatientCount <= 0) return null;
  const months = growth.trailingMonths > 0 ? growth.trailingMonths : 12;
  const annualized = (growth.totalRevenuePrivatePlan / months) * 12;
  return Math.round(annualized / growth.activePatientCount);
}

export function useEconomicPulseMetrics() {
  const leakageQuery = useValueLeakageSummary();
  const retentionQuery = useRetentionContributionAtRisk();
  const recoveryQuery = useRetentionRecoveryLoop();
  const growthQuery = useGrowthLeversSummary();
  const plannedQuery = usePlannedUnscheduledLeakage();
  const goalsQuery = useGoalSettings();
  const journeyQuery = useTreatmentEconomicJourney();
  const assumptionsQuery = useEconomicAssumptions();

  const heroMetrics = useMemo((): EconomicPulseMetrics | null => {
    if (!leakageQuery.data || !retentionQuery.data) return null;

    const growth = growthQuery.data;
    const projectedLtv =
      growth != null
        ? computePatientEconomicValueGbp(
            growth.visitFrequency,
            growth.valuePerVisit,
            growth.projectedLifetimeYears,
            growth.tenureYears,
          )
        : null;

    const avgFromGoals =
      goalsQuery.data?.practices.length > 0
        ? avgContributionPerActive(goalsQuery.data.practices)
        : goalsQuery.data?.contextMetrics?.contributionPerActive.actual ?? null;

    const avgAnnualContribution =
      avgFromGoals ?? avgAnnualFromGrowth(growth);

    return {
      opportunityWeighted: leakageQuery.data.opportunityWeighted,
      opportunityGross: leakageQuery.data.opportunityGross,
      opportunityWeightedTier: leakageQuery.data.opportunityWeightedTier,
      atRiskContributionGbp: retentionQuery.data.group.atRiskContributionGbp,
      retentionTier: retentionQuery.data.group.tier,
      commitmentRate30d: leakageQuery.data.commitmentRate30d,
      commitmentRate30dTier: leakageQuery.data.commitmentRate30dTier,
      avgAnnualContribution,
      projectedLtv,
      projectedLtvTier: growth?.projectedLifetimeTier ?? 'Modelled',
      highValueCount: 0,
      highValueThresholdGbp:
        assumptionsQuery.data?.assumptions?.reactivationHighValueAtRiskGbp ?? 500,
      retentionOpenAtRiskGbp: 0,
      plannedContributionGbp: null,
      plannedTotalValueGbp: 0,
      plannedItemCount: 0,
      billingContributionGbp: null,
      billingRevenueGapGbp: 0,
      billingItemCount: 0,
      billingPending: true,
      totalIdentifiedGbp: leakageQuery.data.opportunityWeighted,
    };
  }, [
    leakageQuery.data,
    retentionQuery.data,
    growthQuery.data,
    goalsQuery.data,
    assumptionsQuery.data,
  ]);

  const metrics = useMemo((): EconomicPulseMetrics | null => {
    if (!heroMetrics) return null;

    const highValueThresholdGbp =
      assumptionsQuery.data?.assumptions?.reactivationHighValueAtRiskGbp ??
      recoveryQuery.data?.group.minContributionThresholdGbp ??
      500;

    const openWorklist = recoveryQuery.data?.group.openWorklist ?? [];
    const highValueOpen = openWorklist.filter(
      (w) => w.histContributionYr >= highValueThresholdGbp,
    );

    const journeyStages = journeyQuery.data?.stages ?? [];
    const completed = journeyStages.find((s) => s.key === 'completed');
    const charged = journeyStages.find((s) => s.key === 'charged');
    const billingRevenueGapGbp = Math.max(
      0,
      (completed?.valueGbp ?? 0) - (charged?.valueGbp ?? 0),
    );
    const billingItemCount = Math.max(
      0,
      (completed?.eventCount ?? 0) - (charged?.eventCount ?? 0),
    );
    const marginPct = plannedQuery.data?.marginPct;
    const billingPending =
      journeyQuery.isLoading || (billingRevenueGapGbp > 0 && marginPct == null);
    const billingContributionGbp =
      !billingPending && billingRevenueGapGbp > 0 && marginPct != null
        ? Math.round(billingRevenueGapGbp * marginPct / 100)
        : billingRevenueGapGbp <= 0
          ? 0
          : null;

    const opportunityWeighted = heroMetrics.opportunityWeighted;
    const retentionOpenAtRiskGbp = recoveryQuery.data?.group.openValueGbp ?? 0;
    const billingPart = billingContributionGbp ?? 0;

    return {
      ...heroMetrics,
      highValueCount: highValueOpen.length,
      highValueThresholdGbp,
      retentionOpenAtRiskGbp,
      plannedContributionGbp: plannedQuery.data?.contributionOpportunity ?? null,
      plannedTotalValueGbp: plannedQuery.data?.totalValueAtRisk ?? 0,
      plannedItemCount: plannedQuery.data?.itemCount ?? 0,
      billingContributionGbp,
      billingRevenueGapGbp,
      billingItemCount,
      billingPending,
      totalIdentifiedGbp: opportunityWeighted + retentionOpenAtRiskGbp + billingPart,
    };
  }, [
    heroMetrics,
    recoveryQuery.data,
    plannedQuery.data,
    journeyQuery.data,
    journeyQuery.isLoading,
    assumptionsQuery.data,
  ]);

  const heroMetricsLoading =
    leakageQuery.isLoading ||
    retentionQuery.isLoading ||
    growthQuery.isLoading;

  const extendedMetricsLoading =
    recoveryQuery.isLoading ||
    plannedQuery.isLoading ||
    goalsQuery.isLoading ||
    journeyQuery.isLoading;

  const isLoading = heroMetricsLoading || extendedMetricsLoading;

  const isError =
    leakageQuery.isError ||
    retentionQuery.isError ||
    recoveryQuery.isError;

  return {
    metrics,
    heroMetrics,
    isLoading,
    heroMetricsLoading,
    extendedMetricsLoading,
    isError,
    queries: {
      leakageQuery,
      retentionQuery,
      recoveryQuery,
      growthQuery,
      plannedQuery,
      goalsQuery,
      journeyQuery,
    },
  };
}
