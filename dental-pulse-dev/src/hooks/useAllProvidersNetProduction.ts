import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { fetchDentpulseNhsMonthlyOverlay } from '@/utils/dentpulseNhsIncome';
import { dentistNamesLikelyMatch } from '@/lib/dentistNameMatch';
import {
  fetchMembershipProviderMappings,
  type ResolvedProviderMapping,
} from './useMembershipProviderMappings';
import { filterProvidersByManagementType } from '@/lib/providerRosterFilters';
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

/** TPI not classified into any of Private / Membership / NHS. rawTotal can also carry
 *  non-TPI statement membership revenue (see the membership-module fallback above), so
 *  membership and nhs must be subtracted too — not just private — or that statement
 *  amount double-counts here as "unmapped" on top of its own Membership row. */
export function tpiUnmappedAmount(
  rawTotal: number,
  mappedPrivate: number,
  mappedMembership = 0,
  mappedNhs = 0,
): number {
  return Math.max(
    0,
    round2(
      (Number(rawTotal) || 0) -
        (Number(mappedPrivate) || 0) -
        (Number(mappedMembership) || 0) -
        (Number(mappedNhs) || 0),
    ),
  );
}

/** Same Active / All / Inactive control as Providers → Production Data. */
export type ProductionProviderStatus = 'all' | 'active' | 'inactive';

export const PRODUCTION_PROVIDER_STATUS_OPTIONS: {
  value: ProductionProviderStatus;
  label: string;
}[] = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All' },
  { value: 'inactive', label: 'Inactive' },
];

export function productionStatusMatches(
  isActive: boolean,
  status: ProductionProviderStatus,
): boolean {
  if (status === 'all') return true;
  if (status === 'active') return isActive;
  return !isActive;
}

function productionPersonKey(name: string): string {
  return name.trim().toLowerCase();
}

function emptyMonthCell(): MonthlyProductionBreakdown {
  return { amount: 0, private: 0, membership: 0, nhs: 0, rawTotal: 0 };
}

function addMonthCells(
  a?: MonthlyProductionBreakdown,
  b?: MonthlyProductionBreakdown,
): MonthlyProductionBreakdown {
  const left = a ?? emptyMonthCell();
  const right = b ?? emptyMonthCell();
  return {
    amount: left.amount + right.amount,
    private: left.private + right.private,
    membership: left.membership + right.membership,
    nhs: left.nhs + right.nhs,
    rawTotal: left.rawTotal + right.rawTotal,
  };
}

/**
 * Fold duplicate person rows by display name (inactive Dentally leftovers
 * sharing a name with the live record), then keep Active / Inactive / All.
 * Mirrors the Production Data table so Insights totals match those monthly
 * column totals for the same status.
 */
export function filterNetProductionByStatus(
  providers: ProviderMonthlyProduction[] | undefined,
  status: ProductionProviderStatus,
): ProviderMonthlyProduction[] {
  const folded = new Map<string, ProviderMonthlyProduction>();
  for (const row of providers ?? []) {
    const key = productionPersonKey(row.providerName);
    const existing = folded.get(key);
    if (!existing) {
      folded.set(key, {
        ...row,
        monthlyData: { ...row.monthlyData },
        allProviderIds: [...(row.allProviderIds ?? [row.providerId])],
        externalIds: [...(row.externalIds ?? [])],
      });
      continue;
    }

    const monthlyData = { ...existing.monthlyData };
    for (const month of new Set([
      ...Object.keys(monthlyData),
      ...Object.keys(row.monthlyData),
    ])) {
      monthlyData[month] = addMonthCells(monthlyData[month], row.monthlyData[month]);
    }

    folded.set(key, {
      ...existing,
      isActive: existing.isActive || row.isActive,
      total: existing.total + row.total,
      totalPrivate: existing.totalPrivate + row.totalPrivate,
      totalMembership: existing.totalMembership + row.totalMembership,
      totalNhs: existing.totalNhs + row.totalNhs,
      totalNhsRaw: existing.totalNhsRaw + row.totalNhsRaw,
      totalRaw: existing.totalRaw + row.totalRaw,
      monthlyData,
      allProviderIds: [
        ...new Set([
          ...existing.allProviderIds,
          ...(row.allProviderIds ?? []),
          row.providerId,
        ]),
      ],
      externalIds: [...new Set([...existing.externalIds, ...(row.externalIds ?? [])])],
    });
  }

  return [...folded.values()].filter((row) =>
    productionStatusMatches(row.isActive !== false, status),
  );
}

