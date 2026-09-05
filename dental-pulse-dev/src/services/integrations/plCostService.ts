import { supabase } from '@/integrations/supabase/client';

/**
 * Fetches the connected accounting platform for an organization (org-level).
 * Used as a fallback for the all-locations view.
 */
async function getConnectedPlatform(organizationId: string): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from('platform_integrations')
    .select('platform_name')
    .eq('organization_id', organizationId)
    .eq('is_connected', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.platform_name as string;
}

/**
 * Resolves the mapped platform and entity ID for a specific location via
 * platform_integration_organization_mapping → platform_integration_organizations.
 *
 * Returns null if the location is unmapped.
 */
async function resolveLocationPlatform(
  locationId: string
): Promise<{ platformName: string; platformOrgId: string | null } | null> {
  const { data: mapping, error: mapErr } = await (supabase as any)
    .from('platform_integration_organization_mapping')
    .select('platform_integration_organizations_id')
    .eq('location_id', locationId)
    .limit(1)
    .maybeSingle();

  if (mapErr || !mapping) return null;

  const { data: pio, error: pioErr } = await (supabase as any)
    .from('platform_integration_organizations')
    .select('platform_name, platform_org_id')
    .eq('id', mapping.platform_integration_organizations_id)
    .maybeSingle();

  if (pioErr || !pio) return null;

  return { platformName: pio.platform_name, platformOrgId: pio.platform_org_id ?? null };
}

/**
 * Returns one representative location_id per unique accounting entity
 * (Xero tenant GUID / QuickBooks company id) for the given platform.
 *
 * Multiple practice locations often share the same Xero organisation; summing
 * op costs per location would double-count the same P&L. Deduping by
 * platform_org_id (falling back to the pio row id) prevents that.
 */
async function getUniqueEntityRepresentativeLocations(
  organizationId: string,
  platformName: 'xero' | 'quickbooks'
): Promise<string[]> {
  const { data: mappings, error: mapError } = await (supabase as any)
    .from('platform_integration_organization_mapping')
    .select('location_id, platform_integration_organizations_id')
    .eq('organization_id', organizationId);

  if (mapError || !mappings?.length) return [];

  const pioIds = [
    ...new Set(
      (mappings as Array<{ platform_integration_organizations_id: string | null }>)
        .map((m) => m.platform_integration_organizations_id)
        .filter((id): id is string => !!id)
    ),
  ];

  if (pioIds.length === 0) return [];

  const { data: pios, error: pioError } = await (supabase as any)
    .from('platform_integration_organizations')
    .select('id, platform_org_id, platform_name')
    .in('id', pioIds)
    .eq('platform_name', platformName);

  if (pioError || !pios?.length) return [];

  const seenEntities = new Set<string>();
  const representativeLocationIds: string[] = [];

  for (const pio of pios as Array<{ id: string; platform_org_id: string | null }>) {
    // Prefer the native platform id (Xero tenant GUID / QB realm); fall back to row UUID
    const uniqueKey = String(pio.platform_org_id || pio.id).trim().toLowerCase();
    if (!uniqueKey || seenEntities.has(uniqueKey)) continue;
    seenEntities.add(uniqueKey);

    const mapping = (
      mappings as Array<{ location_id: string; platform_integration_organizations_id: string }>
    ).find((m) => m.platform_integration_organizations_id === pio.id);

    if (mapping?.location_id) {
      representativeLocationIds.push(mapping.location_id);
    }
  }

  return representativeLocationIds;
}

/**
 * Fetches operational costs (Op Costs) for the given date range.
 *
 * When locationId is provided, routing is per-location platform mapping:
 *   xero    → get_xero_op_cost RPC for that location
 *   iplicit → get_iplicit_pl_amount_cost_by_date RPC with legal entity
 *   unmapped → 0
 *
 * When locationId is omitted (all-locations view), falls back to org-level
 * platform detection:
 *   xero    → sum get_xero_op_cost once per unique Xero tenant
 *   iplicit → org-wide get_iplicit_pl_amount_cost_by_date (no entity filter)
 *   quickbooks → sum get_quickbooks_op_cost once per unique QB company
 */
