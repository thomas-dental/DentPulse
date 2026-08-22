import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { resolveCoaMappingPlatformIntegrationId } from '@/utils/resolveCoaMappingPlatformIntegrationId';
import { useOrganization } from './useOrganization';
import { useAuth } from './useAuth';
import {
  type CategoryRangeVM,
  type SaveCategoryRangePayload,
  CATEGORY_RANGE_IDS,
} from '@/types/setup-categories';

const CATEGORY_RANGE_KEYS = Object.keys(CATEGORY_RANGE_IDS) as (keyof typeof CATEGORY_RANGE_IDS)[];

function emptyCategoryRangeVM(): CategoryRangeVM {
  return {
    CFO: [],
    Compliance: [],
    TAXRefund: [],
    CFI: [],
    CFIPayment: [],
    CFF: [],
    CFFPayment: [],
    IntraAccountReceipt: [],
    IntraAccountPayment: [],
    DirectCost: [],
    Overhead: [],
    IntraCompanyReceipt: [],
    IntraCompanyPayment: [],
    CashOrBank: [],
  };
}

type CategoryRangeMapRow = {
  location_id: string;
  category_range_id: number;
  mapping_location_id?: string | null;
};

export function useSetupCategories(platformIntegrationId: string | null, mappingLocationId?: string | null) {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const normalizedMappingLocationId = mappingLocationId && mappingLocationId !== 'all' ? mappingLocationId : null;

  const { data: categoryRangeMasters, isLoading: loadingMasters } = useQuery({
    queryKey: ['category-range-master'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('category_range_master' as any)
        .select('*')
        .order('range_order', { ascending: true });
      if (error) throw error;
      return (data || []) as { id: number; code: string; name: string; range_group: string; range_sub_group: string }[];
    },
  });

  const {
    data: categoryRangeData,
    isLoading: loadingRange,
    refetch: refetchCategoryRange,
  } = useQuery({
    queryKey: ['category-range', organizationId, platformIntegrationId, normalizedMappingLocationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const orgId = organizationId;
      const effectivePlatformId = await resolveCoaMappingPlatformIntegrationId(orgId, platformIntegrationId);

      const mapsRes = normalizedMappingLocationId
        ? await (async () => {
            // Per-location setup only (no all-location default merge).
            let q = supabase
              .from('category_range_map' as any)
              .select('location_id, category_range_id, mapping_location_id')
              .eq('organization_id', orgId)
              .eq('mapping_location_id', normalizedMappingLocationId);
            if (effectivePlatformId) {
              q = q.eq('platform_integration_id', effectivePlatformId);
            }
            return q;
          })()
        : await (async () => {
            // All Locations in UI: show combined per-location maps (read-only intent).
            return supabase
              .from('category_range_map' as any)
              .select('location_id, category_range_id, mapping_location_id')
              .eq('organization_id', orgId)
              .not('mapping_location_id', 'is', null);
          })();

      if (mapsRes.error) throw mapsRes.error;

      const categoryRange = emptyCategoryRangeVM();
      const rows = (mapsRes.data || []) as CategoryRangeMapRow[];
      rows.forEach((row) => {
        const key = CATEGORY_RANGE_KEYS.find((k) => CATEGORY_RANGE_IDS[k] === row.category_range_id);
        if (key && categoryRange[key]) categoryRange[key].push(row.location_id);
      });

      // De-dupe account ids when combining multiple locations in All view.
      CATEGORY_RANGE_KEYS.forEach((key) => {
        categoryRange[key] = [...new Set(categoryRange[key])];
      });

      return { categoryRange };
    },
    enabled: !!organizationId,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: SaveCategoryRangePayload) => {
      if (!organizationId || !user?.id) throw new Error('Not authenticated');
      if (!normalizedMappingLocationId) {
        throw new Error(
          'Select a location in the top bar to save category mappings. All Locations combines each location’s setup automatically in reports.'
        );
      }
      const effectivePlatformId = await resolveCoaMappingPlatformIntegrationId(organizationId, platformIntegrationId);

      let rangeDelete = supabase.from('category_range_map' as any).delete().eq('organization_id', organizationId);
      rangeDelete = effectivePlatformId ? rangeDelete.eq('platform_integration_id', effectivePlatformId) : rangeDelete.is('platform_integration_id', null);
      rangeDelete = rangeDelete.eq('mapping_location_id', normalizedMappingLocationId);
      const { error: deleteErr } = await rangeDelete;
      if (deleteErr) throw deleteErr;

      const rangeInserts: { organization_id: string; platform_integration_id: string | null; location_id: string; mapping_location_id: string | null; category_range_id: number; created_by: string }[] = [];
      CATEGORY_RANGE_KEYS.forEach((key) => {
        const categoryRangeId = CATEGORY_RANGE_IDS[key];
        (payload.categoryRange[key] || []).forEach((locationId) => {
          rangeInserts.push({
            organization_id: organizationId,
            platform_integration_id: effectivePlatformId,
            location_id: locationId,
            mapping_location_id: normalizedMappingLocationId,
            category_range_id: categoryRangeId,
            created_by: user.id,
          });
        });
      });
      if (rangeInserts.length > 0) {
        const { error: rangeErr } = await supabase.from('category_range_map' as any).insert(rangeInserts);
        if (rangeErr) throw rangeErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['category-range', organizationId, platformIntegrationId, normalizedMappingLocationId] });
    },
  });

  return {
    categoryRangeMasters: categoryRangeMasters || [],
    categoryRange: categoryRangeData?.categoryRange ?? emptyCategoryRangeVM(),
    isLoading: loadingMasters || loadingRange,
    refetchCategoryRange,
    saveCategoryRange: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
  };
}
