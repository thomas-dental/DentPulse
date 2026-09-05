import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useChairMetrics, type ChairMetric } from "@/hooks/useChairMetrics";
import { useChurnData } from "./useChurnData";
import { useFilters } from "@/contexts/FilterContext";
import { ukDayStartInstant, ukDayEndInstant } from "@/utils/dateRangeUtils";
import { useMembershipUploadData, MONTH_NAMES } from "@/hooks/useMembershipUploadData";
import { useMembershipTrends } from "@/hooks/useMembershipTrends";
import { useTreatments } from "@/hooks/useTreatments";
import { classifyVisitType } from "@/lib/visitTypeClassification";

const LOSS_STATES = new Set(["cancelled", "did not attend", "dna"]);

export interface RedemptionBuckets {
  /** Entitled to this visit type but redeemed none of it this plan year. */
  none: number;
  /** Redeemed some, but fewer than their plan's included count. */
  partial: number;
  /** Redeemed their full entitlement (or more). */
  full: number;
}

/** One matched plan member's redemption for a single visit type (hygiene or
 *  exam), for the drill-down list behind each redemption bar. */
export interface RedemptionMember {
  id: string;
  name: string;
  /** patients.pt_unique_id — Dentally patient UUID for the row's deep-link
   *  to https://app.dentally.co/patients/<uuid>/appointments. Null when the
   *  member's patient_id couldn't be resolved to a matched Dentally patient. */
  patientUuid: string | null;
  bucket: "none" | "partial" | "full";
  redeemed: number;
  entitled: number;
}

export interface CapacityLocationRow {
  locationId: string;
  name: string;
  occupancyPct: number;
  utilisationPct: number;
  completedHours: number;
  availableHours: number;
  shortNoticeLossPct: number | null;
  churnPct: number | null;
  /** Entitled plan members at this site who redeemed zero hygiene/exam/xray
   *  visits this plan year — null until the redemption query resolves. */
  noHygiene: number | null;
  noExam: number | null;
  noXray: number | null;
  /** Per-site hygiene-booked% — same figure and RPC as the page's own
   *  "Hygiene hours booked" tile, computed per location. null when this
   *  site has no hygienist providers to measure. */
  bookedPct: number | null;
  /** See CapacityData.waitWeeks — same proxy, computed per site. */
  waitWeeks: number | null;
}

