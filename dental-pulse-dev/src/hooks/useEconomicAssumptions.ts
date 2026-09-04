import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchEconomicAssumptionsApi } from '@/services/integrations/patientEconomicsService';

export function useEconomicAssumptions(options?: { enabled?: boolean }) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['pe-economic-assumptions', organizationId],
    queryFn: () => fetchEconomicAssumptionsApi(organizationId!),
    enabled: !!organizationId && (options?.enabled ?? true),
    staleTime: 60_000,
  });
}
