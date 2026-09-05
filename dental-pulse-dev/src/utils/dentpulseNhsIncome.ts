/**
 * DentPulse NHS / MOS income = monthly actual count × UDA (or case) rate
 * from uda_settings — same formula as Version 2.0 when NHSIncomeFrom = DentPulse.
 *
 *   NHS: appointment_summary.uda_count × (nhs_contract_value / total_uda_obligation)
 *   MOS: appointment_summary.mos_count × (mos contract / obligation)
 *
 * MOS is folded into the NHS production bucket (V2 GetBenchmarkReport parity).
 *
 * FY contract ceiling: when the selected range fully covers a UK dental FY
 * (1 Apr–31 Mar), earned NHS/MOS income is capped at that location’s
 * uda_settings contract value for that FY (government max). Under-delivery
 * still shows actual earned income.
 */

import { format, parse, startOfDay, startOfMonth } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export type ContractType = 'NHS' | 'MOS';

export type UdaRateRow = {
  locationId: string | null;
  financialYear: number;
  contractType: ContractType;
  rate: number;
  /** Max £ income for this FY (nhs_contract_value column; used for MOS too). */
  contractValue: number;
};

type MonthSplit = { nhs: number; mos: number };

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** UK dental FY start year for a calendar date (Apr–Mar). Apr 2025 → 2025, Mar 2026 → 2025. */
export function ukDentalFinancialYear(d: Date): number {
  const month = d.getMonth(); // 0-based
  const year = d.getFullYear();
  return month >= 3 ? year : year - 1;
}

/** FY years whose full Apr–Mar window is contained in [fromDate, toDate]. */
export function fullyCoveredUkDentalFinancialYears(
  fromDate: Date,
  toDate: Date,
): number[] {
  const from = startOfDay(fromDate);
  const to = startOfDay(toDate);
  const fyStart = ukDentalFinancialYear(from);
  const fyEnd = ukDentalFinancialYear(to);
  const covered: number[] = [];
  for (let fy = fyStart; fy <= fyEnd; fy++) {
    const fyFrom = new Date(fy, 3, 1); // 1 Apr
    const fyTo = new Date(fy + 1, 2, 31); // 31 Mar
    if (from.getTime() <= fyFrom.getTime() && to.getTime() >= fyTo.getTime()) {
      covered.push(fy);
    }
  }
  return covered;
}

export function monthKeyToDate(monthKey: string): Date | null {
  // Production maps use 'MMM-yy' (e.g. Apr-25)
  const m = String(monthKey || '').trim();
  if (!m) return null;
  try {
    const parsed = parse(m, 'MMM-yy', new Date());
    if (Number.isNaN(parsed.getTime())) return null;
    return startOfMonth(parsed);
  } catch {
    return null;
  }
}

function isDentpulseSource(v: unknown): boolean {
  return String(v || '').trim().toLowerCase() === 'dentpulse';
}

/**
 * Resolve whether DentPulse rate×count should drive NHS and/or MOS for the scope.
 * Returns per-location flags so All Locations does not apply one site's DentPulse
 * formula (or contract rate) to practices that use PMS / Accounting / no contract.
 */
export async function resolveDentpulseIncomeFlags(
  organizationId: string,
  locationId?: string | null,
): Promise<{
  useNhs: boolean;
  useMos: boolean;
  /** Practice locations with nhs_income_source = dentpulse. */
  nhsLocationIds: Set<string>;
  /** Practice locations with mos_income_source = dentpulse. */
  mosLocationIds: Set<string>;
}> {
  const empty = {
    useNhs: false,
    useMos: false,
    nhsLocationIds: new Set<string>(),
    mosLocationIds: new Set<string>(),
  };

  let q = (supabase as any)
    .from('practice_locations')
    .select('id, nhs_income_source, mos_income_source')
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  if (locationId && locationId !== 'all') q = q.eq('id', locationId);

  const { data, error } = await q;
  if (error) {
    console.warn('[dentpulseNhsIncome] location source lookup:', error.message);
    return empty;
  }
  const rows = (data ?? []) as Array<{
    id: string;
    nhs_income_source?: string | null;
    mos_income_source?: string | null;
  }>;
  if (rows.length === 0) return empty;

  const nhsLocationIds = new Set<string>();
  const mosLocationIds = new Set<string>();
  for (const r of rows) {
    if (isDentpulseSource(r.nhs_income_source)) nhsLocationIds.add(String(r.id));
    if (isDentpulseSource(r.mos_income_source)) mosLocationIds.add(String(r.id));
  }

  return {
    useNhs: nhsLocationIds.size > 0,
    useMos: mosLocationIds.size > 0,
    nhsLocationIds,
    mosLocationIds,
  };
}

