import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchValueLeakageSummaryApi } from '@/services/integrations/patientEconomicsService';

export type CommitmentWindowRow = {
  windowDays: number;
  commitmentRate: number;
  totalEligibleValue: number;
  committedValueWithinWindow: number;
  eligibleItemCount: number;
  committedItemCount: number;
  confidence: number;
  tier: string;
  tierNote: string;
};

export type CommitmentClinicianRow = {
  practitionerExtId: string | null;
  providerId: string | null;
  practitionerName: string;
  windowDays: number;
  commitmentRate: number;
  totalEligibleValue: number;
  committedValueWithinWindow: number;
  eligibleItemCount: number;
  committedItemCount: number;
  confidence: number;
  tier: string;
  attributionTier: string;
  tierNote: string;
};

export type OpportunityCategoryRow = {
  category: string;
  gross: number;
  weighted: number;
};

export type ValueLeakageSummary = {
  opportunityGross: number;
  opportunityGrossTier: string;
  opportunityGrossTierNote: string;
  opportunityWeighted: number;
  opportunityWeightedTier: string;
  opportunityWeightedTierNote: string;
  opportunityWeightConfidence: number;
  opportunityByCategory: OpportunityCategoryRow[];
  weightingWindowDays: number;
  commitmentRate30d: number;
  commitmentRate30dTier: string;
  commitmentRate30dConfidence: number;
  commitmentRate30dTierNote: string;
  commitmentRate30dEligibleValue: number;
  commitmentRate30dCommittedValue: number;
  byWindow: CommitmentWindowRow[];
  byClinician: CommitmentClinicianRow[];
  clinicianWindowDays: number;
  hasUnattributedPlanItems: boolean;
  unattributedEligibleValue: number;
  tier: string;
  tierNote: string;
};

export function useValueLeakageSummary() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['value-leakage-summary', organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<ValueLeakageSummary> => {
      const body = await fetchValueLeakageSummaryApi(organizationId!);
      return {
        opportunityGross: Number(body.opportunityGross) || 0,
        opportunityGrossTier: String(body.opportunityGrossTier || 'Derived'),
        opportunityGrossTierNote: String(body.opportunityGrossTierNote || ''),
        opportunityWeighted: Number(body.opportunityWeighted) || 0,
        opportunityWeightedTier: String(body.opportunityWeightedTier || 'Modelled'),
        opportunityWeightedTierNote: String(body.opportunityWeightedTierNote || ''),
        opportunityWeightConfidence: Number(body.opportunityWeightConfidence) || 0,
        opportunityByCategory: (body.opportunityByCategory ?? []).map((r) => ({
          category: String(r.category || 'Other'),
          gross: Number(r.gross) || 0,
          weighted: Number(r.weighted) || 0,
        })),
        weightingWindowDays: Number(body.weightingWindowDays) || 30,
        commitmentRate30d: Number(body.commitmentRate30d) || 0,
        commitmentRate30dTier: String(body.commitmentRate30dTier || 'Derived'),
        commitmentRate30dConfidence: Number(body.commitmentRate30dConfidence) || 0,
        commitmentRate30dTierNote: String(body.commitmentRate30dTierNote || ''),
        commitmentRate30dEligibleValue: Number(body.commitmentRate30dEligibleValue) || 0,
        commitmentRate30dCommittedValue: Number(body.commitmentRate30dCommittedValue) || 0,
        byWindow: (body.byWindow ?? []).map((r) => ({
          windowDays: Number(r.windowDays) || 0,
          commitmentRate: Number(r.commitmentRate) || 0,
          totalEligibleValue: Number(r.totalEligibleValue) || 0,
          committedValueWithinWindow: Number(r.committedValueWithinWindow) || 0,
          eligibleItemCount: Number(r.eligibleItemCount) || 0,
          committedItemCount: Number(r.committedItemCount) || 0,
          confidence: Number(r.confidence) || 0,
          tier: String(r.tier || 'Derived'),
          tierNote: String(r.tierNote || ''),
        })),
        byClinician: (body.byClinician ?? []).map((r) => ({
          practitionerExtId: r.practitionerExtId != null ? String(r.practitionerExtId) : null,
          providerId: r.providerId != null ? String(r.providerId) : null,
          practitionerName: String(r.practitionerName || 'Unknown'),
          windowDays: Number(r.windowDays) || 30,
          commitmentRate: Number(r.commitmentRate) || 0,
          totalEligibleValue: Number(r.totalEligibleValue) || 0,
          committedValueWithinWindow: Number(r.committedValueWithinWindow) || 0,
          eligibleItemCount: Number(r.eligibleItemCount) || 0,
          committedItemCount: Number(r.committedItemCount) || 0,
          confidence: Number(r.confidence) || 0,
          tier: String(r.tier || 'Derived'),
          attributionTier: String(r.attributionTier || 'derived'),
          tierNote: String(r.tierNote || ''),
        })),
        clinicianWindowDays: Number(body.clinicianWindowDays) || 30,
        hasUnattributedPlanItems: Boolean(body.hasUnattributedPlanItems),
        unattributedEligibleValue: Number(body.unattributedEligibleValue) || 0,
        tier: String(body.tier || 'Derived'),
        tierNote: String(body.tierNote || ''),
      };
    },
    staleTime: 60 * 1000,
  });
}
