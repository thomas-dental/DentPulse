import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { startOfMonth, endOfMonth, format } from 'date-fns'; // startOfMonth/endOfMonth used for default range
import dayjs from 'dayjs';


export interface ProviderMonthlyHours {
  providerId: string;
  externalId: number | null;   // Dentally external_id — first one (for backward compat)
  externalIds: number[];       // All external_ids for this person (multi-location)
  providerName: string;
  monthlyData: { [month: string]: number }; // 'Mar-26': 19.42
  total: number;               // rounded to 1dp for display
  totalExact: number;          // unrounded — use this for avg daily production calculation
}

/**
 * Fetches working hours for ALL providers of a given type from appointment_summary.
 *
 * Location logic:
 * - locationId = null/all  → group providers by email (same person at multiple locations), SUM hours across all locations
 * - locationId = specific  → filter providers by location_id, show that location's data only
 */
export function useAllProvidersWorkingHours(
  providerType: string | null,
  startDate: Date | null,
  endDate: Date | null,
  locationId?: string | null
) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [
      'all-providers-working-hours-v2',
      organizationId,
      providerType,
      startDate ? format(startDate, 'yyyy-MM-dd') : null,
      endDate ? format(endDate, 'yyyy-MM-dd') : null,
      locationId ?? 'all',
    ],
    queryFn: async (): Promise<{ providers: ProviderMonthlyHours[]; months: string[] }> => {
      if (!organizationId) return { providers: [], months: [] };

      const now = new Date();
      const rangeStart = (startDate && endDate) ? startDate : startOfMonth(now);
      const rangeEnd   = (startDate && endDate) ? endDate   : endOfMonth(now);

      const fromDate = format(rangeStart, 'yyyy-MM-dd');
      const toDate   = format(rangeEnd,   'yyyy-MM-dd');

      // 1. Fetch providers of the given type — do NOT filter by location_id here.
      // A provider's record may have a different location_id than where they actually
      // work (appointments location_id). The location filter is applied on the DATA
      // side via p_location_id in get_provider_working_hours_by_location, so providers
      // with no appointments at the selected location naturally return 0 hours.
      // Include inactive providers so leavers still appear with historical hours.
      let providersQuery = (supabase as any)
        .from('providers')
        .select('id, name, email, provider_role, location_id, external_id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      if (providerType === 'Dentist') {
        providersQuery = providersQuery.or('provider_role.ilike.%dentist%,provider_role.ilike.%dental surgeon%,provider_role.ilike.%principal dentist%');
      } else if (providerType === 'Hygienist') {
        providersQuery = providersQuery.or('provider_role.ilike.%hygienist%,provider_role.ilike.%dental hygienist%,provider_role.ilike.%hygiene%');
      } else if (providerType === 'Therapist') {
        providersQuery = providersQuery.or('provider_role.ilike.%therapist%,provider_role.ilike.%dental therapist%,provider_role.ilike.%therapy%');
      } else if (providerType === 'Other') {
        providersQuery = providersQuery
          .filter('provider_role', 'not.ilike', '%dentist%')
          .filter('provider_role', 'not.ilike', '%hygienist%')
          .filter('provider_role', 'not.ilike', '%hygiene%')
          .filter('provider_role', 'not.ilike', '%therapist%')
          .filter('provider_role', 'not.ilike', '%therapy%');
      }

      const { data: rawProviderRows, error: providersError } = await providersQuery;
      if (providersError) throw providersError;
      if (!rawProviderRows?.length) return { providers: [], months: [] };

      // 2. Build month label list
      const months: string[] = [];
      let cur = new Date(rangeStart);
      while (cur <= rangeEnd) {
        months.push(format(cur, 'MMM-yy'));
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }

      // 3. Always deduplicate by email — one entry per unique person regardless of how many
      // location rows they have in the providers table. Collect all their external_ids.
      const emailGroupMap = new Map<string, { displayName: string; providerId: string; externalIds: number[] }>();
      for (const p of rawProviderRows) {
        const key = (p.email ?? p.name ?? '').toLowerCase();
        if (!emailGroupMap.has(key)) {
          emailGroupMap.set(key, { displayName: p.name, providerId: p.id, externalIds: [] });
        }
        if (p.external_id) {
          const extId = Number(p.external_id);
          if (!isNaN(extId) && !emailGroupMap.get(key)!.externalIds.includes(extId)) {
            emailGroupMap.get(key)!.externalIds.push(extId);
          }
        }
      }

      const allExternalIds = Array.from(emailGroupMap.values())
        .flatMap(g => g.externalIds);

      if (allExternalIds.length === 0) return { providers: [], months: [] };

      // 4. Fetch hours data — method depends on whether a specific location is selected.
      const hoursMap = new Map<string, number>(); // key: `${externalId}::${monthLabel}`
      // For specific-location path: accumulate raw integer minutes per externalId so the
      // total is one division (matches Overview's single SQL SUM/60 — no float64 accumulation).
      const exactMinutesMap = new Map<number, number>(); // key: externalId, value: total minutes
      let hasExactMinutes = false;

      if (!locationId || locationId === 'all') {
        // All locations: use appointment_summary (org-wide, already aggregated across locations)
        const { data: summaryRows, error: summaryError } = await (supabase as any)
          .from('appointment_summary')
          .select('practitioner_id, month, working_duration_hours')
          .eq('organization_id', organizationId)
          .in('practitioner_id', allExternalIds)
          .gte('month', fromDate)
          .lte('month', toDate);

        if (summaryError) throw summaryError;

        for (const row of summaryRows ?? []) {
          const label = dayjs(row.month).format('MMM-YY');
          const key = `${row.practitioner_id}::${label}`;
          hoursMap.set(key, (hoursMap.get(key) ?? 0) + (Number(row.working_duration_hours) || 0));
        }
      } else {
        // Specific location: query appointments table directly filtered by location_id
        const { data: locationRows, error: locationError } = await (supabase as any).rpc(
          'get_provider_working_hours_by_location',
          {
            p_organization_id:  organizationId,
            p_practitioner_ids: allExternalIds,
            p_location_id:      locationId,
            p_from_date:        fromDate,
            p_to_date:          toDate,
          }
        );
        if (locationError) throw locationError;

        for (const row of locationRows ?? []) {
          const label = dayjs(row.month).format('MMM-YY');
          const key = `${row.practitioner_id}::${label}`;
          hoursMap.set(key, (hoursMap.get(key) ?? 0) + (Number(row.working_duration_hours) || 0));
          // Accumulate raw integer minutes for exact total (eliminates float64 rounding)
          if (row.duration_minutes != null) {
            const extId = Number(row.practitioner_id);
            exactMinutesMap.set(extId, (exactMinutesMap.get(extId) ?? 0) + (Number(row.duration_minutes) || 0));
            hasExactMinutes = true;
          }
        }
      }

      // 5. Build result — one row per unique person, summing across their external_ids
      const providersData: ProviderMonthlyHours[] = [];
      for (const [, group] of emailGroupMap) {
        if (!group.externalIds.length) continue;

        const monthlyData: { [month: string]: number } = {};
        for (const month of months) {
          let hours = 0;
          for (const extId of group.externalIds) {
            hours += hoursMap.get(`${extId}::${month}`) ?? 0;
          }
          monthlyData[month] = Math.round(hours * 10) / 10;
        }

        // Use integer-minute total when available (specific-location path): one division
        // matches Overview's single SQL SUM/60. Fall back to summing monthly float hours.
        let total: number;
        if (hasExactMinutes) {
          const totalMins = group.externalIds.reduce(
            (sum, extId) => sum + (exactMinutesMap.get(extId) ?? 0), 0
          );
          total = totalMins / 60.0;
        } else {
          total = 0;
          for (const month of months) {
            for (const extId of group.externalIds) {
              total += hoursMap.get(`${extId}::${month}`) ?? 0;
            }
          }
        }

        providersData.push({
          providerId:  group.providerId,
          externalId:  group.externalIds[0] ?? null,
          externalIds: group.externalIds,
          providerName: group.displayName,
          monthlyData,
          total: Math.round(total * 10) / 10,  // rounded for display
          totalExact: total,                     // unrounded for avg daily calculation
        });
      }

      providersData.sort((a, b) => a.providerName.localeCompare(b.providerName));
      return { providers: providersData, months };
    },
    enabled: !!organizationId,
    staleTime: 0,
  });
}
