import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchConversionProbabilitiesApi } from '@/services/integrations/patientEconomicsService';

export function useConversionProbabilities() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['pe-conversion-probabilities', organizationId],
    queryFn: () => fetchConversionProbabilitiesApi(organizationId!),
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}