/** Load UDA rates for NHS and/or MOS across FYs that cover [fromDate, toDate]. */
export async function fetchUdaRates(
  organizationId: string,
  fromDate: Date,
  toDate: Date,
  contractTypes: ContractType[],
  locationId?: string | null,
): Promise<UdaRateRow[]> {
  if (contractTypes.length === 0) return [];

  const fyStart = ukDentalFinancialYear(fromDate);
  const fyEnd = ukDentalFinancialYear(toDate);
  const years: number[] = [];
  for (let y = fyStart; y <= fyEnd; y++) years.push(y);

  const q = (supabase as any)
    .from('uda_settings')
    .select(
      'location_id, financial_year, contract_type, nhs_contract_value, total_uda_obligation, uda_rate',
    )
    .eq('organization_id', organizationId)
    .in('financial_year', years)
    .in('contract_type', contractTypes);

  const { data, error } = await q;
  if (error) {
    console.warn('[dentpulseNhsIncome] uda_settings:', error.message);
    return [];
  }

  const rows = (data ?? []) as Array<{
    location_id: string | null;
    financial_year: number;
    contract_type: string;
    nhs_contract_value: number | string | null;
    total_uda_obligation: number | string | null;
    uda_rate: number | string | null;
  }>;

  const out: UdaRateRow[] = [];
  for (const r of rows) {
    const loc = r.location_id ? String(r.location_id) : null;
    // Prefer location-specific rows; keep org-wide (null) as fallback.
    if (locationId && locationId !== 'all' && loc && loc !== locationId) continue;

    const rateStored = Number(r.uda_rate);
    const contract = Number(r.nhs_contract_value) || 0;
    const obligation = Number(r.total_uda_obligation) || 0;
    const rate =
      Number.isFinite(rateStored) && rateStored > 0
        ? rateStored
        : obligation > 0
          ? contract / obligation
          : 0;
    if (rate <= 0) continue;

    const ct = String(r.contract_type || '').toUpperCase();
    if (ct !== 'NHS' && ct !== 'MOS') continue;

    out.push({
      locationId: loc,
      financialYear: Number(r.financial_year),
      contractType: ct as ContractType,
      rate,
      contractValue: contract > 0 ? contract : 0,
    });
  }
  return out;
}

function pickRateRow(
  rates: UdaRateRow[],
  contractType: ContractType,
  financialYear: number,
  providerLocationId: string | null,
): UdaRateRow | null {
  const matched = rates.filter(
    (r) => r.contractType === contractType && r.financialYear === financialYear,
  );
  if (matched.length === 0) return null;
  if (providerLocationId) {
    // Only this practice's contract. No org-wide / other-site fallback —
    // a site without uda_settings must stay £0 (Queens Street), and All
    // Locations must equal Loc1 + Loc2 rather than re-price everyone.
    return matched.find((r) => r.locationId === providerLocationId) ?? null;
  }
  return matched.find((r) => r.locationId == null) ?? null;
}

function pickRate(
  rates: UdaRateRow[],
  contractType: ContractType,
  financialYear: number,
  providerLocationId: string | null,
): number {
  return pickRateRow(rates, contractType, financialYear, providerLocationId)?.rate ?? 0;
}

