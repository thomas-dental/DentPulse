import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

const PAGE_SIZE = 1000;

export interface PLCostEntry {
  account_code: string;
  account_name: string;
  amount: number;
  period_date: string;
}

export interface PLCostResult {
  entries: PLCostEntry[];
  totalAmount: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches cost data from iplicit_profit_loss table for given account codes/UUIDs.
 * Used by Lab Fees, Staff Costs, Operating Leases, Clinician Costs, Overhead Costs, Material Costs pages.
 * Filters by legal_entity_id when a location is selected and has a Practice Location Mapping.
 */
export function useIplicitPLCosts(
  accountCodes: string[],
  accountUuids: string[],
  fromDate: string,
  toDate: string,
  enabled: boolean = true,
  selectedLocationId?: string | null,
): PLCostResult {
  const { organizationId } = useOrganization();

  const { data, isLoading, error } = useQuery({
    queryKey: ['iplicit-pl-costs', organizationId, accountCodes.join(','), accountUuids.join(','), fromDate, toDate, selectedLocationId || 'all'],
    queryFn: async () => {
      if (!organizationId) return { entries: [], totalAmount: 0 };

      // Resolve UUIDs to account codes via iplicit_chart_of_accounts
      const resolvedCodes = new Set<string>(accountCodes);
      const resolvedIds = new Set<string>();
      const accountIdToInfo = new Map<string, { code: string; name: string }>();

      if (accountUuids.length > 0) {
        const { data: coaRows } = await (supabase as any)
          .from('iplicit_chart_of_accounts')
          .select('code, account_id, name')
          .eq('organization_id', organizationId)
          .in('id', accountUuids);

        for (const row of (coaRows ?? []) as Array<{ code: string | null; account_id: string | null; name: string | null }>) {
          if (row.code) resolvedCodes.add(row.code.trim());
          if (row.account_id) {
            resolvedIds.add(row.account_id.trim());
            accountIdToInfo.set(row.account_id.trim(), {
              code: row.code?.trim() || '',
              name: row.name?.trim() || '',
            });
          }
        }
      }

      if (resolvedCodes.size === 0 && resolvedIds.size === 0) {
        console.log('[useIplicitPLCosts] No account codes/IDs resolved');
        return { entries: [], totalAmount: 0 };
      }

      // Resolve legal entity filter from Practice Location Mapping
      let legalEntityIds: string[] = [];

      if (selectedLocationId) {
        const { data: mappingRows } = await (supabase as any)
          .from('platform_integration_organization_mapping')
          .select('platform_integration_organizations_id')
          .eq('organization_id', organizationId)
          .eq('location_id', selectedLocationId);

        if (mappingRows && mappingRows.length > 0) {
          const pioIds = (mappingRows as Array<{ platform_integration_organizations_id: string }>).map(m => m.platform_integration_organizations_id);
          const { data: pioRows } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('platform_org_id')
            .in('id', pioIds);

          legalEntityIds = ((pioRows ?? []) as Array<{ platform_org_id: string | null }>)
            .map(p => p.platform_org_id)
            .filter((v): v is string => !!v);
        }
      }

      // Query iplicit_profit_loss
      //
      // iplicit_profit_loss stores one row per account per accounting period,
      // dated to the FIRST of the month. A strict `period_date >= fromDate`
      // loses the first month whenever fromDate isn't itself a 1st — a custom
      // range like "Apr 15 – May 31" would miss all of April. Normalise to
      // the start of fromDate's month so any overlapping month is included.
      //
      // We also push the account_code/account_id match down to Postgres via
      // .or() rather than fetching every account's rows and filtering in JS.
      // Previously a long date range ("Last Year") pulled the full P&L for
      // the org every call; now the server returns only matching rows.
      let from = 0;
      let hasMore = true;
      const entries: PLCostEntry[] = [];
      let totalAmount = 0;

      const codesArray = [...resolvedCodes];
      const idsArray = [...resolvedIds];
      const periodDateFloor = fromDate.slice(0, 8) + '01';

      const esc = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
      const orParts: string[] = [];
      if (codesArray.length > 0) orParts.push(`account_code.in.(${codesArray.map(esc).join(',')})`);
      if (idsArray.length > 0) orParts.push(`account_id.in.(${idsArray.map(esc).join(',')})`);
      const orFilter = orParts.join(',');

      while (hasMore) {
        let query = (supabase as any)
          .from('iplicit_profit_loss')
          .select('amount, account_code, account_id, period_date')
          .eq('organization_id', organizationId)
          .gte('period_date', periodDateFloor)
          .lte('period_date', toDate + 'T23:59:59')
          .or(orFilter);

        // Filter by legal entity when mapped
        if (legalEntityIds.length === 1) {
          query = query.eq('legal_entity_id', legalEntityIds[0]);
        } else if (legalEntityIds.length > 1) {
          query = query.in('legal_entity_id', legalEntityIds);
        }

        const { data: rows, error: plError } = await query.range(from, from + PAGE_SIZE - 1);

        if (plError) {
          console.error('[useIplicitPLCosts] Query error:', plError);
          break;
        }

        for (const r of (rows ?? []) as Array<{ amount: unknown; account_code: string | null; account_id: string | null; period_date: string | null }>) {
          const code = (r.account_code || '').trim();
          const id = (r.account_id || '').trim();
          const matchesCode = codesArray.some(c => c === code);
          const matchesId = idsArray.some(i => i === id);

          if (matchesCode || matchesId) {
            const amount = Number(r.amount) || 0;
            const info = id ? accountIdToInfo.get(id) : null;
            entries.push({
              account_code: code || info?.code || 'Unknown',
              account_name: info?.name || code || 'Unknown',
              amount,
              period_date: r.period_date || '',
            });
            totalAmount += amount;
          }
        }

        hasMore = (rows ?? []).length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      console.log('[useIplicitPLCosts]', {
        resolvedCodes: codesArray,
        resolvedIds: idsArray,
        legalEntityFilter: legalEntityIds.length > 0 ? legalEntityIds : 'none (all entities)',
        entriesFound: entries.length,
        totalAmount: `£${totalAmount.toFixed(2)}`,
        dateRange: `${fromDate} to ${toDate}`,
      });

      return { entries, totalAmount };
    },
    enabled: enabled && !!organizationId && (accountCodes.length > 0 || accountUuids.length > 0),
  });

  return {
    entries: data?.entries ?? [],
    totalAmount: data?.totalAmount ?? 0,
    isLoading,
    error: error ? (error as Error).message : null,
  };
}
