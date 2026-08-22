import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useLocations } from './useLocations';

export interface MonthlyChairTrendRow {
  month_start: string;
  month_label: string;
  appointment_hours: number;
  treatment_hours: number;
  appointment_count: number;
  available_hours: number;
  occupancy_pct: number;
  utilisation_pct: number;
}

interface UseMonthlyChairTrendsOptions {
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

export function useMonthlyChairTrends({ startDate, endDate, locationId }: UseMonthlyChairTrendsOptions) {
  const { user } = useAuth();
  const { organizationId } = useLocations();

  return useQuery({
    queryKey: [
      'monthly_chair_trends',
      organizationId,
      locationId,
      toDateStr(startDate),
      toDateStr(endDate),
    ],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await (supabase as any).rpc('get_monthly_chair_trends', {
        _organization_id: organizationId,
        _location_id: locationId || null,
        _start_date: toDateStr(startDate),
        _end_date: toDateStr(endDate),
      });

      if (error) {
        console.error('[useMonthlyChairTrends] RPC error:', error);
        throw error;
      }
      console.log('[useMonthlyChairTrends] RPC returned:', data?.length, 'rows');
      return (data || []) as MonthlyChairTrendRow[];
    },
    enabled: !!user?.id && !!organizationId,
  });
}
