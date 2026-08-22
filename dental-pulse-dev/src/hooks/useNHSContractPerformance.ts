import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLocations } from '@/hooks/useLocations';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ─── NHS Financial Year helpers ─────────────────────────────────────────────

interface FinancialYear {
  label: string;   // e.g. "2025/26"
  start: Date;     // Apr 1
  end: Date;       // Mar 31 next year
}

function getCurrentFinancialYear(): FinancialYear {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    label: `${year}/${String(year + 1).slice(2)}`,
    start: new Date(year, 3, 1),       // Apr 1
    end: new Date(year + 1, 2, 31),    // Mar 31
  };
}

/** Month index (0-based from Apr) for a date within the financial year */
function fyMonthIndex(d: Date): number {
  const m = d.getMonth(); // 0=Jan
  return m >= 3 ? m - 3 : m + 9;
}

const FY_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ContractCard {
  name: string;
  status: 'Profitable' | 'At Risk' | 'Loss-Making';
  udaTarget: string;
  udaRate: string;
  contractValue: string;
  contractValuePeriod: string;
  ytdCosts: string;
  ytdCostsPeriod: string;
  ytdProfit: string;
  ytdProfitPct: string;
  ytdProfitNegative?: boolean;
  udaDelivery: string;
  udaDeliveryRatio: string;
  deliveryProgress: number;
  deliveryStatus: 'on-track' | 'behind' | 'at-risk';
  deliveryLabel: string;
  expectedLabel: string;
}

export interface BandRow {
  band: string;
  udaValue: string;
  courses: number;
  totalUDAs: number;
  avgRevenue: string;
  avgCost: string;
  avgTime: string;
  benchmark: string;
  margin: string;
  marginPositive: boolean;
}

export interface ProviderRow {
  name: string;
  role: string;
  udasDelivered: number;
  target: number;
  deliveryPct: number;
  udasPerSession: number;
  band1: string;
  band2: string;
  band3: string;
  status: 'On Track' | 'Behind' | 'At Risk';
}

export interface RiskSignal {
  title: string;
  severity: 'Critical' | 'Warning';
  items: string[];
}

export interface SummaryCard {
  label: string;
  value: string;
  sub: string;
  highlight?: string;
}

export interface CumulativePoint {
  month: string;
  target: number;
  delivered: number | null;
}

export interface BandMixItem {
  name: string;
  value: number;
  courses: string;
  color: string;
}

export interface MonthlyUDAPoint {
  month: string;
  target: number;
  delivered: number | null;
}

// Raw claim row from Supabase
interface ClaimRow {
  nc_id: number | null;
  nc_claim_status: string | null;
  nc_expected_uda: number | null;
  nc_awarded_uda: number | null;
  nc_uda_band: string | null;
  nc_dentist_charge: number | null;
  nc_patient_charge: number | null;
  nc_practitioner_id: number | null;
  nc_contract_id: number | null;
  nc_ortho: boolean | null;
  nc_site_id: string | null;
  nc_submitted_date: string | null;
  nc_created_at: string | null;
  nc_scot_amount_expected: number | null;
  nc_scot_amount_authorised: number | null;
  location_id: string | null;
}

interface ProviderInfo {
  external_id: number;
  name: string;
  provider_role: string | null;
  uda_target: number;
}

// ─── Claim revenue/delivery helpers ─────────────────────────────────────────
// Scottish practices use scot_amount_expected/authorised instead of UDAs.
// English practices use expected_uda/awarded_uda + dentist_charge.
// We auto-detect based on which fields have data.

/** Get the fee expected for a claim (practice fee or dentist charge) */
function claimFeeExpected(c: ClaimRow): number {
  const scot = asNumber(c.nc_scot_amount_expected);
  if (scot > 0) return scot;
  return asNumber(c.nc_dentist_charge);
}

/** Get the fee awarded for a claim */
function claimFeeAwarded(c: ClaimRow): number {
  const scot = asNumber(c.nc_scot_amount_authorised);
  if (scot > 0) return scot;
  // For English: awarded UDA * rate, but we don't have rate — use dentist_charge as proxy
  return asNumber(c.nc_dentist_charge);
}

/** Get total revenue for a claim (fee expected + patient charge) */
function claimRevenue(c: ClaimRow): number {
  return claimFeeExpected(c) + asNumber(c.nc_patient_charge);
}

// ─── Band UDA values (standard NHS bands) ───────────────────────────────────

