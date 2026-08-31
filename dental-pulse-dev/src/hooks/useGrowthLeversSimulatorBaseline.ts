import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
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
  const { organizationId } = useOrganization();
  const leversQuery = useGrowthLeversSummary();

  const marginQuery = useQuery({
    queryKey: ['v_practice_contribution', organizationId, 'simulator-margin'],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_practice_contribution')
        .select('margin_pct')
        .eq('practice_id', organizationId!)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  const baseline = useMemo((): GrowthLeversSimulatorBaseline | null => {
    if (!leversQuery.data) return null;

    const marginPct =
      marginQuery.data?.margin_pct == null ? null : Number(marginQuery.data.margin_pct);
    const trailingRevenue = leversQuery.data.totalRevenuePrivatePlan;

    return {
      visitFrequency: leversQuery.data.visitFrequency,
      valuePerVisit: leversQuery.data.valuePerVisit,
      projectedLifetimeYears: leversQuery.data.projectedLifetimeYears,
      tenureYears: leversQuery.data.tenureYears,
      trailingRevenuePrivatePlan: trailingRevenue,
      trailingContribution: estimateTrailingContribution(trailingRevenue, marginPct),
      trailingMonths: leversQuery.data.trailingMonths,
      activePatientCount: leversQuery.data.activePatientCount,
      marginPct: Number.isFinite(marginPct) ? marginPct : null,
    };
  }, [leversQuery.data, marginQuery.data]);

  const isLoading = leversQuery.isLoading || marginQuery.isLoading;
  const isError = leversQuery.isError || marginQuery.isError;
  const error = leversQuery.error ?? marginQuery.error;

  const hasBaseline =
    baseline != null &&
    (baseline.trailingContribution != null || baseline.trailingRevenuePrivatePlan > 0);

  return {
    baseline,
    hasBaseline,
    isLoading,
    isError,
    error,
    refetch: () => {
      leversQuery.refetch();
      marginQuery.refetch();
    },
    isFetching: leversQuery.isFetching || marginQuery.isFetching,
  };
}
