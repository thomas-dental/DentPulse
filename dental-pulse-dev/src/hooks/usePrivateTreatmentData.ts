import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useLocations } from '@/hooks/useLocations';
import { useFilters } from '@/contexts/FilterContext';
import {
  fetchPaidInvoiceLookup,
  fetchTpisForInvoiceIds,
  type TreatmentDateBasis,
} from '@/lib/paidDateBasis';
import { fetchSetupCategoryPaymentPlanIds } from '@/lib/setupCategoryPaymentPlans';

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function planIdKey(id: number | string | null | undefined): number | null {
  if (id == null) return null;
  const n = typeof id === 'number' ? id : Number(id);
  return Number.isFinite(n) ? n : null;
}

/** Convert a Date to YYYY-MM-DD string (local time, no timezone shift). */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Resolve a stored timestamp to its Europe/London calendar date (YYYY-MM-DD).
// tpi_completed_at is stored UTC; Dentally date-only completions land at London
// midnight (e.g. 2026-05-31T23:00:00Z = 1 Jun 00:00 BST). Using the raw UTC date
// (substring 0,10) files those under the previous day/month. Mirrors the helper in
// useTreatmentInsights.ts.
const LONDON_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});
function toLondonDateStr(ts: string | null | undefined): string {
  if (!ts) return '';
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts);
  const d = new Date(hasTz ? ts : ts.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(ts).substring(0, 10);
  return LONDON_YMD.format(d); // en-CA → "YYYY-MM-DD"
}

export interface PrivateSummary {
  privateRevenue: number;
  treatmentUnits: number;
  avgTreatmentValue: number;
  chairTimeUtilized: number;
  revenueTrend: number;
  unitsTrend: number;
  avgValueTrend: number;
  chairTimeTrend: number;
  patientCount: number;
}

export interface CategoryRevenue {
  category: string;
  revenue: number;
  units: number;
}

export interface MonthlyActualTarget {
  month: string;
  actual: number;
  target: number;
}

const PAGE_SIZE = 1000;

/** Paginated fetch helper. */
async function fetchAll<T>(buildQuery: () => any, pageSize = PAGE_SIZE): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) { console.error('[fetchAll] error:', error); break; }
    const rows = (data ?? []) as T[];
    all.push(...rows);
    hasMore = rows.length === pageSize;
    offset += pageSize;
  }
  return all;
}

type TpiRow = {
  tpi_price: number | string | null;
  tpi_treatment_id: number | string | null;
  tpi_patient_id: number | string | null;
  tpi_completed_at: string | null;
  tpi_payment_plan_id: number | string | null;
  tpi_treatment_appointment_id: number | string | null;
  tpi_practitioner_id: number | string | null;
  duration: number | string | null;
};

/** TpiRow stamped with the day it is reported under for the selected basis:
 *  Europe/London completed date ("Completed on") or invoice paid date
 *  ("Paid on"). All bucketing below uses this, never the raw timestamp. */
type TpiRowWithBasis = TpiRow & { basisDate: string };

const TPI_SELECT =
  'tpi_price, tpi_treatment_id, tpi_patient_id, tpi_completed_at, tpi_payment_plan_id, tpi_treatment_appointment_id, tpi_practitioner_id, duration';

/**
 * Fetch completed, plan-linked TPIs whose basis day falls in
 * [fromYMD .. toYMD] (inclusive) and stamp each with its basisDate.
 *
 * Completed basis: date-bounded fetch on tpi_completed_at (widened a day below
 * `fetchLowerBoundYMD` for the BST boundary) — callers drop spill-over.
 * Paid basis: fetch the Dentally invoices PAID in the window first (paid_date
 * is a plain DATE, no widening needed), then the TPIs belonging to them — a
 * treatment completed months earlier still counts in the period its invoice
 * was paid, matching Dentally's Practitioner Activity "Paid on" report.
 */
