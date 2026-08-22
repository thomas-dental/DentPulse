import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { PracticeLocation, PracticeLocationInsert, PracticeLocationUpdate, Region, RegionInsert, RegionUpdate } from '@/types/location';
import { toast } from 'sonner';

export function useLocations() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
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

  // Shared org-IDs query — cached so practice_locations and regions
  // don't each make their own duplicate user_roles network call
  const { data: userOrgIds = [] } = useQuery({
    queryKey: ['user_role_org_ids', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('user_roles')
        .select('organization_id')
        .eq('user_id', user.id);
      if (error) throw error;
      return (data?.map(r => r.organization_id).filter(Boolean) || []) as string[];
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000, // org membership rarely changes
  });

  // Fetch all locations across ALL organizations the user has access to
  const {
    data: locations = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['practice_locations', user?.id],
    queryFn: async () => {
      if (!user?.id || userOrgIds.length === 0) return [];

      const { data, error } = await (supabase as any)
        .from('practice_locations')
        .select('*')
        .in('organization_id', userOrgIds)
        .is('deleted_at', null)
        .order('location_name');

      if (error) throw error;
      return data as PracticeLocation[];
    },
    enabled: !!user?.id && userOrgIds.length > 0,
  });

  // Fetch locations assigned to the current user.
  // Checks two sources:
  // 1. practice_locations.user_id (legacy/direct assignment)
  // 2. providers.location_id (assigned via team invite)
  // If a user has provider records with specific locations, they only see those locations.
  const { data: userLocations = [] } = useQuery({
    queryKey: ['user_practice_locations', user?.id, organizationId],
    queryFn: async () => {
      if (!user?.id || !organizationId) return [];

      // Check provider-based location assignments first
      const { data: providerRows } = await (supabase as any)
        .from('providers')
        .select('location_id')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .is('deleted_at', null);

      const providerLocationIds = (providerRows || [])
        .map((p: any) => p.location_id)
        .filter(Boolean) as string[];

      if (providerLocationIds.length > 0) {
        // User has specific provider locations — only show those
        const { data, error } = await (supabase as any)
          .from('practice_locations')
          .select('*')
          .in('id', providerLocationIds)
          .is('deleted_at', null)
          .order('location_name');
        if (error) throw error;
        return data as PracticeLocation[];
      }

      // Fallback: check direct user_id assignment on practice_locations
      const { data, error } = await (supabase as any)
        .from('practice_locations')
        .select('*')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('location_name');

      if (error) throw error;
      return data as PracticeLocation[];
    },
    enabled: !!user?.id && !!organizationId,
  });

  // Fetch regions (only active, non-deleted) — reuses cached userOrgIds
  const { data: regions = [] } = useQuery({
    queryKey: ['regions', user?.id],
    queryFn: async () => {
      if (!user?.id || userOrgIds.length === 0) return [];

      const { data, error } = await supabase
        .from('regions')
        .select('*')
        .in('organization_id', userOrgIds)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');

      if (error) throw error;
      return data as Region[];
    },
    enabled: !!user?.id && userOrgIds.length > 0,
  });

  // Create location
  const createMutation = useMutation({
    mutationFn: async (location: Omit<PracticeLocationInsert, 'organization_id' | 'created_by'>) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      const insertData = {
        ...location,
        organization_id: organizationId,
        created_by: user.id,
      };

      const { data, error } = await (supabase as any)
        .from('practice_locations')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;
      return data as PracticeLocation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice_locations', user?.id] });
      toast.success('Location created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create location: ${error.message}`);
    },
  });

  // Update location
  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: PracticeLocationUpdate }) => {
      if (!user?.id) throw new Error('Not authenticated');

      const updateData = {
        ...updates,
        updated_by: user.id,
      };

      const { data, error } = await (supabase as any)
        .from('practice_locations')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as PracticeLocation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice_locations', user?.id] });
      toast.success('Location updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update location: ${error.message}`);
    },
  });

  // Delete location (soft delete)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      if (!organizationId) throw new Error('No organization selected');

      const { error } = await (supabase as any)
        .from('practice_locations')
        .update({
          deleted_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('id', id)
        .eq('organization_id', organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice_locations', user?.id] });
      toast.success('Location deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete location: ${error.message}`);
    },
  });

  // Get location by ID
  const getLocation = async (id: string): Promise<PracticeLocation | null> => {
    const { data, error } = await (supabase as any)
      .from('practice_locations')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) {
      console.error('Error fetching location:', error);
      return null;
    }
    return data as PracticeLocation;
  };

  // Create region
  const createRegionMutation = useMutation({
    mutationFn: async (region: Omit<RegionInsert, 'organization_id' | 'created_by'>) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('regions')
        .insert({
          ...region,
          organization_id: organizationId,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Region;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regions', user?.id] });
      toast.success('Region created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create region: ${error.message}`);
    },
  });

  // Update region
  const updateRegionMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: RegionUpdate }) => {
      if (!user?.id) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('regions')
        .update({
          ...updates,
          updated_by: user.id,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Region;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regions', user?.id] });
      toast.success('Region updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update region: ${error.message}`);
    },
  });

  // Delete region (soft delete)
  const deleteRegionMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      if (!organizationId) throw new Error('No organization selected');

      // Use stored procedure to handle soft delete with proper security context
      const { error } = await supabase.rpc('soft_delete_region', {
        _region_id: id,
        _organization_id: organizationId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regions', user?.id] });
      toast.success('Region deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete region: ${error.message}`);
    },
  });

  // Combined list: user-assigned locations if available, otherwise org locations.
  // This matches the TopBar dropdown logic so all consumers resolve the same set.
  const allAvailableLocations = userLocations.length > 0 ? userLocations : locations;

  return {
    locations,
    userLocations,
    allAvailableLocations,
    regions,
    isLoading: isOrgLoading || isLoading,
    isOrgLoading,
    error,
    refetch,
    createLocation: createMutation.mutate,
    updateLocation: updateMutation.mutate,
    deleteLocation: deleteMutation.mutate,
    createRegion: createRegionMutation.mutate,
    updateRegion: updateRegionMutation.mutate,
    deleteRegion: deleteRegionMutation.mutate,
    getLocation,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isCreatingRegion: createRegionMutation.isPending,
    isUpdatingRegion: updateRegionMutation.isPending,
    isDeletingRegion: deleteRegionMutation.isPending,
    organizationId,
    hasOrganization: !!organizationId,
  };
}
