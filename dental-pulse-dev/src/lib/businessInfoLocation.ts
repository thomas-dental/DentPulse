import { supabase } from '@/integrations/supabase/client';

/**
 * Business Settings (weeks open/year, surgeries count, target profit %, etc.)
 * now live per-location on `practice_locations` rather than org-wide. Aggregate
 * views (profit planning across many providers) scope by the top-bar location
 * filter when one is active; with "All Locations" selected there's no single
 * location to read from, so this falls back to the org's primary location
 * (or its oldest location if none is marked primary).
 */
export async function resolveBusinessInfoLocationId(
  organizationId: string,
  selectedLocationId: string | null | undefined,
): Promise<string | null> {
  if (selectedLocationId && selectedLocationId !== 'all') {
    return selectedLocationId;
  }

  const { data: primaryLocation } = await (supabase as any)
    .from('practice_locations')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_primary', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (primaryLocation?.id) return primaryLocation.id;

  const { data: oldestLocation } = await (supabase as any)
    .from('practice_locations')
    .select('id')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return oldestLocation?.id || null;
}
