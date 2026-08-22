import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import type { LineItem, FinancialSection } from '@/data/financialReportsData';
import { computePLSummary, computeBSSummary } from '@/lib/financialSummary';

const PAGE_SIZE = 1000;

// ── Legal entity hook ──────────────────────────────────────────────

export interface IplicitLegalEntity {
  id: string;
  platform_org_id: string;
  platform_org_name: string;
  platform_org_code: string | null;
}

export function useIplicitLegalEntities() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['iplicit-legal-entities', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('platform_integration_organizations')
        .select('id, platform_org_id, platform_org_name, platform_org_code')
        .eq('organization_id', organizationId)
        .eq('platform_name', 'iplicit')
        .eq('status', 'active')
        .order('platform_org_name');

      if (error) {
        console.error('[useIplicitLegalEntities] error:', error);
        return [];
      }
      return (data ?? []) as IplicitLegalEntity[];
    },
    enabled: !!organizationId,
  });
}

// ── Iplicit row types ──────────────────────────────────────────────

interface CoaAccountGroup {
  account_group_id: string;
  account_type: string; // 'PL' | 'BS'
  code: string | null;
  description: string | null;
  parent_coa_group_id: string | null;
  order_index: number | null;
  is_active: boolean;
}

interface CoaAccount {
  account_id: string;
  coa_group_id: string | null;
  code: string | null;
  name: string | null;
  account_type: string; // 'PL' | 'BS'
  is_active: boolean;
}

interface AmountRow {
  account_id: string | null;
  amount: unknown;
}

// ── Helper: paginated fetch ────────────────────────────────────────

async function fetchAllRows(
  table: string,
  organizationId: string,
  fromDate: string,
  toDate: string,
  legalEntityId?: string,
  financialYearId?: string | null,
): Promise<AmountRow[]> {
  const all: AmountRow[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = (supabase as any)
      .from(table)
      .select('account_id, amount')
      .eq('organization_id', organizationId);

    // For BS with a known financial_year_id, filter by FY instead of date range
    // to avoid picking up opening balance journal entries
    if (financialYearId) {
      query = query.eq('financial_year_id', financialYearId);
    } else {
      query = query
        .gte('period_date', fromDate)
        .lte('period_date', toDate + 'T23:59:59');
    }

    if (legalEntityId) {
      query = query.eq('legal_entity_id', legalEntityId);
    }

    const { data: rows, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error(`[useIplicitReports] ${table} query error:`, error);
      break;
    }

    const batch = (rows ?? []) as AmountRow[];
    all.push(...batch);
    hasMore = batch.length === PAGE_SIZE;
    from += PAGE_SIZE;
  }

  return all;
}

// ── Helper: aggregate rows by account_id ──────────────────────────

function aggregateByAccount(rows: AmountRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const id = (r.account_id || '').trim();
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + (Number(r.amount) || 0));
  }
  return map;
}

// ── Helper: date formatting ───────────────────────────────────────

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftBack12Months(d: Date): Date {
  const copy = new Date(d);
  copy.setFullYear(copy.getFullYear() - 1);
  return copy;
}

// ── Build sections from COA hierarchy + amounts ───────────────────

