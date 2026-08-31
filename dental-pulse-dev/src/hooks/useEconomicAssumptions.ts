import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchEconomicAssumptionsApi } from '@/services/integrations/patientEconomicsService';

export function useEconomicAssumptions() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['pe-economic-assumptions', organizationId],
    queryFn: () => fetchEconomicAssumptionsApi(organizationId!),
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}
