import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useFilters } from "@/contexts/FilterContext";
import { useMembershipUploadData } from "@/hooks/useMembershipUploadData";
import { useMembershipPerformance } from "@/hooks/useMembershipPerformance";
import { useTreatments } from "@/hooks/useTreatments";
import { useCostImpactData } from "@/hooks/useCostImpactData";
import { ukDayStartInstant, ukDayEndInstant } from "@/utils/dateRangeUtils";
import { dentistNamesLikelyMatch } from "@/lib/dentistNameMatch";

export interface ClinicianRow {
  name: string;
  site: string | null;
  members: number;
  /** Real new-to-Dentally patients registered under this dentist in the
   *  period (patients.pt_created_at, filtered by pt_dentist_id) — not a
   *  plan-member count. null when this dentist isn't matched to a real
   *  Dentally provider record (same match as Site/Joins/Utilisation). */
  newPatients: number | null;
  /** Real new-patient-on-plan count for the displayed month, straight from
   *  this dentist's own Practice Plan statement upload
   *  (membership_statement_summaries.new_patient_count) — a patient who's
   *  newly registered AND appears as new on the statement, i.e. actually
   *  bought a plan. Works even for a dentist not matched to Dentally, since
   *  it never needs that match. null when no statement was uploaded for
   *  this dentist this month. */
  joins: number | null;
  conversionPct: number | null;
  /** Real existing-patient conversion: of this dentist's patients with a
   *  completed appointment this period who were NOT already a plan member
   *  before the period started, how many joined a plan during the period
   *  (patient_plan_membership_events, change_type='joined', cross-referenced
   *  against each patient's current plan state). Distinct from Conversion
   *  above, which is about brand-new-to-Dentally patients — this is the
   *  NHS/private → plan funnel for patients this dentist already had in the
   *  chair. null when this dentist isn't matched to a real Dentally provider
   *  record, or had nobody seen this period. */
  existingConversionPct: number | null;
  /** "Utilisation" = plan entitlement redemption, not chair time: % of this
   *  dentist's own plan members (matched to a real Dentally patient) with
   *  any real (non-cancelled, non-DNA) appointment in the last 6 months.
   *  Same "seen" definition as the Capacity tab's own 6-month stat and the
   *  Members tab's "Sleeping" bucket — client's own framing: "are plan
   *  patients actually turning up", not booked chair-hours. Works without a
   *  Dentally provider-name match (unlike the old chair-utilisation figure
   *  this replaced) since it only needs each member's own patient link. */
  seenPct6m: number | null;
  /** Same, trailing 12 months — the tooltip/secondary figure. */
  seenPct12m: number | null;
  /** Matched members with NO appointment in the last 6 months — the
   *  "sleeping, paying but not attending" cohort, this dentist's slice of
   *  the Members tab's own Sleeping worklist. */
  unredeemedCount: number | null;
  /** (revenue − real allocated cost) ÷ revenue for this dentist's own plan
   *  members over the selected period. Revenue = their membership net_due.
   *  Cost (2026-08-14, client request — must be real accounting spend, not
   *  a manually-entered catalog figure) = Cost Impact's own real £ spend
   *  from the connected accounting platform (Xero/QuickBooks/Sage/iplicit)
   *  for the header's current scope, split into material/lab/clinician/
   *  overhead buckets, ALLOCATED to this dentist by their plan members'
   *  share of total delivered-treatment activity in each bucket (the
   *  treatments catalog's material_cost/lab_bill/etc. supply the relative
   *  WEIGHTS for that split, not absolute £ figures — see weightsQ). Two
   *  prior bugs this superseded: (1) using useMembershipPerformance's
   *  costsPerMonth, which is mislabelled — it's actually total DELIVERED
   *  TREATMENT PRICE, not a cost figure, and produced nonsense margins like
   *  −171%; (2) a real-but-manual per-treatment cost figure from the
   *  Treatment Setup catalog (matches useMarginData.ts, but the client
   *  wanted real accounting spend instead). Null when no accounting
   *  platform is connected for this scope (`hasGLData` false) or this
   *  dentist has no plan members with a resolved patient link — never a
   *  fabricated number. */
  marginPct: number | null;
}

