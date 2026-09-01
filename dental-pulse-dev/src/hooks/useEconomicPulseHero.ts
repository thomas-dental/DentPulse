import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchEconomicPulseHeroApi } from '@/services/integrations/patientEconomicsService';
import {
  mapInvoiceContributionSummary,
  type InvoiceContributionSummary,
} from '@/hooks/usePatientContributionSummary';
import type { EconomicPulseMetrics } from '@/hooks/useEconomicPulseMetrics';
import { PE_READ_STALE_MS } from '@/lib/peReadStaleTime';

export type EconomicPulseHeroData = {
  invoiceSummary: InvoiceContributionSummary;
  heroMetrics: Pick<
    EconomicPulseMetrics,
    | 'opportunityWeighted'
    | 'opportunityGross'
    | 'opportunityWeightedTier'
    | 'atRiskContributionGbp'
    | 'retentionTier'
    | 'commitmentRate30d'
    | 'commitmentRate30dTier'
    | 'avgAnnualContribution'
    | 'projectedLtv'
    | 'projectedLtvTier'
  >;
};

export function useEconomicPulseHero() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['economic-pulse-hero', organizationId],
    enabled: !!organizationId,
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<EconomicPulseHeroData> => {
      const body = await fetchEconomicPulseHeroApi(organizationId!);
      return {
        invoiceSummary: mapInvoiceContributionSummary(body.invoiceSummary),
        heroMetrics: {
          opportunityWeighted: Number(body.opportunityWeighted) || 0,
          opportunityGross: Number(body.opportunityGross) || 0,
          opportunityWeightedTier: String(body.opportunityWeightedTier || 'Derived'),
          atRiskContributionGbp: Number(body.atRiskContributionGbp) || 0,
          retentionTier: String(body.retentionTier || 'Derived'),
          commitmentRate30d: Number(body.commitmentRate30d) || 0,
          commitmentRate30dTier: String(body.commitmentRate30dTier || 'Derived'),
          avgAnnualContribution:
            body.avgAnnualContribution == null
              ? null
              : Number(body.avgAnnualContribution),
          projectedLtv:
            body.projectedLtv == null ? null : Number(body.projectedLtv),
          projectedLtvTier: String(body.projectedLtvTier || 'Modelled'),
        },
      };
    },
  });
}
