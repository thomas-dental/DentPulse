import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { TreatmentCategory, TreatmentCategoryInsert, TreatmentCategoryUpdate } from '@/types/treatment-category';
import { toast } from 'sonner';

export function useTreatmentCategories() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  // Fetch all treatment categories for the organization
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['treatment_categories', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await (supabase as any)
        .from('treatment_categories')
        .select('*')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      return (data || []) as TreatmentCategory[];
    },
    enabled: !!organizationId,
  });

  // Create treatment category
  const createCategoryMutation = useMutation({
    mutationFn: async (category: Omit<TreatmentCategoryInsert, 'organization_id' | 'created_by'>) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      const insertData: TreatmentCategoryInsert = {
        ...category,
        organization_id: organizationId,
        created_by: user.id,
        // Ensure location_id and region_id are properly set (null if empty string or null)
        location_id: category.location_id && category.location_id !== '' ? category.location_id : null,
        region_id: category.region_id && category.region_id !== '' ? category.region_id : null,
      };

      const { data, error } = await (supabase as any)
        .from('treatment_categories')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;
      return data as TreatmentCategory;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatment_categories', organizationId] });
      toast.success('Treatment category created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create treatment category: ${error.message}`);
    },
  });

  // Update treatment category
  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, ...updates }: TreatmentCategoryUpdate & { id: string }) => {
      if (!user?.id) throw new Error('Not authenticated');

      const updateData: TreatmentCategoryUpdate = {
        ...updates,
        updated_by: user.id,
        // Ensure location_id and region_id are properly set (null if empty string or null)
        location_id: updates.location_id && updates.location_id !== '' ? updates.location_id : null,
        region_id: updates.region_id && updates.region_id !== '' ? updates.region_id : null,
      };

      const { error } = await (supabase as any)
        .from('treatment_categories')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatment_categories', organizationId] });
      toast.success('Treatment category updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update treatment category: ${error.message}`);
    },
  });

  // Delete treatment category (soft delete)
  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Not authenticated');

      const { error } = await (supabase as any)
        .from('treatment_categories')
        .update({
          deleted_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatment_categories', organizationId] });
      toast.success('Treatment category deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete treatment category: ${error.message}`);
    },
  });

  // Get single treatment category
  const getCategory = async (id: string): Promise<TreatmentCategory | null> => {
    const { data, error } = await (supabase as any)
      .from('treatment_categories')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    return data as TreatmentCategory | null;
  };

  return {
    categories,
    isLoading,
    createCategory: createCategoryMutation.mutateAsync,
    updateCategory: updateCategoryMutation.mutateAsync,
    deleteCategory: deleteCategoryMutation.mutateAsync,
    getCategory,
    isCreating: createCategoryMutation.isPending,
    isUpdating: updateCategoryMutation.isPending,
    isDeleting: deleteCategoryMutation.isPending,
  };
}