export interface CapacityData {
  isLoading: boolean;
  hasData: boolean;
  occupancyPct: number;
  utilisationPct: number;
  completedHours: number;
  availableHours: number;
  treatmentHours: number;
  shortNoticeLossPct: number;
  totalAppointments: number;
  lostAppointments: number;
  /** Hygienist chair-time booked vs. available, same formula as the
   *  Hygienist Management "Avg Utilisation" tile (get_avg_utilisation) —
   *  null when this org has no hygienist providers to measure. */
  hygieneBookedPct: number | null;
  hygieneBookedHours: number;
  hygieneAvailableHours: number;
  byLocation: CapacityLocationRow[];
  /** Entitlement redemption — matched plan members only (a real Dentally
   *  patient link, via membership_upload_members.patient_id), trailing 12
   *  months from today regardless of the page's date filter, since a
   *  plan's "2 visits a year" entitlement is inherently annual and a
   *  shorter selected window would make partial-year counts nonsensical.
   *  Exam/hygiene/xray classification is a best-effort keyword match (see
   *  lib/visitTypeClassification.ts) — Dentally's own treatment categories
   *  are synced per-org with no fixed names, so there's no exact flag to
   *  read instead. null while the query hasn't resolved yet. */
  hygieneRedemption: RedemptionBuckets | null;
  examRedemption: RedemptionBuckets | null;
  xrayRedemption: RedemptionBuckets | null;
  /** Per-member detail behind hygieneRedemption/examRedemption/xrayRedemption
   *  — every matched member entitled to that visit type, with their bucket,
   *  so the UI can drill into "who's in this bar" and deep-link to
   *  Dentally. Empty until the redemption query resolves (same members as
   *  the buckets above, so lengths always agree once loaded). */
  hygieneRedemptionMembers: RedemptionMember[];
  examRedemptionMembers: RedemptionMember[];
  xrayRedemptionMembers: RedemptionMember[];
  /** Sum of every matched member's plan entitlement (exam + hygiene + xray
   *  visits owed a year), independent of how many were actually redeemed. */
  visitsOwedAYear: number;
  matchedPlanMembers: number;
  /** % of matched plan members with a real (non-cancelled/DNA) appointment
   *  in the trailing 6 / 12 months. null while unresolved. */
  seenPct6m: number | null;
  seenPct12m: number | null;
  /** "Time to next slot" proxy: median days between when a hygienist
   *  appointment was BOOKED (apmt_created_at) and when it actually took
   *  place (apmt_start_time), over hygienist appointments booked in the
   *  last 8 weeks — converted to weeks. This app has no live/future
   *  schedule feed, so it can't show a true "next available slot"; this is
   *  a genuine proxy for current booking lead time instead, not the same
   *  thing (surfaced honestly in the UI). null when there's no recent
   *  hygienist booking activity to measure from. */
  waitWeeks: number | null;
  /** Hygiene capacity vs leavers, trailing 12 months (client ask 2026-08-14:
   *  "the plan promises hygiene; if the wait is ten weeks, patients cancel —
   *  I need that plotted against leavers"). leavers reuses the exact real
   *  monthly series MembershipTrendsSection's own Leavers chart already
   *  shows (statement cancelled_patient_count, appointment-diff fallback);
   *  waitWeeks is the SAME lead-time proxy as the page's own "Time to next
   *  slot" stat, but bucketed by the month each hygienist appointment took
   *  place instead of a rolling last-8-weeks window, so it has a real
   *  historical value per month. Either side can be null for a given month
   *  — no fabricated interpolation. Empty array for Denplan-sheet-only orgs
   *  (leavers is Practice-Plan-statement-only, same as the Trends charts). */
  hygieneChurnTrend: Array<{ month: string; fullLabel: string; waitWeeks: number | null; leavers: number | null }>;
}

/** Capacity tab's real data — chair occupancy/utilisation via
 *  useChairMetrics() (same RPC the Chairs page uses), a short-notice-loss %
 *  from appointment status, hygienist utilisation via the same RPC the
 *  Hygienist Management page uses, per-location churn from useChurnData(),
 *  entitlement redemption from matched plan members' delivered
 *  treatment_plan_items, and a booking-lead-time proxy for "Time to next
 *  slot" (see waitWeeks doc comment — this app has no live schedule feed,
 *  so it's a proxy, not true next-available-slot). */