function buildSections(
  groups: CoaAccountGroup[],
  accounts: CoaAccount[],
  currentAmounts: Map<string, number>,
  priorAmounts: Map<string, number>,
  accountType: 'PL' | 'BS',
): FinancialSection[] {
  // Filter to the relevant account type
  const typeGroups = groups.filter((g) => g.account_type === accountType && g.is_active);
  const typeAccounts = accounts.filter((a) => a.account_type === accountType && a.is_active);

  // Index groups by id
  const groupById = new Map<string, CoaAccountGroup>();
  for (const g of typeGroups) groupById.set(g.account_group_id, g);

  // Find top-level groups (no parent or parent not in our set)
  const topLevelGroups = typeGroups
    .filter((g) => !g.parent_coa_group_id || !groupById.has(g.parent_coa_group_id))
    .sort((a, b) => (a.order_index ?? 999) - (b.order_index ?? 999));

  // Map child groups to parent
  const childGroupsByParent = new Map<string, CoaAccountGroup[]>();
  for (const g of typeGroups) {
    if (g.parent_coa_group_id && groupById.has(g.parent_coa_group_id)) {
      const list = childGroupsByParent.get(g.parent_coa_group_id) ?? [];
      list.push(g);
      childGroupsByParent.set(g.parent_coa_group_id, list);
    }
  }

  // Index accounts by coa_group_id
  const accountsByGroup = new Map<string, CoaAccount[]>();
  for (const a of typeAccounts) {
    if (!a.coa_group_id) continue;
    const list = accountsByGroup.get(a.coa_group_id) ?? [];
    list.push(a);
    accountsByGroup.set(a.coa_group_id, list);
  }

  // Recursively collect all group IDs under a parent (including the parent itself)
  function collectGroupIds(groupId: string): string[] {
    const ids = [groupId];
    const children = childGroupsByParent.get(groupId) ?? [];
    for (const child of children) {
      ids.push(...collectGroupIds(child.account_group_id));
    }
    return ids;
  }

  // Build line items for a group (direct accounts + child group sub-items)
  function buildLineItems(groupId: string): LineItem[] {
    const items: LineItem[] = [];

    // Direct accounts in this group
    const directAccounts = accountsByGroup.get(groupId) ?? [];
    for (const acc of directAccounts) {
      items.push({
        id: acc.account_id,
        name: acc.name || acc.code || 'Unknown',
        currentPeriod: currentAmounts.get(acc.account_id) ?? 0,
        priorPeriod: priorAmounts.get(acc.account_id) ?? 0,
        budget: 0,
        source: 'Iplicit',
        sourceLink: '/settings',
      });
    }

    // Child groups become line items with children
    const children = (childGroupsByParent.get(groupId) ?? []).sort(
      (a, b) => (a.order_index ?? 999) - (b.order_index ?? 999),
    );

    for (const child of children) {
      const childItems = buildLineItems(child.account_group_id);
      const currentTotal = childItems.reduce((s, i) => s + i.currentPeriod, 0);
      const priorTotal = childItems.reduce((s, i) => s + i.priorPeriod, 0);

      items.push({
        id: child.account_group_id,
        name: child.description || child.code || 'Unknown',
        currentPeriod: currentTotal,
        priorPeriod: priorTotal,
        budget: 0,
        source: 'Iplicit',
        sourceLink: '/settings',
        children: childItems.length > 0 ? childItems : undefined,
      });
    }

    return items;
  }

  // Build sections from top-level groups
  const sections: FinancialSection[] = [];
  for (const tl of topLevelGroups) {
    const items = buildLineItems(tl.account_group_id);

    // Also include accounts directly attached to this top-level group that aren't already captured
    const allGroupIds = collectGroupIds(tl.account_group_id);
    let currentTotal = 0;
    let priorTotal = 0;
    for (const gid of allGroupIds) {
      for (const acc of accountsByGroup.get(gid) ?? []) {
        currentTotal += currentAmounts.get(acc.account_id) ?? 0;
        priorTotal += priorAmounts.get(acc.account_id) ?? 0;
      }
    }

    sections.push({
      id: tl.account_group_id,
      name: tl.description || tl.code || 'Unknown',
      items,
      total: {
        currentPeriod: currentTotal,
        priorPeriod: priorTotal,
        budget: 0,
      },
    });
  }

  return sections;
}

// ── Main hook ─────────────────────────────────────────────────────

