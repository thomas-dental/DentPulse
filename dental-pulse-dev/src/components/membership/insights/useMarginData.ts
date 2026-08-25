import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useFilters } from "@/contexts/FilterContext";
import { useMembershipUploadData } from "@/hooks/useMembershipUploadData";
import { useMembershipStatementInsights } from "@/hooks/useMembershipStatementInsights";
import { useTreatments } from "@/hooks/useTreatments";
import { useAllProvidersWorkingHours } from "@/hooks/useAllProvidersWorkingHours";
import { fetchAllProvidersNetProduction } from "@/hooks/useAllProvidersNetProduction";
import { fetchApptDurationByTa } from "@/hooks/useChairEfficiencyEngine";
import { useMembershipTreatmentSettings, type MembershipTreatmentSetting } from "@/hooks/useMembershipTreatmentSettings";
import { computePayBand, getEffectivePerHourRate } from "@/lib/payslipCalculations";
import type { SlidingScaleBand } from "@/hooks/useSlidingScales";
import { ukDayStartInstant, ukDayEndInstant } from "@/utils/dateRangeUtils";
import { classifyVisitType } from "@/lib/visitTypeClassification";
import { nn, gbp } from "./format";
import type { CalcRow } from "./LedgerLabel";

export interface MarginSiteRow {
  locationId: string;
  name: string;
  netCash: number;
  costToServe: number;
  contribution: number;
  marginPct: number | null;
  verdict: "earning" | "destroying" | null;
}

export interface MarginLedgerRow {
  label: string;
  amount: number;
  isTotal?: boolean;
  isNegative?: boolean;
  /** The live, real numbers this figure is built from, as calculation rows
   *  (not prose) — shown behind the ⓘ as a small worked sum: visits, minutes,
   *  rate, total. Every value is real for the displayed month, not a
   *  description of the method. */
  calc?: CalcRow[];
}

export interface MarginDistBucket {
  label: string;
  count: number;
}

/** One real delivered treatment behind the Cost to Serve ledger — the row
 *  level a client can check by hand against Dentally and Treatment Setup. */
export interface MarginLineItem {
  patientName: string;
  /** The delivering provider's real name (providers.name) — who actually
   *  saw this patient, not just the pay method that priced them. */
  providerName: string;
  treatmentName: string;
  /** tpi_completed_at, as returned by Supabase (ISO timestamp or null). */
  date: string | null;
  /** Which ledger line this row's labour cost/minutes count against. */
  type: "clinician" | "hygiene";
  /** Real appointment-window minutes when available, else the Treatment
   *  Setup catalog's own duration_minutes — same rule as the ledger hours. */
  durationMin: number;
  /** Where durationMin came from — "real" (Dentally's own appointment
   *  start→finish/duration), "catalog" (Treatment Setup's duration_minutes,
   *  used because the appointment itself had none recorded), or "none"
   *  (neither had a value — this treatment's cost still counts above, but
   *  it contributes 0 minutes to the hrs figure, which can make genuinely
   *  real hours look lower than expected). */
  durationSource: "real" | "catalog" | "none";
  /** How this visit's labourCost was priced — the delivering provider's own
   *  current Split Configuration (per-hour/flat-percentage/sliding-scale/
   *  per-case), or "fallback" to Treatment Setup's generic per-treatment
   *  rate when that provider has nothing configured at all. */
  payMethod: "per-hour" | "flat-percentage" | "sliding-scale" | "per-case" | "fallback";
  labourCost: number;
  materialsLabCost: number;
  overheadCost: number;
  totalCost: number;
}

export interface MarginData {
  isLoading: boolean;
  hasUploadData: boolean;
  totalRevenue: number;
  totalCosts: number;
  contribution: number;
  contributionPct: number | null;
  bySite: MarginSiteRow[];
  cashReceivedLedger: MarginLedgerRow[];
  costToServeLedger: MarginLedgerRow[];
  /** Row-level detail behind costToServeLedger — every delivered treatment
   *  this month for these matched members, real enough to re-sum by hand
   *  and match the four ledger totals above. */
  costToServeLineItems: MarginLineItem[];
  /** Real logged hours for every hygienist this month, whole practice, all
   *  patients (Providers > Hygienist > Working Hours) — shown next to the
   *  plan-member-scoped Hygiene time hrs so the client can place one inside
   *  the other. null while still loading. */
  totalPracticeHygieneHours: number | null;
  distribution: MarginDistBucket[];
  /** Every matched member with a resolved Dentally patient link — including
   *  members with no delivered treatment this month, whose margin is their
   *  full fee (cost = £0), not just members who had a costed appointment. */
  costedMemberCount: number;
  totalMatchedMembers: number;
  /** Real fee-per-item discount given up on matched plan members' delivered
   *  treatments (treatments.price − what was actually recorded, floored at
   *  0) — the private-fee-per-item baseline this app does have, via the
   *  Treatment Setup catalog. */
  discountForgone: number;
  /** Live calculation rows for discountForgone's ⓘ — real counts, not prose. */
  discountForgoneCalc: CalcRow[];
  /** Chair-hours spent on matched members' delivered treatments this month,
   *  valued at the non-plan patient cohort's own real private £/hour —
   *  "what those hours would've yielded from a private patient instead". */
  chairTimeDisplaced: number;
  chairTimeDisplacedCalc: CalcRow[];
  /** Matched members who redeemed none of their hygiene, exam or xray
   *  entitlement (trailing 12 months) × their monthly fee — the plan
   *  revenue currently attached to members who aren't attending at all. */
  unredeemedEntitlement: number;
  unredeemedEntitlementCalc: CalcRow[];
  /** (Plan members' avg private spend/patient − non-plan cohort's avg
   *  private spend/patient) × matched member count, trailing 12 months —
   *  negative when plan members privately spend LESS than non-plan
   *  patients (the discount isn't buying extra treatment uptake). */
  privateSpendUplift: number;
  privateSpendUpliftCalc: CalcRow[];
  /** Private (treatment_type='private') spend beyond the plan, annual,
   *  per patient, by the org's own treatment categories — plan-member
   *  cohort vs a real non-plan patient cohort (patients.pt_payment_plan_id
   *  IS NULL). Whatever categories actually exist for this org — not
   *  hardcoded to the mockup's example categories. */
  categorySpend: Array<{ category: string; planPerPatient: number; nonPlanPerPatient: number }>;
  planPatientCountForCategory: number;
  nonPlanPatientCount: number;
}

const PAY_METHOD_LABEL: Record<MarginLineItem["payMethod"], string> = {
  "per-hour": "per-hour rate",
  "flat-percentage": "% split",
  "sliding-scale": "sliding-scale split",
  "per-case": "per-case rate",
  fallback: "no split configured — Treatment Setup rate",
};

/** Live calculation rows for a ledger tooltip — real numbers for THIS
 *  month laid out as a worked sum (visits → minutes → hours → pay method →
 *  cost), not a sentence. Rows with no recorded duration are counted as
 *  visits but kept out of the minutes/hours sum so they don't silently drag
 *  it down. Pay-method rows answer "was this hourly or percentage" directly
 *  — each provider's own Provider Contract, not a single house rate. */
