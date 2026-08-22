import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';
import { useTreatments } from './useTreatments';
import type { TreatmentConsumption } from './useMembershipPerformance';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

// Fetches data for a single DB payment plan (identified by `payment_plans.id`)
// without going through useMembershipPerformance's "must have DB members"
// filter — so the mapped-plan detail page populates even when no patients
// are linked via pt_payment_plan_id, as long as the plan has TPIs in range.

export interface MappedDbPlan {
  id: string;
  ppId: number | null;
  name: string;
  patientFriendlyName: string | null;
  color: string | null;
  monthlyFee: number;
  examAppointmentsIncluded: number;
  hygieneAppointmentsIncluded: number;
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

const PAGE_SIZE = 1000;

// Note: the uploaded-member lookup queries by `mapped_plan_id` (not by
// fee_category) because after auto-matching, multiple CSV fee categories
// may funnel into the same DB plan.
export function useMappedPlanDetail(
  mappedPlanId: string | null,
) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();
  const { allAvailableLocations } = useLocations();
  const { treatments: dbTreatments } = useTreatments();

  const selectedMonth = dateRange.startDate.getMonth() + 1;
  const selectedYear = dateRange.startDate.getFullYear();

  const allLocationIds = useMemo(() => allAvailableLocations.map(l => l.id), [allAvailableLocations]);
  const regionLocationIds = useMemo(() => {
    if (!selectedRegionId || selectedLocationId) return null;
    return allAvailableLocations.filter(l => l.region_id === selectedRegionId).map(l => l.id);
  }, [selectedRegionId, selectedLocationId, allAvailableLocations]);

  // Whether a specific location or region is selected (vs "All Locations")
  const isFiltered = !!selectedLocationId || (!!regionLocationIds && regionLocationIds.length > 0);

  const locationFilter = useMemo(() => {
    if (selectedLocationId) return { type: 'single' as const, ids: [selectedLocationId] };
    if (regionLocationIds && regionLocationIds.length > 0) return { type: 'multi' as const, ids: regionLocationIds };
    if (allLocationIds.length > 0) return { type: 'multi' as const, ids: allLocationIds };
    return null;
  }, [selectedLocationId, regionLocationIds, allLocationIds]);

  // Europe/London day-boundary instants — viewer-independent, unlike
  // toISOString() on local-midnight Dates (wrong outside UK browsers).
  const startDateISO = ukDayStartInstant(dateRange.startDate);
  const endDateISO = ukDayEndInstant(dateRange.endDate);
  const locationKey = isFiltered && locationFilter ? locationFilter.ids.slice().sort().join(',') : 'all';