export function useIplicitReports(legalEntityId?: string) {
  const { organizationId } = useOrganization();
  const { dateRange } = useFilters();

  const currentFrom = toISODate(dateRange.startDate);
  const currentTo = toISODate(dateRange.endDate);
  const priorFrom = toISODate(shiftBack12Months(dateRange.startDate));
  const priorTo = toISODate(shiftBack12Months(dateRange.endDate));

  const { data, isLoading } = useQuery({
    queryKey: ['iplicit-reports', organizationId, currentFrom, currentTo, legalEntityId ?? 'all'],
    queryFn: async () => {
      if (!organizationId) {
        return { groups: [], accounts: [], currentPL: [], priorPL: [], currentBS: [], priorBS: [] };
      }

      // Step 1: Discover financial_year_ids for both P&L and BS
      // This avoids picking up data from adjacent FYs when date range crosses FY boundaries

      // Helper to find the most recent financial_year_id from a table within a date range
      async function discoverFYId(table: string, from: string, to: string): Promise<string | null> {
        const { data: rows } = await (supabase as any)
          .from(table)
          .select('financial_year_id, period_date')
          .eq('organization_id', organizationId)
          .gte('period_date', from)
          .lte('period_date', to + 'T23:59:59')
          .not('financial_year_id', 'is', null)
          .order('period_date', { ascending: false })
          .limit(1);
        return rows?.[0]?.financial_year_id ?? null;
      }

      // Discover FY IDs for current and prior periods (both PL and BS)
      const [currentPLFYId, priorPLFYId, currentBSFYId, priorBSFYId] = await Promise.all([
        discoverFYId('iplicit_profit_loss', currentFrom, currentTo),
        discoverFYId('iplicit_profit_loss', priorFrom, priorTo),
        discoverFYId('iplicit_balance_sheet', currentFrom, currentTo),
        discoverFYId('iplicit_balance_sheet', priorFrom, priorTo),
      ]);

      // Only use prior FY if it's different from current (avoid showing same data twice)
      const effectivePriorPLFYId = priorPLFYId !== currentPLFYId ? priorPLFYId : null;
      const effectivePriorBSFYId = priorBSFYId !== currentBSFYId ? priorBSFYId : null;

      console.log('[useIplicitReports] Financial Year IDs:', {
        currentPL: currentPLFYId, priorPL: effectivePriorPLFYId,
        currentBS: currentBSFYId, priorBS: effectivePriorBSFYId,
      });

      // Step 2: Fetch all data in parallel (using FY IDs to filter accurately)
      const [groupsRes, accountsRes, currentPLRows, priorPLRows, currentBSRows, priorBSRows] =
        await Promise.all([
          (supabase as any)
            .from('iplicit_coa_account_groups')
            .select('account_group_id, account_type, code, description, parent_coa_group_id, order_index, is_active')
            .eq('organization_id', organizationId),
          (supabase as any)
            .from('iplicit_chart_of_accounts')
            .select('account_id, coa_group_id, code, name, account_type, is_active')
            .eq('organization_id', organizationId),
          fetchAllRows('iplicit_profit_loss', organizationId, currentFrom, currentTo, legalEntityId, currentPLFYId),
          fetchAllRows('iplicit_profit_loss', organizationId, priorFrom, priorTo, legalEntityId, effectivePriorPLFYId),
          fetchAllRows('iplicit_balance_sheet', organizationId, currentFrom, currentTo, legalEntityId, currentBSFYId),
          fetchAllRows('iplicit_balance_sheet', organizationId, priorFrom, priorTo, legalEntityId, effectivePriorBSFYId),
        ]);

      if (groupsRes.error) console.error('[useIplicitReports] groups error:', groupsRes.error);
      if (accountsRes.error) console.error('[useIplicitReports] accounts error:', accountsRes.error);

      console.log('[useIplicitReports] Fetched:', {
        coaGroups: (groupsRes.data ?? []).length,
        coaAccounts: (accountsRes.data ?? []).length,
        currentPL: currentPLRows.length,
        priorPL: priorPLRows.length,
        currentBS: currentBSRows.length,
        priorBS: priorBSRows.length,
        dateRange: `${currentFrom} to ${currentTo}`,
        priorRange: `${priorFrom} to ${priorTo}`,
        legalEntityId: legalEntityId ?? 'all',
        currentPLFYId,
        currentBSFYId,
      });

      return {
        groups: (groupsRes.data ?? []) as CoaAccountGroup[],
        accounts: (accountsRes.data ?? []) as CoaAccount[],
        currentPL: currentPLRows,
        priorPL: priorPLRows,
        currentBS: currentBSRows,
        priorBS: priorBSRows,
      };
    },
    enabled: !!organizationId,
  });

  const { profitAndLossData, balanceSheetData, plSummary, bsSummary, hasData } = useMemo(() => {
    const groups = data?.groups ?? [];
    const accounts = data?.accounts ?? [];
    const currentPL = data?.currentPL ?? [];
    const priorPL = data?.priorPL ?? [];
    const currentBS = data?.currentBS ?? [];
    const priorBS = data?.priorBS ?? [];

    const hasData =
      currentPL.length > 0 || priorPL.length > 0 || currentBS.length > 0 || priorBS.length > 0;

    const currentPLAmounts = aggregateByAccount(currentPL);
    const priorPLAmounts = aggregateByAccount(priorPL);
    const currentBSAmounts = aggregateByAccount(currentBS);
    const priorBSAmounts = aggregateByAccount(priorBS);

    const profitAndLossData = buildSections(groups, accounts, currentPLAmounts, priorPLAmounts, 'PL');
    const balanceSheetData = buildSections(groups, accounts, currentBSAmounts, priorBSAmounts, 'BS');

    const plSummary = computePLSummary(profitAndLossData);
    const bsSummary = computeBSSummary(balanceSheetData);

    return { profitAndLossData, balanceSheetData, plSummary, bsSummary, hasData };
  }, [data]);

  return {
    profitAndLossData,
    balanceSheetData,
    plSummary,
    bsSummary,
    isLoading,
    hasData,
  };
}