function pickContractValue(
  rates: UdaRateRow[],
  contractType: ContractType,
  financialYear: number,
  providerLocationId: string | null,
): number {
  return (
    pickRateRow(rates, contractType, financialYear, providerLocationId)
      ?.contractValue ?? 0
  );
}

export type PractitionerMonthCount = {
  practitionerId: number;
  month: string; // yyyy-MM-01
  udaCount: number;
  mosCount: number;
};

/** Load NHS/MOS counts for the given Dentally practitioner external_ids. */
export async function fetchAppointmentCounts(
  organizationId: string,
  practitionerIds: number[],
  fromDate: Date,
  toDate: Date,
): Promise<PractitionerMonthCount[]> {
  if (practitionerIds.length === 0) return [];

  const from = format(startOfMonth(fromDate), 'yyyy-MM-dd');
  const to = format(startOfMonth(toDate), 'yyyy-MM-dd');

  const { data, error } = await (supabase as any)
    .from('appointment_summary')
    .select('practitioner_id, month, uda_count, mos_count')
    .eq('organization_id', organizationId)
    .in('practitioner_id', practitionerIds)
    .gte('month', from)
    .lte('month', to);

  if (error) {
    console.warn('[dentpulseNhsIncome] appointment_summary:', error.message);
    return [];
  }

  return ((data ?? []) as Array<{
    practitioner_id: number | string;
    month: string;
    uda_count: number | string | null;
    mos_count: number | string | null;
  }>).map((r) => ({
    practitionerId: Number(r.practitioner_id),
    month: String(r.month).slice(0, 10),
    udaCount: Number(r.uda_count) || 0,
    mosCount: Number(r.mos_count) || 0,
  }));
}

export type ProviderDentpulseNhsInput = {
  /** Dentally external_ids for this person */
  externalIds: number[];
  /** Primary practice location for rate lookup */
  locationId: string | null;
  /** Month keys matching production map ('MMM-yy') */
  monthKeys: string[];
};

function providerKeyOf(p: ProviderDentpulseNhsInput): string {
  return p.externalIds.slice().sort((a, b) => a - b).join(',');
}

/**
 * Build per-provider monthly NHS / MOS splits from rates × counts (uncapped).
 */
function computeDentpulseNhsMosSplitByMonth(
  providers: ProviderDentpulseNhsInput[],
  counts: PractitionerMonthCount[],
  rates: UdaRateRow[],
  options: {
    includeNhs: boolean;
    includeMos: boolean;
    nhsLocationIds?: Set<string>;
    mosLocationIds?: Set<string>;
  },
): Map<string, { [monthKey: string]: MonthSplit }> {
  const countByPracMonth = new Map<string, { uda: number; mos: number }>();
  for (const c of counts) {
    const key = `${c.practitionerId}|${c.month}`;
    const prev = countByPracMonth.get(key) ?? { uda: 0, mos: 0 };
    prev.uda += c.udaCount;
    prev.mos += c.mosCount;
    countByPracMonth.set(key, prev);
  }

  const out = new Map<string, { [monthKey: string]: MonthSplit }>();

  for (const p of providers) {
    const providerKey = providerKeyOf(p);
    const locId = p.locationId;
    const includeNhs =
      options.includeNhs &&
      (!options.nhsLocationIds ||
        (!!locId && options.nhsLocationIds.has(locId)));
    const includeMos =
      options.includeMos &&
      (!options.mosLocationIds ||
        (!!locId && options.mosLocationIds.has(locId)));

    const monthly: { [monthKey: string]: MonthSplit } = {};
    for (const mk of p.monthKeys) {
      const d = monthKeyToDate(mk);
      if (!d) {
        monthly[mk] = { nhs: 0, mos: 0 };
        continue;
      }
      const fy = ukDentalFinancialYear(d);
      const monthStart = format(d, 'yyyy-MM-dd');
      // Rate only from this practice's (or org-wide) uda_settings — never another site.
      const nhsRate = includeNhs ? pickRate(rates, 'NHS', fy, p.locationId) : 0;
      const mosRate = includeMos ? pickRate(rates, 'MOS', fy, p.locationId) : 0;

      let nhs = 0;
      let mos = 0;
      for (const extId of p.externalIds) {
        const c = countByPracMonth.get(`${extId}|${monthStart}`);
        if (!c) continue;
        if (includeNhs && nhsRate > 0) nhs += c.uda * nhsRate;
        if (includeMos && mosRate > 0) mos += c.mos * mosRate;
      }
      monthly[mk] = { nhs: round2(nhs), mos: round2(mos) };
    }
    out.set(providerKey, monthly);
  }

  return out;
}

