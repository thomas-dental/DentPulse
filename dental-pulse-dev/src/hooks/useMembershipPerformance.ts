import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLocations } from '@/hooks/useLocations';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useTreatments } from '@/hooks/useTreatments';
import { useCostImpactData } from '@/hooks/useCostImpactData';
import { useMembershipThresholds, getStatusFromMargin } from '@/hooks/useMembershipThresholds';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

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

function planIdKey(id: number | string | null | undefined): number | null {
  if (id == null) return null;
  const n = typeof id === 'number' ? id : Number(id);
  return Number.isFinite(n) ? n : null;
}

export interface PlanOverview {
  planId: string;
  planName: string;
  color: string;
  members: number;
  avgTenureMonths: number;
  revenuePerMonth: number;
  costsPerMonth: number;
  netProfit: number;
  netProfitPct: number;
  utilisation: number;
  monthlyFee: number;
  status: 'Profitable' | 'At Risk' | 'Loss-Making';
}

export interface RevenueCostBreakdown {
  plan: string;
  subscriptionFees: number;
  addOns: number;
  includedTreatments: number;
  discountedTreatments: number;
  hygieneTime: number;
  labMaterials: number;
  overhead: number;
}

export interface TreatmentConsumption {
  treatment: string;
  treatmentCode: string;
  categoryName: string;
  plan: string;
  planMembers: number;
  treatmentCount: number;
  avgUsagePerMember: number;
  costPerUnit: number;
  revenuePerUnit: number;
  marginPerUnit: number;
  totalMargin: number;
  marginPct: number;
  marginImpact: 'Healthy' | 'Watch' | 'Concern';
  totalDurationMinutes: number;
  // Individual cost components per unit
  materialCost: number;
  labBill: number;
  therapistPay: number;
  operatingCost: number;
  associatePay: number;
  financeFee: number;
  durationMinutes: number;
}

export interface RiskSignal {
  planName: string;
  color: string;
  severity: 'Critical' | 'Warning' | 'Info';
  items: string[];
}

export interface MembershipSummary {
  totalMembers: number;
  monthlyRevenue: number;
  monthlyCosts: number;
  netProfit: number;
  avgMarginPct: number;
  membersTrend: number;
  revenueTrend: number;
  costsTrend: number;
}

const PAGE_SIZE = 1000;

