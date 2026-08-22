import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLocations } from '@/hooks/useLocations';
import { useOrganization } from '@/hooks/useOrganization';
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

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Formats a stored (UTC) timestamp as its calendar date in UK local time
// (Europe/London, DST-aware). Dentally's Practitioner Activity report dates
// each treatment by its UK-local "Completed On" date. We store completed_at in
// UTC, so a treatment completed at 00:00 BST is held as ~23:00 the previous
// calendar day — comparing on the raw UTC date pushes it into the wrong month.
// Always compare on the Europe/London date so the period boundary matches the
// Dentally report exactly.
const LONDON_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});
function toLondonDateStr(ts: string | null | undefined): string {
  if (!ts) return '';
  // Parse as an instant; treat a timezone-less value as UTC (that is how the
  // column is stored) rather than letting the browser assume local time.
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts);
  const d = new Date(hasTz ? ts : ts.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(ts).substring(0, 10);
  return LONDON_YMD.format(d); // en-CA → "YYYY-MM-DD"
}

export interface InsightsSummary {
  totalRevenue: number;
  nhsRevenue: number;
  uniquePatients: number;
  totalHours: number;
  treatmentVolume: number;
  totalRevenueTrend: number;
  nhsRevenueTrend: number;
  uniquePatientsTrend: number;
  totalHoursTrend: number;
  treatmentVolumeTrend: number;
}

export interface RevenueByCategory { category: string; revenue: number; }
export interface TreatmentMixItem { name: string; value: number; color: string; }
export interface MonthlyRevenuePoint { month: string; monthKey: string; total: number; nhs: number; private: number; }
export interface TopTreatment { rank: number; name: string; revenue: number; margin: number; volume: number; trend: number; }
export interface InsightAlert { type: 'warning' | 'positive' | 'info'; title: string; message: string; actionLabel?: string; }

interface TreatmentRevenueRow {
  treatmentId: string; treatmentName: string; categoryName: string;
  treatmentType: string | null; revenue: number; volume: number;
}

export interface QualifiedItem {
  price: number; patientId: number | null; duration: number;
  treatmentId: string; treatmentName: string; categoryName: string;
  treatmentType: string | null; completedAt: string;
  /** The calendar day (YYYY-MM-DD) this item is reported under: the Europe/
   *  London completed date ("Completed on" basis) or the invoice's paid date
   *  ("Paid on" basis). All period splits/bucketing use this field. */
  basisDate: string;
  treatmentAppointmentId: number;
  paymentPlanId: number | null;
  planName: string;
  isNhs: boolean;
  isPrivate: boolean;
}

/** Dentally-export-mirror totals for the "Paid on" basis — no practitioner /
 *  plan / price filters, location via TPI location_id (NULL kept), so the four
 *  Overview tiles reproduce Dentally's Practitioner Activity export with its
 *  Date filter set to "Paid on". */
interface PaidTiles {
  revenue: number; prevRevenue: number;
  durationMin: number; prevDurationMin: number;
  volume: number; prevVolume: number;
  patients: number; prevPatients: number;
}

const PAGE_SIZE = 1000;

/** Paginated fetch helper using offset. For small/medium tables.
 *  THROWS on a page error: silently returning the partial result lets React
 *  Query cache it as fresh-and-successful, so the page keeps rendering
 *  empty/partial data on every soft navigation until a hard refresh clears
 *  the cache. Failing the query makes RQ retry and refetch on next mount. */
async function fetchAll<T>(buildQuery: () => any, pageSize = PAGE_SIZE): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) { console.error('[fetchAll] error:', error); throw error; }
    const rows = (data ?? []) as T[];
    all.push(...rows);
    hasMore = rows.length === pageSize;
    offset += pageSize;
  }
  return all;
}

/**
 * Cursor-based paginated fetch for large tables (e.g. treatment_plan_items).
 * Uses keyset pagination (WHERE cursor_col > last_value) instead of OFFSET,
 * which avoids expensive sort+skip on large datasets.
 */
async function fetchAllCursor<T extends Record<string, any>>(
  buildQuery: (cursor: { col: string; value: string | number | null }) => any,
  cursorCol: string,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  let lastCursorValue: string | number | null = null;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await buildQuery({ col: cursorCol, value: lastCursorValue })
      .limit(pageSize);
    // Throw, don't break — see fetchAll above (partial results poison the cache).
    if (error) { console.error('[fetchAllCursor] error:', error); throw error; }
    const rows = (data ?? []) as T[];
    all.push(...rows);
    hasMore = rows.length === pageSize;
    if (rows.length > 0) {
      lastCursorValue = rows[rows.length - 1][cursorCol];
    }
  }
  return all;
}

