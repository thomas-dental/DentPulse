import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchPlannedUnscheduledLeakageApi } from '@/services/integrations/patientEconomicsService';

export type PlannedUnscheduledLeakageRow = {
  planId: string;
  tpiId: string | null;
  patientId: string;
  patientName: string;
  treatmentValue: number;
  daysUnscheduled: number;
  planCreatedAt: string;
};

export type PlannedUnscheduledLeakageResult = {
  thresholdDays: number;
  tier: string;
  tierNote: string;
  itemCount: number;
  totalValueAtRisk: number;
  marginPct: number | null;
  contributionOpportunity: number | null;
  rows: PlannedUnscheduledLeakageRow[];
};

export function usePlannedUnscheduledLeakage() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['planned-unscheduled-leakage', organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<PlannedUnscheduledLeakageResult> => {
      const body = await fetchPlannedUnscheduledLeakageApi(organizationId!);
      return {
        thresholdDays: Number(body.thresholdDays) || 60,
        tier: String(body.tier || 'Derived'),
        tierNote: String(body.tierNote || ''),
        itemCount: Number(body.itemCount) || 0,
        totalValueAtRisk: Number(body.totalValueAtRisk) || 0,
        marginPct: body.marginPct != null ? Number(body.marginPct) : null,
        contributionOpportunity:
          body.contributionOpportunity != null ? Number(body.contributionOpportunity) : null,
        rows: (body.rows ?? []).map((r) => ({
          planId: String(r.planId),
          tpiId: r.tpiId != null ? String(r.tpiId) : null,
          patientId: String(r.patientId),
          patientName: String(r.patientName || 'Unknown patient'),
          treatmentValue: Number(r.treatmentValue) || 0,
          daysUnscheduled: Number(r.daysUnscheduled) || 0,
          planCreatedAt: String(r.planCreatedAt),
        })),
      };
    },
    staleTime: 60 * 1000,
  });
}
