import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import {
  getXeroBankOverviewCards,
  type XeroBankOverviewCard,
  type XeroBankOverviewResult,
} from '@/services/xeroBankOverviewService';

export type { XeroBankOverviewCard };

export function useXeroBankOverview(
  enabled: boolean,
  locationId?: string | null,
) {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: ['xero-bank-overview-synced', organizationId, locationId ?? 'all'],
    queryFn: async (): Promise<XeroBankOverviewResult> => {
      if (!organizationId) return { cards: [] };
      return getXeroBankOverviewCards(organizationId, locationId);
    },
    enabled: enabled && !!organizationId,
    staleTime: 1000 * 60 * 5,
  });

  return {
    cards: query.data?.cards ?? [],
    isLoading: query.isLoading,
    message: query.data?.message || (query.error instanceof Error ? query.error.message : null),
    error: query.error,
    refetch: query.refetch,
  };
}