  const { data, isLoading } = useQuery({
    queryKey: [
      'mapped_plan_detail',
      organizationId,
      mappedPlanId,
      selectedMonth,
      selectedYear,
      locationKey,
      startDateISO,
      endDateISO,
    ],
    queryFn: async () => {
      if (!organizationId || !mappedPlanId) {
        return {
          dbPlan: null as MappedDbPlan | null,
          tpiAgg: {} as Record<string, { count: number; totalRevenue: number }>,
          memberPatientCount: 0,
          tpiSource: 'none' as 'none' | 'uploaded-patients' | 'plan-id' | 'db-patients',
        };
      }

      // Step 1: fetch the DB payment plan row (for metadata display)
      const { data: planRow, error: planErr } = await (supabase as any)
        .from('payment_plans')
        .select('id, pp_id, pp_name, pp_patient_friendly_name, pp_colour, pp_monthly_memberhsip_fee, pp_exam_appointments_included, pp_hygiene_appointments_included')
        .eq('id', mappedPlanId)
        .is('deleted_at', null)
        .maybeSingle();
      if (planErr) throw planErr;
      if (!planRow) {
        return { dbPlan: null, tpiAgg: {}, memberPatientCount: 0, tpiSource: 'none' as const };
      }

      const dbPlan: MappedDbPlan = {
        id: planRow.id,
        ppId: planRow.pp_id != null ? Number(planRow.pp_id) : null,
        name: planRow.pp_name || planRow.pp_patient_friendly_name || 'Unnamed',
        patientFriendlyName: planRow.pp_patient_friendly_name ?? null,
        color: planRow.pp_colour ?? null,
        monthlyFee: asNumber(planRow.pp_monthly_memberhsip_fee),
        examAppointmentsIncluded: asNumber(planRow.pp_exam_appointments_included),
        hygieneAppointmentsIncluded: asNumber(planRow.pp_hygiene_appointments_included),
      };

      // Step 2: resolve the list of patient IDs that belong to this plan.
      // Priority order:
      //   a) uploaded members' patient_id for this fee_category (source of truth for the month)
      //   b) patients with pt_payment_plan_id = pp_id (DB view)
      //   c) fall back to TPI filter by tpi_payment_plan_id
      const uploadedPatientIds = new Set<string>();
      {
        let fromU = 0;
        while (true) {
          let q = (supabase as any)
            .from('membership_upload_members')
            .select('patient_id')
            .eq('organization_id', organizationId)
            .eq('upload_month', selectedMonth)
            .eq('upload_year', selectedYear)
            .eq('mapped_plan_id', mappedPlanId)
            .is('deleted_at', null)
            .not('patient_id', 'is', null)
            .range(fromU, fromU + PAGE_SIZE - 1);
          if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
          const { data: rows, error } = await q;
          if (error) throw error;
          for (const r of (rows ?? [])) {
            if (r.patient_id != null && String(r.patient_id).trim() !== '') {
              uploadedPatientIds.add(String(r.patient_id).trim());
            }
          }
          if (!rows || rows.length < PAGE_SIZE) break;
          fromU += PAGE_SIZE;
        }
      }

      let dbPatientIds = new Set<string>();
      if (uploadedPatientIds.size === 0 && dbPlan.ppId != null) {
        let fromP = 0;
        while (true) {
          const { data: rows, error } = await (supabase as any)
            .from('patients')
            .select('pt_id')
            .eq('organization_id', organizationId)
            .eq('pt_payment_plan_id', dbPlan.ppId)
            .is('deleted_at', null)
            .range(fromP, fromP + PAGE_SIZE - 1);
          if (error) throw error;
          for (const r of (rows ?? [])) {
            if (r.pt_id != null) dbPatientIds.add(String(r.pt_id));
          }
          if (!rows || rows.length < PAGE_SIZE) break;
          fromP += PAGE_SIZE;
        }
      }

      // Coerce to numbers — tpi_patient_id is BIGINT, pt_id is BIGINT.
      // membership_upload_members.patient_id is TEXT, so string values here
      // would silently fail the .in() filter against the numeric column.
      const toNumericIds = (set: Set<string>): number[] => {
        const out: number[] = [];
        for (const v of set) {
          const n = Number(v);
          if (Number.isFinite(n)) out.push(n);
        }
        return out;
      };
      const patientIds: number[] = uploadedPatientIds.size > 0
        ? toNumericIds(uploadedPatientIds)
        : toNumericIds(dbPatientIds);
      // Prefer plan-id branch when the DB plan has a pp_id — matches the parent
      // Membership Performance page (which aggregates by tpi_payment_plan_id)
      // and avoids the case where uploaded CSV patient_ids don't line up with
      // tpi_patient_id (missing, stale, or typed differently).
      const tpiSource: 'none' | 'uploaded-patients' | 'plan-id' | 'db-patients' =
        dbPlan.ppId != null ? 'plan-id'
        : uploadedPatientIds.size > 0 ? 'uploaded-patients'
        : dbPatientIds.size > 0 ? 'db-patients'
        : 'none';

      // Step 3: aggregate completed TPIs
      const tpiAgg: Record<string, { count: number; totalRevenue: number }> = {};
      const tpiPatientSet = new Set<string>();

      if (tpiSource === 'plan-id' && dbPlan.ppId != null) {
        // No patient list — filter by plan id on the TPI row itself
        let fromT = 0;
        while (true) {
          let q = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_treatment_id, tpi_price, tpi_patient_id, location_id')
            .eq('organization_id', organizationId)
            .eq('tpi_payment_plan_id', dbPlan.ppId)
            .eq('tpi_completed', true)
            .not('tpi_completed_at', 'is', null)
            .gte('tpi_completed_at', startDateISO)
            .lte('tpi_completed_at', endDateISO)
            .is('deleted_at', null)
            .range(fromT, fromT + PAGE_SIZE - 1);
          // Only apply location filter when a specific location/region is selected.
          // "All Locations" skips the filter to include TPIs with NULL location_id
          // (Dentally doesn't return site_id for TPIs; backend resolves post-sync).
          if (isFiltered && locationFilter) {
            if (locationFilter.type === 'single') q = q.eq('location_id', locationFilter.ids[0]);
            else q = q.in('location_id', locationFilter.ids);
          }
          const { data: tpis, error } = await q;
          if (error) throw error;
          for (const row of (tpis ?? [])) {
            const tid = row.tpi_treatment_id != null ? String(row.tpi_treatment_id) : null;
            if (!tid) continue;
            const price = asNumber(row.tpi_price);
            const existing = tpiAgg[tid];
            if (existing) { existing.count += 1; existing.totalRevenue += price; }
            else { tpiAgg[tid] = { count: 1, totalRevenue: price }; }
            if (row.tpi_patient_id != null) tpiPatientSet.add(String(row.tpi_patient_id));
          }
          if (!tpis || tpis.length < PAGE_SIZE) break;
          fromT += PAGE_SIZE;
        }
      } else if (patientIds.length > 0) {
        const CHUNK = 500;
        for (let i = 0; i < patientIds.length; i += CHUNK) {
          const chunk = patientIds.slice(i, i + CHUNK);
          let fromT = 0;
          while (true) {
            let q = (supabase as any)
              .from('treatment_plan_items')
              .select('tpi_treatment_id, tpi_price, tpi_patient_id, location_id')
              .eq('organization_id', organizationId)
              .eq('tpi_completed', true)
              .not('tpi_completed_at', 'is', null)
              .gte('tpi_completed_at', startDateISO)
              .lte('tpi_completed_at', endDateISO)
              .is('deleted_at', null)
              .in('tpi_patient_id', chunk)
              .range(fromT, fromT + PAGE_SIZE - 1);
            // Only apply location filter when a specific location/region is selected.
            if (isFiltered && locationFilter) {
              if (locationFilter.type === 'single') q = q.eq('location_id', locationFilter.ids[0]);
              else q = q.in('location_id', locationFilter.ids);
            }
            const { data: tpis, error } = await q;
            if (error) throw error;
            for (const row of (tpis ?? [])) {
              const tid = row.tpi_treatment_id != null ? String(row.tpi_treatment_id) : null;
              if (!tid) continue;
              const price = asNumber(row.tpi_price);
              const existing = tpiAgg[tid];
              if (existing) { existing.count += 1; existing.totalRevenue += price; }
              else { tpiAgg[tid] = { count: 1, totalRevenue: price }; }
              if (row.tpi_patient_id != null) tpiPatientSet.add(String(row.tpi_patient_id));
            }
            if (!tpis || tpis.length < PAGE_SIZE) break;
            fromT += PAGE_SIZE;
          }
        }
      }

      const memberPatientCount = patientIds.length > 0 ? patientIds.length : tpiPatientSet.size;

      console.log('[useMappedPlanDetail]', {
        mappedPlanId,
        dbPlanName: dbPlan.name,
        ppId: dbPlan.ppId,
        uploadedPatientIds: uploadedPatientIds.size,
        dbPatientIds: dbPatientIds.size,
        tpiSource,
        uniqueTreatments: Object.keys(tpiAgg).length,
        totalTpis: Object.values(tpiAgg).reduce((s, a) => s + a.count, 0),
        memberPatientCount,
      });

      return { dbPlan, tpiAgg, memberPatientCount, tpiSource };
    },
    enabled: !!user?.id && !!organizationId && !!mappedPlanId && (!!locationFilter || !isFiltered),
    staleTime: 5 * 60 * 1000,
  });

