import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useFilters } from "@/contexts/FilterContext";
import { useMembershipUploadData } from "@/hooks/useMembershipUploadData";
import { useMembershipStatementInsights } from "@/hooks/useMembershipStatementInsights";
import { useTreatments } from "@/hooks/useTreatments";
import { useAllProvidersWorkingHours } from "@/hooks/useAllProvidersWorkingHours";
import { fetchApptDurationByTa, fetchApptInfoByTa } from "@/hooks/useChairEfficiencyEngine";
import { useMembershipTreatmentSettings, type MembershipTreatmentSetting } from "@/hooks/useMembershipTreatmentSettings";
import { computePayBand, getEffectivePerHourRate } from "@/lib/payslipCalculations";
import type { SlidingScaleBand } from "@/hooks/useSlidingScales";
import { ukDayStartInstant, ukDayEndInstant } from "@/utils/dateRangeUtils";
import { classifyVisitType } from "@/lib/visitTypeClassification";
import { nn, gbpExact, gbpRate } from "./format";
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
  /** Per-bucket live worked sum (members, fees, cost, margin) shown behind
   *  an ⓘ on that bar's own label. */
  calc?: CalcRow[];
}

/** Plan-covered visit — the only kind costed against the membership fee.
 *  Covered = charged £0 (the plan absorbed it), or an exam/hygiene/x-ray
 *  entitlement visit, or a "Plan …"-named treatment. Everything else is
 *  separately-billed private work: it brings its OWN revenue, so charging
 *  its cost against the plan fee (without that revenue) painted healthy
 *  members as the plan's biggest losses (client decision 2026-08-19 —
 *  validated on July data: excludes exactly the extractions/crowns/implant
 *  consults, keeps every £0-charged, plan-named and entitlement visit). */
function isPlanCovered(visitType: "exam" | "hygiene" | "xray" | "other", name: string, price: number): boolean {
  return price <= 0 || visitType !== "other" || /\bplan\b/i.test(name);
}

/** One real delivered treatment behind the Cost to Serve ledger — the row
 *  level a client can check by hand against Dentally and Treatment Setup. */
export interface MarginLineItem {
  patientName: string;
  /** The dentist this member's plan is attributed to on the uploaded
   *  Practice Plan/Denplan statement (membership_upload_members.
   *  treating_dentist) — a plan-level relationship from the PDF, distinct
   *  from providerName (who actually delivered this visit): hygiene visits
   *  are routinely delivered by a hygienist who, correctly, never appears
   *  on the statement. null when the statement row has no dentist. */
  planDentist: string | null;
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
  /** Where this row's minutes came from: "real" = its share of the
   *  appointment's start→finish window; "configured" = Treatments-tab
   *  dentist/hygienist minutes; "catalog" = Treatment Setup duration;
   *  "none" = no source, 0 minutes. */
  durationSource: "real" | "configured" | "catalog" | "none";
  /** How this visit's labourCost was priced — the delivering provider's own
   *  current Split Configuration (per-hour/flat-percentage/sliding-scale/
   *  per-case); "percent-zero" when a %-split IS configured but derived
   *  nothing this month (the fees of the plan members they treated didn't
   *  cover their plan work's lab/material cost, or they logged no labour
   *  minutes); or "fallback" to Treatment Setup's generic per-treatment
   *  rate when that provider has nothing usable configured at all. */
  payMethod: "per-hour" | "flat-percentage" | "sliding-scale" | "per-case" | "percent-zero" | "fallback";
  labourCost: number;
  materialsLabCost: number;
  totalCost: number;
  /** The real worked sum behind labourCost for THIS visit — rate/% source,
   *  minutes, and the resulting £, in the same live-calculation shape the
   *  ledger tooltips already use (never a description of the method). */
  calc: CalcRow[];
}

export interface MarginData {
  isLoading: boolean;
  hasUploadData: boolean;
  totalRevenue: number;
  totalCosts: number;
  contribution: number;
  contributionPct: number | null;
  /** True when the header range spans more than one statement month — the
   *  whole tab (cash, cost window, visits, hours) then covers that range,
   *  and period labels should not say "monthly". */
  isMultiMonth: boolean;
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
  /** Annual view of the same chart: 12× monthly fee vs trailing-12-month
   *  plan-covered cost, buckets at 12× the monthly edges — smooths the
   *  visit-month artifact (an annual entitlement delivered in one month
   *  always out-costs that single month's fee). */
  annualDistribution: MarginDistBucket[];
  /** Live worked sum behind the Margin-per-member chart — member counts
   *  (with/without a costed visit) and the real fee/cost/margin averages,
   *  in the same CalcRow tooltip shape the ledger rows use. */
  distributionCalc: CalcRow[];
  annualDistributionCalc: CalcRow[];
  /** Separately-billed private treatments delivered to plan members this
   *  month — excluded from every cost figure (they carry their own
   *  revenue); surfaced so the exclusion is visible, never silent. */
  privateWorkCount: number;
  privateWorkValue: number;
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
  "percent-zero": "% split that derived £0 in the period — Treatment Setup rate",
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
  if (rows.length === 0) return [{ label: "Visits in period", value: "0" }];
  const timed = rows.filter((li) => li.durationMin > 0);
  const untimed = rows.length - timed.length;
  const calc: Array<{ label: string; value: string; isTotal?: boolean }> = [
    { label: "Visits in period", value: nn(rows.length) },
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
  calc.push({ label: "= Cost, each visit's own provider rate", value: gbpExact(totalCost), isTotal: true });
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

// The annual view's buckets are the monthly edges × 12, so the two charts
// describe the same member with the same colour when their months are even.
const ANNUAL_DIST_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "Loses over £24", min: -Infinity, max: -24 },
  { label: "Loses up to £24", min: -24, max: 0 },
  { label: "£0 to £24", min: 0, max: 24 },
  { label: "£24 to £48", min: 24, max: 48 },
  { label: "£48 to £72", min: 48, max: 72 },
  { label: "Over £72", min: 72, max: Infinity },
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
 *  cost still comes from Treatment Setup — only labour moved off it. An
 *  "Allocated overhead" line (Treatment Setup's hourly chair rate ×
 *  appointment window + finance fee) was part of this ledger and of every
 *  cost/contribution figure until 2026-08-19, when the client asked for it
 *  to be removed from the logic entirely — cost to serve is labour +
 *  materials/lab only. When a treatment has been hand-
 *  picked into the Treatments tab (membership_treatment_settings, migration
 *  20260816000001), its membership-only dentist/hygienist TIME SPLIT (not
 *  its pay method) overrides the general catalog's values for that
 *  treatment's rows here ONLY — every other page keeps reading the
 *  untouched catalog. Clinician/hygiene hours
 *  come from the REAL delivered
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
  const { members: uploadedMembers, totalMembers, displayMonth, effectivePairs } = useMembershipUploadData();
  const { treatments: dbTreatments } = useTreatments();
  const { settings: membershipTreatmentSettings } = useMembershipTreatmentSettings();
  // Range-aware since 2026-08-20 (client: "clinician and hygiene hours
  // incorrect - check with wide date range" — the tab used to anchor on the
  // range's LAST month only, so a 4-month range showed one month's visits/
  // hours/cash). Cash received sums every statement month in range;
  // the cost window below spans the same months. Single-month ranges are
  // byte-for-byte the previous behavior (effectivePairs = one pair).
  const statementQ = useMembershipStatementInsights(effectivePairs);
  const pairsKey = effectivePairs.map((p) => `${p.year}-${p.month}`).join(",");
  const isMultiMonth = effectivePairs.length > 1;

