import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';

/**
 * Statement provider name → enterprise provider(s) (+ location) mapping.
 * Practice Plan / Denplan statements print their own dentist names
 * ("Dr Israr Razaq 2") that rarely equal providers.name exactly, so
 * everywhere a statement dentist has to resolve to a real provider record
 * the app fuzzy-matches by name (lib/dentistNameMatch.ts). This explicit,
 * user-maintained mapping takes precedence over the fuzzy match wherever
 * it exists, and can also pin which practice location that provider's
 * statement figures belong to. Multi-select: a statement bucket like
 * "Hygiene Only" can cover several providers — consumers split that name's
 * statement revenue equally between them (penny-exact, so the provider
 * total always reconciles to the membership total). Maintained from the
 * Membership module's Settings tab.
 */

export interface MembershipProviderMapping {
  id: string;
  provider_label: string;
  provider_ids: string[];
  location_ids: string[];
}

export interface ResolvedProviderMapping {
  providerIds: string[];
  locationIds: string[];
}

/**
 * Tolerant read for non-hook consumers (net-production fallback, Clinicians
 * tab). Returns an EMPTY map on any error — including the table not existing
 * yet when the migration hasn't been applied — so the fuzzy name match keeps
 * working exactly as before rather than taking the whole fetch down.
 */
export async function fetchMembershipProviderMappings(
  organizationId: string,
): Promise<Map<string, ResolvedProviderMapping>> {
  const map = new Map<string, ResolvedProviderMapping>();
  const { data, error } = await (supabase as any)
    .from('membership_provider_mappings')
    .select('provider_label, provider_ids, location_ids')
    .eq('organization_id', organizationId);
  if (error) {
    console.warn('[fetchMembershipProviderMappings] lookup failed, using name match only:', error);
    return map;
  }
  for (const r of (data ?? []) as any[]) {
    const label = String(r.provider_label ?? '').trim();
    if (!label) continue;
    map.set(label, {
      providerIds: Array.isArray(r.provider_ids) ? r.provider_ids.map(String) : [],
      locationIds: Array.isArray(r.location_ids) ? r.location_ids.map(String) : [],
    });
  }
  return map;
}

export function useMembershipProviderMappings() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading } = useQuery<MembershipProviderMapping[]>({
    queryKey: ['membership_provider_mappings', organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      // THROW on error — a swallowed failure would cache [] as fresh.
      const { data, error } = await (supabase as any)
        .from('membership_provider_mappings')
        .select('id, provider_label, provider_ids, location_ids')
        .eq('organization_id', organizationId);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        id: r.id,
        provider_label: r.provider_label,
        provider_ids: Array.isArray(r.provider_ids) ? r.provider_ids.map(String) : [],
        location_ids: Array.isArray(r.location_ids) ? r.location_ids.map(String) : [],
      }));
    },
  });

  // Replace one statement provider's mapping. No providers + no locations =
  // remove the row (back to fuzzy name matching).
  //
  // OPTIMISTIC: every checkbox toggle in the multi-select fires a save, and
  // waiting for the round-trip made the checkbox visibly snap back to the
  // old state until the refetch landed (client-flagged "fluctuation"), and
  // let a second quick toggle compute its array from stale data. The cache
  // is updated immediately, rolled back on error, and only re-synced from
  // the server after the LAST in-flight save (an invalidation between rapid
  // clicks would overwrite newer optimistic state with a stale list).
  const mappingsKey = ['membership_provider_mappings', organizationId];
  const SET_MUTATION_KEY = ['membership_provider_mappings_set', organizationId];
  const setMutation = useMutation({
    mutationKey: SET_MUTATION_KEY,
    mutationFn: async ({ providerLabel, providerIds, locationIds }: {
      providerLabel: string;
      providerIds: string[];
      locationIds: string[];
    }) => {
      if (!organizationId) throw new Error('No organization selected');

      if (providerIds.length === 0 && locationIds.length === 0) {
        const { error } = await (supabase as any)
          .from('membership_provider_mappings')
          .delete()
          .eq('organization_id', organizationId)
          .eq('provider_label', providerLabel);
        if (error) throw error;
        return;
      }

      const { error } = await (supabase as any)
        .from('membership_provider_mappings')
        .upsert({
          organization_id: organizationId,
          provider_label: providerLabel,
          provider_ids: providerIds,
          location_ids: locationIds,
          created_by: user?.id ?? null,
        }, { onConflict: 'organization_id,provider_label' });
      if (error) throw error;
    },
    onMutate: async ({ providerLabel, providerIds, locationIds }) => {
      await queryClient.cancelQueries({ queryKey: mappingsKey });
      const previous = queryClient.getQueryData<MembershipProviderMapping[]>(mappingsKey);
      queryClient.setQueryData<MembershipProviderMapping[]>(mappingsKey, (old = []) => {
        const existing = old.find((m) => m.provider_label === providerLabel);
        const rest = old.filter((m) => m.provider_label !== providerLabel);
        if (providerIds.length === 0 && locationIds.length === 0) return rest;
        return [
          ...rest,
          {
            id: existing?.id ?? `optimistic:${providerLabel}`,
            provider_label: providerLabel,
            provider_ids: providerIds,
            location_ids: locationIds,
          },
        ];
      });
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(mappingsKey, context.previous);
      }
      toast.error(`Failed to save provider mapping: ${error.message}`);
    },
    onSettled: () => {
      // Re-sync only when this is the last in-flight save (count includes
      // this mutation until it fully settles, so 1 = "I'm the last").
      if (queryClient.isMutating({ mutationKey: SET_MUTATION_KEY }) === 1) {
        queryClient.invalidateQueries({ queryKey: mappingsKey });
        // Consumers read the mapping inside their own queryFn (it isn't in
        // their query keys), so refresh them explicitly after an edit.
        queryClient.invalidateQueries({ queryKey: ['insights_clinicians_dentally'] });
        queryClient.invalidateQueries({ queryKey: ['all-providers-net-production-v24'] });
      }
    },
  });

  return {
    mappings,
    isLoading,
    setMapping: setMutation.mutateAsync,
    isSaving: setMutation.isPending,
  };
}