/**
 * For each fully covered FY, scale NHS / MOS so location totals do not exceed
 * uda_settings contract values. Partial FY ranges are left uncapped.
 */
export function applyFyContractCaps(
  providers: ProviderDentpulseNhsInput[],
  split: Map<string, { [monthKey: string]: MonthSplit }>,
  rates: UdaRateRow[],
  fromDate: Date,
  toDate: Date,
  options: {
    includeNhs: boolean;
    includeMos: boolean;
    nhsLocationIds?: Set<string>;
    mosLocationIds?: Set<string>;
  },
): Map<string, { [monthKey: string]: MonthSplit }> {
  const fullFys = fullyCoveredUkDentalFinancialYears(fromDate, toDate);
  if (fullFys.length === 0) return split;

  // Mutable working copy
  const working = new Map<string, { [monthKey: string]: MonthSplit }>();
  for (const [pk, monthly] of split) {
    const copy: { [monthKey: string]: MonthSplit } = {};
    for (const [mk, cell] of Object.entries(monthly)) {
      copy[mk] = { nhs: cell.nhs, mos: cell.mos };
    }
    working.set(pk, copy);
  }

  const providersByKey = new Map(providers.map((p) => [providerKeyOf(p), p]));

  for (const fy of fullFys) {
    // Cap independently per practice location (each has its own contract).
    const byLocation = new Map<string, string[]>();
    for (const p of providers) {
      const pk = providerKeyOf(p);
      if (!working.has(pk)) continue;
      const locKey = p.locationId || '__org__';
      const list = byLocation.get(locKey) ?? [];
      list.push(pk);
      byLocation.set(locKey, list);
    }

    for (const [locKey, providerKeys] of byLocation) {
      const locId = locKey === '__org__' ? null : locKey;
      const sampleLoc =
        locId ??
        providersByKey.get(providerKeys[0]!)?.locationId ??
        null;

      // Only cap when this site uses DentPulse for that contract type.
      const capNhs =
        options.includeNhs &&
        (!options.nhsLocationIds ||
          (!!locId && options.nhsLocationIds.has(locId)));
      const capMos =
        options.includeMos &&
        (!options.mosLocationIds ||
          (!!locId && options.mosLocationIds.has(locId)));

      let nhsSum = 0;
      let mosSum = 0;
      const cells: Array<{ pk: string; mk: string }> = [];

      for (const pk of providerKeys) {
        const monthly = working.get(pk);
        if (!monthly) continue;
        for (const [mk, cell] of Object.entries(monthly)) {
          const d = monthKeyToDate(mk);
          if (!d || ukDentalFinancialYear(d) !== fy) continue;
          nhsSum += cell.nhs;
          mosSum += cell.mos;
          cells.push({ pk, mk });
        }
      }

      // Cap only from THIS location's uda_settings contract (no cross-site fallback).
      const nhsCap = capNhs ? pickContractValue(rates, 'NHS', fy, sampleLoc) : 0;
      const mosCap = capMos ? pickContractValue(rates, 'MOS', fy, sampleLoc) : 0;

      const nhsScale =
        nhsCap > 0 && nhsSum > nhsCap + 0.005 ? nhsCap / nhsSum : 1;
      const mosScale =
        mosCap > 0 && mosSum > mosCap + 0.005 ? mosCap / mosSum : 1;

      if (nhsScale >= 1 && mosScale >= 1) continue;

      for (const { pk, mk } of cells) {
        const cell = working.get(pk)?.[mk];
        if (!cell) continue;
        if (nhsScale < 1) cell.nhs = round2(cell.nhs * nhsScale);
        if (mosScale < 1) cell.mos = round2(cell.mos * mosScale);
      }
    }
  }

  return working;
}

