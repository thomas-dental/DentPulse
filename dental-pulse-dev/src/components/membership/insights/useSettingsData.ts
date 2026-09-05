import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useLocations } from "@/hooks/useLocations";
import { useMembershipUploadData, MONTH_NAMES } from "@/hooks/useMembershipUploadData";
import { useMembershipPlanMappings } from "@/hooks/useMembershipPlanMappings";
import { useConnectedIntegration } from "@/hooks/useConnectedIntegration";

export interface MappedPaymentPlan {
  id: string;
  name: string;
  /** Dentally's own synced value — read-only, shown for context. 0 when
   *  Dentally has nothing configured (common; most practices never set
   *  this in Dentally itself). */
  dentallyExam: number;
  dentallyHygiene: number;
  /** Manually-set override (payment_plans.exams_included_override /
   *  hygiene_included_override) — editable from Settings. null = no
   *  override set, falls back to the Dentally value everywhere it's used. */
  overrideExam: number | null;
  overrideHygiene: number | null;
  /** Manually-set override (payment_plans.xray_included_override) — editable
   *  from Settings. No Dentally-synced counterpart exists for x-ray, so
   *  there's no dentallyXray field to fall back to; null just means no
   *  entitlement set. */
  overrideXray: number | null;
}

export interface PlanMappingRow {
  label: string;
  dentallyPlanNames: string;
  /** e.g. "2 exam, 2 hygiene" — override if set, else Dentally's own
   *  synced value. "—" when unmapped or nothing configured either way. */
  entitlement: string;
  plans: MappedPaymentPlan[];
}

export interface SettingsData {
  isLoading: boolean;
  locationNames: string[];
  isMultiLocation: boolean;
  dentallyConnected: boolean | null;
  practicePlanConnected: boolean;
  /** e.g. "last upload August 2026" — null when no upload yet. */
  practicePlanDetail: string | null;
  accountingConnected: boolean;
  accountingName: string;
  planMappingLabels: string[];
  planMappingMappedCount: number;
  planMappingRows: PlanMappingRow[];
  patientMatchedCount: number;
  patientTotalCount: number;
  patientMatchedPct: number | null;
}

/** Settings tab's real data — org locations, Dentally/accounting connection
 *  status, Plan Mapping coverage (the same table the Plan Mapping dialog on
 *  the Plan Revenue tab writes), and the real patient-match rate from
 *  uploaded membership rows. Cost assumptions (associate share %,
 *  hygienist £/hr) vary per-treatment in this app, not as one org-wide
 *  number, so that section links to Treatment Setup instead of showing an
 *  invented aggregate. */
