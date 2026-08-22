import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { ProviderTypeEntity, ProviderTypeInsert, ProviderTypeUpdate } from '@/types/provider';
import { toast } from 'sonner';

export function useProviderTypes() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  // Fetch all provider types for the organization
  const { data: providerTypes = [], isLoading } = useQuery({
    queryKey: ['providerTypes', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('provider_types')
        .select('*')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      return (data || []) as ProviderTypeEntity[];
    },
    enabled: !!organizationId,
  });

  // Get active provider types only
  const activeProviderTypes = providerTypes.filter(pt => pt.is_active);

  // Create provider type
  const createProviderTypeMutation = useMutation({
    mutationFn: async (providerType: Omit<ProviderTypeInsert, 'organization_id' | 'created_by'>) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('provider_types')
        .insert({
          ...providerType,
          organization_id: organizationId,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as ProviderTypeEntity;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerTypes', organizationId] });
      toast.success('Provider type created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create provider type: ${error.message}`);
    },
  });

  // Update provider type
  const updateProviderTypeMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ProviderTypeUpdate }) => {
      if (!user?.id) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('provider_types')
        .update({
          ...updates,
          updated_by: user.id,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as ProviderTypeEntity;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerTypes', organizationId] });
      toast.success('Provider type updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update provider type: ${error.message}`);
    },
  });

  // Delete provider type (soft delete)
  const deleteProviderTypeMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('provider_types')
        .update({
          deleted_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerTypes', organizationId] });
      toast.success('Provider type deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete provider type: ${error.message}`);
    },
  });

  // Get single provider type
  const getProviderType = async (id: string): Promise<ProviderTypeEntity | null> => {
    const { data, error } = await supabase
      .from('provider_types')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    return data as ProviderTypeEntity | null;
  };

  return {
    providerTypes,
    activeProviderTypes,
    isLoading,
    createProviderType: createProviderTypeMutation.mutate,
    updateProviderType: updateProviderTypeMutation.mutate,
    deleteProviderType: deleteProviderTypeMutation.mutate,
    getProviderType,
    isCreating: createProviderTypeMutation.isPending,
    isUpdating: updateProviderTypeMutation.isPending,
    isDeleting: deleteProviderTypeMutation.isPending,
  };
}
