import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

export interface ActivePatientsWeekly {
  thisWeek: number;
  lastWeek: number;
  change: number;
  changePct: number;
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

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
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

/**
 * Active patients (distinct patients with completed appointments) for the
 * current week vs the previous week. Windows are intentionally hardcoded —
 * powers the "What Changed Since Last Week" snapshot, which is week-over-week
 * regardless of the global date range filter. Only the Region/Location filter
 * applies.
 */
export function useActivePatientsWeekly(): ActivePatientsWeekly {
  const { organizationId } = useOrganization();
  const { selectedLocationId, selectedRegionId } = useFilters();
  const { allAvailableLocations } = useLocations();

  const { thisStart, thisEnd, lastStart, lastEnd } = useMemo(() => {
    const now = new Date();
    const tStart = startOfWeek(now);
    const tEnd = endOfDay(addDays(tStart, 6));
    const lStart = addDays(tStart, -7);
    const lEnd = endOfDay(addDays(lStart, 6));
    return { thisStart: tStart, thisEnd: tEnd, lastStart: lStart, lastEnd: lEnd };
  }, []);

  // Europe/London week-boundary instants — viewer-independent, unlike
  // toISOString() on local Dates (wrong outside UK browsers).
  const thisStartIso = ukDayStartInstant(thisStart);
  const thisEndIso = ukDayEndInstant(thisEnd);
  const lastStartIso = ukDayStartInstant(lastStart);
  const lastEndIso = ukDayEndInstant(lastEnd);

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
      'active_patients_weekly_v2',
      organizationId,
      locationKey,
      thisStartIso,
      thisEndIso,
    ],
    enabled: !!organizationId,
    queryFn: async () => {
      if (!organizationId) return { thisWeek: 0, lastWeek: 0 };
      if (locationIdsForQuery && locationIdsForQuery.length === 0) {
        return { thisWeek: 0, lastWeek: 0 };
      }

      // Single-location or org-wide → use the existing RPC (fast COUNT DISTINCT).
      if (!locationIdsForQuery || locationIdsForQuery.length <= 1) {
        const singleLocation = locationIdsForQuery?.[0] ?? null;
        const [thisRes, lastRes] = await Promise.all([
          (supabase as any).rpc('get_total_distinct_patients', {
            p_organization_id: organizationId,
            p_start_date: thisStartIso,
            p_end_date: thisEndIso,
            p_provider_type: null,
            p_location_id: singleLocation,
          }),
          (supabase as any).rpc('get_total_distinct_patients', {
            p_organization_id: organizationId,
            p_start_date: lastStartIso,
            p_end_date: lastEndIso,
            p_provider_type: null,
            p_location_id: singleLocation,
          }),
        ]);
        if (thisRes.error) throw thisRes.error;
        if (lastRes.error) throw lastRes.error;
        return {
          thisWeek: Number(thisRes.data ?? 0),
          lastWeek: Number(lastRes.data ?? 0),
        };
      }

      // Multi-location (region) → fetch in JS and dedupe across locations.
      // Mirrors the RPC's active-provider filter so counts match the single-location path.
      const { data: activeProviders, error: providersError } = await (supabase as any)
        .from('providers')
        .select('external_id')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .not('external_id', 'is', null);
      if (providersError) throw providersError;

      const activeExternalIds = new Set<number>();
      for (const p of (activeProviders ?? []) as Array<{ external_id: number | string | null }>) {
        if (p.external_id != null) activeExternalIds.add(Number(p.external_id));
      }

      const fetchDistinctPatients = async (startIso: string, endIso: string) => {
        const rows = await fetchAll<{
          apmt_patient_id: number | null;
          apmt_practitioner_id: number | null;
        }>(() =>
          (supabase as any)
            .from('appointments')
            .select('apmt_patient_id, apmt_practitioner_id')
            .eq('organization_id', organizationId)
            .eq('apmt_state', 'Completed')
            .gte('apmt_start_time', startIso)
            .lte('apmt_start_time', endIso)
            .not('apmt_patient_id', 'is', null)
            .in('location_id', locationIdsForQuery)
        );
        const set = new Set<number>();
        for (const r of rows) {
          if (r.apmt_patient_id == null) continue;
          if (r.apmt_practitioner_id == null) continue;
          if (!activeExternalIds.has(Number(r.apmt_practitioner_id))) continue;
          set.add(r.apmt_patient_id);
        }
        return set.size;
      };

      const [thisCount, lastCount] = await Promise.all([
        fetchDistinctPatients(thisStartIso, thisEndIso),
        fetchDistinctPatients(lastStartIso, lastEndIso),
      ]);

      return { thisWeek: thisCount, lastWeek: lastCount };
    },
  });

  const thisWeek = data?.thisWeek ?? 0;
  const lastWeek = data?.lastWeek ?? 0;
  const change = thisWeek - lastWeek;
  const changePct = lastWeek > 0 ? (change / lastWeek) * 100 : 0;

  return { thisWeek, lastWeek, change, changePct, isLoading, error };
}
