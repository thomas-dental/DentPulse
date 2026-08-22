import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';

export interface PnlMetric {
  thisWeek: number;
  lastWeek: number;
  change: number;
  changePct: number;
  /** True when the value is a weekly equivalent pro-rated from monthly P&L
   *  (used by the Xero rows). UI can use this to show a small disclaimer. */
  isProRated?: boolean;
}

export interface PnlBreakdown {
  /** Σ `xero_journal_details.net_amount` for accounts mapped to
   *  `practice_locations.cost_of_sales_accounts`, summed over the
   *  exact week date range (no pro-rating). */
  costOfSales: number;
  /** Σ `xero_journal_details.net_amount` for accounts mapped to
   *  `practice_locations.administrative_cost_accounts`, summed over the
   *  exact week date range (no pro-rating). */
  adminCost: number;
  /** Inclusive ISO date range of the week the values represent. */
  weekStart: string | null;
  weekEnd: string | null;
  /** Production revenue from the Providers module's RPC (Dentist +
   *  Hygienist + Therapist Total Revenue). Drives the "Production
   *  revenue" row on the dashboard. */
  productionWeek: number;
  /** Production revenue from the Treatment Insights formula (every
   *  completed TPI with a payment plan, including "Other" provider
   *  roles). Drives the Gross Profit and Net Profit rows. */
  productionWeekTI: number;
}

export interface ProfitLossOverview {
  /** Production revenue = sum of TPI prices (Dentally) for Dentists +
   *  Hygienists + Therapists, summed for the week. Naturally weekly. */
  production: PnlMetric;
  /** Gross Profit = production revenue − cost of sales (mapped COAs, summed
   *  from xero_journal_details across the actual week). Cost of sales
   *  accounts are configured per location at
   *  practice_locations.cost_of_sales_accounts. */
  grossProfit: PnlMetric;
  /** Expenses = administrative cost (mapped COAs, summed from
   *  xero_journal_details across the actual week). Configured per location at
   *  practice_locations.administrative_cost_accounts. Matches the
   *  spreadsheet's "Total Administrative Costs" row. */
  expenses: PnlMetric;
  /** Net Profit = Gross Profit − Expenses. */
  netProfit: PnlMetric;
  breakdown: {
    thisPeriod: PnlBreakdown;
    lastPeriod: PnlBreakdown;
  };
  isLoading: boolean;
  error: unknown;
}

const ZERO_METRIC: PnlMetric = { thisWeek: 0, lastWeek: 0, change: 0, changePct: 0 };

function diff(thisVal: number, lastVal: number, isProRated = false): PnlMetric {
  const change = thisVal - lastVal;
  const changePct = lastVal !== 0 ? (change / Math.abs(lastVal)) * 100 : 0;
  return { thisWeek: thisVal, lastWeek: lastVal, change, changePct, isProRated };
}

