import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface AssociatePerformanceMetric {
  provider_id: string;
  provider_name: string;
  daily_production: number;
  planning_avg_daily_production: number;
  target_gap: number;
  performance_percent: number | null;
  rank: number;
}

interface UseAssociatePerformanceMetricsParams {
  startDate: Date;
  endDate: Date;
  organizationId: string;
  providerType?: string | null;
  locationId?: string | null;
}

export function useAssociatePerformanceMetrics({
  startDate,
  endDate,
  organizationId,
  providerType = null,
  locationId = null,
}: UseAssociatePerformanceMetricsParams) {
  return useQuery({
    queryKey: ['associate-performance-metrics', organizationId, startDate, endDate, providerType, locationId ?? 'all'],
    queryFn: async () => {
      if (!organizationId || !startDate || !endDate) {
        console.log('[useAssociatePerformanceMetrics] Missing required parameters');
        return [];
      }

      console.log(`[useAssociatePerformanceMetrics] Fetching associate performance metrics from ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);
      console.log(`[useAssociatePerformanceMetrics] Organization ID: ${organizationId}`);
      console.log(`[useAssociatePerformanceMetrics] Provider type: ${providerType || 'all'}`);

      const rpcParams: Record<string, unknown> = {
        p_start_date: format(startDate, 'yyyy-MM-dd'),
        p_end_date: format(endDate, 'yyyy-MM-dd'),
        p_organization_id: organizationId,
        p_provider_type: providerType || null,
      };
      if (locationId && locationId !== 'all') {
        rpcParams.p_location_id = locationId;
      }

      const { data, error } = await supabase.rpc('chart_get_associate_performance_metrics', rpcParams);

      if (error) {
        console.error('[useAssociatePerformanceMetrics] Error fetching associate performance metrics:', error);
        throw error;
      }

      console.log(`[useAssociatePerformanceMetrics] Found ${data?.length || 0} providers with performance data`);

      return (data || []).map(item => ({
        provider_id: item.provider_id,
        provider_name: item.provider_name,
        daily_production: typeof item.daily_production === 'number' ? item.daily_production : parseFloat(String(item.daily_production)) || 0,
        planning_avg_daily_production: typeof item.planning_avg_daily_production === 'number' ? item.planning_avg_daily_production : parseFloat(String(item.planning_avg_daily_production)) || 0,
        target_gap: typeof item.target_gap === 'number' ? item.target_gap : parseFloat(String(item.target_gap)) || 0,
        performance_percent: typeof item.performance_percent === 'number' ? item.performance_percent : parseFloat(String(item.performance_percent)) || 0,
        rank: item.rank,
      })) as AssociatePerformanceMetric[];
    },
    enabled: !!organizationId && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
