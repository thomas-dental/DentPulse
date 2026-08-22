import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, parseISO } from 'date-fns';
import { toast } from 'sonner';

export interface ProviderContract {
  id: string;
  organization_id: string;
  provider_id: string;
  contract_start_date: string;
  contract_end_date: string | null;
  split_source_method: string;
  associate_split_percentage: number | null;
  lab_split_percentage: number | null;
  lab_split_percentage_sliding: number | null;
  material_split_percentage: number | null;
  associate_split_per_case_rate: number | null;
  associate_split_per_hour_rate: number | null;
  employment_type: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface ContractPeriodFields {
  splitSourceMethod: string;
  associateSplitPercentage: number | null;
  labSplitPercentage: number | null;
  labSplitPercentageSliding: number | null;
  materialSplitPercentage: number | null;
  perCaseRate: number | null;
  perHourRate: number | null;
  employmentType: string | null;
}

function toRow(fields: ContractPeriodFields) {
  return {
    split_source_method: fields.splitSourceMethod || 'flat-percentage',
    associate_split_percentage: fields.associateSplitPercentage,
    lab_split_percentage: fields.labSplitPercentage,
    lab_split_percentage_sliding: fields.labSplitPercentageSliding,
    material_split_percentage: fields.materialSplitPercentage,
    associate_split_per_case_rate: fields.perCaseRate,
    associate_split_per_hour_rate: fields.perHourRate,
    employment_type: fields.employmentType,
  };
}

export function useProviderContracts(providerId: string | undefined) {
  const queryClient = useQueryClient();

  const {
    data: contracts = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['provider-contracts', providerId],
    queryFn: async () => {
      if (!providerId) return [];

      const { data, error } = await supabase
        .from('provider_contracts')
        .select('*')
        .eq('provider_id', providerId)
        .is('deleted_at', null)
        .order('contract_start_date', { ascending: false });

      if (error) throw error;
      return (data ?? []) as ProviderContract[];
    },
    enabled: !!providerId,
  });

  // Closes the provider's currently-open contract period (or bootstraps one
  // from its pre-edit field values, when this is the first contract ever
  // logged to history) one day before `newStartDate`, then opens a new
  // period starting on `newStartDate` with `newFields`.
  const startNewContractMutation = useMutation({
    mutationFn: async (input: {
      providerId: string;
      organizationId: string;
      newStartDate: string; // yyyy-MM-dd
      previousContractStartDate: string | null;
      previousFields: ContractPeriodFields;
      newFields: ContractPeriodFields;
    }) => {
      const {
        providerId,
        organizationId,
        newStartDate,
        previousContractStartDate,
        previousFields,
        newFields,
      } = input;

      const previousEndDate = format(
        addDays(parseISO(newStartDate), -1),
        'yyyy-MM-dd',
      );

      const { data: openRow, error: findError } = await supabase
        .from('provider_contracts')
        .select('id')
        .eq('provider_id', providerId)
        .is('contract_end_date', null)
        .is('deleted_at', null)
        .maybeSingle();
      if (findError) throw findError;

      if (openRow) {
        const { error: closeError } = await supabase
          .from('provider_contracts')
          .update({ contract_end_date: previousEndDate })
          .eq('id', openRow.id);
        if (closeError) throw closeError;
      } else if (previousContractStartDate) {
        // No history yet — log the outgoing contract using its pre-edit
        // values so it isn't lost from the record.
        const { error: bootstrapError } = await supabase
          .from('provider_contracts')
          .insert({
            organization_id: organizationId,
            provider_id: providerId,
            contract_start_date: previousContractStartDate,
            contract_end_date: previousEndDate,
            ...toRow(previousFields),
          });
        if (bootstrapError) throw bootstrapError;
      }

      const { error: insertError } = await supabase
        .from('provider_contracts')
        .insert({
          organization_id: organizationId,
          provider_id: providerId,
          contract_start_date: newStartDate,
          contract_end_date: null,
          ...toRow(newFields),
        });
      if (insertError) throw insertError;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['provider-contracts', variables.providerId],
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to start new contract: ${error.message}`);
    },
  });

  // Keeps the current open contract period's snapshot in sync with a plain
  // "Update Contract" save (no "Is New Contract" checkbox involved) — without
  // this, editing e.g. the split percentage on an ongoing contract left the
  // open provider_contracts row holding whatever values it had when it was
  // first logged, so "View All Contracts" silently went stale on every
  // regular edit. Bootstraps the open row from scratch if none exists yet
  // (first time this provider's contract is ever saved).
  const syncCurrentContractMutation = useMutation({
    mutationFn: async (input: {
      providerId: string;
      organizationId: string;
      contractStartDate: string | null;
      contractEndDate: string | null;
      fields: ContractPeriodFields;
    }) => {
      const {
        providerId,
        organizationId,
        contractStartDate,
        contractEndDate,
        fields,
      } = input;

      const { data: openRow, error: findError } = await supabase
        .from('provider_contracts')
        .select('id')
        .eq('provider_id', providerId)
        .is('contract_end_date', null)
        .is('deleted_at', null)
        .maybeSingle();
      if (findError) throw findError;

      if (openRow) {
        // Dates are edited on this same row too — without them, moving the
        // Contract Start/End Date fields (the only thing changed, no split
        // values touched) silently no-opped: the update only ever touched
        // toRow(fields)'s split columns, so the open row kept whatever dates
        // it had from whenever it was first logged.
        const updates: Record<string, unknown> = { ...toRow(fields) };
        if (contractStartDate) updates.contract_start_date = contractStartDate;
        updates.contract_end_date = contractEndDate;
        const { error: updateError } = await supabase
          .from('provider_contracts')
          .update(updates)
          .eq('id', openRow.id);
        if (updateError) throw updateError;
      } else if (contractStartDate) {
        const { error: insertError } = await supabase
          .from('provider_contracts')
          .insert({
            organization_id: organizationId,
            provider_id: providerId,
            contract_start_date: contractStartDate,
            contract_end_date: contractEndDate,
            ...toRow(fields),
          });
        if (insertError) throw insertError;
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['provider-contracts', variables.providerId],
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to sync contract history: ${error.message}`);
    },
  });

  const deleteContractMutation = useMutation({
    mutationFn: async (input: { id: string; providerId: string }) => {
      const { error } = await supabase
        .from('provider_contracts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['provider-contracts', variables.providerId],
      });
      toast.success('Contract deleted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete contract: ${error.message}`);
    },
  });

  return {
    contracts,
    isLoading,
    error,
    startNewContract: startNewContractMutation.mutateAsync,
    isStartingNewContract: startNewContractMutation.isPending,
    syncCurrentContract: syncCurrentContractMutation.mutateAsync,
    isSyncingCurrentContract: syncCurrentContractMutation.isPending,
    deleteContract: deleteContractMutation.mutate,
    isDeletingContract: deleteContractMutation.isPending,
  };
}
