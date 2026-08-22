import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

export type EbitdaAccountBucket =
  | 'depreciation'
  | 'amortisation'
  | 'interest'
  | 'tax';

export interface EbitdaAccountMappings {
  depreciation: string[];
  amortisation: string[];
  interest: string[];
  tax: string[];
}

const EMPTY: EbitdaAccountMappings = {
  depreciation: [],
  amortisation: [],
  interest: [],
  tax: [],
};

const COL: Record<EbitdaAccountBucket, string> = {
  depreciation: 'ebitda_depreciation_accounts',
  amortisation: 'ebitda_amortisation_accounts',
  interest: 'ebitda_interest_accounts',
  tax: 'ebitda_tax_accounts',
};

function asIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const id = String(x || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function parseRow(row: Record<string, unknown> | null | undefined): EbitdaAccountMappings {
  if (!row) return { ...EMPTY };
  return {
    depreciation: asIdList(row.ebitda_depreciation_accounts),
    amortisation: asIdList(row.ebitda_amortisation_accounts),
    interest: asIdList(row.ebitda_interest_accounts),
    tax: asIdList(row.ebitda_tax_accounts),
  };
}

/**
 * Load / save EBITDA add-back Chart-of-Account mappings for a practice location
 * (Setup Categories → EBITDA). Account ids are external COA ids (Xero GUID, etc.).
 */
export function useEbitdaAccountMappings(locationId: string | null | undefined) {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ['ebitda-account-mappings', organizationId, locationId ?? 'none'] as const,
    [organizationId, locationId],
  );

  const query = useQuery({
    queryKey,
    enabled: !!organizationId && !!locationId,
    staleTime: 60_000,
    queryFn: async (): Promise<EbitdaAccountMappings> => {
      if (!organizationId || !locationId) return { ...EMPTY };
      const { data, error } = await (supabase as any)
        .from('practice_locations')
        .select(
          'ebitda_depreciation_accounts, ebitda_amortisation_accounts, ebitda_interest_accounts, ebitda_tax_accounts',
        )
        .eq('organization_id', organizationId)
        .eq('id', locationId)
        .maybeSingle();
      if (error) throw error;
      return parseRow(data as Record<string, unknown> | null);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (mappings: EbitdaAccountMappings) => {
      if (!organizationId || !locationId) throw new Error('Select a location to save EBITDA mappings.');
      const payload = {
        ebitda_depreciation_accounts: asIdList(mappings.depreciation),
        ebitda_amortisation_accounts: asIdList(mappings.amortisation),
        ebitda_interest_accounts: asIdList(mappings.interest),
        ebitda_tax_accounts: asIdList(mappings.tax),
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from('practice_locations')
        .update(payload)
        .eq('organization_id', organizationId)
        .eq('id', locationId);
      if (error) throw error;
      return parseRow(payload);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved);
      queryClient.invalidateQueries({ queryKey: ['ebitda-bridge'] });
    },
  });

  const save = useCallback(
    async (mappings: EbitdaAccountMappings) => saveMutation.mutateAsync(mappings),
    [saveMutation],
  );

  return {
    mappings: query.data ?? EMPTY,
    isLoading: query.isLoading,
    error: query.error,
    save,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error as Error | null,
    columnFor: COL,
  };
}
