import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useAuth } from './useAuth';

export interface EbitdaAdjustment {
  id: string;
  label: string;
  amount: number;
  category: 'normalisation' | 'sustainability_manual';
  confidence_pct: number | null;
  is_active: boolean;
  notes: string | null;
}

export function useEbitdaAdjustments() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = ['ebitda-adjustments', organizationId];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<EbitdaAdjustment[]> => {
      if (!organizationId) return [];

      const { data, error } = await (supabase as any)
        .from('ebitda_adjustments')
        .select('id, label, amount, category, confidence_pct, is_active, notes')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[useEbitdaAdjustments] Error:', error);
        return [];
      }
      return (data ?? []) as EbitdaAdjustment[];
    },
    enabled: !!organizationId && !!user?.id,
  });

  const addMutation = useMutation({
    mutationFn: async (adj: Omit<EbitdaAdjustment, 'id' | 'is_active'>) => {
      const { error } = await (supabase as any)
        .from('ebitda_adjustments')
        .insert({
          organization_id: organizationId,
          user_id: user?.id,
          ...adj,
        });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<EbitdaAdjustment> & { id: string }) => {
      const { error } = await (supabase as any)
        .from('ebitda_adjustments')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('ebitda_adjustments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    adjustments: query.data ?? [],
    isLoading: query.isLoading,
    addAdjustment: addMutation.mutateAsync,
    updateAdjustment: updateMutation.mutateAsync,
    deleteAdjustment: deleteMutation.mutateAsync,
  };
}