/**
 * Hours rows have no isActive flag — classify by the production roster.
 * Unmatched names are kept (same as Production Data) so a missing join
 * cannot zero out a real hours total.
 */
export function personMatchesProductionStatus(
  name: string,
  status: ProductionProviderStatus,
  production: ProviderMonthlyProduction[] | undefined,
): boolean {
  if (status === 'all') return true;
  const key = productionPersonKey(name);
  const rows = (production ?? []).filter(
    (p) => productionPersonKey(p.providerName) === key,
  );
  if (rows.length === 0) return true;
  return productionStatusMatches(
    rows.some((p) => p.isActive !== false),
    status,
  );
}

const MONTH_NUM: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Parse Production Data month labels (`Jan-26`) to `2026-01`. */
export function netProductionMonthKey(label: string): string | null {
  const raw = String(label ?? '').trim();
  const mm = MONTH_NUM[raw.slice(0, 3).toLowerCase()];
  const yyMatch = raw.match(/(\d{2})$/);
  if (!mm || !yyMatch) return null;
  return `20${yyMatch[1]}-${mm}`;
}

export type NetProductionMonthlyPoint = {
  month: string;
  monthKey: string;
  total: number;
  private: number;
  nhs: number;
  membership: number;
};

/**
 * Monthly Dentally totals from net production `rawTotal` — the same figures
 * as the Production Data monthly column totals for the given provider set.
 */
