import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { resolveCoaMappingPlatformIntegrationId } from '@/utils/resolveCoaMappingPlatformIntegrationId';
import {
  applyXeroJournalLocationScope,
  resolveLocationXeroJournalScope,
  type XeroJournalLocationScope,
} from '@/lib/xeroTrackingFilter';
import { useOrganization } from './useOrganization';

export type IncomeSourceKind = 'pms' | 'accounting';
export type IncomeLevelKind = 'practice' | 'provider';

export interface LocationIncomeAccountingTotals {
  /** Per-type ledger totals when source = accounting + level = practice; otherwise null (use PMS / provider path). */
  private: number | null;
  membership: number | null;
  nhs: number | null;
  sources: {
    private: IncomeSourceKind;
    membership: IncomeSourceKind;
    nhs: IncomeSourceKind;
  };
  levels: {
    private: IncomeLevelKind;
    membership: IncomeLevelKind;
    nhs: IncomeLevelKind;
  };
}

const PAGE = 1000;
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function asUuidArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean);
}

function sourceOf(v: unknown, fallback: IncomeSourceKind): IncomeSourceKind {
  return String(v || fallback).toLowerCase() === 'accounting' ? 'accounting' : 'pms';
}

function levelOf(v: unknown, fallback: IncomeLevelKind = 'practice'): IncomeLevelKind {
  return String(v || fallback).toLowerCase() === 'provider' ? 'provider' : 'practice';
}

/** Paginate xero_journal_details and return abs(Σ net_amount) for the given Xero account GUIDs. */
async function sumRevenueForXeroAccounts(
  organizationId: string,
  xeroAccountIds: string[],
  fromDate: string,
  toDate: string,
  journalScope?: XeroJournalLocationScope | null,
): Promise<number> {
  if (xeroAccountIds.length === 0) return 0;
  let sum = 0;
  let from = 0;
  while (true) {
    let q = (supabase as any)
      .from('xero_journal_details')
      .select('net_amount')
      .eq('organization_id', organizationId)
      .in('account_id', xeroAccountIds)
      .gte('journal_date', fromDate)
      .lte('journal_date', toDate);
    q = applyXeroJournalLocationScope(q, journalScope);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ net_amount: number | string | null }>;
    for (const r of rows) sum += Number(r.net_amount) || 0;
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  // Xero revenue NetAmount is typically credit-negative; abs so income displays positive
  // (same contract as cashflow forecast accounting income weeks).
  return round2(Math.abs(sum));
}

/**
 * One RPC: SUM(net_amount) grouped by calendar month for the given accounts.
 * Same abs() display contract as sumRevenueForXeroAccounts.
 * Returns Map of 'MMM-yy' → amount (0 for months with no journals).
 */
async function sumRevenueForXeroAccountsByMonth(
  organizationId: string,
  xeroAccountIds: string[],
  fromDate: string,
  toDate: string,
  monthKeys: string[],
  journalScope?: XeroJournalLocationScope | null,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const k of monthKeys) out.set(k, 0);
  if (xeroAccountIds.length === 0) return out;

  // Scoped RPC accepts one tracking option. Multiple Practice options (region
  // / All Locations with several mapped practices) are summed per option.
  const useScopedRpc =
    !!journalScope && journalScope.trackingOptionIds.length <= 1;

  const { data, error } = useScopedRpc
    ? await (supabase as any).rpc('get_xero_journal_net_by_month_scoped', {
        p_organization_id: organizationId,
        p_from_date: fromDate,
        p_to_date: toDate,
        p_account_ids: xeroAccountIds,
        p_tenant_ids:
          journalScope!.tenantOrgRowIds.length > 0 ? journalScope!.tenantOrgRowIds : null,
        p_tracking_option_id: journalScope!.trackingOptionId,
      })
    : await (supabase as any).rpc('get_xero_journal_net_by_month', {
        p_organization_id: organizationId,
        p_from_date: fromDate,
        p_to_date: toDate,
        p_account_ids: xeroAccountIds,
      });
  if (error) throw error;

  for (const row of (data ?? []) as Array<{ month_start: string; net_sum: number | string | null }>) {
    const start = String(row.month_start ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const [y, m] = start.split('-').map(Number);
    const key = format(new Date(y, m - 1, 1), 'MMM-yy');
    if (!out.has(key)) continue;
    out.set(key, round2(Math.abs(Number(row.net_sum) || 0)));
  }
  return out;
}

