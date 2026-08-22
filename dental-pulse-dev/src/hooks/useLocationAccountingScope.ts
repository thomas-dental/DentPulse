import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LocationAccountingScope {
  /** OAuth / connection row for the location's accounting software */
  platformIntegrationId: string | null;
  /** External tenant ids (platform_integration_organizations.platform_org_id) */
  tenantOrgIds: string[];
  /** Internal PIO row ids (platform_integration_organizations.id) */
  platformOrgRowIds: string[];
  /** Xero TrackingCategoryID when location is split within a shared tenant */
  xeroTrackingCategoryId: string | null;
  /** Xero TrackingOptionID when location is split within a shared tenant */
  xeroTrackingOptionId: string | null;
  /** Location flagged to sync but hide from financial UI */
  excludeFromFinancialDisplay: boolean;
  hasMapping: boolean;
}

const EMPTY_SCOPE: LocationAccountingScope = {
  platformIntegrationId: null,
  tenantOrgIds: [],
  platformOrgRowIds: [],
  xeroTrackingCategoryId: null,
  xeroTrackingOptionId: null,
  excludeFromFinancialDisplay: false,
  hasMapping: false,
};

type MappingRow = {
  platform_integration_id: string;
  platform_integration_organizations_id: string;
  xero_tracking_category_id?: string | null;
  xero_tracking_option_id?: string | null;
  platform_integration_organizations?: {
    platform_name?: string | null;
    platform_org_id?: string | null;
  } | null;
};

/**
 * Resolves which accounting integration + tenant(s) + optional Xero tracking
 * option belong to a practice location.
 */
export function useLocationAccountingScope(
  organizationId: string | undefined,
  locationId: string | null | undefined
) {
  const normalizedLocationId =
    locationId && locationId !== 'all' ? locationId : null;

  const { data, isLoading } = useQuery({
    queryKey: ['location-accounting-scope', organizationId, normalizedLocationId],
    enabled: !!organizationId && !!normalizedLocationId,
    queryFn: async (): Promise<LocationAccountingScope> => {
      if (!organizationId || !normalizedLocationId) return EMPTY_SCOPE;

      const [{ data: mappingRows, error }, { data: locationRow }] = await Promise.all([
        supabase
          .from('platform_integration_organization_mapping' as any)
          .select(
            `
            platform_integration_id,
            platform_integration_organizations_id,
            xero_tracking_category_id,
            xero_tracking_option_id,
            platform_integration_organizations (
              platform_name,
              platform_org_id
            )
          `
          )
          .eq('organization_id', organizationId)
          .eq('location_id', normalizedLocationId),
        (supabase as any)
          .from('practice_locations')
          .select('exclude_from_financial_display')
          .eq('id', normalizedLocationId)
          .maybeSingle(),
      ]);

      if (error) throw error;

      const rows = (mappingRows || []) as MappingRow[];
      const excludeFromFinancialDisplay = !!locationRow?.exclude_from_financial_display;

      if (rows.length === 0) {
        return { ...EMPTY_SCOPE, excludeFromFinancialDisplay, hasMapping: false };
      }

      const platformName = (row: MappingRow) =>
        String(row.platform_integration_organizations?.platform_name || '').toLowerCase();

      const preferred =
        rows.find((r) => platformName(r) === 'iplicit') ||
        rows.find((r) => platformName(r) === 'xero') ||
        rows.find((r) => platformName(r) === 'quickbooks') ||
        rows.find((r) => platformName(r) === 'sage') ||
        rows[0];

      const tenantOrgIds = Array.from(
        new Set(
          rows
            .map((r) => r.platform_integration_organizations?.platform_org_id)
            .filter((id): id is string => !!id)
        )
      );

      const platformOrgRowIds = Array.from(
        new Set(
          rows
            .map((r) => r.platform_integration_organizations_id)
            .filter((id): id is string => !!id)
        )
      );

      const xeroRow = rows.find((r) => platformName(r) === 'xero') || preferred;

      return {
        platformIntegrationId: preferred?.platform_integration_id ?? null,
        tenantOrgIds,
        platformOrgRowIds,
        xeroTrackingCategoryId: xeroRow?.xero_tracking_category_id || null,
        xeroTrackingOptionId: xeroRow?.xero_tracking_option_id || null,
        excludeFromFinancialDisplay,
        hasMapping: true,
      };
    },
  });

  if (!normalizedLocationId) {
    return { scope: EMPTY_SCOPE, isLoading: false };
  }

  return {
    scope: data ?? EMPTY_SCOPE,
    isLoading,
  };
}
