import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useLocations } from './useLocations';

export interface HourlyChairMetric {
  hour_slot: number;
  hour_label: string;
  appointment_minutes: number;
  total_appointments: number;
  capacity_minutes: number;
  utilisation_pct: number;
}

interface UseHourlyChairMetricsOptions {
  startDate: Date;
  endDate: Date;
  locationId: string | null; // null = all locations
}

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useHourlyChairMetrics({ startDate, endDate, locationId }: UseHourlyChairMetricsOptions) {
  const { user } = useAuth();
  const { organizationId } = useLocations();

  return useQuery({
    queryKey: [
      'hourly_chair_metrics',
      organizationId,
      locationId,
      toDateStr(startDate),
      toDateStr(endDate),
    ],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await (supabase as any).rpc('get_hourly_chair_utilisation', {
        _organization_id: organizationId,
        _location_id: locationId || null,
        _start_date: toDateStr(startDate),
        _end_date: toDateStr(endDate),
      });

      if (error) {
        console.error('[useHourlyChairMetrics] RPC error:', error);
        throw error;
      }
      console.log('[useHourlyChairMetrics] RPC returned:', data?.length, 'rows');
      return (data || []) as HourlyChairMetric[];
    },
    enabled: !!user?.id && !!organizationId,
  });
}
