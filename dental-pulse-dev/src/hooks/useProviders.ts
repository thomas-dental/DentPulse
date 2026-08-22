import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { Provider, ProviderInsert, ProviderUpdate, ProviderType } from '@/types/provider';
import { providerMatchesSelectedLocation } from '@/lib/providerRosterFilters';
import { useProviderTypes } from './useProviderTypes';
import { toast } from 'sonner';

export type UseProvidersOptions = {
  /** When true, include providers with is_active = false. Default: active only. */
  includeInactive?: boolean;
};

export function useProviders(
  providerType?: ProviderType,
  locationId?: string | null,
  options?: UseProvidersOptions,
) {
  const includeInactive = options?.includeInactive === true;
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const { activeProviderTypes } = useProviderTypes();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [isOrgLoading, setIsOrgLoading] = useState(true);

  // Get organization ID from profile or user_roles
  useEffect(() => {
    const getOrganizationId = async () => {
      setIsOrgLoading(true);

      // First try from profile
      if (profile?.current_organization_id) {
        setOrganizationId(profile.current_organization_id);
        setIsOrgLoading(false);
        return;
      }

      // Fallback: get from user_roles
      if (user?.id) {
        const { data } = await supabase
          .from('user_roles')
          .select('organization_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (data?.organization_id) {
          setOrganizationId(data.organization_id);
        }
      }
      setIsOrgLoading(false);
    };

    if (user?.id) {
      getOrganizationId();
    } else {
      setIsOrgLoading(false);
    }
  }, [user?.id, profile?.current_organization_id]);

  // Fetch all providers (we filter by location on the client side for flexibility)
  const {
    data: allProviders = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      'providers',
      organizationId,
      providerType,
      includeInactive ? 'with-inactive' : 'active-only',
    ],
    queryFn: async () => {
      if (!organizationId) return [];

      let query = (supabase as any)
        .from('providers')
        .select(`
          *,
          provider_types:provider_type_id(id, name, code),
          specialties:specialty_id(id, name, code)
        `)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('name');

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      // Filter by provider_type_id if providerType code is provided
      if (providerType && activeProviderTypes.length > 0) {
        const providerTypeEntity = activeProviderTypes.find(pt => pt.code === providerType);
        if (providerTypeEntity) {
          query = query.eq('provider_type_id', providerTypeEntity.id);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as Provider[];
    },
    enabled: !!organizationId,
  });

  // Filter providers by location on client side and remove duplicates
  // If locationId is provided, filter providers that match that location
  // If no providers match the location, return all providers as fallback
  const providers = useMemo(() => {
    let filteredProviders = allProviders;

    // Filter by location if provided. Unassigned home clinics stay in the
    // pool — a null location_id must not hide someone from every site list.
    if (locationId && locationId !== 'all') {
      const locationFilteredProviders = allProviders.filter((p) =>
        providerMatchesSelectedLocation(p, locationId),
      );
      // If no providers match the location, use all providers as fallback
      filteredProviders = locationFilteredProviders.length > 0 ? locationFilteredProviders : allProviders;
    }

    // Same person often has one row per practice (shared email). Pick the best
    // row — never the arbitrary first in name-order (that hid active Aby
    // Costello at Old Surgery behind an inactive Queens Street duplicate).
    const matchesLocation = (p: Provider) =>
      !!locationId &&
      locationId !== 'all' &&
      (p.location_id === locationId || p.practice_id === locationId);

    const score = (p: Provider) =>
      (p.is_active ? 2 : 0) + (matchesLocation(p) ? 1 : 0);

    const pickBetter = (a: Provider, b: Provider) =>
      score(b) > score(a) ? b : a;

    const bestByKey = new Map<string, Provider>();
    for (const provider of filteredProviders) {
      const key = provider.email
        ? `email:${provider.email.toLowerCase()}`
        : `name:${(provider.name ?? '').toLowerCase()}`;
      const existing = bestByKey.get(key);
      bestByKey.set(key, existing ? pickBetter(existing, provider) : provider);
    }

    return Array.from(bestByKey.values());
  }, [allProviders, locationId]);

  // Create provider
  const createMutation = useMutation({
    mutationFn: async (provider: Omit<ProviderInsert, 'organization_id'>) => {
      if (!organizationId) throw new Error('No organization selected');

      const { data, error } = await (supabase as any)
        .from('providers')
        .insert({
          ...provider,
          organization_id: organizationId,
        })
        .select(`
          *,
          provider_types:provider_type_id(id, name, code),
          specialties:specialty_id(id, name, code)
        `)
        .single();

      if (error) throw error;
      return data as Provider;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers', organizationId] });
      toast.success('Provider created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create provider: ${error.message}`);
    },
  });

  // Update provider
  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ProviderUpdate }) => {
      const { data, error } = await (supabase as any)
        .from('providers')
        .update(updates)
        .eq('id', id)
        .select(`
          *,
          provider_types:provider_type_id(id, name, code),
          specialties:specialty_id(id, name, code)
        `)
        .single();

      if (error) throw error;
      return data as Provider;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['providers', organizationId] });
      // ProviderDetail loads its own copy via the singular ['provider', id] key,
      // which the list invalidation above never touches — without this, edited
      // fields (e.g. Lab Split Percentage) appear to "not save" once the page
      // is left and revisited, since refetchOnMount is disabled globally.
      queryClient.invalidateQueries({ queryKey: ['provider', variables.id] });
      toast.success('Provider updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update provider: ${error.message}`);
    },
  });

  // Delete provider
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('providers')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers', organizationId] });
      toast.success('Provider deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete provider: ${error.message}`);
    },
  });

  // Get provider by ID
  const getProvider = async (id: string): Promise<Provider | null> => {
    const { data, error } = await (supabase as any)
      .from('providers')
      .select(`
        *,
        provider_types:provider_type_id(id, name, code),
        specialties:specialty_id(id, name, code)
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching provider:', error);
      return null;
    }
    return data as Provider;
  };

  // Group providers by type dynamically using provider_type_id
  const providersByType = activeProviderTypes.reduce((acc, type) => {
    acc[type.code] = providers.filter(p => p.provider_type_id === type.id);
    return acc;
  }, {} as Record<string, Provider[]>);

  // For backward compatibility, keep these but make them dynamic
  // They will be empty if the types don't exist
  const associates = providersByType['associate'] || [];
  const therapists = providersByType['therapist'] || [];
  const hygienists = providersByType['hygienist'] || [];

  return {
    providers,
    providersByType, // New: dynamic grouping by provider type code
    associates, // Backward compatibility
    therapists, // Backward compatibility
    hygienists, // Backward compatibility
    isLoading: isOrgLoading || isLoading,
    isOrgLoading,
    error,
    refetch,
    createProvider: createMutation.mutate,
    updateProvider: updateMutation.mutate,
    deleteProvider: deleteMutation.mutate,
    getProvider,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    organizationId,
    hasOrganization: !!organizationId,
  };
}
