import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, format } from 'date-fns';

export interface TreatmentGoalStats {
  categoryName: string;
  treatmentName: string;
  unitActual: number;
  totalRevenue: number;
  avgAmountActual: number;
}

interface UseTreatmentGoalStatsOptions {
  period: Date;
  periodType: 'month' | 'quarter' | 'year';
  locationId?: string | null;
  regionId?: string | null;
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetches actual treatment performance data per treatment for a given period.
 * Uses the get_profitability_invoice_items RPC (same data as the Profitability page).
 *
 * Returns per-treatment:
 * - Unit Actual: no_of_treatments (matches Profitability page "No. of Treatments")
 * - Avg Amount Actual: avg_income (matches Profitability page "Average Income")
 * - Total Revenue: total_revenue
 */
export function useTreatmentGoalStats(options: UseTreatmentGoalStatsOptions) {
  const { organizationId } = useOrganization();
  const { period, periodType, locationId } = options;

  return useQuery({
    queryKey: ['treatment_goal_stats', organizationId, period, periodType, locationId],
    queryFn: async () => {
      if (!organizationId) {
        return [] as TreatmentGoalStats[];
      }

      // Calculate date range based on period type
      const startDate = periodType === 'month'
        ? startOfMonth(period)
        : periodType === 'quarter'
        ? startOfQuarter(period)
        : startOfYear(period);
      const endDate = periodType === 'month'
        ? endOfMonth(period)
        : periodType === 'quarter'
        ? endOfQuarter(period)
        : endOfYear(period);

      const fromDate = format(startDate, 'yyyy-MM-dd');
      const toDate = format(endDate, 'yyyy-MM-dd');

      // Call the profitability RPC — same source as the Profitability page
      const { data, error } = await (supabase as any).rpc('get_profitability_invoice_items', {
        p_organization_id: organizationId,
        p_from_date: fromDate,
        p_to_date: toDate,
        p_location_id: locationId || null,
      });

      if (error) {
        console.error('[useTreatmentGoalStats] RPC error:', error);
        throw error;
      }

      const rows = (data ?? []) as Array<{
        treatment_id: string | null;
        treatment_name: string;
        treatment_code: string;
        category_name: string;
        paid_month: string;
        no_of_treatments: number | string;
        total_revenue: number | string;
        avg_income: number | string;
      }>;

      // Aggregate by treatment_name (RPC may return multiple rows per treatment
      // if split across months within the period)
      const treatmentStats = new Map<string, { categoryName: string; units: number; revenue: number }>();

      for (const row of rows) {
        const name = row.treatment_name || 'Unknown';
        const existing = treatmentStats.get(name);
        const units = asNumber(row.no_of_treatments);
        const revenue = asNumber(row.total_revenue);

        if (existing) {
          existing.units += units;
          existing.revenue += revenue;
        } else {
          treatmentStats.set(name, {
            categoryName: row.category_name || '-',
            units,
            revenue,
          });
        }
      }

      // Convert to result array
      const result: TreatmentGoalStats[] = Array.from(treatmentStats.entries()).map(([treatmentName, stats]) => ({
        categoryName: stats.categoryName,
        treatmentName,
        unitActual: stats.units,
        totalRevenue: stats.revenue,
        avgAmountActual: stats.units > 0 ? stats.revenue / stats.units : 0,
      }));

      result.sort((a, b) => a.treatmentName.localeCompare(b.treatmentName));

      return result;
    },
    enabled: !!organizationId && !!period,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
