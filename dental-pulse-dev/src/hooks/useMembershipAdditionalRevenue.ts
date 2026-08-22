import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useLocations } from '@/hooks/useLocations';
import { useFilters } from '@/contexts/FilterContext';
import { fetchAll, inChunks, localDayRange, toDateStr } from '@/lib/activityReportUtils';

/**
 * "Additional Revenue" per membership plan — the extra treatment revenue a
 * plan's members generate beyond their subscription fee, sourced from
 * Dentally. This is the SAME figure Practitioner Activity shows in its
 * total row when you filter by Payment Plan (Price column, completed
 * treatment line items): tpi_completed + tpi_completed_at in range +
 * tpi_payment_plan_id set + tpi_treatment_appointment_id set (excludes
 * charting-only entries — the same reconciled gate as
 * usePractitionerActivityReport / ProviderActivity's "Practitioner
 * Activity" tab), scoped to the location/date currently selected in the
 * top bar.
 *
 * Input is keyed by whatever label the caller renders a card for (a
 * Practice Plan statement fee-category, or a regular sheet-upload plan
 * name) → the Dentally payment plan(s) (payment_plans.id, the DB uuid —
 * NOT the raw Dentally pp_id) that label is mapped to. One label can map
 * to several Dentally plans (multi-select mapping); their revenue is
 * summed.
 */
export function useMembershipAdditionalRevenue(planPaymentPlanIds: Record<string, string[]>) {
  const { organizationId } = useOrganization();
  const { allAvailableLocations } = useLocations();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();

  const allLocationIds = useMemo(() => allAvailableLocations.map(l => l.id), [allAvailableLocations]);
  const regionLocationIds = useMemo(() => {
    if (!selectedRegionId || selectedLocationId) return null;
    return allAvailableLocations.filter(l => l.region_id === selectedRegionId).map(l => l.id);
  }, [selectedRegionId, selectedLocationId, allAvailableLocations]);
  const locationFilter = useMemo(() => {
    if (selectedLocationId) return { ids: [selectedLocationId] };
    if (regionLocationIds && regionLocationIds.length > 0) return { ids: regionLocationIds };
    if (allLocationIds.length > 0) return { ids: allLocationIds };
    return null;
  }, [selectedLocationId, regionLocationIds, allLocationIds]);

  // Stable, order-independent key for the mapping input so identical
  // mappings (common — most renders don't change them) hit cache.
  const labelIdsKey = useMemo(() => {
    const entries = Object.entries(planPaymentPlanIds)
      .map(([label, ids]) => [label, [...ids].sort()] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    return JSON.stringify(entries);
  }, [planPaymentPlanIds]);

  const locationKey = locationFilter ? locationFilter.ids.slice().sort().join(',') : 'none';
  const from = toDateStr(dateRange.startDate);
  const to = toDateStr(dateRange.endDate);

  const { data, isLoading, error } = useQuery({
    queryKey: ['membership_additional_revenue', organizationId, locationKey, from, to, labelIdsKey],
    queryFn: async (): Promise<Record<string, number>> => {
      const byLabel: Record<string, number> = {};
      if (!organizationId || !locationFilter || locationFilter.ids.length === 0) return byLabel;

      const allUuids = [...new Set(Object.values(planPaymentPlanIds).flat())];
      if (allUuids.length === 0) return byLabel;

      // Resolve the DB payment_plans uuid → Dentally's own numeric pp_id,
      // the id treatment_plan_items.tpi_payment_plan_id actually stores.
      const planRows = await inChunks<{ id: string; pp_id: number | null }>(
        'payment_plans', 'id, pp_id', 'id', allUuids, organizationId,
      );
      const uuidToPpId = new Map<string, number>();
      for (const p of planRows) {
        if (p.pp_id != null) uuidToPpId.set(p.id, p.pp_id);
      }
      const ppIds = [...new Set([...uuidToPpId.values()])];
      if (ppIds.length === 0) return byLabel;

      const { start, endExclusive } = localDayRange(from, to);

      const tpiRows = await fetchAll<{ tpi_payment_plan_id: number | null; tpi_price: number | string | null }>(
        () => {
          let q = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_payment_plan_id, tpi_price')
            .eq('organization_id', organizationId)
            .eq('tpi_completed', true)
            .not('tpi_completed_at', 'is', null)
            .not('tpi_treatment_appointment_id', 'is', null)
            .gte('tpi_completed_at', start)
            .lt('tpi_completed_at', endExclusive)
            .in('tpi_payment_plan_id', ppIds);
          if (locationFilter.ids.length === 1) q = q.eq('location_id', locationFilter.ids[0]);
          else q = q.in('location_id', locationFilter.ids);
          return q;
        },
      );

      const revenueByPpId = new Map<number, number>();
      for (const row of tpiRows) {
        if (row.tpi_payment_plan_id == null) continue;
        const price = typeof row.tpi_price === 'number' ? row.tpi_price : Number(row.tpi_price) || 0;
        revenueByPpId.set(row.tpi_payment_plan_id, (revenueByPpId.get(row.tpi_payment_plan_id) ?? 0) + price);
      }

      for (const [label, uuids] of Object.entries(planPaymentPlanIds)) {
        let total = 0;
        for (const uuid of uuids) {
          const ppId = uuidToPpId.get(uuid);
          if (ppId != null) total += revenueByPpId.get(ppId) ?? 0;
        }
        byLabel[label] = Math.round(total);
      }
      return byLabel;
    },
    enabled: !!organizationId && !!locationFilter && locationFilter.ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return { data: data ?? {}, isLoading, error };
}
