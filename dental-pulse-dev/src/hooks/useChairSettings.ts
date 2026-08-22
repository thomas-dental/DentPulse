import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useLocations } from './useLocations';
import { toast } from 'sonner';

export interface ChairSettings {
  id: string;
  organization_id: string;
  location_id: string;
  number_of_chairs: number;
  clinic_opening_hours_per_day: number;
  clinic_working_weeks_per_year: number;
  clinic_working_days_per_year: number;
  clinic_working_days_per_week: number;
  industry_benchmark_occupancy: number | null;
  benchmark_revenue_per_chair_per_hour: number;
}

export type ChairSettingsInput = Omit<ChairSettings, 'id' | 'organization_id'>;

export const CHAIR_SETTINGS_DEFAULTS = {
  number_of_chairs: 3,
  clinic_opening_hours_per_day: 8,
  clinic_working_weeks_per_year: 46,
  clinic_working_days_per_year: 230,
  clinic_working_days_per_week: 5,
  industry_benchmark_occupancy: null as number | null,
  benchmark_revenue_per_chair_per_hour: 300,
};

export function useChairSettings() {
  const { user } = useAuth();
  const { organizationId } = useLocations();
  const queryClient = useQueryClient();

  // Fetch all chair settings for the organization (all locations)
  const { data: allSettings = [], isLoading } = useQuery({
    queryKey: ['chair_settings', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await (supabase as any)
        .from('chair_settings')
        .select('*')
        .eq('organization_id', organizationId);

      if (error) {
        console.error('[useChairSettings] fetch error:', error);
        throw error;
      }
      console.log('[useChairSettings] fetched:', data?.length, 'rows', data);
      return (data || []) as ChairSettings[];
    },
    enabled: !!user?.id && !!organizationId,
  });

  // Get settings for a specific location (returns saved or null)
  const getSettingsForLocation = (locationId: string): ChairSettings | null => {
    return allSettings.find(s => s.location_id === locationId) || null;
  };

  // Save settings for a specific location
  const saveMutation = useMutation({
    mutationFn: async (input: ChairSettingsInput) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      const { data, error } = await (supabase as any)
        .from('chair_settings')
        .upsert(
          {
            organization_id: organizationId,
            location_id: input.location_id,
            number_of_chairs: input.number_of_chairs,
            clinic_opening_hours_per_day: input.clinic_opening_hours_per_day,
            clinic_working_weeks_per_year: input.clinic_working_weeks_per_year,
            clinic_working_days_per_year: input.clinic_working_days_per_year,
            clinic_working_days_per_week: input.clinic_working_days_per_week,
            industry_benchmark_occupancy: input.industry_benchmark_occupancy,
            benchmark_revenue_per_chair_per_hour: input.benchmark_revenue_per_chair_per_hour,
            updated_by: user.id,
            created_by: user.id,
          },
          { onConflict: 'organization_id,location_id' }
        )
        .select()
        .single();

      if (error) throw error;
      return data as ChairSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chair_settings', organizationId] });
      toast.success('Chair settings saved successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save chair settings: ${error.message}`);
    },
  });

  return {
    allSettings,
    getSettingsForLocation,
    isLoading,
    saveSettings: saveMutation.mutate,
    isSaving: saveMutation.isPending,
  };
}