export async function getOpCostByPlatform(
  organizationId: string,
  startDate: string,    // YYYY-MM-DD
  endDate: string,      // YYYY-MM-DD
  accountCode: string,  // e.g. 'TC'
  locationId?: string | null
): Promise<{ amount: number | null; platform: string | null }> {

  console.log('[plCostService] getOpCostByPlatform called:', { organizationId, startDate, endDate, locationId });

  // ── Specific location: route by location's mapped platform ──────────────────
  if (locationId && locationId !== 'all') {
    const loc = await resolveLocationPlatform(locationId);
    console.log('[plCostService] resolveLocationPlatform result:', loc);

    if (!loc) {
      // Location not mapped to any platform
      return { amount: 0, platform: null };
    }

    if (loc.platformName === 'xero') {
      const { data, error } = await (supabase as any).rpc('get_xero_op_cost', {
        p_org_id:      organizationId,
        p_location_id: locationId,
        p_from_date:   startDate,
        p_to_date:     endDate,
      });

      if (error) {
        console.error('[plCostService] Xero op cost RPC error:', error);
        return { amount: null, platform: loc.platformName };
      }

      console.log('[plCostService] Xero op cost result:', { data, error });
      return { amount: Number(data ?? 0), platform: loc.platformName };
    }

    if (loc.platformName === 'iplicit') {
      const rpcParams: Record<string, unknown> = {
        p_organization_id: organizationId,
        p_start_date:      startDate,
        p_end_date:        endDate,
        p_account_code:    accountCode,
      };
      if (loc.platformOrgId) rpcParams.p_legal_entity_id = loc.platformOrgId;

      const { data, error } = await (supabase as any).rpc(
        'get_iplicit_pl_amount_cost_by_date',
        rpcParams
      );

      if (error || !data || data.length === 0 || data[0].total_amount == null) {
        return { amount: null, platform: loc.platformName };
      }

      return { amount: Math.abs(Number(data[0].total_amount)), platform: loc.platformName };
    }

    if (loc.platformName === 'quickbooks') {
      const { data, error } = await (supabase as any).rpc('get_quickbooks_op_cost', {
        p_org_id:      organizationId,
        p_location_id: locationId,
        p_from_date:   startDate,
        p_to_date:     endDate,
      });

      if (error) {
        console.error('[plCostService] QuickBooks op cost RPC error:', error);
        return { amount: null, platform: loc.platformName };
      }

      return { amount: Number(data ?? 0), platform: loc.platformName };
    }

    // Unknown platform
    return { amount: 0, platform: loc.platformName };
  }

  // ── All-locations view: use org-level platform detection ────────────────────
  const platform = await getConnectedPlatform(organizationId);
  if (!platform) return { amount: null, platform: null };

  switch (platform) {
    case 'iplicit': {
      const { data, error } = await (supabase as any).rpc(
        'get_iplicit_pl_amount_cost_by_date',
        {
          p_organization_id: organizationId,
          p_start_date:      startDate,
          p_end_date:        endDate,
          p_account_code:    accountCode,
        }
      );

      if (error || !data || data.length === 0 || data[0].total_amount == null) {
        return { amount: null, platform };
      }

      return { amount: Math.abs(Number(data[0].total_amount)), platform };
    }

    case 'xero': {
      // Sum once per unique Xero tenant — locations sharing a tenant must not
      // double-count the same P&L (e.g. Hungford + Queens Street → same Xero id).
      const locationIds = await getUniqueEntityRepresentativeLocations(organizationId, 'xero');
      console.log('[plCostService] Xero all-locations unique tenants:', locationIds.length, locationIds);

      if (locationIds.length === 0) return { amount: 0, platform };

      const costs = await Promise.all(
        locationIds.map(async (locId) => {
          const { data, error } = await (supabase as any).rpc('get_xero_op_cost', {
            p_org_id:      organizationId,
            p_location_id: locId,
            p_from_date:   startDate,
            p_to_date:     endDate,
          });
          return error ? 0 : Number(data ?? 0);
        })
      );

      const amount = costs.reduce((sum, c) => sum + c, 0);
      console.log('[plCostService] Xero all-locations op cost (deduped):', amount);
      return { amount, platform };
    }

    case 'quickbooks': {
      // Same dedupe as Xero: one cost per unique QuickBooks company.
      const locationIds = await getUniqueEntityRepresentativeLocations(organizationId, 'quickbooks');
      console.log('[plCostService] QuickBooks all-locations unique companies:', locationIds.length);

      if (locationIds.length === 0) return { amount: 0, platform };

      const costs = await Promise.all(
        locationIds.map(async (locId) => {
          const { data, error } = await (supabase as any).rpc('get_quickbooks_op_cost', {
            p_org_id:      organizationId,
            p_location_id: locId,
            p_from_date:   startDate,
            p_to_date:     endDate,
          });
          return error ? 0 : Number(data ?? 0);
        })
      );

      return { amount: costs.reduce((sum, c) => sum + c, 0), platform };
    }

    default:
      console.warn(`[plCostService] Unknown platform: ${platform}`);
      return { amount: null, platform };
  }
}
