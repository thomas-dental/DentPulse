import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

/**
 * Manual exam/hygiene/xray entitlement override for a Dentally payment plan —
 * for practices that never configured this in Dentally itself (or, for
 * x-ray, because Dentally has no such field at all), leaving
 * payment_plans.pp_exam_appointments_included / pp_hygiene_appointments_included
 * empty/absent. Written to payment_plans.exams_included_override /
 * hygiene_included_override (migration 20260813000001) and
 * xray_included_override (migration 20260815000001), read as a fallback
 * everywhere entitlement is used (see useCapacityData.ts's redemption query
 * and useMarginData.ts's unredeemed-entitlement query).
 */
export function usePaymentPlanEntitlement() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const setEntitlement = useMutation({
    mutationFn: async ({
      paymentPlanIds,
      exams,
      hygiene,
      xray,
    }: {
      paymentPlanIds: string[];
      exams: number | null;
      hygiene: number | null;
      xray: number | null;
    }) => {
      const { error } = await (supabase as any)
        .from('payment_plans')
        .update({ exams_included_override: exams, hygiene_included_override: hygiene, xray_included_override: xray })
        .in('id', paymentPlanIds);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insights_settings_payment_plans', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['insights_settings_payment_plans_v2', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['insights_capacity_redemption'] });
      queryClient.invalidateQueries({ queryKey: ['insights_margin_unredeemed'] });
      queryClient.invalidateQueries({ queryKey: ['membership_performance'] });
    },
    onError: (error: any) => {
      if (/column .* does not exist/i.test(error?.message ?? '')) {
        toast.error('Entitlement override isn’t set up on this database yet — the latest entitlement migration needs to be applied first.');
      } else {
        toast.error(`Couldn't save entitlement: ${error?.message ?? 'unknown error'}`);
      }
    },
  });

  return { setEntitlement: setEntitlement.mutateAsync, isSaving: setEntitlement.isPending };
}
