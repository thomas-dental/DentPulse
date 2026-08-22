import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import { Payslip, PayslipSavePayload, PayslipStatus, PayslipWithLines } from '@/types/payslip';

export interface PayslipFilters {
  from?: string | null; // 'YYYY-MM-DD', filters month_ending >=
  to?: string | null; // 'YYYY-MM-DD', filters month_ending <=
  status?: PayslipStatus | 'all';
}

export function usePayslips(providerId?: string, filters: PayslipFilters = {}) {
  const { profile } = useAuth();
  const organizationId = profile?.current_organization_id;
  const { from, to, status } = filters;

  const {
    data: payslips = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['payslips', providerId, organizationId, from, to, status],
    queryFn: async () => {
      if (!providerId || !organizationId) return [];

      let query = (supabase as any)
        .from('provider_payslips')
        .select('*')
        .eq('provider_id', providerId)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('month_ending', { ascending: false });

      if (from) query = query.gte('month_ending', from);
      if (to) query = query.lte('month_ending', to);
      if (status && status !== 'all') query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;
      return data as Payslip[];
    },
    enabled: !!providerId && !!organizationId,
  });

  return { payslips, isLoading, error, refetch };
}

export function usePayslip(payslipId?: string) {
  const { profile } = useAuth();
  const organizationId = profile?.current_organization_id;

  return useQuery({
    queryKey: ['payslip', payslipId, organizationId],
    queryFn: async (): Promise<PayslipWithLines | null> => {
      if (!payslipId || !organizationId) return null;

      const { data, error } = await (supabase as any)
        .from('provider_payslips')
        .select(
          `*,
          income_lines:provider_payslip_income_lines(*),
          pay_band_lines:provider_payslip_pay_band_lines(*),
          lab_band_lines:provider_payslip_lab_band_lines(*),
          adjustment_lines:provider_payslip_adjustment_lines(*)`,
        )
        .eq('id', payslipId)
        .eq('organization_id', organizationId)
        .single();

      if (error) throw error;
      return data as PayslipWithLines;
    },
    enabled: !!payslipId && !!organizationId,
  });
}

export function useSavePayslipMutation(providerId?: string) {
  const { user, profile } = useAuth();
  const organizationId = profile?.current_organization_id;
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (payload: PayslipSavePayload) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('User not authenticated');

      const { income_lines, pay_band_lines, lab_band_lines, adjustment_lines, id, ...header } = payload;

      let payslipId = id;

      if (payslipId) {
        const { error: updateError } = await (supabase as any)
          .from('provider_payslips')
          .update(header)
          .eq('id', payslipId)
          .eq('organization_id', organizationId);
        if (updateError) throw updateError;
      } else {
        const { data: inserted, error: insertError } = await (supabase as any)
          .from('provider_payslips')
          .insert({ ...header, organization_id: organizationId, created_by: user.id })
          .select()
          .single();
        if (insertError) throw insertError;
        payslipId = inserted.id;
      }

      // Replace-all strategy for each line table (mirrors useSlidingScales.ts).
      const lineTables: { table: string; rows: Record<string, unknown>[] }[] = [
        { table: 'provider_payslip_income_lines', rows: income_lines },
        { table: 'provider_payslip_pay_band_lines', rows: pay_band_lines },
        { table: 'provider_payslip_lab_band_lines', rows: lab_band_lines },
        { table: 'provider_payslip_adjustment_lines', rows: adjustment_lines },
      ];

      for (const { table, rows } of lineTables) {
        const { error: deleteError } = await (supabase as any)
          .from(table)
          .delete()
          .eq('payslip_id', payslipId);
        if (deleteError) throw deleteError;

        if (rows.length > 0) {
          const { error: insertLinesError } = await (supabase as any)
            .from(table)
            .insert(rows.map((row) => ({ ...row, payslip_id: payslipId, organization_id: organizationId })));
          if (insertLinesError) throw insertLinesError;
        }
      }

      return payslipId as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips', providerId, organizationId] });
      toast.success('Payslip saved successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save payslip: ${error.message}`);
    },
  });

  return { savePayslip: mutation.mutate, savePayslipAsync: mutation.mutateAsync, isSaving: mutation.isPending };
}

export function usePostPayslipMutation(providerId?: string) {
  const { profile } = useAuth();
  const organizationId = profile?.current_organization_id;
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (payslipId: string) => {
      if (!organizationId) throw new Error('No organization selected');

      const { error } = await (supabase as any)
        .from('provider_payslips')
        .update({ status: 'posted' })
        .eq('id', payslipId)
        .eq('organization_id', organizationId)
        .eq('status', 'draft');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips', providerId, organizationId] });
      toast.success('Payslip posted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to post payslip: ${error.message}`);
    },
  });

  return { postPayslip: mutation.mutate, isPosting: mutation.isPending };
}

export function useDeletePayslipMutation(providerId?: string) {
  const { profile } = useAuth();
  const organizationId = profile?.current_organization_id;
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (payslipId: string) => {
      if (!organizationId) throw new Error('No organization selected');

      const { error } = await (supabase as any)
        .from('provider_payslips')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', payslipId)
        .eq('organization_id', organizationId)
        .eq('status', 'draft');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips', providerId, organizationId] });
      toast.success('Payslip deleted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete payslip: ${error.message}`);
    },
  });

  return { deletePayslip: mutation.mutate, isDeleting: mutation.isPending };
}
