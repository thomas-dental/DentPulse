import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

export const ORGANIZATION_DISPLAY_SETTINGS_QUERY_KEY = 'organization-display-settings';

/** Read-only display preferences from organization_settings (Settings → General → Display Preferences owns writing these). */
export function useOrganizationSettings() {
  const { organizationId } = useOrganization();

  const { data, isLoading, refetch } = useQuery({
    queryKey: [ORGANIZATION_DISPLAY_SETTINGS_QUERY_KEY, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('show_decimals')
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (error) throw error;
      return {
        showDecimals: data?.show_decimals ?? false,
      };
    },
    enabled: !!organizationId,
  });

  return {
    showDecimals: data?.showDecimals ?? false,
    isLoading,
    refetch,
  };
}
