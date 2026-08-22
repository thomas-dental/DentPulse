import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useAuth } from './useAuth';
import type { CategoryWishListVM } from '@/types/setup-categories';

function emptyWishList(): CategoryWishListVM {
  return {
    PeopleSalaries: [],
    PerformersProductsBoughtToSold: [],
    Marketing: [],
    DebtAsAPer: [],
    Premises: [],
    OneOffExpense: [],
    Advertise: [],
  };
}

type CategoryWishListRow = {
  location_id: string;
  category_wish_list_master_id: number;
  mapping_location_id?: string | null;
};

export function useCategoryWishList(platformIntegrationId: string | null, mappingLocationId?: string | null) {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const normalizedMappingLocationId = mappingLocationId && mappingLocationId !== 'all' ? mappingLocationId : null;

  const { data: masters, isLoading: loadingMasters } = useQuery({
    queryKey: ['category-wish-list-master'],
    queryFn: async () => {
      const q: any = await supabase
        .from('category_wish_list_master' as any)
        .select('*')
        .eq('sector_id', 10)
        .order('range_order', { ascending: true });
      if (q.error) throw q.error;
      return (q.data || []) as any[];
    },
  });

  const { data: wishListData, isLoading: loadingData, refetch } = useQuery({
    queryKey: ['category-wish-list', organizationId, platformIntegrationId, normalizedMappingLocationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const platformId = platformIntegrationId || undefined;

      const res: any = normalizedMappingLocationId
        ? await (async () => {
            let q = supabase
              .from('category_wish_list' as any)
              .select('location_id, category_wish_list_master_id, mapping_location_id')
              .eq('organization_id', organizationId)
              .eq('mapping_location_id', normalizedMappingLocationId);
            if (platformId) q = q.eq('platform_integration_id', platformId);
            else q = q.is('platform_integration_id', null);
            return q;
          })()
        : await supabase
            .from('category_wish_list' as any)
            .select('location_id, category_wish_list_master_id, mapping_location_id')
            .eq('organization_id', organizationId)
            .not('mapping_location_id', 'is', null);

      if (res.error) throw res.error;

      const grouped: Record<number, string[]> = {};
      const rows = (res.data || []) as CategoryWishListRow[];
      rows.forEach((row) => {
        const id = Number(row.category_wish_list_master_id);
        if (!grouped[id]) grouped[id] = [];
        grouped[id].push(row.location_id);
      });
      Object.keys(grouped).forEach((id) => {
        grouped[Number(id)] = [...new Set(grouped[Number(id)])];
      });

      const vm: CategoryWishListVM = emptyWishList();
      (masters || []).forEach((m: any) => {
        // try to map by master name keys falling back to master id mapping
        const key = (m.name || '').replace(/\s+/g, '') as keyof CategoryWishListVM;
        if (key && vm[key]) vm[key] = grouped[m.id] || [];
      });

      // If names don't match keys (older setups), fall back to filling by id mapping
      // (this keeps it simple for now)

      return { groups: grouped };
    },
    enabled: !!organizationId,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: { groups: Record<number, string[]> }) => {
      if (!organizationId || !user?.id) throw new Error('Not authenticated');
      if (!normalizedMappingLocationId) {
        throw new Error(
          'Select a location in the top bar to save wishlist mappings. All Locations combines each location’s setup automatically in reports.'
        );
      }
      const platformId = platformIntegrationId || undefined;

      // delete existing for org + platform + location
      let del = supabase.from('category_wish_list' as any).delete().eq('organization_id', organizationId);
      del = platformId ? del.eq('platform_integration_id', platformId) : del.is('platform_integration_id', null);
      del = del.eq('mapping_location_id', normalizedMappingLocationId);
      const { error: deleteErr } = await del;
      if (deleteErr) throw deleteErr;

      // build inserts
      const inserts: { organization_id: string; platform_integration_id: string | null; location_id: string; mapping_location_id: string | null; category_wish_list_master_id: number; created_by: string }[] = [];
      Object.entries(payload.groups).forEach(([masterIdStr, locations]) => {
        const masterId = Number(masterIdStr);
        (locations || []).forEach((loc) => {
          inserts.push({
            organization_id: organizationId,
            platform_integration_id: platformId,
            location_id: loc,
            mapping_location_id: normalizedMappingLocationId,
            category_wish_list_master_id: masterId,
            created_by: user.id,
          });
        });
      });

      if (inserts.length > 0) {
        const { error } = await supabase.from('category_wish_list' as any).insert(inserts);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['category-wish-list', organizationId, platformIntegrationId, normalizedMappingLocationId] });
    },
  });

  return {
    masters: masters || [],
    wishListGroups: wishListData?.groups ?? {},
    isLoading: loadingMasters || loadingData,
    refetch,
    saveCategoryWishList: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
  };
}
