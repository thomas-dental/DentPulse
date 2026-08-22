import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLocations } from '@/hooks/useLocations';
import { useFilters } from '@/contexts/FilterContext';

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Format a Date to YYYY-MM-DD using local time (avoids UTC timezone shift) */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface RevenueByTypeItem {
  name: string;
  value: number;
  color: string;
}

export interface RevenueTrendMonth {
  month: string;
  nhs: number;
  private: number;
  membership: number;
}

const CHART_COLORS = {
  nhs: 'hsl(var(--chart-1))',
  private: 'hsl(var(--chart-2))',
  membership: 'hsl(var(--chart-3))',
};

const MONTH_LABELS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Calculates NHS and Private revenue from platform_integration_invoices.
 *
 * Security: RLS on platform_integration_invoices enforces org-level access.
 * We filter by location_id (from practice_locations) and date range.
 * For "All Locations", we pass all location IDs the user has access to.
 */
export function useRevenueByType() {
  const { user } = useAuth();
  const { allAvailableLocations } = useLocations();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();

  // All location IDs the user has access to (for "All Locations" query)
  const allLocationIds = useMemo(() => {
    return allAvailableLocations.map(l => l.id);
  }, [allAvailableLocations]);

  // When a region is selected (but no specific location), get location IDs in that region
  const regionLocationIds = useMemo(() => {
    if (!selectedRegionId || selectedLocationId) return null;
    return allAvailableLocations
      .filter(l => l.region_id === selectedRegionId)
      .map(l => l.id);
  }, [selectedRegionId, selectedLocationId, allAvailableLocations]);

  // Use local date strings to avoid UTC timezone shift
  const startDateStr = toLocalDateStr(dateRange.startDate);
  const endDateStr = toLocalDateStr(dateRange.endDate);

  // Determine which location IDs to filter by
  const locationFilter = useMemo(() => {
    if (selectedLocationId) return { type: 'single' as const, ids: [selectedLocationId] };
    if (regionLocationIds && regionLocationIds.length > 0) return { type: 'multi' as const, ids: regionLocationIds };
    if (allLocationIds.length > 0) return { type: 'multi' as const, ids: allLocationIds };
    return null;
  }, [selectedLocationId, regionLocationIds, allLocationIds]);

  const locationKey = locationFilter ? locationFilter.ids.slice().sort().join(',') : 'none';

  const isEnabled = !!user?.id && !!locationFilter && locationFilter.ids.length > 0;

  return useQuery({
    queryKey: ['revenue_by_type', locationKey, startDateStr, endDateStr, selectedRegionId],
    queryFn: async () => {
      if (!locationFilter || locationFilter.ids.length === 0) {
        return { nhsRevenue: 0, privateRevenue: 0, totalTpiRevenue: 0 };
      }

      const PAGE_SIZE = 1000;
      let nhsRevenue = 0;
      let totalRevenue = 0;

      let from = 0;
      let hasMore = true;
      let totalRowCount = 0;
      while (hasMore) {
        let invoiceQuery = (supabase as any)
          .from('platform_integration_invoices')
          .select('subtotal, nhs_amount')
          .gte('invoice_date', startDateStr)
          .lte('invoice_date', endDateStr)
          .is('deleted_at', null);

        if (locationFilter.type === 'single') {
          invoiceQuery = invoiceQuery.eq('location_id', locationFilter.ids[0]);
        } else {
          invoiceQuery = invoiceQuery.in('location_id', locationFilter.ids);
        }

        const { data, error } = await invoiceQuery.range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        const rows = (data ?? []) as Array<{
          subtotal: number | string | null;
          nhs_amount: number | string | null;
        }>;

        totalRowCount += rows.length;

        for (const row of rows) {
          totalRevenue += asNumber(row.subtotal);
          nhsRevenue += asNumber(row.nhs_amount);
        }

        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      const privateRevenue = Math.max(0, totalRevenue - nhsRevenue);
      return { nhsRevenue, privateRevenue, totalTpiRevenue: totalRevenue };
    },
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Build chart data: Revenue by Type (donut) and Revenue Trends (line) from dynamic values.
 */
export function buildRevenueChartsData(
  nhsRevenue: number,
  privateRevenue: number,
  membershipMonthlyRevenue: number
): { revenueByType: RevenueByTypeItem[]; monthlyTrends: RevenueTrendMonth[]; totalRevenue: number } {
  const revenueByType: RevenueByTypeItem[] = [
    { name: 'NHS', value: Math.round(nhsRevenue), color: CHART_COLORS.nhs },
    { name: 'Private', value: Math.round(privateRevenue), color: CHART_COLORS.private },
    { name: 'Membership', value: Math.round(membershipMonthlyRevenue), color: CHART_COLORS.membership },
  ];

  const totalRevenue = nhsRevenue + privateRevenue + membershipMonthlyRevenue;

  const monthlyTrends: RevenueTrendMonth[] = MONTH_LABELS.map((month) => ({
    month,
    nhs: Math.round(nhsRevenue),
    private: Math.round(privateRevenue),
    membership: Math.round(membershipMonthlyRevenue),
  }));

  return { revenueByType, monthlyTrends, totalRevenue };
}
