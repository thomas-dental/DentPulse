import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

export type RevenueSourceValue = 'pms' | 'accounting' | 'dentpulse';
export type PrivateRevenueSourceValue = 'pms' | 'accounting';
export type IncomeLevelValue = 'practice' | 'provider';

export interface RevenueSettings {
  private_income_from: PrivateRevenueSourceValue;
  membership_income_from: RevenueSourceValue;
  nhs_income_from: RevenueSourceValue;
  mos_income_from: RevenueSourceValue;
  private_income_level: IncomeLevelValue;
  membership_income_level: IncomeLevelValue;
  nhs_income_level: IncomeLevelValue;
  mos_income_level: IncomeLevelValue;
}

// Matches practice_locations' existing column defaults, so a location that has
// never been touched by this modal (or Location Settings) resolves to exactly
// what it already effectively has today.
const FALLBACK_REVENUE_SETTINGS: RevenueSettings = {
  private_income_from: 'pms',
  membership_income_from: 'accounting',
  nhs_income_from: 'accounting',
  mos_income_from: 'accounting',
  private_income_level: 'practice',
  membership_income_level: 'practice',
  nhs_income_level: 'practice',
  mos_income_level: 'practice',
};

const SOURCE_COLUMNS = {
  private_income_from: 'private_income_source',
  membership_income_from: 'membership_income_source',
  nhs_income_from: 'nhs_income_source',
  mos_income_from: 'mos_income_source',
} as const;

export function useRevenueSettings(locationId: string | null) {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const normalizedLocationId = locationId && locationId !== 'all' ? locationId : null;

  const { data: orgDefault, isLoading: loadingOrgDefault } = useQuery({
    queryKey: ['revenue-settings', organizationId, 'org-default'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('revenue_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .is('location_id', null)
        .maybeSingle();
      if (error) throw error;
      return data as RevenueSettings | null;
    },
    enabled: !!organizationId,
  });

  const { data: locationOverride, isLoading: loadingOverride } = useQuery({
    queryKey: ['revenue-settings', organizationId, normalizedLocationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('revenue_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('location_id', normalizedLocationId)
        .maybeSingle();
      if (error) throw error;
      return data as RevenueSettings | null;
    },
    enabled: !!organizationId && !!normalizedLocationId,
  });

  // A location that has never had a Revenue Settings row saved for it still has
  // real values sitting in practice_locations (from Location Settings, or the
  // column defaults) — use those as the fallback so the modal shows what's
  // actually true today instead of resetting to an arbitrary default.
  const { data: currentLocationValues, isLoading: loadingCurrent } = useQuery({
    queryKey: ['revenue-settings-fallback', organizationId, normalizedLocationId],
    queryFn: async () => {
      let query = (supabase as any)
        .from('practice_locations')
        .select('private_income_source, membership_income_source, nhs_income_source, mos_income_source')
        .eq('organization_id', organizationId);
      query = normalizedLocationId ? query.eq('id', normalizedLocationId) : query.order('created_at', { ascending: true }).limit(1);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as {
        private_income_source: string | null;
        membership_income_source: string | null;
        nhs_income_source: string | null;
        mos_income_source: string | null;
      } | null;
    },
    enabled: !!organizationId,
  });

  const effective: RevenueSettings = locationOverride ?? orgDefault ?? {
    ...FALLBACK_REVENUE_SETTINGS,
    private_income_from: (currentLocationValues?.private_income_source as PrivateRevenueSourceValue) || FALLBACK_REVENUE_SETTINGS.private_income_from,
    membership_income_from: (currentLocationValues?.membership_income_source as RevenueSourceValue) || FALLBACK_REVENUE_SETTINGS.membership_income_from,
    nhs_income_from: (currentLocationValues?.nhs_income_source as RevenueSourceValue) || FALLBACK_REVENUE_SETTINGS.nhs_income_from,
    mos_income_from: (currentLocationValues?.mos_income_source as RevenueSourceValue) || FALLBACK_REVENUE_SETTINGS.mos_income_from,
  };

  const isOverride = !!locationOverride;

  const saveMutation = useMutation({
    mutationFn: async (settings: RevenueSettings) => {
      if (!organizationId) throw new Error('No organization');

      const { error: upsertError } = await (supabase as any)
        .from('revenue_settings')
        .upsert(
          {
            organization_id: organizationId,
            location_id: normalizedLocationId,
            ...settings,
          },
          { onConflict: 'organization_id,location_id' }
        );
      if (upsertError) throw upsertError;

      const sourceUpdate = Object.fromEntries(
        Object.entries(SOURCE_COLUMNS).map(([settingsKey, column]) => [column, settings[settingsKey as keyof typeof SOURCE_COLUMNS]])
      );

      if (normalizedLocationId) {
        // Location-specific override — only that one location's materialized
        // columns need to change.
        const { error } = await (supabase as any)
          .from('practice_locations')
          .update(sourceUpdate)
          .eq('id', normalizedLocationId);
        if (error) throw error;
      } else {
        // Org-wide default — cascade to every location EXCEPT ones that have
        // their own override row, so we don't clobber a deliberate divergence.
        const { data: overriddenLocations, error: overrideErr } = await (supabase as any)
          .from('revenue_settings')
          .select('location_id')
          .eq('organization_id', organizationId)
          .not('location_id', 'is', null);
        if (overrideErr) throw overrideErr;

        const overriddenIds = (overriddenLocations ?? []).map((r: { location_id: string }) => r.location_id);

        let cascadeQuery = (supabase as any)
          .from('practice_locations')
          .update(sourceUpdate)
          .eq('organization_id', organizationId);
        if (overriddenIds.length > 0) {
          cascadeQuery = cascadeQuery.not('id', 'in', `(${overriddenIds.join(',')})`);
        }
        const { error } = await cascadeQuery;
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revenue-settings'] });
      queryClient.invalidateQueries({ queryKey: ['revenue-settings-fallback'] });
      // Income source / level changes which Production Income path is used.
      queryClient.invalidateQueries({ queryKey: ['location-income-accounting-totals'] });
    },
  });

  return {
    settings: effective,
    isOverride,
    isLoading: loadingOrgDefault || loadingOverride || loadingCurrent,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
  };
}
