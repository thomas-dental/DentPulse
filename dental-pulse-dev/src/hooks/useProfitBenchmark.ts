/**
 * useProfitBenchmark Hook
 * Fetches profit benchmark data from edge function with date range and filters.
 * When the selected location has a Xero Practice tracking option, actual £
 * amounts are recomputed from xero_journal_details for that option so the
 * Profitability screen matches the mapped practice (e.g. Appoline Dental Care).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import {
  applyXeroJournalLocationScope,
  resolveLocationXeroJournalScope,
  type XeroJournalLocationScope,
} from '@/lib/xeroTrackingFilter';
import {
  getProfitBenchmark,
  ProfitBenchmarkRequest,
  ProfitBenchmarkResponse,
  ProfitBenchmarkRow,
} from '@/services/profitBenchmarkService';

function normalizeLocationIdForRequest(locationId: string | null | undefined): string | null | undefined {
  if (locationId == null || locationId === '') return undefined;
  if (String(locationId).toLowerCase() === 'all') return undefined;
  return locationId;
}

const PAGE = 1000;
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function isPlAccountType(value: string): boolean {
  const t = (value || '').trim().toUpperCase();
  if (!t) return true;
  if (t === 'PL' || t === 'P&L') return true;
  if (t.includes('PROFIT') && t.includes('LOSS')) return true;
  if (t.includes('INCOME') || t.includes('EXPENSE') || t.includes('REVENUE') || t.includes('SALES')) return true;
  if (t.includes('COST') || t.includes('OVERHEAD')) return true;
  return false;
}

/**
 * Recompute cost/expense actualAmount from journals scoped to Practice tracking.
 * Mirrors profit-benchmark Xero sign: expenseNet = net_amount.
 */
async function overlayTrackingScopedActuals(
  organizationId: string,
  locationId: string,
  fromDate: string,
  toDate: string,
  scope: XeroJournalLocationScope,
  response: ProfitBenchmarkResponse,
): Promise<ProfitBenchmarkResponse> {
  if (scope.trackingOptionIds.length === 0) return response;

  const groupIds = response.rows
    .filter((r) => !r.isProfitRow && r.groupAccountMasterId != null)
    .map((r) => Number(r.groupAccountMasterId))
    .filter((id) => Number.isFinite(id));
  if (groupIds.length === 0) return response;

  const { data: gaRows, error: gaErr } = await (supabase as any)
    .from('group_account')
    .select('group_account_master_id, account_id')
    .eq('organization_id', organizationId)
    .eq('mapping_location_id', locationId)
    .in('group_account_master_id', groupIds);
  if (gaErr) throw gaErr;

  const groupsByAccount = new Map<string, number[]>();
  for (const row of (gaRows ?? []) as Array<{
    group_account_master_id: number;
    account_id: string | null;
  }>) {
    const aid = String(row.account_id || '').trim().toLowerCase();
    const gid = Number(row.group_account_master_id);
    if (!aid || !Number.isFinite(gid)) continue;
    const list = groupsByAccount.get(aid) || [];
    list.push(gid);
    groupsByAccount.set(aid, list);
  }

  const groupTotals = new Map<number, number>();
  const accountIds = [...groupsByAccount.keys()];
  if (accountIds.length > 0) {
    let offset = 0;
    while (true) {
      let q = (supabase as any)
        .from('xero_journal_details')
        .select('id, account_id, account_type, net_amount, gross_amount')
        .eq('organization_id', organizationId)
        .in('account_id', accountIds)
        .gte('journal_date', fromDate)
        .lte('journal_date', toDate)
        .order('journal_date', { ascending: true })
        .order('id', { ascending: true });
      q = applyXeroJournalLocationScope(q, scope);
      const { data, error } = await q.range(offset, offset + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        account_id?: string | null;
        account_type?: string | null;
        net_amount?: number | string | null;
        gross_amount?: number | string | null;
      }>;
      for (const row of rows) {
        const acctId = String(row.account_id || '').trim().toLowerCase();
        const gids = groupsByAccount.get(acctId);
        if (!gids?.length) continue;
        if (!isPlAccountType(String(row.account_type || ''))) continue;
        const raw =
          row.net_amount != null && row.net_amount !== ''
            ? Number(row.net_amount)
            : Number(row.gross_amount) || 0;
        if (!Number.isFinite(raw) || raw === 0) continue;
        for (const gid of gids) {
          groupTotals.set(gid, (groupTotals.get(gid) || 0) + raw);
        }
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }

  const nextRows: ProfitBenchmarkRow[] = response.rows.map((r) => {
    if (r.isProfitRow || r.groupAccountMasterId == null) return r;
    const amount = groupTotals.get(Number(r.groupAccountMasterId)) || 0;
    return { ...r, actualAmount: round2(amount) };
  });

  return { ...response, rows: nextRows };
}

export function useProfitBenchmark(
  fromDate?: string,
  toDate?: string,
  filters?: Partial<ProfitBenchmarkRequest>,
  /** Global practice location filter (null / omitted = all locations). */
  selectedLocationId?: string | null
) {
  const { organizationId } = useOrganization();
  const locationId = normalizeLocationIdForRequest(selectedLocationId);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      'profit-benchmark-v3-tracking',
      organizationId,
      fromDate,
      toDate,
      locationId ?? 'all',
      filters,
    ],
    queryFn: async (): Promise<ProfitBenchmarkResponse> => {
      if (!organizationId || !fromDate || !toDate) {
        return {
          rows: [],
          productionIncome: 0,
          incomeBreakdown: {
            privateIncome: 0,
            membershipIncome: 0,
            nhsIncome: 0,
            productionIncome: 0,
            fromRevenueMappings: false,
          },
          platformIntegrationId: null,
          resultMsg: 'Missing params',
          status: 0,
        };
      }

      const journalScope = locationId
        ? await resolveLocationXeroJournalScope(organizationId, [locationId])
        : null;

      const request: ProfitBenchmarkRequest = {
        fromDate,
        toDate,
        comparisonType: null,
        entityId: null,
        revenueMin: null,
        revenueMax: null,
        ebitdaMarginMin: null,
        ebitdaMarginMax: null,
        ...filters,
        locationId: locationId ?? filters?.locationId ?? null,
        trackingOptionId: journalScope?.trackingOptionId ?? filters?.trackingOptionId ?? null,
      };

      const response = await getProfitBenchmark(organizationId, request);
      if (locationId && journalScope && journalScope.trackingOptionIds.length > 0) {
        return overlayTrackingScopedActuals(
          organizationId,
          locationId,
          fromDate,
          toDate,
          journalScope,
          response,
        );
      }
      return response;
    },
    enabled: !!organizationId && !!fromDate && !!toDate,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    rows: data?.rows ?? [],
    productionIncome: data?.productionIncome ?? 0,
    incomeBreakdown: data?.incomeBreakdown ?? null,
    platformIntegrationId: data?.platformIntegrationId ?? null,
    resultMsg: data?.resultMsg,
    status: data?.status,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