function workedTimeCalc(
  lineItems: MarginLineItem[],
  type: "clinician" | "hygiene",
  totalCost: number,
): Array<{ label: string; value: string; isTotal?: boolean }> {
  const rows = lineItems.filter((li) => li.type === type);
  if (rows.length === 0) return [{ label: "Visits this month", value: "0" }];
  const timed = rows.filter((li) => li.durationMin > 0);
  const untimed = rows.length - timed.length;
  const calc: Array<{ label: string; value: string; isTotal?: boolean }> = [
    { label: "Visits this month", value: nn(rows.length) },
  ];
  if (untimed > 0) {
    calc.push({ label: "— no recorded length", value: `${nn(untimed)} (£ counted, 0 min)` });
  }
  if (timed.length > 0) {
    const mins = timed.map((li) => li.durationMin);
    const total = mins.reduce((s, m) => s + m, 0);
    const avg = Math.round(total / timed.length);
    calc.push({ label: "Total minutes", value: `${nn(total)} min` });
    calc.push({ label: "Average per visit", value: `${avg} min` });
    calc.push({ label: "= Hours", value: `${(total / 60).toFixed(1)} hrs` });
  }
  const methodCounts = new Map<MarginLineItem["payMethod"], number>();
  for (const r of rows) methodCounts.set(r.payMethod, (methodCounts.get(r.payMethod) ?? 0) + 1);
  for (const [method, count] of methodCounts) {
    calc.push({ label: `— priced by ${PAY_METHOD_LABEL[method]}`, value: `${nn(count)} visit${count === 1 ? "" : "s"}` });
  }
  calc.push({ label: "= Cost, each visit's own provider rate", value: gbp(totalCost), isTotal: true });
  return calc;
}

const DIST_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "Loses over £2", min: -Infinity, max: -2 },
  { label: "Loses up to £2", min: -2, max: 0 },
  { label: "£0 to £2", min: 0, max: 2 },
  { label: "£2 to £4", min: 2, max: 4 },
  { label: "£4 to £6", min: 4, max: 6 },
  { label: "Over £6", min: 6, max: Infinity },
];

/** Margin tab's real data. Cost-to-serve is computed per delivered treatment
 *  (treatment_plan_items joined to the treatments catalog, gated on
 *  tpi_treatment_appointment_id > 0 — the same delivered-treatment gate
 *  established for revenue-affecting TPI reads elsewhere). Labour cost is
 *  priced from the DELIVERING PROVIDER's own current Split Configuration —
 *  providers.split_source_method plus whichever rate field that method
 *  needs (associate_split_percentage / associate_split_per_hour_rate +
 *  employment_type / associate_split_per_case_rate), the exact same fields
 *  and values each provider's own Contract details tab shows — a real
 *  per-provider number instead of one house rate applied to everyone.
 *  Per-hour multiplies the real per-visit minutes; per-case is a flat fee
 *  per visit; flat-percentage prices straight off that %; sliding-scale
 *  bands against the provider's real cumulative monthly production across
 *  every patient (provider_sliding_scales + payslipCalculations.ts's
 *  computePayBand, the same engine real payslips use), then applies the
 *  resulting blended rate per visit. Deliberately does NOT use
 *  provider_contracts' dated contract history or the providers table's
 *  Contract Start/End Date — this is always the provider's CURRENT split,
 *  not matched against the treatment's own date. Falls back to Treatment
 *  Setup's generic per-treatment "Therapist Pay Rate"/"Associate Pay %" —
 *  the old, provider-blind behaviour — only when a provider's configured
 *  method is missing its own rate, or nothing is configured at all
 *  (flagged in the line-item detail as "not configured"). Material/lab
 *  cost and overhead's hourly chair rate still come from Treatment Setup —
 *  only labour moved off it. When a treatment has been hand-
 *  picked into the Treatments tab (membership_treatment_settings, migration
 *  20260816000001), its membership-only dentist/hygienist TIME SPLIT (not
 *  its pay method) overrides the general catalog's values for that
 *  treatment's rows here ONLY — every other page keeps reading the
 *  untouched catalog. Clinician/hygiene hours
 *  (and the "Allocated overhead" £ they drive) come from the REAL delivered
 *  appointment window (apmt_start_time → apmt_finish_time, via
 *  tpi_treatment_appointment_id → treatment_appointments → appointments —
 *  the same chain useChairEfficiencyEngine.ts already established), not the
 *  Treatment Setup catalog's duration_minutes field, which is frequently
 *  0/unset for hygiene treatments specifically — falls back to the catalog
 *  duration only when the appointment itself has no recorded window. Cash-
 *  received figures reuse useMembershipStatementInsights, the
 *  same statement-parsed source the Overview tab's "where the gross goes"
 *  ribbon uses. A distinct "Practice Plan admin-fee" deduction line (shown
 *  in the design mockup) has no real source anywhere in this app — net_due
 *  already nets it out but doesn't itemise it — so it's omitted rather than
 *  estimated, same as "Chair time displaced" and "Private spend beyond the
 *  plan by category" (need a private-patient cohort baseline not yet built). */