  const [monthStart, monthEnd] = useMemo(() => {
    if (effectivePairs.length === 0) return [null, null] as const;
    const sorted = [...effectivePairs].sort((a, b) => a.year - b.year || a.month - b.month);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return [new Date(first.year, first.month - 1, 1), new Date(last.year, last.month, 0)] as const;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairsKey]);

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
        (m) =>
          m.patient_id &&
          m.mapped_plan_id &&
          // Ownership rule (2026-08-20): the upload location owns the row;
          // patient home only for legacy unstamped rows — same rule the
          // members query itself applies, kept here as belt-and-braces.
          (!selectedLocationId || (m.upload_location_id ?? m.location_id) === selectedLocationId),
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
      pairsKey,
    ],
    enabled:
      !!organizationId && !!displayMonth && effectivePairs.length > 0 &&
      matchedMembers.length > 0 && costFieldsByExternalId.size > 0,
    queryFn: async () => {
      // Same window as Cash received (the header range's effective
      // statement months) — NOT a trailing 12 months. Revenue and cost must
      // describe the SAME window: comparing one month's statement against a
      // 12-month cost total understated margin by roughly 12x (a real bug:
      // −460% instead of a plausible figure); comparing a 4-month range's
      // statements against one month's costs was the mirror-image bug.
      const fromISO = ukDayStartInstant(monthStart!);
      const toISO = ukDayEndInstant(monthEnd!);

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

      // netDue = the kept row's own (latest) month's payment — the true
      // MONTHLY fee. rangeNetDue = their collected £ summed over every month
      // in the header range (equals netDue for a single-month range). All
      // range-window revenue below must use rangeNetDue; the ×12 annual
      // distribution keeps netDue (12 × a real monthly fee).
      type ResolvedMember = { patientId: string; ptId: string; locationId: string | null; netDue: number; rangeNetDue: number; treatingDentist: string | null };
      const resolved: ResolvedMember[] = [];
      for (const m of matchedMembers) {
        const ptId = keyToPtId.get(String(m.patient_id).trim());
        if (!ptId) continue;
        resolved.push({
          patientId: m.patient_id!,
          ptId,
          // OWNING location (upload location; patient home for legacy
          // unstamped rows) — drives the Contribution-by-site split, so a
          // selected location's view never lists other sites just because
          // a member's patient record is registered elsewhere.
          locationId: m.upload_location_id ?? m.location_id,
          netDue: m.net_due || 0,
          rangeNetDue: m.range_net_due ?? m.net_due ?? 0,
          treatingDentist: m.treating_dentist ?? null,
        });
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
      // appointments). The window is the PRIMARY time source (client
      // request 2026-08-20: "based on appointment start and appointment end
      // time"), SHARED EQUALLY across the plan-covered non-xray treatments
      // delivered in the same physical appointment — one visit's chair time
      // must never count twice just because two items were charted in it.
      // Falls back to the Treatments-tab configured minutes, then the
      // Treatment Setup catalog's duration_minutes.
      const taIds = Array.from(
        new Set(
          tpiRows
            .map((r) => Number(r.tpi_treatment_appointment_id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      );
      const apptInfoByTa = await fetchApptInfoByTa(taIds, organizationId!);
      const rowsPerApmt = new Map<number, number>();
      for (const row of tpiRows) {
        if (row.tpi_treatment_id == null) continue;
        const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
        if (!t || t.visitType === "xray") continue;
        if (!isPlanCovered(t.visitType, t.name, Number(row.tpi_price) || 0)) continue;
        const info = apptInfoByTa.get(Number(row.tpi_treatment_appointment_id));
        if (!info || info.minutes <= 0) continue;
        rowsPerApmt.set(info.apmtId, (rowsPerApmt.get(info.apmtId) ?? 0) + 1);
      }
      /** This row's share of its appointment's real start→finish window —
       *  null when the appointment has no recorded window. */
      const sharedRealMinutes = (taId: number): number | null => {
        const info = apptInfoByTa.get(taId);
        if (!info || info.minutes <= 0) return null;
        return info.minutes / (rowsPerApmt.get(info.apmtId) || 1);
      };

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
      // every plan visit. Instead: the provider's membership revenue base is
      // the MONTHLY FEES (net_due) OF THE PLAN MEMBERS THEY THEMSELVES
      // DELIVERED TREATMENTS TO this month — client rule 2026-08-19
      // ("check the patients which have got the treatments under the
      // membership plan, based on that we can get the revenue for the
      // percentage values"). This replaced the Production Data "Membership"
      // column, which attributes ALL statement revenue to each plan's
      // treating dentist and so gave every delivering hygienist/other
      // dentist a £0 base ("% of £0" fallbacks). A member treated by two
      // providers counts in BOTH providers' bases — this is a pay basis per
      // provider, not a P&L that must sum to the statement. From that base:
      // subtract this month's real lab+material cost (Treatments tab) for
      // their plan-member work, apply their % (flat, or the blended rate a
      // sliding-scale band works out to) to get their monthly membership
      // commission, then divide by their own real labour minutes this month
      // to get an effective £/minute — applied per visit by that visit's
      // own minutes. Same shape as per-hour, just with a derived rate
      // instead of a typed-in one — price is only ever touched in this one
      // monthly aggregate, so a single £0 visit can no longer zero out its
      // own cost.
      const priceBasedExtIds = deliveringExternalIds.filter((extId) => {
        const providerId = providerIdByExternalId.get(extId);
        const method = providerId ? providerSnapshotById.get(providerId)?.splitSourceMethod : null;
        return method === "flat-percentage" || method === "sliding-scale";
      });

      // Per-provider real labour minutes and lab+material cost across their
      // OWN plan-member delivered treatments in the period — minutes use the
      // SAME source order as the main loop below (shared real appointment
      // window → Treatments-tab configured time → catalog), or the derived
      // £/minute stops reconciling with the per-visit sums it prices.
      const totalLaborMinutesByExtId = new Map<string, number>();
      const labMaterialFeesByExtId = new Map<string, number>();
      for (const row of tpiRows) {
        if (row.tpi_treatment_id == null || row.tpi_practitioner_id == null) continue;
        const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
        if (!t) continue;
        // Plan-covered work only — private visits are excluded from the whole
        // cost model (see isPlanCovered), so their minutes/materials must not
        // shape the membership commission either.
        if (!isPlanCovered(t.visitType, t.name, Number(row.tpi_price) || 0)) continue;
        const override = t.membershipOverride;
        const overrideDentistMin = override?.dentistTimeMinutes ?? null;
        const overrideHygienistMin = override?.hygienistTimeMinutes ?? null;
        const overrideTotalMin =
          overrideDentistMin != null || overrideHygienistMin != null
            ? (overrideDentistMin ?? 0) + (overrideHygienistMin ?? 0)
            : null;
        const laborTimeMin =
          sharedRealMinutes(Number(row.tpi_treatment_appointment_id)) ?? overrideTotalMin ?? t.durationMin;
        const extId = String(row.tpi_practitioner_id);
        // X-ray items get no labour in the main loop (see the xray skip
        // there), so their minutes must stay out of this denominator too —
        // otherwise the effective £/minute under-allocates and the per-visit
        // labour sum stops adding back up to the monthly commission. Their
        // material/lab cost is still real and still nets off revenue.
        if (t.visitType !== "xray") {
          totalLaborMinutesByExtId.set(extId, (totalLaborMinutesByExtId.get(extId) ?? 0) + laborTimeMin);
        }
        const material = override?.materialCost ?? t.material;
        const lab = override?.labCost ?? t.lab;
        labMaterialFeesByExtId.set(extId, (labMaterialFeesByExtId.get(extId) ?? 0) + material + lab);
      }

      // Membership revenue base per provider: the monthly fees (net_due) of
      // the DISTINCT matched plan members this provider delivered treatments
      // to this month. Members are collected from the same TPI rows the
      // costing loop prices, minus x-ray items (which carry no labour — a
      // provider who only x-rayed a member shouldn't earn that member's fee
      // as % base). A member seen by two providers counts for both — pay
      // basis per provider, not a statement reconciliation.
      const membershipRevenueByExtId = new Map<string, number>();
      if (priceBasedExtIds.length > 0) {
        // Range fee: the commission base must cover the same window as the
        // labour minutes it's divided by, or the derived £/minute is ~N×
        // too low on an N-month range.
        const netDueByPt = new Map(resolved.map((m) => [m.ptId, m.rangeNetDue]));
        const membersByExtId = new Map<string, Set<string>>();
        for (const row of tpiRows) {
          if (row.tpi_practitioner_id == null || row.tpi_treatment_id == null) continue;
          const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
          if (!t || t.visitType === "xray") continue;
          // A private crown/extraction is not "treating them under the plan"
          // — only plan-covered visits earn a member's fee into the base.
          if (!isPlanCovered(t.visitType, t.name, Number(row.tpi_price) || 0)) continue;
          const ptKey = String(row.tpi_patient_id);
          if (!netDueByPt.has(ptKey)) continue;
          const extId = String(row.tpi_practitioner_id);
          let set = membersByExtId.get(extId);
          if (!set) { set = new Set(); membersByExtId.set(extId, set); }
          set.add(ptKey);
        }
        for (const [extId, memberSet] of membersByExtId) {
          let sum = 0;
          for (const pt of memberSet) sum += netDueByPt.get(pt) ?? 0;
          membershipRevenueByExtId.set(extId, sum);
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
      // The % actually applied per provider (their flat split, or the blended
      // rate their sliding-scale bands work out to) — kept alongside the
      // effective rate so the per-visit tooltip can show the real worked sum
      // (revenue → net → commission → rate), not just the final £/min.
      const pctUsedByProviderId = new Map<string, number>();
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
        pctUsedByProviderId.set(providerId, pct);
        const membershipRevenue = membershipRevenueByExtId.get(extId) ?? 0;
        const labMaterialFees = labMaterialFeesByExtId.get(extId) ?? 0;
        const netRevenue = membershipRevenue - labMaterialFees;
        const monthlyCommission = netRevenue * pct;
        const totalLaborMinutes = totalLaborMinutesByExtId.get(extId) ?? 0;
        // A provider whose attributed monthly Membership revenue doesn't
        // even cover their plan work's lab+material cost derives a NEGATIVE
        // £/minute here, which turned every one of their visits into a
        // labour CREDIT (client-flagged "-£2.14" rows). A negative labour
        // cost is never real — leave the rate unset so those visits fall
        // through to Treatment Setup's generic rate below, flagged in the
        // detail table like any other unusable configuration.
        if (totalLaborMinutes > 0 && monthlyCommission > 0) {
          effectiveRatePerMinuteByProviderId.set(providerId, monthlyCommission / totalLaborMinutes);
        }
      }

      const locationIdByPtId = new Map(resolved.map((m) => [m.ptId, m.locationId]));
      // Range fee — compared against the same range's costByPtId in the
      // monthly distribution. The TRUE monthly fee is kept separately for
      // the ×12 annual view (12 × a 4-month sum would be 48 months).
      const netDueByPtId = new Map(resolved.map((m) => [m.ptId, m.rangeNetDue]));
      const monthlyNetDueByPtId = new Map(resolved.map((m) => [m.ptId, m.netDue]));
      // Plan-level treating dentist from the uploaded statement, keyed the
      // same way as the other member maps. Rows with no dentist recorded
      // never overwrite one that has it (re-uploads can duplicate a member
      // across rows, not all equally complete).
      const planDentistByPtId = new Map<string, string>();
      for (const m of resolved) {
        if (m.treatingDentist && !planDentistByPtId.has(m.ptId)) planDentistByPtId.set(m.ptId, m.treatingDentist);
      }

      let clinicianCost = 0, clinicianMinutes = 0, clinicianTreatments = 0;
      let hygieneCost = 0, hygieneMinutes = 0, hygieneTreatments = 0;
      let materialsLab = 0;
      // Real components behind the Materials ledger tooltip — the actual
      // TPI-row count (a dentist+hygienist split adds to BOTH clinician/
      // hygiene counters, so their sum can overstate it) and the
      // materials-vs-lab split, with £0-costed rows counted separately.
      // NOTE: an "Allocated overhead" line (Treatment Setup's hourly chair
      // rate × appointment window + finance fee) used to be part of this
      // ledger and of every cost/contribution figure — removed 2026-08-19
      // at the client's request ("hide this from logic"): cost to serve is
      // labour + materials/lab only.
      let costedTreatments = 0;
      let materialsTotal = 0, labTotal = 0, materialsLabZeroCount = 0;
      let privateWorkCount = 0, privateWorkValue = 0;
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
        // Separately-billed private work delivered to a plan member —
        // excluded from cost to serve entirely (it has its own invoice and
        // its own revenue); counted so the UI can say what was left out.
        if (!isPlanCovered(t.visitType, t.name, price)) {
          privateWorkCount += 1;
          privateWorkValue += price;
          continue;
        }
        const override = t.membershipOverride;
        // Membership-only override: material/lab cost, when set, replace the
        // general catalog's material_cost/lab_bill for this row.
        // therapist_pay_rate (the flat labor £) stays catalog-sourced — the
        // Treatments tab only captures time and lab/material cost, not a
        // membership-specific rate.
        const material = override?.materialCost ?? t.material;
        const lab = override?.labCost ?? t.lab;
        // X-ray items (bitewings, periapicals, OPGs — classifyVisitType's
        // xray bucket) carry NO labour cost or minutes and never appear in
        // the Clinician/Hygiene visit tables: the image is taken inside the
        // exam or hygiene visit whose own minutes already cover that time —
        // client rule 2026-08-19 ("no xray appointments considered" in the
        // associates/hygiene tables). Their material/lab cost still counts
        // below so Materials and lab keeps describing every delivered item.
        if (t.visitType === "xray") {
          materialsLab += material + lab;
          costedTreatments += 1;
          materialsTotal += material;
          labTotal += lab;
          if (material + lab === 0) materialsLabZeroCount += 1;
          if (t.price > price) { discountForgone += t.price - price; discountedTreatments += 1; }
          const ptKey = String(row.tpi_patient_id);
          const unitCost = material + lab;
          costByPtId.set(ptKey, (costByPtId.get(ptKey) ?? 0) + unitCost);
          const locId = locationIdByPtId.get(ptKey) ?? row.location_id ?? null;
          if (locId) costByLocation.set(locId, (costByLocation.get(locId) ?? 0) + unitCost);
          continue;
        }

        // Labour TIME: this row's share of the appointment's real
        // start→finish window (client request 2026-08-20 — "based on
        // appointment start and appointment end time"; shared equally when
        // several treatments were delivered in the same appointment, so the
        // visit tables sum to the real chair time). Falls back to the
        // Treatments-tab configured dentist/hygienist minutes, then the
        // catalog's duration estimate; with none of the three this row
        // contributes £ cost but 0 minutes — tracked so the gap is visible
        // rather than silently understating the hours. The Treatments-tab
        // dentist:hygienist RATIO still drives the split below regardless
        // of which source supplied the time.
        const sharedReal = sharedRealMinutes(Number(row.tpi_treatment_appointment_id));
        const overrideDentistMin = override?.dentistTimeMinutes ?? null;
        const overrideHygienistMin = override?.hygienistTimeMinutes ?? null;
        const overrideTotalMin =
          overrideDentistMin != null || overrideHygienistMin != null
            ? (overrideDentistMin ?? 0) + (overrideHygienistMin ?? 0)
            : null;
        const durationSource: MarginLineItem["durationSource"] =
          sharedReal != null ? "real" : overrideTotalMin != null ? "configured" : t.durationMin > 0 ? "catalog" : "none";
        const laborTimeMin = sharedReal ?? overrideTotalMin ?? t.durationMin;

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
          // Treatment Setup's generic rate, same as every treatment used
          // before this fix. Two distinct reasons land here, labelled
          // differently: "percent-zero" = a %-split IS configured (the pct
          // resolved) but derived nothing this month — the fees of the plan
          // members they treated didn't cover their plan work's lab/material
          // cost, or they logged no labour minutes; "fallback" = nothing
          // usable configured at all. Labelling both "Not configured" made
          // correctly-configured providers look broken (client-flagged).
          laborCost = t.therapist + price * (t.percentFees / 100);
          payMethod = providerId != null && pctUsedByProviderId.has(providerId) ? "percent-zero" : "fallback";
        }

        // Live worked sum behind labourCost — the real rate/% source,
        // minutes and £ for THIS treatment, in the ledger tooltips' own
        // CalcRow shape, not a sentence describing the method. Ends with
        // this treatment's full labour cost; a dentist/hygienist split (below)
        // appends one more line dividing that into this row's own share.
        // Pence-exact throughout (gbpExact / gbpRate, never whole-pound
        // gbp) — these per-visit sums are routinely under £1, where any
        // rounding turns a real figure into a meaningless "£0".
        const laborCalc: CalcRow[] = [];
        if (payMethod === "per-hour") {
          const rate = getEffectivePerHourRate(snapshot!.perHourRate!, snapshot!.employmentType);
          laborCalc.push(
            { label: "Per-hour rate", value: gbpExact(rate) },
            { label: "This visit's minutes", value: `${Math.round(laborTimeMin * 100) / 100} min` },
            { label: "= Labour cost", value: gbpExact(laborCost), isTotal: true },
          );
        } else if (payMethod === "per-case") {
          laborCalc.push({ label: "= Labour cost (flat per-case rate)", value: gbpExact(laborCost), isTotal: true });
        } else if (payMethod === "flat-percentage" || payMethod === "sliding-scale") {
          const membershipRevenue = membershipRevenueByExtId.get(practitionerExtId!) ?? 0;
          const labMaterialFees = labMaterialFeesByExtId.get(practitionerExtId!) ?? 0;
          const netRevenue = membershipRevenue - labMaterialFees;
          const pct = pctUsedByProviderId.get(providerId!) ?? 0;
          const totalLaborMinutes = totalLaborMinutesByExtId.get(practitionerExtId!) ?? 0;
          const effectiveRate = effectiveRatePerMinuteByProviderId.get(providerId!) ?? 0;
          laborCalc.push(
            { label: "Fees of plan members they treated in the period", value: gbpExact(membershipRevenue) },
            { label: "− lab/material cost on their plan work in the period", value: gbpExact(labMaterialFees) },
            { label: "= Net revenue", value: gbpExact(netRevenue) },
            {
              label: `× their ${payMethod === "sliding-scale" ? "blended sliding-scale" : "split"} ${(pct * 100).toFixed(1)}%`,
              value: gbpExact(netRevenue * pct),
            },
            { label: "÷ their total labour minutes in the period", value: `${nn(totalLaborMinutes)} min` },
            { label: "= Effective rate per minute", value: gbpRate(effectiveRate) },
            { label: "× this visit's minutes", value: `${Math.round(laborTimeMin * 100) / 100} min` },
            { label: "= Labour cost", value: gbpExact(laborCost), isTotal: true },
          );
        } else if (payMethod === "percent-zero") {
          const membershipRevenue = membershipRevenueByExtId.get(practitionerExtId!) ?? 0;
          const labMaterialFees = labMaterialFeesByExtId.get(practitionerExtId!) ?? 0;
          const pct = pctUsedByProviderId.get(providerId!) ?? 0;
          laborCalc.push(
            { label: "Fees of plan members they treated in the period", value: gbpExact(membershipRevenue) },
            { label: "− lab/material on their plan work", value: gbpExact(labMaterialFees) },
            { label: `× their split ${(pct * 100).toFixed(1)}%`, value: gbpExact((membershipRevenue - labMaterialFees) * pct) },
            { label: "Nothing to price from — Treatment Setup rate", value: gbpExact(t.therapist) },
            { label: `+ ${t.percentFees}% of this visit's price (${gbpExact(price)})`, value: gbpExact(price * (t.percentFees / 100)) },
            { label: "= Labour cost", value: gbpExact(laborCost), isTotal: true },
          );
        } else {
          laborCalc.push(
            { label: "Treatment Setup rate (no usable Split Configuration)", value: gbpExact(t.therapist) },
            { label: `+ ${t.percentFees}% of this visit's price (${gbpExact(price)})`, value: gbpExact(price * (t.percentFees / 100)) },
            { label: "= Labour cost", value: gbpExact(laborCost), isTotal: true },
          );
        }

        // Rows this one treatment contributes to the visit list — normally
        // just one, but a genuine dentist+hygienist split (both minutes set)
        // becomes two, one per share, so each ledger line's detail table
        // sums to exactly that line's total (never a combined row credited
        // whole to whichever side happened to have the larger share).
        const rows: Array<{ type: "clinician" | "hygiene"; labourCost: number; durationMin: number; calc: CalcRow[] }> = [];
        if (override && (override.dentistTimeMinutes != null || override.hygienistTimeMinutes != null)) {
          // Membership-configured split: this treatment's own dentist/
          // hygienist minute RATIO decides how the labor cost and hours are
          // divided between the two ledger lines, regardless of which
          // provider actually delivered any one appointment — reflects the
          // practice's typical staffing for this treatment under
          // membership, not that one appointment's real assignment. The
          // TIME being divided is laborTimeMin (the real appointment-window
          // share when recorded), not the configured minutes themselves.
          const dentistMin = override.dentistTimeMinutes ?? 0;
          const hygienistMin = override.hygienistTimeMinutes ?? 0;
          const totalOverrideMin = dentistMin + hygienistMin;
          const hygieneShare = totalOverrideMin > 0 ? hygienistMin / totalOverrideMin : 0;
          const hygienePortion = laborCost * hygieneShare;
          const clinicianPortion = laborCost * (1 - hygieneShare);
          const hygieneTimeMin = laborTimeMin * hygieneShare;
          const clinicianTimeMin = laborTimeMin - hygieneTimeMin;
          hygieneCost += hygienePortion;
          hygieneMinutes += hygieneTimeMin;
          if (hygienistMin > 0) {
            hygieneTreatments += 1;
            rows.push({
              type: "hygiene",
              labourCost: hygienePortion,
              durationMin: hygieneTimeMin,
              calc: [...laborCalc, { label: `× hygienist's share of time (${hygienistMin}/${totalOverrideMin} min)`, value: gbpExact(hygienePortion), isTotal: true }],
            });
          }
          clinicianCost += clinicianPortion;
          clinicianMinutes += clinicianTimeMin;
          if (dentistMin > 0) {
            clinicianTreatments += 1;
            rows.push({
              type: "clinician",
              labourCost: clinicianPortion,
              durationMin: clinicianTimeMin,
              calc: [...laborCalc, { label: `× dentist's share of time (${dentistMin}/${totalOverrideMin} min)`, value: gbpExact(clinicianPortion), isTotal: true }],
            });
          }
        } else {
          const isHygiene = row.tpi_practitioner_id != null && hygienistExternalIds.has(String(row.tpi_practitioner_id));
          if (isHygiene) {
            hygieneCost += laborCost;
            hygieneMinutes += laborTimeMin;
            hygieneTreatments += 1;
          } else {
            clinicianCost += laborCost;
            clinicianMinutes += laborTimeMin;
            clinicianTreatments += 1;
          }
          rows.push({ type: isHygiene ? "hygiene" : "clinician", labourCost: laborCost, durationMin: laborTimeMin, calc: laborCalc });
        }
        materialsLab += material + lab;
        costedTreatments += 1;
        materialsTotal += material;
        labTotal += lab;
        if (material + lab === 0) materialsLabZeroCount += 1;
        if (t.price > price) { discountForgone += t.price - price; discountedTreatments += 1; }

        const ptKey = String(row.tpi_patient_id);
        const unitCost = material + lab + laborCost;
        costByPtId.set(ptKey, (costByPtId.get(ptKey) ?? 0) + unitCost);

        // Member's OWNING location first (same site as their revenue in
        // netCashByLocation) — attributing by the TPI's own location put a
        // member's costs at another site than their £, painting phantom
        // negative-contribution rows for sites the header never selected.
        const locId = locationIdByPtId.get(ptKey) ?? row.location_id ?? null;
        if (locId) costByLocation.set(locId, (costByLocation.get(locId) ?? 0) + unitCost);

        // Materials/lab aren't split by the override (only labour/time is) —
        // attribute them to the first row only so summing materialsLabCost/
        // totalCost across a split's two rows doesn't double-count them.
        rows.forEach((r, i) => {
          const materialsLabCost = i === 0 ? material + lab : 0;
          lineItems.push({
            patientName: nameByPtId.get(ptKey) ?? `Patient #${ptKey}`,
            planDentist: planDentistByPtId.get(ptKey) ?? null,
            providerName: practitionerExtId ? providerNameByExternalId.get(practitionerExtId) ?? "Unknown provider" : "Unknown provider",
            treatmentName: t.name,
            date: row.tpi_completed_at,
            type: r.type,
            durationMin: r.durationMin,
            durationSource,
            payMethod,
            labourCost: r.labourCost,
            calc: r.calc,
            materialsLabCost,
            totalCost: r.labourCost + materialsLabCost,
          });
        });
      }

      for (const m of resolved) {
        if (m.locationId) netCashByLocation.set(m.locationId, (netCashByLocation.get(m.locationId) ?? 0) + m.rangeNetDue);
      }

      // ── Annualised cost per member: trailing 12 months (ending at the
      // display month) of PLAN-COVERED visits for the same members, priced
      // with the same machinery. Per-hour/per-case rates are exact;
      // %-based labour uses the provider's CURRENT derived £/minute (each
      // historical month had its own base — a stated approximation, noted
      // in the tab footnote). Purpose: one visit-heavy month can never
      // out-cost a single month's fee honestly (the entitlement is annual),
      // so the distribution needs a 12×fee vs 12-months-of-servicing view
      // before a regular attender is read as a loss.
      const annualCostByPtId = new Map<string, number>();
      {
        const annualFromISO = ukDayStartInstant(new Date(displayMonth!.year, displayMonth!.month - 12, 1));
        const yearRows: typeof tpiRows = [];
        let yFrom = 0;
        let yMore = true;
        while (yMore) {
          const { data, error } = await (supabase as any)
            .from("treatment_plan_items")
            .select("tpi_patient_id, tpi_treatment_id, tpi_price, tpi_practitioner_id, tpi_treatment_appointment_id, tpi_completed_at, location_id")
            .eq("organization_id", organizationId)
            .eq("tpi_completed", true)
            .gt("tpi_treatment_appointment_id", 0)
            .not("tpi_completed_at", "is", null)
            .gte("tpi_completed_at", annualFromISO)
            .lte("tpi_completed_at", toISO)
            .in("tpi_patient_id", ptIds)
            .is("deleted_at", null)
            .range(yFrom, yFrom + PAGE_SIZE - 1);
          if (error) throw error;
          yearRows.push(...(data ?? []));
          yMore = (data?.length ?? 0) === PAGE_SIZE;
          yFrom += PAGE_SIZE;
        }
        const yTaIds = Array.from(
          new Set(
            yearRows.map((r) => Number(r.tpi_treatment_appointment_id)).filter((id) => Number.isFinite(id) && id > 0),
          ),
        );
        // Same time-source order as the in-range loop: shared real
        // appointment window → Treatments-tab minutes → catalog.
        const yInfoByTa = await fetchApptInfoByTa(yTaIds, organizationId!);
        const yRowsPerApmt = new Map<number, number>();
        for (const row of yearRows) {
          if (row.tpi_treatment_id == null) continue;
          const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
          if (!t || t.visitType === "xray") continue;
          if (!isPlanCovered(t.visitType, t.name, Number(row.tpi_price) || 0)) continue;
          const info = yInfoByTa.get(Number(row.tpi_treatment_appointment_id));
          if (!info || info.minutes <= 0) continue;
          yRowsPerApmt.set(info.apmtId, (yRowsPerApmt.get(info.apmtId) ?? 0) + 1);
        }
        for (const row of yearRows) {
          if (row.tpi_treatment_id == null) continue;
          const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
          if (!t) continue;
          const price = Number(row.tpi_price) || 0;
          if (!isPlanCovered(t.visitType, t.name, price)) continue;
          const override = t.membershipOverride;
          const material = override?.materialCost ?? t.material;
          const lab = override?.labCost ?? t.lab;
          const ptKey = String(row.tpi_patient_id);
          if (t.visitType === "xray") {
            annualCostByPtId.set(ptKey, (annualCostByPtId.get(ptKey) ?? 0) + material + lab);
            continue;
          }
          const yInfo = yInfoByTa.get(Number(row.tpi_treatment_appointment_id));
          const ySharedReal =
            yInfo != null && yInfo.minutes > 0 ? yInfo.minutes / (yRowsPerApmt.get(yInfo.apmtId) || 1) : null;
          const overrideDentistMin = override?.dentistTimeMinutes ?? null;
          const overrideHygienistMin = override?.hygienistTimeMinutes ?? null;
          const overrideTotalMin =
            overrideDentistMin != null || overrideHygienistMin != null
              ? (overrideDentistMin ?? 0) + (overrideHygienistMin ?? 0)
              : null;
          const laborTimeMin = ySharedReal ?? overrideTotalMin ?? t.durationMin;
          const extId = row.tpi_practitioner_id != null ? String(row.tpi_practitioner_id) : null;
          const providerId = extId ? providerIdByExternalId.get(extId) : null;
          const snapshot = providerId ? providerSnapshotById.get(providerId) : null;
          const method = snapshot?.splitSourceMethod || "flat-percentage";
          let labour: number | null = null;
          if (method === "per-hour" && snapshot?.perHourRate) {
            labour = getEffectivePerHourRate(snapshot.perHourRate, snapshot.employmentType) * (laborTimeMin / 60);
          } else if (method === "per-case" && snapshot?.perCaseRate) {
            labour = snapshot.perCaseRate;
          } else if (
            (method === "flat-percentage" || method === "sliding-scale") &&
            providerId &&
            effectiveRatePerMinuteByProviderId.has(providerId)
          ) {
            labour = effectiveRatePerMinuteByProviderId.get(providerId)! * laborTimeMin;
          }
          if (labour == null) labour = t.therapist + price * (t.percentFees / 100);
          annualCostByPtId.set(ptKey, (annualCostByPtId.get(ptKey) ?? 0) + labour + material + lab);
        }
      }

      return {
        clinicianCost, clinicianMinutes, clinicianTreatments,
        hygieneCost, hygieneMinutes, hygieneTreatments,
        materialsLab,
        costedTreatments,
        materialsTotal, labTotal, materialsLabZeroCount,
        privateWorkCount, privateWorkValue,
        discountForgone, discountedTreatments, costByPtId, netDueByPtId, monthlyNetDueByPtId, netCashByLocation, costByLocation,
        annualCostByPtId,
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
    queryFn: async (): Promise<{ value: number; count: number; eligibleCount: number; checkedCount: number }> => {
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
      if (resolved.length === 0) return { value: 0, count: 0, eligibleCount: 0, checkedCount: 0 };
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
      return { value, count, eligibleCount, checkedCount: resolved.length };
    },
  });

  // Non-plan patient cohort for "Chair time displaced" (real private £/hour
  // yield) and "Private spend uplift" / the category table — a real
  // comparison group, not estimated. "Non-plan" = a patient whose Dentally
  // payment plan is NOT one of the org's MEMBERSHIP plans (the plans the
  // upload's categories are mapped to) — NOT "pt_payment_plan_id IS NULL":
  // Dentally's payment plans include the NHS/Private billing categories, so
  // at a practice that sets one on everybody (this org: 36.9k NHS + 18.3k
  // Private patients, zero nulls) the IS NULL definition yields an empty
  // cohort and blanked this whole section. Cohort membership is read off
  // each TPI's own tpi_payment_plan_id, so no 50k-patient fetch is needed —
  // only a head-count for the per-patient divisor.
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

      // The org's MEMBERSHIP plans' Dentally ids — the plans the uploaded
      // categories are actually mapped to. A patient/TPI on any OTHER plan
      // (NHS, Private, etc.) is the non-plan cohort.
      const mappedPlanIds = Array.from(new Set(matchedMembers.map((m) => m.mapped_plan_id!)));
      const { data: membershipPlanRows, error: mpErr } = await (supabase as any)
        .from("payment_plans")
        .select("pp_id")
        .in("id", mappedPlanIds);
      if (mpErr) throw mpErr;
      const membershipPpIds = new Set<string>(
        (membershipPlanRows ?? []).map((p: any) => String(p.pp_id)).filter((id: string) => id !== "null"),
      );

      // Head-count only (no rows): how many patients sit in the non-plan
      // cohort — the per-patient divisor for the category table.
      let nonPlanQ = (supabase as any)
        .from("patients")
        .select("pt_id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("deleted_at", null);
      if (membershipPpIds.size > 0) {
        nonPlanQ = nonPlanQ.or(
          `pt_payment_plan_id.is.null,pt_payment_plan_id.not.in.(${Array.from(membershipPpIds).join(",")})`,
        );
      }
      if (selectedLocationId) nonPlanQ = nonPlanQ.eq("location_id", selectedLocationId);
      const { count: nonPlanTotalCount, error: nonPlanErr } = await nonPlanQ;
      if (nonPlanErr) throw nonPlanErr;

      const PAGE_SIZE = 1000;
      const tpiRows: Array<{
        tpi_patient_id: number | string;
        tpi_treatment_id: number | string | null;
        tpi_price: number | string | null;
        tpi_treatment_appointment_id: number | string | null;
        tpi_payment_plan_id: number | string | null;
      }> = [];
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        let q = (supabase as any)
          .from("treatment_plan_items")
          .select("tpi_patient_id, tpi_treatment_id, tpi_price, tpi_treatment_appointment_id, tpi_payment_plan_id, location_id")
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
      let nonPlanPrivateTreatments = 0;

      for (const row of tpiRows) {
        if (row.tpi_treatment_id == null) continue;
        const t = costFieldsByExternalId.get(String(row.tpi_treatment_id));
        if (!t || t.treatmentType !== "private") continue;
        const price = Number(row.tpi_price) || 0;
        const ptKey = String(row.tpi_patient_id);
        const isPlan = planPtIds.has(ptKey);
        // Non-plan: this treatment's own payment plan is not one of the
        // org's membership plans (NHS/Private/etc., or none recorded) —
        // and the patient isn't a matched member.
        const rowPpId = row.tpi_payment_plan_id != null ? String(row.tpi_payment_plan_id) : null;
        const isNonPlan = !isPlan && (rowPpId == null || !membershipPpIds.has(rowPpId));
        if (!isPlan && !isNonPlan) continue;

        const map = isPlan ? planCategorySpend : nonPlanCategorySpend;
        map.set(t.categoryName, (map.get(t.categoryName) ?? 0) + price);
        if (isNonPlan) {
          nonPlanPrivateTotal += price;
          nonPlanPrivateTreatments += 1;
          const realDuration = oppApptDurationByTa.get(Number(row.tpi_treatment_appointment_id));
          nonPlanPrivateMinutes += realDuration != null && realDuration > 0 ? realDuration : t.durationMin;
        }
      }

      const categories = Array.from(new Set([...planCategorySpend.keys(), ...nonPlanCategorySpend.keys()]));
      const nonPlanCount = nonPlanTotalCount ?? 0;
      const categorySpend = categories.map((category) => ({
        category,
        planPerPatient: matchedMembers.length > 0 ? (planCategorySpend.get(category) ?? 0) / matchedMembers.length : 0,
        nonPlanPerPatient: nonPlanCount > 0 ? (nonPlanCategorySpend.get(category) ?? 0) / nonPlanCount : 0,
      }));

      const privateHourlyYield = nonPlanPrivateMinutes > 0 ? nonPlanPrivateTotal / (nonPlanPrivateMinutes / 60) : 0;

      return {
        categorySpend, nonPlanCount, privateHourlyYield,
        // Components behind privateHourlyYield, for the Chair time displaced
        // tooltip's full worked sum — never just the finished rate.
        nonPlanPrivateTotal, nonPlanPrivateMinutes, nonPlanPrivateTreatments,
      };
    },
  });

  const totalRevenue = matchedMembers.reduce((s, m) => s + (m.net_due || 0), 0);
  const totalCosts =
    marginQ.data == null
      ? 0
      : marginQ.data.clinicianCost + marginQ.data.hygieneCost + marginQ.data.materialsLab;
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
        // Penny-precision, never whole-£ (client rule 2026-08-19: no rounding
        // off £ anywhere in the membership module).
        netCash: Math.round(netCash * 100) / 100,
        costToServe: Math.round(costToServe * 100) / 100,
        contribution: Math.round(siteContribution * 100) / 100,
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
      return [{ label: "Net cash to bank", amount: totalRevenue, isTotal: true }];
    }
    return [
      { label: "Gross plan value", amount: stmt.grossValue },
      { label: "Failed collections", amount: -stmt.failedValue, isNegative: true },
      { label: "Net cash to bank", amount: stmt.totalCollectedValue, isTotal: true },
    ];
  }, [statementQ.data, totalRevenue]);

  const costToServeLedger: MarginLedgerRow[] = useMemo(() => {
    if (!marginQ.data) return [];
    const d = marginQ.data;
    return [
      {
        label: `Clinician time · ${nnHours(d.clinicianMinutes)} hrs`,
        amount: d.clinicianCost,
        calc: workedTimeCalc(d.lineItems, "clinician", d.clinicianCost),
      },
      {
        label: `Hygiene time · ${nnHours(d.hygieneMinutes)} hrs`,
        amount: d.hygieneCost,
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
        amount: d.materialsLab,
        // Real worked sum, not a formula sentence — the materials-vs-lab
        // split of the actual total, with £0-costed rows called out so the
        // treatment count and the £ visibly reconcile.
        calc: [
          { label: "Treatments in period", value: nn(d.costedTreatments) },
          ...(d.materialsLabZeroCount > 0
            ? [{ label: "— no material/lab cost set", value: `${nn(d.materialsLabZeroCount)} (£0)` }]
            : []),
          { label: "Materials, added up", value: gbpExact(d.materialsTotal) },
          { label: "+ Lab, added up", value: gbpExact(d.labTotal) },
          { label: "= Materials and lab", value: gbpExact(d.materialsLab), isTotal: true },
        ],
      },
      // "Allocated overhead" (chair rate × appointment window + finance
      // fee) was removed from this ledger AND from every cost/contribution
      // figure on 2026-08-19 at the client's request ("hide this from
      // logic") — cost to serve is labour + materials/lab only.
      {
        // Renamed from "Contribution" 2026-08-20 (client request) — this
        // ledger row only; the Contribution by Site table keeps its name.
        label: "Membership",
        amount: contribution,
        isTotal: true,
        calc: [
          { label: "Net cash to bank", value: gbpExact(totalRevenue) },
          { label: "− Clinician time", value: `−${gbpExact(d.clinicianCost)}` },
          { label: "− Hygiene time", value: `−${gbpExact(d.hygieneCost)}` },
          { label: "− Materials and lab", value: `−${gbpExact(d.materialsLab)}` },
          { label: "= Membership", value: gbpExact(contribution), isTotal: true },
        ],
      },
    ];
  }, [marginQ.data, contribution, totalRevenue, totalPracticeHygieneHours]);

  const { distribution, annualDistribution, costedMemberCount, distributionCalc, annualDistributionCalc } = useMemo(() => {
    const empty = {
      distribution: DIST_BUCKETS.map((b) => ({ label: b.label, count: 0 })) as MarginDistBucket[],
      annualDistribution: ANNUAL_DIST_BUCKETS.map((b) => ({ label: b.label, count: 0 })) as MarginDistBucket[],
      costedMemberCount: 0,
      distributionCalc: [] as CalcRow[],
      annualDistributionCalc: [] as CalcRow[],
    };
    if (!marginQ.data) return empty;
    const d = marginQ.data;

    // netDueByPtId and the cost maps are built off the same resolved-member
    // key space (patients.pt_id), so iterating one covers every matched
    // member with a resolved Dentally patient link — INCLUDING members with
    // no delivered treatment in the window (cost £0, margin = full fee).
    // Each bucket carries its own live worked sum (members, fees, cost,
    // margin), and the header carries the whole-chart one — real money next
    // to every bar, not just shapes.
    const build = (
      bucketDefs: typeof DIST_BUCKETS,
      feeMap: Map<string, number>,
      costMap: Map<string, number>,
      feeMultiplier: number,
      feeLabel: string,
      visitLabel: string,
      avgFeeLabel: string,
      includePrivateLine: boolean,
    ) => {
      const agg = bucketDefs.map(() => ({ count: 0, fees: 0, cost: 0 }));
      let members = 0, withVisit = 0, totalFees = 0, totalCost = 0;
      for (const [ptKey, netDue] of feeMap) {
        const fee = netDue * feeMultiplier;
        const cost = costMap.get(ptKey) ?? 0;
        members += 1;
        if (cost > 0) withVisit += 1;
        totalFees += fee;
        totalCost += cost;
        const margin = fee - cost;
        const idx = bucketDefs.findIndex((b) => margin >= b.min && margin < b.max);
        if (idx >= 0) { agg[idx].count += 1; agg[idx].fees += fee; agg[idx].cost += cost; }
      }
      const buckets: MarginDistBucket[] = bucketDefs.map((b, i) => ({
        label: b.label,
        count: agg[i].count,
        calc:
          agg[i].count === 0
            ? [{ label: "Members", value: "0" }]
            : [
                { label: "Members", value: nn(agg[i].count) },
                { label: feeLabel, value: gbpExact(agg[i].fees) },
                { label: "− Their plan cost to serve", value: gbpExact(agg[i].cost) },
                { label: "= Combined margin", value: gbpExact(agg[i].fees - agg[i].cost), isTotal: true },
                { label: "Average per member", value: gbpExact((agg[i].fees - agg[i].cost) / agg[i].count) },
              ],
      }));
      const headerCalc: CalcRow[] =
        members === 0
          ? []
          : [
              { label: "Members in the chart", value: nn(members) },
              { label: visitLabel, value: nn(withVisit) },
              { label: "— no visit → margin = their full fee", value: nn(members - withVisit) },
              ...(includePrivateLine && d.privateWorkCount > 0
                ? [{
                    label: "Private work excluded (billed separately)",
                    value: `${nn(d.privateWorkCount)} · ${gbpExact(d.privateWorkValue)}`,
                  }]
                : []),
              { label: avgFeeLabel, value: gbpExact(totalFees / members) },
              { label: "− Average plan cost to serve", value: gbpExact(totalCost / members) },
              { label: "= Average margin per member", value: gbpExact((totalFees - totalCost) / members), isTotal: true },
            ];
      return { buckets, headerCalc, members };
    };

    // Monthly view: range fee vs the SAME range's cost (identical to the
    // previous single-month behavior when the range is one month). Annual
    // view: 12 × the member's true monthly fee vs trailing-12-month cost —
    // must NOT use the range fee (12 × a 4-month sum would be 48 months).
    const monthly = build(
      DIST_BUCKETS, d.netDueByPtId, d.costByPtId, 1,
      isMultiMonth ? "Their fees over the selected months" : "Their monthly fees",
      isMultiMonth ? "— with a plan-covered visit in the period" : "— with a plan-covered visit this month",
      isMultiMonth ? "Average fee over the selected months" : "Average monthly fee",
      true,
    );
    const annual = build(
      ANNUAL_DIST_BUCKETS, d.monthlyNetDueByPtId, d.annualCostByPtId, 12,
      "Their fees over 12 months", "— with a plan-covered visit in 12 months", "Average 12-month fee", false,
    );
    return {
      distribution: monthly.buckets,
      annualDistribution: annual.buckets,
      costedMemberCount: monthly.members,
      distributionCalc: monthly.headerCalc,
      annualDistributionCalc: annual.headerCalc,
    };
  }, [marginQ.data, isMultiMonth]);

  const planHours = marginQ.data ? (marginQ.data.clinicianMinutes + marginQ.data.hygieneMinutes) / 60 : 0;
  const chairTimeDisplaced = Math.round(planHours * (opportunityQ.data?.privateHourlyYield ?? 0) * 100) / 100;

  const privateSpendUplift = useMemo(() => {
    const cats = opportunityQ.data?.categorySpend ?? [];
    const gapPerPatient = cats.reduce((s, c) => s + (c.planPerPatient - c.nonPlanPerPatient), 0);
    return Math.round(gapPerPatient * matchedMembers.length * 100) / 100;
  }, [opportunityQ.data, matchedMembers.length]);

  const discountForgoneCalc: CalcRow[] = useMemo(() => {
    const d = marginQ.data;
    if (!d) return [];
    return [
      { label: "Treatments below Treatment Setup's private price", value: nn(d.discountedTreatments) },
      { label: "= Discount forgone, added up", value: gbpExact(d.discountForgone), isTotal: true },
    ];
  }, [marginQ.data]);

  // Full worked sum, from raw ingredients to the tile: how the non-plan
  // £/hour itself is derived (real charges ÷ real chair hours, trailing 12
  // months), then the multiplication the tile applies — never just the
  // finished rate with no visible origin (client-flagged "how is £83.89
  // calculated?").
  const chairTimeDisplacedCalc: CalcRow[] = useMemo(() => {
    const o = opportunityQ.data;
    const yieldPerHour = o?.privateHourlyYield ?? 0;
    const cohortHours = (o?.nonPlanPrivateMinutes ?? 0) / 60;
    return [
      { label: "Non-plan patients' private treatments, 12 months", value: nn(o?.nonPlanPrivateTreatments ?? 0) },
      { label: "Their charges, added up", value: gbpExact(o?.nonPlanPrivateTotal ?? 0) },
      { label: "÷ their real chair time", value: `${cohortHours.toFixed(1)} hrs` },
      { label: "= Real private £/hour", value: gbpExact(yieldPerHour) },
      { label: "× Plan members' delivered-treatment hours", value: `${planHours.toFixed(1)} hrs` },
      { label: "= Chair time displaced", value: gbpExact(chairTimeDisplaced), isTotal: true },
    ];
  }, [planHours, opportunityQ.data, chairTimeDisplaced]);

  // Full worked sum — the member funnel from everyone checked down to the
  // sleeping cohort and their money, not just the finished figure: matched
  // members → those whose plan includes exam/hygiene/x-ray visits → those
  // who took at least one such visit in the trailing 12 months vs those who
  // took NONE → the sleepers' monthly fees, averaged and summed.
  const unredeemedEntitlementCalc: CalcRow[] = useMemo(() => {
    const u = unredeemedQ.data;
    if (!u) return [];
    return [
      { label: "Matched members checked", value: nn(u.checkedCount) },
      { label: "— plan includes exam/hygiene/x-ray visits", value: nn(u.eligibleCount) },
      { label: "— took at least one, trailing 12 months", value: nn(u.eligibleCount - u.count) },
      { label: "— took none (sleeping)", value: nn(u.count) },
      ...(u.count > 0
        ? [{ label: "Their average monthly fee", value: gbpExact(u.value / u.count) }]
        : []),
      { label: "= Sleeping members' fees, added up", value: gbpExact(u.value), isTotal: true },
    ];
  }, [unredeemedQ.data]);

  const privateSpendUpliftCalc: CalcRow[] = useMemo(() => {
    const cats = opportunityQ.data?.categorySpend ?? [];
    const gapPerPatient = cats.reduce((s, c) => s + (c.planPerPatient - c.nonPlanPerPatient), 0);
    return [
      { label: "Plan vs non-plan gap per patient, all categories", value: gbpExact(gapPerPatient) },
      { label: "× Matched plan members", value: nn(matchedMembers.length) },
      { label: "= Private spend uplift", value: gbpExact(privateSpendUplift), isTotal: true },
    ];
  }, [opportunityQ.data, matchedMembers.length, privateSpendUplift]);

  return {
    isLoading: marginQ.isLoading || statementQ.isLoading || unredeemedQ.isLoading || opportunityQ.isLoading,
    hasUploadData: totalMembers > 0,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCosts: Math.round(totalCosts * 100) / 100,
    contribution: Math.round(contribution * 100) / 100,
    contributionPct: totalRevenue > 0 ? Math.round((contribution / totalRevenue) * 100) : null,
    isMultiMonth,
    bySite: bySiteNamed,
    cashReceivedLedger,
    costToServeLedger,
    costToServeLineItems: marginQ.data?.lineItems ?? [],
    totalPracticeHygieneHours: hygieneHoursQ.isLoading ? null : totalPracticeHygieneHours,
    distribution,
    annualDistribution,
    distributionCalc,
    annualDistributionCalc,
    privateWorkCount: marginQ.data?.privateWorkCount ?? 0,
    privateWorkValue: marginQ.data?.privateWorkValue ?? 0,
    costedMemberCount,
    totalMatchedMembers: matchedMembers.length,
    discountForgone: Math.round((marginQ.data?.discountForgone ?? 0) * 100) / 100,
    discountForgoneCalc,
    chairTimeDisplaced,
    chairTimeDisplacedCalc,
    unredeemedEntitlement: Math.round((unredeemedQ.data?.value ?? 0) * 100) / 100,
    unredeemedEntitlementCalc,
    privateSpendUplift,
    privateSpendUpliftCalc,
    categorySpend: (opportunityQ.data?.categorySpend ?? []).map((c) => ({
      category: c.category,
      planPerPatient: Math.round(c.planPerPatient * 100) / 100,
      nonPlanPerPatient: Math.round(c.nonPlanPerPatient * 100) / 100,
    })),
    planPatientCountForCategory: matchedMembers.length,
    nonPlanPatientCount: opportunityQ.data?.nonPlanCount ?? 0,
  };
}

function nnHours(minutes: number): string {
  // One decimal, not whole hours — the Hygiene card's subhead quotes the
  // same figure as e.g. "9.3 hrs", and a rounded "9 hrs" next to it reads
  // like a different number.
  return (minutes / 60).toFixed(1);
}