function startOfWeekMonday(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay();
  const diffDays = (day + 6) % 7;
  r.setDate(r.getDate() - diffDays);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

interface XeroJournalDetailRow {
  account_id: string | null;
  net_amount: number | null;
  journal_date: string | null;
}

/**
 * Powers the Profit/Loss Overview table on the dashboard.
 *
 * **Week semantics** (Monday-start, the same convention the rest of the app uses):
 *   - "This Week" = the most recent complete week ending on or before
 *     `dateRange.endDate` (inclusive). When today is inside `dateRange`, this
 *     ends up being the live current week.
 *   - "Last Week" = the seven days immediately before "This Week".
 *
 * **Production revenue** is naturally weekly: sums TPI prices completed in
 * each week for clinical providers (Dentist + Hygienist + Therapist).
 *
 * **Gross Profit / Expenses / Net Profit** come from `xero_journal_details`,
 * summed at the line level by `journal_date` within the actual week range
 * (no pro-rating, no monthly aggregation). Accounts in scope are configured
 * per location at:
 *   - practice_locations.cost_of_sales_accounts       → Cost of Sales
 *   - practice_locations.administrative_cost_accounts → Admin Cost (Expenses)
 *
 *   gross_profit = production_revenue − cost_of_sales (week)
 *   expenses     = admin_cost (week)
 *   net_profit   = gross_profit − expenses
 */
export interface ProfitLossOverviewOverrides {
  /** Override the "This Week" column date range. */
  thisStart?: Date | null;
  thisEnd?: Date | null;
  /** Override the "Last Week" column date range. */
  lastStart?: Date | null;
  lastEnd?: Date | null;
}

export function useProfitLossOverview(
  overrides?: ProfitLossOverviewOverrides,
): ProfitLossOverview {
  const { organizationId } = useOrganization();
  const { selectedLocationId, selectedRegionId, dateRange } = useFilters();
  const { allAvailableLocations } = useLocations();

  const ovThisStartMs = overrides?.thisStart ? overrides.thisStart.getTime() : null;
  const ovThisEndMs   = overrides?.thisEnd   ? overrides.thisEnd.getTime()   : null;
  const ovLastStartMs = overrides?.lastStart ? overrides.lastStart.getTime() : null;
  const ovLastEndMs   = overrides?.lastEnd   ? overrides.lastEnd.getTime()   : null;

  // Anchor "this week" to dateRange.endDate so the table follows the global
  // top filter. If the filter ends today, this week is the live current week.
  // Each column may be independently overridden via `overrides`.
  const { thisStart, thisEnd, lastStart, lastEnd } = useMemo(() => {
    const anchor = dateRange.endDate;
    const tStart = ovThisStartMs ? new Date(ovThisStartMs) : startOfWeekMonday(anchor);
    const tEnd   = ovThisEndMs   ? endOfDay(new Date(ovThisEndMs)) : endOfDay(addDays(tStart, 6));
    const lStart = ovLastStartMs ? new Date(ovLastStartMs) : addDays(tStart, -7);
    const lEnd   = ovLastEndMs   ? endOfDay(new Date(ovLastEndMs)) : endOfDay(addDays(lStart, 6));
    return { thisStart: tStart, thisEnd: tEnd, lastStart: lStart, lastEnd: lEnd };
  }, [dateRange.endDate, ovThisStartMs, ovThisEndMs, ovLastStartMs, ovLastEndMs]);

  const locationIdsForQuery = useMemo<string[] | null>(() => {
    const visible = (allAvailableLocations || []).filter(
      (l: any) => !l.exclude_from_financial_display,
    );
    if (selectedLocationId) {
      const loc = visible.find((l) => l.id === selectedLocationId);
      // Hidden location selected → empty result set
      if (!loc && allAvailableLocations.some((l: any) => l.id === selectedLocationId && l.exclude_from_financial_display)) {
        return [];
      }
      return [selectedLocationId];
    }
    if (selectedRegionId) {
      const ids = visible
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
      'profit-loss-overview-v21',
      organizationId,
      locationKey,
      thisStart.toISOString(),
      thisEnd.toISOString(),
      lastStart.toISOString(),
      lastEnd.toISOString(),
    ],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{
      production: PnlMetric;
      grossProfit: PnlMetric;
      expenses: PnlMetric;
      netProfit: PnlMetric;
      breakdown: { thisPeriod: PnlBreakdown; lastPeriod: PnlBreakdown };
    }> => {
      const blankBreakdown = (): PnlBreakdown => ({
        costOfSales: 0,
        adminCost: 0,
        weekStart: null,
        weekEnd: null,
        productionWeek: 0,
        productionWeekTI: 0,
      });
      const empty = {
        production: ZERO_METRIC,
        grossProfit: ZERO_METRIC,
        expenses: ZERO_METRIC,
        netProfit: ZERO_METRIC,
        breakdown: { thisPeriod: blankBreakdown(), lastPeriod: blankBreakdown() },
      };
      if (!organizationId) return empty;
      if (locationIdsForQuery && locationIdsForQuery.length === 0) return empty;

      // ── Resolve xero_tenant_id list for region/location scope ────
      let tenantIds: string[] | null = null;
      let trackingOptionIds: string[] = [];
      if (locationIdsForQuery && locationIdsForQuery.length > 0) {
        const { data: mappingRows } = await (supabase as any)
          .from('platform_integration_organization_mapping')
          .select('location_id, platform_integration_organizations_id, xero_tracking_option_id')
          .eq('organization_id', organizationId)
          .in('location_id', locationIdsForQuery);

        const set = new Set<string>();
        const trackingSet = new Set<string>();
        for (const row of (mappingRows ?? []) as Array<{
          location_id: string;
          platform_integration_organizations_id: string;
          xero_tracking_option_id?: string | null;
        }>) {
          if (row.platform_integration_organizations_id) {
            set.add(row.platform_integration_organizations_id);
          }
          if (row.xero_tracking_option_id) {
            trackingSet.add(String(row.xero_tracking_option_id));
          }
        }
        tenantIds = [...set];
        trackingOptionIds = [...trackingSet];
        if (tenantIds.length === 0) return empty;
      }

      // ── Resolve mapped COA UUIDs from practice_locations ──────────
      // administrative_cost_accounts → "Expenses" row
      // cost_of_sales_accounts       → subtracted from production for Gross Profit
      const locScopeIds = locationIdsForQuery; // null => all locations in org
      let plQuery = (supabase as any)
        .from('practice_locations')
        .select('administrative_cost_accounts, cost_of_sales_accounts')
        .eq('organization_id', organizationId);
      if (locScopeIds && locScopeIds.length > 0) {
        plQuery = plQuery.in('id', locScopeIds);
      }
      const { data: locRows } = await plQuery;

      const adminCoaUuids = new Set<string>();
      const cogsCoaUuids = new Set<string>();
      for (const row of (locRows ?? []) as Array<{
        administrative_cost_accounts: string[] | null;
        cost_of_sales_accounts: string[] | null;
      }>) {
        for (const u of (row.administrative_cost_accounts ?? [])) {
          if (u) adminCoaUuids.add(String(u));
        }
        for (const u of (row.cost_of_sales_accounts ?? [])) {
          if (u) cogsCoaUuids.add(String(u));
        }
      }

      // Translate COA UUIDs → Xero account GUIDs (used in xero_journal_details.account_id).
      const allUuids = [...new Set([...adminCoaUuids, ...cogsCoaUuids])];
      const adminXeroIds = new Set<string>();
      const cogsXeroIds = new Set<string>();
      if (allUuids.length > 0) {
        const { data: coaRows } = await (supabase as any)
          .from('xero_chart_of_accounts')
          .select('id, xero_account_id')
          .eq('organization_id', organizationId)
          .in('id', allUuids);
        for (const c of (coaRows ?? []) as Array<{ id: string; xero_account_id: string }>) {
          if (!c.xero_account_id) continue;
          if (adminCoaUuids.has(c.id)) adminXeroIds.add(c.xero_account_id);
          if (cogsCoaUuids.has(c.id))  cogsXeroIds.add(c.xero_account_id);
        }
      }

      // ── Sum journal details by exact date range (no pro-rating) ────
      // xero_journal_details is the line-level GL feed: every bill, payment,
      // credit note and manual journal posts a row here, keyed by account_id
      // and journal_date. Summing net_amount in the actual week range gives
      // the accurate cost — no monthly average, no 7/days_in_month factor.
      let thisCogs = 0;
      let lastCogs = 0;
      let thisAdmin = 0;
      let lastAdmin = 0;
      const xeroAccountIds = [...new Set([...adminXeroIds, ...cogsXeroIds])];

      if (xeroAccountIds.length > 0) {
        // Fetch the union of both ranges so each column can be independently
        // overridden — including overlapping ranges like
        // "This Year" vs "This Month".
        const fetchStartIso = toIsoDate(
          lastStart.getTime() < thisStart.getTime() ? lastStart : thisStart,
        );
        const fetchEndIso = toIsoDate(
          lastEnd.getTime() > thisEnd.getTime() ? lastEnd : thisEnd,
        );
        const jdRows = await fetchAll<XeroJournalDetailRow>(() => {
          let q = (supabase as any)
            .from('xero_journal_details')
            .select('account_id, net_amount, journal_date')
            .eq('organization_id', organizationId)
            .in('account_id', xeroAccountIds)
            .gte('journal_date', fetchStartIso)
            .lte('journal_date', fetchEndIso);
          if (tenantIds && tenantIds.length === 1) {
            q = q.eq('platform_integration_organization_id', tenantIds[0]);
          } else if (tenantIds && tenantIds.length > 1) {
            q = q.in('platform_integration_organization_id', tenantIds);
          }
          if (trackingOptionIds.length === 1) {
            q = q.contains('tracking_option_ids', [trackingOptionIds[0]]);
          } else if (trackingOptionIds.length > 1) {
            q = q.overlaps('tracking_option_ids', trackingOptionIds);
          }
          return q;
        });

        const thisStartIso = toIsoDate(thisStart);
        const thisEndIso   = toIsoDate(thisEnd);
        const lastStartIso = toIsoDate(lastStart);
        const lastEndIso   = toIsoDate(lastEnd);
        for (const r of jdRows) {
          if (!r.account_id || !r.journal_date) continue;
          const amount = Number(r.net_amount) || 0;
          if (amount === 0) continue;
          const inThis = r.journal_date >= thisStartIso && r.journal_date <= thisEndIso;
          const inLast = r.journal_date >= lastStartIso && r.journal_date <= lastEndIso;
          if (adminXeroIds.has(r.account_id)) {
            if (inThis) thisAdmin += amount;
            if (inLast) lastAdmin += amount;
          }
          if (cogsXeroIds.has(r.account_id)) {
            if (inThis) thisCogs += amount;
            if (inLast) lastCogs += amount;
          }
        }
      }

      // Xero journal NetAmount sign convention: debits to expense accounts
      // are negative, credits are positive. The natural sum for an expense
      // account is therefore negative; flip via abs to display a positive
      // cost. (Refunds within the period reduce the magnitude correctly
      // because they have the opposite sign within the same account.)
      thisCogs  = Math.abs(thisCogs);
      lastCogs  = Math.abs(lastCogs);
      thisAdmin = Math.abs(thisAdmin);
      lastAdmin = Math.abs(lastAdmin);

      // ── Production revenue: identical to Providers module ─────────
      // Calls the SAME stored procedure used by the Providers module's
      // "Total Revenue" card (`chart_get_production_metrics`), once per
      // provider type (Dentist / Hygienist / Therapist), once per range.
      // The dashboard's Production Revenue equals
      //   Dentist Total Revenue + Hygienist Total Revenue + Therapist Total Revenue
      // for the same date range and location filter — by construction.
      // No JS-side filtering or fetching: the SQL is the single source
      // of truth, so JS-vs-SQL drift is impossible.
      const productionTotalForRange = async (
        startDate: Date,
        endDate: Date,
      ): Promise<number> => {
        const callOnce = async (locId: string | null): Promise<number> => {
          const types = ['Dentist', 'Hygienist', 'Therapist'];
          const sums = await Promise.all(
            types.map(async (t) => {
              const params: Record<string, unknown> = {
                p_start_date: toIsoDate(startDate),
                p_end_date: toIsoDate(endDate),
                p_organization_id: organizationId,
                p_provider_type: t,
              };
              if (locId) params.p_location_id = locId;
              const { data, error } = await (supabase as any).rpc(
                'chart_get_production_metrics',
                params,
              );
              if (error) {
                console.error('[useProfitLossOverview] production RPC error:', error);
                throw error;
              }
              const rows = (data ?? []) as Array<{ production_amount: number | string }>;
              return rows.reduce(
                (s, r) => s + (Number(r.production_amount) || 0),
                0,
              );
            }),
          );
          return sums.reduce((a, b) => a + b, 0);
        };

        if (locationIdsForQuery && locationIdsForQuery.length === 1) {
          // Single location — pass through to RPC.
          return callOnce(locationIdsForQuery[0]);
        }
        if (locationIdsForQuery && locationIdsForQuery.length > 1) {
          // Region scope — call per location and sum (matches the user
          // picking each location in the Providers module and adding up).
          const sums = await Promise.all(
            locationIdsForQuery.map((id) => callOnce(id)),
          );
          return sums.reduce((a, b) => a + b, 0);
        }
        // Org-wide.
        return callOnce(null);
      };

      const sameRange =
        thisStart.getTime() === lastStart.getTime() &&
        thisEnd.getTime() === lastEnd.getTime();

      // Production revenue — Providers-RPC (Dentist + Hygienist +
      // Therapist Total Revenue). One RPC call set per range; sameRange
      // shortcut avoids duplicating the call when both columns share a
      // date window.
      const [thisProduction, lastProductionMaybe] = await Promise.all([
        productionTotalForRange(thisStart, thisEnd),
        sameRange
          ? Promise.resolve(0)
          : productionTotalForRange(lastStart, lastEnd),
      ]);
      const lastProduction = sameRange ? thisProduction : lastProductionMaybe;

      // Gross profit = production revenue − cost of sales.
      const thisGross = thisProduction - thisCogs;
      const lastGross = lastProduction - lastCogs;
      // Expenses = administrative cost.
      const thisExp = thisAdmin;
      const lastExp = lastAdmin;
      // Net profit = gross profit − expenses
      //            = production − cost of sales − admin.
      const thisNet = thisGross - thisExp;
      const lastNet = lastGross - lastExp;

      return {
        production: diff(thisProduction, lastProduction),
        grossProfit: diff(thisGross, lastGross),
        expenses: diff(thisExp, lastExp),
        netProfit: diff(thisNet, lastNet),
        breakdown: {
          thisPeriod: {
            costOfSales: thisCogs,
            adminCost: thisAdmin,
            weekStart: toIsoDate(thisStart),
            weekEnd: toIsoDate(thisEnd),
            productionWeek: thisProduction,
            productionWeekTI: thisProduction,
          },
          lastPeriod: {
            costOfSales: lastCogs,
            adminCost: lastAdmin,
            weekStart: toIsoDate(lastStart),
            weekEnd: toIsoDate(lastEnd),
            productionWeek: lastProduction,
            productionWeekTI: lastProduction,
          },
        },
      };
    },
  });

  const blankBreakdown: PnlBreakdown = {
    costOfSales: 0, adminCost: 0,
    weekStart: null, weekEnd: null,
    productionWeek: 0, productionWeekTI: 0,
  };

  return {
    production: data?.production ?? ZERO_METRIC,
    grossProfit: data?.grossProfit ?? ZERO_METRIC,
    expenses: data?.expenses ?? ZERO_METRIC,
    netProfit: data?.netProfit ?? ZERO_METRIC,
    breakdown: data?.breakdown ?? { thisPeriod: blankBreakdown, lastPeriod: blankBreakdown },
    isLoading,
    error,
  };
}
