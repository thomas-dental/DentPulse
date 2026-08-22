import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface ProfitMetric {
  provider_id: string;
  provider_name: string;
  periodic_profit: number;
  pl_per_day: number;
  profit_percent: number;
  rank: number;
}

interface UseProfitMetricsParams {
  startDate: Date;
  endDate: Date;
  organizationId: string;
  providerType?: string | null;
  locationId?: string | null;
}

export function useProfitMetrics({
  startDate,
  endDate,
  organizationId,
  providerType = null,
  locationId = null,
}: UseProfitMetricsParams) {
  return useQuery({
    queryKey: ['profit-metrics', organizationId, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'), providerType, locationId ?? 'all'],
    queryFn: async () => {
      if (!organizationId || !startDate || !endDate) {
        console.log('[useProfitMetrics] Missing required parameters');
        return [];
      }

      console.log(`[useProfitMetrics] Fetching profit metrics from ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);
      console.log(`[useProfitMetrics] Organization ID: ${organizationId}`);
      console.log(`[useProfitMetrics] Provider type: ${providerType || 'all'}`);

      const rpcParams: Record<string, unknown> = {
        p_start_date: format(startDate, 'yyyy-MM-dd'),
        p_end_date: format(endDate, 'yyyy-MM-dd'),
        p_organization_id: organizationId,
        p_provider_type: providerType || null,
      };
      if (locationId && locationId !== 'all') {
        rpcParams.p_location_id = locationId;
      }

      const { data, error } = await supabase.rpc('chart_get_profit_metrics', rpcParams);

      if (error) {
        console.error('[useProfitMetrics] Error fetching profit metrics:', error);
        throw error;
      }

      console.log(`[useProfitMetrics] Found ${data?.length || 0} providers with profit data`);

      return (data || []).map(item => ({
        provider_id: item.provider_id,
        provider_name: item.provider_name,
        periodic_profit: typeof item.periodic_profit === 'number' ? item.periodic_profit : parseFloat(String(item.periodic_profit)) || 0,
        pl_per_day: typeof item.pl_per_day === 'number' ? item.pl_per_day : parseFloat(String(item.pl_per_day)) || 0,
        profit_percent: typeof item.profit_percent === 'number' ? item.profit_percent : parseFloat(String(item.profit_percent)) || 0,
        rank: item.rank,
      })) as ProfitMetric[];
    },
    enabled: !!organizationId && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
