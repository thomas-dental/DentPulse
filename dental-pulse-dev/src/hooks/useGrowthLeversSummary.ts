import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchGrowthLeversSummaryApi } from '@/services/integrations/patientEconomicsService';
import { PE_READ_STALE_MS } from '@/lib/peReadStaleTime';

export type GrowthLeversMonthlyRow = {
  month: string;
  completedVisits: number;
  revenuePrivatePlan: number;
  valuePerVisit: number | null;
};

export type GrowthLeversSummary = {
  trailingMonths: number;
  sinceDate: string;
  visitFrequency: number | null;
  visitFrequencyTier: string;
  visitFrequencyTierNote: string;
  valuePerVisit: number | null;
  valuePerVisitTier: string;
  valuePerVisitTierNote: string;
  totalCompletedVisits: number;
  totalRevenuePrivatePlan: number;
  activePatientCount: number;
  monthly: GrowthLeversMonthlyRow[];
  hasAppointmentData: boolean;
  hasRevenueData: boolean;
  hasActivePatients: boolean;
  tenureYears: number | null;
  tenureTier: string;
  tenureTierNote: string;
  tenurePatientCount: number;
  projectedLifetimeYears: number | null;
  projectedLifetimeTier: string;
  projectedLifetimeTierNote: string;
  projectedLifetimePatientCount: number;
  hasTenureData: boolean;
  hasProjectedLifetimeData: boolean;
  tier: string;
  tierNote: string;
};

export function useGrowthLeversSummary() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['growth-levers-summary', organizationId],
    enabled: !!organizationId,
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<GrowthLeversSummary> => {
      const body = await fetchGrowthLeversSummaryApi(organizationId!);
      return {
        trailingMonths: Number(body.trailingMonths) || 12,
        sinceDate: String(body.sinceDate || ''),
        visitFrequency:
          body.visitFrequency == null ? null : Number(body.visitFrequency),
        visitFrequencyTier: String(body.visitFrequencyTier || 'Derived'),
        visitFrequencyTierNote: String(body.visitFrequencyTierNote || ''),
        valuePerVisit: body.valuePerVisit == null ? null : Number(body.valuePerVisit),
        valuePerVisitTier: String(body.valuePerVisitTier || 'Derived'),
        valuePerVisitTierNote: String(body.valuePerVisitTierNote || ''),
        totalCompletedVisits: Number(body.totalCompletedVisits) || 0,
        totalRevenuePrivatePlan: Number(body.totalRevenuePrivatePlan) || 0,
        activePatientCount: Number(body.activePatientCount) || 0,
        monthly: (body.monthly ?? []).map((r) => ({
          month: String(r.month || ''),
          completedVisits: Number(r.completedVisits) || 0,
          revenuePrivatePlan: Number(r.revenuePrivatePlan) || 0,
          valuePerVisit: r.valuePerVisit == null ? null : Number(r.valuePerVisit),
        })),
        hasAppointmentData: Boolean(body.hasAppointmentData),
        hasRevenueData: Boolean(body.hasRevenueData),
        hasActivePatients: Boolean(body.hasActivePatients),
        tenureYears: body.tenureYears == null ? null : Number(body.tenureYears),
        tenureTier: String(body.tenureTier || 'Derived'),
        tenureTierNote: String(body.tenureTierNote || ''),
        tenurePatientCount: Number(body.tenurePatientCount) || 0,
        projectedLifetimeYears:
          body.projectedLifetimeYears == null ? null : Number(body.projectedLifetimeYears),
        projectedLifetimeTier: String(body.projectedLifetimeTier || 'Modelled'),
        projectedLifetimeTierNote: String(body.projectedLifetimeTierNote || ''),
        projectedLifetimePatientCount: Number(body.projectedLifetimePatientCount) || 0,
        hasTenureData: Boolean(body.hasTenureData),
        hasProjectedLifetimeData: Boolean(body.hasProjectedLifetimeData),
        tier: String(body.tier || 'Derived'),
        tierNote: String(body.tierNote || ''),
      };
    },
  });
}
