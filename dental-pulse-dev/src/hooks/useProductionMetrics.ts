import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { format } from 'date-fns';

export interface ProductionMetric {
  provider_id: string;
  provider_name: string;
  production_amount: number;
  days_worked: number; // Decimal value: (appointment hours / 8)
  avg_daily_production: number;
  rank: number;
}

/**
 * Fetches production metrics for all providers
 * Calls get_production_metrics stored procedure
 * Returns provider production data with rankings
 *
 * Production calculation matches Profit Goals Settings:
 * - Total Production = Sum of completed treatment plan item prices within date range
 * - Working Hours = Sum of appointment durations (in hours) for completed appointments
 * - Working Days = each month's Working Hours ÷ that provider's configured
 *   Working Hours Per Day (Providers → Working Hours dialog), falling back to
 *   the organization's Open Hours Per Day setting, then to 8 — summed across
 *   the date range
 * - Avg Daily Production = Total Production ÷ Working Days
 */
export function useProductionMetrics(
  startDate: Date,
  endDate: Date,
  providerType?: string | null,
  locationId?: string | null
) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [
      'production-metrics-v4',
      organizationId,
      format(startDate, 'yyyy-MM-dd'),
      format(endDate, 'yyyy-MM-dd'),
      providerType || 'all',
      locationId ?? 'all',
    ],
    queryFn: async (): Promise<ProductionMetric[]> => {
      if (!organizationId) {
        return [];
      }

      console.log(`[useProductionMetrics] Fetching production metrics from ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);
      console.log(`[useProductionMetrics] Organization ID: ${organizationId}`);
      console.log(`[useProductionMetrics] Provider type: ${providerType || 'all'}`);

      const rpcParams: Record<string, unknown> = {
        p_start_date: format(startDate, 'yyyy-MM-dd'),
        p_end_date: format(endDate, 'yyyy-MM-dd'),
        p_organization_id: organizationId,
        p_provider_type: providerType || null,
      };
      if (locationId && locationId !== 'all') {
        rpcParams.p_location_id = locationId;
      }

      const { data, error } = await supabase.rpc('chart_get_production_metrics', rpcParams);

      if (error) {
        console.error('[useProductionMetrics] Error fetching production metrics:', error);
        throw error;
      }

      console.log(`[useProductionMetrics] Found ${data?.length || 0} providers with production data`);

      return (data || []).map(item => ({
        provider_id: item.provider_id,
        provider_name: item.provider_name,
        production_amount: typeof item.production_amount === 'number'
          ? item.production_amount
          : parseFloat(String(item.production_amount)) || 0,
        days_worked: typeof item.days_worked === 'number'
          ? item.days_worked
          : parseFloat(String(item.days_worked)) || 0,
        avg_daily_production: typeof item.avg_daily_production === 'number'
          ? item.avg_daily_production
          : parseFloat(String(item.avg_daily_production)) || 0,
        rank: typeof item.rank === 'number'
          ? item.rank
          : parseInt(String(item.rank)) || 0,
      })) as ProductionMetric[];
    },
    enabled: !!organizationId,
  });
}