function combineSplits(
  split: Map<string, { [monthKey: string]: MonthSplit }>,
): Map<string, { [monthKey: string]: number }> {
  const out = new Map<string, { [monthKey: string]: number }>();
  for (const [pk, monthly] of split) {
    const combined: { [monthKey: string]: number } = {};
    for (const [mk, cell] of Object.entries(monthly)) {
      combined[mk] = round2(cell.nhs + cell.mos);
    }
    out.set(pk, combined);
  }
  return out;
}

/**
 * Build per-provider monthly NHS income (NHS + optional MOS) from rates × counts.
 * Applies FY contract caps when the date range fully covers one or more FYs.
 * Returns Map providerKey → monthKey → £ amount.
 */
export function computeDentpulseNhsByMonth(
  providers: ProviderDentpulseNhsInput[],
  counts: PractitionerMonthCount[],
  rates: UdaRateRow[],
  options: {
    includeNhs: boolean;
    includeMos: boolean;
    nhsLocationIds?: Set<string>;
    mosLocationIds?: Set<string>;
  },
  fromDate?: Date,
  toDate?: Date,
): Map<string, { [monthKey: string]: number }> {
  const split = computeDentpulseNhsMosSplitByMonth(
    providers,
    counts,
    rates,
    options,
  );
  const capped =
    fromDate && toDate
      ? applyFyContractCaps(providers, split, rates, fromDate, toDate, options)
      : split;
  return combineSplits(capped);
}

/**
 * High-level: load flags, rates, counts and return monthly NHS overlays keyed by
 * sorted externalIds join (same key as computeDentpulseNhsByMonth).
 */
export async function fetchDentpulseNhsMonthlyOverlay(
  organizationId: string,
  fromDate: Date,
  toDate: Date,
  providers: ProviderDentpulseNhsInput[],
  locationId?: string | null,
): Promise<Map<string, { [monthKey: string]: number }>> {
  const flags = await resolveDentpulseIncomeFlags(organizationId, locationId);
  if (!flags.useNhs && !flags.useMos) return new Map();

  // Only overlay providers whose home practice uses DentPulse for NHS/MOS.
  // Others keep PMS / Accounting figures (critical for All Locations).
  const eligibleProviders = providers.filter((p) => {
    const loc = p.locationId;
    if (!loc) return false;
    return (
      (flags.useNhs && flags.nhsLocationIds.has(loc)) ||
      (flags.useMos && flags.mosLocationIds.has(loc))
    );
  });
  if (eligibleProviders.length === 0) return new Map();

  const contractTypes: ContractType[] = [];
  if (flags.useNhs) contractTypes.push('NHS');
  if (flags.useMos) contractTypes.push('MOS');

  const allExtIds = [
    ...new Set(
      eligibleProviders.flatMap((p) => p.externalIds).filter((id) => Number.isFinite(id)),
    ),
  ];
  if (allExtIds.length === 0) return new Map();

  const [rates, counts] = await Promise.all([
    fetchUdaRates(organizationId, fromDate, toDate, contractTypes, locationId),
    fetchAppointmentCounts(organizationId, allExtIds, fromDate, toDate),
  ]);

  if (rates.length === 0) return new Map();

  return computeDentpulseNhsByMonth(
    eligibleProviders,
    counts,
    rates,
    {
      includeNhs: flags.useNhs,
      includeMos: flags.useMos,
      nhsLocationIds: flags.nhsLocationIds,
      mosLocationIds: flags.mosLocationIds,
    },
    fromDate,
    toDate,
  );
}
