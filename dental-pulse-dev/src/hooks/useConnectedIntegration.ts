import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOptionalFilters } from '@/contexts/FilterContext';

type PlatformName = 'xero' | 'quickbooks' | 'iplicit' | 'sage';

const ACCOUNTING_PLATFORMS: PlatformName[] = ['xero', 'quickbooks', 'iplicit', 'sage'];

// Resolve the accounting platform actually mapped to a specific location via
// Practice Location Mapping. Orgs can connect several platforms at once
// (e.g. Xero + QuickBooks + Sage); without this, the org-level "first connected"
// guess could pick a platform the selected location doesn't use, so its cost
// pages looked up the wrong CoA table and rendered £0. Returns null when the
// location has no accounting mapping (caller then falls back to org-level).
async function resolveLocationPlatform(
  organizationId: string,
  locationId: string,
): Promise<{ platform: PlatformName; connectionId: string } | null> {
  const { data: mapRows } = await (supabase as any)
    .from('platform_integration_organization_mapping')
    .select('platform_integration_organizations_id')
    .eq('location_id', locationId);

  const tenantIds = [...new Set(
    (mapRows || [])
      .map((r: any) => r.platform_integration_organizations_id)
      .filter(Boolean),
  )];
  if (tenantIds.length === 0) return null;

  const { data: orgRows } = await (supabase as any)
    .from('platform_integration_organizations')
    .select('platform_name, platform_integration_id')
    .in('id', tenantIds);

  const candidates = (orgRows || []).filter((r: any) =>
    ACCOUNTING_PLATFORMS.includes((r.platform_name || '').toLowerCase() as PlatformName),
  );
  if (candidates.length === 0) return null;

  // Prefer mappings whose underlying integration is currently connected.
  const integrationIds = [...new Set(candidates.map((c: any) => c.platform_integration_id).filter(Boolean))];
  let pool = candidates;
  if (integrationIds.length > 0) {
    const { data: integ } = await (supabase as any)
      .from('platform_integrations')
      .select('id, is_connected')
      .in('id', integrationIds);
    const connectedIds = new Set((integ || []).filter((i: any) => i.is_connected).map((i: any) => i.id));
    const connected = candidates.filter((c: any) => connectedIds.has(c.platform_integration_id));
    if (connected.length > 0) pool = connected;
  }

  // Deterministic pick when a location maps to more than one platform.
  for (const platform of ACCOUNTING_PLATFORMS) {
    const match = pool.find((c: any) => (c.platform_name || '').toLowerCase() === platform);
    if (match) return { platform, connectionId: match.platform_integration_id };
  }
  return null;
}

const DISPLAY_NAMES: Record<PlatformName, string> = {
  xero: 'Xero',
  quickbooks: 'QuickBooks',
  iplicit: 'iplicit',
  sage: 'Sage',
};

interface UseConnectedIntegrationReturn {
  connectedPlatform: PlatformName | null;
  connectionId: string | null;
  displayName: string;
  isLoading: boolean;
  isConnected: boolean;
}

export function useConnectedIntegration(): UseConnectedIntegrationReturn {
  const { profile } = useAuth();
  // Read the globally selected location (if inside a FilterProvider) so the
  // resolved platform matches the location the user is actually looking at.
  const filters = useOptionalFilters();
  const selectedLocationId = filters?.selectedLocationId ?? null;
  const [connectedPlatform, setConnectedPlatform] = useState<PlatformName | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchConnectedPlatform() {
      if (!profile?.current_organization_id) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        // 1. Location-aware: if a specific location is selected, use the
        //    platform mapped to THAT location (correct for multi-platform orgs).
        if (selectedLocationId) {
          const loc = await resolveLocationPlatform(profile.current_organization_id, selectedLocationId);
          if (loc) {
            setConnectedPlatform(loc.platform);
            setConnectionId(loc.connectionId);
            return;
          }
        }

        // 2. Fallback: first connected accounting platform for the org.
        const { data, error } = await (supabase as any)
          .from('platform_integrations')
          .select('id, platform_name')
          .eq('organization_id', profile.current_organization_id)
          .eq('is_connected', true);

        if (error) {
          console.error('[useConnectedIntegration] Error:', error);
          return;
        }

        const accountingRow = (data || []).find(
          (row: { id: string; platform_name: string }) =>
            ACCOUNTING_PLATFORMS.includes((row.platform_name || '').toLowerCase() as PlatformName)
        );

        setConnectedPlatform(accountingRow ? ((accountingRow.platform_name || '').toLowerCase() as PlatformName) : null);
        setConnectionId(accountingRow ? accountingRow.id : null);
      } catch (err) {
        console.error('[useConnectedIntegration] Error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchConnectedPlatform();
  }, [profile?.current_organization_id, selectedLocationId]);

  return {
    connectedPlatform,
    connectionId,
    displayName: connectedPlatform ? DISPLAY_NAMES[connectedPlatform] : 'Accounting',
    isLoading,
    isConnected: connectedPlatform !== null,
  };
}
