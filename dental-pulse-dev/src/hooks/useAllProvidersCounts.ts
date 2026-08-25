import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import dayjs from 'dayjs';

export type CountField = 'uda_count' | 'mos_count';

export interface ProviderMonthlyCount {
  providerId: string;
  externalIds: number[];
  providerName: string;
  monthlyData: { [month: string]: number };
  total: number;
}

/**
 * Fetches a manually-entered appointment_summary count column (uda_count = NHS
 * Count, mos_count = MOS Count) for ALL providers of a given type, aggregated by
 * month. Mirrors useAllProvidersWorkingHours's "all locations" path — these
 * fields have no location dimension on appointment_summary, so there's no
 * per-location RPC branch needed here.
 */
export function useAllProvidersCounts(
  providerType: string | null,
  startDate: Date | null,
  endDate: Date | null,
  field: CountField
) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [
      'all-providers-counts-v2',
      field,
      organizationId,
      providerType,
      startDate ? format(startDate, 'yyyy-MM-dd') : null,
      endDate ? format(endDate, 'yyyy-MM-dd') : null,
    ],
    queryFn: async (): Promise<{ providers: ProviderMonthlyCount[]; months: string[] }> => {
      if (!organizationId) return { providers: [], months: [] };

      const now = new Date();
      const rangeStart = (startDate && endDate) ? startDate : startOfMonth(now);
      const rangeEnd   = (startDate && endDate) ? endDate   : endOfMonth(now);

      const fromDate = format(rangeStart, 'yyyy-MM-dd');
      const toDate   = format(rangeEnd,   'yyyy-MM-dd');

      // Include inactive providers so leavers still appear with historical NHS/MOS counts.
      let providersQuery = (supabase as any)
        .from('providers')
        .select('id, name, email, provider_role, external_id')
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

      const months: string[] = [];
      let cur = new Date(rangeStart);
      while (cur <= rangeEnd) {
        months.push(format(cur, 'MMM-yy'));
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }

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

      const allExternalIds = Array.from(emailGroupMap.values()).flatMap(g => g.externalIds);
      if (allExternalIds.length === 0) return { providers: [], months: [] };

      const countMap = new Map<string, number>(); // key: `${externalId}::${monthLabel}`
      const { data: summaryRows, error: summaryError } = await (supabase as any)
        .from('appointment_summary')
        .select(`practitioner_id, month, ${field}`)
        .eq('organization_id', organizationId)
        .in('practitioner_id', allExternalIds)
        .gte('month', fromDate)
        .lte('month', toDate);

      if (summaryError) throw summaryError;

      for (const row of summaryRows ?? []) {
        const label = dayjs(row.month).format('MMM-YY');
        const key = `${row.practitioner_id}::${label}`;
        countMap.set(key, (countMap.get(key) ?? 0) + (Number(row[field]) || 0));
      }

      const providersData: ProviderMonthlyCount[] = [];
      for (const [, group] of emailGroupMap) {
        if (!group.externalIds.length) continue;

        const monthlyData: { [month: string]: number } = {};
        let total = 0;
        for (const month of months) {
          let count = 0;
          for (const extId of group.externalIds) {
            count += countMap.get(`${extId}::${month}`) ?? 0;
          }
          monthlyData[month] = count;
          total += count;
        }

        providersData.push({
          providerId: group.providerId,
          externalIds: group.externalIds,
          providerName: group.displayName,
          monthlyData,
          total,
        });
      }

      providersData.sort((a, b) => a.providerName.localeCompare(b.providerName));
      return { providers: providersData, months };
    },
    enabled: !!organizationId,
    staleTime: 0,
  });
}