type RevenueGroupCode = 'privateincome' | 'membershipincome' | 'nhsincome';

/**
 * Setup Categories → Profit (Revenue) mappings live in group_account with
 * account_id = COA external id (Xero account GUID). Prefer those over the
 * legacy practice_locations.*_coa_accounts UUID lists.
 */
async function fetchSetupCategoryRevenueXeroIds(
  organizationId: string,
  locationIds: string[],
): Promise<Record<RevenueGroupCode, Set<string>>> {
  const empty: Record<RevenueGroupCode, Set<string>> = {
    privateincome: new Set(),
    membershipincome: new Set(),
    nhsincome: new Set(),
  };
  if (locationIds.length === 0) return empty;

  const { data: masters, error: masterErr } = await (supabase as any)
    .from('group_account_master')
    .select('id, group_code')
    .eq('group_type', 1);
  if (masterErr) throw masterErr;

  const masterById = new Map<number, RevenueGroupCode>();
  for (const m of (masters ?? []) as Array<{ id: number; group_code: string | null }>) {
    const code = String(m.group_code || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '') as RevenueGroupCode;
    if (
      code === 'privateincome' ||
      code === 'membershipincome' ||
      code === 'nhsincome'
    ) {
      masterById.set(Number(m.id), code);
    }
  }
  if (masterById.size === 0) return empty;

  const platformId = await resolveCoaMappingPlatformIntegrationId(organizationId, null);
  const masterIds = [...masterById.keys()];

  let query = (supabase as any)
    .from('group_account')
    .select('group_account_master_id, account_id, mapping_location_id')
    .eq('organization_id', organizationId)
    .in('group_account_master_id', masterIds)
    .in('mapping_location_id', locationIds);
  if (platformId) query = query.eq('platform_integration_id', platformId);

  let { data: rows, error } = await query;
  if (error) throw error;

  // Fallback: location rows under any integration (same as profit-benchmark edge).
  if ((!rows || rows.length === 0) && locationIds.length > 0) {
    const { data: anyIntegration, error: anyErr } = await (supabase as any)
      .from('group_account')
      .select('group_account_master_id, account_id, mapping_location_id')
      .eq('organization_id', organizationId)
      .in('group_account_master_id', masterIds)
      .in('mapping_location_id', locationIds);
    if (anyErr) throw anyErr;
    rows = anyIntegration ?? rows;
  }

  for (const row of (rows ?? []) as Array<{
    group_account_master_id: number;
    account_id: string | null;
  }>) {
    const code = masterById.get(Number(row.group_account_master_id));
    const accountId = String(row.account_id || '').trim();
    if (!code || !accountId) continue;
    empty[code].add(accountId);
  }

  return empty;
}

type IncomeLevels = {
  private: IncomeLevelKind;
  membership: IncomeLevelKind;
  nhs: IncomeLevelKind;
};

const DEFAULT_LEVELS: IncomeLevels = {
  private: 'practice',
  membership: 'practice',
  nhs: 'practice',
};

function levelsFromRow(row: {
  private_income_level?: string | null;
  membership_income_level?: string | null;
  nhs_income_level?: string | null;
} | null | undefined): IncomeLevels {
  if (!row) return { ...DEFAULT_LEVELS };
  return {
    private: levelOf(row.private_income_level),
    membership: levelOf(row.membership_income_level),
    nhs: levelOf(row.nhs_income_level),
  };
}

/** Org default + per-location overrides from revenue_settings. */
async function fetchIncomeLevelMap(
  organizationId: string,
  locationIds: string[],
): Promise<{ orgDefault: IncomeLevels; byLocation: Map<string, IncomeLevels> }> {
  const { data: settingsRows, error } = await (supabase as any)
    .from('revenue_settings')
    .select(
      'location_id, private_income_level, membership_income_level, nhs_income_level',
    )
    .eq('organization_id', organizationId);
  if (error) throw error;

  let orgDefault = { ...DEFAULT_LEVELS };
  const byLocation = new Map<string, IncomeLevels>();
  for (const row of (settingsRows ?? []) as Array<{
    location_id: string | null;
    private_income_level?: string | null;
    membership_income_level?: string | null;
    nhs_income_level?: string | null;
  }>) {
    const levels = levelsFromRow(row);
    if (!row.location_id) {
      orgDefault = levels;
      continue;
    }
    if (locationIds.includes(String(row.location_id))) {
      byLocation.set(String(row.location_id), levels);
    }
  }
  return { orgDefault, byLocation };
}

