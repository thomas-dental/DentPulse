import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

export interface PaymentPlan {
  id: string;
  organization_id: string;
  location_id: string | null;
  region_id: string | null;
  pp_id: number | null;
  pp_name: string | null;
  pp_is_active: boolean | null;
  pp_dentist_recall_interval: number | null;
  pp_emergency_duration: number | null;
  pp_exam_appointments_included: number | null;
  pp_exam_duration: number | null;
  pp_exam_scale_and_polish_duration: number | null;
  pp_hygiene_appointments_included: number | null;
  pp_hygienist_recall_interval: number | null;
  pp_monthly_memberhsip_fee: number | null;
  pp_patient_friendly_name: string | null;
  pp_recall_method: string | null;
  pp_scale_and_polish_duration: number | null;
  pp_colour: string | null;
  pp_site_id: string | null;
  pp_created_at: string | null;
  user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  /** Dentally site / practice_locations name when resolvable */
  locationName: string | null;
}

export type PaymentPlanQueryOptions = {
  /**
   * `location-usage` (default): when locationId is set, only plans used at that
   * location (or whose location_id matches).
   * `organization`: every org plan, including inactive — used by Setup Categories
   * so the picker can group by Dentally location like the PMS list.
   */
  scope?: 'location-usage' | 'organization';
};

export function usePaymentPlans(
  locationId?: string | null,
  options?: PaymentPlanQueryOptions,
) {
  const { organizationId } = useOrganization();
  const scope = options?.scope ?? 'location-usage';

  const {
    data: paymentPlans = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['payment_plans', organizationId, locationId || 'all', scope],
    queryFn: async () => {
      if (!organizationId) return [];

      const [{ data, error }, { data: locRows }] = await Promise.all([
        (supabase as any)
          .from('payment_plans')
          .select('*')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .order('pp_name'),
        (supabase as any)
          .from('practice_locations')
          .select('id, location_name, api_record_unique_id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null),
      ]);

      if (error) throw error;

      const byLocationId = new Map<string, string>();
      const bySiteId = new Map<string, string>();
      for (const loc of (locRows ?? []) as Array<{
        id: string;
        location_name: string | null;
        api_record_unique_id: string | null;
      }>) {
        const name = String(loc.location_name || '').trim();
        if (!name) continue;
        byLocationId.set(String(loc.id), name);
        const site = String(loc.api_record_unique_id || '').trim();
        if (site) bySiteId.set(site, name);
      }

      const withLocation = ((data ?? []) as PaymentPlan[]).map((p) => {
        const fromFk = p.location_id ? byLocationId.get(String(p.location_id)) : undefined;
        const fromSite = p.pp_site_id ? bySiteId.get(String(p.pp_site_id).trim()) : undefined;
        return {
          ...p,
          locationName: fromFk || fromSite || null,
        };
      });

      if (scope === 'organization' || !locationId) return withLocation;

      // Base: all org plans. Dentally doesn't reliably populate
      // payment_plans.location_id / pp_site_id, so we can't rely on those
      // columns to scope. Instead, when a location is given, collect the
      // distinct payment_plan_ids actually referenced by entities at that
      // location (patients / appointments / treatment_plan_items) and
      // filter to that set plus any plan whose own location_id matches.
      const { data: locRow } = await (supabase as any)
        .from('practice_locations')
        .select('api_record_unique_id')
        .eq('id', locationId)
        .maybeSingle();
      const siteUid: string | null = locRow?.api_record_unique_id ?? null;

      const usedPpIds = new Set<string>();
      const collect = (rows: Array<Record<string, unknown>> | null | undefined, key: string) => {
        for (const r of rows ?? []) {
          const v = r[key];
          if (v !== null && v !== undefined) usedPpIds.add(String(v));
        }
      };

      const orClause = siteUid
        ? `location_id.eq.${locationId},pt_site_id.eq.${siteUid}`
        : `location_id.eq.${locationId}`;

      const [patients, appts, tpis] = await Promise.all([
        (supabase as any)
          .from('patients')
          .select('pt_payment_plan_id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .not('pt_payment_plan_id', 'is', null)
          .or(orClause),
        (supabase as any)
          .from('appointments')
          .select('apmt_payment_plan_id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .not('apmt_payment_plan_id', 'is', null)
          .eq('location_id', locationId),
        (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_payment_plan_id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .not('tpi_payment_plan_id', 'is', null)
          .eq('location_id', locationId),
      ]);

      collect(patients?.data, 'pt_payment_plan_id');
      collect(appts?.data, 'apmt_payment_plan_id');
      collect(tpis?.data, 'tpi_payment_plan_id');

      return withLocation.filter((p) => {
        if (p.location_id && p.location_id === locationId) return true;
        if (p.pp_site_id && siteUid && String(p.pp_site_id) === siteUid) return true;
        if (p.pp_id !== null && p.pp_id !== undefined && usedPpIds.has(String(p.pp_id))) return true;
        return false;
      });
    },
    enabled: !!organizationId,
  });

  const activePaymentPlans = paymentPlans.filter(
    (plan) => plan.pp_is_active === true
  );

  return {
    paymentPlans,
    activePaymentPlans,
    isLoading,
    error,
    refetch,
  };
}
