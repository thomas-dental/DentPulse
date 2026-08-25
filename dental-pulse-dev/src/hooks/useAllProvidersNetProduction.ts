import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { fetchDentpulseNhsMonthlyOverlay } from '@/utils/dentpulseNhsIncome';
import { dentistNamesLikelyMatch } from '@/lib/dentistNameMatch';
import { jsonbHasNumericPlanIds } from '@/lib/setupCategoryPaymentPlans';

export interface MonthlyProductionBreakdown {
  amount: number;
  private: number;
  membership: number;
  nhs: number;
  /** The RPC's own `total_amount` — unconditional SUM(tpi_price) for this
   *  practitioner/month, independent of Setup Categories Private Income
   *  payment-plan vocabulary. This is what reconciles to Dentally's
   *  Practitioner Activity export. When Private Income plans ARE mapped,
   *  `amount` (private + membership + nhs) is the mapped figure and will
   *  be lower than `rawTotal` for production on unmapped plans (e.g.
   *  Appoline / Zahid Hussain Dec-25: Dentally £406 vs Private Income £265).
   *  The unclassified remainder is only folded into membership when NO
   *  Private Income plans are mapped, so unconfigured orgs still match
   *  Dentally (Hilton, 2026-08-11). */
  rawTotal: number;
}

export interface ProviderMonthlyProduction {
  providerId: string;
  /** Every `providers.id` row folded into this person's group (multi-location
   *  duplicates, inactive leftovers sharing the same email, etc.) — not just
   *  `providerId` (the arbitrarily-chosen representative). Callers that look
   *  up this record by a practitioner-roster id (which may point at a
   *  non-representative row) should key off all of these, not just
   *  `providerId`, or the lookup silently misses. */
  allProviderIds: string[];
  externalId: number | null;   // Dentally external_id — first one (for backward compat)
  externalIds: number[];       // All external_ids for this person (multi-location)
  providerName: string;
  /** Primary practice location when known (kept for Location Metrics batching). */
  locationId?: string | null;
  monthlyData: { [month: string]: MonthlyProductionBreakdown };
  total: number;
  totalPrivate: number;
  totalMembership: number;
  totalNhs: number;
  /** NHS before the DentPulse overlay (raw accounting/P&L amount). Equals
   *  totalNhs when the overlay is disabled or not configured. */
  totalNhsRaw: number;
  /** True Dentally-reconciling grand total — sum of the RPC's own raw
   *  `total_amount` (SUM(tpi_price), unconditional). Do NOT use
   *  `totalPrivate + totalMembership + totalNhsRaw` as a substitute: it
   *  undercounts whenever revenue isn't classified as private and isn't
   *  backed by an NHS/membership accounting mapping — see
   *  MonthlyProductionBreakdown.rawTotal for why. */
  totalRaw: number;
  /** True when any folded provider row for this person is currently active. */
  isActive: boolean;
}

