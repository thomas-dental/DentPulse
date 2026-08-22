import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

export interface CostTypes {
  labFees: string[];
  staff: string[];
  operatingLease: string[];
  clinicianCost: string[];
  overhead: string[];
  material: string[];
  marketing: string[];
}

export interface IncomeTypes {
  privateIncome: string[];
  membershipIncome: string[];
  nhsIncome: string[];
  mosIncome: string[];
  uoaIncome: string[];
}

export interface ProviderIncomeTypes {
  privateIncome: string[];
  membershipIncome: string[];
  nhsIncome: string[];
}

export interface PnlAccounts {
  administrativeCost: string[];
  costOfSales: string[];
}

export interface LocationAccountSettings {
  costTypes: CostTypes;
  /** PMS mapping (Dentally payment-plan pp_ids). */
  incomeTypes: IncomeTypes;
  /** Accounting mapping (Chart-of-Account UUIDs), kept independently of incomeTypes so each source's mapping survives a source change. */
  incomeCoaTypes: IncomeTypes;
  providerIncomeTypes: ProviderIncomeTypes;
  pnlAccounts: PnlAccounts;
}

const EMPTY_COST: CostTypes = { labFees: [], staff: [], operatingLease: [], clinicianCost: [], overhead: [], material: [], marketing: [] };
const EMPTY_INCOME: IncomeTypes = { privateIncome: [], membershipIncome: [], nhsIncome: [], mosIncome: [], uoaIncome: [] };
const EMPTY_PROVIDER_INCOME: ProviderIncomeTypes = { privateIncome: [], membershipIncome: [], nhsIncome: [] };
const EMPTY_PNL: PnlAccounts = { administrativeCost: [], costOfSales: [] };
const EMPTY_SETTINGS: LocationAccountSettings = {
  costTypes: EMPTY_COST,
  incomeTypes: EMPTY_INCOME,
  incomeCoaTypes: EMPTY_INCOME,
  providerIncomeTypes: EMPTY_PROVIDER_INCOME,
  pnlAccounts: EMPTY_PNL,
};

