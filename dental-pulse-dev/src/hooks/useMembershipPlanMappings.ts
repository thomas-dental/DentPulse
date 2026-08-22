import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';

/**
 * Practice Plan statement plan → Dentally payment plan(s) mapping. Statement
 * plans (fee_category labels like "Comprehensive"/"Low B") have no
 * payment_plans row of their own; this user-maintained mapping gives each
 * one Dentally plan identities for analytics joins. Multi-select: one
 * statement plan can correspond to several Dentally plans.
 */

export interface MembershipPlanMapping {
  id: string;
  plan_label: string;
  payment_plan_ids: string[];
}

export function useMembershipPlanMappings() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading } = useQuery<MembershipPlanMapping[]>({
    queryKey: ['membership_plan_mappings', organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      // THROW on error — a swallowed failure would cache [] as fresh.
      const { data, error } = await (supabase as any)
        .from('membership_plan_mappings')
        .select('id, plan_label, payment_plan_ids')
        .eq('organization_id', organizationId);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        id: r.id,
        plan_label: r.plan_label,
        payment_plan_ids: Array.isArray(r.payment_plan_ids) ? r.payment_plan_ids : [],
      }));
    },
  });

  // Replace one statement plan's mapped set. Empty array = remove the row.
  const setMutation = useMutation({
    mutationFn: async ({ planLabel, paymentPlanIds }: { planLabel: string; paymentPlanIds: string[] }) => {
      if (!organizationId) throw new Error('No organization selected');

      if (paymentPlanIds.length === 0) {
        const { error } = await (supabase as any)
          .from('membership_plan_mappings')
          .delete()
          .eq('organization_id', organizationId)
          .eq('plan_label', planLabel);
        if (error) throw error;
        return;
      }

      const { error } = await (supabase as any)
        .from('membership_plan_mappings')
        .upsert({
          organization_id: organizationId,
          plan_label: planLabel,
          payment_plan_ids: paymentPlanIds,
          created_by: user?.id ?? null,
        }, { onConflict: 'organization_id,plan_label' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership_plan_mappings', organizationId] });
    },
  });

  return {
    mappings,
    isLoading,
    setMapping: setMutation.mutateAsync,
    isSaving: setMutation.isPending,
  };
}
