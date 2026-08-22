import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useLocations } from './useLocations';
import { fetchProfitBenchmarkProductionIncome } from '@/utils/fetchProfitBenchmarkProductionIncome';

export interface ChairMetric {
  location_id: string;
  location_name: string;
  chairs_count: number;
  completed_hours: number;
  treatment_hours: number;
  appointment_count: number;
  available_hours: number;
  occupancy_pct: number;
  utilisation_pct: number;
  /** Profit Benchmark Production Income (Private + Membership + NHS). */
  revenue: number;
  revenue_per_chair: number;
  prev_revenue_per_chair: number;
  trend_pct: number;
  benchmark_occupancy: number | null;
  benchmark_revenue_per_chair_per_hour: number;
  clinic_opening_hours_per_day: number;
  clinic_working_days_per_week: number;
  clinic_working_weeks_per_year: number;
  clinic_working_days_per_year: number;
}

interface UseChairMetricsOptions {
  startDate: Date;
  endDate: Date;
}

function getPreviousPeriod(start: Date, end: Date) {
  const diff = end.getTime() - start.getTime();
  const prevEnd = new Date(start);
  const prevStart = new Date(prevEnd.getTime() - diff);
  return { prevStart, prevEnd };
}

function toDateStr(d: Date) {
  // Use local date parts to avoid UTC timezone shift
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Chair occupancy / utilisation from get_chair_metrics, with Revenue replaced by
 * Profit Benchmark Production Income (Private + Membership + NHS) per location.
 */
export function useChairMetrics({ startDate, endDate }: UseChairMetricsOptions) {
  const { user } = useAuth();
  const { organizationId } = useLocations();

  const { prevStart, prevEnd } = getPreviousPeriod(startDate, endDate);
  const startStr = toDateStr(startDate);
  const endStr = toDateStr(endDate);
  const prevStartStr = toDateStr(prevStart);
  const prevEndStr = toDateStr(prevEnd);

  return useQuery({
    queryKey: [
      'chair_metrics_v3',
      organizationId,
      startStr,
      endStr,
      prevStartStr,
      prevEndStr,
    ],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await (supabase as any).rpc('get_chair_metrics', {
        _organization_id: organizationId,
        _start_date: startStr,
        _end_date: endStr,
        _prev_start_date: prevStartStr,
        _prev_end_date: prevEndStr,
      });

      if (error) {
        console.error('[useChairMetrics] RPC error:', error);
        throw error;
      }

      const rows = (data || []) as ChairMetric[];
      const enriched: ChairMetric[] = [];

      // Sequential — avoids Provider Net Production RPC storms wiping Private/NHS.
      for (const row of rows) {
        try {
          const income = await fetchProfitBenchmarkProductionIncome(
            organizationId,
            startStr,
            endStr,
            row.location_id,
          );
          const prevIncome = await fetchProfitBenchmarkProductionIncome(
            organizationId,
            prevStartStr,
            prevEndStr,
            row.location_id,
          ).catch(() => ({ total: 0 }));

          const chairs = Number(row.chairs_count) || 0;
          const revenue = income.total;
          const prevRevenue = prevIncome.total;
          const revenuePerChair = chairs > 0 ? revenue / chairs : 0;
          const prevRevenuePerChair = chairs > 0 ? prevRevenue / chairs : 0;
          const trendPct =
            prevRevenuePerChair > 0
              ? round2((revenuePerChair / prevRevenuePerChair - 1) * 100)
              : Number(row.trend_pct) || 0;

          enriched.push({
            ...row,
            revenue: round2(revenue),
            revenue_per_chair: round2(revenuePerChair),
            prev_revenue_per_chair: round2(prevRevenuePerChair),
            trend_pct: trendPct,
          });
        } catch (err) {
          console.error(
            `[useChairMetrics] production income error for ${row.location_id}:`,
            err,
          );
          enriched.push(row);
        }
      }

      return enriched;
    },
    enabled: !!user?.id && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