export function useCapacityData(): CapacityData {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId } = useFilters();
  const churn = useChurnData();
  const { members: uploadedMembers, displayMonth } = useMembershipUploadData();
  const { treatments: dbTreatments, isLoading: treatmentsLoading } = useTreatments();
  // Real monthly leavers series for the hygiene-churn trend below — same
  // hook, same clamped-to-today anchor, as MembershipTrendsSection's own
  // Leavers chart, so the two never disagree.
  const trendsQ = useMembershipTrends(displayMonth.month, displayMonth.year, null);

  const chairQ = useChairMetrics({ startDate: dateRange.startDate, endDate: dateRange.endDate });

  // Real, Dentally-matched plan members only — pt_payment_plan_id alone is
  // unreliable (Dentally's payment_plan concept spans NHS/private too), so
  // this reuses the same verified membership_upload_members match set every
  // other insights tab uses.
  const matchedMembers = useMemo(
    () =>
      uploadedMembers.filter(
        (m) => m.patient_id && m.mapped_plan_id && (!selectedLocationId || m.location_id === selectedLocationId),
      ),
    [uploadedMembers, selectedLocationId],
  );
  const matchedMembersKey = matchedMembers.map((m) => `${m.patient_id}:${m.mapped_plan_id}:${m.location_id}`).sort().join(",");

  // Short-notice loss — plan members only, not every patient org-wide.
  // membership_upload_members.patient_id may hold either pt_id or
  // pt_legacy_id, so resolve both the same way redemption does.
  const lossQ = useQuery({
    queryKey: [
      "insights_capacity_loss",
      organizationId,
      matchedMembersKey,
      dateRange.startDate.toISOString(),
      dateRange.endDate.toISOString(),
    ],
    enabled: !!organizationId && matchedMembers.length > 0,
    queryFn: async () => {
      const legacyKeys = Array.from(new Set(matchedMembers.map((m) => String(m.patient_id).trim())));
      const { data: patientRows, error: ptErr } = await (supabase as any)
        .from("patients")
        .select("pt_id, pt_legacy_id")
        .eq("organization_id", organizationId)
        .or(`pt_id.in.(${legacyKeys.join(",")}),pt_legacy_id.in.(${legacyKeys.join(",")})`);
      if (ptErr) throw ptErr;
      const ptIds = new Set<string>();
      for (const p of patientRows ?? []) {
        if (p.pt_id != null) ptIds.add(String(p.pt_id));
      }
      if (ptIds.size === 0) return { total: 0, lost: 0, byLocation: new Map<string, { total: number; lost: number }>() };

      let q = (supabase as any)
        .from("appointments")
        .select("apmt_state, location_id")
        .eq("organization_id", organizationId)
        .in("apmt_patient_id", Array.from(ptIds))
        .gte("apmt_start_time", ukDayStartInstant(dateRange.startDate))
        .lte("apmt_start_time", ukDayEndInstant(dateRange.endDate))
        .is("deleted_at", null);
      if (selectedLocationId) q = q.eq("location_id", selectedLocationId);
      const { data, error } = await q;
      if (error) throw error;
      let lost = 0;
      const byLocation = new Map<string, { total: number; lost: number }>();
      for (const a of data ?? []) {
        const state = String(a.apmt_state ?? "").toLowerCase();
        const isLost = LOSS_STATES.has(state);
        if (isLost) lost += 1;
        const locId = a.location_id as string | null;
        if (locId) {
          const row = byLocation.get(locId) ?? { total: 0, lost: 0 };
          row.total += 1;
          if (isLost) row.lost += 1;
          byLocation.set(locId, row);
        }
      }
      return { total: (data ?? []).length, lost, byLocation };
    },
  });

  const hygieneQ = useQuery({
    queryKey: [
      "insights_capacity_hygiene_utilisation",
      organizationId,
      selectedLocationId ?? "all",
      dateRange.startDate.toISOString(),
      dateRange.endDate.toISOString(),
    ],
    enabled: !!organizationId,
    queryFn: async (): Promise<{ pct: number; bookedHours: number; availableHours: number } | null> => {
      const { data, error } = await (supabase as any).rpc("get_avg_utilisation_breakdown", {
        p_organization_id: organizationId,
        p_start_date: dateRange.startDate.toISOString(),
        p_end_date: dateRange.endDate.toISOString(),
        p_provider_type: "Hygienist",
        p_location_id: selectedLocationId ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || Number(row.provider_count) === 0) return null;
      const bookedHours = Number(row.total_minutes || 0) / 60;
      const availableHours =
        Number(row.provider_count || 0) * Number(row.working_days || 0) * Number(row.hours_per_day || 0);
      return { pct: Number(row.utilisation) || 0, bookedHours, availableHours };
    },
  });

  const chairLocationIds = (chairQ.data ?? []).map((r) => r.location_id).sort().join(",");
  // Per-site hygiene-booked% for the "Booked" column on Capacity by site —
  // same RPC as the org-wide tile above, one call per site (a handful of
  // rows, same pattern as useCliniciansData's per-provider RPC loop).
  const hygieneByLocationQ = useQuery({
    queryKey: [
      "insights_capacity_hygiene_by_location",
      organizationId,
      chairLocationIds,
      dateRange.startDate.toISOString(),
      dateRange.endDate.toISOString(),
    ],
    enabled: !!organizationId && chairLocationIds.length > 0,
    queryFn: async (): Promise<Map<string, number | null>> => {
      const ids = chairLocationIds.split(",");
      const result = new Map<string, number | null>();
      await Promise.all(
        ids.map(async (locationId) => {
          const { data, error } = await (supabase as any).rpc("get_avg_utilisation_breakdown", {
            p_organization_id: organizationId,
            p_start_date: dateRange.startDate.toISOString(),
            p_end_date: dateRange.endDate.toISOString(),
            p_provider_type: "Hygienist",
            p_location_id: locationId,
          });
          if (error) { console.error("[capacity] hygiene RPC failed for", locationId, error); return; }
          const row = Array.isArray(data) ? data[0] : data;
          result.set(locationId, !row || Number(row.provider_count) === 0 ? null : Number(row.utilisation) || 0);
        }),
      );
      return result;
    },
  });

  // "Time to next slot" proxy — median booking-to-appointment lead time for
  // hygienist appointments booked in the last 8 weeks. Not a live schedule
  // feed (this app doesn't have one), but a genuine signal for how far out
  // hygiene is currently running, per site and org-wide.
  const waitTimeQ = useQuery({
    queryKey: ["insights_capacity_wait_time", organizationId, selectedLocationId ?? "all"],
    enabled: !!organizationId,
    queryFn: async (): Promise<{ overall: number | null; byLocation: Map<string, number> }> => {
      const { data: hygienistRows, error: provErr } = await (supabase as any)
        .from("providers")
        .select("external_id")
        .eq("organization_id", organizationId)
        .ilike("provider_role", "%hygien%")
        .is("deleted_at", null)
        .not("external_id", "is", null);
      if (provErr) throw provErr;
      const hygienistIds = Array.from(new Set((hygienistRows ?? []).map((p: any) => Number(p.external_id))));
      if (hygienistIds.length === 0) return { overall: null, byLocation: new Map() };

      const bookedSince = new Date();
      bookedSince.setDate(bookedSince.getDate() - 56); // last 8 weeks

      let q = (supabase as any)
        .from("appointments")
        .select("apmt_start_time, apmt_created_at, apmt_state, location_id")
        .eq("organization_id", organizationId)
        .in("apmt_practitioner_id", hygienistIds)
        .gte("apmt_created_at", ukDayStartInstant(bookedSince))
        .not("apmt_created_at", "is", null)
        .is("deleted_at", null);
      if (selectedLocationId) q = q.eq("location_id", selectedLocationId);
      const { data, error } = await q;
      if (error) throw error;

      const leadDaysByLocation = new Map<string, number[]>();
      const leadDaysOverall: number[] = [];
      for (const a of data ?? []) {
        const state = String(a.apmt_state ?? "").toLowerCase();
        if (LOSS_STATES.has(state)) continue;
        const start = new Date(a.apmt_start_time).getTime();
        const created = new Date(a.apmt_created_at).getTime();
        const days = (start - created) / (1000 * 60 * 60 * 24);
        if (!Number.isFinite(days) || days < 0) continue;
        leadDaysOverall.push(days);
        if (a.location_id) {
          const arr = leadDaysByLocation.get(a.location_id) ?? [];
          arr.push(days);
          leadDaysByLocation.set(a.location_id, arr);
        }
      }

      const median = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const days = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        return days / 7;
      };

      const byLocation = new Map<string, number>();
      for (const [locId, arr] of leadDaysByLocation) {
        const w = median(arr);
        if (w != null) byLocation.set(locId, w);
      }
      return { overall: median(leadDaysOverall), byLocation };
    },
  });

  // Same lead-time proxy as waitTimeQ above, but bucketed by the calendar
  // month each hygienist appointment took place — a real historical wait
  // figure per month, not a rolling "last 8 weeks" snapshot — so it can be
  // plotted alongside the real monthly leavers series below.
  const hygieneWaitTrendQ = useQuery({
    queryKey: ["insights_capacity_wait_trend", organizationId, selectedLocationId ?? "all"],
    enabled: !!organizationId,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data: hygienistRows, error: provErr } = await (supabase as any)
        .from("providers")
        .select("external_id")
        .eq("organization_id", organizationId)
        .ilike("provider_role", "%hygien%")
        .is("deleted_at", null)
        .not("external_id", "is", null);
      if (provErr) throw provErr;
      const hygienistIds = Array.from(new Set((hygienistRows ?? []).map((p: any) => Number(p.external_id))));
      if (hygienistIds.length === 0) return new Map();

      // 13 months so the last 12 real calendar months are always fully
      // covered regardless of where in the current month "today" falls.
      const windowStart = new Date();
      windowStart.setMonth(windowStart.getMonth() - 13);
      windowStart.setDate(1);

      let q = (supabase as any)
        .from("appointments")
        .select("apmt_start_time, apmt_created_at, apmt_state, location_id")
        .eq("organization_id", organizationId)
        .in("apmt_practitioner_id", hygienistIds)
        .gte("apmt_start_time", ukDayStartInstant(windowStart))
        .not("apmt_created_at", "is", null)
        .is("deleted_at", null);
      if (selectedLocationId) q = q.eq("location_id", selectedLocationId);
      const { data, error } = await q;
      if (error) throw error;

      const leadDaysByMonth = new Map<string, number[]>();
      for (const a of (data ?? []) as Array<{ apmt_start_time: string; apmt_created_at: string; apmt_state: string | null }>) {
        const state = String(a.apmt_state ?? "").toLowerCase();
        if (LOSS_STATES.has(state)) continue;
        const start = new Date(a.apmt_start_time);
        const created = new Date(a.apmt_created_at).getTime();
        const days = (start.getTime() - created) / (1000 * 60 * 60 * 24);
        if (!Number.isFinite(days) || days < 0) continue;
        const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
        const arr = leadDaysByMonth.get(key) ?? [];
        arr.push(days);
        leadDaysByMonth.set(key, arr);
      }

      const result = new Map<string, number>();
      for (const [key, arr] of leadDaysByMonth) {
        if (arr.length === 0) continue;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const days = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        result.set(key, days / 7);
      }
      return result;
    },
  });

  // Merge onto the real monthly Leavers series (never invent a leavers
  // count that series doesn't already have) — matched by month, not index,
  // so a gap in one series doesn't misalign the other.
  const hygieneChurnTrend = useMemo(() => {
    const leavers = trendsQ.trends.leavers;
    if (!leavers || leavers.length === 0) return [];
    return leavers.map((point) => {
      const [monthName, yearStr] = point.fullLabel.split(" ");
      const monthIdx = (MONTH_NAMES as readonly string[]).indexOf(monthName);
      const key = monthIdx >= 0 ? `${yearStr}-${String(monthIdx + 1).padStart(2, "0")}` : null;
      const waitWeeks = key ? hygieneWaitTrendQ.data?.get(key) ?? null : null;
      return {
        month: point.month,
        fullLabel: point.fullLabel,
        leavers: point.value,
        waitWeeks: waitWeeks != null ? Math.round(waitWeeks * 10) / 10 : null,
      };
    });
  }, [trendsQ.trends.leavers, hygieneWaitTrendQ.data]);

  const treatmentTypeByExternalId = useMemo(() => {
    const map = new Map<string, "exam" | "hygiene" | "xray" | "other">();
    for (const t of dbTreatments) {
      if (t.external_id == null) continue;
      map.set(String(t.external_id), classifyVisitType(t.category?.name ?? null, t.treatment_name ?? null));
    }
    return map;
  }, [dbTreatments]);

  const redemptionQ = useQuery({
    queryKey: ["insights_capacity_redemption", organizationId, matchedMembersKey, treatmentTypeByExternalId.size],
    // Waits for the treatments catalog too — otherwise this could run once
    // with an empty classification map (dbTreatments still loading) and,
    // since queryFn closures aren't re-invoked just because a referenced
    // variable changes, get stuck showing 0 redeemed for the session.
    enabled: !!organizationId && matchedMembers.length > 0 && !treatmentsLoading && treatmentTypeByExternalId.size > 0,
    queryFn: async () => {
      // Entitlement is inherently annual — always trailing 12 months from
      // today, independent of the page's own date-range filter.
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd);
      windowStart.setFullYear(windowStart.getFullYear() - 1);
      const fromISO = ukDayStartInstant(windowStart);
      const toISO = ukDayEndInstant(windowEnd);

      // membership_upload_members.patient_id may hold either pt_id or
      // pt_legacy_id (same caveat as the Members worklist query) — resolve
      // both in one combined query.
      const legacyKeys = Array.from(new Set(matchedMembers.map((m) => String(m.patient_id).trim())));
      const { data: patientRows, error: ptErr } = await (supabase as any)
        .from("patients")
        .select("pt_id, pt_legacy_id, pt_unique_id")
        .eq("organization_id", organizationId)
        .or(`pt_id.in.(${legacyKeys.join(",")}),pt_legacy_id.in.(${legacyKeys.join(",")})`);
      if (ptErr) throw ptErr;
      const keyToPtId = new Map<string, string>();
      const uuidByPtId = new Map<string, string>();
      for (const p of patientRows ?? []) {
        if (p.pt_id != null) {
          keyToPtId.set(String(p.pt_id), String(p.pt_id));
          if (p.pt_unique_id) uuidByPtId.set(String(p.pt_id), String(p.pt_unique_id));
        }
        if (p.pt_legacy_id != null && p.pt_id != null) keyToPtId.set(String(p.pt_legacy_id).trim(), String(p.pt_id));
      }

      const planIds = Array.from(new Set(matchedMembers.map((m) => m.mapped_plan_id!)));
      // exams_included_override/hygiene_included_override (migration
      // 20260813000001) and xray_included_override (migration
      // 20260815000001) may not be applied yet — Postgres rejects the whole
      // select if a requested column doesn't exist, which would otherwise
      // take the entire redemption feature down with it. Try with the
      // override columns first; on a missing-column error, retry without
      // them so entitlement keeps working off Dentally's own value.
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
        // Manual override (Settings tab) wins when set — most practices
        // never configure this in Dentally itself, leaving its own columns
        // empty for every plan. Xray has no Dentally-synced value at all, so
        // it's override-only.
        const overrideExam = hasOverrideColumns ? p.exams_included_override : null;
        const overrideHygiene = hasOverrideColumns ? p.hygiene_included_override : null;
        const overrideXray = hasOverrideColumns ? p.xray_included_override : null;
        entitlementByPlanId.set(p.id, {
          exam: overrideExam != null ? Number(overrideExam) : Number(p.pp_exam_appointments_included) || 0,
          hygiene: overrideHygiene != null ? Number(overrideHygiene) : Number(p.pp_hygiene_appointments_included) || 0,
          xray: overrideXray != null ? Number(overrideXray) : 0,
        });
      }

      type ResolvedMember = {
        patientId: string;
        ptId: string;
        name: string;
        patientUuid: string | null;
        locationId: string | null;
        examEntitled: number;
        hygieneEntitled: number;
        xrayEntitled: number;
      };
      const resolved: ResolvedMember[] = [];
      for (const m of matchedMembers) {
        const ptId = keyToPtId.get(String(m.patient_id).trim());
        const entitlement = entitlementByPlanId.get(m.mapped_plan_id!);
        if (!ptId || !entitlement) continue;
        resolved.push({
          patientId: m.patient_id!,
          ptId,
          name: [m.title, m.initial, m.surname].filter(Boolean).join(" ") || m.surname,
          patientUuid: uuidByPtId.get(ptId) ?? null,
          locationId: m.location_id,
          examEntitled: entitlement.exam,
          hygieneEntitled: entitlement.hygiene,
          xrayEntitled: entitlement.xray,
        });
      }
      if (resolved.length === 0) return null;

      const ptIds = Array.from(new Set(resolved.map((m) => m.ptId)));

      // Delivered treatment items only (tpi_treatment_appointment_id > 0
      // excludes planning/charting rows) — matches the gate already
      // established for revenue-affecting TPI reads elsewhere in the app.
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
        const type = treatmentTypeByExternalId.get(String(row.tpi_treatment_id));
        if (type !== "exam" && type !== "hygiene" && type !== "xray") continue;
        const ptKey = String(row.tpi_patient_id);
        const map = type === "exam" ? examCountByPtId : type === "hygiene" ? hygieneCountByPtId : xrayCountByPtId;
        map.set(ptKey, (map.get(ptKey) ?? 0) + 1);
      }

      const bucket = (redeemed: number, entitled: number): "none" | "partial" | "full" | null => {
        if (entitled <= 0) return null;
        if (redeemed <= 0) return "none";
        if (redeemed >= entitled) return "full";
        return "partial";
      };

      const hygiene: RedemptionBuckets = { none: 0, partial: 0, full: 0 };
      const exam: RedemptionBuckets = { none: 0, partial: 0, full: 0 };
      const xray: RedemptionBuckets = { none: 0, partial: 0, full: 0 };
      const hygieneMembers: RedemptionMember[] = [];
      const examMembers: RedemptionMember[] = [];
      const xrayMembers: RedemptionMember[] = [];
      let visitsOwedAYear = 0;
      const byLocation = new Map<string, { noHygiene: number; noExam: number; noXray: number }>();

      for (const m of resolved) {
        visitsOwedAYear += m.examEntitled + m.hygieneEntitled + m.xrayEntitled;
        const examCount = examCountByPtId.get(m.ptId) ?? 0;
        const hygieneCount = hygieneCountByPtId.get(m.ptId) ?? 0;
        const xrayCount = xrayCountByPtId.get(m.ptId) ?? 0;
        const examBucket = bucket(examCount, m.examEntitled);
        const hygieneBucket = bucket(hygieneCount, m.hygieneEntitled);
        const xrayBucket = bucket(xrayCount, m.xrayEntitled);
        if (examBucket) {
          exam[examBucket] += 1;
          examMembers.push({
            id: m.patientId,
            name: m.name,
            patientUuid: m.patientUuid,
            bucket: examBucket,
            redeemed: examCount,
            entitled: m.examEntitled,
          });
        }
        if (hygieneBucket) {
          hygiene[hygieneBucket] += 1;
          hygieneMembers.push({
            id: m.patientId,
            name: m.name,
            patientUuid: m.patientUuid,
            bucket: hygieneBucket,
            redeemed: hygieneCount,
            entitled: m.hygieneEntitled,
          });
        }
        if (xrayBucket) {
          xray[xrayBucket] += 1;
          xrayMembers.push({
            id: m.patientId,
            name: m.name,
            patientUuid: m.patientUuid,
            bucket: xrayBucket,
            redeemed: xrayCount,
            entitled: m.xrayEntitled,
          });
        }

        if (m.locationId) {
          const locRow = byLocation.get(m.locationId) ?? { noHygiene: 0, noExam: 0, noXray: 0 };
          if (hygieneBucket === "none") locRow.noHygiene += 1;
          if (examBucket === "none") locRow.noExam += 1;
          if (xrayBucket === "none") locRow.noXray += 1;
          byLocation.set(m.locationId, locRow);
        }
      }

      // "Seen" 6/12 months — any real (non-cancelled/DNA) appointment.
      const seenSince = (months: number) => {
        const d = new Date();
        d.setMonth(d.getMonth() - months);
        return ukDayStartInstant(d);
      };
      const { data: recentAppts, error: apErr } = await (supabase as any)
        .from("appointments")
        .select("apmt_patient_id, apmt_state, apmt_start_time")
        .eq("organization_id", organizationId)
        .in("apmt_patient_id", ptIds)
        .gte("apmt_start_time", seenSince(12))
        .is("deleted_at", null);
      if (apErr) throw apErr;
      const seen6 = new Set<string>();
      const seen12 = new Set<string>();
      const sixMonthsAgo = seenSince(6);
      for (const a of recentAppts ?? []) {
        const state = String(a.apmt_state ?? "").toLowerCase();
        if (LOSS_STATES.has(state)) continue;
        const key = String(a.apmt_patient_id);
        seen12.add(key);
        if (a.apmt_start_time >= sixMonthsAgo) seen6.add(key);
      }
      const seenPct6m = Math.round((ptIds.filter((id) => seen6.has(id)).length / ptIds.length) * 100);
      const seenPct12m = Math.round((ptIds.filter((id) => seen12.has(id)).length / ptIds.length) * 100);

      return {
        hygiene,
        exam,
        xray,
        hygieneMembers,
        examMembers,
        xrayMembers,
        visitsOwedAYear,
        matchedPlanMembers: resolved.length,
        byLocation,
        seenPct6m,
        seenPct12m,
      };
    },
  });

  const rows: ChairMetric[] = chairQ.data ?? [];
  const totals = useMemo(() => {
    const completedHours = rows.reduce((s, r) => s + (r.completed_hours || 0), 0);
    const availableHours = rows.reduce((s, r) => s + (r.available_hours || 0), 0);
    const treatmentHours = rows.reduce((s, r) => s + (r.treatment_hours || 0), 0);
    return {
      occupancyPct: availableHours > 0 ? Math.round((completedHours / availableHours) * 100) : 0,
      utilisationPct: availableHours > 0 ? Math.round((treatmentHours / availableHours) * 100) : 0,
      completedHours: Math.round(completedHours),
      availableHours: Math.round(availableHours),
      treatmentHours: Math.round(treatmentHours),
    };
  }, [rows]);

  const byLocation: CapacityLocationRow[] = rows.map((r) => {
    const lossRow = lossQ.data?.byLocation.get(r.location_id);
    const churnRow = churn.byLocation.get(r.location_id);
    const redemptionRow = redemptionQ.data?.byLocation.get(r.location_id);
    return {
      locationId: r.location_id,
      name: r.location_name,
      occupancyPct: Math.round(r.occupancy_pct || 0),
      utilisationPct: Math.round(r.utilisation_pct || 0),
      completedHours: Math.round(r.completed_hours || 0),
      availableHours: Math.round(r.available_hours || 0),
      shortNoticeLossPct:
        lossRow && lossRow.total > 0 ? Math.round((lossRow.lost / lossRow.total) * 100) : null,
      churnPct: churnRow?.churnPct ?? null,
      noHygiene: redemptionRow?.noHygiene ?? null,
      noExam: redemptionRow?.noExam ?? null,
      noXray: redemptionRow?.noXray ?? null,
      bookedPct: hygieneByLocationQ.data?.get(r.location_id) ?? null,
      waitWeeks: waitTimeQ.data?.byLocation.get(r.location_id) ?? null,
    };
  });

  return {
    isLoading: chairQ.isLoading || lossQ.isLoading || hygieneQ.isLoading || treatmentsLoading || waitTimeQ.isLoading,
    hasData: rows.length > 0,
    ...totals,
    shortNoticeLossPct:
      lossQ.data && lossQ.data.total > 0 ? Math.round((lossQ.data.lost / lossQ.data.total) * 100) : 0,
    totalAppointments: lossQ.data?.total ?? 0,
    lostAppointments: lossQ.data?.lost ?? 0,
    hygieneBookedPct: hygieneQ.data?.pct ?? null,
    hygieneBookedHours: Math.round(hygieneQ.data?.bookedHours ?? 0),
    hygieneAvailableHours: Math.round(hygieneQ.data?.availableHours ?? 0),
    byLocation,
    hygieneRedemption: redemptionQ.data?.hygiene ?? null,
    examRedemption: redemptionQ.data?.exam ?? null,
    xrayRedemption: redemptionQ.data?.xray ?? null,
    hygieneRedemptionMembers: redemptionQ.data?.hygieneMembers ?? [],
    examRedemptionMembers: redemptionQ.data?.examMembers ?? [],
    xrayRedemptionMembers: redemptionQ.data?.xrayMembers ?? [],
    visitsOwedAYear: redemptionQ.data?.visitsOwedAYear ?? 0,
    matchedPlanMembers: redemptionQ.data?.matchedPlanMembers ?? 0,
    seenPct6m: redemptionQ.data?.seenPct6m ?? null,
    seenPct12m: redemptionQ.data?.seenPct12m ?? null,
    waitWeeks: waitTimeQ.data?.overall ?? null,
    hygieneChurnTrend,
  };
}