export function useTreatmentInsights(
  /** Optional override window for the Monthly Revenue Trend chart only —
   *  driven by that card's datepicker. All other outputs stay on the page's
   *  global filter range. */
  trendRange?: { start: Date; end: Date } | null,
  /** Date basis for the whole page — mirrors the Date dropdown on Dentally's
   *  Practitioner Activity report. 'completed' (default) dates every item by
   *  its completion day; 'paid' dates it by its invoice's paid day. */
  dateBasis: TreatmentDateBasis = 'completed',
) {
  const { user } = useAuth();
  const { organizationId, isLoading: orgLoading } = useOrganization();
  const { allAvailableLocations, isLoading: locationsLoading } = useLocations();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();

  const allLocationIds = useMemo(() => allAvailableLocations.map(l => l.id), [allAvailableLocations]);
  const regionLocationIds = useMemo(() => {
    if (!selectedRegionId || selectedLocationId) return null;
    return allAvailableLocations.filter(l => l.region_id === selectedRegionId).map(l => l.id);
  }, [selectedRegionId, selectedLocationId, allAvailableLocations]);

  const locationFilter = useMemo(() => {
    if (selectedLocationId) return { type: 'single' as const, ids: [selectedLocationId] };
    if (regionLocationIds && regionLocationIds.length > 0) return { type: 'multi' as const, ids: regionLocationIds };
    if (allLocationIds.length > 0) return { type: 'multi' as const, ids: allLocationIds };
    return null;
  }, [selectedLocationId, regionLocationIds, allLocationIds]);

  const locationKey = locationFilter ? locationFilter.ids.slice().sort().join(',') : 'none';
  const startDateStr = toLocalDateStr(dateRange.startDate);
  const endDateStr = toLocalDateStr(dateRange.endDate);
  const periodMs = dateRange.endDate.getTime() - dateRange.startDate.getTime();
  const prevStartDate = new Date(dateRange.startDate.getTime() - periodMs);
  const prevStartDateStr = toLocalDateStr(prevStartDate);
  // Monthly Revenue Trend may have its own datepicker window. It is served by
  // a DEDICATED query below — the main pipeline's window and queryKey never
  // change with the picker, so the rest of the page does not reload.
  const hasTrendRange = !!trendRange;
  const trendStartDateStr = trendRange ? toLocalDateStr(trendRange.start) : startDateStr;
  const trendEndDateStr = trendRange ? toLocalDateStr(trendRange.end) : endDateStr;
  // Fetch a day earlier than the compare window: a treatment completed at 00:00
  // UK time is stored ~23:00 UTC on the previous calendar day (BST), so it would
  // sit just outside a UTC-bounded query. We widen the DB lower bound here and
  // make the precise period cut in JS on the Europe/London date.
  const fetchStartDateStr = toLocalDateStr(new Date(prevStartDate.getTime() - 24 * 60 * 60 * 1000));

  const locationIdsForQuery = useMemo(() => {
    if (selectedLocationId) return [selectedLocationId];
    if (regionLocationIds && regionLocationIds.length > 0) return regionLocationIds;
    return null;
  }, [selectedLocationId, regionLocationIds]);

  // ─── Main query: filters TPIs by treatment_plan_items.location_id ──────
  // The backend resolves each TPI's site via TPI→TA→Appointment chain
  // (see processor.js resolveTpiLocationsFromAppointments), so we can filter
  // directly on location_id — matches Dentally's Practitioner Activity report,
  // which attributes each TPI to the site where the treatment was performed.
  const { data: pipelineData, isLoading: qualifiedLoading, error: qualifiedError } = useQuery({
    queryKey: ['treatment_insights_v35', organizationId, prevStartDateStr, endDateStr, locationKey, dateBasis],
    queryFn: async () => {
      const empty = { items: [] as QualifiedItem[], paidTiles: null as PaidTiles | null };
      if (!organizationId) return empty;

      // ── Step 1: Parallel fetch — treatments metadata + completed TPIs ─

      const treatmentPromise = (async () => {
        const categoryMap = new Map<string, string>();
        const treatmentsByExtId = new Map<number, { id: string; name: string; categoryName: string; treatmentType: string | null; durationMinutes: number }>();
        const treatmentsById = new Map<string, { id: string; name: string; categoryName: string; treatmentType: string | null; durationMinutes: number }>();

        const [catRows, txRows] = await Promise.all([
          (supabase as any).from('treatment_categories')
            .select('id, name').eq('organization_id', organizationId).is('deleted_at', null)
            .then((r: any) => (r.data ?? []) as Array<{ id: string; name: string }>),
          fetchAll<any>(() =>
            (supabase as any).from('treatments')
              .select('id, external_id, category_id, treatment_name, treatment_type, duration_minutes')
              .eq('organization_id', organizationId).is('deleted_at', null).eq('is_active', true)
              .order('id')
          ),
        ]);

        for (const c of catRows) { if (c?.id && c?.name) categoryMap.set(c.id, c.name); }
        for (const t of txRows) {
          const catName = (t.category_id && categoryMap.get(t.category_id)) || 'Uncategorised';
          const entry = { id: t.id, name: t.treatment_name, categoryName: catName, treatmentType: t.treatment_type, durationMinutes: asNumber(t.duration_minutes) };
          treatmentsById.set(t.id, entry);
          if (t.external_id != null) {
            const extId = Number(t.external_id);
            if (!isNaN(extId)) treatmentsByExtId.set(extId, entry);
          }
        }
        return { treatmentsByExtId, treatmentsById };
      })();

      // Fetch completed TPIs by tpi_completed_at. Location attribution uses
      // BOTH the practitioner (providers.location_id) AND the patient
      // (patients.location_id) where available:
      //   - The practitioner-id list is the primary filter (always populated).
      //   - If a patient has a location_id set in our DB and it doesn't match
      //     the requested site, the TPI is excluded in JS (matches Dentally,
      //     which scopes the Location filter by patient registration).
      //   - Patients with NULL patients.location_id fall back to passing the
      //     practitioner check only (so we don't drop ~all rows when the
      //     patients table is sparsely populated).
      //
      // Filters mirror Dentally's Practitioner Activity rules:
      //   - tpi_completed = true
      //   - tpi_payment_plan_id IS NOT NULL
      //   - deleted_at IS NULL
      //
      // Uses cursor-based pagination on tpi_id to avoid OFFSET timeouts.

      // Step 1a: practitioner external_ids in scope. ACTIVE providers only —
      // aligned with Practitioner History (client request, 2026-07). Inactive /
      // system accounts (e.g. "Provider Sales") could otherwise put this page
      // £100 above the Practitioner History tile for the same period. Applied
      // to the all-locations path too, so the pages agree at org level, not
      // just when a location is selected.
      let practitionerIdsForQuery: number[] | null = null;
      {
        let provQ = (supabase as any)
          .from('providers')
          .select('external_id, location_id')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .not('external_id', 'is', null)
          .is('deleted_at', null);
        if (locationIdsForQuery && locationIdsForQuery.length > 0) {
          provQ = provQ.in('location_id', locationIdsForQuery);
        }
        const { data: provRows } = await provQ;
        const ids = new Set<number>();
        for (const p of (provRows ?? []) as Array<{ external_id: number | string | null }>) {
          if (p.external_id == null) continue;
          const n = typeof p.external_id === 'number' ? p.external_id : Number(p.external_id);
          if (Number.isFinite(n)) ids.add(n);
        }
        practitionerIdsForQuery = Array.from(ids);
        // Completed basis fetches BY practitioner, so no practitioners means
        // nothing to fetch. Paid basis fetches by invoice and also feeds the
        // practitioner-unfiltered tile mirror — keep going with an empty set
        // (the chart pipeline just yields no items).
        if (practitionerIdsForQuery.length === 0 && dateBasis === 'completed') {
          return empty;
        }
      }
      const practitionerIdSet = new Set(practitionerIdsForQuery ?? []);

      // Step 1b: patient legacy_ids whose registered location does NOT match
      // the filter. We use this as a JS-side EXCLUSION list later — only drops
      // rows whose patient is unambiguously at a different site. Patients with
      // NULL location_id are kept (we can't tell where they're registered).
      const excludedPatientIds = new Set<number>();
      if (locationIdsForQuery && locationIdsForQuery.length > 0) {
        const PAT_PAGE = 1000;
        let cursorVal: string | null = null;
        const allowed = new Set(locationIdsForQuery);
        while (true) {
          let pq = (supabase as any)
            .from('patients')
            .select('id, legacy_id, location_id')
            .eq('organization_id', organizationId)
            .not('legacy_id', 'is', null)
            .not('location_id', 'is', null)
            .order('id')
            .limit(PAT_PAGE);
          if (cursorVal != null) pq = pq.gt('id', cursorVal);
          const { data: page } = await pq;
          if (!page || page.length === 0) break;
          for (const p of page as Array<{ id: string; legacy_id: number | string | null; location_id: string | null }>) {
            if (!p.location_id || allowed.has(p.location_id)) continue;
            if (p.legacy_id == null) continue;
            const n = typeof p.legacy_id === 'number' ? p.legacy_id : Number(p.legacy_id);
            if (Number.isFinite(n)) excludedPatientIds.add(n);
          }
          if (page.length < PAT_PAGE) break;
          cursorVal = (page[page.length - 1] as any).id;
        }
      }

      const tpiPromise = (async () => {
        if (dateBasis === 'paid') {
          // "Paid on" basis: window on the INVOICE paid date, not completion.
          // Fetch the Dentally invoices paid in [prevStart .. end] first
          // (paid_date is a plain DATE — no timezone widening needed), then
          // pull the completed TPIs belonging to those invoices. A treatment
          // completed months earlier still lands here when its invoice was
          // paid in the window — exactly Dentally's "Paid on" report. No
          // practitioner / payment-plan SQL filters: this one row set also
          // feeds the export-mirror tiles, which (like Dentally's export)
          // include inactive practitioners and plan-less rows; the chart
          // pipeline re-applies those filters in JS below.
          const paidLookup = await fetchPaidInvoiceLookup(organizationId, prevStartDateStr, endDateStr);
          if (paidLookup.ids.length === 0) return { rows: [] as any[], paidLookup };
          const rows = await fetchTpisForInvoiceIds<any>(paidLookup.ids, (chunkIds) =>
            (supabase as any)
              .from('treatment_plan_items')
              .select('id, tpi_id, tpi_price, tpi_patient_id, tpi_treatment_id, tpi_completed_at, tpi_practitioner_id, tpi_treatment_appointment_id, tpi_patient_nomenclature, duration, tpi_payment_plan_id, location_id, tpi_invoice_id, integration_id')
              .eq('organization_id', organizationId)
              .eq('tpi_completed', true)
              .not('tpi_completed_at', 'is', null)
              .not('tpi_treatment_appointment_id', 'is', null)
              .is('deleted_at', null)
              .in('tpi_invoice_id', chunkIds)
              .order('tpi_id'),
          );
          return { rows, paidLookup };
        }
        const rows = await fetchAllCursor<any>(
          (cursor) => {
            let q = (supabase as any)
              .from('treatment_plan_items')
              .select('id, tpi_id, tpi_price, tpi_patient_id, tpi_treatment_id, tpi_completed_at, tpi_practitioner_id, tpi_treatment_appointment_id, tpi_patient_nomenclature, duration, tpi_payment_plan_id, location_id')
              .eq('organization_id', organizationId)
              .eq('tpi_completed', true)
              .not('tpi_completed_at', 'is', null)
              .not('tpi_payment_plan_id', 'is', null)
              // Charting / tooth-status rows (no treatment_appointment link) are
              // excluded by EVERY consumer of this data via the taId > 0 gate —
              // dropping them at SQL level halves the download (they can be
              // ~2/3 of completed TPIs) without changing any figure.
              .not('tpi_treatment_appointment_id', 'is', null)
              .is('deleted_at', null)
              .gte('tpi_completed_at', fetchStartDateStr)
              .lte('tpi_completed_at', endDateStr + 'T23:59:59')
              .order('tpi_id');
            if (practitionerIdsForQuery && practitionerIdsForQuery.length > 0) {
              q = q.in('tpi_practitioner_id', practitionerIdsForQuery);
            }
            if (cursor.value != null) {
              q = q.gt('tpi_id', cursor.value);
            }
            return q;
          },
          'tpi_id',
        );
        return { rows, paidLookup: null as Awaited<ReturnType<typeof fetchPaidInvoiceLookup>> | null };
      })();

      // Fetch payment plans to map plan IDs to names
      const planPromise = (async () => {
        const m = new Map<number, { name: string; isNhs: boolean }>();
        const { data } = await (supabase as any)
          .from('payment_plans')
          .select('pp_id, pp_name')
          .eq('organization_id', organizationId)
          .is('deleted_at', null);
        for (const row of (data ?? []) as Array<{ pp_id: number | null; pp_name: string | null }>) {
          if (row.pp_id != null) {
            const key = Number(row.pp_id);
            if (Number.isFinite(key)) {
              m.set(key, { name: row.pp_name || 'Unknown Plan', isNhs: false });
            }
          }
        }
        return m;
      })();

      const privatePlanPromise = (async () => {
        const mapped = await fetchSetupCategoryPaymentPlanIds(
          organizationId,
          selectedLocationId,
          ['private'],
        );
        return new Set(mapped.private);
      })();

      const [treatmentData, tpiResult, planMap, privatePlanIds] = await Promise.all([
        treatmentPromise, tpiPromise, planPromise, privatePlanPromise,
      ]);
      const { treatmentsByExtId, treatmentsById } = treatmentData;
      const { rows: tpiRows, paidLookup } = tpiResult;

      // Paid-basis export-mirror tile accumulators. Zeroed (not null) even when
      // no rows matched, so the tiles show a genuine 0 instead of falling back
      // to completed-basis figures.
      const paidTiles: PaidTiles | null = dateBasis === 'paid'
        ? { revenue: 0, prevRevenue: 0, durationMin: 0, prevDurationMin: 0, volume: 0, prevVolume: 0, patients: 0, prevPatients: 0 }
        : null;
      const currPaidPatients = new Set<number>();
      const prevPaidPatients = new Set<number>();
      const allowedLocs = new Set(locationIdsForQuery ?? allLocationIds);

      if (tpiRows.length === 0) return { items: [] as QualifiedItem[], paidTiles };

      // ── Step 2: Build qualified items from TPIs ────────────
      // We keep ALL completed TPIs in candidateItems and let the per-tile
      // computations below filter them with the appointment-id gate. This
      // matches Dentally's Practitioner Activity, where the only thing that
      // distinguishes a "real procedure" from a charting / tooth-status record
      // is whether it's tied to a treatment_appointment. The nomenclature
      // string ("Filled", "Crowned", etc.) overlaps with real treatment names
      // and isn't a reliable filter on its own.
      const candidateItems: QualifiedItem[] = [];
      const seenRowIds = new Set<string>();

      // Debug: collect everything included in the CURRENT period for the
      // requested location so it can be diff-checked against Dentally's export.
      // Toggle with localStorage.setItem('insights:debug', '1').
      const debugEnabled = typeof window !== 'undefined' && window.localStorage?.getItem('insights:debug') === '1';
      const debugRows: Array<Record<string, unknown>> = [];

      for (const r of tpiRows) {
        if (seenRowIds.has(r.id)) continue;
        seenRowIds.add(r.id);

        const patId = r.tpi_patient_id != null ? Number(r.tpi_patient_id) : null;
        const price = asNumber(r.tpi_price);
        const completedAt = r.tpi_completed_at ?? '';
        const taId = asNumber(r.tpi_treatment_appointment_id);

        // The reporting day for this item under the selected basis.
        const basisDate = dateBasis === 'paid'
          ? (paidLookup?.get(r.tpi_invoice_id, r.integration_id) ?? '')
          : toLondonDateStr(completedAt);
        if (!basisDate) continue;

        // Paid-basis tile mirror — accumulated BEFORE the pipeline-only
        // filters below (practitioner / plan / patient-registration), because
        // Dentally's export applies none of them. Location via the TPI's own
        // location_id, NULL kept — same rule as the completed-basis
        // activity-counts query.
        if (paidTiles) {
          const locOk = allowedLocs.size === 0 || !r.location_id || allowedLocs.has(r.location_id);
          if (locOk) {
            if (basisDate >= startDateStr && basisDate <= endDateStr) {
              paidTiles.revenue += price;
              paidTiles.durationMin += asNumber(r.duration);
              paidTiles.volume += 1;
              if (patId != null) currPaidPatients.add(patId);
            } else if (basisDate >= prevStartDateStr && basisDate < startDateStr) {
              paidTiles.prevRevenue += price;
              paidTiles.prevDurationMin += asNumber(r.duration);
              paidTiles.prevVolume += 1;
              if (patId != null) prevPaidPatients.add(patId);
            }
          }
        }

        // Chart-pipeline filters. Completed basis applies the plan +
        // practitioner conditions at SQL level; the paid-basis fetch is by
        // invoice id, so re-apply them here to keep the pipelines identical.
        if (dateBasis === 'paid') {
          if (r.tpi_payment_plan_id == null) continue;
          const praId = r.tpi_practitioner_id != null ? Number(r.tpi_practitioner_id) : null;
          if (praId == null || !practitionerIdSet.has(praId)) continue;
        }
        // Drop rows whose patient is registered at a DIFFERENT location (the
        // exclusion set only contains patients with a known, non-matching
        // location; patients with NULL location stay in).
        if (patId != null && excludedPatientIds.has(patId)) continue;

        if (debugEnabled
            && basisDate >= startDateStr
            && basisDate <= endDateStr
            && taId > 0) {
          debugRows.push({
            tpi_id: r.tpi_id,
            completed_at: completedAt,
            practitioner_id: r.tpi_practitioner_id,
            patient_id: patId,
            treatment_id: r.tpi_treatment_id,
            nomenclature: r.tpi_patient_nomenclature,
            price,
            ta_id: taId,
            location_id: r.location_id,
            payment_plan_id: r.tpi_payment_plan_id,
          });
        }

        // Resolve treatment metadata
        let tx: { id: string; name: string; categoryName: string; treatmentType: string | null; durationMinutes: number } | undefined;
        const rawId = r.tpi_treatment_id;
        if (rawId != null) {
          const extId = Number(rawId);
          if (!isNaN(extId)) tx = treatmentsByExtId.get(extId);
          if (!tx && typeof rawId === 'string') tx = treatmentsById.get(rawId);
        }

        // Hours mirror Dentally's Practitioner Activity report "Duration" column
        // (= treatment_plan_items.duration). The treatment-setup template
        // duration is only used when the TPI has no stamped Dentally duration
        // — this keeps the tile matching Dentally's official totals while
        // still rendering something for any unsynced rows.
        const tpiDur = asNumber(r.duration);
        const dur = tpiDur > 0 ? tpiDur : (tx ? tx.durationMinutes : 0);

        const ppId = r.tpi_payment_plan_id != null ? Number(r.tpi_payment_plan_id) : null;
        const planInfo = ppId != null ? planMap.get(ppId) : null;

        candidateItems.push({
          price,
          patientId: patId,
          duration: dur,
          treatmentId: tx?.id ?? '',
          treatmentName: tx?.name ?? 'Unknown Treatment',
          categoryName: tx?.categoryName ?? 'Uncategorised',
          treatmentType: tx?.treatmentType ?? null,
          completedAt,
          basisDate,
          treatmentAppointmentId: taId,
          paymentPlanId: ppId,
          planName: planInfo?.name ?? (ppId != null ? 'Unknown Plan' : 'No Plan'),
          isNhs: planInfo?.isNhs ?? false,
          isPrivate: ppId != null && privatePlanIds.has(ppId),
        });
      }

      if (paidTiles) {
        paidTiles.patients = currPaidPatients.size;
        paidTiles.prevPatients = prevPaidPatients.size;
      }

      if (debugEnabled) {
        const total = debugRows.reduce((s, r) => s + (Number(r.price) || 0), 0);
        const uniquePatients = new Set(debugRows.map((r) => r.patient_id).filter(Boolean));
        // eslint-disable-next-line no-console
        console.log('[Insights debug] period', startDateStr, '→', endDateStr, '| location filter:', locationIdsForQuery, '| practitioners:', practitionerIdsForQuery?.length ?? null, '| excluded-patients:', excludedPatientIds.size);
        // eslint-disable-next-line no-console
        console.log(`[Insights debug] ${debugRows.length} rows, ${uniquePatients.size} patients, total £${total.toFixed(2)}`);
        // eslint-disable-next-line no-console
        console.table(debugRows);
      }

      return { items: candidateItems, paidTiles };
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
  const qualifiedItems = pipelineData?.items;
  const paidTiles = pipelineData?.paidTiles ?? null;

  // ── Dentally Practitioner Activity counts (Patients / Treatment Volume) ──
  // Mirrors Dentally's export row set EXACTLY (verified 2026-08-04, Old
  // Surgery "Hungerford", 01 Apr 2025 – 31 Mar 2026: 33,601 rows / 6,676
  // patients / £1,687,868.68 / 2,784.1 hrs — all four reproduced):
  //   completed TPIs · deleted_at IS NULL · tpi_treatment_appointment_id
  //   NOT NULL (charting gate) · scoped by treatment_plan_items.location_id
  //   (NULL location kept, like the net-production RPC) · London-date window.
  //   NO practitioner, payment-plan, or price filters — Dentally's
  //   "Any Practitioners / Any Plan" export includes £0 rows and rows from
  //   practitioners that are inactive in our providers table, which is why
  //   the main pipeline above (active-provider + plan-linked) undercounts.
  // Completed basis only — on the "Paid on" basis these two tiles come from
  // the paid tile mirror computed inside the main pipeline instead.
  const { data: activityCounts, isLoading: activityCountsLoading } = useQuery({
    queryKey: ['treatment_insights_activity_counts_v1', organizationId, prevStartDateStr, endDateStr, locationKey],
    queryFn: async () => {
      if (!organizationId) return null;
      const locationIds = locationIdsForQuery ?? allLocationIds;
      if (!locationIds || locationIds.length === 0) return null;

      // Fast path: ONE aggregated RPC (migration 20260805000001) counts both
      // windows server-side instead of downloading ~60k rows to count in the
      // browser. Falls back to the row scan until the function is deployed.
      {
        const { data, error } = await (supabase as any).rpc('get_treatment_activity_counts', {
          p_organization_id: organizationId,
          p_start: startDateStr,
          p_end: endDateStr,
          p_prev_start: prevStartDateStr,
          p_location_ids: locationIds,
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          const r = data[0];
          return {
            volume: Number(r.curr_volume) || 0,
            patients: Number(r.curr_patients) || 0,
            prevVolume: Number(r.prev_volume) || 0,
            prevPatients: Number(r.prev_patients) || 0,
          };
        }
        if (error) {
          const missingFunction =
            error.code === 'PGRST202' ||
            error.code === '42883' ||
            /could not find the function|does not exist/i.test(String(error.message ?? ''));
          if (!missingFunction) throw error;
          // Not deployed yet — use the row-scan fallback below.
        }
      }

      const rows = await fetchAllCursor<any>(
        (cursor) => {
          let q = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id, tpi_patient_id, tpi_completed_at')
            .eq('organization_id', organizationId)
            .eq('tpi_completed', true)
            .not('tpi_completed_at', 'is', null)
            .not('tpi_treatment_appointment_id', 'is', null)
            .is('deleted_at', null)
            .or(`location_id.in.(${locationIds.join(',')}),location_id.is.null`)
            .gte('tpi_completed_at', fetchStartDateStr)
            .lte('tpi_completed_at', endDateStr + 'T23:59:59')
            .order('tpi_id');
          if (cursor.value != null) q = q.gt('tpi_id', cursor.value);
          return q;
        },
        'tpi_id',
      );
      let currVolume = 0, prevVolume = 0;
      const currPatients = new Set<number>();
      const prevPatients = new Set<number>();
      for (const r of rows) {
        const d = toLondonDateStr(r.tpi_completed_at);
        if (!d) continue;
        const patId = r.tpi_patient_id != null ? Number(r.tpi_patient_id) : null;
        if (d >= startDateStr && d <= endDateStr) {
          currVolume++;
          if (patId != null) currPatients.add(patId);
        } else if (d >= prevStartDateStr && d < startDateStr) {
          prevVolume++;
          if (patId != null) prevPatients.add(patId);
        }
      }
      return {
        volume: currVolume,
        patients: currPatients.size,
        prevVolume,
        prevPatients: prevPatients.size,
      };
    },
    enabled: !!organizationId && dateBasis === 'completed',
    staleTime: 5 * 60 * 1000,
  });

  // ── Monthly Revenue Trend datepicker override ────────────────────────────
  // Dedicated fetch so the card's datepicker ONLY affects that chart: same
  // pipeline filters (active practitioners, plan-linked, appointment-linked,
  // London-date cut) over the picked window. Runs only while a range is set.
  const trendFetchStartDateStr = trendRange
    ? toLocalDateStr(new Date(trendRange.start.getTime() - 24 * 60 * 60 * 1000))
    : null;
  const { data: trendOverride, isLoading: trendOverrideLoading } = useQuery({
    queryKey: ['treatment_insights_trend_override_v3', organizationId, trendStartDateStr, trendEndDateStr, locationKey, dateBasis],
    enabled: !!organizationId && hasTrendRange,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!organizationId || !trendFetchStartDateStr) return null;

      // Active practitioners in scope — mirrors the main pipeline's Step 1a.
      let provQ = (supabase as any)
        .from('providers')
        .select('external_id')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .not('external_id', 'is', null)
        .is('deleted_at', null);
      if (locationIdsForQuery && locationIdsForQuery.length > 0) {
        provQ = provQ.in('location_id', locationIdsForQuery);
      }
      const { data: provRows } = await provQ;
      const practitionerIds = [...new Set(
        ((provRows ?? []) as Array<{ external_id: number | string | null }>)
          .map((p) => Number(p.external_id))
          .filter((n) => Number.isFinite(n)),
      )];
      if (practitionerIds.length === 0) return { rows: [], privatePlanIds: [] as number[] };

      const mappedPlans = await fetchSetupCategoryPaymentPlanIds(
        organizationId,
        selectedLocationId,
        ['private'],
      );
      const privatePlanIds = new Set(mappedPlans.private);

      // "Paid on" basis: window on invoice paid date over the picked range,
      // then re-apply the pipeline's practitioner/plan filters in JS — same
      // approach as the main pipeline above.
      if (dateBasis === 'paid') {
        const practitionerIdSet = new Set(practitionerIds);
        const paidLookup = await fetchPaidInvoiceLookup(organizationId, trendStartDateStr, trendEndDateStr);
        if (paidLookup.ids.length === 0) return { rows: [], privatePlanIds: [...privatePlanIds] };
        const paidRows = await fetchTpisForInvoiceIds<any>(paidLookup.ids, (chunkIds) =>
          (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id, tpi_price, tpi_completed_at, tpi_payment_plan_id, tpi_practitioner_id, tpi_invoice_id, integration_id')
            .eq('organization_id', organizationId)
            .eq('tpi_completed', true)
            .not('tpi_completed_at', 'is', null)
            .not('tpi_payment_plan_id', 'is', null)
            .not('tpi_treatment_appointment_id', 'is', null)
            .is('deleted_at', null)
            .in('tpi_invoice_id', chunkIds)
            .order('tpi_id'),
        );
        const rows: Array<{ price: number; basisDate: string; ppId: number | null }> = [];
        for (const r of paidRows) {
          const praId = r.tpi_practitioner_id != null ? Number(r.tpi_practitioner_id) : null;
          if (praId == null || !practitionerIdSet.has(praId)) continue;
          const basisDate = paidLookup.get(r.tpi_invoice_id, r.integration_id);
          if (!basisDate) continue;
          rows.push({
            price: asNumber(r.tpi_price),
            basisDate,
            ppId: r.tpi_payment_plan_id != null ? Number(r.tpi_payment_plan_id) : null,
          });
        }
        return { rows, privatePlanIds: [...privatePlanIds] };
      }

      const rows = await fetchAllCursor<any>(
        (cursor) => {
          let q = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id, tpi_price, tpi_completed_at, tpi_payment_plan_id')
            .eq('organization_id', organizationId)
            .eq('tpi_completed', true)
            .not('tpi_completed_at', 'is', null)
            .not('tpi_payment_plan_id', 'is', null)
            .not('tpi_treatment_appointment_id', 'is', null)
            .is('deleted_at', null)
            .gte('tpi_completed_at', trendFetchStartDateStr)
            .lte('tpi_completed_at', trendEndDateStr + 'T23:59:59')
            .in('tpi_practitioner_id', practitionerIds)
            .order('tpi_id');
          if (cursor.value != null) q = q.gt('tpi_id', cursor.value);
          return q;
        },
        'tpi_id',
      );
      return {
        rows: rows.map((r: any) => ({
          price: asNumber(r.tpi_price),
          basisDate: toLondonDateStr(r.tpi_completed_at),
          ppId: r.tpi_payment_plan_id != null ? Number(r.tpi_payment_plan_id) : null,
        })),
        privatePlanIds: [...privatePlanIds],
      };
    },
  });

  // Split into current and previous period based on the item's basis day
  // (Europe/London completed date, or invoice paid date on the paid basis).
  const { currentItems, prevItems } = useMemo(() => {
    const all = qualifiedItems ?? [];
    const curr: QualifiedItem[] = [];
    const prev: QualifiedItem[] = [];
    for (const item of all) {
      // Cut the period on the basis day: for the completed basis this is the
      // Europe/London date, so treatments completed at 00:00 UK time land in
      // the correct month (matches Dentally).
      const d = item.basisDate;
      if (!d) continue;
      if (d < startDateStr) {
        // Previous period is [prevStartDateStr, startDateStr); ignore the extra
        // day the widened fetch pulled in below prevStartDateStr.
        if (d >= prevStartDateStr) prev.push(item);
      } else if (d <= endDateStr) {
        curr.push(item);
      }
      // else: d > endDateStr — a next-period boundary row pulled in by the
      // widened fetch; drop it from both windows.
    }
    return { currentItems: curr, prevItems: prev };
  }, [qualifiedItems, startDateStr, endDateStr, prevStartDateStr]);

  // Monthly revenue trend — group by completedAt month.
  // Includes negative prices (refunds) so monthly totals match Dentally.
  // With a datepicker range set, buckets the dedicated override fetch;
  // otherwise buckets the main pipeline over the page's global range.
  const monthlyTrend = useMemo(() => {
    const m = new Map<string, { label: string; total: number; nhs: number; private: number }>();
    const spansYears = trendStartDateStr.substring(0, 4) !== trendEndDateStr.substring(0, 4);
    const add = (londonDay: string, price: number, isNhs: boolean, isPrivate: boolean) => {
      const key = londonDay.substring(0, 7);
      if (!m.has(key)) {
        const date = new Date(londonDay + 'T00:00:00');
        const label = spansYears
          ? date.toLocaleString('default', { month: 'short', year: '2-digit' })
          : date.toLocaleString('default', { month: 'short' });
        m.set(key, { label, total: 0, nhs: 0, private: 0 });
      }
      const b = m.get(key)!;
      b.total += price;
      if (isNhs) b.nhs += price;
      if (isPrivate) b.private += price;
    };
    if (hasTrendRange) {
      if (!trendOverride) return [];
      const privateIds = new Set(trendOverride.privatePlanIds);
      for (const r of trendOverride.rows) {
        if (r.price === 0) continue;
        const day = r.basisDate;
        if (!day || day < trendStartDateStr || day > trendEndDateStr) continue;
        add(day, r.price, false, r.ppId != null && privateIds.has(r.ppId));
      }
    } else {
      for (const item of qualifiedItems ?? []) {
        if (item.treatmentAppointmentId <= 0) continue; // exclude charting / tooth-status rows
        if (item.price === 0) continue;
        const day = item.basisDate;
        if (!day || day < trendStartDateStr || day > trendEndDateStr) continue;
        add(day, item.price, item.isNhs, item.isPrivate);
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, d]) => ({ month: d.label, monthKey: key, total: d.total, nhs: d.nhs, private: d.private }));
  }, [qualifiedItems, hasTrendRange, trendOverride, trendStartDateStr, trendEndDateStr]);

  // Treatment-level aggregation
  const treatments: TreatmentRevenueRow[] = useMemo(() => {
    const agg = new Map<string, TreatmentRevenueRow>();
    for (const item of currentItems) {
      if (item.treatmentAppointmentId <= 0) continue;
      // Count £0-price treatments (e.g. free Exams) in Volume — a delivered
      // procedure is still a unit of activity even when it carries no charge.
      // Revenue is unaffected (£0 adds £0). Negative-price rows (refunds /
      // credits) are still excluded from this revenue leaderboard.
      if (item.price < 0) continue;
      const key = item.treatmentId || item.treatmentName;
      const ex = agg.get(key);
      if (ex) { ex.revenue += item.price; ex.volume += 1; }
      else agg.set(key, { treatmentId: item.treatmentId, treatmentName: item.treatmentName, categoryName: item.categoryName, treatmentType: item.treatmentType, revenue: item.price, volume: 1 });
    }
    return Array.from(agg.values()).sort((a, b) => b.revenue - a.revenue);
  }, [currentItems]);

  const prevTreatmentRevenue = useMemo(() => {
    const agg = new Map<string, number>();
    for (const item of prevItems) {
      if (item.treatmentAppointmentId <= 0) continue;
      if (item.price <= 0) continue;
      const k = item.treatmentId || item.treatmentName;
      agg.set(k, (agg.get(k) || 0) + item.price);
    }
    return agg;
  }, [prevItems]);

  // Summary — every metric (revenue AND counts) is gated to appointment-linked
  // TPIs (treatmentAppointmentId > 0). That gate is the reliable discriminator
  // for Dentally's Practitioner Activity report: charting / tooth-status records
  // ("missing tooth", "unerupted", "watch tooth", …) are NOT tied to a
  // treatment_appointment and carry spurious prices in our data, so Dentally
  // excludes them and so do we. Nomenclature is not a safe filter — real priced
  // procedures share those strings. Negative prices (refunds / credits) are kept
  // so totals still reconcile. Location / tenant scoping is applied upstream
  // (fetch query + patient exclusion) and is unaffected by this split.
  const summary: InsightsSummary = useMemo(() => {
    let totalRevenue = 0, nhsRevenue = 0, totalDurationMin = 0;
    let totalVolume = 0;
    const patientSet = new Set<number>();
    for (const item of currentItems) {
      if (item.treatmentAppointmentId <= 0) continue;   // exclude charting / tooth-status rows
      totalRevenue += item.price;
      if (item.isNhs) nhsRevenue += item.price;
      totalDurationMin += item.duration;
      totalVolume += 1;
      if (item.patientId != null) patientSet.add(item.patientId);
    }
    const totalHours = Math.round((totalDurationMin / 60) * 10) / 10;

    let prevRevenue = 0, prevNhsRevenue = 0, prevVolume = 0, prevDurationMin = 0;
    const prevPatientSet = new Set<number>();
    for (const item of prevItems) {
      if (item.treatmentAppointmentId <= 0) continue;   // exclude charting / tooth-status rows
      prevRevenue += item.price;
      if (item.isNhs) prevNhsRevenue += item.price;
      prevDurationMin += item.duration;
      prevVolume += 1;
      if (item.patientId != null) prevPatientSet.add(item.patientId);
    }
    const prevHours = Math.round((prevDurationMin / 60) * 10) / 10;
    const pct = (c: number, p: number) => p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : 0;

    return {
      totalRevenue, nhsRevenue,
      uniquePatients: patientSet.size, totalHours, treatmentVolume: totalVolume,
      totalRevenueTrend: pct(totalRevenue, prevRevenue), nhsRevenueTrend: pct(nhsRevenue, prevNhsRevenue),
      uniquePatientsTrend: pct(patientSet.size, prevPatientSet.size),
      totalHoursTrend: pct(totalHours, prevHours), treatmentVolumeTrend: pct(totalVolume, prevVolume),
    };
  }, [currentItems, prevItems]);

  // Completed basis: Patients + Treatment Volume come from the Dentally-
  // export-matched counts query above; the remaining summary fields stay on
  // the TPI pipeline. Paid basis: ALL FOUR tile figures (revenue, hours,
  // patients, volume) come from the paid tile mirror — the practitioner/plan-
  // unfiltered row set that reproduces Dentally's "Paid on" export, whose
  // Price / Duration / row / patient totals are the report's footer numbers.
  const summaryWithActivityCounts: InsightsSummary = useMemo(() => {
    const pct = (c: number, p: number) => p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : 0;
    if (dateBasis === 'paid') {
      if (!paidTiles) return summary;
      const hours = Math.round((paidTiles.durationMin / 60) * 10) / 10;
      const prevHours = Math.round((paidTiles.prevDurationMin / 60) * 10) / 10;
      return {
        ...summary,
        totalRevenue: paidTiles.revenue,
        totalRevenueTrend: pct(paidTiles.revenue, paidTiles.prevRevenue),
        totalHours: hours,
        totalHoursTrend: pct(hours, prevHours),
        uniquePatients: paidTiles.patients,
        treatmentVolume: paidTiles.volume,
        uniquePatientsTrend: pct(paidTiles.patients, paidTiles.prevPatients),
        treatmentVolumeTrend: pct(paidTiles.volume, paidTiles.prevVolume),
      };
    }
    if (!activityCounts) return summary;
    return {
      ...summary,
      uniquePatients: activityCounts.patients,
      treatmentVolume: activityCounts.volume,
      uniquePatientsTrend: pct(activityCounts.patients, activityCounts.prevPatients),
      treatmentVolumeTrend: pct(activityCounts.volume, activityCounts.prevVolume),
    };
  }, [summary, activityCounts, paidTiles, dateBasis]);

  const revenueByCategory: RevenueByCategory[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of currentItems) {
      if (item.treatmentAppointmentId <= 0) continue; // exclude charting / tooth-status rows
      if (item.price <= 0) continue;
      const c = item.categoryName || 'Uncategorised';
      m.set(c, (m.get(c) || 0) + item.price);
    }
    return Array.from(m.entries()).map(([category, revenue]) => ({ category, revenue })).sort((a, b) => b.revenue - a.revenue);
  }, [currentItems]);

  const treatmentMix: TreatmentMixItem[] = useMemo(() => {
    const PLAN_COLORS = [
      '#14b8a6', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6',
      '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#0ea5e9',
      '#d946ef', '#10b981', '#e11d48', '#a855f7', '#64748b',
    ];
    const planRevenue = new Map<string, number>();
    for (const item of currentItems) {
      if (item.treatmentAppointmentId <= 0) continue; // exclude charting / tooth-status rows
      if (item.price <= 0) continue;
      const planName = item.planName || 'No Plan';
      planRevenue.set(planName, (planRevenue.get(planName) || 0) + item.price);
    }
    return Array.from(planRevenue.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({ name, value, color: PLAN_COLORS[i % PLAN_COLORS.length] }));
  }, [currentItems]);

  const topTreatments: TopTreatment[] = useMemo(() => {
    return treatments.slice(0, 10).map((t, i) => {
      const key = t.treatmentId || t.treatmentName;
      const prevRev = prevTreatmentRevenue.get(key) ?? 0;
      const trend = prevRev > 0
        ? Math.round(((t.revenue - prevRev) / prevRev) * 1000) / 10
        : t.revenue > 0 ? 100 : 0;
      return { rank: i + 1, name: t.treatmentName, revenue: t.revenue, margin: t.volume > 0 ? t.revenue / t.volume : 0, volume: t.volume, trend };
    });
  }, [treatments, prevTreatmentRevenue]);

  const alerts: InsightAlert[] = useMemo(() => {
    const result: InsightAlert[] = [];
    const nhsT = treatments.filter(t => t.treatmentType === 'nhs' && t.revenue > 0);
    if (nhsT.length > 0) result.push({ type: 'warning', title: 'Attention', message: `${nhsT.length} NHS treatments running at lower margins. Review pricing strategy`, actionLabel: 'Review pricing' });
    if (topTreatments.length > 0) result.push({ type: 'positive', title: 'Positive', message: `${topTreatments[0].name} is your top performer with ${fmtCurrency(topTreatments[0].revenue)} revenue`, actionLabel: 'View details' });
    const uncat = treatments.filter(t => t.categoryName === 'Uncategorised' && t.revenue > 0);
    if (uncat.length > 0) result.push({ type: 'info', title: 'Info', message: `${uncat.length} treatments missing category assignment`, actionLabel: 'Update categories' });
    if (result.length < 3) result.push({ type: 'info', title: 'Info', message: `Tracking ${treatments.length} active treatments across your practice locations`, actionLabel: 'View all' });
    if (result.length < 3) result.push({ type: 'positive', title: 'Positive', message: `${treatments.length} treatments actively generating revenue`, actionLabel: 'View details' });
    return result.slice(0, 3);
  }, [treatments, topTreatments]);

  const dependenciesLoading = orgLoading || locationsLoading || !user?.id;
  const isLoading = dependenciesLoading || qualifiedLoading
    || (dateBasis === 'completed' && activityCountsLoading);
  // Charts only need the TPI pipeline — they should not sit in a skeleton
  // waiting for the (tile-only) Dentally activity-counts scan.
  const isPipelineLoading = dependenciesLoading || qualifiedLoading;
  // The trend chart alone follows its datepicker's dedicated fetch.
  const isTrendLoading = hasTrendRange
    ? trendOverrideLoading || !trendOverride
    : isPipelineLoading;
  if (qualifiedError) console.error('[TreatmentInsights] error:', qualifiedError);

  return { summary: summaryWithActivityCounts, revenueByCategory, treatmentMix, monthlyTrend, topTreatments, alerts, isLoading, isPipelineLoading, isTrendLoading, currentItems };
}

function fmtCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}