export interface CliniciansData {
  isLoading: boolean;
  hasUploadData: boolean;
  rows: ClinicianRow[];
  /** Real best-vs-worst conversion gap for the note at the bottom — null
   *  when fewer than 2 dentists have a real conversion figure to compare. */
  conversionGap: { best: ClinicianRow; worst: ClinicianRow } | null;
}

/** Members-per-dentist and (where a matched Dentally plan has real
 *  treatment-cost data) an allocated margin — from uploaded membership
 *  data, grouped by the statement/sheet's own treating_dentist name, so
 *  they work even for a dentist who can't be matched to a Dentally
 *  provider record. Joins/Members/Margin work off the statement alone.
 *  Site / New Pts / Existing conv. ARE Dentally-sourced and need a match to
 *  a `providers` row (fuzzy name match) — "—" when that fails. Utilisation
 *  does NOT need that match — it only needs each member's own patient link
 *  (see seenQ below), so it can show a real figure even for a dentist Site/
 *  New Pts can't resolve. New Pts = real patients registered in Dentally
 *  under this dentist in the period (patients.pt_created_at); Joins = real
 *  new-patient-on-plan count from the statement itself
 *  (membership_statement_summaries.new_patient_count); Conversion = Joins ÷
 *  New Pts — the new-patient funnel. Existing conv. is a second, separate
 *  funnel: of this dentist's patients seen (completed appointment,
 *  apmt_practitioner_id) this period who weren't already a plan member
 *  before the period started, how many joined a plan during it
 *  (patient_plan_membership_events, change_type='joined', cross-referenced
 *  against each patient's current pt_payment_plan_id) — the NHS/private →
 *  plan conversion for patients already in this dentist's chair. Utilisation
 *  (2026-08-14, replaced the old chair-time-booked figure per client
 *  request — "are plan patients actually turning up", not booked chair
 *  hours) is entitlement redemption: % of this dentist's own plan members
 *  with any real appointment (with ANY provider, not just this dentist) in
 *  the last 6 months — same "seen" definition as the Capacity tab's own
 *  6-month stat and the Members tab's Sleeping bucket. */
