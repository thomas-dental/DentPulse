import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface XeroTrackingCategory {
  id: string;
  platform_integration_organizations_id: string;
  xero_tracking_category_id: string;
  name: string;
  status: string | null;
}

export interface XeroTrackingOption {
  id: string;
  platform_integration_organizations_id: string;
  xero_tracking_category_id: string;
  xero_tracking_option_id: string;
  name: string;
  status: string | null;
}

/**
 * Loads synced Xero Tracking Categories + Options for an org (all tenants).
 */
export function useXeroTrackingCatalog(organizationId: string | undefined | null, enabled = true) {
  return useQuery({
    queryKey: ['xero-tracking-catalog', organizationId],
    enabled: !!organizationId && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<{
      categories: XeroTrackingCategory[];
      options: XeroTrackingOption[];
    }> => {
      if (!organizationId) return { categories: [], options: [] };

      const [{ data: categories, error: catErr }, { data: options, error: optErr }] =
        await Promise.all([
          (supabase as any)
            .from('xero_tracking_categories')
            .select(
              'id, platform_integration_organizations_id, xero_tracking_category_id, name, status',
            )
            .eq('organization_id', organizationId)
            .neq('status', 'DELETED')
            .order('name'),
          (supabase as any)
            .from('xero_tracking_options')
            .select(
              'id, platform_integration_organizations_id, xero_tracking_category_id, xero_tracking_option_id, name, status',
            )
            .eq('organization_id', organizationId)
            .neq('status', 'DELETED')
            .order('name'),
        ]);

      if (catErr) throw catErr;
      if (optErr) throw optErr;

      return {
        categories: (categories || []) as XeroTrackingCategory[],
        options: (options || []) as XeroTrackingOption[],
      };
    },
  });
}