export function buildNetProductionMonthlyTrend(
  providers: ProviderMonthlyProduction[],
  rangeStart: Date,
  rangeEnd: Date,
): NetProductionMonthlyPoint[] {
  const spansYears = rangeStart.getFullYear() !== rangeEnd.getFullYear();
  const map = new Map<
    string,
    { total: number; private: number; nhs: number; membership: number }
  >();

  for (const provider of providers) {
    for (const [label, cell] of Object.entries(provider.monthlyData)) {
      const key = netProductionMonthKey(label);
      if (!key) continue;
      const cur = map.get(key) ?? { total: 0, private: 0, nhs: 0, membership: 0 };
      cur.total += cell.rawTotal || 0;
      cur.private += cell.private || 0;
      cur.nhs += cell.nhs || 0;
      cur.membership += cell.membership || 0;
      map.set(key, cur);
    }
  }

  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, d]) => {
      const [year, month] = key.split('-').map(Number);
      const date = new Date(Date.UTC(year, (month || 1) - 1, 1));
      return {
        month: spansYears
          ? date.toLocaleString('default', {
              month: 'short',
              year: '2-digit',
              timeZone: 'UTC',
            })
          : date.toLocaleString('default', { month: 'short', timeZone: 'UTC' }),
        monthKey: key,
        total: d.total,
        private: d.private,
        nhs: d.nhs,
        membership: d.membership,
      };
    });
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

  const { data: rawProviders, error: providersError } = await providersQuery;
  if (providersError) {
    console.error('[fetchAllProvidersNetProduction] Error fetching providers:', providersError);
    throw providersError;
  }

  const roleFilteredProviders = filterProvidersByManagementType(
    rawProviders,
    providerType,
  );

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
      ? roleFilteredProviders.filter(
          (p) => p.location_id != null && regionLocationIds.includes(p.location_id),
        )
      : roleFilteredProviders;
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
        // Ownership rule (2026-08-20): the upload location owns the row
        // (patient home only for legacy unstamped rows). The old home-OR-
        // upload match showed a row under BOTH sites — and since the
        // All-locations view sums per-location runs, such rows counted
        // TWICE in the org-wide membership total.
        const ownerLocationId = r.upload_location_id ?? r.location_id;
        if (locationId && locationId !== 'all' && ownerLocationId !== locationId) continue;
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

  const allGroups = [...emailGroupMap.values()];
  const fuzzyGroups = allGroups.filter((g) => g.externalIds.length > 0);

  // Resolve each membership-statement dentist name to provider group(s).
  // An explicit Settings-tab mapping (membership_provider_mappings) wins
  // outright; otherwise fall back to the fuzzy name match, and only when
  // it's unambiguous — computed once, over every group, rather than
  // per-group (dentistNamesLikelyMatch's nickname/prefix logic can match
  // more than one real provider record to the same statement name, e.g.
  // separate "Steve Lomas" and "Steven Lomas" rows for the same person;
  // matching independently per group would double-count that membership
  // revenue onto both instead of resolving the clash here). Sums are MERGED
  // per group, not overwritten — two statement names can resolve to the
  // same person once explicit mappings exist.
  const explicitProviderMappings =
    membershipByRawName.length > 0
      ? await fetchMembershipProviderMappings(organizationId)
      : new Map<string, ResolvedProviderMapping>();
  // The stored provider row id may be a different site's row for the same
  // person than this scope's group rows — resolve via the mapped row's own
  // email/name key (the same key emailGroupMap groups by). Rows come from
  // the role-filtered, PRE-location list so a mapped person with no record
  // at this location can still be resolved (and injected below).
  const mappableRowById = new Map<
    string,
    { id: string; name: string; email: string | null; location_id: string | null; is_active: boolean | null }
  >();
  for (const p of roleFilteredProviders as Array<{
    id: string; name: string; email: string | null; location_id: string | null; is_active: boolean | null;
  }>) {
    mappableRowById.set(String(p.id), p);
  }

  const membershipByRepresentativeId = new Map<string, Map<string, number>>();
  const addMembershipMonths = (repId: string, byMonth: Map<string, number>) => {
    const existing = membershipByRepresentativeId.get(repId);
    if (!existing) {
      membershipByRepresentativeId.set(repId, new Map(byMonth));
      return;
    }
    for (const [m, amt] of byMonth) existing.set(m, (existing.get(m) ?? 0) + amt);
  };

  /** Penny-exact equal split across n targets: each month's amount is
   *  divided in pence, the leading targets absorb the remainder pennies —
   *  so the per-provider figures always sum back to the statement amount
   *  (the whole point of the explicit mapping is £-for-£ reconciliation
   *  with the membership module; never lose or invent a penny here). */
  const splitMonthsEqually = (byMonth: Map<string, number>, n: number): Array<Map<string, number>> => {
    const parts: Array<Map<string, number>> = Array.from({ length: n }, () => new Map());
    for (const [m, amt] of byMonth) {
      const pence = Math.round((Number(amt) || 0) * 100);
      const base = Math.floor(pence / n);
      let leftover = pence - base * n;
      for (let i = 0; i < n; i++) {
        const share = base + (leftover > 0 ? 1 : 0);
        if (leftover > 0) leftover -= 1;
        if (share !== 0) parts[i].set(m, share / 100);
      }
    }
    return parts;
  };

  // A statement name that resolves to NOBODY (no mapping row, no
  // unambiguous fuzzy match, or a mapping whose people can't be resolved)
  // still shows as its own labeled row carrying its statement £ — client
  // rule 2026-08-20 "make sure both should be match": every pound of
  // membership revenue must be visible in provider production, so the
  // totals always reconcile with the membership module and an unmapped
  // name is VISIBLE (a row named "Hygiene Only") instead of silently
  // missing. Mapping the name in Membership → Settings moves the £ onto
  // the real person and removes this row.
  const statementOnlyGroup = (name: string) => {
    const key = `stmt:${name.toLowerCase()}`;
    let g = emailGroupMap.get(key);
    if (!g) {
      g = {
        displayName: name,
        representativeId: key,
        allIds: [],
        externalIds: [],
        locationId: null,
        isActive: true,
      };
      emailGroupMap.set(key, g);
    }
    return g;
  };

  for (const entry of membershipByRawName) {
    const explicit = explicitProviderMappings.get(entry.name);
    if (explicit && explicit.providerIds.length > 0) {
      // Explicit mapping wins outright — no fuzzy fallback even when
      // nothing resolves in this scope (role filtered out / deleted),
      // rather than let the name match hand the money to someone else.
      // Dedupe by representative: two duplicate rows of the same person are
      // ONE target, not an even-split pair.
      const targets: typeof allGroups = [];
      const seenReps = new Set<string>();
      for (const pid of explicit.providerIds) {
        const row = mappableRowById.get(pid);
        if (!row) continue;
        const key = (row.email ?? row.name ?? '').toLowerCase();
        let g = emailGroupMap.get(key);
        if (!g) {
          // The mapped person has NO provider row at this location — the
          // statement rows are stamped here, so inject a statement-only
          // group for them (no Dentally externalIds: their TPI production
          // stays under their own site's run; only the statement £ shows
          // here). Registered in emailGroupMap so several statement names
          // mapping to the same absent person still merge into one row.
          g = {
            displayName: row.name,
            representativeId: row.id,
            allIds: [row.id],
            externalIds: [],
            locationId: row.location_id ?? null,
            isActive: row.is_active !== false,
          };
          emailGroupMap.set(key, g);
        }
        if (!seenReps.has(g.representativeId)) {
          seenReps.add(g.representativeId);
          targets.push(g);
        }
      }
      if (targets.length === 1) {
        addMembershipMonths(targets[0].representativeId, entry.byMonth);
      } else if (targets.length > 1) {
        const parts = splitMonthsEqually(entry.byMonth, targets.length);
        targets.forEach((g, i) => addMembershipMonths(g.representativeId, parts[i]));
      } else {
        // Mapped, but nobody resolvable (all mapped rows role-filtered out
        // or deleted) — keep the £ visible under the statement name.
        addMembershipMonths(statementOnlyGroup(entry.name).representativeId, entry.byMonth);
      }
      continue;
    }
    const matchingGroups = fuzzyGroups.filter((g) => dentistNamesLikelyMatch(entry.name, g.displayName));
    if (matchingGroups.length === 1) {
      addMembershipMonths(matchingGroups[0].representativeId, entry.byMonth);
    } else {
      // No match, or ambiguous — a labeled statement row, never a dropped £.
      addMembershipMonths(statementOnlyGroup(entry.name).representativeId, entry.byMonth);
    }
  }

  // A group normally needs Dentally external ids to be worth an RPC pass,
  // but an explicitly-mapped provider with NO Dentally record still gets a
  // row — their statement membership revenue must show under them or the
  // provider total can never reconcile to the membership total. Read from
  // emailGroupMap (not the pre-loop allGroups snapshot) so groups injected
  // for mapped people with no row at this location are included.
  const groups = [...emailGroupMap.values()].filter(
    (g) => g.externalIds.length > 0 || membershipByRepresentativeId.has(g.representativeId),
  );

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
          // Statement membership never passes through tpi_price, so it isn't
          // in rawTotal yet — fold it in or the Production Data default
          // (which displays rawTotal) silently drops real revenue.
          cell.rawTotal = round2(cell.rawTotal + cell.membership);
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
      'all-providers-net-production-v24',
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
