import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { ukDayStartInstant, ukDayEndInstant, londonYMD } from '@/utils/dateRangeUtils';

const PAGE_SIZE = 1000;

// Trend label from a London YYYY-MM-DD, rendered timezone-independently.
function trendLabel(londonDateYMD: string, monthly: boolean): string {
  const [y, m, d] = londonDateYMD.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return monthly
    ? dt.toLocaleString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

export interface LocationDetail {
  id: string;
  name: string;
  address: string;
  region: string;
  chairs: number;
  isActive: boolean;
  email: string | null;
  phone: string | null;
}

export interface LocationHistoryProvider {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  patients: number;
  appointments: number;
  completed: number;
  cancelled: number;
  dna: number;
  revenue: number;
  avgRevPerPatient: number;
  utilisation: number;
  associateSplit: number;
  labSplit: number;
  photoUrl: string | null;
}

export interface LocationHistoryTreatment {
  treatmentId: string;
  name: string;
  category: string;
  type: string;
  count: number;
  revenue: number;
  avgPrice: number;
  materialCost: number;
  labBill: number;
  therapistRate: number;
  durationMinutes: number;
  opCostPerTreatment: number;
  associatePay: number;
  financeFee: number;
  expensePerUnit: number;
  profitLossPerUnit: number;
  totalExpense: number;
  totalPL: number;
  principalProfit: number;
  plPercent: number;
  principalProfitPercent: number;
  margin: number;
}

export interface LocationMonthlyTrend {
  month: string;
  monthLabel: string;
  revenue: number;
  completed: number;
  cancelled: number;
  dna: number;
}

export interface LocationHistoryData {
  location: LocationDetail | null;
  providers: LocationHistoryProvider[];
  treatments: LocationHistoryTreatment[];
  monthlyTrend: LocationMonthlyTrend[];
  summary: {
    totalRevenue: number;
    activeProviders: number;
    treatmentsCompleted: number;
    totalAppointments: number;
    completedAppts: number;
    cancelledAppts: number;
    dnaAppts: number;
    uniquePatients: number;
  };
}

function defaultData(): LocationHistoryData {
  return {
    location: null,
    providers: [],
    treatments: [],
    monthlyTrend: [],
    summary: {
      totalRevenue: 0, activeProviders: 0, treatmentsCompleted: 0,
      totalAppointments: 0, completedAppts: 0, cancelledAppts: 0,
      dnaAppts: 0, uniquePatients: 0,
    },
  };
}

// ── Hook ────────────────────────────────────────────────────────────

export function useLocationHistory() {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId, selectedDateRangeId } = useFilters();

  const startDate = toDateStr(dateRange.startDate);
  const endDate = toDateStr(dateRange.endDate);
  // Europe/London day-boundary instants for the timestamptz filters — bare
  // 'YYYY-MM-DD' strings are cast as UTC by the DB, one hour late during BST.
  const startInstant = ukDayStartInstant(dateRange.startDate);
  const endInstant = ukDayEndInstant(dateRange.endDate);

  const yearRanges = new Set(['this-year', 'ytd', 'last-year', 'last-12m', 'yoy']);
  const groupByMonth = yearRanges.has(selectedDateRangeId);

  return useQuery({
    queryKey: ['location-history', organizationId, selectedLocationId || 'none', startDate, endDate, groupByMonth ? 'monthly' : 'daily'],
    queryFn: async (): Promise<LocationHistoryData> => {
      if (!organizationId || !selectedLocationId) return defaultData();

      // ── 1. Location details ──────────────────────────────────────
      const { data: locData } = await (supabase as any)
        .from('practice_locations')
        .select('id, location_name, address_line1, city, postal_code, region_id, chairs_count, is_active, email, phone, regions(name)')
        .eq('id', selectedLocationId)
        .single();

      const location: LocationDetail | null = locData ? {
        id: locData.id,
        name: locData.location_name,
        address: [locData.address_line1, locData.city, locData.postal_code].filter(Boolean).join(', '),
        region: locData.regions?.name || 'No Region',
        chairs: locData.chairs_count || 0,
        isActive: locData.is_active,
        email: locData.email,
        phone: locData.phone,
      } : null;

      // ── 2. Providers at this location ────────────────────────────
      const providerRows = await fetchAll<{
        id: string; external_id: number | null; name: string;
        provider_role: string | null; is_active: boolean;
        utilisation: number | null; associate_split_percentage: number | null;
        lab_split_percentage: number | null; photo_url: string | null;
      }>(() =>
        (supabase as any)
          .from('providers')
          .select('id, external_id, name, provider_role, is_active, utilisation, associate_split_percentage, lab_split_percentage, photo_url')
          .eq('organization_id', organizationId)
          .eq('location_id', selectedLocationId)
          .is('deleted_at', null)
      );

      if (providerRows.length === 0) {
        return { location, providers: [], treatments: [], monthlyTrend: [], summary: defaultData().summary };
      }

      const extIds = providerRows.map(p => p.external_id).filter((id): id is number => id != null);
      const extIdToProvider = new Map<string, typeof providerRows[0]>();
      for (const p of providerRows) {
        if (p.external_id != null) extIdToProvider.set(String(p.external_id), p);
      }

      // ── 3. Appointments ──────────────────────────────────────────
      // Uses apmt_state for classification to match Practitioner History page
      const appointments = extIds.length > 0 ? await fetchAll<{
        apmt_practitioner_id: number | null;
        apmt_patient_id: number | null;
        apmt_start_time: string | null;
        apmt_state: string | null;
      }>(() =>
        (supabase as any)
          .from('appointments')
          .select('apmt_practitioner_id, apmt_patient_id, apmt_start_time, apmt_state')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .not('apmt_patient_id', 'is', null)
          .gte('apmt_start_time', startInstant)
          .lte('apmt_start_time', endInstant)
          .in('apmt_practitioner_id', extIds)
      ) : [];

      const apptByProvider = new Map<string, { completed: number; cancelled: number; dna: number; total: number; patients: Set<number> }>();
      const trendMap = new Map<string, LocationMonthlyTrend>();
      const allApptPatients = new Set<number>();

      for (const appt of appointments) {
        const extKey = String(appt.apmt_practitioner_id);
        let c = apptByProvider.get(extKey);
        if (!c) { c = { completed: 0, cancelled: 0, dna: 0, total: 0, patients: new Set() }; apptByProvider.set(extKey, c); }
        c.total++;

        const state = (appt.apmt_state || '').toLowerCase();
        const londonDate = londonYMD(appt.apmt_start_time);
        const trendKey = groupByMonth ? londonDate.substring(0, 7) : londonDate;
        if (trendKey) {
          if (!trendMap.has(trendKey)) {
            trendMap.set(trendKey, { month: trendKey, monthLabel: trendLabel(londonDate, groupByMonth), revenue: 0, completed: 0, cancelled: 0, dna: 0 });
          }
          const mt = trendMap.get(trendKey)!;
          if (state === 'cancelled') { c.cancelled++; mt.cancelled++; }
          else if (state === 'did not attend' || state === 'dna') { c.dna++; mt.dna++; }
          else if (state === 'completed') {
            c.completed++; mt.completed++;
            if (appt.apmt_patient_id != null) { c.patients.add(appt.apmt_patient_id); allApptPatients.add(appt.apmt_patient_id); }
          }
        } else {
          if (state === 'cancelled') c.cancelled++;
          else if (state === 'did not attend' || state === 'dna') c.dna++;
          else if (state === 'completed') {
            c.completed++;
            if (appt.apmt_patient_id != null) { c.patients.add(appt.apmt_patient_id); allApptPatients.add(appt.apmt_patient_id); }
          }
        }
      }

      // ── 4. TPIs (revenue + treatment breakdown) ──────────────────
      const tpisRaw = extIds.length > 0 ? await fetchAll<{
        tpi_practitioner_id: number | null;
        tpi_price: number | null;
        tpi_treatment_id: number | null;
        tpi_patient_id: number | null;
        tpi_patient_nomenclature: string | null;
        tpi_completed_at: string | null;
        duration: number | null;
      }>(() =>
        (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_practitioner_id, tpi_price, tpi_treatment_id, tpi_patient_id, tpi_patient_nomenclature, tpi_completed_at, duration')
          .eq('organization_id', organizationId)
          .eq('tpi_completed', true)
          .not('tpi_completed_at', 'is', null)
          .not('tpi_payment_plan_id', 'is', null)
          .gte('tpi_completed_at', startInstant)
          .lte('tpi_completed_at', endInstant)
          .in('tpi_practitioner_id', extIds)
      ) : [];

      const tpis = tpisRaw.filter(t => !isChartingNomenclature(t.tpi_patient_nomenclature));

      const revenueByProvider = new Map<string, { revenue: number; patients: Set<number>; totalMinutes: number }>();
      const allPatients = new Set<number>();
      const treatmentAgg = new Map<number, { count: number; revenue: number }>();
      const treatmentIds = new Set<number>();

      for (const tpi of tpis) {
        const extKey = String(tpi.tpi_practitioner_id);
        const price = asNumber(tpi.tpi_price);

        let r = revenueByProvider.get(extKey);
        if (!r) { r = { revenue: 0, patients: new Set(), totalMinutes: 0 }; revenueByProvider.set(extKey, r); }
        r.revenue += price;
        r.totalMinutes += asNumber(tpi.duration);
        if (tpi.tpi_patient_id != null) {
          r.patients.add(tpi.tpi_patient_id);
          allPatients.add(tpi.tpi_patient_id);
        }

        if (tpi.tpi_treatment_id != null) {
          treatmentIds.add(tpi.tpi_treatment_id);
          let ta = treatmentAgg.get(tpi.tpi_treatment_id);
          if (!ta) { ta = { count: 0, revenue: 0 }; treatmentAgg.set(tpi.tpi_treatment_id, ta); }
          ta.count++;
          ta.revenue += price;
        }

        const completedLondon = londonYMD(tpi.tpi_completed_at);
        const trendKey = groupByMonth ? completedLondon.substring(0, 7) : completedLondon;
        if (trendKey && trendMap.has(trendKey)) {
          trendMap.get(trendKey)!.revenue += price;
        }
      }

      // ── 5. Treatment details for cost info ───────────────────────
      let treatmentDetails: LocationHistoryTreatment[] = [];
      if (treatmentIds.size > 0) {
        // Fetch treatments and categories in parallel
        const [treatResult, catResult] = await Promise.all([
          (supabase as any)
            .from('treatments')
            .select('id, external_id, treatment_name, treatment_type, category_id, material_cost, lab_bill, therapist_pay_rate, hourly_rate, percent_fees, finance_fee, duration_minutes')
            .eq('organization_id', organizationId)
            .is('deleted_at', null),
          (supabase as any)
            .from('treatment_categories')
            .select('id, name')
            .eq('organization_id', organizationId)
            .is('deleted_at', null),
        ]);

        const categoryMap = new Map<string, string>();
        for (const c of (catResult.data ?? []) as Array<{ id: string; name: string }>) {
          if (c?.id && c?.name) categoryMap.set(c.id, c.name);
        }

        const extIdToTreatment = new Map<number, any>();
        for (const t of (treatResult.data ?? []) as any[]) {
          if (t.external_id != null) extIdToTreatment.set(Number(t.external_id), t);
        }

        treatmentDetails = [...treatmentIds].map(tId => {
          const agg = treatmentAgg.get(tId)!;
          const detail = extIdToTreatment.get(tId);
          const avgPrice = agg.count > 0 ? agg.revenue / agg.count : 0;
          const materialCost = asNumber(detail?.material_cost);
          const labBill = asNumber(detail?.lab_bill);
          const therapistRate = asNumber(detail?.therapist_pay_rate);
          const opCostPerTreatment = asNumber(detail?.hourly_rate) * (asNumber(detail?.duration_minutes) / 60);
          const associatePay = avgPrice * (asNumber(detail?.percent_fees) / 100);
          const financeFee = avgPrice * (asNumber(detail?.finance_fee) / 100);
          const expensePerUnit = materialCost + labBill + therapistRate + opCostPerTreatment + associatePay + financeFee;
          const profitLossPerUnit = avgPrice - expensePerUnit;
          const totalIncome = agg.revenue;
          const totalExpense = expensePerUnit * agg.count;
          const totalPL = totalIncome - totalExpense;
          const principalProfit = totalIncome - associatePay * agg.count;
          const plPercent = totalIncome !== 0 ? (totalPL / totalIncome) * 100 : 0;
          const principalProfitPercent = totalIncome !== 0 ? (principalProfit / totalIncome) * 100 : 0;
          const margin = avgPrice > 0 ? ((avgPrice - expensePerUnit) / avgPrice) * 100 : 0;
          const catName = detail?.category_id ? (categoryMap.get(detail.category_id) || 'Uncategorised') : 'Uncategorised';

          return {
            treatmentId: String(tId),
            name: detail?.treatment_name || `Treatment #${tId}`,
            category: catName,
            type: detail?.treatment_type || 'private',
            count: agg.count,
            revenue: agg.revenue,
            avgPrice,
            materialCost,
            labBill,
            therapistRate,
            durationMinutes: asNumber(detail?.duration_minutes),
            opCostPerTreatment,
            associatePay,
            financeFee,
            expensePerUnit,
            profitLossPerUnit,
            totalExpense,
            totalPL,
            principalProfit,
            plPercent: Math.round(plPercent * 10) / 10,
            principalProfitPercent: Math.round(principalProfitPercent * 10) / 10,
            margin: Math.round(margin * 10) / 10,
          };
        }).sort((a, b) => b.revenue - a.revenue);
      }

      // ── 6. Build provider results ────────────────────────────────
      // Calculate working days in the date range for utilisation
      const msPerDay = 86400000;
      const rangeDays = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / msPerDay) + 1);
      // Assume 8 hours/day as default (chair_settings default)
      const hoursPerDay = 8;
      const availableHoursPerProvider = (rangeDays * 5 / 7) * hoursPerDay; // ~weekdays only

      const providers: LocationHistoryProvider[] = providerRows.map(p => {
        const extKey = p.external_id != null ? String(p.external_id) : '';
        const appts = apptByProvider.get(extKey) || { completed: 0, cancelled: 0, dna: 0, total: 0, patients: new Set() };
        const rev = revenueByProvider.get(extKey) || { revenue: 0, patients: new Set(), totalMinutes: 0 };
        const patientCount = appts.patients.size;
        const completedHours = rev.totalMinutes / 60;
        const utilPct = availableHoursPerProvider > 0 ? Math.min(100, (completedHours / availableHoursPerProvider) * 100) : 0;

        return {
          id: p.id,
          name: p.name,
          role: p.provider_role || 'Unknown',
          isActive: p.is_active,
          patients: patientCount,
          appointments: appts.completed,
          completed: appts.completed,
          cancelled: appts.cancelled,
          dna: appts.dna,
          revenue: rev.revenue,
          avgRevPerPatient: patientCount > 0 ? rev.revenue / patientCount : 0,
          utilisation: Math.round(utilPct * 10) / 10,
          associateSplit: asNumber(p.associate_split_percentage),
          labSplit: asNumber(p.lab_split_percentage),
          photoUrl: p.photo_url,
        };
      }).sort((a, b) => b.revenue - a.revenue);

      // ── 7. Summary + trend ───────────────────────────────────────
      const totalRevenue = providers.reduce((s, p) => s + p.revenue, 0);
      const activeProviders = providers.filter(p => p.isActive).length;
      const completedAppts = [...apptByProvider.values()].reduce((s, c) => s + c.completed, 0);
      const cancelledAppts = [...apptByProvider.values()].reduce((s, c) => s + c.cancelled, 0);
      const dnaAppts = [...apptByProvider.values()].reduce((s, c) => s + c.dna, 0);

      const monthlyTrend = [...trendMap.values()].sort((a, b) => a.month.localeCompare(b.month));

      return {
        location,
        providers,
        treatments: treatmentDetails,
        monthlyTrend,
        summary: {
          totalRevenue,
          activeProviders,
          treatmentsCompleted: tpis.length,
          totalAppointments: appointments.length,
          completedAppts,
          cancelledAppts,
          dnaAppts,
          uniquePatients: allApptPatients.size,
        },
      };
    },
    enabled: !!organizationId && !!selectedLocationId,
    staleTime: 5 * 60 * 1000,
  });
}