async function fetchTpisForWindow(
  organizationId: string,
  dateBasis: TreatmentDateBasis,
  fromYMD: string,
  toYMD: string,
  fetchLowerBoundYMD: string,
): Promise<TpiRowWithBasis[]> {
  if (dateBasis === 'paid') {
    const paidLookup = await fetchPaidInvoiceLookup(organizationId, fromYMD, toYMD);
    if (paidLookup.ids.length === 0) return [];
    const rows = await fetchTpisForInvoiceIds<TpiRow & { tpi_invoice_id: number | string | null; integration_id: string | null }>(
      paidLookup.ids,
      (chunkIds) =>
        (supabase as any)
          .from('treatment_plan_items')
          .select(TPI_SELECT + ', tpi_invoice_id, integration_id')
          .eq('organization_id', organizationId)
          .eq('tpi_completed', true)
          .not('tpi_completed_at', 'is', null)
          .not('tpi_payment_plan_id', 'is', null)
          .in('tpi_invoice_id', chunkIds)
          .order('tpi_id'),
    );
    const out: TpiRowWithBasis[] = [];
    for (const r of rows) {
      const basisDate = paidLookup.get(r.tpi_invoice_id, r.integration_id);
      if (!basisDate) continue;
      out.push({ ...r, basisDate });
    }
    return out;
  }

  const rows = await fetchAll<TpiRow>(() =>
    (supabase as any)
      .from('treatment_plan_items')
      .select(TPI_SELECT)
      .eq('organization_id', organizationId)
      .eq('tpi_completed', true)
      .not('tpi_completed_at', 'is', null)
      .not('tpi_payment_plan_id', 'is', null)
      .gte('tpi_completed_at', fetchLowerBoundYMD)
      .lte('tpi_completed_at', toYMD + 'T23:59:59')
      .order('tpi_completed_at')
      .order('tpi_id')
  );
  return rows.map((r) => ({ ...r, basisDate: toLondonDateStr(r.tpi_completed_at) }));
}

/**
 * Fetches private payment plan IDs from Setup Categories (including inactive
 * plans and same-name siblings). Falls back to a plan named "Private" only
 * when nothing is mapped.
 */
async function fetchPrivatePlanIds(
  organizationId: string,
  selectedLocationId: string | null,
): Promise<Set<number>> {
  const mapped = await fetchSetupCategoryPaymentPlanIds(
    organizationId,
    selectedLocationId,
    ['private'],
  );
  const privatePlanPpIds = new Set(mapped.private);

  if (privatePlanPpIds.size === 0) {
    const { data: plans } = await (supabase as any)
      .from('payment_plans')
      .select('pp_id, pp_name')
      .eq('organization_id', organizationId)
      .is('deleted_at', null);
    if (plans) {
      for (const plan of plans as Array<{ pp_id: number | string; pp_name: string | null }>) {
        if (plan.pp_name && plan.pp_name.toLowerCase() === 'private') {
          const n = Number(plan.pp_id);
          if (Number.isFinite(n)) privatePlanPpIds.add(n);
        }
      }
    }
  }

  return privatePlanPpIds;
}

/**
 * Fetches provider external_ids filtered by location.
 * Matches SQL: JOIN providers p ON p.external_id = tpi.tpi_practitioner_id WHERE p.location_id = ?
 */
async function fetchProviderExternalIds(
  organizationId: string,
  locationIds: string[] | null,
): Promise<Set<string> | null> {
  if (!locationIds) return null; // no location filter — include all

  const allIds = new Set<string>();
  for (const locId of locationIds) {
    const { data } = await (supabase as any)
      .from('providers')
      .select('external_id')
      .eq('organization_id', organizationId)
      .eq('location_id', locId);
    for (const row of (data ?? []) as Array<{ external_id: number | string | null }>) {
      if (row.external_id != null) allIds.add(String(row.external_id));
    }
  }
  return allIds;
}