export type FetchAllProvidersNetProductionArgs = {
  providerType?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  locationId?: string | null;
  /** Post-filter by primary location when no specific locationId is set. */
  regionLocationIds?: string[] | null;
  /**
   * When false, skip the DentPulse NHS overlay (UDA/MOS rate × actual counts)
   * and return the raw RPC amounts. The raw figure is what reconciles with
   * Dentally's Practitioner Activity export, which prices NHS TPIs at £0.
   */
  applyNhsOverlay?: boolean;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** TPI not classified as Setup Categories Private Income. Private + this = rawTotal. */
export function tpiUnmappedAmount(rawTotal: number, mappedPrivate: number): number {
  return Math.max(0, round2((Number(rawTotal) || 0) - (Number(mappedPrivate) || 0)));
}

/**
 * True when Setup Categories Profit has PMS payment plans mapped for Private,
 * Membership, or NHS (scoped location, or any location when viewing All).
 * Inactive plans count — the dropdown selection is the source of truth.
 */
async function hasConfiguredPmsIncomePlans(
  organizationId: string,
  locationId: string | null,
): Promise<boolean> {
  let query = (supabase as any)
    .from('practice_locations')
    .select(
      'private_income_accounts, provider_private_income_accounts, membership_income_accounts, provider_membership_income_accounts, nhs_income_accounts, provider_nhs_income_accounts, membership_income_source, nhs_income_source',
    )
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  if (locationId && locationId !== 'all') {
    query = query.eq('id', locationId);
  }
  const { data, error } = await query;
  if (error) {
    console.warn('[fetchAllProvidersNetProduction] PMS-plan lookup failed:', error);
    return false;
  }
  return ((data ?? []) as Array<Record<string, unknown>>).some(
    (row) =>
      jsonbHasNumericPlanIds(row.private_income_accounts) ||
      jsonbHasNumericPlanIds(row.provider_private_income_accounts) ||
      ((String(row.membership_income_source || 'accounting') === 'pms') &&
        (jsonbHasNumericPlanIds(row.membership_income_accounts) ||
          jsonbHasNumericPlanIds(row.provider_membership_income_accounts))) ||
      ((String(row.nhs_income_source || 'accounting') === 'pms') &&
        (jsonbHasNumericPlanIds(row.nhs_income_accounts) ||
          jsonbHasNumericPlanIds(row.provider_nhs_income_accounts))),
  );
}

/**
 * Fetches net production for all providers (same data as Profit Benchmark Production Income PMS path).
 *
 * Location logic:
 * - locationId = null/all  → sum of each location's result (so DentPulse NHS =
 *   Loc1 + Loc2 + …, matching the UI when each site is selected alone)
 * - locationId = specific  → RPC filters TPIs by p_location_id
 *
 * When practice nhs_income_source / mos_income_source = dentpulse, NHS is replaced with
 * UDA (or MOS case) rate × appointment_summary actual counts (Pro DentPulse formula).
 */
export async function fetchAllProvidersNetProduction(
  organizationId: string,
  args: FetchAllProvidersNetProductionArgs = {},
): Promise<{ providers: ProviderMonthlyProduction[]; months: string[] }> {
  const {
    providerType = null,
    startDate = null,
    endDate = null,
    locationId = null,
    regionLocationIds = null,
    applyNhsOverlay = true,
  } = args;

  if (!organizationId) return { providers: [], months: [] };

  const scopedToOneLocation = !!(locationId && locationId !== 'all');

  // All Locations / region: compose as the sum of each location's own figure.
  // A single org-wide pass mis-assigns DentPulse rates (email-merge picks the
  // wrong home site → NHS drops below Loc1 alone, e.g. £569k vs £662k + £0).
  if (!scopedToOneLocation) {
    let locIds: string[] = [];
    if (regionLocationIds && regionLocationIds.length > 0) {
      locIds = [...new Set(regionLocationIds.filter(Boolean))];
    } else {
      const { data: locs, error: locErr } = await (supabase as any)
        .from('practice_locations')
        .select('id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);
      if (locErr) throw locErr;
      locIds = ((locs ?? []) as Array<{ id: string }>).map((l) => String(l.id));
    }

    if (locIds.length === 0) return { providers: [], months: [] };

    // One location → same as selecting it (avoids useless recurse).
    if (locIds.length === 1) {
      return fetchAllProvidersNetProduction(organizationId, {
        ...args,
        locationId: locIds[0],
        regionLocationIds: null,
      });
    }

    const runOneLocation = (locId: string) =>
      fetchAllProvidersNetProduction(organizationId, {
        providerType,
        startDate,
        endDate,
        locationId: locId,
        regionLocationIds: null,
        applyNhsOverlay,
      });

    // Wide ranges (This Year) used to fire every location RPC at once; the
    // appointment-location joins then all contended for the same pool and
    // PostgREST timed out → Production Data rendered empty. Two at a time
    // keeps All Locations correct (sum of sites) without that collapse.
    // allSettled: one site failing must not blank the whole table.
    const perLoc: Array<Awaited<ReturnType<typeof fetchAllProvidersNetProduction>>> = [];
    const LOC_BATCH = 2;
    for (let i = 0; i < locIds.length; i += LOC_BATCH) {
      const batch = locIds.slice(i, i + LOC_BATCH);
      const settled = await Promise.allSettled(batch.map(runOneLocation));
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          perLoc.push(result.value);
        } else {
          console.error('[fetchAllProvidersNetProduction] location RPC failed:', result.reason);
        }
      }
    }
    if (perLoc.length === 0) {
      throw new Error('Net production failed for every location in range');
    }

    const months = perLoc.find((r) => r.months.length > 0)?.months ?? [];
    // Keep one row per location-run provider so Private/Membership/NHS totals
    // equal the sum of each location card (do not re-merge across sites here).
    // Stamp locationId so Location Metrics can group without a second fan-out.
    const providers = perLoc.flatMap((r, i) =>
      r.providers.map((p) => ({
        ...p,
        locationId: p.locationId ?? locIds[i] ?? null,
      })),
    );
    providers.sort((a, b) => a.providerName.localeCompare(b.providerName));
    return { providers, months };
  }

  const now = new Date();
  const rangeStart = startDate && endDate ? startDate : startOfMonth(now);
  const rangeEnd = startDate && endDate ? endDate : endOfMonth(now);

  // Include inactive providers — Production Data must still show historical
  // figures for leavers. Soft-deleted rows stay excluded via deleted_at.
  // `is_active` is returned so the Production Data status filter can hide
  // leavers without dropping them from the fetch.
  let providersQuery = supabase
    .from('providers')
    .select('id, name, email, external_id, provider_role, location_id, is_active')
    .is('deleted_at', null)
    .eq('organization_id', organizationId);

  if (providerType) {
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
  }

  const { data: rawProviders, error: providersError } = await providersQuery;
  if (providersError) {
    console.error('[fetchAllProvidersNetProduction] Error fetching providers:', providersError);
    throw providersError;
  }

  // When Private Income payment plans are mapped in Setup Categories, net
  // production must stay on those plans — do not pad unclassified Dentally
  // TPI into membership (that is what made Zahid Hussain Dec-25 read £406
  // instead of the mapped private £265). Unconfigured orgs still use the
  // remainder fallback so they reconcile to Dentally.
  const privatePlansConfigured = await hasConfiguredPmsIncomePlans(
    organizationId,
    scopedToOneLocation ? locationId : null,
  );

  const regionFiltered =
    !locationId && regionLocationIds && regionLocationIds.length > 0
      ? (rawProviders ?? []).filter(
          (p) => p.location_id != null && regionLocationIds.includes(p.location_id),
        )
      : rawProviders ?? [];
  // Dentally Practitioner Activity is per practitioner *record*. Foazia
  // Sikandar Appoline (67715) Sep-25 is £5,356.85; her other-site ID 83516
  // had £291 of TPI (appointment at Appoline, TPI practitioner 83516) that
  // email-merge then added, so the cell read £5,648. When a location is
  // selected, only that site's provider rows / Dentally IDs are grouped.
  const allProviders = scopedToOneLocation
    ? regionFiltered.filter((p) => p.location_id === locationId)
    : regionFiltered;

  const months: string[] = [];
  let currentMonth = new Date(rangeStart);
  while (currentMonth <= new Date(rangeEnd)) {
    months.push(format(currentMonth, 'MMM-yy'));
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  }

  // Real Practice Plan / Denplan membership revenue, practitioner-wise —
  // this money never passes through treatment_plan_items at all (it's
  // collected via the provider's own direct-debit system and only reaches
  // DentPulse through the statement upload — see membership_upload_members).
  // Matched to a provider by name in processGroup (dentistNamesLikelyMatch).
  const membershipByRawName: Array<{ name: string; byMonth: Map<string, number> }> = [];
  {
    const rangeStartMonth = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const rangeEndMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
    const byName = new Map<string, Map<string, number>>();
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await (supabase as any)
        .from('membership_upload_members')
        .select('treating_dentist, net_due, upload_month, upload_year, location_id, upload_location_id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .gte('upload_year', rangeStartMonth.getFullYear())
        .lte('upload_year', rangeEndMonth.getFullYear())
        .range(from, from + PAGE - 1);
      if (error) {
        console.error('[fetchAllProvidersNetProduction] membership lookup failed:', error);
        break;
      }
      const rows = (data ?? []) as Array<{
        treating_dentist: string | null; net_due: number | string | null;
        upload_month: number; upload_year: number;
        location_id: string | null; upload_location_id: string | null;
      }>;
      for (const r of rows) {
        const name = (r.treating_dentist ?? '').trim();
        if (!name) continue;
        if (locationId && locationId !== 'all' && r.location_id !== locationId && r.upload_location_id !== locationId) continue;
        const monthDate = new Date(Number(r.upload_year), Number(r.upload_month) - 1, 1);
        if (monthDate < rangeStartMonth || monthDate > rangeEndMonth) continue;
        const monthKey = format(monthDate, 'MMM-yy');
        const byMonth = byName.get(name) ?? new Map<string, number>();
        byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + (Number(r.net_due) || 0));
        byName.set(name, byMonth);
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    for (const [name, byMonth] of byName) membershipByRawName.push({ name, byMonth });
  }

  const emptyMonthMap = (): { [month: string]: MonthlyProductionBreakdown } => {
    const map: { [month: string]: MonthlyProductionBreakdown } = {};
    months.forEach((m) => {
      map[m] = { amount: 0, private: 0, membership: 0, nhs: 0, rawTotal: 0 };
    });
    return map;
  };

  /** Fold RPC records into a month map. Both the per-practitioner and the
   *  all-providers functions return the same month / *_amount columns. */
  const applyRpcRecords = (
    map: { [month: string]: MonthlyProductionBreakdown },
    records: any[],
  ) => {
    for (const rec of records) {
      const raw = String(rec.month ?? '').trim();
      const monthKey =
        months.find((m) => m.toLowerCase() === raw.toLowerCase()) ??
        months.find((m) => m.toLowerCase() === raw.toLowerCase().replace(/\s+/g, '-')) ??
        null;
      if (!monthKey || !map[monthKey]) continue;
      const _priv =
        typeof rec.private_amount === 'number'
          ? rec.private_amount
          : parseFloat(String(rec.private_amount)) || 0;
      const _memb =
        typeof rec.membership_amount === 'number'
          ? rec.membership_amount
          : parseFloat(String(rec.membership_amount)) || 0;
      const _nhs =
        typeof rec.nhs_amount === 'number'
          ? rec.nhs_amount
          : parseFloat(String(rec.nhs_amount)) || 0;
      const _total =
        typeof rec.total_amount === 'number'
          ? rec.total_amount
          : parseFloat(String(rec.total_amount)) || 0;
      map[monthKey].amount += _priv + _memb + _nhs;
      map[monthKey].private += _priv;
      map[monthKey].membership += _memb;
      map[monthKey].nhs += _nhs;
      map[monthKey].rawTotal += _total;
    }
  };

  const fetchProductionForExternalId = async (
    externalId: number,
  ): Promise<{ [month: string]: MonthlyProductionBreakdown }> => {
    const map = emptyMonthMap();

    const rpcParams: Record<string, unknown> = {
      p_organization_id: organizationId,
      p_from_date: format(rangeStart, 'yyyy-MM-dd'),
      p_to_date: format(rangeEnd, 'yyyy-MM-dd'),
      p_practitioner_id: externalId,
    };
    if (locationId && locationId !== 'all') {
      rpcParams.p_location_id = locationId;
    }

    const { data, error } = await (supabase.rpc as any)(
      'get_provider_net_production_monthly',
      rpcParams,
    );

    if (error) {
      console.error(
        `[fetchAllProvidersNetProduction] RPC error for external_id ${externalId}:`,
        error,
      );
      // THROW instead of returning an empty map: a silently-partial result
      // gets cached by React Query as fresh-and-successful for staleTime,
      // so every soft navigation keeps rendering zeros until a hard refresh
      // clears the cache. Failing the query lets RQ retry and refetch on the
      // next mount instead.
      throw error;
    }

    applyRpcRecords(map, data ?? []);
    return map;
  };

  const mergeMaps = (
    a: { [month: string]: MonthlyProductionBreakdown },
    b: { [month: string]: MonthlyProductionBreakdown },
  ): { [month: string]: MonthlyProductionBreakdown } => {
    const result: { [month: string]: MonthlyProductionBreakdown } = {};
    for (const m of months) {
      result[m] = {
        amount: (a[m]?.amount ?? 0) + (b[m]?.amount ?? 0),
        private: (a[m]?.private ?? 0) + (b[m]?.private ?? 0),
        membership: (a[m]?.membership ?? 0) + (b[m]?.membership ?? 0),
        nhs: (a[m]?.nhs ?? 0) + (b[m]?.nhs ?? 0),
        rawTotal: (a[m]?.rawTotal ?? 0) + (b[m]?.rawTotal ?? 0),
      };
    }
    return result;
  };

  const emailGroupMap = new Map<
    string,
    {
      displayName: string;
      representativeId: string;
      allIds: string[];
      externalIds: number[];
      locationId: string | null;
      isActive: boolean;
    }
  >();
  for (const p of allProviders) {
    const key = (p.email ?? p.name ?? '').toLowerCase();
    const rowActive = p.is_active !== false;
    if (!emailGroupMap.has(key)) {
      emailGroupMap.set(key, {
        displayName: p.name,
        representativeId: p.id,
        allIds: [],
        externalIds: [],
        locationId: p.location_id ?? null,
        isActive: rowActive,
      });
    }
    const g = emailGroupMap.get(key)!;
    g.allIds.push(p.id);
    if (rowActive && !g.isActive) {
      g.isActive = true;
      g.representativeId = p.id;
      g.displayName = p.name;
    }
    if (!g.locationId && p.location_id) g.locationId = p.location_id;
    if (p.external_id) {
      const extId = Number(p.external_id);
      if (!isNaN(extId) && !g.externalIds.includes(extId)) {
        g.externalIds.push(extId);
      }
    }
  }

  const groups = [...emailGroupMap.values()].filter((g) => g.externalIds.length > 0);

  // Resolve each membership-statement dentist name to AT MOST one provider
  // group, and only when the match is unambiguous — computed once, over
  // every group, rather than per-group (dentistNamesLikelyMatch's nickname/
  // prefix logic can match more than one real provider record to the same
  // statement name, e.g. separate "Steve Lomas" and "Steven Lomas" rows for
  // the same person; matching independently per group would double-count
  // that membership revenue onto both instead of resolving the clash here).
  const membershipByRepresentativeId = new Map<string, Map<string, number>>();
  for (const entry of membershipByRawName) {
    const matchingGroups = groups.filter((g) => dentistNamesLikelyMatch(entry.name, g.displayName));
    if (matchingGroups.length === 1) {
      membershipByRepresentativeId.set(matchingGroups[0].representativeId, entry.byMonth);
    }
  }

  // ── Fast path: ONE aggregated RPC for every practitioner ──────────────────
  // get_all_providers_net_production_monthly (migration 20260804000002)
  // returns the same figures as the per-practitioner function, grouped by
  // practitioner — one round trip instead of one per provider (100+ on large
  // orgs, the reason Provider Insights rendered slowly). Falls back to the
  // per-practitioner sweep when the function isn't deployed yet.
  let aggByExtId: Map<number, any[]> | null = null;
  {
    const rpcParams: Record<string, unknown> = {
      p_organization_id: organizationId,
      p_from_date: format(rangeStart, 'yyyy-MM-dd'),
      p_to_date: format(rangeEnd, 'yyyy-MM-dd'),
    };
    if (locationId && locationId !== 'all') {
      rpcParams.p_location_id = locationId;
    }
    const { data, error } = await (supabase.rpc as any)(
      'get_all_providers_net_production_monthly',
      rpcParams,
    );
    if (!error) {
      aggByExtId = new Map();
      for (const rec of (data ?? []) as any[]) {
        const extId = Number(rec.practitioner_id);
        if (!Number.isFinite(extId)) continue;
        const list = aggByExtId.get(extId);
        if (list) list.push(rec);
        else aggByExtId.set(extId, [rec]);
      }
    } else {
      const missingFunction =
        error.code === 'PGRST202' ||
        error.code === '42883' ||
        /could not find the function|does not exist/i.test(String(error.message ?? ''));
      if (!missingFunction) {
        console.error('[fetchAllProvidersNetProduction] aggregated RPC error:', error);
        throw error;
      }
      // Not deployed yet — use the per-practitioner sweep below.
    }
  }

  const processGroup = async (group: (typeof groups)[number]) => {
    let mergedMap = emptyMonthMap();
    if (aggByExtId) {
      for (const extId of group.externalIds) {
        applyRpcRecords(mergedMap, aggByExtId.get(extId) ?? []);
      }
    } else {
      const perExtMaps = await Promise.all(
        group.externalIds.map((extId) => fetchProductionForExternalId(extId)),
      );
      for (const locMap of perExtMaps) {
        mergedMap = mergeMaps(mergedMap, locMap);
      }
    }

    // Membership fallback, only when accounting membership is exactly 0
    // for a month (a partially-mapped month is left alone rather than
    // risk double-counting):
    //   1. the practice's own uploaded membership statement data (Practice
    //      Plan / Denplan) — the authoritative source when it exists;
    //   2. otherwise, ONLY when Setup Categories has no Private Income
    //      payment plans mapped, any TPI not captured as private or NHS
    //      (legacy Dentally-reconcile path for unconfigured orgs).
    // When Private Income plans ARE mapped, unclassified TPI is excluded
    // from net production on purpose — the Production Data cell is the
    // mapped figure, not Dentally's unfiltered total.
    const membershipModule = membershipByRepresentativeId.get(group.representativeId);
    for (const m of months) {
      const cell = mergedMap[m];
      if (cell.membership === 0) {
        const moduleAmount = membershipModule?.get(m);
        if (moduleAmount != null && moduleAmount > 0) {
          cell.membership = round2(moduleAmount);
          cell.amount = round2(cell.private + cell.membership + cell.nhs);
          continue;
        }
        if (privatePlansConfigured) {
          cell.amount = round2(cell.private + cell.membership + cell.nhs);
          continue;
        }
        const remainder = round2(cell.rawTotal - cell.private - cell.nhs);
        if (remainder > 0) {
          cell.membership = remainder;
          cell.amount = round2(cell.private + cell.membership + cell.nhs);
        }
      }
    }

    let total = 0;
    let totalPrivate = 0;
    let totalMembership = 0;
    let totalNhs = 0;
    let totalRaw = 0;
    for (const m of months) {
      total += mergedMap[m].amount;
      totalPrivate += mergedMap[m].private;
      totalMembership += mergedMap[m].membership;
      totalNhs += mergedMap[m].nhs;
      totalRaw += mergedMap[m].rawTotal;
    }

    return {
      providerId: group.representativeId,
      allProviderIds: group.allIds,
      externalId: group.externalIds[0] ?? null,
      externalIds: group.externalIds,
      locationId: group.locationId,
      providerName: group.displayName,
      monthlyData: mergedMap,
      total,
      totalPrivate,
      totalMembership,
      totalNhs,
      totalNhsRaw: totalNhs,
      totalRaw,
      isActive: group.isActive,
    };
  };

  // Cap RPC concurrency on the per-practitioner FALLBACK path (the aggregated
  // fast path above needs no fan-out): an org can have 100+ provider groups,
  // and firing one RPC per group all at once (×2 when a page also fetches the
  // previous period) saturates the DB — calls time out and pages render
  // partial data. 16 balances wall-time against that risk.
  const RPC_BATCH_SIZE = 16;
  const groupResults: Array<Awaited<ReturnType<typeof processGroup>>> = [];
  for (let i = 0; i < groups.length; i += RPC_BATCH_SIZE) {
    const batch = groups.slice(i, i + RPC_BATCH_SIZE);
    groupResults.push(...(await Promise.all(batch.map(processGroup))));
  }

  // DentPulse overlay: replace NHS with rate × actual NHS/MOS counts when configured.
  if (applyNhsOverlay) try {
    const overlay = await fetchDentpulseNhsMonthlyOverlay(
      organizationId,
      rangeStart,
      rangeEnd,
      groupResults.map((g) => ({
        externalIds: g.externalIds,
        locationId:
          locationId && locationId !== 'all' ? locationId : g.locationId,
        monthKeys: months,
      })),
      locationId,
    );

    if (overlay.size > 0) {
      for (const g of groupResults) {
        const key = g.externalIds.slice().sort((a, b) => a - b).join(',');
        const byMonth = overlay.get(key);
        if (!byMonth) continue;

        let totalNhs = 0;
        for (const m of months) {
          const dentpulseNhs = byMonth[m] ?? 0;
          const cell = g.monthlyData[m];
          if (!cell) continue;
          cell.nhs = dentpulseNhs;
          cell.amount = round2(cell.private + cell.membership + cell.nhs);
          totalNhs += cell.nhs;
        }
        g.totalNhs = round2(totalNhs);
        g.total = round2(g.totalPrivate + g.totalMembership + g.totalNhs);
      }
    }
  } catch (err) {
    console.warn('[fetchAllProvidersNetProduction] DentPulse NHS overlay skipped:', err);
  }

  const providersData: ProviderMonthlyProduction[] = groupResults.map((g) => ({
    providerId: g.providerId,
    allProviderIds: g.allProviderIds,
    externalId: g.externalId,
    externalIds: g.externalIds,
    providerName: g.providerName,
    locationId: g.locationId ?? null,
    monthlyData: g.monthlyData,
    total: g.total,
    totalPrivate: g.totalPrivate,
    totalMembership: g.totalMembership,
    totalNhs: g.totalNhs,
    totalNhsRaw: g.totalNhsRaw,
    totalRaw: g.totalRaw,
    isActive: g.isActive,
  }));
  providersData.sort((a, b) => a.providerName.localeCompare(b.providerName));
  return { providers: providersData, months };
}

/**
 * React Query wrapper around {@link fetchAllProvidersNetProduction}.
 */
export function useAllProvidersNetProduction(
  providerType: string | null,
  startDate?: Date | null,
  endDate?: Date | null,
  locationId?: string | null,
  regionLocationIds?: string[] | null,
  applyNhsOverlay: boolean = true,
  enabled: boolean = true,
) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [
      'all-providers-net-production-v22',
      organizationId,
      providerType,
      startDate ? format(startDate, 'yyyy-MM-dd') : null,
      endDate ? format(endDate, 'yyyy-MM-dd') : null,
      locationId ?? 'all',
      !locationId && regionLocationIds
        ? regionLocationIds.slice().sort().join(',')
        : 'none',
      applyNhsOverlay ? 'overlay' : 'raw',
    ],
    queryFn: async (): Promise<{ providers: ProviderMonthlyProduction[]; months: string[] }> => {
      if (!organizationId) return { providers: [], months: [] };
      return fetchAllProvidersNetProduction(organizationId, {
        providerType,
        startDate,
        endDate,
        locationId,
        regionLocationIds,
        applyNhsOverlay,
      });
    },
    enabled: enabled && !!organizationId && ((!startDate && !endDate) || (!!startDate && !!endDate)),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
}
