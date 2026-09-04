import { useQuery } from '@tanstack/react-query';
import { fetchEconomicPulseHeroApi } from '@/services/integrations/patientEconomicsService';
import {
  mapInvoiceContributionSummary,
  type InvoiceContributionSummary,
} from '@/hooks/usePatientContributionSummary';
import { PE_READ_STALE_MS } from '@/lib/peReadStaleTime';
import { usePeScopedRead } from '@/hooks/usePeScopedRead';

/** Slim hero: Existing Patient Value + revenue mix only. */
export type EconomicPulseHeroData = {
  invoiceSummary: InvoiceContributionSummary;
};

export function useEconomicPulseHero() {
  const { organizationId, scopeKey, apiScope, enabled } = usePeScopedRead();

  return useQuery({
    queryKey: ['economic-pulse-hero', organizationId, scopeKey],
    enabled,
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<EconomicPulseHeroData> => {
      const body = await fetchEconomicPulseHeroApi(organizationId!, apiScope);
      return {
        invoiceSummary: mapInvoiceContributionSummary(body.invoiceSummary),
      };
    },
  });
}
