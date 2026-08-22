import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { TreatmentServiceStep, TreatmentServiceStepUpdate } from '@/types/treatment-service-step';
import { toast } from 'sonner';

// One row per treatment -- rows are created/refreshed automatically by a DB
// trigger whenever a treatment is added or edited, so this hook only ever
// reads and updates the per-treatment step settings (no create/delete/sync).
// A step can be mapped under at most one parent treatment at a time
// (enforced by a unique constraint on treatment_service_step_mappings.step_id).
export function useTreatmentServiceSteps() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const queryKey = ['treatment_service_steps', organizationId];

  const { data: steps = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await (supabase as any)
        .from('treatment_service_steps')
        .select('*, mappings:treatment_service_step_mappings(treatment:treatments(id, treatment_name))')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('service_name', { ascending: true });

      if (error) throw error;

      return ((data || []) as any[]).map((row) => {
        const mappedTreatment = (row.mappings || [])
          .map((m: any) => m.treatment)
          .filter(Boolean)[0] || null;
        return {
          ...row,
          mapped_treatment: mappedTreatment,
          mapped_treatment_id: mappedTreatment?.id ?? null,
        };
      }) as TreatmentServiceStep[];
    },
    enabled: !!organizationId,
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ id, mapped_treatment_id, ...updates }: TreatmentServiceStepUpdate & { id: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      if (!organizationId) throw new Error('No organization selected');

      const { error: updateError } = await (supabase as any)
        .from('treatment_service_steps')
        .update({ ...updates, updated_by: user.id })
        .eq('id', id);

      if (updateError) throw updateError;

      if (mapped_treatment_id !== undefined) {
        const { error: deleteError } = await (supabase as any)
          .from('treatment_service_step_mappings')
          .delete()
          .eq('step_id', id);

        if (deleteError) throw deleteError;

        if (mapped_treatment_id) {
          const { error: insertError } = await (supabase as any)
            .from('treatment_service_step_mappings')
            .insert({
              organization_id: organizationId,
              step_id: id,
              treatment_id: mapped_treatment_id,
              created_by: user.id,
            });

          if (insertError) throw insertError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Treatment step updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update treatment step: ${error.message}`);
    },
  });

  // Bulk save for the "Add Steps" modal on the Edit Treatment page: sets
  // `rows` as the full step list for `treatmentId` (updating each step's own
  // completion time / main-step flag and mapping it to treatmentId), and
  // unmaps `removedStepIds` (steps that were removed from the modal's table).
  const setTreatmentStepsMutation = useMutation({
    mutationFn: async ({
      treatmentId,
      rows,
      removedStepIds,
    }: {
      treatmentId: string;
      rows: { id: string; completion_time_used_mins: number | null; is_main_treatment_step: boolean }[];
      removedStepIds: string[];
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      if (!organizationId) throw new Error('No organization selected');

      for (const row of rows) {
        const { error: updateError } = await (supabase as any)
          .from('treatment_service_steps')
          .update({
            completion_time_used_mins: row.completion_time_used_mins,
            is_main_treatment_step: row.is_main_treatment_step,
            updated_by: user.id,
          })
          .eq('id', row.id);
        if (updateError) throw updateError;

        const { error: deleteError } = await (supabase as any)
          .from('treatment_service_step_mappings')
          .delete()
          .eq('step_id', row.id);
        if (deleteError) throw deleteError;

        const { error: insertError } = await (supabase as any)
          .from('treatment_service_step_mappings')
          .insert({
            organization_id: organizationId,
            step_id: row.id,
            treatment_id: treatmentId,
            created_by: user.id,
          });
        if (insertError) throw insertError;
      }

      if (removedStepIds.length > 0) {
        const { error: removeError } = await (supabase as any)
          .from('treatment_service_step_mappings')
          .delete()
          .eq('treatment_id', treatmentId)
          .in('step_id', removedStepIds);
        if (removeError) throw removeError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Treatment steps updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update treatment steps: ${error.message}`);
    },
  });

  return {
    steps,
    isLoading,
    updateStep: updateStepMutation.mutateAsync,
    isUpdating: updateStepMutation.isPending,
    setTreatmentSteps: setTreatmentStepsMutation.mutateAsync,
    isSettingTreatmentSteps: setTreatmentStepsMutation.isPending,
  };
}
