import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

export interface MembershipStatusThresholds {
  profitableMin: number;
  atRiskMin: number;
}

const DEFAULTS: MembershipStatusThresholds = {
  profitableMin: 15,
  atRiskMin: 0,
};

export function useMembershipThresholds(): MembershipStatusThresholds {
  const { organizationId } = useOrganization();

  const { data } = useQuery({
    queryKey: ['membership-thresholds', organizationId],
    queryFn: async () => {
      if (!organizationId) return DEFAULTS;
      const { data: org } = await (supabase as any)
        .from('organizations')
        .select('membership_status_thresholds')
        .eq('id', organizationId)
        .single();
      if (!org?.membership_status_thresholds) return DEFAULTS;
      try {
        const parsed = typeof org.membership_status_thresholds === 'string'
          ? JSON.parse(org.membership_status_thresholds)
          : org.membership_status_thresholds;
        return {
          profitableMin: parsed.profitableMin ?? DEFAULTS.profitableMin,
          atRiskMin: parsed.atRiskMin ?? DEFAULTS.atRiskMin,
        };
      } catch {
        return DEFAULTS;
      }
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  return data ?? DEFAULTS;
}

/** Save mutation for the org-level Membership Plan Status Thresholds — the single write path (Setup Categories). */
export function useSaveMembershipThresholds() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (thresholds: MembershipStatusThresholds) => {
      if (!organizationId) throw new Error('No organization selected');
      const { error } = await (supabase as any)
        .from('organizations')
        .update({
          membership_status_thresholds: JSON.stringify(thresholds),
          updated_at: new Date().toISOString(),
        })
        .eq('id', organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership-thresholds', organizationId] });
    },
  });

  return {
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  };
}

export function getStatusFromMargin(
  netProfitPct: number,
  thresholds: MembershipStatusThresholds,
): 'Profitable' | 'At Risk' | 'Loss-Making' {
  if (netProfitPct >= thresholds.profitableMin) return 'Profitable';
  if (netProfitPct >= thresholds.atRiskMin) return 'At Risk';
  return 'Loss-Making';
}
 