export function usePrivateTreatmentData(
  /** Date basis for the whole page — mirrors the Date dropdown on Dentally's
   *  Practitioner Activity report. 'completed' (default) dates every item by
   *  its completion day; 'paid' dates it by its invoice's paid day. */
  dateBasis: TreatmentDateBasis = 'completed',
) {
  const { organizationId } = useOrganization();
  const { allAvailableLocations } = useLocations();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();

  const allLocationIds = useMemo(
    () => allAvailableLocations.map(l => l.id),
    [allAvailableLocations],
  );

  const regionLocationIds = useMemo(() => {
    if (!selectedRegionId || selectedLocationId) return null;
    return allAvailableLocations
      .filter(l => l.region_id === selectedRegionId)
      .map(l => l.id);
  }, [selectedRegionId, selectedLocationId, allAvailableLocations]);

  const locationFilter = useMemo(() => {
    if (selectedLocationId) return { type: 'single' as const, ids: [selectedLocationId] };
    if (regionLocationIds && regionLocationIds.length > 0) return { type: 'multi' as const, ids: regionLocationIds };
    if (allLocationIds.length > 0) return { type: 'multi' as const, ids: allLocationIds };
    return null;
  }, [selectedLocationId, regionLocationIds, allLocationIds]);

  const locationKey = locationFilter ? locationFilter.ids.slice().sort().join(',') : 'none';

  // Location IDs for provider-based filtering (null = no specific location filter)
  const locationIdsForFilter = useMemo(() => {
    if (selectedLocationId) return [selectedLocationId];
    if (regionLocationIds && regionLocationIds.length > 0) return regionLocationIds;
    return null;
  }, [selectedLocationId, regionLocationIds]);

  const startDateStr = toDateStr(dateRange.startDate);
  const endDateStr = toDateStr(dateRange.endDate);

  // Previous period: same duration immediately before current period
  const periodMs = dateRange.endDate.getTime() - dateRange.startDate.getTime();
  const prevStartDate = new Date(dateRange.startDate.getTime() - periodMs - 86400000); // subtract period + 1 day
  const prevEndDate = new Date(dateRange.startDate.getTime() - 86400000); // day before current start
  const prevStartDateStr = toDateStr(prevStartDate);
  const prevEndDateStr = toDateStr(prevEndDate);
  // Widen the UTC fetch lower bound by a day: a treatment whose LONDON date is
  // prevStartDate can have a UTC timestamp on the prior day (BST = UTC+1), so a UTC
  // `.gte(prevStartDate)` would miss it. We over-fetch, then filter by London date below.
  const fetchLowerBoundStr = toDateStr(new Date(prevStartDate.getTime() - 86400000));

  // ─── Main query ───
  // Matches SQL: JOIN providers (location filter), JOIN payment_plans (ensures plan exists)
  // Revenue: all completed TPIs in date range at location
  // Treatment units: only TPIs with tpi_treatment_appointment_id > 0
  // Fetches both current + previous period for trend comparison
  const { data: rawData, isLoading: dataLoading } = useQuery({
    queryKey: ['private_treatment_data_v3', organizationId, locationKey, startDateStr, endDateStr, selectedRegionId, dateBasis],
    queryFn: async () => {
      if (!organizationId || !locationFilter || locationFilter.ids.length === 0) {
        return { categories: [] as CategoryRevenue[], totalRevenue: 0, totalUnits: 0, patientCount: 0, prevRevenue: 0, prevUnits: 0, prevChairMinutes: 0, chairMinutes: 0 };
      }

      // Step 1: Get provider external_ids at selected location(s) + private plan IDs in parallel
      const [providerExtIds, privatePlanPpIds] = await Promise.all([
        fetchProviderExternalIds(organizationId, locationIdsForFilter),
        fetchPrivatePlanIds(organizationId, selectedLocationId),
      ]);
      if (privatePlanPpIds.size === 0) {
        return { categories: [] as CategoryRevenue[], totalRevenue: 0, totalUnits: 0, patientCount: 0, prevRevenue: 0, prevUnits: 0, prevChairMinutes: 0, chairMinutes: 0 };
      }

      // Step 2: Fetch completed TPIs for both current + previous period in one
      // pass, stamped with their basis day (completed / invoice-paid date).
      const allTpis: TpiRowWithBasis[] = await fetchTpisForWindow(
        organizationId, dateBasis, prevStartDateStr, endDateStr, fetchLowerBoundStr,
      );
      if (allTpis.length === 0) {
        return { categories: [] as CategoryRevenue[], totalRevenue: 0, totalUnits: 0, patientCount: 0, prevRevenue: 0, prevUnits: 0, prevChairMinutes: 0, chairMinutes: 0 };
      }

      // Step 3: Filter by provider location (matches SQL: p.location_id = ?)
      const locationFilteredTpis = providerExtIds
        ? allTpis.filter(t => t.tpi_practitioner_id != null && providerExtIds.has(String(t.tpi_practitioner_id)))
        : allTpis;

      if (locationFilteredTpis.length === 0) {
        return { categories: [] as CategoryRevenue[], totalRevenue: 0, totalUnits: 0, patientCount: 0, prevRevenue: 0, prevUnits: 0, prevChairMinutes: 0, chairMinutes: 0 };
      }

      // Step 3b: Filter by private payment plan IDs (from practice_locations.private_income_accounts)
      const privateTpis = locationFilteredTpis.filter(t => {
        const ppid = planIdKey(t.tpi_payment_plan_id);
        return ppid != null && privatePlanPpIds.has(ppid);
      });
      if (privateTpis.length === 0) {
        return { categories: [] as CategoryRevenue[], totalRevenue: 0, totalUnits: 0, patientCount: 0, prevRevenue: 0, prevUnits: 0, prevChairMinutes: 0, chairMinutes: 0 };
      }

      // Step 3c: Split into current and previous period on the basis day
      // (London completed date, or invoice paid date on the paid basis). The
      // widened completed-basis fetch pulls a day of spill-over, so drop
      // anything outside [prevStart, end].
      const currentTpis: TpiRowWithBasis[] = [];
      const prevTpis: TpiRowWithBasis[] = [];
      for (const tpi of privateTpis) {
        const d = tpi.basisDate;
        if (!d || d < prevStartDateStr || d > endDateStr) continue;
        if (d >= startDateStr) currentTpis.push(tpi);
        else prevTpis.push(tpi);
      }

      // Step 4: Fetch categories + treatments in parallel
      const [catResult, treatResult] = await Promise.all([
        (supabase as any)
          .from('treatment_categories')
          .select('id, name')
          .eq('organization_id', organizationId)
          .is('deleted_at', null),
        (async () => {
          const all: Array<{ id: string; external_id: number | string | null; category_id: string | null; duration_minutes: number | null }> = [];
          let from = 0;
          let hasMore = true;
          while (hasMore) {
            const { data } = await (supabase as any)
              .from('treatments')
              .select('id, external_id, category_id, duration_minutes')
              .eq('organization_id', organizationId)
              .is('deleted_at', null)
              .eq('is_active', true)
              .order('id')
              .range(from, from + PAGE_SIZE - 1);
            const rows = (data ?? []) as typeof all;
            all.push(...rows);
            hasMore = rows.length === PAGE_SIZE;
            from += PAGE_SIZE;
          }
          return all;
        })(),
      ]);

      const categoryMap = new Map<string, string>();
      ((catResult.data || []) as any[]).forEach((c: any) => {
        if (c?.id && c?.name) categoryMap.set(c.id, c.name);
      });

      const treatmentsById = new Map<string, { id: string; categoryName: string; durationMinutes: number }>();
      for (const t of treatResult) {
        const catName = (t.category_id && categoryMap.get(t.category_id)) || 'Uncategorised';
        const entry = { id: t.id, categoryName: catName, durationMinutes: asNumber(t.duration_minutes) };
        treatmentsById.set(t.id, entry);
        if (t.external_id != null) treatmentsById.set(String(t.external_id), entry);
      }

      // Step 5: Aggregate current period
      // Revenue: sum all TPIs (treatment-revenue.txt query — no tpi_treatment_appointment_id filter)
      // Treatment units: count only TPIs with tpi_treatment_appointment_id > 0 (no-of-treatments.txt query)
      const catAgg = new Map<string, { revenue: number; units: number }>();
      const uniquePatients = new Set<string>();
      let totalRevenue = 0;
      let totalUnits = 0;
      let chairMinutes = 0;

      for (const tpi of currentTpis) {
        // Exclude rows with no delivered-appointment link (tpi_treatment_appointment_id <= 0)
        // from BOTH revenue and units. Dentally's Practitioner Activity report counts only
        // treatments delivered in an appointment; completed TPIs without a treatment_appointment
        // (planning artifacts / tooth-status charting rows, which carry spurious prices) are
        // excluded. Mirrors the reconciled useTreatmentInsights gate (matched Dentally exactly).
        // Previously revenue summed ALL rows while units gated — the inconsistency overstated
        // category revenue (e.g. Surface/Dentures/Bridges) vs Dentally.
        const taId = asNumber(tpi.tpi_treatment_appointment_id);
        if (taId <= 0) continue;

        const amount = asNumber(tpi.tpi_price);
        totalRevenue += amount;
        totalUnits += 1;

        // Chair time mirrors Dentally's "Duration" per TPI (= treatment_plan_items.duration).
        // Falls back to the treatment-setup template duration only when the
        // TPI has no Dentally-stamped duration value.
        let treatment: { id: string; categoryName: string; durationMinutes: number } | undefined;
        if (tpi.tpi_treatment_id != null) {
          treatment = treatmentsById.get(String(tpi.tpi_treatment_id));
        }
        const tpiDur = asNumber(tpi.duration);
        chairMinutes += tpiDur > 0 ? tpiDur : (treatment ? treatment.durationMinutes : 0);

        if (tpi.tpi_patient_id != null) uniquePatients.add(String(tpi.tpi_patient_id));

        const catName = treatment ? treatment.categoryName : 'Uncategorised';
        const existing = catAgg.get(catName) || { revenue: 0, units: 0 };
        existing.revenue += amount;
        existing.units += 1;
        catAgg.set(catName, existing);
      }

      // Step 6: Aggregate previous period
      let prevRevenue = 0;
      let prevUnits = 0;
      let prevChairMinutes = 0;
      for (const tpi of prevTpis) {
        // Same delivered-appointment gate as the current period so the trend compares
        // like-for-like (exclude unlinked/charting rows from revenue + units + chair time).
        const taId = asNumber(tpi.tpi_treatment_appointment_id);
        if (taId <= 0) continue;
        prevRevenue += asNumber(tpi.tpi_price);
        prevUnits += 1;
        // Same tpi.duration lookup for the prev period so the chair-time trend
        // compares like-for-like with the current period.
        let prevTreatment: { id: string; categoryName: string; durationMinutes: number } | undefined;
        if (tpi.tpi_treatment_id != null) {
          prevTreatment = treatmentsById.get(String(tpi.tpi_treatment_id));
        }
        const prevTpiDur = asNumber(tpi.duration);
        prevChairMinutes += prevTpiDur > 0 ? prevTpiDur : (prevTreatment ? prevTreatment.durationMinutes : 0);
      }

      const categories: CategoryRevenue[] = Array.from(catAgg.entries())
        .map(([category, stats]) => ({ category, revenue: stats.revenue, units: stats.units }))
        .sort((a, b) => b.revenue - a.revenue);

      return { categories, totalRevenue, totalUnits, patientCount: uniquePatients.size, prevRevenue, prevUnits, prevChairMinutes, chairMinutes };
    },
    enabled: !!organizationId && !!locationFilter && locationFilter.ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Monthly actual vs target (last 4 months) ───
  const monthBuckets = useMemo(() => {
    const buckets: { label: string; startDate: string; endDate: string; period: string }[] = [];
    const now = dateRange.endDate;
    for (let i = 3; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const label = d.toLocaleString('default', { month: 'short' });
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.push({ label, startDate: toDateStr(d), endDate: toDateStr(lastDay), period });
    }
    return buckets;
  }, [dateRange.endDate]);

  const { data: monthlyPerf, isLoading: perfLoading } = useQuery({
    queryKey: ['private_treatment_monthly_v2', organizationId, locationKey, monthBuckets.map(b => b.period).join(','), selectedRegionId, dateBasis],
    queryFn: async () => {
      if (!organizationId || !locationFilter || locationFilter.ids.length === 0) return [] as MonthlyActualTarget[];

      // Step A: Find private treatment category names
      // Get categories that contain at least one private treatment
      const [catResult, treatResult] = await Promise.all([
        (supabase as any)
          .from('treatment_categories')
          .select('id, name')
          .eq('organization_id', organizationId)
          .is('deleted_at', null),
        (supabase as any)
          .from('treatments')
          .select('category_id, treatment_type')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .eq('is_active', true)
          .eq('treatment_type', 'private'),
      ]);

      const catIdToName = new Map<string, string>();
      for (const c of ((catResult.data || []) as Array<{ id: string; name: string }>)) {
        catIdToName.set(c.id, c.name);
      }

      // Collect category names that have private treatments
      const privateCategoryNames = new Set<string>();
      for (const t of ((treatResult.data || []) as Array<{ category_id: string | null; treatment_type: string }>)) {
        if (t.category_id) {
          const name = catIdToName.get(t.category_id);
          if (name) privateCategoryNames.add(name);
        }
      }

      // Step B: Fetch targets from treatment_goal_targets
      // period_date format is 'M-YYYY' (e.g., '3-2026')
      const goalPeriods = monthBuckets.map(b => {
        const [y, m] = b.period.split('-');
        return `${parseInt(m, 10)}-${y}`; // YYYY-MM → M-YYYY
      });

      let goalQuery = (supabase as any)
        .from('treatment_goal_targets')
        .select('category_name, period_date, unit_target, avg_amount_target')
        .eq('organization_id', organizationId)
        .eq('period_type', 'month')
        .in('period_date', goalPeriods);

      // Apply location/region filter
      if (selectedLocationId) {
        goalQuery = goalQuery.or(`location_id.eq.${selectedLocationId},location_id.is.null`);
      } else if (selectedRegionId) {
        goalQuery = goalQuery.or(`region_id.eq.${selectedRegionId},region_id.is.null`);
      }

      const { data: goalRows } = await goalQuery;

      // Sum target = unit_target × avg_amount_target for private categories per period
      const targetByPeriod = new Map<string, number>();
      for (const row of (goalRows ?? []) as Array<{ category_name: string; period_date: string; unit_target: number | string | null; avg_amount_target: number | string | null }>) {
        if (!privateCategoryNames.has(row.category_name)) continue;
        const targetAmount = asNumber(row.unit_target) * asNumber(row.avg_amount_target);
        // Convert period_date 'M-YYYY' back to 'YYYY-MM' for matching
        const parts = row.period_date.split('-');
        const period = `${parts[1]}-${String(parseInt(parts[0], 10)).padStart(2, '0')}`;
        targetByPeriod.set(period, (targetByPeriod.get(period) || 0) + targetAmount);
      }

      // Get provider external_ids + private plan IDs in parallel
      const [providerExtIds, privatePlanPpIds] = await Promise.all([
        fetchProviderExternalIds(organizationId, locationIdsForFilter),
        fetchPrivatePlanIds(organizationId, selectedLocationId),
      ]);
      if (privatePlanPpIds.size === 0) return [] as MonthlyActualTarget[];

      // Fetch actual for all 4 months in one pass
      const fullStartDate = monthBuckets[0].startDate;
      const fullEndDate = monthBuckets[monthBuckets.length - 1].endDate;
      // Widen the UTC lower bound a day so BST-boundary treatments aren't missed; the
      // London-date bucketing below drops any spill-over outside the month buckets.
      const fetchLowerBound = toDateStr(new Date(new Date(fullStartDate + 'T00:00:00Z').getTime() - 86400000));

      const allTpis: TpiRowWithBasis[] = await fetchTpisForWindow(
        organizationId, dateBasis, fullStartDate, fullEndDate, fetchLowerBound,
      );

      // Filter by provider location
      const locationFilteredTpis = providerExtIds
        ? allTpis.filter(t => t.tpi_practitioner_id != null && providerExtIds.has(String(t.tpi_practitioner_id)))
        : allTpis;

      // Filter by private payment plan IDs
      const monthlyPrivateTpis = locationFilteredTpis.filter(t => {
        const ppid = planIdKey(t.tpi_payment_plan_id);
        return ppid != null && privatePlanPpIds.has(ppid);
      });

      // Bucket by tpi_completed_at month
      const revenueByMonth = new Map<string, number>();
      for (const b of monthBuckets) revenueByMonth.set(b.period, 0);

      for (const tpi of monthlyPrivateTpis) {
        // Same delivered-appointment gate as the Overview revenue so the monthly actuals
        // reconcile with the Private Revenue tile and Dentally (exclude unlinked/charting rows).
        if ((asNumber(tpi.tpi_treatment_appointment_id) || 0) <= 0) continue;
        if (!tpi.basisDate) continue;
        const period = tpi.basisDate.substring(0, 7); // basis-day YYYY-MM
        if (!revenueByMonth.has(period)) continue; // spill-over from the widened fetch
        revenueByMonth.set(period, (revenueByMonth.get(period) || 0) + asNumber(tpi.tpi_price));
      }

      const results: MonthlyActualTarget[] = monthBuckets.map(b => ({
        month: b.label,
        actual: revenueByMonth.get(b.period) || 0,
        target: targetByPeriod.get(b.period) || 0,
      }));
      return results;
    },
    enabled: !!organizationId && !!locationFilter && locationFilter.ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Derived summary ───
  const summary: PrivateSummary = useMemo(() => {
    const totalRevenue = rawData?.totalRevenue ?? 0;
    const totalUnits = rawData?.totalUnits ?? 0;
    const avgValue = totalUnits > 0 ? totalRevenue / totalUnits : 0;
    const chairMinutes = rawData?.chairMinutes ?? 0;

    const prevRevenue = rawData?.prevRevenue ?? 0;
    const prevUnits = rawData?.prevUnits ?? 0;
    const prevAvgValue = prevUnits > 0 ? prevRevenue / prevUnits : 0;
    const prevChairMinutes = rawData?.prevChairMinutes ?? 0;

    const pct = (curr: number, prev: number) =>
      prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : 0;

    return {
      privateRevenue: totalRevenue,
      treatmentUnits: totalUnits,
      avgTreatmentValue: avgValue,
      chairTimeUtilized: chairMinutes,
      revenueTrend: pct(totalRevenue, prevRevenue),
      unitsTrend: pct(totalUnits, prevUnits),
      avgValueTrend: pct(avgValue, prevAvgValue),
      chairTimeTrend: pct(chairMinutes, prevChairMinutes),
      patientCount: rawData?.patientCount ?? 0,
    };
  }, [rawData]);

  const categories = rawData?.categories ?? [];
  // Split the loading states. The summary tiles, Revenue by Treatment Type and Ranking
  // all come from the MAIN query (dataLoading). The monthly actual-vs-target chart is a
  // SEPARATE, heavier query (perfLoading) used only on the Performance tab. Gating the
  // whole page on both meant a slow/failed monthly query blanked everything — including
  // sections whose data was already ready. `isLoading` now reflects only the main query.
  const isLoading = dataLoading;

  return {
    summary,
    categories,
    monthlyPerformance: monthlyPerf ?? [],
    isLoading,
    isPerformanceLoading: perfLoading,
  };
}
