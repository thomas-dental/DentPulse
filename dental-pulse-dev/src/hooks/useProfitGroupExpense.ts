import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { resolveCoaMappingPlatformIntegrationId } from '@/utils/resolveCoaMappingPlatformIntegrationId';
import { useOrganization } from './useOrganization';
import { useAuth } from './useAuth';
import type { SaveProfitGroupExpensePayload } from '@/types/setup-categories';
import { GROUP_TYPE_COST, GROUP_TYPE_EXPENSE, GROUP_TYPE_REVENUE } from '@/types/setup-categories';

export interface ExpenseGroupOption {
  id: number;
  name: string;
  group_code: string;
  range_order: number | null;
  group_type: number;
  accountIds: string[];
}

type GroupAccountRow = {
  group_account_master_id: number;
  account_id: string;
  mapping_location_id?: string | null;
};

type MasterRow = {
  id: number;
  name: string;
  group_code: string;
  range_order: number | null;
  group_type: number;
};

export function useProfitGroupExpense(platformIntegrationId: string | null, mappingLocationId?: string | null) {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const normalizedMappingLocationId = mappingLocationId && mappingLocationId !== 'all' ? mappingLocationId : null;

  const { data: masters, isLoading: loadingMasters } = useQuery({
    queryKey: ['group-account-master-revenue-cost-expense'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_account_master' as any)
        .select('id, name, group_code, range_order, group_type')
        .in('group_type', [GROUP_TYPE_REVENUE, GROUP_TYPE_COST, GROUP_TYPE_EXPENSE])
        .order('group_type', { ascending: true })
        .order('range_order', { ascending: true });
      if (error) throw error;
      return (data || []) as MasterRow[];
    },
  });

  const {
    data: assignedData,
    isLoading: loadingAssignments,
    refetch: refetchExpense,
  } = useQuery({
    queryKey: [
      'group-account-expense',
      organizationId,
      platformIntegrationId,
      masters?.length,
      normalizedMappingLocationId,
    ],
    queryFn: async () => {
      if (!organizationId || !masters?.length) return [];

      const effectivePlatformId = await resolveCoaMappingPlatformIntegrationId(organizationId, platformIntegrationId);
      let query = supabase
        .from('group_account' as any)
        .select('group_account_master_id, account_id, mapping_location_id')
        .eq('organization_id', organizationId);
      if (normalizedMappingLocationId) {
        if (effectivePlatformId) query = query.eq('platform_integration_id', effectivePlatformId);
        else query = query.is('platform_integration_id', null);
        query = query.eq('mapping_location_id', normalizedMappingLocationId);
      } else {
        query = query.not('mapping_location_id', 'is', null);
      }

      const { data, error } = await query;
      if (error) throw error;

      const byMaster: Record<number, string[]> = {};
      const rows = (data || []) as GroupAccountRow[];
      rows.forEach((row) => {
        if (!byMaster[row.group_account_master_id]) byMaster[row.group_account_master_id] = [];
        byMaster[row.group_account_master_id].push(row.account_id);
      });
      Object.keys(byMaster).forEach((id) => {
        byMaster[Number(id)] = [...new Set(byMaster[Number(id)])];
      });

      return masters.map((m) => ({
        ...m,
        accountIds: byMaster[m.id] || [],
      })) as ExpenseGroupOption[];
    },
    enabled: !!organizationId && (masters?.length ?? 0) > 0,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: SaveProfitGroupExpensePayload) => {
      if (!organizationId || !user?.id) throw new Error('Not authenticated');
      if (!normalizedMappingLocationId) {
        throw new Error(
          'Select a location in the top bar to save expense group mappings. All Locations combines each location’s setup automatically in reports.'
        );
      }

      const effectivePlatformId = await resolveCoaMappingPlatformIntegrationId(organizationId, platformIntegrationId);
      const masterIds = payload.groups.map((g) => g.groupAccountMasterId).filter((id) => Number.isFinite(id));

      let delQuery = supabase.from('group_account' as any).delete().eq('organization_id', organizationId);
      if (effectivePlatformId) delQuery = delQuery.eq('platform_integration_id', effectivePlatformId);
      else delQuery = delQuery.is('platform_integration_id', null);
      delQuery = delQuery.eq('mapping_location_id', normalizedMappingLocationId);
      if (masterIds.length > 0) delQuery = delQuery.in('group_account_master_id', masterIds);
      const { error: delErr } = await delQuery;
      if (delErr) throw delErr;

      const inserts: {
        organization_id: string;
        platform_integration_id: string | null;
        mapping_location_id: string | null;
        group_account_master_id: number;
        account_id: string;
        created_by: string;
      }[] = [];
      for (const g of payload.groups) {
        (g.accountIds || []).forEach((accountId) => {
          inserts.push({
            organization_id: organizationId,
            platform_integration_id: effectivePlatformId,
            mapping_location_id: normalizedMappingLocationId,
            group_account_master_id: g.groupAccountMasterId,
            account_id: accountId,
            created_by: user.id,
          });
        });
      }
      if (inserts.length > 0) {
        const { error: insErr } = await supabase.from('group_account' as any).insert(inserts);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['group-account-expense', organizationId, platformIntegrationId, normalizedMappingLocationId],
      });
      // Profit Benchmark Production Income reads these mappings for Accounting + By Practice.
      queryClient.invalidateQueries({ queryKey: ['location-income-accounting-totals'] });
    },
  });

  const options: ExpenseGroupOption[] =
    assignedData ?? (masters || []).map((m) => ({ ...m, accountIds: [] }));

  const costGroupOptions = options.filter(
    (g) => g.group_type === GROUP_TYPE_COST && g.group_code !== 'ClinicianCost',
  );
  const expenseGroupOptions = options.filter((g) => g.group_type === GROUP_TYPE_EXPENSE);
  const revenueGroupOptions = options.filter((g) => g.group_type === GROUP_TYPE_REVENUE);
  /** All revenue + cost + expense groups (used by Setup Categories save/load). */
  const allProfitGroupOptions = options.filter((g) => g.group_code !== 'ClinicianCost');

  return {
    revenueGroupOptions,
    costGroupOptions,
    expenseGroupOptions,
    /** @deprecated Prefer revenue/cost/expense split options */
    profitGroupOptions: allProfitGroupOptions,
    isLoading: loadingMasters || loadingAssignments,
    refetchExpense,
    saveProfitGroupExpense: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
  };
}