const BAND_UDA_MAP: Record<string, number> = {
  'band_1': 1, 'band 1': 1, '1': 1,
  'band_2': 3, 'band 2': 3, '2': 3,
  'band_3': 12, 'band 3': 12, '3': 12,
  'urgent': 1.2, 'band_urgent': 1.2,
};

function normalizeBandName(raw: string | null): string {
  if (!raw) return 'Other';
  const lower = raw.toLowerCase().trim();
  if (lower.includes('urgent')) return 'Urgent';
  if (lower.includes('3')) return 'Band 3';
  if (lower.includes('2')) return 'Band 2';
  if (lower.includes('1')) return 'Band 1';
  return raw;
}

function bandUdaValue(raw: string | null): number {
  if (!raw) return 1;
  const lower = raw.toLowerCase().trim();
  return BAND_UDA_MAP[lower] ?? 1;
}

const BAND_COLORS: Record<string, string> = {
  'Band 1': '#14b8a6',
  'Band 2': '#3b82f6',
  'Band 3': '#f59e0b',
  'Urgent': '#ef4444',
  'Other': '#8b5cf6',
};

// ─── Formatting helpers ─────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

function fmtCurrency2(n: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function fmtNumber(n: number): string {
  return n.toLocaleString('en-GB');
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useNHSContractPerformance() {
  const { user } = useAuth();
  const { organizationId, isLoading: orgLoading } = useOrganization();
  const { allAvailableLocations, isLoading: locationsLoading } = useLocations();
  const { selectedLocationId, selectedRegionId, dateRange } = useFilters();

  const fy = useMemo(() => getCurrentFinancialYear(), []);

  // Use the global date range filter (respects user's selection: last month, this month, etc.)
  const queryStartDate = useMemo(() => dateRange.startDate.toISOString(), [dateRange.startDate]);
  const queryEndDate = useMemo(() => {
    const end = new Date(dateRange.endDate);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }, [dateRange.endDate]);

  // Location filter setup
  const locationIdsForQuery = useMemo(() => {
    if (selectedLocationId) return [selectedLocationId];
    if (selectedRegionId) {
      const ids = allAvailableLocations
        .filter(l => l.region_id === selectedRegionId)
        .map(l => l.id);
      return ids.length > 0 ? ids : null;
    }
    return null; // org-wide
  }, [selectedLocationId, selectedRegionId, allAvailableLocations]);

  const locationKey = locationIdsForQuery ? locationIdsForQuery.slice().sort().join(',') : 'all';

  // ── Fetch nhs_claims ────────────────────────────────────────────────────────
  const { data: claims, isLoading: claimsLoading, error: claimsError } = useQuery({
    queryKey: ['nhs_claims', organizationId, queryStartDate, queryEndDate, locationKey],
    queryFn: async () => {
      if (!organizationId) return [] as ClaimRow[];

      // Get practice_locations.api_record_unique_id for location filtering
      let dentallyUUIDs: Set<string> | null = null;
      if (locationIdsForQuery) {
        const { data: locRows } = await (supabase as any)
          .from('practice_locations')
          .select('api_record_unique_id')
          .in('id', locationIdsForQuery)
          .is('deleted_at', null);
        const uuids = ((locRows ?? []) as Array<{ api_record_unique_id: string | null }>)
          .map(r => r.api_record_unique_id?.toLowerCase())
          .filter((v): v is string => !!v);
        if (uuids.length > 0) dentallyUUIDs = new Set(uuids);
      }

      const PAGE_SIZE = 1000;

      const allClaims: ClaimRow[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from('nhs_claims')
          .select('nc_id, nc_claim_status, nc_expected_uda, nc_awarded_uda, nc_uda_band, nc_dentist_charge, nc_patient_charge, nc_practitioner_id, nc_contract_id, nc_ortho, nc_site_id, nc_submitted_date, nc_created_at, nc_scot_amount_expected, nc_scot_amount_authorised, location_id')
          .eq('organization_id', organizationId)
          .eq('nc_claim_status', 'completed')
          .is('deleted_at', null)
          .gte('nc_submitted_date', queryStartDate)
          .lte('nc_submitted_date', queryEndDate)
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        const rows = (data ?? []) as ClaimRow[];

        for (const row of rows) {
          // Location filter: match nc_site_id against practice_locations.api_record_unique_id
          if (dentallyUUIDs) {
            const siteId = row.nc_site_id?.toLowerCase();
            if (siteId && dentallyUUIDs.has(siteId)) {
              allClaims.push(row);
            } else if (row.location_id && locationIdsForQuery?.includes(row.location_id)) {
              allClaims.push(row);
            }
          } else {
            allClaims.push(row);
          }
        }

        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      console.log('[NHSClaims] fetched', allClaims.length, 'completed claims for date range', queryStartDate, 'to', queryEndDate);
      if (allClaims.length > 0) {
        const sample = allClaims[0];
        console.log('[NHSClaims] sample claim:', JSON.stringify({
          nc_id: sample.nc_id,
          status: sample.nc_claim_status,
          scot_expected: sample.nc_scot_amount_expected,
          scot_authorised: sample.nc_scot_amount_authorised,
          dentist_charge: sample.nc_dentist_charge,
          patient_charge: sample.nc_patient_charge,
          expected_uda: sample.nc_expected_uda,
          submitted_date: sample.nc_submitted_date,
          created_at: sample.nc_created_at,
          contract_id: sample.nc_contract_id,
        }));
        // Sum totals for debugging
        const totals = allClaims.reduce((acc, c) => ({
          scot_expected: acc.scot_expected + asNumber(c.nc_scot_amount_expected),
          scot_authorised: acc.scot_authorised + asNumber(c.nc_scot_amount_authorised),
          dentist_charge: acc.dentist_charge + asNumber(c.nc_dentist_charge),
          patient_charge: acc.patient_charge + asNumber(c.nc_patient_charge),
        }), { scot_expected: 0, scot_authorised: 0, dentist_charge: 0, patient_charge: 0 });
        console.log('[NHSClaims] totals:', JSON.stringify(totals));
      }

      return allClaims;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // ── Fetch providers ─────────────────────────────────────────────────────────
  const { data: providers, isLoading: providersLoading } = useQuery({
    queryKey: ['nhs_providers', organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as ProviderInfo[];

      const PAGE_SIZE = 1000;
      const all: ProviderInfo[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from('providers')
          .select('external_id, name, provider_role, uda_target')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        const rows = (data ?? []) as Array<{
          external_id: number | null; name: string;
          provider_role: string | null; uda_target: number | null;
        }>;

        for (const r of rows) {
          if (r.external_id != null) {
            all.push({
              external_id: r.external_id,
              name: r.name,
              provider_role: r.provider_role,
              uda_target: asNumber(r.uda_target),
            });
          }
        }

        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      return all;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // ── Provider lookup map ─────────────────────────────────────────────────────
  const providerMap = useMemo(() => {
    const map = new Map<number, ProviderInfo>();
    for (const p of (providers ?? [])) {
      map.set(p.external_id, p);
    }
    return map;
  }, [providers]);

  // ── Current month progress within FY ────────────────────────────────────────
  const currentFYMonthIndex = useMemo(() => fyMonthIndex(new Date()), []);
  const monthsElapsed = currentFYMonthIndex + 1; // 1-based
  const expectedPct = Math.round((monthsElapsed / 12) * 100);

  // ── Detect practice type: UDA-based (England) vs Fee-based (Scotland) ─────
  const isScottish = useMemo(() => {
    const items = claims ?? [];
    if (items.length === 0) return false;
    // Scottish if: no UDA data but has scot amounts
    const hasUDAs = items.some(c => asNumber(c.nc_expected_uda) > 0);
    const hasScot = items.some(c => asNumber(c.nc_scot_amount_expected) > 0);
    return !hasUDAs && hasScot;
  }, [claims]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  Computed outputs
  // ═══════════════════════════════════════════════════════════════════════════

  // a) Summary KPIs
  const summary = useMemo((): {
    cards: SummaryCard[];
    totalUDATarget: number;
    totalUDADelivered: number;
    totalFeeExpected: number;
    totalFeeAwarded: number;
    ytdRevenue: number;
    avgRate: number;
    contractCount: number;
  } => {
    const items = claims ?? [];
    const provs = providers ?? [];

    const totalUDATarget = provs.reduce((s, p) => s + p.uda_target, 0);
    const totalUDADelivered = items.reduce((s, c) => s + asNumber(c.nc_expected_uda), 0);

    // Fee-based totals (works for both Scottish and English)
    const totalFeeExpected = items.reduce((s, c) => s + claimFeeExpected(c), 0);
    const totalFeeAwarded = items.reduce((s, c) => s + claimFeeAwarded(c), 0);
    const totalPatientCharge = items.reduce((s, c) => s + asNumber(c.nc_patient_charge), 0);

    // Revenue = total fees expected + patient charges
    const ytdRevenue = totalFeeExpected + totalPatientCharge;

    // Delivery percentage
    const deliveryPct = totalFeeExpected > 0 ? (totalFeeAwarded / totalFeeExpected) * 100 : 0;

    // Average rate per claim
    const avgRate = items.length > 0 ? totalFeeExpected / items.length : 0;

    // Contract count
    const contractIds = new Set<string>();
    for (const c of items) {
      const cid = c.nc_contract_id;
      if (cid != null && cid !== 0) contractIds.add(String(cid));
    }
    // If no explicit contract IDs but claims exist, count as 1 contract
    const contractCount = contractIds.size > 0 ? contractIds.size : (items.length > 0 ? 1 : 0);

    const cards: SummaryCard[] = isScottish ? [
      // Scottish practice — fee-based KPIs
      {
        label: 'TOTAL FEE EXPECTED',
        value: fmtCurrency(totalFeeExpected),
        sub: `${contractCount} contract${contractCount !== 1 ? 's' : ''}`,
      },
      {
        label: 'FEE DELIVERY',
        value: totalFeeExpected > 0 ? fmtPct(deliveryPct) : '--',
        sub: totalFeeExpected > 0 ? `${fmtCurrency(totalFeeAwarded)} / ${fmtCurrency(totalFeeExpected)}` : 'No claims',
        highlight: 'teal',
      },
      {
        label: 'YTD REVENUE',
        value: fmtCurrency(ytdRevenue),
        sub: `Avg ${fmtCurrency2(avgRate)} / claim`,
      },
      {
        label: 'TOTAL CLAIMS',
        value: fmtNumber(items.length),
        sub: `${items.filter(c => c.nc_claim_status === 'completed').length} completed`,
      },
      {
        label: 'PATIENT CHARGES',
        value: fmtCurrency(totalPatientCharge),
        sub: items.length > 0 ? `Avg ${fmtCurrency2(totalPatientCharge / items.length)} / claim` : '',
      },
    ] : [
      // English practice — UDA-based KPIs
      {
        label: 'EST. CONTRACT VALUE',
        value: totalUDATarget > 0 && totalUDADelivered > 0
          ? fmtCurrency((ytdRevenue / totalUDADelivered) * totalUDATarget)
          : (ytdRevenue > 0 ? fmtCurrency(ytdRevenue) : '--'),
        sub: `${contractCount} contract${contractCount !== 1 ? 's' : ''}`,
      },
      {
        label: 'UDA DELIVERY',
        value: totalUDATarget > 0 ? fmtPct((totalUDADelivered / totalUDATarget) * 100) : '--',
        sub: totalUDATarget > 0
          ? `${fmtNumber(Math.round(totalUDADelivered))} / ${fmtNumber(totalUDATarget)}`
          : 'No target set',
        highlight: 'teal',
      },
      {
        label: 'YTD REVENUE',
        value: fmtCurrency(ytdRevenue),
        sub: totalUDADelivered > 0
          ? `Avg ${fmtCurrency2(ytdRevenue / totalUDADelivered)} / UDA`
          : `Avg ${fmtCurrency2(avgRate)} / claim`,
      },
      {
        label: 'YTD PROFIT',
        value: '--',
        sub: 'Cost data unavailable',
      },
      {
        label: 'UDAS REMAINING',
        value: totalUDATarget > 0 ? fmtNumber(Math.round(Math.max(0, totalUDATarget - totalUDADelivered))) : '--',
        sub: totalUDATarget > 0
          ? `~${fmtNumber(Math.round(Math.max(0, totalUDATarget - totalUDADelivered) / Math.max(1, 12 - monthsElapsed)))} / month needed`
          : '',
      },
    ];

    return {
      cards,
      totalUDATarget,
      totalUDADelivered,
      totalFeeExpected,
      totalFeeAwarded,
      ytdRevenue,
      avgRate,
      contractCount,
    };
  }, [claims, providers, monthsElapsed, isScottish]);

  // b) Contract Cards
  const contractCards = useMemo((): ContractCard[] => {
    const items = claims ?? [];
    if (items.length === 0) return [];

    // Group by contract_id (use -1 for null/0 to distinguish from actual contract 0)
    const groups = new Map<number, ClaimRow[]>();
    for (const c of items) {
      const cid = c.nc_contract_id ?? 0;
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid)!.push(c);
    }

    const cards: ContractCard[] = [];
    for (const [cid, clms] of groups) {
      const isOrtho = clms.some(c => c.nc_ortho);
      const name = isOrtho ? 'Orthodontic Contract' :
        cid === 0 ? 'NHS Contract' :
        groups.size === 1 ? 'NHS Contract' : `NHS Contract #${cid}`;

      const feeExpected = clms.reduce((s, c) => s + claimFeeExpected(c), 0);
      const feeAwarded = clms.reduce((s, c) => s + claimFeeAwarded(c), 0);
      const revenue = clms.reduce((s, c) => s + claimRevenue(c), 0);
      const avgRate = clms.length > 0 ? feeExpected / clms.length : 0;
      const claimCount = clms.length;
      const completedCount = clms.filter(c => c.nc_claim_status === 'completed').length;

      // Delivery: fee awarded / fee expected
      const deliveryPct = feeExpected > 0 ? (feeAwarded / feeExpected) * 100 : 0;

      // Status heuristic based on completion rate and delivery
      let status: ContractCard['status'] = 'Profitable';
      let deliveryStatus: ContractCard['deliveryStatus'] = 'on-track';
      if (deliveryPct < 30) {
        status = 'At Risk';
        deliveryStatus = 'behind';
      } else if (deliveryPct < 50) {
        status = 'At Risk';
        deliveryStatus = 'behind';
      }

      const deliveryLabel = deliveryStatus === 'on-track'
        ? `On track ${fmtPct(deliveryPct)}`
        : `Behind ${fmtPct(deliveryPct)}`;

      cards.push({
        name,
        status,
        udaTarget: isScottish
          ? `${fmtNumber(claimCount)} claims`
          : `${fmtNumber(claimCount)} claims`,
        udaRate: `${fmtCurrency2(avgRate)} / claim`,
        contractValue: fmtCurrency(feeExpected),
        contractValuePeriod: 'fee expected',
        ytdCosts: fmtCurrency(feeAwarded),
        ytdCostsPeriod: 'fee awarded',
        ytdProfit: fmtNumber(claimCount),
        ytdProfitPct: `${completedCount} completed`,
        udaDelivery: fmtPct(deliveryPct),
        udaDeliveryRatio: `${fmtCurrency(feeAwarded)} / ${fmtCurrency(feeExpected)}`,
        deliveryProgress: Math.min(Math.round(deliveryPct), 100),
        deliveryStatus,
        deliveryLabel,
        expectedLabel: `Expected at month ${monthsElapsed}: ${expectedPct}%`,
      });
    }

    return cards.sort((a, b) => b.deliveryProgress - a.deliveryProgress);
  }, [claims, monthsElapsed, expectedPct, isScottish]);

  // c) Cumulative chart — use fee expected (works for both Scottish and English)
  const cumulativeData = useMemo((): CumulativePoint[] => {
    const items = claims ?? [];

    // Total expected fees spread linearly across 12 months as "target"
    const totalExpected = summary.totalFeeExpected;
    const monthlyTarget = totalExpected / 12;

    // Bucket awarded fees by FY month
    const awarded = new Array(12).fill(0);
    for (const c of items) {
      const dateStr = c.nc_submitted_date || c.nc_created_at;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const idx = fyMonthIndex(d);
      awarded[idx] += claimFeeAwarded(c);
    }

    let cumTarget = 0;
    let cumAwarded = 0;
    return FY_MONTHS.map((month, i) => {
      cumTarget += monthlyTarget;
      const isFuture = i > currentFYMonthIndex;
      if (!isFuture) {
        cumAwarded += awarded[i];
      }
      return {
        month,
        target: Math.round(cumTarget),
        delivered: isFuture ? null : Math.round(cumAwarded),
      };
    });
  }, [claims, summary.totalFeeExpected, currentFYMonthIndex]);

  // d) Band Mix donut — for Scottish practices, show by claim status instead
  const bandMixData = useMemo((): BandMixItem[] => {
    const items = claims ?? [];
    if (items.length === 0) return [];

    const hasUdaBands = items.some(c => c.nc_uda_band != null && c.nc_uda_band !== '');

    if (hasUdaBands) {
      // English: group by UDA band
      const bandAgg = new Map<string, { udas: number; courses: number }>();
      for (const c of items) {
        const band = normalizeBandName(c.nc_uda_band);
        const existing = bandAgg.get(band) ?? { udas: 0, courses: 0 };
        existing.udas += asNumber(c.nc_expected_uda);
        existing.courses += 1;
        bandAgg.set(band, existing);
      }
      return Array.from(bandAgg.entries())
        .map(([name, { udas, courses }]) => ({
          name,
          value: Math.round(udas),
          courses: `${fmtNumber(courses)} courses`,
          color: BAND_COLORS[name] ?? '#8b5cf6',
        }))
        .sort((a, b) => b.value - a.value);
    }

    // Scottish / no bands: group by claim status
    const statusColors: Record<string, string> = {
      'completed': '#14b8a6',
      'submitted': '#3b82f6',
      'new': '#f59e0b',
      'queued': '#8b5cf6',
    };
    const statusAgg = new Map<string, { fee: number; count: number }>();
    for (const c of items) {
      const status = c.nc_claim_status || 'other';
      const existing = statusAgg.get(status) ?? { fee: 0, count: 0 };
      existing.fee += claimFeeExpected(c);
      existing.count += 1;
      statusAgg.set(status, existing);
    }
    return Array.from(statusAgg.entries())
      .map(([name, { fee, count }]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value: Math.round(fee),
        courses: `${fmtNumber(count)} claims`,
        color: statusColors[name] ?? '#94a3b8',
      }))
      .sort((a, b) => b.value - a.value);
  }, [claims]);

  // e) Monthly chart — use fee amounts
  const monthlyUDAData = useMemo((): MonthlyUDAPoint[] => {
    const items = claims ?? [];
    const totalExpected = summary.totalFeeExpected;
    const monthlyTarget = Math.round(totalExpected / 12);

    const delivered = new Array(12).fill(0);
    for (const c of items) {
      const dateStr = c.nc_submitted_date || c.nc_created_at;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const idx = fyMonthIndex(d);
      delivered[idx] += claimFeeExpected(c);
    }

    return FY_MONTHS.map((month, i) => ({
      month,
      target: monthlyTarget,
      delivered: i > currentFYMonthIndex ? null : Math.round(delivered[i]),
    }));
  }, [claims, summary.totalFeeExpected, currentFYMonthIndex]);

  // f) Band Performance table
  const bandBreakdown = useMemo((): BandRow[] => {
    const items = claims ?? [];
    const hasUdaBands = items.some(c => c.nc_uda_band != null && c.nc_uda_band !== '');

    if (hasUdaBands) {
      const bandAgg = new Map<string, { courses: number; totalUDAs: number; totalRevenue: number }>();
      for (const c of items) {
        const band = normalizeBandName(c.nc_uda_band);
        const existing = bandAgg.get(band) ?? { courses: 0, totalUDAs: 0, totalRevenue: 0 };
        existing.courses += 1;
        existing.totalUDAs += asNumber(c.nc_expected_uda);
        existing.totalRevenue += claimRevenue(c);
        bandAgg.set(band, existing);
      }
      return Array.from(bandAgg.entries())
        .map(([band, { courses, totalUDAs, totalRevenue }]) => ({
          band,
          udaValue: `${bandUdaValue(band)} UDA`,
          courses,
          totalUDAs: Math.round(totalUDAs),
          avgRevenue: courses > 0 ? fmtCurrency2(totalRevenue / courses) : '--',
          avgCost: '--', avgTime: '--', benchmark: '--', margin: '--', marginPositive: true,
        }))
        .sort((a, b) => b.totalUDAs - a.totalUDAs);
    }

    // Scottish: group by status with fee data
    const statusAgg = new Map<string, { courses: number; totalFee: number; totalRevenue: number }>();
    for (const c of items) {
      const status = c.nc_claim_status || 'other';
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      const existing = statusAgg.get(label) ?? { courses: 0, totalFee: 0, totalRevenue: 0 };
      existing.courses += 1;
      existing.totalFee += claimFeeExpected(c);
      existing.totalRevenue += claimRevenue(c);
      statusAgg.set(label, existing);
    }
    return Array.from(statusAgg.entries())
      .map(([band, { courses, totalFee, totalRevenue }]) => ({
        band,
        udaValue: '--',
        courses,
        totalUDAs: Math.round(totalFee),
        avgRevenue: courses > 0 ? fmtCurrency2(totalRevenue / courses) : '--',
        avgCost: '--', avgTime: '--', benchmark: '--', margin: '--', marginPositive: true,
      }))
      .sort((a, b) => b.totalUDAs - a.totalUDAs);
  }, [claims]);

  // g) Provider Performance table
  const providerPerformance = useMemo((): ProviderRow[] => {
    const items = claims ?? [];
    const provAgg = new Map<number, {
      feeExpected: number; feeAwarded: number; claims: number;
      band1: number; band2: number; band3: number; totalFee: number;
    }>();

    for (const c of items) {
      const pid = c.nc_practitioner_id;
      if (pid == null) continue;
      const existing = provAgg.get(pid) ?? { feeExpected: 0, feeAwarded: 0, claims: 0, band1: 0, band2: 0, band3: 0, totalFee: 0 };
      const fee = claimFeeExpected(c);
      existing.feeExpected += fee;
      existing.feeAwarded += claimFeeAwarded(c);
      existing.claims += 1;
      existing.totalFee += fee;
      const band = normalizeBandName(c.nc_uda_band);
      if (band === 'Band 1' || band === 'Urgent') existing.band1 += fee;
      else if (band === 'Band 2') existing.band2 += fee;
      else if (band === 'Band 3') existing.band3 += fee;
      provAgg.set(pid, existing);
    }

    const rows: ProviderRow[] = [];
    for (const [pid, agg] of provAgg) {
      const prov = providerMap.get(pid);
      const target = prov?.uda_target ?? 0;

      // For Scottish: delivery = awarded / expected
      const deliveryPct = agg.feeExpected > 0
        ? Math.round((agg.feeAwarded / agg.feeExpected) * 100)
        : 0;

      let status: ProviderRow['status'] = 'On Track';
      if (agg.feeExpected > 0 && deliveryPct < 30) status = 'At Risk';
      else if (agg.feeExpected > 0 && deliveryPct < 50) status = 'Behind';

      const totalF = agg.totalFee || 1;
      rows.push({
        name: prov?.name ?? `Practitioner #${pid}`,
        role: prov?.provider_role ?? '--',
        udasDelivered: Math.round(agg.feeExpected), // repurposed: shows fee expected
        target: Math.round(agg.feeAwarded), // repurposed: shows fee awarded
        deliveryPct,
        udasPerSession: agg.claims, // repurposed: shows claim count
        band1: isScottish ? `${agg.claims}` : `${Math.round((agg.band1 / totalF) * 100)}%`,
        band2: isScottish ? fmtCurrency(agg.feeExpected) : `${Math.round((agg.band2 / totalF) * 100)}%`,
        band3: isScottish ? fmtCurrency(agg.feeAwarded) : `${Math.round((agg.band3 / totalF) * 100)}%`,
        status,
      });
    }

    return rows.sort((a, b) => b.udasDelivered - a.udasDelivered);
  }, [claims, providerMap, isScottish]);

  // h) Risk Signals
  const riskSignals = useMemo((): RiskSignal[] => {
    const items = claims ?? [];
    if (items.length === 0) return [];

    const signals: RiskSignal[] = [];

    // 1. Low award rate: awarded < 50% of expected at month >= 6
    if (monthsElapsed >= 6 && summary.totalFeeExpected > 0) {
      const awardPct = (summary.totalFeeAwarded / summary.totalFeeExpected) * 100;
      if (awardPct < 50) {
        signals.push({
          title: 'Low Award Rate',
          severity: 'Critical',
          items: [
            `Only ${fmtPct(awardPct)} of fees awarded (${fmtCurrency(summary.totalFeeAwarded)} of ${fmtCurrency(summary.totalFeeExpected)})`,
            `${items.filter(c => c.nc_claim_status === 'submitted').length} claims still pending approval`,
            'Review submitted claims for processing delays',
          ],
        });
      }
    }

    // 2. Provider with many pending claims
    const provSubmitted = new Map<string, number>();
    for (const c of items) {
      if (c.nc_claim_status === 'submitted' && c.nc_practitioner_id != null) {
        const name = providerMap.get(c.nc_practitioner_id)?.name ?? `Practitioner #${c.nc_practitioner_id}`;
        provSubmitted.set(name, (provSubmitted.get(name) ?? 0) + 1);
      }
    }
    const highPending = Array.from(provSubmitted.entries()).filter(([, count]) => count > 10);
    if (highPending.length > 0) {
      signals.push({
        title: 'Claims Awaiting Approval',
        severity: 'Warning',
        items: highPending.map(([name, count]) =>
          `${name}: ${count} claims submitted but not yet completed`
        ),
      });
    }

    // 3. Low completion rate
    const completedCount = items.filter(c => c.nc_claim_status === 'completed').length;
    const completionPct = (completedCount / items.length) * 100;
    if (completionPct < 40 && items.length >= 10) {
      signals.push({
        title: 'Low Completion Rate',
        severity: 'Warning',
        items: [
          `Only ${fmtPct(completionPct)} of claims completed (${completedCount} of ${items.length})`,
          'Most claims are still in submitted status',
        ],
      });
    }

    return signals;
  }, [claims, summary, monthsElapsed, providerMap]);

  // Contract filter options for band breakdown select
  const contractFilterOptions = useMemo(() => {
    const items = claims ?? [];
    const cids = new Set<number>();
    for (const c of items) {
      if (c.nc_contract_id != null && c.nc_contract_id !== 0) cids.add(c.nc_contract_id);
    }
    const opts: Array<{ value: string; label: string }> = [
      { value: 'all', label: 'All Contracts' },
    ];
    for (const cid of cids) {
      const isOrtho = items.some(c => c.nc_contract_id === cid && c.nc_ortho);
      const label = isOrtho ? 'Orthodontic' : cids.size === 1 ? 'NHS Contract' : `Contract #${cid}`;
      opts.push({ value: String(cid), label });
    }
    return opts;
  }, [claims]);

  // Filtered band breakdown by contract
  const getBandBreakdownForContract = useMemo(() => {
    return (contractFilter: string): BandRow[] => {
      const items = claims ?? [];
      const filtered = contractFilter === 'all'
        ? items
        : items.filter(c => String(c.nc_contract_id ?? 0) === contractFilter);

      const hasUdaBands = filtered.some(c => c.nc_uda_band != null && c.nc_uda_band !== '');

      if (hasUdaBands) {
        const bandAgg = new Map<string, { courses: number; totalUDAs: number; totalRevenue: number }>();
        for (const c of filtered) {
          const band = normalizeBandName(c.nc_uda_band);
          const existing = bandAgg.get(band) ?? { courses: 0, totalUDAs: 0, totalRevenue: 0 };
          existing.courses += 1;
          existing.totalUDAs += asNumber(c.nc_expected_uda);
          existing.totalRevenue += claimRevenue(c);
          bandAgg.set(band, existing);
        }
        return Array.from(bandAgg.entries())
          .map(([band, { courses, totalUDAs, totalRevenue }]) => ({
            band,
            udaValue: `${bandUdaValue(band)} UDA`,
            courses,
            totalUDAs: Math.round(totalUDAs),
            avgRevenue: courses > 0 ? fmtCurrency2(totalRevenue / courses) : '--',
            avgCost: '--', avgTime: '--', benchmark: '--', margin: '--', marginPositive: true,
          }))
          .sort((a, b) => b.totalUDAs - a.totalUDAs);
      }

      // Scottish: group by status
      const statusAgg = new Map<string, { courses: number; totalFee: number; totalRevenue: number }>();
      for (const c of filtered) {
        const status = c.nc_claim_status || 'other';
        const label = status.charAt(0).toUpperCase() + status.slice(1);
        const existing = statusAgg.get(label) ?? { courses: 0, totalFee: 0, totalRevenue: 0 };
        existing.courses += 1;
        existing.totalFee += claimFeeExpected(c);
        existing.totalRevenue += claimRevenue(c);
        statusAgg.set(label, existing);
      }
      return Array.from(statusAgg.entries())
        .map(([band, { courses, totalFee, totalRevenue }]) => ({
          band,
          udaValue: '--',
          courses,
          totalUDAs: Math.round(totalFee),
          avgRevenue: courses > 0 ? fmtCurrency2(totalRevenue / courses) : '--',
          avgCost: '--', avgTime: '--', benchmark: '--', margin: '--', marginPositive: true,
        }))
        .sort((a, b) => b.totalUDAs - a.totalUDAs);
    };
  }, [claims]);

  // Loading state
  const dependenciesLoading = orgLoading || locationsLoading || !user?.id;
  const isLoading = dependenciesLoading || claimsLoading || providersLoading;

  if (claimsError) console.error('[NHSContractPerformance] claims error:', claimsError);

  return {
    financialYear: fy,
    isLoading,
    isScottish,
    hasClaims: (claims ?? []).length > 0,
    summaryCards: summary.cards,
    contractCards,
    cumulativeData,
    bandMixData,
    monthlyUDAData,
    bandBreakdown,
    providerPerformance,
    riskSignals,
    contractFilterOptions,
    getBandBreakdownForContract,
  };
}
