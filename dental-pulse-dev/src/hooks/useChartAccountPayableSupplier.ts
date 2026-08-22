/**
 * useChartAccountPayableSupplier Hook
 * Fetches Supplier analytics data from stored procedure
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useAuth } from './useAuth';
import { format } from 'date-fns';

export interface ChartAccountPayableSupplierData {
  vendor_name: string;
  invoice_count: number;
  total_amount: number;
}

/**
 * Fetches supplier spend analytics for Accounts Payable
 * Calls chart_account_payable_supplier stored procedure
 *
 * @param startDate - Start date for the date range
 * @param endDate - End date for the date range
 * @param enabled - Whether to enable the query (default: true)
 * @param locationId - Optional location ID to filter by (null = all locations)
 */
export function useChartAccountPayableSupplier(
  startDate: Date,
  endDate: Date,
  enabled: boolean = true,
  locationId: string | null = null
) {
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useQuery({
    queryKey: [
      'chart-account-payable-supplier',
      organizationId,
      user?.id,
      format(startDate, 'yyyy-MM-dd'),
      format(endDate, 'yyyy-MM-dd'),
      locationId,
    ],
    queryFn: async (): Promise<ChartAccountPayableSupplierData[]> => {
      if (!organizationId || !user?.id) {
        return [];
      }

      console.log(`[useChartAccountPayableSupplier] Fetching data from ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}, locationId: ${locationId || 'all'}, userId: ${user.id}`);

      const { data, error } = await supabase.rpc('chart_account_payable_supplier', {
        p_start_date: format(startDate, 'yyyy-MM-dd'),
        p_end_date: format(endDate, 'yyyy-MM-dd'),
        p_organization_id: organizationId,
        p_location_id: locationId,
        p_user_id: user.id,
      });

      if (error) {
        console.error('[useChartAccountPayableSupplier] Error:', error);
        throw error;
      }

      console.log(`[useChartAccountPayableSupplier] Found ${data?.length || 0} suppliers with data`);

      return (data || []).map(item => ({
        vendor_name: item.vendor_name || 'Unknown Supplier',
        invoice_count: typeof item.invoice_count === 'number'
          ? item.invoice_count
          : parseInt(String(item.invoice_count)) || 0,
        total_amount: typeof item.total_amount === 'number'
          ? item.total_amount
          : parseFloat(String(item.total_amount)) || 0,
      }));
    },
    enabled: !!organizationId && !!user?.id && enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
