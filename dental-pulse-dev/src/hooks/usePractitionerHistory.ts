import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { ukDayStartInstant, ukDayEndInstant, londonYMD } from '@/utils/dateRangeUtils';

const PAGE_SIZE = 1000;

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Trend label from a London YYYY-MM-DD, rendered timezone-independently.
function trendLabel(londonYMD: string, monthly: boolean): string {
  const [y, m, d] = londonYMD.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return monthly
    ? dt.toLocaleString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

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

/**
 * Known charting nomenclatures — tooth status records, NOT clinical procedures.
 * Dentally's Practitioner Activity Report excludes these.
 */
const CHARTING_NOMENCLATURES = new Set([
  'missing', 'missing tooth', 'caries', 'decay',
  'unerupted', 'partially erupted', 'root retained',
  'implant', 'implant present',
  'crown present', 'veneer present', 'bridge pontic',
  'bridge retainer', 'bridge unit',
  'denture tooth', 'denture saddle',
  'watch', 'monitor',
]);

function isChartingNomenclature(nomenclature: string | null): boolean {
  if (!nomenclature) return false;
  return CHARTING_NOMENCLATURES.has(nomenclature.toLowerCase().trim());
}

// ── Types ───────────────────────────────────────────────────────────

export interface TreatmentBreakdown {
  treatmentName: string;
  count: number;
  revenue: number;
}

export interface MonthlyTrend {
  month: string;        // YYYY-MM
  monthLabel: string;   // e.g. "Mar 2026"
  attended: number;
  cancelled: number;
  completed: number;
  dna: number;
  revenue: number;
}

export interface PractitionerSummary {
  id: string;
  externalId: number;
  name: string;
  role: string;
  locationName: string;
  photoUrl: string | null;
  /** False for Dentally practitioners marked inactive (historical / remapped IDs). */
  isActive: boolean;
  totalAppointments: number;
  attended: number;
  cancelled: number;
  completed: number;
  dna: number;
  totalRevenue: number;
  treatmentCount: number;
  uniquePatients: number;
  totalTreatments: number;
  totalHoursMinutes: number;
}

export interface PractitionerDetail extends PractitionerSummary {
  treatments: TreatmentBreakdown[];
  monthlyTrend: MonthlyTrend[];
}

// ── Hook: List of all practitioners with summary metrics ────────────

export function usePractitionerHistoryList() {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId } = useFilters();

  const startDate = toDateStr(dateRange.startDate);
  const endDate = toDateStr(dateRange.endDate);
  // Europe/London day-boundary instants for the timestamptz filters. Bare
  // 'YYYY-MM-DD' strings are cast in the DB's timezone (UTC), which during BST
  // shifts the window an hour late vs the practice day — the same defect fixed
  // in ProviderDetail / usePractitionerChairMetrics.
  const startInstant = ukDayStartInstant(dateRange.startDate);
  const endInstant = ukDayEndInstant(dateRange.endDate);

  return useQuery({
    queryKey: ['practitioner-history-list', organizationId, startDate, endDate, selectedLocationId || 'all'],
    queryFn: async (): Promise<PractitionerSummary[]> => {
      if (!organizationId) return [];

      // ── 1. Fetch providers ────────────────────────────────────────
      // Include inactive practitioners so All-practitioners totals match
      // Dentally (historical / remapped Dentally IDs still hold completed appts).
      // Do not filter providers by location_id — appointment.location_id is the
      // source of truth for site scoping (provider.location_id can disagree for
      // inactive / remapped rows).
      const providerQuery = () =>
        (supabase as any)
          .from('providers')
          .select('id, external_id, name, provider_role, location_id, photo_url, is_active')
          .eq('organization_id', organizationId)
          .is('deleted_at', null);

      const providers = await fetchAll<{
        id: string;
        external_id: number | null;
        name: string;
        provider_role: string | null;
        location_id: string | null;
        photo_url: string | null;
        is_active: boolean | null;
      }>(providerQuery);

      if (providers.length === 0) return [];

      // Build external_id → provider map
      const extIdToProvider = new Map<string, typeof providers[0]>();
      for (const p of providers) {
        if (p.external_id != null) {
          extIdToProvider.set(String(p.external_id), p);
        }
      }

      // Fetch location names
      const locationIds = [...new Set(providers.map(p => p.location_id).filter(Boolean))] as string[];
      const locationNameMap = new Map<string, string>();
      if (locationIds.length > 0) {
        const { data: locData } = await (supabase as any)
          .from('practice_locations')
          .select('id, location_name')
          .in('id', locationIds);
        for (const loc of (locData ?? []) as Array<{ id: string; location_name: string }>) {
          locationNameMap.set(loc.id, loc.location_name);
        }
      }

      // ── 2. Fetch appointments for these practitioners ─────────────
      const extIds = providers
        .map(p => p.external_id)
        .filter((id): id is number => id != null);

      const appointments = await fetchAll<{
        apmt_practitioner_id: number | null;
        apmt_patient_id: number | null;
        apmt_start_time: string | null;
        apmt_state: string | null;
        apmt_completed_at: string | null;
        apmt_cancelled_at: string | null;
        apmt_did_not_attend_at: string | null;
        apmt_arrived_at: string | null;
      }>(() => {
        let q = (supabase as any)
          .from('appointments')
          .select('apmt_practitioner_id, apmt_patient_id, apmt_start_time, apmt_state, apmt_completed_at, apmt_cancelled_at, apmt_did_not_attend_at, apmt_arrived_at')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .not('apmt_patient_id', 'is', null)
          .gte('apmt_start_time', startInstant)
          .lte('apmt_start_time', endInstant)
          .in('apmt_practitioner_id', extIds);
        if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
        return q;
      });

      // ── 3. Fetch TPIs for revenue ─────────────────────────────────
      // Fetch TPIs for revenue — excludes charting entries at the SQL level.
      // Charting TPIs (tooth status records like "Caries", "Missing Tooth", etc.)
      // have tpi_treatment_appointment_id = NULL. Dentally's Activity Report excludes them.
      const tpis = await fetchAll<{
        tpi_practitioner_id: number | null;
        tpi_price: number | null;
        tpi_treatment_id: number | null;
        tpi_patient_id: number | null;
        tpi_patient_nomenclature: string | null;
        duration: number | null;
      }>(() => {
        let q = (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_practitioner_id, tpi_price, tpi_treatment_id, tpi_patient_id, tpi_patient_nomenclature, duration')
          .eq('organization_id', organizationId)
          .eq('tpi_completed', true)
          .not('tpi_completed_at', 'is', null)
          .not('tpi_payment_plan_id', 'is', null)
          .not('tpi_treatment_appointment_id', 'is', null)
          .gte('tpi_completed_at', startInstant)
          .lte('tpi_completed_at', endInstant)
          .in('tpi_practitioner_id', extIds);
        return q;
      });

      // ── 4. Aggregate per practitioner + overall & per-practitioner trend ─
      // Build extId → provider.id map upfront so we can key trends by provider.id
      const extIdToProviderId = new Map<string, string>();
      for (const p of providers) {
        if (p.external_id != null) {
          extIdToProviderId.set(String(p.external_id), p.id);
        }
      }

      const apptCounts = new Map<string, { attended: number; cancelled: number; completed: number; dna: number; total: number; patients: Set<number> }>();
      const globalPatientSet = new Set<number>();
      const monthlyMap = new Map<string, MonthlyTrend>();
      // Per-practitioner trends keyed by provider.id (UUID)
      const practitionerTrendsMap = new Map<string, Map<string, MonthlyTrend>>();

      // Always bucketed by day — the Provider History chart re-aggregates this
      // into weekly/monthly/quarterly client-side based on its own toggle, so
      // the server-side grouping stays at the finest granularity.
      const ensureTrendEntry = (map: Map<string, MonthlyTrend>, trendKey: string, londonYMD: string) => {
        if (!map.has(trendKey)) {
          map.set(trendKey, {
            month: trendKey, monthLabel: trendLabel(londonYMD, false),
            attended: 0, cancelled: 0, completed: 0, dna: 0, revenue: 0,
          });
        }
        return map.get(trendKey)!;
      };

      for (const appt of appointments) {
        const extKey = String(appt.apmt_practitioner_id);
        let c = apptCounts.get(extKey);
        if (!c) { c = { attended: 0, cancelled: 0, completed: 0, dna: 0, total: 0, patients: new Set() }; apptCounts.set(extKey, c); }
        c.total++;
        if (appt.apmt_patient_id != null) {
          c.patients.add(appt.apmt_patient_id);
          globalPatientSet.add(appt.apmt_patient_id);
        }

        const londonDate = appt.apmt_start_time ? londonYMD(appt.apmt_start_time) : '';
        const trendKey = londonDate;
        if (!trendKey) continue;

        const mt = ensureTrendEntry(monthlyMap, trendKey, londonDate);

        // Per-practitioner trend keyed by provider UUID
        const providerId = extIdToProviderId.get(extKey);
        let ptMap: Map<string, MonthlyTrend> | undefined;
        if (providerId) {
          if (!practitionerTrendsMap.has(providerId)) practitionerTrendsMap.set(providerId, new Map());
          ptMap = practitionerTrendsMap.get(providerId)!;
        }
        const pt = ptMap ? ensureTrendEntry(ptMap, trendKey, londonDate) : undefined;

        // Use apmt_state to classify — matches Dentally's status filter
        const state = (appt.apmt_state || '').toLowerCase();
        if (state === 'cancelled') { c.cancelled++; mt.cancelled++; if (pt) pt.cancelled++; }
        else if (state === 'did not attend' || state === 'dna') { c.dna++; mt.dna++; if (pt) pt.dna++; }
        else if (state === 'completed') { c.completed++; mt.completed++; if (pt) pt.completed++; }
        else { c.attended++; mt.attended++; if (pt) pt.attended++; }
      }

      const revenueCounts = new Map<string, { revenue: number; treatments: Set<number>; patients: Set<number>; totalTreatments: number; totalMinutes: number }>();
      for (const tpi of tpis) {
        const key = String(tpi.tpi_practitioner_id);
        let r = revenueCounts.get(key);
        if (!r) { r = { revenue: 0, treatments: new Set(), patients: new Set(), totalTreatments: 0, totalMinutes: 0 }; revenueCounts.set(key, r); }
        r.revenue += asNumber(tpi.tpi_price);
        r.totalTreatments++;
        r.totalMinutes += asNumber(tpi.duration);
        if (tpi.tpi_treatment_id != null) r.treatments.add(tpi.tpi_treatment_id);
        if (tpi.tpi_patient_id != null) r.patients.add(tpi.tpi_patient_id);
      }

      // ── 5. Build results ──────────────────────────────────────────
      // Only practitioners with appointments in the selected range (active or
      // inactive). Zero-appt roster rows are omitted from the table/totals.
      const results: PractitionerSummary[] = providers
        .filter(p => p.external_id != null)
        .map(p => {
          const extKey = String(p.external_id);
          const ac = apptCounts.get(extKey);
          const rc = revenueCounts.get(extKey);
          const isActive = p.is_active !== false;

          return {
            id: p.id,
            externalId: p.external_id!,
            name: p.name,
            role: p.provider_role || 'Unknown',
            locationName: p.location_id ? (locationNameMap.get(p.location_id) || '') : '',
            photoUrl: p.photo_url,
            isActive,
            totalAppointments: ac?.total ?? 0,
            attended: (ac?.total ?? 0) - (ac?.completed ?? 0) - (ac?.cancelled ?? 0) - (ac?.dna ?? 0),
            cancelled: ac?.cancelled ?? 0,
            completed: ac?.completed ?? 0,
            dna: ac?.dna ?? 0,
            totalRevenue: rc?.revenue ?? 0,
            treatmentCount: rc?.treatments.size ?? 0,
            uniquePatients: ac?.patients.size ?? 0,
            totalTreatments: rc?.totalTreatments ?? 0,
            totalHoursMinutes: rc?.totalMinutes ?? 0,
          };
        })
        .filter(p => p.totalAppointments > 0)
        .sort((a, b) => {
          // Active first, then by revenue (Dentally parity for totals; UX for roster)
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return b.totalRevenue - a.totalRevenue;
        });

      const monthlyTrend = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));

      // Convert per-practitioner trend maps to sorted arrays
      const practitionerTrendsSorted = new Map<string, MonthlyTrend[]>();
      for (const [provId, trendMap] of practitionerTrendsMap) {
        practitionerTrendsSorted.set(provId, [...trendMap.values()].sort((a, b) => a.month.localeCompare(b.month)));
      }

      return { practitioners: results, monthlyTrend, practitionerTrendsMap: practitionerTrendsSorted, totalUniquePatients: globalPatientSet.size };
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}

// ── Hook: Single practitioner detail with treatment breakdown ────────

export function usePractitionerHistoryDetail(providerId: string | undefined) {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId, selectedDateRangeId } = useFilters();

  const startDate = toDateStr(dateRange.startDate);
  const endDate = toDateStr(dateRange.endDate);
  // London day-boundary instants — see usePractitionerHistoryList.
  const startInstant = ukDayStartInstant(dateRange.startDate);
  const endInstant = ukDayEndInstant(dateRange.endDate);

  const yearRanges = new Set(['this-year', 'ytd', 'last-year', 'last-12m', 'yoy']);
  const groupByMonth = yearRanges.has(selectedDateRangeId);

  return useQuery({
    queryKey: ['practitioner-history-detail', organizationId, providerId, startDate, endDate, selectedLocationId || 'all'],
    queryFn: async (): Promise<PractitionerDetail | null> => {
      if (!organizationId || !providerId) return null;

      // ── 1. Fetch provider ─────────────────────────────────────────
      const { data: provider, error: provError } = await (supabase as any)
        .from('providers')
        .select('id, external_id, name, provider_role, location_id, photo_url, is_active')
        .eq('id', providerId)
        .single();

      if (provError || !provider || provider.external_id == null) return null;

      const extId = provider.external_id;
      const extIdStr = String(extId);

      // Fetch location name
      let locationName = '';
      if (provider.location_id) {
        const { data: locData } = await (supabase as any)
          .from('practice_locations')
          .select('location_name')
          .eq('id', provider.location_id)
          .single();
        locationName = locData?.location_name || '';
      }

      // ── 2. Fetch appointments ─────────────────────────────────────
      const appointments = await fetchAll<{
        apmt_patient_id: number | null;
        apmt_start_time: string | null;
        apmt_state: string | null;
        apmt_completed_at: string | null;
        apmt_cancelled_at: string | null;
        apmt_did_not_attend_at: string | null;
        apmt_arrived_at: string | null;
      }>(() => {
        let q = (supabase as any)
          .from('appointments')
          .select('apmt_patient_id, apmt_start_time, apmt_state, apmt_completed_at, apmt_cancelled_at, apmt_did_not_attend_at, apmt_arrived_at')
          .eq('organization_id', organizationId)
          .eq('apmt_practitioner_id', extId)
          .is('deleted_at', null)
          .not('apmt_patient_id', 'is', null)
          .gte('apmt_start_time', startInstant)
          .lte('apmt_start_time', endInstant);
        if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
        return q;
      });

      // ── 3. Fetch TPIs with treatment info ─────────────────────────
      // Excludes charting entries (tpi_treatment_appointment_id IS NULL) at SQL level.
      const tpis = await fetchAll<{
        tpi_price: number | null;
        tpi_treatment_id: number | null;
        tpi_completed_at: string | null;
        tpi_patient_id: number | null;
        tpi_patient_nomenclature: string | null;
        duration: number | null;
      }>(() =>
        (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_price, tpi_treatment_id, tpi_completed_at, tpi_patient_id, tpi_patient_nomenclature, duration')
          .eq('organization_id', organizationId)
          .eq('tpi_practitioner_id', extId)
          .eq('tpi_completed', true)
          .not('tpi_completed_at', 'is', null)
          .not('tpi_payment_plan_id', 'is', null)
          .not('tpi_treatment_appointment_id', 'is', null)
          .gte('tpi_completed_at', startInstant)
          .lte('tpi_completed_at', endInstant)
      );

      // ── 4. Fetch treatment names ──────────────────────────────────
      const treatmentExtIds = [...new Set(tpis.map(t => t.tpi_treatment_id).filter((id): id is number => id != null))];
      const treatmentNameMap = new Map<number, string>();
      if (treatmentExtIds.length > 0) {
        const { data: txData } = await (supabase as any)
          .from('treatments')
          .select('external_id, treatment_name')
          .eq('organization_id', organizationId)
          .in('external_id', treatmentExtIds);
        for (const t of (txData ?? []) as Array<{ external_id: number; treatment_name: string }>) {
          treatmentNameMap.set(t.external_id, t.treatment_name);
        }
      }

      // ── 5. Aggregate appointment counts ───────────────────────────
      let attended = 0, cancelled = 0, completed = 0, dna = 0;
      const apptPatientSet = new Set<number>();
      const monthlyMap = new Map<string, MonthlyTrend>();

      for (const appt of appointments) {
        if (appt.apmt_patient_id != null) apptPatientSet.add(appt.apmt_patient_id);
        const londonDate = appt.apmt_start_time ? londonYMD(appt.apmt_start_time) : '';
        const trendKey = groupByMonth ? londonDate.substring(0, 7) : londonDate;
        if (!trendKey) continue;
        if (!monthlyMap.has(trendKey)) {
          monthlyMap.set(trendKey, {
            month: trendKey, monthLabel: trendLabel(londonDate, groupByMonth),
            attended: 0, cancelled: 0, completed: 0, dna: 0, revenue: 0,
          });
        }
        const mt = monthlyMap.get(trendKey)!;

        // Use apmt_state to classify — matches Dentally's status filter
        const state = (appt.apmt_state || '').toLowerCase();
        if (state === 'cancelled') { cancelled++; mt.cancelled++; }
        else if (state === 'did not attend' || state === 'dna') { dna++; mt.dna++; }
        else if (state === 'completed') { completed++; mt.completed++; }
        else { attended++; mt.attended++; }
      }

      // ── 6. Treatment breakdown ────────────────────────────────────
      const txAgg = new Map<string, TreatmentBreakdown>();
      const patientSet = new Set<number>();
      let totalRevenue = 0;
      let totalMinutes = 0;

      for (const tpi of tpis) {
        const price = asNumber(tpi.tpi_price);
        totalRevenue += price;
        totalMinutes += asNumber(tpi.duration);
        if (tpi.tpi_patient_id != null) patientSet.add(tpi.tpi_patient_id);

        const txName = tpi.tpi_treatment_id != null
          ? (treatmentNameMap.get(tpi.tpi_treatment_id) || `Treatment #${tpi.tpi_treatment_id}`)
          : 'Unknown Treatment';

        const existing = txAgg.get(txName);
        if (existing) {
          existing.count++;
          existing.revenue += price;
        } else {
          txAgg.set(txName, { treatmentName: txName, count: 1, revenue: price });
        }

        // Add revenue to trend (bucketed by London date, same as the appointments)
        const completedLondon = tpi.tpi_completed_at ? londonYMD(tpi.tpi_completed_at) : '';
        const revTrendKey = groupByMonth ? completedLondon.substring(0, 7) : completedLondon;
        if (revTrendKey && monthlyMap.has(revTrendKey)) {
          monthlyMap.get(revTrendKey)!.revenue += price;
        }
      }

      const treatments = [...txAgg.values()].sort((a, b) => b.count - a.count);
      const monthlyTrend = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));

      return {
        id: provider.id,
        externalId: extId,
        name: provider.name,
        role: provider.provider_role || 'Unknown',
        locationName,
        photoUrl: provider.photo_url,
        isActive: provider.is_active !== false,
        totalAppointments: appointments.length,
        attended,
        cancelled,
        completed,
        dna,
        totalRevenue,
        treatmentCount: txAgg.size,
        uniquePatients: apptPatientSet.size,
        totalTreatments: tpis.length,
        totalHoursMinutes: totalMinutes,
        treatments,
        monthlyTrend,
      };
    },
    enabled: !!organizationId && !!providerId,
    staleTime: 5 * 60 * 1000,
  });
}