function arr(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

/**
 * Single read/write path for a location's expense, revenue, provider-income,
 * and P&L account mappings (practice_locations columns) — consolidates what
 * used to be duplicated inline in Organization.tsx and LocationDetailContent.tsx.
 */
export function useLocationAccountSettings(locationId: string | null) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['location-account-settings', locationId],
    queryFn: async (): Promise<LocationAccountSettings> => {
      const { data, error } = await (supabase as any)
        .from('practice_locations')
        .select(
          'lab_fees_accounts, staff_costs_accounts, operating_lease_accounts, clinician_cost_accounts, overhead_cost_accounts, material_cost_accounts, marketing_cost_accounts, private_income_accounts, membership_income_accounts, nhs_income_accounts, mos_income_accounts, uoa_income_accounts, private_income_coa_accounts, membership_income_coa_accounts, nhs_income_coa_accounts, mos_income_coa_accounts, uoa_income_coa_accounts, provider_private_income_accounts, provider_membership_income_accounts, provider_nhs_income_accounts, administrative_cost_accounts, cost_of_sales_accounts'
        )
        .eq('id', locationId)
        .single();
      if (error) throw error;

      return {
        costTypes: {
          labFees: arr(data?.lab_fees_accounts),
          staff: arr(data?.staff_costs_accounts),
          operatingLease: arr(data?.operating_lease_accounts),
          clinicianCost: arr(data?.clinician_cost_accounts),
          overhead: arr(data?.overhead_cost_accounts),
          material: arr(data?.material_cost_accounts),
          marketing: arr(data?.marketing_cost_accounts),
        },
        incomeTypes: {
          privateIncome: arr(data?.private_income_accounts),
          membershipIncome: arr(data?.membership_income_accounts),
          nhsIncome: arr(data?.nhs_income_accounts),
          mosIncome: arr(data?.mos_income_accounts),
          uoaIncome: arr(data?.uoa_income_accounts),
        },
        incomeCoaTypes: {
          privateIncome: arr(data?.private_income_coa_accounts),
          membershipIncome: arr(data?.membership_income_coa_accounts),
          nhsIncome: arr(data?.nhs_income_coa_accounts),
          mosIncome: arr(data?.mos_income_coa_accounts),
          uoaIncome: arr(data?.uoa_income_coa_accounts),
        },
        providerIncomeTypes: {
          privateIncome: arr(data?.provider_private_income_accounts),
          membershipIncome: arr(data?.provider_membership_income_accounts),
          nhsIncome: arr(data?.provider_nhs_income_accounts),
        },
        pnlAccounts: {
          administrativeCost: arr(data?.administrative_cost_accounts),
          costOfSales: arr(data?.cost_of_sales_accounts),
        },
      };
    },
    enabled: !!locationId,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: LocationAccountSettings) => {
      if (!locationId) throw new Error('Select a location to save account mappings.');
      const { error } = await (supabase as any)
        .from('practice_locations')
        .update({
          lab_fees_accounts: payload.costTypes.labFees,
          staff_costs_accounts: payload.costTypes.staff,
          operating_lease_accounts: payload.costTypes.operatingLease,
          clinician_cost_accounts: payload.costTypes.clinicianCost,
          overhead_cost_accounts: payload.costTypes.overhead,
          material_cost_accounts: payload.costTypes.material,
          marketing_cost_accounts: payload.costTypes.marketing,
          private_income_accounts: payload.incomeTypes.privateIncome,
          membership_income_accounts: payload.incomeTypes.membershipIncome,
          nhs_income_accounts: payload.incomeTypes.nhsIncome,
          mos_income_accounts: payload.incomeTypes.mosIncome,
          uoa_income_accounts: payload.incomeTypes.uoaIncome,
          private_income_coa_accounts: payload.incomeCoaTypes.privateIncome,
          membership_income_coa_accounts: payload.incomeCoaTypes.membershipIncome,
          nhs_income_coa_accounts: payload.incomeCoaTypes.nhsIncome,
          mos_income_coa_accounts: payload.incomeCoaTypes.mosIncome,
          uoa_income_coa_accounts: payload.incomeCoaTypes.uoaIncome,
          provider_private_income_accounts: payload.providerIncomeTypes.privateIncome,
          provider_membership_income_accounts: payload.providerIncomeTypes.membershipIncome,
          provider_nhs_income_accounts: payload.providerIncomeTypes.nhsIncome,
          administrative_cost_accounts: payload.pnlAccounts.administrativeCost,
          cost_of_sales_accounts: payload.pnlAccounts.costOfSales,
        })
        .eq('id', locationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-account-settings', locationId] });
      queryClient.invalidateQueries({ queryKey: ['all-practice-locations'] });
    },
  });

  return {
    settings: data ?? EMPTY_SETTINGS,
    isLoading,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
  };
}

export interface OrgExpenseFallback {
  labFees: string[];
  staff: string[];
  operatingLease: string[];
}

const EMPTY_ORG_FALLBACK: OrgExpenseFallback = { labFees: [], staff: [], operatingLease: [] };

function parseOrgExpenseColumn(jsonStr: string | null | undefined): string[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed.selected_account) ? (parsed.selected_account as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Org-level default for Lab Fees / Staff Costs / Operating Lease — the only
 * three expense categories with an org-level fallback column. Used when
 * "All Locations" is selected; a location's own mapping overrides this
 * (see useExpenseAccountSettings.ts / useLocationCoaMappings.ts).
 */
export function useOrgExpenseFallback() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['org-expense-fallback', organizationId],
    queryFn: async (): Promise<OrgExpenseFallback> => {
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('lab_fees, staff_costs, operating_lease')
        .eq('id', organizationId)
        .single();
      if (error) throw error;
      return {
        labFees: parseOrgExpenseColumn(data?.lab_fees),
        staff: parseOrgExpenseColumn(data?.staff_costs),
        operatingLease: parseOrgExpenseColumn(data?.operating_lease),
      };
    },
    enabled: !!organizationId,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: OrgExpenseFallback) => {
      if (!organizationId) throw new Error('No organization selected');
      const toJson = (selectedAccount: string[]) =>
        JSON.stringify({ account_type: 'Accounting App', selected_account: selectedAccount });
      const { error } = await (supabase as any)
        .from('organizations')
        .update({
          lab_fees: toJson(values.labFees),
          staff_costs: toJson(values.staff),
          operating_lease: toJson(values.operatingLease),
          updated_at: new Date().toISOString(),
        })
        .eq('id', organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-expense-fallback', organizationId] });
    },
  });

  return {
    values: data ?? EMPTY_ORG_FALLBACK,
    isLoading,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
  };
}
