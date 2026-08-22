import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface SpecialTreatmentGroup {
  id: string;
  organization_id: string;
  provider_id: string;
  group_name: string;
  associate_split_percentage: number;
  treatment_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface SpecialTreatmentGroupInput {
  groupName: string;
  associateSplitPercentage: number;
  treatmentIds: string[];
}

export function useProviderSpecialTreatments(providerId: string | undefined) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = profile?.current_organization_id;

  const {
    data: groups = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['provider-special-treatments', providerId],
    queryFn: async () => {
      if (!providerId) return [];

      const { data, error } = await supabase
        .from('provider_special_treatments')
        .select('*')
        .eq('provider_id', providerId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data ?? []) as SpecialTreatmentGroup[];
    },
    enabled: !!providerId,
  });

  // Save (Replace All Strategy) — matches useSlidingScales' save pattern:
  // delete everything currently saved for this provider, then insert the
  // full set of rows from the editor. Simpler and correct for a form whose
  // rows have no stable identity worth preserving across edits.
  const saveMutation = useMutation({
    mutationFn: async ({
      providerId,
      groups,
    }: {
      providerId: string;
      groups: SpecialTreatmentGroupInput[];
    }) => {
      if (!organizationId) throw new Error('No organization selected');

      const { error: deleteError } = await supabase
        .from('provider_special_treatments')
        .delete()
        .eq('provider_id', providerId);
      if (deleteError) throw deleteError;

      const rows = groups
        .filter((g) => g.groupName.trim() !== '')
        .map((g) => ({
          organization_id: organizationId,
          provider_id: providerId,
          group_name: g.groupName.trim(),
          associate_split_percentage: g.associateSplitPercentage,
          treatment_ids: g.treatmentIds,
        }));

      if (rows.length === 0) return [];

      const { data, error: insertError } = await supabase
        .from('provider_special_treatments')
        .insert(rows)
        .select();
      if (insertError) throw insertError;
      return data as SpecialTreatmentGroup[];
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['provider-special-treatments', variables.providerId],
      });
      toast.success('Special treatment groups saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save special treatments: ${error.message}`);
    },
  });

  return {
    groups,
    isLoading,
    error,
    saveGroups: saveMutation.mutate,
    isSaving: saveMutation.isPending,
  };
}
