import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useLocations } from './useLocations';

export interface WeeklyChairPatternRow {
  day_of_week: number;
  day_name: string;
  appointment_hours: number;
  treatment_hours: number;
  appointment_count: number;
  available_hours: number;
  occupancy_pct: number;
  utilisation_pct: number;
}

interface UseWeeklyChairPatternOptions {
  startDate: Date;
  endDate: Date;
  locationId: string | null;
}

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useWeeklyChairPattern({ startDate, endDate, locationId }: UseWeeklyChairPatternOptions) {
  const { user } = useAuth();
  const { organizationId } = useLocations();

  return useQuery({
    queryKey: [
      'weekly_chair_pattern',
      organizationId,
      locationId,
      toDateStr(startDate),
      toDateStr(endDate),
    ],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await (supabase as any).rpc('get_weekly_chair_pattern', {
        _organization_id: organizationId,
        _location_id: locationId || null,
        _start_date: toDateStr(startDate),
        _end_date: toDateStr(endDate),
      });

      if (error) {
        console.error('[useWeeklyChairPattern] RPC error:', error);
        throw error;
      }
      console.log('[useWeeklyChairPattern] RPC returned:', data?.length, 'rows');
      return (data || []) as WeeklyChairPatternRow[];
    },
    enabled: !!user?.id && !!organizationId,
  });
}
