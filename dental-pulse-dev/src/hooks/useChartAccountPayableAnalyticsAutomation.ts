/**
 * useChartAccountPayableAnalyticsAutomation Hook
 * Fetches automation progress data (manual vs email invoices) from stored procedure
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { format } from 'date-fns';

export interface ChartAccountPayableAutomationData {
  month_year: string;
  month_name: string;
  manual_count: number;
  email_count: number;
  total_count: number;
}

/**
 * Fetches monthly automation progress for Accounts Payable
 * Calls chart_account_payable_automation stored procedure
 *
 * @param startDate - Start date for the date range
 * @param endDate - End date for the date range
 * @param enabled - Whether to enable the query (default: true)
 */
export function useChartAccountPayableAnalyticsAutomation(startDate: Date, endDate: Date, enabled: boolean = true) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [
      'chart-account-payable-automation',
      organizationId,
      format(startDate, 'yyyy-MM-dd'),
      format(endDate, 'yyyy-MM-dd'),
    ],
    queryFn: async (): Promise<ChartAccountPayableAutomationData[]> => {
      if (!organizationId) {
        return [];
      }

      console.log(`[useChartAccountPayableAnalyticsAutomation] Fetching data from ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);

      const { data, error } = await supabase.rpc('chart_account_payable_automation', {
        p_start_date: format(startDate, 'yyyy-MM-dd'),
        p_end_date: format(endDate, 'yyyy-MM-dd'),
        p_organization_id: organizationId,
      });

      if (error) {
        console.error('[useChartAccountPayableAnalyticsAutomation] Error:', error);
        throw error;
      }

      console.log(`[useChartAccountPayableAnalyticsAutomation] Found ${data?.length || 0} months with data`);

      return (data || []).map(item => ({
        month_year: item.month_year,
        month_name: item.month_name,
        manual_count: typeof item.manual_count === 'number'
          ? item.manual_count
          : parseInt(String(item.manual_count)) || 0,
        email_count: typeof item.email_count === 'number'
          ? item.email_count
          : parseInt(String(item.email_count)) || 0,
        total_count: typeof item.total_count === 'number'
          ? item.total_count
          : parseInt(String(item.total_count)) || 0,
      }));
    },
    enabled: !!organizationId && enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
