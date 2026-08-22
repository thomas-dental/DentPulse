import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLocations } from '@/hooks/useLocations';
import { useFilters } from '@/contexts/FilterContext';
import type { PaymentPlan } from '@/hooks/usePaymentPlans';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

export interface MembershipPlanRow {
  planId: string;
  planName: string;
  members: number;
  monthlyRevenue: number;
}

export interface MembershipPlanSummary {
  rows: MembershipPlanRow[];
  totalMembers: number;
  totalMonthlyRevenue: number; // Total of ALL plans (Private + NHS + Membership)
  nhsRevenue: number; // Revenue from NHS plans only
  privateRevenue: number; // Revenue from Private plans only
  membershipOnlyRevenue: number; // Only membership plans (excludes Private and NHS)
  avgMemberValue: number;
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Format a Date to YYYY-MM-DD using local time (avoids UTC timezone shift) */
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

/**
 * Helper function to determine if a payment plan is NHS or Private based on name
 */
function getPaymentPlanType(planName: string | null): 'nhs' | 'private' | 'membership' | null {
  if (!planName) return null;
  const nameLower = planName.toLowerCase();
  if (nameLower.includes('nhs')) return 'nhs';
  if (nameLower.includes('private')) return 'private';
  return 'membership';
}

/**
 * Loads active Membership Plans from Supabase payment_plans table by organization.
 *
 * Revenue = sum of subtotal from platform_integration_invoices within the date range.
 * Invoice queries filter by location_id (RLS handles org-level security).
 * Payment plans, patients, appointments still use org-based filtering via RLS.
 */
export function useMembershipPlanSummary(enabled: boolean = true) {
  const { user } = useAuth();
  const { allAvailableLocations } = useLocations();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();

  // All location IDs the user has access to
  const allLocationIds = useMemo(() => {
    return allAvailableLocations.map(l => l.id);
  }, [allAvailableLocations]);

  // When a region is selected (but no specific location), get location IDs in that region
  const regionLocationIds = useMemo(() => {
    if (!selectedRegionId || selectedLocationId) return null;
    return allAvailableLocations
      .filter(l => l.region_id === selectedRegionId)
      .map(l => l.id);
  }, [selectedRegionId, selectedLocationId, allAvailableLocations]);

  // Determine which location IDs to filter by
  const locationFilter = useMemo(() => {
    if (selectedLocationId) return { type: 'single' as const, ids: [selectedLocationId] };
    if (regionLocationIds && regionLocationIds.length > 0) return { type: 'multi' as const, ids: regionLocationIds };
    if (allLocationIds.length > 0) return { type: 'multi' as const, ids: allLocationIds };
    return null;
  }, [selectedLocationId, regionLocationIds, allLocationIds]);

  const locationKey = locationFilter ? locationFilter.ids.slice().sort().join(',') : 'none';

  // Use local date strings to avoid UTC timezone shift
  const startDateStr = toLocalDateStr(dateRange.startDate);
  const endDateStr = toLocalDateStr(dateRange.endDate);
  // Europe/London day-boundary instants for timestamptz filters. toISOString()
  // on a local-midnight Date only matches the practice day when the browser is
  // in the UK — these are viewer-independent.
  const startDateISO = ukDayStartInstant(dateRange.startDate);
  const endDateISO = ukDayEndInstant(dateRange.endDate);

  return useQuery({
    queryKey: ['membership_plan_summary_v2', locationKey, startDateStr, endDateStr, selectedRegionId],
    enabled: enabled && !!user?.id && !!locationFilter && locationFilter.ids.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MembershipPlanSummary> => {
      if (!locationFilter || locationFilter.ids.length === 0) {
        return { rows: [], totalMembers: 0, totalMonthlyRevenue: 0, nhsRevenue: 0, privateRevenue: 0, membershipOnlyRevenue: 0, avgMemberValue: 0 };
      }

      // Fetch payment plans (RLS handles org access)
      const plansResult = await (supabase as any)
        .from('payment_plans')
        .select('*')
        .is('deleted_at', null)
        .order('pp_name');

      if (plansResult.error) throw plansResult.error;
      const plans = (plansResult.data ?? []) as PaymentPlan[];

      const PAGE_SIZE = 1000;

      // Step 1: Build patient→plan map from patients table (baseline)
      const patientPlanMap = new Map<number, number>();
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from('patients')
          .select('pt_id, pt_payment_plan_id')
          .not('pt_payment_plan_id', 'is', null)
          .is('deleted_at', null)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = (data ?? []) as Array<{ pt_id: number | string | null; pt_payment_plan_id: number | string | null }>;
        for (const patient of rows) {
          const patientId = planIdKey(patient.pt_id);
          const planId = planIdKey(patient.pt_payment_plan_id);
          if (patientId != null && planId != null) {
            patientPlanMap.set(patientId, planId);
          }
        }
        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      // Step 2: Fetch completed appointments — count members AND enrich patient→plan map.
      // Appointments have `apmt_payment_plan_id` which is the most reliable plan assignment.
      // We process appointments BEFORE invoices so the enriched map can be used for revenue mapping.
      const memberCountByPlanId = new Map<number, Set<number>>();
      from = 0;
      hasMore = true;
      while (hasMore) {
        let apmtQuery = (supabase as any)
          .from('appointments')
          .select('apmt_patient_id, apmt_payment_plan_id')
          .eq('apmt_state', 'Completed')
          .gte('apmt_start_time', startDateISO)
          .lte('apmt_start_time', endDateISO)
          .is('deleted_at', null);
        if (locationFilter.type === 'single') apmtQuery = apmtQuery.eq('location_id', locationFilter.ids[0]);
        else apmtQuery = apmtQuery.in('location_id', locationFilter.ids);
        const { data: apmtData, error: apmtError } = await apmtQuery.range(from, from + PAGE_SIZE - 1);
        if (apmtError) throw apmtError;
        const apmtRows = (apmtData ?? []) as Array<{
          apmt_patient_id: number | string | null;
          apmt_payment_plan_id: number | string | null;
        }>;
        for (const apmt of apmtRows) {
          const apmtPatientId = planIdKey(apmt.apmt_patient_id);
          if (apmtPatientId == null) continue;

          let resolvedPlanId = planIdKey(apmt.apmt_payment_plan_id);
          if (resolvedPlanId == null) {
            resolvedPlanId = patientPlanMap.get(apmtPatientId) ?? null;
          }
          if (resolvedPlanId == null) continue;

          // Enrich patientPlanMap with appointment-based plan assignment
          // (appointment plan takes priority over patient table plan)
          if (!patientPlanMap.has(apmtPatientId)) {
            patientPlanMap.set(apmtPatientId, resolvedPlanId);
          }

          if (!memberCountByPlanId.has(resolvedPlanId)) {
            memberCountByPlanId.set(resolvedPlanId, new Set());
          }
          memberCountByPlanId.get(resolvedPlanId)!.add(apmtPatientId);
        }
        hasMore = apmtRows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      // Step 3: Fetch invoices — filter by location_id, RLS handles org security.
      // Dentally sync stores invoice amount in `subtotal` column (not `total_amount`).
      // Revenue per plan is resolved via the enriched patientPlanMap (patients + appointments).
      const invoiceRows: Array<{
        patient_id: string | null;
        subtotal: number | string | null;
        nhs_amount: number | string | null;
      }> = [];
      from = 0;
      hasMore = true;
      while (hasMore) {
        let invoiceQuery = (supabase as any)
          .from('platform_integration_invoices')
          .select('patient_id, subtotal, nhs_amount')
          .gte('invoice_date', startDateStr)
          .lte('invoice_date', endDateStr)
          .is('deleted_at', null);

        if (locationFilter.type === 'single') {
          invoiceQuery = invoiceQuery.eq('location_id', locationFilter.ids[0]);
        } else {
          invoiceQuery = invoiceQuery.in('location_id', locationFilter.ids);
        }

        const { data, error } = await invoiceQuery.range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = (data ?? []) as typeof invoiceRows;
        invoiceRows.push(...rows);
        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      // Step 4: Sum revenue per payment plan from invoices using enriched patientPlanMap
      const revenueByPlanId = new Map<number, number>();
      let totalAllInvoiceRevenue = 0;
      let totalNhsFromInvoices = 0;
      for (const inv of invoiceRows) {
        const totalAmount = asNumber(inv.subtotal);
        const nhsAmount = asNumber(inv.nhs_amount);
        totalAllInvoiceRevenue += totalAmount;
        totalNhsFromInvoices += nhsAmount;

        const patientId = inv.patient_id != null ? Number(inv.patient_id) : NaN;
        if (Number.isFinite(patientId)) {
          const resolvedPlanId = patientPlanMap.get(patientId) ?? null;
          if (resolvedPlanId != null) {
            revenueByPlanId.set(resolvedPlanId, (revenueByPlanId.get(resolvedPlanId) ?? 0) + totalAmount);
          }
        }
      }

      // Build rows
      const rows: MembershipPlanRow[] = plans.map((plan) => {
        const ppId = planIdKey(plan.pp_id);
        const memberSet = ppId == null ? new Set<number>() : (memberCountByPlanId.get(ppId) ?? new Set());
        const members = memberSet.size;
        const monthlyRevenue = ppId == null ? 0 : (revenueByPlanId.get(ppId) ?? 0);
        const planName = plan.pp_name || plan.pp_patient_friendly_name || (ppId != null ? `Plan ${String(ppId)}` : 'Unnamed plan');
        return {
          planId: plan.id,
          planName,
          members,
          monthlyRevenue,
        };
      });

      const totalMembers = rows.reduce((sum, r) => sum + r.members, 0);
      const totalMonthlyRevenue = totalAllInvoiceRevenue;

      const membershipOnlyRevenue = rows.reduce((sum, r) => {
        const plan = plans.find(p => p.id === r.planId);
        const planType = plan ? getPaymentPlanType(plan.pp_name) : 'membership';
        if (planType === 'membership') {
          return sum + r.monthlyRevenue;
        }
        return sum;
      }, 0);

      const nhsRevenue = totalNhsFromInvoices;
      const privateRevenue = Math.max(0, totalMonthlyRevenue - membershipOnlyRevenue - nhsRevenue);
      const avgMemberValue = totalMembers > 0 ? totalMonthlyRevenue / totalMembers : 0;

      return {
        rows,
        totalMembers,
        totalMonthlyRevenue,
        nhsRevenue,
        privateRevenue,
        membershipOnlyRevenue,
        avgMemberValue,
      };
    },
  });
}
