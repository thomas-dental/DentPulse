import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { ukDayStartInstant } from '@/utils/dateRangeUtils';

export interface WeeklyMetric {
  thisWeek: number;
  lastWeek: number;
  change: number;
  changePct: number;
}

export interface FinancialMetricsWeekly {
  netProduction: WeeklyMetric;
  collectionRate: WeeklyMetric;
  isLoading: boolean;
  error: unknown;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay();
  const diff = (day + 6) % 7;
  r.setDate(r.getDate() - diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function toIso(d: Date): string {
  return d.toISOString();
}

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const PAGE_SIZE = 1000;

async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

function diff(thisWeek: number, lastWeek: number): WeeklyMetric {
  const change = thisWeek - lastWeek;
  const changePct = lastWeek !== 0 ? (change / lastWeek) * 100 : 0;
  return { thisWeek, lastWeek, change, changePct };
}

/**
 * Net production and collection rate for the current week vs the previous week.
 * Windows are intentionally hardcoded — this powers the "What Changed Since
 * Last Week" snapshot on the dashboard, which is week-over-week regardless of
 * the global date range filter. Only the Region/Location filter applies.
 */
export function useFinancialMetricsWeekly(): FinancialMetricsWeekly {
  const { organizationId } = useOrganization();
  const { selectedLocationId, selectedRegionId } = useFilters();
  const { allAvailableLocations } = useLocations();

  const { thisStart, thisEnd, lastStart, lastEnd } = useMemo(() => {
    const now = new Date();
    const tStart = startOfWeek(now);
    const tEnd = addDays(tStart, 7);
    const lStart = addDays(tStart, -7);
    const lEnd = tStart;
    return { thisStart: tStart, thisEnd: tEnd, lastStart: lStart, lastEnd: lEnd };
  }, []);

  const locationIdsForQuery = useMemo<string[] | null>(() => {
    if (selectedLocationId) return [selectedLocationId];
    if (selectedRegionId) {
      const ids = allAvailableLocations
        .filter(l => l.region_id === selectedRegionId)
        .map(l => l.id);
      return ids.length > 0 ? ids : [];
    }
    return null;
  }, [selectedLocationId, selectedRegionId, allAvailableLocations]);

  const locationKey = locationIdsForQuery
    ? locationIdsForQuery.slice().sort().join(',')
    : 'all';

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'financial_metrics_weekly_v2',
      organizationId,
      locationKey,
      thisStart.toISOString(),
    ],
    enabled: !!organizationId,
    queryFn: async () => {
      if (!organizationId || (locationIdsForQuery && locationIdsForQuery.length === 0)) {
        return {
          netProduction: diff(0, 0),
          collectionRate: diff(0, 0),
        };
      }

      // ── Net Production: sum tpi_price per week ─────────────────────
      const tpiPromise = fetchAll<{
        tpi_price: number | null;
        tpi_completed_at: string | null;
      }>(() => {
        let q = (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_price, tpi_completed_at')
          .eq('organization_id', organizationId)
          .eq('tpi_completed', true)
          .not('tpi_completed_at', 'is', null)
          .not('tpi_payment_plan_id', 'is', null)
          // Europe/London week-boundary instants — a bare 'YYYY-MM-DD' lower
          // bound is cast as UTC by the DB (an hour late in BST), and
          // toISOString() of a local-midnight Date depends on the browser TZ.
          .gte('tpi_completed_at', ukDayStartInstant(lastStart))
          .lt('tpi_completed_at', ukDayStartInstant(thisEnd));
        if (locationIdsForQuery && locationIdsForQuery.length === 1) {
          q = q.eq('location_id', locationIdsForQuery[0]);
        } else if (locationIdsForQuery && locationIdsForQuery.length > 1) {
          q = q.in('location_id', locationIdsForQuery);
        }
        return q;
      });

      // ── Collection Rate: count paid vs total invoices per week ─────
      const invoicePromise = fetchAll<{
        is_paid: boolean | null;
        invoice_date: string | null;
      }>(() => {
        let q = (supabase as any)
          .from('platform_integration_invoices')
          .select('is_paid, invoice_date')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .gte('invoice_date', toDateOnly(lastStart))
          .lt('invoice_date', toDateOnly(thisEnd));
        if (locationIdsForQuery && locationIdsForQuery.length === 1) {
          q = q.eq('location_id', locationIdsForQuery[0]);
        } else if (locationIdsForQuery && locationIdsForQuery.length > 1) {
          q = q.in('location_id', locationIdsForQuery);
        }
        return q;
      });

      const [tpiRows, invoiceRows] = await Promise.all([tpiPromise, invoicePromise]);

      // Net Production split by week — boundary at London midnight Monday so
      // the split matches the query window regardless of the browser timezone.
      const thisStartMs = new Date(ukDayStartInstant(thisStart)).getTime();
      let thisRev = 0;
      let lastRev = 0;
      for (const r of tpiRows) {
        if (!r.tpi_completed_at) continue;
        const ts = new Date(r.tpi_completed_at).getTime();
        const price = Number(r.tpi_price ?? 0);
        if (!Number.isFinite(price)) continue;
        if (ts >= thisStartMs) thisRev += price;
        else lastRev += price;
      }

      // Collection Rate split by week
      let thisPaid = 0, thisTotal = 0, lastPaid = 0, lastTotal = 0;
      for (const inv of invoiceRows) {
        if (!inv.invoice_date) continue;
        const ts = new Date(inv.invoice_date).getTime();
        const isThis = ts >= thisStartMs;
        if (isThis) {
          thisTotal++;
          if (inv.is_paid) thisPaid++;
        } else {
          lastTotal++;
          if (inv.is_paid) lastPaid++;
        }
      }

      const thisRate = thisTotal > 0 ? (thisPaid / thisTotal) * 100 : 0;
      const lastRate = lastTotal > 0 ? (lastPaid / lastTotal) * 100 : 0;

      return {
        netProduction: diff(thisRev, lastRev),
        collectionRate: diff(thisRate, lastRate),
      };
    },
  });

  return {
    netProduction: data?.netProduction ?? diff(0, 0),
    collectionRate: data?.collectionRate ?? diff(0, 0),
    isLoading,
    error,
  };
}
