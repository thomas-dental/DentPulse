import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface ModuleAccessRow {
  organization_id: string | null;
  module_key: string;
  enabled: boolean;
}

/**
 * Org-wide module enable/disable, managed from the DentPulse SuperAdmin panel
 * (organization_module_access table).
 *
 * Resolution for a module: the current org's override wins; otherwise the
 * system default row (organization_id IS NULL); otherwise enabled.
 *
 * This gate is independent of RBAC and applies to EVERYONE — including owners.
 * If the table is missing or RLS blocks the read, it fails OPEN (all modules
 * enabled) so the app never locks itself out.
 */
export function useModuleAccess() {
  const { profile } = useAuth();
  const orgId = profile?.current_organization_id ?? null;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['module_access', orgId],
    queryFn: async () => {
      // Cast to `any`: this table isn't in the generated Supabase types yet
      // (regenerate types after applying the migration to drop the cast).
      let query = (supabase as any)
        .from('organization_module_access')
        .select('organization_id, module_key, enabled');

      // Default (NULL) rows + this org's rows.
      query = orgId
        ? query.or(`organization_id.is.null,organization_id.eq.${orgId}`)
        : query.is('organization_id', null);

      const { data, error } = await query;
      if (error) {
        // Table absent / RLS blocked / transient error — fail open.
        return [] as ModuleAccessRow[];
      }
      return (data ?? []) as ModuleAccessRow[];
    },
    // Module access changes rarely; refresh within a minute so SuperAdmin edits
    // show up without a hard reload.
    staleTime: 60 * 1000,
  });

  const { defaults, overrides } = useMemo(() => {
    const defaults: Record<string, boolean> = {};
    const overrides: Record<string, boolean> = {};
    for (const row of rows) {
      if (row.organization_id === null) defaults[row.module_key] = !!row.enabled;
      else overrides[row.module_key] = !!row.enabled;
    }
    return { defaults, overrides };
  }, [rows]);

  const isModuleEnabled = useCallback(
    (moduleKey: string): boolean => {
      if (orgId && moduleKey in overrides) return overrides[moduleKey];
      if (moduleKey in defaults) return defaults[moduleKey];
      return true; // no row anywhere → enabled by default
    },
    [defaults, overrides, orgId],
  );

  return { isModuleEnabled, loading: isLoading };
}
