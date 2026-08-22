import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { Specialty, SpecialtyInsert, SpecialtyUpdate } from '@/types/provider';
import { toast } from 'sonner';

export function useSpecialties(providerTypeId?: string | null) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  // Fetch all specialties for the organization
  const { data: specialties = [], isLoading } = useQuery({
    queryKey: ['specialties', organizationId, providerTypeId],
    queryFn: async () => {
      if (!organizationId) return [];
      
      let query = supabase
        .from('specialties')
        .select('*')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      // Filter by provider type if provided
      if (providerTypeId) {
        query = query.eq('provider_type_id', providerTypeId);
      }

      const { data, error } = await query
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      return (data || []) as Specialty[];
    },
    enabled: !!organizationId,
  });

  // Get active specialties only
  const activeSpecialties = specialties.filter(s => s.is_active);

  // Create specialty
  const createSpecialtyMutation = useMutation({
    mutationFn: async (specialty: Omit<SpecialtyInsert, 'organization_id' | 'created_by'>) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('specialties')
        .insert({
          ...specialty,
          organization_id: organizationId,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Specialty;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialties', organizationId] });
      toast.success('Specialty created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create specialty: ${error.message}`);
    },
  });

  // Update specialty
  const updateSpecialtyMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: SpecialtyUpdate }) => {
      if (!user?.id) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('specialties')
        .update({
          ...updates,
          updated_by: user.id,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Specialty;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialties', organizationId] });
      toast.success('Specialty updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update specialty: ${error.message}`);
    },
  });

  // Delete specialty (soft delete)
  const deleteSpecialtyMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('specialties')
        .update({
          deleted_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialties', organizationId] });
      toast.success('Specialty deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete specialty: ${error.message}`);
    },
  });

  // Get single specialty
  const getSpecialty = async (id: string): Promise<Specialty | null> => {
    const { data, error } = await supabase
      .from('specialties')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    return data as Specialty | null;
  };

  return {
    specialties,
    activeSpecialties,
    isLoading,
    createSpecialty: createSpecialtyMutation.mutate,
    updateSpecialty: updateSpecialtyMutation.mutate,
    deleteSpecialty: deleteSpecialtyMutation.mutate,
    getSpecialty,
    isCreating: createSpecialtyMutation.isPending,
    isUpdating: updateSpecialtyMutation.isPending,
    isDeleting: deleteSpecialtyMutation.isPending,
  };
}
