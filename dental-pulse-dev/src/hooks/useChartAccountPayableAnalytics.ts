/**
 * useChartAccountPayableAnalytics Hook
 * Fetches Accounts Payable analytics data from stored procedure
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { format } from 'date-fns';

export interface ChartAccountPayableData {
  month_year: string;
  month_name: string;
  invoice_count: number;
  total_amount: number;
}

/**
 * Fetches monthly invoice volume for Accounts Payable analytics
 * Calls chart_account_payable_analytics stored procedure
 *
 * @param startDate - Start date for the date range
 * @param endDate - End date for the date range
 * @param enabled - Whether to enable the query (default: true)
 */
export function useChartAccountPayableAnalytics(startDate: Date, endDate: Date, enabled: boolean = true) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [
      'chart-account-payable-analytics',
      organizationId,
      format(startDate, 'yyyy-MM-dd'),
      format(endDate, 'yyyy-MM-dd'),
    ],
    queryFn: async (): Promise<ChartAccountPayableData[]> => {
      if (!organizationId) {
        return [];
      }

      console.log(`[useChartAccountPayableAnalytics] Fetching data from ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);

      const { data, error } = await supabase.rpc('chart_account_payable_analytics', {
        p_start_date: format(startDate, 'yyyy-MM-dd'),
        p_end_date: format(endDate, 'yyyy-MM-dd'),
        p_organization_id: organizationId,
      });

      if (error) {
        console.error('[useChartAccountPayableAnalytics] Error:', error);
        throw error;
      }

      console.log(`[useChartAccountPayableAnalytics] Found ${data?.length || 0} months with data`);

      return (data || []).map(item => ({
        month_year: item.month_year,
        month_name: item.month_name,
        invoice_count: typeof item.invoice_count === 'number'
          ? item.invoice_count
          : parseInt(String(item.invoice_count)) || 0,
        total_amount: typeof item.total_amount === 'number'
          ? item.total_amount
          : parseFloat(String(item.total_amount)) || 0,
      }));
    },
    enabled: !!organizationId && enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