export function useMembershipPerformance() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const { allAvailableLocations } = useLocations();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();
  const { treatments: dbTreatments } = useTreatments();
  const thresholds = useMembershipThresholds();

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
  // Europe/London day-boundary instants — viewer-independent, unlike
  // toISOString() on local-midnight Dates (wrong outside UK browsers).
  const startDateISO = ukDayStartInstant(dateRange.startDate);
  const endDateISO = ukDayEndInstant(dateRange.endDate);

  const { data, isLoading } = useQuery({
    queryKey: ['membership_performance_v2', organizationId, locationKey, startDateStr, endDateStr, thresholds.profitableMin, thresholds.atRiskMin],
    queryFn: async () => {
      if (!locationFilter || locationFilter.ids.length === 0 || !organizationId) {
        return {
          plans: [] as PlanOverview[],
          planRevenueCost: [] as RevenueCostBreakdown[],
          tpiAgg: {} as Record<string, { count: number; totalRevenue: number }>,
          planNames: {} as Record<string, string>,
          planMemberCounts: {} as Record<string, number>,
          tpiRowsForCost: [] as Array<{ ppid: number | null; tid: number; price: number }>,
        };
      }

      // Helper: paginated fetch
      async function fetchAllPages<T>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
        const allRows: T[] = [];
        let from = 0;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
          if (error) throw error;
          const rows = (data ?? []) as T[];
          allRows.push(...rows);
          hasMore = rows.length === PAGE_SIZE;
          from += PAGE_SIZE;
        }
        return allRows;
      }

      // ── All fetches in parallel (single Promise.all) ──
      const [plansData, patientsData, appointmentsData, invoicesData, tpisData] = await Promise.all([
        // Step 1: Payment plans
        (supabase as any)
          .from('payment_plans')
          .select('id, pp_id, pp_name, pp_monthly_memberhsip_fee, pp_colour, pp_exam_appointments_included, pp_hygiene_appointments_included, pp_patient_friendly_name, pp_is_active')
          .is('deleted_at', null)
          .order('pp_name')
          .then(({ data, error }: any) => { if (error) throw error; return data ?? []; }),

        // Step 2: Patient → plan map
        fetchAllPages<{ pt_id: number | string | null; pt_payment_plan_id: number | string | null }>(
          (from, to) => (supabase as any)
            .from('patients')
            .select('pt_id, pt_payment_plan_id')
            .eq('organization_id', organizationId)
            .not('pt_payment_plan_id', 'is', null)
            .is('deleted_at', null)
            .range(from, to)
        ),

        // Step 3: Appointments
        fetchAllPages<{ apmt_patient_id: number | string | null; apmt_payment_plan_id: number | string | null }>(
          (from, to) => {
            let q = (supabase as any)
              .from('appointments')
              .select('apmt_patient_id, apmt_payment_plan_id')
              .eq('apmt_state', 'Completed')
              .gte('apmt_start_time', startDateISO)
              .lte('apmt_start_time', endDateISO)
              .is('deleted_at', null);
            if (locationFilter.type === 'single') q = q.eq('location_id', locationFilter.ids[0]);
            else q = q.in('location_id', locationFilter.ids);
            return q.range(from, to);
          }
        ),

        // Step 4: Invoices
        fetchAllPages<{ patient_id: string | null; subtotal: number | string | null }>(
          (from, to) => {
            let q = (supabase as any)
              .from('platform_integration_invoices')
              .select('patient_id, subtotal')
              .gte('invoice_date', startDateStr)
              .lte('invoice_date', endDateStr)
              .is('deleted_at', null);
            if (locationFilter.type === 'single') q = q.eq('location_id', locationFilter.ids[0]);
            else q = q.in('location_id', locationFilter.ids);
            return q.range(from, to);
          }
        ),

        // Step 5: Treatment Plan Items
        fetchAllPages<{
          tpi_payment_plan_id: number | string | null;
          tpi_patient_id: number | string | null;
          tpi_treatment_id: number | string | null;
          tpi_price: number | string | null;
          location_id: string | null;
        }>(
          (from, to) => (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_payment_plan_id, tpi_patient_id, tpi_treatment_id, tpi_price, location_id')
            .eq('organization_id', organizationId)
            .eq('tpi_completed', true)
            .not('tpi_completed_at', 'is', null)
            .gte('tpi_completed_at', startDateISO)
            .lte('tpi_completed_at', endDateISO)
            .is('deleted_at', null)
            .range(from, to)
        ),
      ]);

      const plans = plansData as Array<{
        id: string;
        pp_id: number | null;
        pp_name: string | null;
        pp_monthly_memberhsip_fee: number | null;
        pp_colour: string | null;
        pp_exam_appointments_included: number | null;
        pp_hygiene_appointments_included: number | null;
        pp_patient_friendly_name: string | null;
      }>;

      // Process patients → plan map
      const patientPlanMap = new Map<number, number>();
      for (const p of patientsData) {
        const pid = planIdKey(p.pt_id);
        const ppid = planIdKey(p.pt_payment_plan_id);
        if (pid != null && ppid != null) patientPlanMap.set(pid, ppid);
      }

      // Process appointments → member counts + location patient IDs
      const membersByPlan = new Map<number, Set<number>>();
      const locationPatientIds = new Set<number>();
      for (const a of appointmentsData) {
        const patientId = planIdKey(a.apmt_patient_id);
        if (patientId == null) continue;
        locationPatientIds.add(patientId);
        const ppid = planIdKey(a.apmt_payment_plan_id) ?? patientPlanMap.get(patientId) ?? null;
        if (ppid == null) continue;
        if (!patientPlanMap.has(patientId)) patientPlanMap.set(patientId, ppid);
        if (!membersByPlan.has(ppid)) membersByPlan.set(ppid, new Set());
        membersByPlan.get(ppid)!.add(patientId);
      }

      // Process invoices → revenue per plan
      const revenueByPlan = new Map<number, number>();
      for (const inv of invoicesData) {
        const patientId = inv.patient_id != null ? Number(inv.patient_id) : NaN;
        if (!Number.isFinite(patientId)) continue;
        const ppid = patientPlanMap.get(patientId);
        if (ppid != null) {
          revenueByPlan.set(ppid, (revenueByPlan.get(ppid) || 0) + asNumber(inv.subtotal));
        }
      }

      // Process TPIs → aggregate by plan + treatment
      const tpiByPlanTreatment = new Map<string, { count: number; totalRevenue: number }>();
      const tpiRevenueByPlan = new Map<number, number>();
      const tpiPatientsByPlan = new Map<number, Set<number>>();
      // Every delivered TPI in scope, plan or not (ppid null = not attributed
      // to a membership plan) — feeds the real Xero-allocated cost split
      // below. Kept slim (just the 3 fields the cost formula needs) since
      // Maps/large objects don't survive React Query structuralSharing well.
      const tpiRowsForCost: Array<{ ppid: number | null; tid: number; price: number }> = [];
      for (const row of tpisData) {
        const patientId = planIdKey(row.tpi_patient_id);
        const tpiAtLocation = row.location_id != null
          ? locationFilter.ids.includes(row.location_id)
          : (patientId != null && locationPatientIds.has(patientId));
        if (!tpiAtLocation) continue;

        const ppid = planIdKey(row.tpi_payment_plan_id);
        const tid = planIdKey(row.tpi_treatment_id);
        const price = asNumber(row.tpi_price);
        if (tid != null) tpiRowsForCost.push({ ppid, tid, price });

        if (ppid == null || tid == null) continue;
        const key = `${ppid}::${tid}`;
        const existing = tpiByPlanTreatment.get(key);
        if (existing) {
          existing.count += 1;
          existing.totalRevenue += price;
        } else {
          tpiByPlanTreatment.set(key, { count: 1, totalRevenue: price });
        }
        tpiRevenueByPlan.set(ppid, (tpiRevenueByPlan.get(ppid) || 0) + price);
        if (patientId != null) {
          if (!tpiPatientsByPlan.has(ppid)) tpiPatientsByPlan.set(ppid, new Set());
          tpiPatientsByPlan.get(ppid)!.add(patientId);
        }
      }

      // Step 6: Build plan overview
      // Filter to membership-type plans (exclude NHS/Private)
      const membershipPlans = plans.filter(p => {
        const name = (p.pp_name || '').toLowerCase();
        return !name.includes('nhs') && !name.includes('private');
      });

      const planOverviews: PlanOverview[] = membershipPlans.map(plan => {
        const ppid = planIdKey(plan.pp_id);
        // Use TPI patient count (matches Dentally's Practitioner Activity "X Patients"),
        // fall back to appointment-based count when no TPIs exist for a plan.
        const appointmentMembers = ppid != null ? (membersByPlan.get(ppid) ?? new Set<number>()) : new Set<number>();
        const tpiMembers = ppid != null ? (tpiPatientsByPlan.get(ppid) ?? new Set<number>()) : new Set<number>();
        const members = tpiMembers.size > 0 ? tpiMembers.size : appointmentMembers.size;

        // Revenue: use TPI prices (matches Dentally's Practitioner Activity),
        // fall back to invoice revenue, then subscription revenue
        const tpiRevenue = ppid != null ? (tpiRevenueByPlan.get(ppid) ?? 0) : 0;
        const invoiceRevenue = ppid != null ? (revenueByPlan.get(ppid) ?? 0) : 0;
        const monthlyFee = asNumber(plan.pp_monthly_memberhsip_fee);
        const subscriptionRevenue = members * monthlyFee;

        // Estimate costs based on member count and included treatments
        const examsIncluded = asNumber(plan.pp_exam_appointments_included) || 2;
        const hygieneIncluded = asNumber(plan.pp_hygiene_appointments_included) || 2;
        const estimatedCosts = members > 0
          ? members * ((examsIncluded * 12 / 12) + (hygieneIncluded * 28 / 12) + 15) // exam + hygiene + overhead per member/month
          : 0;

        const revenuePerMonth = tpiRevenue > 0 ? tpiRevenue : (invoiceRevenue > 0 ? invoiceRevenue : subscriptionRevenue);
        const costsPerMonth = Math.round(estimatedCosts);
        const netProfit = revenuePerMonth - costsPerMonth;
        const netProfitPct = revenuePerMonth > 0 ? (netProfit / revenuePerMonth) * 100 : 0;

        // Utilisation: ratio of actual cost to subscription revenue
        const utilisation = subscriptionRevenue > 0
          ? Math.min(100, Math.round((estimatedCosts / subscriptionRevenue) * 100))
          : 0;

        const status = getStatusFromMargin(netProfitPct, thresholds);

        return {
          planId: plan.id,
          planName: plan.pp_name || plan.pp_patient_friendly_name || 'Unnamed',
          color: plan.pp_colour || '#14b8a6',
          members,
          avgTenureMonths: Math.round(8 + Math.random() * 14), // placeholder
          revenuePerMonth: Math.round(revenuePerMonth),
          costsPerMonth,
          netProfit: Math.round(netProfit),
          netProfitPct: Math.round(netProfitPct),
          utilisation,
          monthlyFee,
          status,
        };
      });

      // Revenue vs Cost breakdown per plan — only plans with actual data
      // Costs are NEGATIVE (extend left), Revenue is POSITIVE (extend right)
      const planRevenueCost: RevenueCostBreakdown[] = planOverviews.filter(p => p.members > 0 || p.revenuePerMonth > 0 || p.costsPerMonth > 0).map(p => {
        const subFees = p.members * p.monthlyFee;
        const addOns = Math.max(0, p.revenuePerMonth - subFees);
        const totalCost = p.costsPerMonth;
        return {
          plan: p.planName,
          subscriptionFees: Math.round(subFees),
          addOns: Math.round(addOns),
          includedTreatments: -Math.round(totalCost * 0.4),
          discountedTreatments: -Math.round(totalCost * 0.2),
          hygieneTime: -Math.round(totalCost * 0.15),
          labMaterials: -Math.round(totalCost * 0.15),
          overhead: -Math.round(totalCost * 0.1),
        };
      });

      // Build pp_id → plan name and member count as plain objects (Maps don't survive React Query structuralSharing)
      const planNames: Record<string, string> = {};
      const planMemberCounts: Record<string, number> = {};
      for (const plan of membershipPlans) {
        const ppid = planIdKey(plan.pp_id);
        if (ppid != null) {
          planNames[String(ppid)] = plan.pp_name || plan.pp_patient_friendly_name || 'Unnamed';
          const aMembers = membersByPlan.get(ppid) ?? new Set<number>();
          const tMembers = tpiPatientsByPlan.get(ppid) ?? new Set<number>();
          planMemberCounts[String(ppid)] = tMembers.size > 0 ? tMembers.size : aMembers.size;
        }
      }

      // Convert TPI Map to plain object (Maps don't survive React Query structuralSharing)
      const tpiAgg: Record<string, { count: number; totalRevenue: number }> = {};
      for (const [key, val] of tpiByPlanTreatment.entries()) {
        tpiAgg[key] = val;
      }

      return { plans: planOverviews, planRevenueCost, tpiAgg, planNames, planMemberCounts, tpiRowsForCost };
    },
    enabled: !!user?.id && !!organizationId && !!locationFilter && locationFilter.ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Derived summary
  const planOverviews = data?.plans ?? [];
  const planRevenueCost = data?.planRevenueCost ?? [];
  const tpiAgg = data?.tpiAgg ?? {};
  const planNames = data?.planNames ?? {};
  const planMemberCounts = data?.planMemberCounts ?? {};
  const tpiRowsForCost = data?.tpiRowsForCost ?? [];

  // Real cost-to-serve (2026-08-14, client request — see useCliniciansData.ts
  // for the identical rationale/methodology, ported here): real accounting
  // spend from Cost Impact (material/lab/clinician/overhead), allocated
  // across plans by their SHARE of total delivered-treatment activity in
  // each bucket — NOT the treatments catalog's own £ figures directly, only
  // as relative WEIGHTS to split the real spend. Same scope as this hook's
  // own dateRange/location filter (useCostImpactData reads the same
  // useFilters()), so cost and revenue always describe the same period/site.
  const costImpactQ = useCostImpactData();

  const costFieldsByExternalId = useMemo(() => {
    const map = new Map<
      string,
      { material: number; lab: number; therapist: number; hourlyRate: number; durationMin: number; percentFees: number; financeFee: number }
    >();
    for (const t of dbTreatments) {
      if (t.external_id == null) continue;
      map.set(String(t.external_id), {
        material: asNumber(t.material_cost),
        lab: asNumber(t.lab_bill),
        therapist: asNumber(t.therapist_pay_rate),
        hourlyRate: asNumber(t.hourly_rate),
        durationMin: asNumber(t.duration_minutes),
        percentFees: asNumber(t.percent_fees),
        financeFee: asNumber(t.finance_fee),
      });
    }
    return map;
  }, [dbTreatments]);

  type BucketWeights = { material: number; lab: number; clinician: number; overhead: number };
  const emptyBucketWeights = (): BucketWeights => ({ material: 0, lab: 0, clinician: 0, overhead: 0 });

  const { totalWeights, weightsByPlanId } = useMemo(() => {
    const totalWeights = emptyBucketWeights();
    const weightsByPlanId = new Map<number, BucketWeights>();
    for (const row of tpiRowsForCost) {
      const t = costFieldsByExternalId.get(String(row.tid));
      if (!t) continue;
      const w: BucketWeights = {
        material: t.material,
        lab: t.lab,
        clinician: t.therapist + (row.price * t.percentFees) / 100,
        overhead: t.hourlyRate * (t.durationMin / 60) + (row.price * t.financeFee) / 100,
      };
      (Object.keys(w) as (keyof BucketWeights)[]).forEach((k) => { totalWeights[k] += w[k]; });
      if (row.ppid != null) {
        const cur = weightsByPlanId.get(row.ppid) ?? emptyBucketWeights();
        (Object.keys(w) as (keyof BucketWeights)[]).forEach((k) => { cur[k] += w[k]; });
        weightsByPlanId.set(row.ppid, cur);
      }
    }
    return { totalWeights, weightsByPlanId };
  }, [tpiRowsForCost, costFieldsByExternalId]);


  // Treatment consumption table — show ALL treatments, with TPI data where available
  const treatmentConsumption: TreatmentConsumption[] = useMemo(() => {
    const rows: TreatmentConsumption[] = [];
    // Get plans that have members
    const plansWithMembers: Array<{ ppid: string; planName: string; members: number }> = [];
    for (const [ppid, planName] of Object.entries(planNames)) {
      const members = planMemberCounts[ppid] ?? 0;
      if (members > 0) plansWithMembers.push({ ppid, planName, members });
    }
    if (plansWithMembers.length === 0) return rows;

    const tpiKeyCount = Object.keys(tpiAgg).length;
    if (tpiKeyCount > 0) {
      const tpiPpids = new Set<string>();
      for (const key of Object.keys(tpiAgg)) {
        tpiPpids.add(key.split('::')[0]);
      }
      console.log('[MembershipPerf] TPI plan ppids:', Array.from(tpiPpids));
      console.log('[MembershipPerf] Membership plan ppids:', plansWithMembers.map(p => p.ppid));
      console.log('[MembershipPerf] TPI entries:', tpiKeyCount);
      console.log('[MembershipPerf] Sample TPI keys:', Object.keys(tpiAgg).slice(0, 3));
    }

    for (const treatment of dbTreatments) {
      const extId = treatment.external_id;
      const treatmentName = treatment.treatment_name || 'Unnamed';
      const treatmentCode = treatment.treatment_code || '';
      const categoryName = treatment.category?.name || '';

      for (const { ppid, planName, members } of plansWithMembers) {
        // Look up TPI data for this plan + treatment combo
        const tpiKey = extId != null ? `${ppid}::${extId}` : null;
        const agg = tpiKey ? tpiAgg[tpiKey] : undefined;

        const treatmentCount = agg?.count ?? 0;
        const avgUsagePerMember = members > 0 ? +(treatmentCount / members).toFixed(1) : 0;
        const revenuePerUnit = treatmentCount > 0 ? (agg!.totalRevenue / treatmentCount) : 0;

        // Calculate cost per unit — matches TreatmentProfitabilityTab formula
        const mat = asNumber(treatment.material_cost);
        const lab = asNumber(treatment.lab_bill);
        const thr = asNumber(treatment.therapist_pay_rate);
        const opCost = asNumber(treatment.hourly_rate) * (asNumber(treatment.duration_minutes) / 60);
        const assocPay = revenuePerUnit * (asNumber(treatment.percent_fees) / 100);
        const finFee = revenuePerUnit * (asNumber(treatment.finance_fee) / 100);
        const costPerUnit = mat + lab + thr + opCost + assocPay + finFee;

        const marginPerUnit = revenuePerUnit - costPerUnit;
        const totalMargin = marginPerUnit * treatmentCount;
        // Margin % = (Margin per unit ÷ Revenue per unit) × 100
        const marginPct = revenuePerUnit > 0
          ? (marginPerUnit / revenuePerUnit) * 100
          : costPerUnit > 0 ? -100 : 0;

        // Margin % < 0 → Concern, 0–20% → Watch, > 20% → Healthy
        const marginImpact: TreatmentConsumption['marginImpact'] =
          marginPct < 0 ? 'Concern' : marginPct <= 20 ? 'Watch' : 'Healthy';

        const durationPerUnit = asNumber(treatment.duration_minutes);

        rows.push({
          treatment: treatmentName,
          treatmentCode,
          categoryName,
          plan: planName,
          planMembers: members,
          treatmentCount,
          avgUsagePerMember,
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
    }
    return rows;
  }, [dbTreatments, tpiAgg, planNames, planMemberCounts]);

  // Real cost per plan: real Cost Impact £ spend (material/lab/clinician/
  // overhead), allocated to each plan by its share of total delivered-
  // treatment WEIGHT in each bucket (weightsByPlanId ÷ totalWeights) — see
  // the costImpactQ/weightsByPlanId block above. Replaced 2026-08-14 — this
  // previously summed treatmentConsumption's revenuePerUnit × treatmentCount,
  // i.e. total delivered-treatment PRICE mislabelled as cost (confirmed bug,
  // produced £0 Monthly Costs / 100% margin whenever no TPI activity existed
  // — the wrong number, not just an empty one). Null-safe: 0 (not fabricated
  // higher) when Cost Impact has no accounting platform connected for this
  // scope (hasGLData false) — see hasCostData below, surfaced in the UI
  // rather than silently presented as a real zero-cost month.
  const hasCostData = costImpactQ.data?.hasGLData ?? false;
  const planOverviewsWithCost: PlanOverview[] = useMemo(() => {
    const nameToPpid = new Map<string, number>(
      Object.entries(planNames).map(([ppidStr, name]) => [name, Number(ppidStr)]),
    );
    const spend: BucketWeights = hasCostData
      ? {
          material: costImpactQ.data!.materialCostCost,
          lab: costImpactQ.data!.labFeesCost,
          clinician: costImpactQ.data!.clinicianCostCost,
          overhead: costImpactQ.data!.overheadCostCost,
        }
      : emptyBucketWeights();

    return planOverviews.map(plan => {
      const ppid = nameToPpid.get(plan.planName);
      const planWeights = ppid != null ? weightsByPlanId.get(ppid) : undefined;
      let actualCost = 0;
      if (hasCostData && planWeights) {
        (Object.keys(spend) as (keyof BucketWeights)[]).forEach((bucket) => {
          if (totalWeights[bucket] > 0) actualCost += (planWeights[bucket] / totalWeights[bucket]) * spend[bucket];
        });
      }
      const costsPerMonth = Math.round(actualCost);
      const netProfit = plan.revenuePerMonth - costsPerMonth;
      const netProfitPct = plan.revenuePerMonth > 0 ? (netProfit / plan.revenuePerMonth) * 100 : 0;
      const subscriptionRevenue = plan.members * plan.monthlyFee;
      const utilisation = subscriptionRevenue > 0
        ? Math.min(100, Math.round((actualCost / subscriptionRevenue) * 100))
        : 0;
      const status = getStatusFromMargin(netProfitPct, thresholds);

      return {
        ...plan,
        costsPerMonth,
        netProfit: Math.round(netProfit),
        netProfitPct: Math.round(netProfitPct),
        utilisation,
        status,
      };
    });
  }, [planOverviews, planNames, thresholds, hasCostData, costImpactQ.data, weightsByPlanId, totalWeights]);

  // Risk signals
  const riskSignals: RiskSignal[] = useMemo(() => {
    const signals: RiskSignal[] = [];
    for (const plan of planOverviewsWithCost) {
      const items: string[] = [];
      if (plan.status === 'Loss-Making') {
        items.push(`Net margin dropped to ${plan.netProfitPct}%`);
      }
      if (plan.utilisation >= 90) {
        items.push(`Utilisation at ${plan.utilisation}% — capacity risk`);
      } else if (plan.utilisation >= 80) {
        items.push(`Utilisation at ${plan.utilisation}% — approaching threshold`);
      }
      if (plan.netProfitPct < 0) {
        const loss = Math.abs(plan.netProfit);
        items.push(`Plan is subsidising £${Math.round(loss / Math.max(1, plan.members))}/month per member`);
      }
      if (items.length > 0) {
        signals.push({
          planName: plan.planName,
          color: plan.color,
          severity: plan.status === 'Loss-Making' ? 'Critical' : 'Warning',
          items,
        });
      }
    }
    // Sort critical first
    signals.sort((a, b) => (a.severity === 'Critical' ? -1 : 1) - (b.severity === 'Critical' ? -1 : 1));
    return signals;
  }, [planOverviewsWithCost]);

  // Summary using actual costs
  const summaryWithCost: MembershipSummary = useMemo(() => {
    const totalMembers = planOverviewsWithCost.reduce((s, p) => s + p.members, 0);
    const monthlyRevenue = planOverviewsWithCost.reduce((s, p) => s + p.revenuePerMonth, 0);
    const monthlyCosts = planOverviewsWithCost.reduce((s, p) => s + p.costsPerMonth, 0);
    const netProfit = monthlyRevenue - monthlyCosts;
    const avgMarginPct = monthlyRevenue > 0 ? (netProfit / monthlyRevenue) * 100 : 0;
    return {
      totalMembers,
      monthlyRevenue: Math.round(monthlyRevenue),
      monthlyCosts: Math.round(monthlyCosts),
      netProfit: Math.round(netProfit),
      avgMarginPct: Math.round(avgMarginPct),
      membersTrend: 0,
      revenueTrend: 0,
      costsTrend: 0,
    };
  }, [planOverviewsWithCost]);

  return {
    summary: summaryWithCost,
    planOverviews: planOverviewsWithCost,
    planRevenueCost,
    treatmentConsumption,
    riskSignals,
    isLoading: isLoading || costImpactQ.isLoading,
    /** False when no accounting platform is connected for the current scope
     *  — costsPerMonth/netProfit/utilisation/status are all 0-cost in that
     *  case (never a fabricated positive number), so any consumer showing
     *  these should surface this flag rather than presenting £0 costs as if
     *  they were real. */
    hasCostData,
  };
}
