import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { fetchDentpulseNhsMonthlyOverlay } from '@/utils/dentpulseNhsIncome';

export interface MonthlyNetProduction {
  month: string; // 'Jan-25', 'Feb-25', etc.
  amount: number;
  private: number;
  membership: number;
  nhs: number;
}

export interface ProviderNetProductionData {
  providerName: string;
  monthlyProduction: MonthlyNetProduction[];
  totalProduction: number;
  totalPrivate: number;
  totalMembership: number;
  totalNhs: number;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Fetches net production data for a provider.
 *
 * Multi-location aware: collects ALL external_ids for the provider's email
 * (same person may have multiple providers rows) and sums across all of them,
 * matching what useAllProvidersNetProduction does.
 *
 * Location filter: when locationId is provided, passes p_location_id to the
 * RPC so only TPIs at that location are counted.
 *
 * When nhs/mos income source = dentpulse, NHS = UDA rate × actual counts.
 */
export function useProviderNetProduction(
  providerId: string | undefined,
  startDate?: Date | null,
  endDate?: Date | null,
  locationId?: string | null
) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [
      'provider-net-production-v12',
      organizationId,
      providerId,
      startDate ? format(startDate, 'yyyy-MM-dd') : null,
      endDate ? format(endDate, 'yyyy-MM-dd') : null,
      locationId ?? 'all',
    ],
    queryFn: async (): Promise<ProviderNetProductionData | null> => {
      if (!organizationId || !providerId) return null;

      const now = new Date();
      const rangeStart = startDate || startOfMonth(now);
      const rangeEnd   = endDate   || endOfMonth(now);

      const fromDate = format(rangeStart, 'yyyy-MM-dd');
      const toDate   = format(rangeEnd,   'yyyy-MM-dd');

      // 1. Fetch this provider row to get name + email + location
      const { data: providerRow, error: providerError } = await supabase
        .from('providers')
        .select('name, email, external_id, location_id')
        .eq('id', providerId)
        .single();

      if (providerError) throw providerError;
      if (!providerRow.external_id) {
        return {
          providerName: providerRow.name || 'Provider',
          monthlyProduction: [],
          totalProduction: 0,
          totalPrivate: 0,
          totalMembership: 0,
          totalNhs: 0,
        };
      }

      // 2. Collect ALL external_ids for this person (same email = same person at multiple locations)
      const emailKey = (providerRow.email ?? providerRow.name ?? '').toLowerCase();
      let allExternalIds: number[] = [Number(providerRow.external_id)];

      if (emailKey) {
        const { data: siblings } = await supabase
          .from('providers')
          .select('external_id')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .ilike('email', emailKey);

        for (const s of siblings ?? []) {
          if (s.external_id) {
            const id = Number(s.external_id);
            if (!isNaN(id) && !allExternalIds.includes(id)) {
              allExternalIds.push(id);
            }
          }
        }
      }

      // 3. Build month label list
      const months: string[] = [];
      let cur = new Date(rangeStart);
      while (cur <= rangeEnd) {
        months.push(format(cur, 'MMM-yy'));
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }

      // 4. Fetch production for each external_id and merge
      const merged = new Map<string, { total: number; private: number; membership: number; nhs: number }>();
      months.forEach(m => merged.set(m, { total: 0, private: 0, membership: 0, nhs: 0 }));

      for (const extId of allExternalIds) {
        const rpcParams: Record<string, unknown> = {
          p_organization_id:  organizationId,
          p_from_date:        fromDate,
          p_to_date:          toDate,
          p_practitioner_id:  extId,
        };
        if (locationId && locationId !== 'all') {
          rpcParams.p_location_id = locationId;
        }

        const { data, error } = await supabase.rpc('get_provider_net_production_monthly', rpcParams);
        if (error) throw error;

        for (const rec of data ?? []) {
          const label = rec.month as string;
          if (!merged.has(label)) continue;
          const curCell = merged.get(label)!;
          curCell.private    += typeof rec.private_amount    === 'number' ? rec.private_amount    : parseFloat(String(rec.private_amount))    || 0;
          curCell.membership += typeof rec.membership_amount === 'number' ? rec.membership_amount : parseFloat(String(rec.membership_amount)) || 0;
          curCell.nhs        += typeof rec.nhs_amount        === 'number' ? rec.nhs_amount        : parseFloat(String(rec.nhs_amount))        || 0;
        }
      }

      // 5. DentPulse overlay when configured
      try {
        const overlay = await fetchDentpulseNhsMonthlyOverlay(
          organizationId,
          rangeStart,
          rangeEnd,
          [{
            externalIds: allExternalIds,
            locationId:
              locationId && locationId !== 'all'
                ? locationId
                : (providerRow.location_id ?? null),
            monthKeys: months,
          }],
          locationId,
        );
        const key = allExternalIds.slice().sort((a, b) => a - b).join(',');
        const byMonth = overlay.get(key);
        if (byMonth) {
          for (const m of months) {
            const cell = merged.get(m);
            if (!cell) continue;
            cell.nhs = byMonth[m] ?? 0;
          }
        }
      } catch (err) {
        console.warn('[useProviderNetProduction] DentPulse NHS overlay skipped:', err);
      }

      // 6. Build result array
      const monthlyProduction: MonthlyNetProduction[] = months.map(month => {
        const d = merged.get(month)!;
        return {
          month,
          amount:     round2(d.private + d.membership + d.nhs),
          private:    round2(d.private),
          membership: round2(d.membership),
          nhs:        round2(d.nhs),
        };
      });

      const totalProduction  = round2(monthlyProduction.reduce((s, m) => s + m.amount,     0));
      const totalPrivate     = round2(monthlyProduction.reduce((s, m) => s + m.private,    0));
      const totalMembership  = round2(monthlyProduction.reduce((s, m) => s + m.membership, 0));
      const totalNhs         = round2(monthlyProduction.reduce((s, m) => s + m.nhs,        0));

      return {
        providerName: providerRow.name || 'Provider',
        monthlyProduction,
        totalProduction,
        totalPrivate,
        totalMembership,
        totalNhs,
      };
    },
    enabled: !!organizationId && !!providerId,
  });
}