export function useSettingsData(): SettingsData {
  const { organizationId } = useOrganization();
  const { allAvailableLocations, isLoading: locLoading } = useLocations();
  const { members: uploadedMembers, planSummary: uploadPlanSummary, isLoading: uploadLoading, displayMonth } =
    useMembershipUploadData();
  const { mappings, isLoading: mappingsLoading } = useMembershipPlanMappings();
  const accounting = useConnectedIntegration();

  const dentallyQ = useQuery({
    queryKey: ["insights_dentally_connection", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await (supabase as any)
        .from("platform_integrations")
        .select("is_connected")
        .eq("organization_id", organizationId)
        .ilike("platform_name", "dentally")
        .eq("is_connected", true)
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });

  const planMappingLabels = useMemo(
    () => uploadPlanSummary.filter((p) => p.is_practice_plan).map((p) => p.fee_category),
    [uploadPlanSummary],
  );
  const planMappingMappedCount = useMemo(() => {
    const mappedLabels = new Set(mappings.filter((m) => m.payment_plan_ids.length > 0).map((m) => m.plan_label));
    return planMappingLabels.filter((l) => mappedLabels.has(l)).length;
  }, [planMappingLabels, mappings]);

  // Every Dentally payment plan for the org (including inactive), not just
  // the ones reachable via a Practice Plan statement mapping — so a plan
  // mapped to multiple Dentally ids (e.g. Registration → R&I, Private)
  // resolves both, including historical inactive plans.
  const paymentPlansQ = useQuery({
    queryKey: ["insights_settings_payment_plans_v2", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<Map<string, MappedPaymentPlan>> => {
      const BASE_COLUMNS =
        "id, pp_name, pp_patient_friendly_name, pp_exam_appointments_included, pp_hygiene_appointments_included";
      // exams_included_override/hygiene_included_override (migration
      // 20260813000001) and xray_included_override (migration
      // 20260815000001) may not be applied to this database yet — Postgres
      // rejects the whole select if a requested column doesn't exist, which
      // would otherwise take the plan-name lookup down with it. Try with
      // the override columns first; on a missing-column error, retry
      // without them so names/Dentally values keep working regardless of
      // migration status.
      let data: any[] | null = null;
      let hasOverrideColumns = true;
      const withOverrides = await (supabase as any)
        .from("payment_plans")
        .select(`${BASE_COLUMNS}, exams_included_override, hygiene_included_override, xray_included_override`)
        .eq("organization_id", organizationId)
        .is("deleted_at", null);
      if (withOverrides.error) {
        if (!/column .* does not exist/i.test(withOverrides.error.message ?? "")) throw withOverrides.error;
        hasOverrideColumns = false;
        const fallback = await (supabase as any)
          .from("payment_plans")
          .select(BASE_COLUMNS)
          .eq("organization_id", organizationId)
          .is("deleted_at", null);
        if (fallback.error) throw fallback.error;
        data = fallback.data;
      } else {
        data = withOverrides.data;
      }

      const map = new Map<string, MappedPaymentPlan>();
      for (const p of data ?? []) {
        map.set(p.id, {
          id: p.id,
          name: p.pp_name || p.pp_patient_friendly_name || "Unnamed",
          dentallyExam: Number(p.pp_exam_appointments_included) || 0,
          dentallyHygiene: Number(p.pp_hygiene_appointments_included) || 0,
          overrideExam: !hasOverrideColumns || p.exams_included_override == null ? null : Number(p.exams_included_override),
          overrideHygiene: !hasOverrideColumns || p.hygiene_included_override == null ? null : Number(p.hygiene_included_override),
          overrideXray: !hasOverrideColumns || p.xray_included_override == null ? null : Number(p.xray_included_override),
        });
      }
      return map;
    },
  });

  const planMappingRows: PlanMappingRow[] = useMemo(() => {
    const byLabel = new Map(mappings.map((m) => [m.plan_label, m.payment_plan_ids]));
    return planMappingLabels.map((label) => {
      const planIds = byLabel.get(label) ?? [];
      const plans = planIds.map((id) => paymentPlansQ.data?.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
      if (plans.length === 0) return { label, dentallyPlanNames: "—", entitlement: "—", plans: [] };
      const entitlementParts = plans.map((p) => {
        const exam = p.overrideExam ?? p.dentallyExam;
        const hygiene = p.overrideHygiene ?? p.dentallyHygiene;
        const xray = p.overrideXray ?? 0; // no Dentally-synced value to fall back to
        const parts: string[] = [];
        if (exam > 0) parts.push(`${exam} exam`);
        if (hygiene > 0) parts.push(`${hygiene} hygiene`);
        if (xray > 0) parts.push(`${xray} xray`);
        return parts.length > 0 ? parts.join(", ") : "—";
      });
      return {
        label,
        dentallyPlanNames: plans.map((p) => p.name).join(", "),
        entitlement: entitlementParts.join(" · "),
        plans,
      };
    });
  }, [planMappingLabels, mappings, paymentPlansQ.data]);

  const patientTotalCount = uploadedMembers.length;
  const patientMatchedCount = uploadedMembers.filter((m) => m.patient_id != null).length;

  return {
    isLoading:
      locLoading || uploadLoading || mappingsLoading || dentallyQ.isLoading || accounting.isLoading ||
      paymentPlansQ.isLoading,
    locationNames: allAvailableLocations.map((l) => l.location_name),
    isMultiLocation: allAvailableLocations.length > 1,
    dentallyConnected: dentallyQ.data ?? null,
    practicePlanConnected: uploadedMembers.length > 0,
    practicePlanDetail: displayMonth ? `last upload ${MONTH_NAMES[displayMonth.month - 1]} ${displayMonth.year}` : null,
    accountingConnected: accounting.isConnected,
    accountingName: accounting.displayName,
    planMappingLabels,
    planMappingMappedCount,
    planMappingRows,
    patientMatchedCount,
    patientTotalCount,
    patientMatchedPct: patientTotalCount > 0 ? Math.round((patientMatchedCount / patientTotalCount) * 100) : null,
  };
}
