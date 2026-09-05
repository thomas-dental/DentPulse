import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAllPractitionerPrivateShareRates,
} from '@/services/integrations/patientEconomicsService';
import type { PractitionerWithRates } from '@/types/patientEconomicsAssumptions';

export const PE_PRACTITIONER_RATES_MAP_KEY = 'pe-practitioner-rates-map';
export const PE_PRACTITIONER_RATE_KEY = 'pe-practitioner-rate';

function emptyPractitionerRatesRow(practitionerId: string): PractitionerWithRates {
  return {
    id: practitionerId,
    name: '',
    providerRole: null,
    isActive: true,
    rateConfigured: false,
    currentRate: null,
    currentEffectiveFrom: null,
    history: [],
  };
}

export function usePractitionerPrivateShareRatesMap(organizationId?: string | null) {
  return useQuery({
    queryKey: [PE_PRACTITIONER_RATES_MAP_KEY, organizationId],
    queryFn: async (): Promise<Map<string, PractitionerWithRates>> => {
      const all = await fetchAllPractitionerPrivateShareRates(organizationId!);
      const map = new Map<string, PractitionerWithRates>();
      for (const row of all) {
        map.set(row.id, row);
      }
      return map;
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });
}

export function usePractitionerPrivateShareRate(
  organizationId?: string | null,
  practitionerId?: string | null,
) {
  return useQuery({
    queryKey: [PE_PRACTITIONER_RATE_KEY, organizationId, practitionerId],
    queryFn: async (): Promise<PractitionerWithRates> => {
      if (!organizationId || !practitionerId) {
        return emptyPractitionerRatesRow(practitionerId || '');
      }
      const all = await fetchAllPractitionerPrivateShareRates(organizationId);
      return all.find((p) => p.id === practitionerId) ?? emptyPractitionerRatesRow(practitionerId);
    },
    enabled: !!organizationId && !!practitionerId,
    staleTime: 30 * 1000,
  });
}

export function useInvalidatePractitionerPrivateShareRates() {
  const queryClient = useQueryClient();
  return (organizationId?: string | null, practitionerId?: string | null) => {
    if (organizationId) {
      queryClient.invalidateQueries({ queryKey: [PE_PRACTITIONER_RATES_MAP_KEY, organizationId] });
    }
    if (organizationId && practitionerId) {
      queryClient.invalidateQueries({
        queryKey: [PE_PRACTITIONER_RATE_KEY, organizationId, practitionerId],
      });
    }
  };
}