export function useCliniciansData(): CliniciansData {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId } = useFilters();
  const { members: uploadedMembers, totalMembers, displayMonth } = useMembershipUploadData();
  const { isLoading: uploadLoading } = useMembershipPerformance();
  const { treatments: dbTreatments, isLoading: treatmentsLoading } = useTreatments();

  const membershipRows = useMemo(() => {
    const byDentist = new Map<string, { members: number; revenue: number }>();
    for (const m of uploadedMembers) {
      const name = m.treating_dentist?.trim() || "Unassigned";
      const cur = byDentist.get(name) ?? { members: 0, revenue: 0 };
      cur.members += 1;
      cur.revenue += m.net_due || 0;
      byDentist.set(name, cur);
    }
    return Array.from(byDentist.entries()).map(([name, v]) => ({
      name,
      members: v.members,
      revenue: v.revenue,
    }));
  }, [uploadedMembers]);

  // Raw member rows per dentist (not just the aggregate above) — needed to
  // resolve each member's own patient_id for the seen/redemption query below.
  const membersByDentistName = useMemo(() => {
    const map = new Map<string, typeof uploadedMembers>();
    for (const m of uploadedMembers) {
      const name = m.treating_dentist?.trim() || "Unassigned";
      const arr = map.get(name) ?? [];
      arr.push(m);
      map.set(name, arr);
    }
    return map;
  }, [uploadedMembers]);

  const dentistNames = useMemo(
    () => membershipRows.map((r) => r.name).filter((n) => n !== "Unassigned"),
    [membershipRows],
  );
  const dentistNamesKey = dentistNames.slice().sort().join("|");
  const fromStr = ukDayStartInstant(dateRange.startDate);
  const toStr = ukDayEndInstant(dateRange.endDate);

  // Joins — real new-patient-on-plan count per dentist for the displayed
  // month, straight from each dentist's own Practice Plan statement upload.
  // Matched by exact treating_dentist name (same PDF-derived source as
  // membershipRows' own grouping, not the Dentally fuzzy-match), so it
  // works independent of whether the dentist matches a Dentally provider.
  const statementJoinsQ = useQuery({
    queryKey: ["insights_clinicians_statement_joins", organizationId, displayMonth?.month, displayMonth?.year],
    enabled: !!organizationId && !!displayMonth,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await (supabase as any)
        .from("membership_statement_summaries")
        .select("treating_dentist, new_patient_count")
        .eq("organization_id", organizationId)
        .eq("statement_month", displayMonth!.month)
        .eq("statement_year", displayMonth!.year)
        .is("deleted_at", null);
      if (error) throw error;
      const byDentist = new Map<string, number>();
      for (const s of data ?? []) {
        const name = s.treating_dentist?.trim();
        if (!name) continue;
        byDentist.set(name, (byDentist.get(name) ?? 0) + (Number(s.new_patient_count) || 0));
      }
      return byDentist;
    },
  });

  const dentallyQ = useQuery({
    queryKey: ["insights_clinicians_dentally", organizationId, dentistNamesKey, fromStr, toStr],
    enabled: !!organizationId && dentistNames.length > 0,
    queryFn: async (): Promise<
      Map<
        string,
        {
          site: string | null;
          newPatients: number;
          existingConversionPct: number | null;
        }
      >
    > => {
      const result = new Map<
        string,
        {
          site: string | null;
          newPatients: number;
          existingConversionPct: number | null;
        }
      >();

      // Name-match each membership-upload dentist to a real Dentally provider
      // — a statement's "Dr Abygail Costello" and the provider record's "Aby
      // Costello" are the same person, not an exact string match, so this
      // uses the same fuzzy matcher as the Membership revenue fallback (see
      // lib/dentistNameMatch.ts). First collapse EXACT-name duplicate
      // provider rows into one candidate (this org has two separate "Aby
      // Costello" rows, likely one per location/sync batch — a real single
      // person, not two dentists) before fuzzy-matching, then only accept
      // the match when it's unambiguous: if more than one DISTINCT-named
      // provider still fuzzy-matches the same statement name (e.g. separate
      // "Steve Lomas" and "Steven Lomas" rows for one person), skip rather
      // than guess which one gets the figures.
      const { data: providerRows, error: provErr } = await (supabase as any)
        .from("providers")
        .select("name, external_id, location_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .not("external_id", "is", null);
      if (provErr) throw provErr;

      const { data: locationRows, error: locErr } = await (supabase as any)
        .from("practice_locations")
        .select("id, location_name")
        .eq("organization_id", organizationId)
        .is("deleted_at", null);
      if (locErr) throw locErr;
      const locationNameById = new Map<string, string>((locationRows ?? []).map((l: any) => [l.id, l.location_name]));

      const rawProviders = (providerRows ?? []) as Array<{ name: string | null; external_id: number; location_id: string | null }>;
      const providerGroupByName = new Map<string, { name: string; externalIds: number[]; locationId: string | null }>();
      for (const p of rawProviders) {
        if (!p.name) continue;
        const key = p.name.trim().toLowerCase();
        const g = providerGroupByName.get(key) ?? { name: p.name, externalIds: [], locationId: null };
        g.externalIds.push(Number(p.external_id));
        if (!g.locationId && p.location_id) g.locationId = p.location_id;
        providerGroupByName.set(key, g);
      }
      const providerGroups = Array.from(providerGroupByName.values());

      const extIdsByDentistName = new Map<string, number[]>();
      for (const name of dentistNames) {
        const matches = providerGroups.filter((g) => dentistNamesLikelyMatch(name, g.name));
        if (matches.length !== 1) continue;
        const g = matches[0];
        extIdsByDentistName.set(name, g.externalIds);
        result.set(name, {
          site: g.locationId ? locationNameById.get(g.locationId) ?? null : null,
          newPatients: 0,
          existingConversionPct: null,
        });
      }
      const extIds = Array.from(new Set([...extIdsByDentistName.values()].flat()));
      if (extIds.length === 0) return result;

      // Real new-to-Dentally patients per dentist in the period — the
      // Conversion denominator ("of the new patients this dentist saw, how
      // many bought a plan"), not a plan-member-count delta.
      const { data: newPatientRows, error: npErr } = await (supabase as any)
        .from("patients")
        .select("pt_dentist_id")
        .eq("organization_id", organizationId)
        .in("pt_dentist_id", extIds)
        .gte("pt_created_at", fromStr)
        .lte("pt_created_at", toStr)
        .is("deleted_at", null);
      if (npErr) throw npErr;
      const newPatientsByExtId = new Map<number, number>();
      for (const r of newPatientRows ?? []) {
        const id = Number(r.pt_dentist_id);
        newPatientsByExtId.set(id, (newPatientsByExtId.get(id) ?? 0) + 1);
      }

      // Existing-patient conversion — of this dentist's patients seen
      // (completed appointment) this period, how many were NOT already a
      // plan member before the period and joined a plan during it. Uses the
      // appointment's own practitioner (who actually saw the patient at that
      // visit), not patients.pt_dentist_id (their assigned default dentist)
      // — deliberately different from the New Pts attribution above, since
      // this metric is about what happens in this dentist's own chair.
      const { data: seenRows, error: seenErr } = await (supabase as any)
        .from("appointments")
        .select("apmt_practitioner_id, apmt_patient_id")
        .eq("organization_id", organizationId)
        .in("apmt_practitioner_id", extIds)
        .eq("apmt_state", "Completed")
        .gte("apmt_start_time", fromStr)
        .lte("apmt_start_time", toStr)
        .is("deleted_at", null);
      if (seenErr) throw seenErr;

      const seenPatientIdsByExtId = new Map<number, Set<number>>();
      const allSeenPatientIds = new Set<number>();
      for (const r of (seenRows ?? []) as Array<{ apmt_practitioner_id: number | null; apmt_patient_id: number | null }>) {
        if (r.apmt_practitioner_id == null || r.apmt_patient_id == null) continue;
        const set = seenPatientIdsByExtId.get(r.apmt_practitioner_id) ?? new Set<number>();
        set.add(r.apmt_patient_id);
        seenPatientIdsByExtId.set(r.apmt_practitioner_id, set);
        allSeenPatientIds.add(r.apmt_patient_id);
      }

      const planStateByPtId = new Map<number, boolean>();
      const joinedInPeriodByPtId = new Map<number, boolean>();
      if (allSeenPatientIds.size > 0) {
        const seenIdList = Array.from(allSeenPatientIds);
        const { data: planRows, error: planErr } = await (supabase as any)
          .from("patients")
          .select("pt_id, pt_payment_plan_id")
          .eq("organization_id", organizationId)
          .in("pt_id", seenIdList);
        if (planErr) throw planErr;
        for (const p of (planRows ?? []) as Array<{ pt_id: number | null; pt_payment_plan_id: number | null }>) {
          if (p.pt_id == null) continue;
          planStateByPtId.set(p.pt_id, p.pt_payment_plan_id != null);
        }

        const { data: joinRows, error: joinErr } = await (supabase as any)
          .from("patient_plan_membership_events")
          .select("pt_id")
          .eq("organization_id", organizationId)
          .eq("change_type", "joined")
          .in("pt_id", seenIdList)
          .gte("changed_at", fromStr)
          .lte("changed_at", toStr);
        if (joinErr) throw joinErr;
        for (const j of (joinRows ?? []) as Array<{ pt_id: number | null }>) {
          if (j.pt_id != null) joinedInPeriodByPtId.set(j.pt_id, true);
        }
      }

      for (const [name, ids] of extIdsByDentistName) {
        const cur = result.get(name);
        if (!cur) continue;
        cur.newPatients = ids.reduce((s, id) => s + (newPatientsByExtId.get(id) ?? 0), 0);
        // Combine seen/converted counts across duplicate provider rows
        // before computing the rate, rather than averaging per-row rates.
        let combinedDenom = 0;
        let combinedNum = 0;
        for (const id of ids) {
          const ptIds = seenPatientIdsByExtId.get(id);
          if (!ptIds) continue;
          for (const ptId of ptIds) {
            const onPlanNow = planStateByPtId.get(ptId) ?? false;
            const joinedThisPeriod = joinedInPeriodByPtId.get(ptId) ?? false;
            if (onPlanNow && !joinedThisPeriod) continue;
            combinedDenom += 1;
            if (onPlanNow && joinedThisPeriod) combinedNum += 1;
          }
        }
        cur.existingConversionPct = combinedDenom > 0 ? Math.round((combinedNum / combinedDenom) * 100) : null;
      }
      return result;
    },
  });

  // "Utilisation" (entitlement redemption, per dentist) — every uploaded
  // member's own patient link resolved to a real Dentally patient, then
  // checked for any real appointment in the trailing 6 / 12 months. Unlike
  // dentallyQ above, this doesn't need a fuzzy name→provider match at all —
  // it only needs each member's own patient_id — so it works for dentists
  // dentallyQ couldn't match too.
  const memberPatientKeys = useMemo(
    () => Array.from(new Set(uploadedMembers.map((m) => m.patient_id).filter((x): x is string => !!x))),
    [uploadedMembers],
  );
  const memberPatientKeysKey = memberPatientKeys.slice().sort().join(",");

  const seenQ = useQuery({
    queryKey: ["insights_clinicians_seen", organizationId, memberPatientKeysKey],
    enabled: !!organizationId && memberPatientKeys.length > 0,
    queryFn: async (): Promise<{ keyToPtId: Map<string, string>; seen6: Set<string>; seen12: Set<string> }> => {
      const { data: patientRows, error: ptErr } = await (supabase as any)
        .from("patients")
        .select("pt_id, pt_legacy_id")
        .eq("organization_id", organizationId)
        .or(`pt_id.in.(${memberPatientKeys.join(",")}),pt_legacy_id.in.(${memberPatientKeys.join(",")})`);
      if (ptErr) throw ptErr;

      const keyToPtId = new Map<string, string>();
      for (const p of patientRows ?? []) {
        if (p.pt_id != null) keyToPtId.set(String(p.pt_id), String(p.pt_id));
        if (p.pt_legacy_id != null && p.pt_id != null) keyToPtId.set(String(p.pt_legacy_id).trim(), String(p.pt_id));
      }
      const ptIds = Array.from(new Set([...keyToPtId.values()]));
      if (ptIds.length === 0) return { keyToPtId, seen6: new Set(), seen12: new Set() };

      const twelveAgo = new Date();
      twelveAgo.setMonth(twelveAgo.getMonth() - 12);
      const sixAgo = new Date();
      sixAgo.setMonth(sixAgo.getMonth() - 6);
      const twelveAgoInstant = ukDayStartInstant(twelveAgo);
      const sixAgoInstant = ukDayStartInstant(sixAgo);

      const { data: appts, error: apErr } = await (supabase as any)
        .from("appointments")
        .select("apmt_patient_id, apmt_state, apmt_start_time")
        .eq("organization_id", organizationId)
        .in("apmt_patient_id", ptIds)
        .gte("apmt_start_time", twelveAgoInstant)
        .is("deleted_at", null);
      if (apErr) throw apErr;

      const INACTIVE_STATES = new Set(["cancelled", "did not attend", "dna"]);
      const seen6 = new Set<string>();
      const seen12 = new Set<string>();
      for (const a of (appts ?? []) as Array<{ apmt_patient_id: number | string | null; apmt_state: string | null; apmt_start_time: string }>) {
        if (a.apmt_patient_id == null) continue;
        const state = String(a.apmt_state ?? "").toLowerCase();
        if (INACTIVE_STATES.has(state)) continue;
        const key = String(a.apmt_patient_id);
        seen12.add(key);
        if (a.apmt_start_time >= sixAgoInstant) seen6.add(key);
      }
      return { keyToPtId, seen6, seen12 };
    },
  });

  const seenByDentist = useMemo(() => {
    const result = new Map<string, { seenPct6m: number | null; seenPct12m: number | null; unredeemedCount: number | null }>();
    if (!seenQ.data) return result;
    for (const [name, members] of membersByDentistName) {
      const ptIds = members
        .map((m) => (m.patient_id != null ? seenQ.data!.keyToPtId.get(String(m.patient_id).trim()) : undefined))
        .filter((x): x is string => !!x);
      if (ptIds.length === 0) {
        result.set(name, { seenPct6m: null, seenPct12m: null, unredeemedCount: null });
        continue;
      }
      const seen6Count = ptIds.filter((id) => seenQ.data!.seen6.has(id)).length;
      const seen12Count = ptIds.filter((id) => seenQ.data!.seen12.has(id)).length;
      result.set(name, {
        seenPct6m: Math.round((seen6Count / ptIds.length) * 100),
        seenPct12m: Math.round((seen12Count / ptIds.length) * 100),
        unredeemedCount: ptIds.length - seen6Count,
      });
    }
    return result;
  }, [membersByDentistName, seenQ.data]);

  // Margin's real cost-to-serve (2026-08-14, client request: cost must come
  // from real accounting spend, not the manually-entered treatments catalog)
  // — Cost Impact's own real £ Xero/QuickBooks/Sage/iplicit spend for the
  // header's current scope (material/lab/clinician/overhead buckets),
  // ALLOCATED across each dentist's plan members by their SHARE of total
  // treatment activity in that bucket. The treatments catalog still supplies
  // the per-treatment WEIGHTS (material_cost, lab_bill, etc.) — not as £
  // figures anymore, only as relative proportions to split the real spend.
  const costImpactQ = useCostImpactData();

  type BucketWeights = { material: number; lab: number; clinician: number; overhead: number };
  const emptyBucketWeights = (): BucketWeights => ({ material: 0, lab: 0, clinician: 0, overhead: 0 });

  const treatmentWeightFieldsByExternalId = useMemo(() => {
    const map = new Map<
      string,
      { material: number; lab: number; therapist: number; hourlyRate: number; durationMin: number; percentFees: number; financeFee: number }
    >();
    for (const t of dbTreatments) {
      if (t.external_id == null) continue;
      map.set(String(t.external_id), {
        material: Number(t.material_cost) || 0,
        lab: Number(t.lab_bill) || 0,
        therapist: Number(t.therapist_pay_rate) || 0,
        hourlyRate: Number(t.hourly_rate) || 0,
        durationMin: Number(t.duration_minutes) || 0,
        percentFees: Number(t.percent_fees) || 0,
        financeFee: Number(t.finance_fee) || 0,
      });
    }
    return map;
  }, [dbTreatments]);

  // Every delivered treatment in the header's current scope (NOT just plan
  // members — the allocation base is total treatment activity, so a plan
  // member's share is their real proportion of the practice's work, not
  // 100% of the real spend). Location-scoped to match Cost Impact's own
  // scope when a single site is selected; org-wide otherwise. NOTE: when a
  // REGION (not a single location) is selected this stays org-wide — an
  // approximation, since resolving a region's location list would duplicate
  // useCostImpactData's own internal scope resolution.
  const weightsQ = useQuery({
    queryKey: ["insights_clinicians_weights", organizationId, selectedLocationId ?? "all", treatmentWeightFieldsByExternalId.size, fromStr, toStr],
    enabled: !!organizationId && treatmentWeightFieldsByExternalId.size > 0,
    queryFn: async (): Promise<{ totalWeights: BucketWeights; weightsByPtId: Map<string, BucketWeights> }> => {
      const totalWeights = emptyBucketWeights();
      const weightsByPtId = new Map<string, BucketWeights>();
      const PAGE_SIZE = 1000;
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        let q = (supabase as any)
          .from("treatment_plan_items")
          .select("tpi_patient_id, tpi_treatment_id, tpi_price")
          .eq("organization_id", organizationId)
          .eq("tpi_completed", true)
          .gt("tpi_treatment_appointment_id", 0)
          .not("tpi_completed_at", "is", null)
          .gte("tpi_completed_at", fromStr)
          .lte("tpi_completed_at", toStr)
          .is("deleted_at", null)
          .range(from, from + PAGE_SIZE - 1);
        if (selectedLocationId) q = q.eq("location_id", selectedLocationId);
        const { data, error } = await q;
        if (error) throw error;
        for (const row of (data ?? []) as Array<{ tpi_patient_id: number | string; tpi_treatment_id: number | string | null; tpi_price: number | string | null }>) {
          if (row.tpi_treatment_id == null) continue;
          const t = treatmentWeightFieldsByExternalId.get(String(row.tpi_treatment_id));
          if (!t) continue;
          const price = Number(row.tpi_price) || 0;
          const w: BucketWeights = {
            material: t.material,
            lab: t.lab,
            clinician: t.therapist + (price * t.percentFees) / 100,
            overhead: t.hourlyRate * (t.durationMin / 60) + (price * t.financeFee) / 100,
          };
          (Object.keys(w) as (keyof BucketWeights)[]).forEach((k) => { totalWeights[k] += w[k]; });
          const ptKey = String(row.tpi_patient_id);
          const cur = weightsByPtId.get(ptKey) ?? emptyBucketWeights();
          (Object.keys(w) as (keyof BucketWeights)[]).forEach((k) => { cur[k] += w[k]; });
          weightsByPtId.set(ptKey, cur);
        }
        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        from += PAGE_SIZE;
      }
      return { totalWeights, weightsByPtId };
    },
  });

  const costByDentist = useMemo(() => {
    const result = new Map<string, number>();
    if (!seenQ.data || !weightsQ.data || !costImpactQ.data?.hasGLData) return result;
    const { totalWeights, weightsByPtId } = weightsQ.data;
    const spend: BucketWeights = {
      material: costImpactQ.data.materialCostCost,
      lab: costImpactQ.data.labFeesCost,
      clinician: costImpactQ.data.clinicianCostCost,
      overhead: costImpactQ.data.overheadCostCost,
    };
    for (const [name, members] of membersByDentistName) {
      // Dedupe to unique patients — a wide header range can carry several
      // monthly rows per member, but their treatment activity for the
      // period is queried once, not once per uploaded month.
      const uniquePtIds = new Set<string>();
      for (const m of members) {
        if (m.patient_id == null) continue;
        const ptId = seenQ.data!.keyToPtId.get(String(m.patient_id).trim());
        if (ptId) uniquePtIds.add(ptId);
      }
      const dentistWeights = emptyBucketWeights();
      for (const ptId of uniquePtIds) {
        const w = weightsByPtId.get(ptId);
        if (!w) continue;
        (Object.keys(w) as (keyof BucketWeights)[]).forEach((k) => { dentistWeights[k] += w[k]; });
      }
      let cost = 0;
      (Object.keys(spend) as (keyof BucketWeights)[]).forEach((bucket) => {
        if (totalWeights[bucket] > 0) cost += (dentistWeights[bucket] / totalWeights[bucket]) * spend[bucket];
      });
      result.set(name, cost);
    }
    return result;
  }, [membersByDentistName, seenQ.data, weightsQ.data, costImpactQ.data]);

  const rows = useMemo<ClinicianRow[]>(() => {
    return membershipRows
      .map((r) => {
        const real = dentallyQ.data?.get(r.name);
        const newPatients = real?.newPatients ?? null;
        const joins = statementJoinsQ.data?.get(r.name) ?? null;
        const seen = seenByDentist.get(r.name);
        const cost = costByDentist.get(r.name);
        return {
          name: r.name,
          site: real?.site ?? null,
          members: r.members,
          newPatients,
          joins,
          conversionPct: newPatients != null && newPatients > 0 && joins != null
            ? Math.round((joins / newPatients) * 100)
            : null,
          existingConversionPct: real?.existingConversionPct ?? null,
          seenPct6m: seen?.seenPct6m ?? null,
          seenPct12m: seen?.seenPct12m ?? null,
          unredeemedCount: seen?.unredeemedCount ?? null,
          marginPct:
            cost != null && r.revenue > 0
              ? Math.round(((r.revenue - cost) / r.revenue) * 100)
              : null,
        };
      })
      .sort((a, b) => b.members - a.members);
  }, [membershipRows, dentallyQ.data, statementJoinsQ.data, seenByDentist, costByDentist]);

  const conversionGap = useMemo(() => {
    const withConversion = rows.filter((r) => r.conversionPct != null);
    if (withConversion.length < 2) return null;
    const best = withConversion.reduce((a, b) => (b.conversionPct! > a.conversionPct! ? b : a));
    const worst = withConversion.reduce((a, b) => (b.conversionPct! < a.conversionPct! ? b : a));
    return best === worst ? null : { best, worst };
  }, [rows]);

  return {
    isLoading: uploadLoading || treatmentsLoading || dentallyQ.isLoading || statementJoinsQ.isLoading || seenQ.isLoading || weightsQ.isLoading || costImpactQ.isLoading,
    hasUploadData: totalMembers > 0,
    rows,
    conversionGap,
  };
}
