import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchGrowthLeversByPracticeApi } from '@/services/integrations/patientEconomicsService';

export type GrowthLeversPracticeRow = {
  practiceId: string;
  practiceName: string;
  visitFrequency: number | null;
  valuePerVisit: number | null;
  tenureYears: number | null;
  projectedLifetimeYears: number | null;
  trailingMonths: number | null;
  benchmarks: {
    visitFrequency: number | null;
    valuePerVisit: number | null;
    tenureYears: number | null;
    projectedLifetimeYears: number | null;
  };
  visitFrequencyHeadroom: number | null;
  valuePerVisitHeadroom: number | null;
  tenureHeadroom: number | null;
  projectedLifetimeHeadroom: number | null;
  combinedHeadroomPct: number | null;
  topLeverToPull: string | null;
};

export type GrowthLeversByPractice = {
  benchmarkMethod: string;
  benchmarkMethodNote: string;
  groupBenchmarks: {
    visitFrequency: number | null;
    valuePerVisit: number | null;
    tenureYears: number | null;
    projectedLifetimeYears: number | null;
  };
  practices: GrowthLeversPracticeRow[];
  hasData: boolean;
  rollupMode?: 'location' | 'practice';
};

export function useGrowthLeversByPractice() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['growth-levers-by-practice', organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<GrowthLeversByPractice> => {
      const body = await fetchGrowthLeversByPracticeApi(organizationId!);
      return {
        benchmarkMethod: String(body.benchmarkMethod || 'group_top'),
        benchmarkMethodNote: String(body.benchmarkMethodNote || ''),
        groupBenchmarks: {
          visitFrequency:
            body.groupBenchmarks?.visitFrequency == null
              ? null
              : Number(body.groupBenchmarks.visitFrequency),
          valuePerVisit:
            body.groupBenchmarks?.valuePerVisit == null
              ? null
              : Number(body.groupBenchmarks.valuePerVisit),
          tenureYears:
            body.groupBenchmarks?.tenureYears == null
              ? null
              : Number(body.groupBenchmarks.tenureYears),
          projectedLifetimeYears:
            body.groupBenchmarks?.projectedLifetimeYears == null
              ? null
              : Number(body.groupBenchmarks.projectedLifetimeYears),
        },
        practices: (body.practices ?? []).map((r) => ({
          practiceId: String(r.practiceId),
          practiceName: String(r.practiceName || 'Practice'),
          visitFrequency: r.visitFrequency == null ? null : Number(r.visitFrequency),
          valuePerVisit: r.valuePerVisit == null ? null : Number(r.valuePerVisit),
          tenureYears: r.tenureYears == null ? null : Number(r.tenureYears),
          projectedLifetimeYears:
            r.projectedLifetimeYears == null ? null : Number(r.projectedLifetimeYears),
          trailingMonths: r.trailingMonths == null ? null : Number(r.trailingMonths),
          benchmarks: {
            visitFrequency:
              r.benchmarks?.visitFrequency == null ? null : Number(r.benchmarks.visitFrequency),
            valuePerVisit:
              r.benchmarks?.valuePerVisit == null ? null : Number(r.benchmarks.valuePerVisit),
            tenureYears:
              r.benchmarks?.tenureYears == null ? null : Number(r.benchmarks.tenureYears),
            projectedLifetimeYears:
              r.benchmarks?.projectedLifetimeYears == null
                ? null
                : Number(r.benchmarks.projectedLifetimeYears),
          },
          visitFrequencyHeadroom:
            r.visitFrequencyHeadroom == null ? null : Number(r.visitFrequencyHeadroom),
          valuePerVisitHeadroom:
            r.valuePerVisitHeadroom == null ? null : Number(r.valuePerVisitHeadroom),
          tenureHeadroom: r.tenureHeadroom == null ? null : Number(r.tenureHeadroom),
          projectedLifetimeHeadroom:
            r.projectedLifetimeHeadroom == null ? null : Number(r.projectedLifetimeHeadroom),
          combinedHeadroomPct:
            r.combinedHeadroomPct == null ? null : Number(r.combinedHeadroomPct),
          topLeverToPull: r.topLeverToPull != null ? String(r.topLeverToPull) : null,
        })),
        hasData: Boolean(body.hasData),
        rollupMode: body.rollupMode === 'location' ? 'location' : 'practice',
      };
    },
  });
}