export function useMarginData(): MarginData {
  const { organizationId } = useOrganization();
  const { selectedLocationId } = useFilters();
  const { members: uploadedMembers, totalMembers, displayMonth } = useMembershipUploadData();
  const { treatments: dbTreatments } = useTreatments();
  const { settings: membershipTreatmentSettings } = useMembershipTreatmentSettings();
  const statementQ = useMembershipStatementInsights(displayMonth ? [{ month: displayMonth.month, year: displayMonth.year }] : []);

  const [monthStart, monthEnd] = useMemo(() => {
    if (!displayMonth) return [null, null] as const;
    return [new Date(displayMonth.year, displayMonth.month - 1, 1), new Date(displayMonth.year, displayMonth.month, 0)] as const;
  }, [displayMonth]);

  // Real logged hours for every hygienist this month, whole practice, all
  // patients (Providers > Hygienist > Working Hours) — surfaced as its own
  // real line in the Hygiene time calculation (not a source for it, and not
  // hidden away): the client already knows and enters this number, so
  // showing it next to the plan-member figure lets them place one inside
  // the other themselves.
  const hygieneHoursQ = useAllProvidersWorkingHours("Hygienist", monthStart, monthEnd, selectedLocationId ?? null);
  const totalPracticeHygieneHours = useMemo(
    () => (hygieneHoursQ.data?.providers ?? []).reduce((s, p) => s + (p.totalExact || 0), 0),
    [hygieneHoursQ.data],
  );

  const matchedMembers = useMemo(
    () =>
      uploadedMembers.filter(
        (m) => m.patient_id && m.mapped_plan_id && (!selectedLocationId || m.location_id === selectedLocationId),
      ),
    [uploadedMembers, selectedLocationId],
  );
  const matchedMembersKey = matchedMembers.map((m) => `${m.patient_id}:${m.mapped_plan_id}:${m.location_id}`).sort().join(",");

  // Membership-only per-treatment overrides (membership_treatment_settings,
  // migration 20260816000001) — keyed by treatments.id (uuid), never
  // touches the general catalog.
  const membershipSettingsByTreatmentId = useMemo(
    () => new Map(membershipTreatmentSettings.map((s) => [s.treatmentId, s])),
    [membershipTreatmentSettings],
  );
  // Cheap content-change key so marginQ's queryKey below reacts to an edited
  // override even though costFieldsByExternalId's own size doesn't change.
  const membershipSettingsContentKey = useMemo(
    () =>
      membershipTreatmentSettings
        .map((s) => `${s.treatmentId}:${s.dentistTimeMinutes}:${s.hygienistTimeMinutes}:${s.labCost}:${s.materialCost}`)
        .sort()
        .join(","),
    [membershipTreatmentSettings],
  );

  const costFieldsByExternalId = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        material: number; lab: number; therapist: number; hourlyRate: number; durationMin: number;
        percentFees: number; financeFee: number; price: number;
        treatmentType: string | null; categoryName: string; visitType: "exam" | "hygiene" | "xray" | "other";
        /** Membership-only dentist/hygienist time + lab/material cost for
         *  this treatment, when hand-picked into the Treatments tab. null
         *  when not configured — every consumer must fall back to the
         *  general catalog fields above in that case. */
        membershipOverride: MembershipTreatmentSetting | null;
      }
    >();
    for (const t of dbTreatments) {
      if (t.external_id == null) continue;
      const categoryName = t.category?.name || "Uncategorised";
      map.set(String(t.external_id), {
        name: t.treatment_name || "Untitled treatment",
        material: Number(t.material_cost) || 0,
        lab: Number(t.lab_bill) || 0,
        therapist: Number(t.therapist_pay_rate) || 0,
        hourlyRate: Number(t.hourly_rate) || 0,
        durationMin: Number(t.duration_minutes) || 0,
        percentFees: Number(t.percent_fees) || 0,
        financeFee: Number(t.finance_fee) || 0,
        price: Number(t.price) || 0,
        treatmentType: t.treatment_type ?? null,
        categoryName,
        visitType: classifyVisitType(categoryName, t.treatment_name ?? null),
        membershipOverride: membershipSettingsByTreatmentId.get(t.id) ?? null,
      });
    }
    return map;
  }, [dbTreatments, membershipSettingsByTreatmentId]);

  const marginQ = useQuery({
    queryKey: [
      "insights_margin_cost",
      organizationId,
      matchedMembersKey,
      costFieldsByExternalId.size,
      membershipSettingsContentKey,
      displayMonth?.month,
      displayMonth?.year,
    ],
    enabled: !!organizationId && !!displayMonth && matchedMembers.length > 0 && costFieldsByExternalId.size > 0,
    queryFn: async () => {
      // Same single month as Cash received (displayMonth) — NOT a trailing
      // 12 months. Net cash/gross plan value are one month's statement;
      // comparing them against a 12-month cost total understated margin by
      // roughly 12x (a real bug: −460% instead of a plausible figure).
      const monthStart = new Date(displayMonth!.year, displayMonth!.month - 1, 1);
      const monthEnd = new Date(displayMonth!.year, displayMonth!.month, 0);
      const fromISO = ukDayStartInstant(monthStart);
      const toISO = ukDayEndInstant(monthEnd);

      const legacyKeys = Array.from(new Set(matchedMembers.map((m) => String(m.patient_id).trim())));
      const { data: patientRows, error: ptErr } = await (supabase as any)
        .from("patients")
        .select("pt_id, pt_legacy_id, pt_first_name, pt_last_name")
        .eq("organization_id", organizationId)
        .or(`pt_id.in.(${legacyKeys.join(",")}),pt_legacy_id.in.(${legacyKeys.join(",")})`);
      if (ptErr) throw ptErr;
      const keyToPtId = new Map<string, string>();
      const nameByPtId = new Map<string, string>();
      for (const p of patientRows ?? []) {
        if (p.pt_id != null) {
          keyToPtId.set(String(p.pt_id), String(p.pt_id));
          const name = [p.pt_first_name, p.pt_last_name].filter(Boolean).join(" ").trim();
          if (name) nameByPtId.set(String(p.pt_id), name);
        }
        if (p.pt_legacy_id != null && p.pt_id != null) keyToPtId.set(String(p.pt_legacy_id).trim(), String(p.pt_id));
      }

      type ResolvedMember = { patientId: string; ptId: string; locationId: string | null; netDue: number };
      const resolved: ResolvedMember[] = [];
      for (const m of matchedMembers) {
        const ptId = keyToPtId.get(String(m.patient_id).trim());
        if (!ptId) continue;
        resolved.push({ patientId: m.patient_id!, ptId, locationId: m.location_id, netDue: m.net_due || 0 });
      }
      if (resolved.length === 0) return null;
      const ptIds = Array.from(new Set(resolved.map((m) => m.ptId)));

      // Hygienist vs other-clinician split, same provider_role convention
      // used across Provider Detail / Hygienist Management.
      const { data: providerRows, error: provErr } = await (supabase as any)
        .from("providers")
        .select(
          "id, name, external_id, provider_role, split_source_method, associate_split_percentage, associate_split_per_hour_rate, associate_split_per_case_rate, employment_type",
        )
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .not("external_id", "is", null);
      if (provErr) throw provErr;
      const hygienistExternalIds = new Set(
        (providerRows ?? [])
          .filter((p: any) => String(p.provider_role ?? "").toLowerCase().includes("hygien"))
          .map((p: any) => String(p.external_id)),
      );
      const providerIdByExternalId = new Map<string, string>(
        (providerRows ?? []).map((p: any) => [String(p.external_id), p.id as string]),
      );
      const providerNameByExternalId = new Map<string, string>(
        (providerRows ?? []).map((p: any) => [String(p.external_id), p.name || "Unknown provider"]),
      );
      // Real per-provider pay — providers' own current Split Configuration
      // (Split Source Method / rate fields, the same "Hygienist/Associate
      // Split Configuration" section shown on each provider's own Contract
      // details tab), NOT their Contract Period dates — this data is a live
      // snapshot, current right now, not date-ranged history to match a
      // treatment's date against.
      const providerSnapshotById = new Map<
        string,
        {
          splitSourceMethod: string | null;
          associateSplitPercentage: number | null;
          perHourRate: number | null;
          perCaseRate: number | null;
          employmentType: string | null;
        }
      >(
        (providerRows ?? []).map((p: any) => [
          p.id as string,
          {
            splitSourceMethod: p.split_source_method ?? null,
            associateSplitPercentage: p.associate_split_percentage ?? null,
            perHourRate: p.associate_split_per_hour_rate ?? null,
            perCaseRate: p.associate_split_per_case_rate ?? null,
            employmentType: p.employment_type ?? null,
          },
        ]),
      );

      const PAGE_SIZE = 1000;
      const tpiRows: Array<{
        tpi_patient_id: number | string;
        tpi_treatment_id: number | string | null;
        tpi_price: number | string | null;
        tpi_practitioner_id: number | string | null;
        tpi_treatment_appointment_id: number | string | null;
        tpi_completed_at: string | null;
        location_id: string | null;
      }> = [];
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from("treatment_plan_items")
          .select("tpi_patient_id, tpi_treatment_id, tpi_price, tpi_practitioner_id, tpi_treatment_appointment_id, tpi_completed_at, location_id")
          .eq("organization_id", organizationId)
          .eq("tpi_completed", true)
          .gt("tpi_treatment_appointment_id", 0)
          .not("tpi_completed_at", "is", null)
          .gte("tpi_completed_at", fromISO)
          .lte("tpi_completed_at", toISO)
          .in("tpi_patient_id", ptIds)
          .is("deleted_at", null)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        tpiRows.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      // Real chair time per delivered treatment, from the appointment's own
      // start→finish window — same chain and helper as Chair Efficiency
      // Engine (tpi_treatment_appointment_id → treatment_appointments →
      // appointments). Falls back to the Treatment Setup catalog's
      // duration_minutes (below, per-row) only when an appointment has no
      // recorded window of its own.
      const taIds = Array.from(
        new Set(
          tpiRows
            .map((r) => Number(r.tpi_treatment_appointment_id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      );
      const apptDurationByTa = await fetchApptDurationByTa(taIds, organizationId!);

      // Real per-provider pay — each provider's own current Split
      // Configuration (providers.split_source_method /
      // associate_split_percentage, the same fields the Hygienist/Associate
      // Management "List" pages show), NOT Treatment Setup's generic
      // per-treatment "Therapist Pay Rate"/"Associate Pay %" (which charges
      // every provider doing a given treatment identically). Deliberately
      // NOT provider_contracts' dated history — this org's providers are
      // configured via the plain current split fields, not that table, and
      // date-ranged contract matching added complexity with nothing to
      // match against. Falls back to the Treatment Setup rate, per-row,
      // only when a delivering provider has no split % configured at all.
      const deliveringExternalIds = Array.from(
        new Set(
          tpiRows
            .map((r) => (r.tpi_practitioner_id != null ? String(r.tpi_practitioner_id) : null))
            .filter((id): id is string => id != null),
        ),
      );

      // %-based providers (flat-percentage or sliding-scale) are no longer
      // priced off Dentally's per-visit price at all — plan-covered visits
      // (Plan hygiene, exams) are recorded at £0 there, which broke this for
      // every plan visit. Instead: take the provider's REAL monthly
      // "Membership" revenue (Providers > Production Data's own membership
      // column — the same figure already reconciled to real Practice Plan/
      // statement money elsewhere in this app), subtract this month's real
      // lab+material cost (Treatments tab) for their plan-member work, apply
      // their % (flat, or the blended rate a sliding-scale band works out
      // to) to get their true monthly membership commission, then divide by
      // their own real labour minutes this month to get an effective
      // £/minute — applied per visit by that visit's own minutes. Same
      // shape as per-hour, just with a derived rate instead of a typed-in
      // one — price is only ever touched in this one monthly aggregate, so
      // a single £0 visit can no longer zero out its own cost.
      const priceBasedExtIds = deliveringExternalIds.filter((extId) => {
        const providerId = providerIdByExternalId.get(extId);
        const method = providerId ? providerSnapshotById.get(providerId)?.splitSourceMethod : null;
        return method === "flat-percentage" || method === "sliding-scale";
      });

      // Per-provider real labour minutes and lab+material cost across their
      // OWN plan-member delivered treatments this month — minutes prefer
      // the Treatments tab's configured dentist/hygienist time for that
      // treatment (the same source the dentist+hygienist split already
      // uses) over the real appointment window, falling back to the real
      // window only when no Treatments-tab time is configured at all.
      const totalLaborMinutesByExtId = new Map<string, number>();
      const labMaterialFeesByExtId = new Map<string, number>();
      for (const row of tpiRows) {
        if (row.tpi_treatment_id == null || row.tpi_practitioner_id == null) continue;
        const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
        if (!t) continue;
        const override = t.membershipOverride;
        const realDuration = apptDurationByTa.get(Number(row.tpi_treatment_appointment_id));
        const fallbackDuration = realDuration != null && realDuration > 0 ? realDuration : t.durationMin;
        const overrideDentistMin = override?.dentistTimeMinutes ?? null;
        const overrideHygienistMin = override?.hygienistTimeMinutes ?? null;
        const laborTimeMin =
          overrideDentistMin != null || overrideHygienistMin != null
            ? (overrideDentistMin ?? 0) + (overrideHygienistMin ?? 0)
            : fallbackDuration;
        const extId = String(row.tpi_practitioner_id);
        totalLaborMinutesByExtId.set(extId, (totalLaborMinutesByExtId.get(extId) ?? 0) + laborTimeMin);
        const material = override?.materialCost ?? t.material;
        const lab = override?.labCost ?? t.lab;
        labMaterialFeesByExtId.set(extId, (labMaterialFeesByExtId.get(extId) ?? 0) + material + lab);
      }

      // Real "Membership" revenue per provider for this month — same source
      // and figure as Providers > Production Data's own monthly-revenue
      // hover breakdown.
      const membershipRevenueByExtId = new Map<string, number>();
      if (priceBasedExtIds.length > 0) {
        const { providers: productionProviders } = await fetchAllProvidersNetProduction(organizationId!, {
          startDate: monthStart,
          endDate: monthEnd,
          locationId: selectedLocationId ?? null,
          applyNhsOverlay: false,
        });
        for (const p of productionProviders) {
          for (const extId of p.externalIds) {
            membershipRevenueByExtId.set(String(extId), p.totalMembership);
          }
        }
      }

      // Sliding-scale providers' % rises in bands against cumulative
      // MONTHLY production across every patient (not just plan members), so
      // the applicable rate can't be resolved per-treatment like a flat
      // percentage — pull each such provider's whole-month all-patient
      // production once, run the same computePayBand() real payslips use to
      // find their true banded rate, expressed as a blended % of that
      // production (not an absolute £, so it can be applied to the smaller
      // membership-only revenue figure below instead).
      const slidingScaleProviderIdsByExtId = new Map<string, string>();
      for (const extId of priceBasedExtIds) {
        const providerId = providerIdByExternalId.get(extId);
        if (!providerId) continue;
        if (providerSnapshotById.get(providerId)?.splitSourceMethod === "sliding-scale") {
          slidingScaleProviderIdsByExtId.set(extId, providerId);
        }
      }
      const effectiveSlidingPctByProviderId = new Map<string, number>();
      if (slidingScaleProviderIdsByExtId.size > 0) {
        const extIds = Array.from(slidingScaleProviderIdsByExtId.keys());
        const { data: prodRows, error: prodErr } = await (supabase as any)
          .from("treatment_plan_items")
          .select("tpi_practitioner_id, tpi_price")
          .eq("organization_id", organizationId)
          .eq("tpi_completed", true)
          .gt("tpi_treatment_appointment_id", 0)
          .not("tpi_completed_at", "is", null)
          .gte("tpi_completed_at", fromISO)
          .lte("tpi_completed_at", toISO)
          .in("tpi_practitioner_id", extIds.map(Number))
          .is("deleted_at", null);
        if (prodErr) throw prodErr;
        const productionByExtId = new Map<string, number>();
        for (const r of (prodRows ?? []) as Array<{ tpi_practitioner_id: number | null; tpi_price: number | string | null }>) {
          if (r.tpi_practitioner_id == null) continue;
          const key = String(r.tpi_practitioner_id);
          productionByExtId.set(key, (productionByExtId.get(key) ?? 0) + (Number(r.tpi_price) || 0));
        }

        const providerIds = Array.from(slidingScaleProviderIdsByExtId.values());
        const { data: scaleRows, error: scaleErr } = await (supabase as any)
          .from("provider_sliding_scales")
          .select("provider_id, band_name, start_amount, end_amount, percentage_value")
          .eq("organization_id", organizationId)
          .eq("scale_type", "sliding_scale")
          .in("provider_id", providerIds);
        if (scaleErr) throw scaleErr;
        const bandsByProviderId = new Map<string, SlidingScaleBand[]>();
        (scaleRows ?? []).forEach((s: any, i: number) => {
          const list = bandsByProviderId.get(s.provider_id) ?? [];
          list.push({ id: i, band: s.band_name, start: Number(s.start_amount), end: Number(s.end_amount), percentage: Number(s.percentage_value) });
          bandsByProviderId.set(s.provider_id, list);
        });

        for (const [extId, providerId] of slidingScaleProviderIdsByExtId) {
          const production = productionByExtId.get(extId) ?? 0;
          if (production <= 0) continue;
          const bands = bandsByProviderId.get(providerId) ?? [];
          // Sliding-scale only needs split_source_method + the bands fetched
          // above — none of the per-hour/per-case/lab fields computePayBand
          // also accepts, so a minimal config is all this needs.
          const result = computePayBand(
            { split_source_method: "sliding-scale", associate_split_percentage: null, lab_split_percentage: null, associate_split_per_case_rate: null, associate_split_per_hour_rate: null, employment_type: null },
            production,
            { slidingBands: bands },
          );
          effectiveSlidingPctByProviderId.set(providerId, result.amount / production);
        }
      }

      // Final effective £/minute per %-based provider: their real monthly
      // membership commission (net of lab+material), divided by their real
      // monthly labour minutes on plan-member work — applied per visit by
      // that visit's own minutes in the main loop below.
      const effectiveRatePerMinuteByProviderId = new Map<string, number>();
      for (const extId of priceBasedExtIds) {
        const providerId = providerIdByExternalId.get(extId);
        if (!providerId) continue;
        const snapshot = providerSnapshotById.get(providerId);
        const method = snapshot?.splitSourceMethod;
        const pct =
          method === "flat-percentage"
            ? snapshot?.associateSplitPercentage != null ? snapshot.associateSplitPercentage / 100 : null
            : method === "sliding-scale"
              ? effectiveSlidingPctByProviderId.get(providerId) ?? null
              : null;
        if (pct == null) continue;
        const membershipRevenue = membershipRevenueByExtId.get(extId) ?? 0;
        const labMaterialFees = labMaterialFeesByExtId.get(extId) ?? 0;
        const netRevenue = membershipRevenue - labMaterialFees;
        const monthlyCommission = netRevenue * pct;
        const totalLaborMinutes = totalLaborMinutesByExtId.get(extId) ?? 0;
        if (totalLaborMinutes > 0) {
          effectiveRatePerMinuteByProviderId.set(providerId, monthlyCommission / totalLaborMinutes);
        }
      }

      const locationIdByPtId = new Map(resolved.map((m) => [m.ptId, m.locationId]));
      const netDueByPtId = new Map(resolved.map((m) => [m.ptId, m.netDue]));

      let clinicianCost = 0, clinicianMinutes = 0, clinicianTreatments = 0;
      let hygieneCost = 0, hygieneMinutes = 0, hygieneTreatments = 0;
      let materialsLab = 0;
      let overhead = 0;
      let discountForgone = 0;
      let discountedTreatments = 0;
      const costByPtId = new Map<string, number>();
      const netCashByLocation = new Map<string, number>();
      const costByLocation = new Map<string, number>();
      // Live, row-level detail behind the four ledger totals — the actual
      // treatments a client can count/re-sum by hand against Dentally and
      // Treatment Setup, not just a formula description.
      const lineItems: MarginLineItem[] = [];

      for (const row of tpiRows) {
        if (row.tpi_treatment_id == null) continue;
        const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
        if (!t) continue;
        const price = Number(row.tpi_price) || 0;
        const override = t.membershipOverride;
        // Membership-only override: material/lab cost, when set, replace the
        // general catalog's material_cost/lab_bill for this row. hourlyRate
        // (the overhead line) and therapist_pay_rate (the flat labor £) stay
        // catalog-sourced — the Treatments tab only captures time and
        // lab/material cost, not a membership-specific rate.
        const material = override?.materialCost ?? t.material;
        const lab = override?.labCost ?? t.lab;
        // Real appointment window when this delivery has one recorded;
        // otherwise the catalog's own duration estimate; otherwise neither
        // exists and this row contributes £ cost but 0 minutes — tracked so
        // that gap is visible rather than silently understating the hours.
        // Used for "Allocated overhead" (real chair time) specifically.
        const realDuration = apptDurationByTa.get(Number(row.tpi_treatment_appointment_id));
        const durationSource: "real" | "catalog" | "none" =
          realDuration != null && realDuration > 0 ? "real" : t.durationMin > 0 ? "catalog" : "none";
        const durationMin = durationSource === "real" ? realDuration! : t.durationMin;
        const opCost = t.hourlyRate * (durationMin / 60);
        const finFee = price * (t.financeFee / 100);

        // Labour TIME: the Treatments tab's own configured dentist/hygienist
        // minutes for this treatment when set (same source the split logic
        // below already uses) — real, intentionally-configured time, not a
        // Dentally appointment window — falling back to that real/catalog
        // window only when this treatment has no Treatments-tab time at all.
        const overrideDentistMin = override?.dentistTimeMinutes ?? null;
        const overrideHygienistMin = override?.hygienistTimeMinutes ?? null;
        const laborTimeMin =
          overrideDentistMin != null || overrideHygienistMin != null
            ? (overrideDentistMin ?? 0) + (overrideHygienistMin ?? 0)
            : durationMin;

        // Labour cost: the DELIVERING PROVIDER's own current Split
        // Configuration — per-hour and per-case are priced by real time/a
        // flat fee, never Dentally's per-visit price. Flat-percentage and
        // sliding-scale are priced from real monthly numbers (Membership
        // revenue, lab+material cost, labour minutes — see above), turned
        // into an effective £/minute and applied by this visit's own real
        // minutes — never the visit's own price, which is £0 for every
        // plan-covered visit and would otherwise zero out identical work.
        // If the method their record says doesn't actually have what it
        // needs (e.g. per-hour selected but no £/hr entered), this falls
        // straight to Treatment Setup rather than silently reinterpreting
        // it as a different method.
        const practitionerExtId = row.tpi_practitioner_id != null ? String(row.tpi_practitioner_id) : null;
        const providerId = practitionerExtId ? providerIdByExternalId.get(practitionerExtId) : null;
        const snapshot = providerId ? providerSnapshotById.get(providerId) : null;
        const method = snapshot?.splitSourceMethod || "flat-percentage";
        let laborCost: number | null = null;
        let payMethod: MarginLineItem["payMethod"] = "fallback";
        if (method === "per-hour" && snapshot?.perHourRate) {
          const rate = getEffectivePerHourRate(snapshot.perHourRate, snapshot.employmentType);
          laborCost = rate * (laborTimeMin / 60);
          payMethod = "per-hour";
        } else if (method === "per-case" && snapshot?.perCaseRate) {
          laborCost = snapshot.perCaseRate;
          payMethod = "per-case";
        } else if (
          (method === "flat-percentage" || method === "sliding-scale") &&
          providerId &&
          effectiveRatePerMinuteByProviderId.has(providerId)
        ) {
          laborCost = effectiveRatePerMinuteByProviderId.get(providerId)! * laborTimeMin;
          payMethod = method;
        }
        if (laborCost == null) {
          // Nothing usable configured for this provider — Treatment Setup's
          // generic rate, same as every treatment used before this fix.
          laborCost = t.therapist + price * (t.percentFees / 100);
          payMethod = "fallback";
        }

        // Rows this one treatment contributes to the visit list — normally
        // just one, but a genuine dentist+hygienist split (both minutes set)
        // becomes two, one per share, so each ledger line's detail table
        // sums to exactly that line's total (never a combined row credited
        // whole to whichever side happened to have the larger share).
        const rows: Array<{ type: "clinician" | "hygiene"; labourCost: number; durationMin: number }> = [];
        if (override && (override.dentistTimeMinutes != null || override.hygienistTimeMinutes != null)) {
          // Membership-configured split: this treatment's own dentist/
          // hygienist minutes decide how the labor cost and hours are
          // divided between the two ledger lines, regardless of which
          // provider actually delivered any one appointment — reflects the
          // practice's typical staffing for this treatment under
          // membership, not that one appointment's real assignment.
          const dentistMin = override.dentistTimeMinutes ?? 0;
          const hygienistMin = override.hygienistTimeMinutes ?? 0;
          const totalOverrideMin = dentistMin + hygienistMin;
          const hygieneShare = totalOverrideMin > 0 ? hygienistMin / totalOverrideMin : 0;
          const hygienePortion = laborCost * hygieneShare;
          const clinicianPortion = laborCost * (1 - hygieneShare);
          hygieneCost += hygienePortion;
          hygieneMinutes += hygienistMin;
          if (hygienistMin > 0) { hygieneTreatments += 1; rows.push({ type: "hygiene", labourCost: hygienePortion, durationMin: hygienistMin }); }
          clinicianCost += clinicianPortion;
          clinicianMinutes += dentistMin;
          if (dentistMin > 0) { clinicianTreatments += 1; rows.push({ type: "clinician", labourCost: clinicianPortion, durationMin: dentistMin }); }
        } else {
          const isHygiene = row.tpi_practitioner_id != null && hygienistExternalIds.has(String(row.tpi_practitioner_id));
          if (isHygiene) {
            hygieneCost += laborCost;
            hygieneMinutes += durationMin;
            hygieneTreatments += 1;
          } else {
            clinicianCost += laborCost;
            clinicianMinutes += durationMin;
            clinicianTreatments += 1;
          }
          rows.push({ type: isHygiene ? "hygiene" : "clinician", labourCost: laborCost, durationMin });
        }
        materialsLab += material + lab;
        overhead += opCost + finFee;
        if (t.price > price) { discountForgone += t.price - price; discountedTreatments += 1; }

        const ptKey = String(row.tpi_patient_id);
        const unitCost = material + lab + laborCost + opCost + finFee;
        costByPtId.set(ptKey, (costByPtId.get(ptKey) ?? 0) + unitCost);

        const locId = row.location_id ?? locationIdByPtId.get(ptKey) ?? null;
        if (locId) costByLocation.set(locId, (costByLocation.get(locId) ?? 0) + unitCost);

        // Materials/lab and overhead aren't split by the override (only
        // labour/time is) — attribute them to the first row only so summing
        // materialsLabCost/overheadCost/totalCost across a split's two rows
        // doesn't double-count them.
        rows.forEach((r, i) => {
          const materialsLabCost = i === 0 ? material + lab : 0;
          const overheadCost = i === 0 ? opCost + finFee : 0;
          lineItems.push({
            patientName: nameByPtId.get(ptKey) ?? `Patient #${ptKey}`,
            providerName: practitionerExtId ? providerNameByExternalId.get(practitionerExtId) ?? "Unknown provider" : "Unknown provider",
            treatmentName: t.name,
            date: row.tpi_completed_at,
            type: r.type,
            durationMin: r.durationMin,
            durationSource,
            payMethod,
            labourCost: r.labourCost,
            materialsLabCost,
            overheadCost,
            totalCost: r.labourCost + materialsLabCost + overheadCost,
          });
        });
      }

      for (const m of resolved) {
        if (m.locationId) netCashByLocation.set(m.locationId, (netCashByLocation.get(m.locationId) ?? 0) + m.netDue);
      }

      return {
        clinicianCost, clinicianMinutes, clinicianTreatments,
        hygieneCost, hygieneMinutes, hygieneTreatments,
        materialsLab, overhead,
        discountForgone, discountedTreatments, costByPtId, netDueByPtId, netCashByLocation, costByLocation,
        lineItems,
      };
    },
  });

  // Unredeemed entitlement — same entitlement + exam/hygiene classification
  // approach as Capacity's redemption query, trailing 12 months (annual,
  // not the monthly cost window above): matched members who took NEITHER
  // their hygiene NOR exam entitlement this plan year, valued at their fee.
  const unredeemedQ = useQuery({
    queryKey: ["insights_margin_unredeemed", organizationId, matchedMembersKey, costFieldsByExternalId.size],
    enabled: !!organizationId && matchedMembers.length > 0 && costFieldsByExternalId.size > 0,
    queryFn: async (): Promise<{ value: number; count: number; eligibleCount: number }> => {
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd);
      windowStart.setFullYear(windowStart.getFullYear() - 1);
      const fromISO = ukDayStartInstant(windowStart);
      const toISO = ukDayEndInstant(windowEnd);

      const legacyKeys = Array.from(new Set(matchedMembers.map((m) => String(m.patient_id).trim())));
      const { data: patientRows, error: ptErr } = await (supabase as any)
        .from("patients")
        .select("pt_id, pt_legacy_id")
        .eq("organization_id", organizationId)
        .or(`pt_id.in.(${legacyKeys.join(",")}),pt_legacy_id.in.(${legacyKeys.join(",")})`);
      if (ptErr) throw ptErr;
      const keyToPtId = new Map<string, string>();
      for (const p of patientRows ?? []) {
        if (p.pt_id != null) keyToPtId.set(String(p.pt_id), String(p.pt_id));
        if (p.pt_legacy_id != null && p.pt_id != null) keyToPtId.set(String(p.pt_legacy_id).trim(), String(p.pt_id));
      }

      const planIds = Array.from(new Set(matchedMembers.map((m) => m.mapped_plan_id!)));
      const BASE_PLAN_COLUMNS = "id, pp_exam_appointments_included, pp_hygiene_appointments_included";
      let planRows: any[] | null = null;
      let hasOverrideColumns = true;
      const withOverrides = await (supabase as any)
        .from("payment_plans")
        .select(`${BASE_PLAN_COLUMNS}, exams_included_override, hygiene_included_override, xray_included_override`)
        .in("id", planIds);
      if (withOverrides.error) {
        if (!/column .* does not exist/i.test(withOverrides.error.message ?? "")) throw withOverrides.error;
        hasOverrideColumns = false;
        const fallback = await (supabase as any).from("payment_plans").select(BASE_PLAN_COLUMNS).in("id", planIds);
        if (fallback.error) throw fallback.error;
        planRows = fallback.data;
      } else {
        planRows = withOverrides.data;
      }
      const entitlementByPlanId = new Map<string, { exam: number; hygiene: number; xray: number }>();
      for (const p of planRows ?? []) {
        const overrideExam = hasOverrideColumns ? p.exams_included_override : null;
        const overrideHygiene = hasOverrideColumns ? p.hygiene_included_override : null;
        const overrideXray = hasOverrideColumns ? p.xray_included_override : null;
        entitlementByPlanId.set(p.id, {
          exam: overrideExam != null ? Number(overrideExam) : Number(p.pp_exam_appointments_included) || 0,
          hygiene: overrideHygiene != null ? Number(overrideHygiene) : Number(p.pp_hygiene_appointments_included) || 0,
          xray: overrideXray != null ? Number(overrideXray) : 0,
        });
      }

      type Resolved = { ptId: string; netDue: number; examEntitled: number; hygieneEntitled: number; xrayEntitled: number };
      const resolved: Resolved[] = [];
      for (const m of matchedMembers) {
        const ptId = keyToPtId.get(String(m.patient_id).trim());
        const entitlement = entitlementByPlanId.get(m.mapped_plan_id!);
        if (!ptId || !entitlement) continue;
        resolved.push({
          ptId,
          netDue: m.net_due || 0,
          examEntitled: entitlement.exam,
          hygieneEntitled: entitlement.hygiene,
          xrayEntitled: entitlement.xray,
        });
      }
      if (resolved.length === 0) return { value: 0, count: 0, eligibleCount: 0 };
      const ptIds = Array.from(new Set(resolved.map((m) => m.ptId)));

      const PAGE_SIZE = 1000;
      const tpiRows: Array<{ tpi_patient_id: number | string; tpi_treatment_id: number | string | null }> = [];
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from("treatment_plan_items")
          .select("tpi_patient_id, tpi_treatment_id")
          .eq("organization_id", organizationId)
          .eq("tpi_completed", true)
          .gt("tpi_treatment_appointment_id", 0)
          .not("tpi_completed_at", "is", null)
          .gte("tpi_completed_at", fromISO)
          .lte("tpi_completed_at", toISO)
          .in("tpi_patient_id", ptIds)
          .is("deleted_at", null)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        tpiRows.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      const examCountByPtId = new Map<string, number>();
      const hygieneCountByPtId = new Map<string, number>();
      const xrayCountByPtId = new Map<string, number>();
      for (const row of tpiRows) {
        if (row.tpi_treatment_id == null) continue;
        const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
        if (!t || (t.visitType !== "exam" && t.visitType !== "hygiene" && t.visitType !== "xray")) continue;
        const ptKey = String(row.tpi_patient_id);
        const map = t.visitType === "exam" ? examCountByPtId : t.visitType === "hygiene" ? hygieneCountByPtId : xrayCountByPtId;
        map.set(ptKey, (map.get(ptKey) ?? 0) + 1);
      }

      let value = 0;
      let count = 0;
      let eligibleCount = 0;
      for (const m of resolved) {
        const hasEntitlement = m.examEntitled > 0 || m.hygieneEntitled > 0 || m.xrayEntitled > 0;
        if (!hasEntitlement) continue;
        eligibleCount += 1;
        const examCount = examCountByPtId.get(m.ptId) ?? 0;
        const hygieneCount = hygieneCountByPtId.get(m.ptId) ?? 0;
        const xrayCount = xrayCountByPtId.get(m.ptId) ?? 0;
        if (examCount === 0 && hygieneCount === 0 && xrayCount === 0) { value += m.netDue; count += 1; }
      }
      return { value, count, eligibleCount };
    },
  });

  // Non-plan patient cohort (patients.pt_payment_plan_id IS NULL) for
  // "Chair time displaced" (real private £/hour yield) and "Private spend
  // uplift" / the category table — a real comparison group, not estimated.
  // Trailing 12 months, annual per patient, matching the mockup's own framing.
  const opportunityQ = useQuery({
    queryKey: ["insights_margin_opportunity", organizationId, selectedLocationId ?? "all", matchedMembersKey, costFieldsByExternalId.size],
    enabled: !!organizationId && matchedMembers.length > 0 && costFieldsByExternalId.size > 0,
    queryFn: async () => {
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd);
      windowStart.setFullYear(windowStart.getFullYear() - 1);
      const fromISO = ukDayStartInstant(windowStart);
      const toISO = ukDayEndInstant(windowEnd);

      const legacyKeys = Array.from(new Set(matchedMembers.map((m) => String(m.patient_id).trim())));
      const { data: patientRows, error: ptErr } = await (supabase as any)
        .from("patients")
        .select("pt_id, pt_legacy_id")
        .eq("organization_id", organizationId)
        .or(`pt_id.in.(${legacyKeys.join(",")}),pt_legacy_id.in.(${legacyKeys.join(",")})`);
      if (ptErr) throw ptErr;
      const planPtIds = new Set<string>();
      for (const p of patientRows ?? []) {
        if (p.pt_id != null) planPtIds.add(String(p.pt_id));
      }

      let nonPlanQ = (supabase as any)
        .from("patients")
        .select("pt_id", { count: "exact" })
        .eq("organization_id", organizationId)
        .is("pt_payment_plan_id", null)
        .is("deleted_at", null);
      if (selectedLocationId) nonPlanQ = nonPlanQ.eq("location_id", selectedLocationId);
      const { data: nonPlanRows, count: nonPlanTotalCount, error: nonPlanErr } = await nonPlanQ;
      if (nonPlanErr) throw nonPlanErr;
      const nonPlanPtIds = new Set<string>((nonPlanRows ?? []).map((r: any) => String(r.pt_id)));

      const PAGE_SIZE = 1000;
      const tpiRows: Array<{
        tpi_patient_id: number | string;
        tpi_treatment_id: number | string | null;
        tpi_price: number | string | null;
        tpi_treatment_appointment_id: number | string | null;
      }> = [];
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        let q = (supabase as any)
          .from("treatment_plan_items")
          .select("tpi_patient_id, tpi_treatment_id, tpi_price, tpi_treatment_appointment_id, location_id")
          .eq("organization_id", organizationId)
          .eq("tpi_completed", true)
          .gt("tpi_treatment_appointment_id", 0)
          .not("tpi_completed_at", "is", null)
          .gte("tpi_completed_at", fromISO)
          .lte("tpi_completed_at", toISO)
          .is("deleted_at", null);
        if (selectedLocationId) q = q.eq("location_id", selectedLocationId);
        const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        tpiRows.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      // Real appointment window for the non-plan cohort's private hourly
      // yield — same fix and reasoning as Cost to Serve: Treatment Setup's
      // duration_minutes is frequently 0/unset, which understates minutes
      // and so inflates £/hour (and everything "Chair time displaced"
      // multiplies it by). Falls back to the catalog duration when an
      // appointment has no recorded window.
      const oppTaIds = Array.from(
        new Set(
          tpiRows
            .map((r) => Number(r.tpi_treatment_appointment_id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      );
      const oppApptDurationByTa = await fetchApptDurationByTa(oppTaIds, organizationId!);

      const planCategorySpend = new Map<string, number>();
      const nonPlanCategorySpend = new Map<string, number>();
      let nonPlanPrivateTotal = 0;
      let nonPlanPrivateMinutes = 0;

      for (const row of tpiRows) {
        if (row.tpi_treatment_id == null) continue;
        const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
        if (!t || t.treatmentType !== "private") continue;
        const price = Number(row.tpi_price) || 0;
        const ptKey = String(row.tpi_patient_id);
        const isPlan = planPtIds.has(ptKey);
        const isNonPlan = !isPlan && nonPlanPtIds.has(ptKey);
        if (!isPlan && !isNonPlan) continue;

        const map = isPlan ? planCategorySpend : nonPlanCategorySpend;
        map.set(t.categoryName, (map.get(t.categoryName) ?? 0) + price);
        if (isNonPlan) {
          nonPlanPrivateTotal += price;
          const realDuration = oppApptDurationByTa.get(Number(row.tpi_treatment_appointment_id));
          nonPlanPrivateMinutes += realDuration != null && realDuration > 0 ? realDuration : t.durationMin;
        }
      }

      const categories = Array.from(new Set([...planCategorySpend.keys(), ...nonPlanCategorySpend.keys()]));
      const nonPlanCount = nonPlanTotalCount ?? nonPlanPtIds.size;
      const categorySpend = categories.map((category) => ({
        category,
        planPerPatient: matchedMembers.length > 0 ? (planCategorySpend.get(category) ?? 0) / matchedMembers.length : 0,
        nonPlanPerPatient: nonPlanCount > 0 ? (nonPlanCategorySpend.get(category) ?? 0) / nonPlanCount : 0,
      }));

      const privateHourlyYield = nonPlanPrivateMinutes > 0 ? nonPlanPrivateTotal / (nonPlanPrivateMinutes / 60) : 0;

      return { categorySpend, nonPlanCount, privateHourlyYield };
    },
  });

  const totalRevenue = matchedMembers.reduce((s, m) => s + (m.net_due || 0), 0);
  const totalCosts =
    marginQ.data == null
      ? 0
      : marginQ.data.clinicianCost + marginQ.data.hygieneCost + marginQ.data.materialsLab + marginQ.data.overhead;
  const contribution = totalRevenue - totalCosts;

  const bySite: MarginSiteRow[] = useMemo(() => {
    if (!marginQ.data) return [];
    const locIds = new Set([...marginQ.data.netCashByLocation.keys(), ...marginQ.data.costByLocation.keys()]);
    return Array.from(locIds).map((locationId) => {
      const netCash = marginQ.data!.netCashByLocation.get(locationId) ?? 0;
      const costToServe = marginQ.data!.costByLocation.get(locationId) ?? 0;
      const siteContribution = netCash - costToServe;
      return {
        locationId,
        name: locationId,
        netCash: Math.round(netCash),
        costToServe: Math.round(costToServe),
        contribution: Math.round(siteContribution),
        marginPct: netCash > 0 ? Math.round((siteContribution / netCash) * 100) : null,
        verdict: netCash > 0 ? (siteContribution >= 0 ? "earning" : "destroying") : null,
      };
    });
  }, [marginQ.data]);

  const locationNamesQ = useQuery({
    queryKey: ["insights_margin_location_names", organizationId, bySite.map((s) => s.locationId).sort().join(",")],
    enabled: !!organizationId && bySite.length > 0,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await (supabase as any)
        .from("practice_locations")
        .select("id, location_name")
        .in("id", bySite.map((s) => s.locationId));
      if (error) throw error;
      return new Map((data ?? []).map((r: any) => [r.id, r.location_name]));
    },
  });
  const bySiteNamed = bySite.map((s) => ({ ...s, name: locationNamesQ.data?.get(s.locationId) ?? s.name }));

  const cashReceivedLedger: MarginLedgerRow[] = useMemo(() => {
    const stmt = statementQ.data;
    if (!stmt || !stmt.hasStatements) {
      return [{ label: "Net cash to bank", amount: Math.round(totalRevenue), isTotal: true }];
    }
    return [
      { label: "Gross plan value", amount: Math.round(stmt.grossValue) },
      { label: "Failed collections", amount: -Math.round(stmt.failedValue), isNegative: true },
      { label: "Net cash to bank", amount: Math.round(stmt.totalCollectedValue), isTotal: true },
    ];
  }, [statementQ.data, totalRevenue]);

  const costToServeLedger: MarginLedgerRow[] = useMemo(() => {
    if (!marginQ.data) return [];
    const d = marginQ.data;
    const treatmentCount = d.clinicianTreatments + d.hygieneTreatments;
    return [
      {
        label: `Clinician time · ${nnHours(d.clinicianMinutes)} hrs`,
        amount: Math.round(d.clinicianCost),
        calc: workedTimeCalc(d.lineItems, "clinician", d.clinicianCost),
      },
      {
        label: `Hygiene time · ${nnHours(d.hygieneMinutes)} hrs`,
        amount: Math.round(d.hygieneCost),
        calc: [
          ...(totalPracticeHygieneHours != null && totalPracticeHygieneHours > 0
            ? [
                { label: "Practice hygienist hours (Working Hours)", value: `${nn(totalPracticeHygieneHours)} hrs` },
                {
                  label: "Share on these plan members",
                  value: `${((d.hygieneMinutes / 60 / totalPracticeHygieneHours) * 100).toFixed(1)}%`,
                },
              ]
            : []),
          ...workedTimeCalc(d.lineItems, "hygiene", d.hygieneCost),
        ],
      },
      {
        label: "Materials and lab",
        amount: Math.round(d.materialsLab),
        calc: [
          { label: "Treatments this month", value: nn(treatmentCount) },
          { label: "Material + lab cost, added up", value: gbp(d.materialsLab), isTotal: true },
        ],
      },
      {
        label: "Allocated overhead",
        amount: Math.round(d.overhead),
        calc: [
          { label: "Treatments this month", value: nn(treatmentCount) },
          { label: "Chair rate × minutes + finance fee, added up", value: gbp(d.overhead), isTotal: true },
        ],
      },
      {
        label: "Contribution",
        amount: Math.round(contribution),
        isTotal: true,
        calc: [
          { label: "Net cash to bank", value: gbp(totalRevenue) },
          { label: "− Clinician time", value: `−${gbp(d.clinicianCost)}` },
          { label: "− Hygiene time", value: `−${gbp(d.hygieneCost)}` },
          { label: "− Materials and lab", value: `−${gbp(d.materialsLab)}` },
          { label: "− Allocated overhead", value: `−${gbp(d.overhead)}` },
          { label: "= Contribution", value: gbp(contribution), isTotal: true },
        ],
      },
    ];
  }, [marginQ.data, contribution, totalRevenue, totalPracticeHygieneHours]);

  const { distribution, costedMemberCount } = useMemo(() => {
    const buckets = DIST_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
    if (!marginQ.data) return { distribution: buckets, costedMemberCount: 0 };
    let costed = 0;
    // netDueByPtId and costByPtId are built off the same resolved-member
    // key space (patients.pt_id), so iterating one covers every matched
    // member with a resolved Dentally patient link — INCLUDING members with
    // no delivered treatment this month (cost defaults to £0 via the ?? 0
    // below, so their margin is their full fee). Previously these were
    // skipped entirely ("not costed"), which silently dropped exactly the
    // members with the best margin this month — and the true churn-risk
    // ones — from the whole distribution and its member count.
    for (const [ptKey, netDue] of marginQ.data.netDueByPtId) {
      const cost = marginQ.data.costByPtId.get(ptKey) ?? 0;
      costed += 1;
      const margin = netDue - cost;
      const idx = DIST_BUCKETS.findIndex((b) => margin >= b.min && margin < b.max);
      if (idx >= 0) buckets[idx].count += 1;
    }
    return { distribution: buckets, costedMemberCount: costed };
  }, [marginQ.data]);

  const planHours = marginQ.data ? (marginQ.data.clinicianMinutes + marginQ.data.hygieneMinutes) / 60 : 0;
  const chairTimeDisplaced = Math.round(planHours * (opportunityQ.data?.privateHourlyYield ?? 0));

  const privateSpendUplift = useMemo(() => {
    const cats = opportunityQ.data?.categorySpend ?? [];
    const gapPerPatient = cats.reduce((s, c) => s + (c.planPerPatient - c.nonPlanPerPatient), 0);
    return Math.round(gapPerPatient * matchedMembers.length);
  }, [opportunityQ.data, matchedMembers.length]);

  const discountForgoneCalc: CalcRow[] = useMemo(() => {
    const d = marginQ.data;
    if (!d) return [];
    return [
      { label: "Treatments below Treatment Setup's private price", value: nn(d.discountedTreatments) },
      { label: "= Discount forgone, added up", value: gbp(d.discountForgone), isTotal: true },
    ];
  }, [marginQ.data]);

  const chairTimeDisplacedCalc: CalcRow[] = useMemo(() => {
    const yieldPerHour = opportunityQ.data?.privateHourlyYield ?? 0;
    return [
      { label: "Plan members' delivered-treatment hours", value: `${planHours.toFixed(1)} hrs` },
      { label: "× Non-plan cohort's real £/hour", value: gbp(yieldPerHour) },
      { label: "= Chair time displaced", value: gbp(chairTimeDisplaced), isTotal: true },
    ];
  }, [planHours, opportunityQ.data, chairTimeDisplaced]);

  const unredeemedEntitlementCalc: CalcRow[] = useMemo(() => {
    const u = unredeemedQ.data;
    if (!u) return [];
    return [
      { label: "Members with hygiene/exam entitlement", value: nn(u.eligibleCount) },
      { label: "— redeemed neither, this year", value: nn(u.count) },
      { label: "= Their fees, added up", value: gbp(u.value), isTotal: true },
    ];
  }, [unredeemedQ.data]);

  const privateSpendUpliftCalc: CalcRow[] = useMemo(() => {
    const cats = opportunityQ.data?.categorySpend ?? [];
    const gapPerPatient = cats.reduce((s, c) => s + (c.planPerPatient - c.nonPlanPerPatient), 0);
    return [
      { label: "Plan vs non-plan gap per patient, all categories", value: gbp(gapPerPatient) },
      { label: "× Matched plan members", value: nn(matchedMembers.length) },
      { label: "= Private spend uplift", value: gbp(privateSpendUplift), isTotal: true },
    ];
  }, [opportunityQ.data, matchedMembers.length, privateSpendUplift]);

  return {
    isLoading: marginQ.isLoading || statementQ.isLoading || unredeemedQ.isLoading || opportunityQ.isLoading,
    hasUploadData: totalMembers > 0,
    totalRevenue: Math.round(totalRevenue),
    totalCosts: Math.round(totalCosts),
    contribution: Math.round(contribution),
    contributionPct: totalRevenue > 0 ? Math.round((contribution / totalRevenue) * 100) : null,
    bySite: bySiteNamed,
    cashReceivedLedger,
    costToServeLedger,
    costToServeLineItems: marginQ.data?.lineItems ?? [],
    totalPracticeHygieneHours: hygieneHoursQ.isLoading ? null : totalPracticeHygieneHours,
    distribution,
    costedMemberCount,
    totalMatchedMembers: matchedMembers.length,
    discountForgone: Math.round(marginQ.data?.discountForgone ?? 0),
    discountForgoneCalc,
    chairTimeDisplaced,
    chairTimeDisplacedCalc,
    unredeemedEntitlement: Math.round(unredeemedQ.data?.value ?? 0),
    unredeemedEntitlementCalc,
    privateSpendUplift,
    privateSpendUpliftCalc,
    categorySpend: (opportunityQ.data?.categorySpend ?? []).map((c) => ({
      category: c.category,
      planPerPatient: Math.round(c.planPerPatient),
      nonPlanPerPatient: Math.round(c.nonPlanPerPatient),
    })),
    planPatientCountForCategory: matchedMembers.length,
    nonPlanPatientCount: opportunityQ.data?.nonPlanCount ?? 0,
  };
}

function nnHours(minutes: number): string {
  return Math.round(minutes / 60).toLocaleString("en-GB");
}