  const dbPlan = data?.dbPlan ?? null;
  const tpiAgg = data?.tpiAgg ?? {};
  const memberPatientCount = data?.memberPatientCount ?? 0;

  const treatmentConsumption: TreatmentConsumption[] = useMemo(() => {
    if (!dbPlan) return [];
    const rows: TreatmentConsumption[] = [];

    for (const treatment of dbTreatments) {
      const extId = (treatment as any).external_id;
      if (extId == null) continue;
      const agg = tpiAgg[String(extId)];
      if (!agg || agg.count === 0) continue;

      const treatmentCount = agg.count;
      const revenuePerUnit = agg.totalRevenue / treatmentCount;

      const mat = asNumber((treatment as any).material_cost);
      const lab = asNumber((treatment as any).lab_bill);
      const thr = asNumber((treatment as any).therapist_pay_rate);
      const opCost = asNumber((treatment as any).hourly_rate) * (asNumber((treatment as any).duration_minutes) / 60);
      const assocPay = revenuePerUnit * (asNumber((treatment as any).percent_fees) / 100);
      const finFee = revenuePerUnit * (asNumber((treatment as any).finance_fee) / 100);
      const costPerUnit = mat + lab + thr + opCost + assocPay + finFee;

      const marginPerUnit = revenuePerUnit - costPerUnit;
      const totalMargin = marginPerUnit * treatmentCount;
      const marginPct = revenuePerUnit > 0
        ? (marginPerUnit / revenuePerUnit) * 100
        : (costPerUnit > 0 ? -100 : 0);

      const marginImpact: TreatmentConsumption['marginImpact'] =
        marginPct < 0 ? 'Concern' : marginPct <= 20 ? 'Watch' : 'Healthy';

      const durationPerUnit = asNumber((treatment as any).duration_minutes);

      rows.push({
        treatment: (treatment as any).treatment_name || 'Unnamed',
        treatmentCode: (treatment as any).treatment_code || '',
        categoryName: (treatment as any).category?.name || '',
        plan: dbPlan.name,
        planMembers: memberPatientCount,
        treatmentCount,
        avgUsagePerMember: memberPatientCount > 0 ? +(treatmentCount / memberPatientCount).toFixed(1) : 0,
        costPerUnit: Math.round(costPerUnit * 100) / 100,
        revenuePerUnit: Math.round(revenuePerUnit * 100) / 100,
        marginPerUnit: Math.round(marginPerUnit * 100) / 100,
        totalMargin: Math.round(totalMargin),
        marginPct: Math.round(marginPct),
        marginImpact,
        totalDurationMinutes: Math.round(durationPerUnit * treatmentCount),
        materialCost: Math.round(mat * 100) / 100,
        labBill: Math.round(lab * 100) / 100,
        therapistPay: Math.round(thr * 100) / 100,
        operatingCost: Math.round(opCost * 100) / 100,
        associatePay: Math.round(assocPay * 100) / 100,
        financeFee: Math.round(finFee * 100) / 100,
        durationMinutes: durationPerUnit,
      });
    }

    return rows.sort((a, b) => b.treatmentCount - a.treatmentCount);
  }, [dbTreatments, tpiAgg, memberPatientCount, dbPlan]);

  // Report loading when we have a plan ID but the query hasn't run yet
  // (e.g. waiting for locations or org context to load)
  const pendingDeps = !!mappedPlanId && (!organizationId || (isFiltered && !locationFilter));
  return {
    dbPlan,
    treatmentConsumption,
    memberPatientCount,
    isLoading: isLoading || pendingDeps,
  };
}
