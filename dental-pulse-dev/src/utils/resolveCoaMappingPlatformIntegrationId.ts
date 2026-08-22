import { supabase } from '@/integrations/supabase/client';

/**
 * Resolves which platform_integration_id to use for org-scoped COA mappings
 * (category_range_map, group_account, etc.). Must match save mutations: when
 * the page has no explicit integration id, fall back to the first legacy COA
 * row so reads see the same rows that writes persist.
 */
export async function resolveCoaMappingPlatformIntegrationId(
  organizationId: string,
  preferred: string | null
): Promise<string | null> {
  if (preferred) return preferred;
  const { data, error } = await supabase
    .from('platform_integration_chart_of_accounts' as any)
    .select('platform_integration_id')
    .eq('organization_id', organizationId)
    .not('platform_integration_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { platform_integration_id?: string | null } | null)?.platform_integration_id ?? null;
}