/**
 * Production Income slices for Profitability.
 *
 * Revenue Settings (Setup Categories → Revenue Settings):
 *   • Income Source Level = By Provider → null (caller uses Provider Net Production)
 *   • Income Source Level = By Practice + Accounting App → ledger sum of
 *     Setup Categories → Profit (Revenue) COA mappings (group_account), with
 *     legacy practice_locations.*_coa_accounts as fallback
 *   • Revenue Source = PMS App → null (caller uses Provider Net Production)
 */
export async function fetchLocationIncomeAccountingTotals(
  organizationId: string,
  fromDate: string,
  toDate: string,
  locationId?: string | null,
  regionLocationIds?: string[] | null,
): Promise<LocationIncomeAccountingTotals> {
  const empty: LocationIncomeAccountingTotals = {
    private: null,
    membership: null,
    nhs: null,
    sources: { private: 'pms', membership: 'pms', nhs: 'pms' },
    levels: { private: 'practice', membership: 'practice', nhs: 'practice' },
  };
  if (!organizationId || !fromDate || !toDate) return empty;

  let locQ = (supabase as any)
    .from('practice_locations')
    .select(
      'id, private_income_source, membership_income_source, nhs_income_source, private_income_coa_accounts, membership_income_coa_accounts, nhs_income_coa_accounts',
    )
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  if (locationId) locQ = locQ.eq('id', locationId);
  else if (regionLocationIds?.length) locQ = locQ.in('id', regionLocationIds);

  const { data: locs, error: locErr } = await locQ;
  if (locErr) throw locErr;

  const rows = (locs ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return empty;

  const locationIds = rows.map((l) => String(l.id)).filter(Boolean);
  const { orgDefault, byLocation } = await fetchIncomeLevelMap(
    organizationId,
    locationIds,
  );
  // Displayed levels: single-location override, else org default.
  const levels =
    locationId && byLocation.has(locationId)
      ? byLocation.get(locationId)!
      : orgDefault;

  // Aggregate sources: accounting wins if ANY scoped location uses it for that type
  // (All Locations / region). Collect COA ids only from locations on accounting.
  const privateXeroIds = new Set<string>();
  const membershipXeroIds = new Set<string>();
  const nhsXeroIds = new Set<string>();
  const legacyPrivateUuids = new Set<string>();
  const legacyMembershipUuids = new Set<string>();
  const legacyNhsUuids = new Set<string>();
  let privateAccounting = false;
  let membershipAccounting = false;
  let nhsAccounting = false;

  // Track which locations use practice-level accounting so Setup Categories
  // mappings are only taken from those locations.
  const practiceAccountingLocIds = {
    private: new Set<string>(),
    membership: new Set<string>(),
    nhs: new Set<string>(),
  };

  for (const l of rows) {
    const locId = String(l.id);
    const locLevels = byLocation.get(locId) ?? orgDefault;
    const privSrc = sourceOf(l.private_income_source, 'pms');
    const memSrc = sourceOf(l.membership_income_source, 'accounting');
    const nhsSrc = sourceOf(l.nhs_income_source, 'accounting');

    // Exclude accounts claimed by another income type on the SAME location
    // (avoids Denplan double-count when mapped to Private + Membership).
    const privSet = new Set(asUuidArray(l.private_income_coa_accounts));
    const memSet = new Set(asUuidArray(l.membership_income_coa_accounts));
    const nhsSet = new Set(asUuidArray(l.nhs_income_coa_accounts));

    // By Provider → Provider Net Production path (null from this hook).
    if (privSrc === 'accounting' && locLevels.private === 'practice') {
      privateAccounting = true;
      practiceAccountingLocIds.private.add(locId);
      for (const id of privSet) {
        if (!memSet.has(id) && !nhsSet.has(id)) legacyPrivateUuids.add(id);
      }
    }
    if (memSrc === 'accounting' && locLevels.membership === 'practice') {
      membershipAccounting = true;
      practiceAccountingLocIds.membership.add(locId);
      for (const id of memSet) legacyMembershipUuids.add(id);
    }
    if (nhsSrc === 'accounting' && locLevels.nhs === 'practice') {
      nhsAccounting = true;
      practiceAccountingLocIds.nhs.add(locId);
      for (const id of nhsSet) legacyNhsUuids.add(id);
    }
  }

  // Setup Categories → Profit (Revenue) group_account mappings (Xero GUIDs).
  const setupLocIdsForFetch = [
    ...new Set([
      ...practiceAccountingLocIds.private,
      ...practiceAccountingLocIds.membership,
      ...practiceAccountingLocIds.nhs,
    ]),
  ];
  const scopedSetup =
    setupLocIdsForFetch.length > 0
      ? await fetchSetupCategoryRevenueXeroIds(organizationId, setupLocIdsForFetch)
      : {
          privateincome: new Set<string>(),
          membershipincome: new Set<string>(),
          nhsincome: new Set<string>(),
        };

  // All Locations: DISTINCT account → one revenue bucket (no cross-type double-count
  // when Hungerford/Queen Street map the same COA differently).
  const allLocationsIncome = !locationId && !regionLocationIds?.length;

  if (privateAccounting) {
    for (const id of scopedSetup.privateincome) {
      if (
        !scopedSetup.membershipincome.has(id) &&
        !scopedSetup.nhsincome.has(id)
      ) {
        privateXeroIds.add(id);
      }
    }
  }
  if (membershipAccounting) {
    for (const id of scopedSetup.membershipincome) {
      if (allLocationsIncome && scopedSetup.nhsincome.has(id)) continue;
      membershipXeroIds.add(id);
    }
  }
  if (nhsAccounting) {
    for (const id of scopedSetup.nhsincome) nhsXeroIds.add(id);
  }

  // Legacy Location Settings COA UUID → Xero GUID (only when Setup Categories
  // has no mapping for that type yet).
  const allLegacyUuids = [
    ...new Set([
      ...(privateXeroIds.size === 0 ? legacyPrivateUuids : []),
      ...(membershipXeroIds.size === 0 ? legacyMembershipUuids : []),
      ...(nhsXeroIds.size === 0 ? legacyNhsUuids : []),
    ]),
  ];
  const xeroByCoa = new Map<string, string>();
  if (allLegacyUuids.length > 0) {
    const { data: coaRows, error: coaErr } = await (supabase as any)
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id')
      .eq('organization_id', organizationId)
      .in('id', allLegacyUuids);
    if (coaErr) throw coaErr;
    for (const c of (coaRows ?? []) as Array<{ id: string; xero_account_id: string | null }>) {
      if (c.xero_account_id) xeroByCoa.set(String(c.id), String(c.xero_account_id));
    }
  }

  const addLegacy = (target: Set<string>, uuids: Set<string>) => {
    if (target.size > 0) return; // Setup Categories already supplied GUIDs
    for (const id of uuids) {
      const xeroId = xeroByCoa.get(id);
      if (xeroId) target.add(xeroId);
    }
  };
  addLegacy(privateXeroIds, legacyPrivateUuids);
  addLegacy(membershipXeroIds, legacyMembershipUuids);
  addLegacy(nhsXeroIds, legacyNhsUuids);

  const journalScope =
    locationIds.length > 0
      ? await resolveLocationXeroJournalScope(organizationId, locationIds)
      : null;

  const [privateAmt, membershipAmt, nhsAmt] = await Promise.all([
    privateAccounting
      ? privateXeroIds.size === 0
        ? // Accounting + By Practice but nothing mapped yet → £0 (do not fall
          // back to Provider Net Production; that would ignore Revenue Settings).
          Promise.resolve(0)
        : sumRevenueForXeroAccounts(
            organizationId,
            [...privateXeroIds],
            fromDate,
            toDate,
            journalScope,
          )
      : Promise.resolve(null),
    membershipAccounting
      ? membershipXeroIds.size === 0
        ? Promise.resolve(0)
        : sumRevenueForXeroAccounts(
            organizationId,
            [...membershipXeroIds],
            fromDate,
            toDate,
            journalScope,
          )
      : Promise.resolve(null),
    nhsAccounting
      ? nhsXeroIds.size === 0
        ? Promise.resolve(0)
        : sumRevenueForXeroAccounts(
            organizationId,
            [...nhsXeroIds],
            fromDate,
            toDate,
            journalScope,
          )
      : Promise.resolve(null),
  ]);

  return {
    private: privateAmt,
    membership: membershipAmt,
    nhs: nhsAmt,
    sources: {
      private: privateAccounting ? 'accounting' : 'pms',
      membership: membershipAccounting ? 'accounting' : 'pms',
      nhs: nhsAccounting ? 'accounting' : 'pms',
    },
    levels,
  };
}

/**
 * Same account / source resolution as fetchLocationIncomeAccountingTotals, but
 * returns a Map<'MMM-yy', LocationIncomeAccountingTotals> for the full range
 * using ONE monthly RPC per income type (not N×month journal pagination).
 */
export async function fetchLocationIncomeAccountingTotalsByMonth(
  organizationId: string,
  fromDate: string,
  toDate: string,
  monthKeys: string[],
  locationId?: string | null,
  regionLocationIds?: string[] | null,
): Promise<Map<string, LocationIncomeAccountingTotals>> {
  const emptySlice = (): LocationIncomeAccountingTotals => ({
    private: null,
    membership: null,
    nhs: null,
    sources: { private: 'pms', membership: 'pms', nhs: 'pms' },
    levels: { private: 'practice', membership: 'practice', nhs: 'practice' },
  });
  const out = new Map<string, LocationIncomeAccountingTotals>();
  for (const k of monthKeys) out.set(k, emptySlice());
  if (!organizationId || !fromDate || !toDate || monthKeys.length === 0) return out;

  // Resolve account sets for monthly sums (same rules as single-period path).
  let locQ = (supabase as any)
    .from('practice_locations')
    .select(
      'id, private_income_source, membership_income_source, nhs_income_source, private_income_coa_accounts, membership_income_coa_accounts, nhs_income_coa_accounts',
    )
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  if (locationId) locQ = locQ.eq('id', locationId);
  else if (regionLocationIds?.length) locQ = locQ.in('id', regionLocationIds);

  const { data: locs, error: locErr } = await locQ;
  if (locErr) throw locErr;
  const rows = (locs ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return out;

  const locationIds = rows.map((l) => String(l.id)).filter(Boolean);
  const { orgDefault, byLocation } = await fetchIncomeLevelMap(organizationId, locationIds);
  const levels =
    locationId && byLocation.has(locationId)
      ? byLocation.get(locationId)!
      : orgDefault;

  const privateXeroIds = new Set<string>();
  const membershipXeroIds = new Set<string>();
  const nhsXeroIds = new Set<string>();
  const legacyPrivateUuids = new Set<string>();
  const legacyMembershipUuids = new Set<string>();
  const legacyNhsUuids = new Set<string>();
  let privateAccounting = false;
  let membershipAccounting = false;
  let nhsAccounting = false;
  const practiceAccountingLocIds = {
    private: new Set<string>(),
    membership: new Set<string>(),
    nhs: new Set<string>(),
  };

  for (const l of rows) {
    const locId = String(l.id);
    const locLevels = byLocation.get(locId) ?? orgDefault;
    const privSrc = sourceOf(l.private_income_source, 'pms');
    const memSrc = sourceOf(l.membership_income_source, 'accounting');
    const nhsSrc = sourceOf(l.nhs_income_source, 'accounting');
    const privSet = new Set(asUuidArray(l.private_income_coa_accounts));
    const memSet = new Set(asUuidArray(l.membership_income_coa_accounts));
    const nhsSet = new Set(asUuidArray(l.nhs_income_coa_accounts));

    if (privSrc === 'accounting' && locLevels.private === 'practice') {
      privateAccounting = true;
      practiceAccountingLocIds.private.add(locId);
      for (const id of privSet) legacyPrivateUuids.add(id);
    }
    if (memSrc === 'accounting' && locLevels.membership === 'practice') {
      membershipAccounting = true;
      practiceAccountingLocIds.membership.add(locId);
      for (const id of memSet) legacyMembershipUuids.add(id);
    }
    if (nhsSrc === 'accounting' && locLevels.nhs === 'practice') {
      nhsAccounting = true;
      practiceAccountingLocIds.nhs.add(locId);
      for (const id of nhsSet) legacyNhsUuids.add(id);
    }
  }

  const setupLocIdsForFetch = [
    ...new Set([
      ...practiceAccountingLocIds.private,
      ...practiceAccountingLocIds.membership,
      ...practiceAccountingLocIds.nhs,
    ]),
  ];
  const scopedSetup =
    setupLocIdsForFetch.length > 0
      ? await fetchSetupCategoryRevenueXeroIds(organizationId, setupLocIdsForFetch)
      : {
          privateincome: new Set<string>(),
          membershipincome: new Set<string>(),
          nhsincome: new Set<string>(),
        };

  const allLocationsIncome = !locationId && !regionLocationIds?.length;
  if (privateAccounting) {
    for (const id of scopedSetup.privateincome) {
      if (!scopedSetup.membershipincome.has(id) && !scopedSetup.nhsincome.has(id)) {
        privateXeroIds.add(id);
      }
    }
  }
  if (membershipAccounting) {
    for (const id of scopedSetup.membershipincome) {
      if (allLocationsIncome && scopedSetup.nhsincome.has(id)) continue;
      membershipXeroIds.add(id);
    }
  }
  if (nhsAccounting) {
    for (const id of scopedSetup.nhsincome) nhsXeroIds.add(id);
  }

  const allLegacyUuids = [
    ...new Set([
      ...(privateXeroIds.size === 0 ? legacyPrivateUuids : []),
      ...(membershipXeroIds.size === 0 ? legacyMembershipUuids : []),
      ...(nhsXeroIds.size === 0 ? legacyNhsUuids : []),
    ]),
  ];
  const xeroByCoa = new Map<string, string>();
  if (allLegacyUuids.length > 0) {
    const { data: coaRows, error: coaErr } = await (supabase as any)
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id')
      .eq('organization_id', organizationId)
      .in('id', allLegacyUuids);
    if (coaErr) throw coaErr;
    for (const c of (coaRows ?? []) as Array<{ id: string; xero_account_id: string | null }>) {
      if (c.xero_account_id) xeroByCoa.set(String(c.id), String(c.xero_account_id));
    }
  }
  const addLegacy = (target: Set<string>, uuids: Set<string>) => {
    if (target.size > 0) return;
    for (const id of uuids) {
      const xeroId = xeroByCoa.get(id);
      if (xeroId) target.add(xeroId);
    }
  };
  addLegacy(privateXeroIds, legacyPrivateUuids);
  addLegacy(membershipXeroIds, legacyMembershipUuids);
  addLegacy(nhsXeroIds, legacyNhsUuids);

  const journalScope =
    locationIds.length > 0
      ? await resolveLocationXeroJournalScope(organizationId, locationIds)
      : null;

  const [privateByMonth, membershipByMonth, nhsByMonth] = await Promise.all([
    privateAccounting
      ? privateXeroIds.size === 0
        ? Promise.resolve(new Map(monthKeys.map((k) => [k, 0] as const)))
        : sumRevenueForXeroAccountsByMonth(
            organizationId,
            [...privateXeroIds],
            fromDate,
            toDate,
            monthKeys,
            journalScope,
          )
      : Promise.resolve(null as Map<string, number> | null),
    membershipAccounting
      ? membershipXeroIds.size === 0
        ? Promise.resolve(new Map(monthKeys.map((k) => [k, 0] as const)))
        : sumRevenueForXeroAccountsByMonth(
            organizationId,
            [...membershipXeroIds],
            fromDate,
            toDate,
            monthKeys,
            journalScope,
          )
      : Promise.resolve(null as Map<string, number> | null),
    nhsAccounting
      ? nhsXeroIds.size === 0
        ? Promise.resolve(new Map(monthKeys.map((k) => [k, 0] as const)))
        : sumRevenueForXeroAccountsByMonth(
            organizationId,
            [...nhsXeroIds],
            fromDate,
            toDate,
            monthKeys,
            journalScope,
          )
      : Promise.resolve(null as Map<string, number> | null),
  ]);

  for (const k of monthKeys) {
    out.set(k, {
      private: privateByMonth ? privateByMonth.get(k) ?? 0 : null,
      membership: membershipByMonth ? membershipByMonth.get(k) ?? 0 : null,
      nhs: nhsByMonth ? nhsByMonth.get(k) ?? 0 : null,
      sources: {
        private: privateAccounting ? 'accounting' : 'pms',
        membership: membershipAccounting ? 'accounting' : 'pms',
        nhs: nhsAccounting ? 'accounting' : 'pms',
      },
      levels,
    });
  }
  return out;
}

export function useLocationIncomeAccountingTotals(
  fromDate: string,
  toDate: string,
  locationId?: string | null,
  regionLocationIds?: string[] | null,
) {
  const { organizationId } = useOrganization();
  const locKey = locationId
    ? locationId
    : regionLocationIds?.length
      ? [...regionLocationIds].sort().join(',')
      : 'all';

  return useQuery({
    queryKey: [
      'location-income-accounting-totals',
      'tracking-v1',
      organizationId,
      fromDate,
      toDate,
      locKey,
    ],
    enabled: !!organizationId && !!fromDate && !!toDate,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<LocationIncomeAccountingTotals> =>
      fetchLocationIncomeAccountingTotals(
        organizationId!,
        fromDate,
        toDate,
        locationId,
        regionLocationIds,
      ),
  });
}
