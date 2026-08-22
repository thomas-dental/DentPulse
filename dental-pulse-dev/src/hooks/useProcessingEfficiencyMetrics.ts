/**
 * useProcessingEfficiencyMetrics Hook
 * Fetches processing efficiency metrics for Accounts Payable Analytics
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { format } from 'date-fns';

export interface ProcessingEfficiencyMetrics {
  autoProcessedPercentage: number;
  totalAttachments: number;
  extractedInvoices: number;
  avgDaysToPay: number | null; // null = no paid invoices in range (shows "—")
  paidInvoicesCount: number;
  dataAccuracy: number;
  totalPaidAmount: number;
}

/**
 * Fetches auto-processed percentage for specified date range
 * Auto-Processed = (Extracted invoices / Total email attachments) × 100
 *
 * @param startDate - Start date for the date range
 * @param endDate - End date for the date range
 * @param enabled - Whether to enable the query (default: true)
 */
export function useProcessingEfficiencyMetrics(
  startDate: Date,
  endDate: Date,
  enabled: boolean = true
) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [
      'processing-efficiency-metrics',
      organizationId,
      format(startDate, 'yyyy-MM-dd'),
      format(endDate, 'yyyy-MM-dd'),
    ],
    queryFn: async (): Promise<ProcessingEfficiencyMetrics> => {
      if (!organizationId) {
        return {
          autoProcessedPercentage: 0,
          totalAttachments: 0,
          extractedInvoices: 0,
          avgDaysToPay: null,
          paidInvoicesCount: 0,
          dataAccuracy: 0,
          totalPaidAmount: 0,
        };
      }

      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');

      console.log(`[useProcessingEfficiencyMetrics] Fetching metrics from ${startDateStr} to ${endDateStr}`);

      // Fetch RPC data for other metrics
      const { data, error } = await supabase.rpc('get_processing_efficiency_metrics', {
        p_start_date: startDateStr,
        p_end_date: endDateStr,
        p_organization_id: organizationId,
      });

      if (error) {
        console.error('[useProcessingEfficiencyMetrics] Error:', error);
        throw error;
      }

      console.log('[useProcessingEfficiencyMetrics] RPC Data:', data);

      // RPC returns an array with single row
      const result = Array.isArray(data) ? data[0] : data;

      // Fetch paid invoices to calculate Monthly Expense.
      // Use paid_at as the canonical date — invoices without paid_at are excluded
      // from the date filter so a Jan invoice marked paid in March doesn't
      // bleed into the wrong month's figure.
      const { data: paidInvoices, error: paidError } = await (supabase as any)
        .from('accounts_payable_invoice')
        .select('total_amount, paid_at')
        .eq('organization_id', organizationId)
        .or('platform_status.eq.PAID,status.eq.paid')
        .not('paid_at', 'is', null);

      if (paidError) {
        console.error('[useProcessingEfficiencyMetrics] Error fetching paid invoices:', paidError);
      }

      // Filter by paid_at within the selected date range
      const filteredPaidInvoices = (paidInvoices || []).filter((invoice: any) => {
        const invoiceDate = format(new Date(invoice.paid_at), 'yyyy-MM-dd');
        return invoiceDate >= startDateStr && invoiceDate <= endDateStr;
      });

      const calculatedTotalPaidAmount = filteredPaidInvoices.reduce(
        (sum: number, invoice: any) => sum + (invoice.total_amount || 0),
        0
      );

      // avgDaysToPay: clamp to >= 0 (guard against bad data where paid_at < shared_at),
      // return null when the RPC has no qualifying paid invoices so the UI shows "—".
      const rawAvgDays = result?.avg_days_to_pay;
      const avgDaysToPay = rawAvgDays == null ? null : Math.max(0, Math.round(rawAvgDays));

      return {
        autoProcessedPercentage: result?.auto_processed_percentage ?? 0,
        totalAttachments: result?.total_attachments ?? 0,
        extractedInvoices: result?.extracted_invoices ?? 0,
        avgDaysToPay,
        paidInvoicesCount: filteredPaidInvoices.length,
        dataAccuracy: result?.avg_data_accuracy ?? 0,
        totalPaidAmount: calculatedTotalPaidAmount,
      };
    },
    enabled: !!organizationId && enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
