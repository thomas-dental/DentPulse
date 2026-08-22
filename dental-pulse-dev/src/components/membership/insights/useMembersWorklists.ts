import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useMembershipUploadData } from "@/hooks/useMembershipUploadData";
import {
  useMembershipStatementInsights,
  type StatementEventInsight,
} from "@/hooks/useMembershipStatementInsights";
import { ukDayStartInstant } from "@/utils/dateRangeUtils";
import type { MemberFilterKey } from "./InsightsProvider";

export type SignalTone = "risk" | "warn" | "info" | "good";

export interface WorklistRow {
  id: string;
  name: string;
  /** "Member ID · treating dentist", whichever parts are known — the same
   *  identity line the Plan Revenue page's own member tables show. */
  subtitle: string | null;
  plan: string | null;
  /** Short signal label for the row's own tag pill — set per source (a row
   *  folded into "at-risk" from arrears keeps its "In arrears" tag, not a
   *  generic "At risk" one), matching the reference design where different
   *  rows under one filter show different specific reasons. */
  signal: string;
  signalTone: SignalTone;
  detail: string;
  /** Plan value — consistent meaning across every bucket (the member's own
   *  net_due), unlike the reference's per-row invented "Value". */
  amount: number | null;
  /** Real per-row urgency number shown in the Risk column: elapsed days for
   *  sleeping/arrears/at-risk rows, £ of private spend for upgrade rows.
   *  Never a fabricated 0-100 score — always one real observed quantity. */
  metric: number | null;
  metricUnit: "days" | "gbp" | null;
  /** patients.pt_unique_id — Dentally patient UUID, for the row name's
   *  deep-link to https://app.dentally.co/patients/<uuid>/appointments.
   *  Null when the member's patient_id couldn't be resolved to a matched
   *  Dentally patient (same mechanism as the other tabs' deep-links). */
  patientUuid: string | null;
}

export interface TenureBucket {
  label: string;
  count: number;
  /** Members in this bucket currently showing a real risk signal — archived
   *  in Dentally while still on a paying plan, or no completed visit in the
   *  last 6 months. NOT "left the plan" (a current member can't have left
   *  by definition) — a live warning sign, cross-tabulated by tenure. */
  atRiskCount: number;
}

export interface MembersWorklists {
  isLoading: boolean;
  hasStatementData: boolean;
  hasUploadData: boolean;
  rows: Record<MemberFilterKey, WorklistRow[]>;
  counts: Record<MemberFilterKey, number>;
  /** Archived-in-Dentally-but-still-paying count — folded into "at-risk" as
   *  a filter, but the Overview tab's own card needs the raw count too. */
  archivedCount: number;
  /** Current members bucketed by real tenure (patients.pt_created_at — the
   *  closest real proxy to "how long they've been with the practice", NOT a
   *  join-cohort survival rate; see the tenureBuckets computation below for
   *  why a true survival curve isn't buildable at all from this data). */
  tenureBuckets: TenureBucket[];
}

const TENURE_BUCKET_LABELS = ["Under 6 months", "6 to 12 months", "1 to 2 years", "2 to 5 years", "Over 5 years"];

function bucketTenure(entries: Array<{ createdAt: string; atRisk: boolean }>): TenureBucket[] {
  const counts = [0, 0, 0, 0, 0];
  const atRiskCounts = [0, 0, 0, 0, 0];
  const now = Date.now();
  for (const e of entries) {
    const days = (now - new Date(e.createdAt).getTime()) / 86_400_000;
    let i: number;
    if (days < 182) i = 0;
    else if (days < 365) i = 1;
    else if (days < 730) i = 2;
    else if (days < 1825) i = 3;
    else i = 4;
    counts[i]++;
    if (e.atRisk) atRiskCounts[i]++;
  }
  return TENURE_BUCKET_LABELS.map((label, i) => ({ label, count: counts[i], atRiskCount: atRiskCounts[i] }));
}

// 6 months, not 12 — client request 2026-08-11.
const NO_VISIT_DAYS = 182;
const INACTIVE_APPOINTMENT_STATES = new Set(["cancelled", "did not attend", "dna"]);
// Same placeholder-DOB set useOverviewData.ts's dataGapsCount uses — keep in sync.
const PLACEHOLDER_DOBS = new Set(["1900-01-01", "1901-01-01"]);
// Floor above which private (non-plan) spend is worth flagging as an
// upgrade conversation, rather than a one-off top-up treatment.
const UPGRADE_SPEND_FLOOR = 20;

function daysAgo(dateIso: string): number {
  const then = new Date(`${dateIso}T00:00:00`).getTime();
  return Math.round((Date.now() - then) / 86_400_000);
}

function memberName(m: { title: string | null; initial: string | null; surname: string }): string {
  return [m.title, m.initial, m.surname].filter(Boolean).join(" ") || m.surname;
}

function fromStatementEvent(e: StatementEventInsight, signal: string, tone: SignalTone): WorklistRow {
  return {
    id: e.id,
    name: e.displayName,
    subtitle: [e.ppPatientId, e.dentist].filter(Boolean).join(" · ") || null,
    plan: e.feeCategory,
    signal,
    signalTone: tone,
    detail: e.eventDate ? new Date(`${e.eventDate}T00:00:00`).toLocaleDateString("en-GB") : "",
    amount: e.amount,
    metric: e.eventDate ? daysAgo(e.eventDate) : null,
    metricUnit: "days",
    patientUuid: e.patientUuid,
  };
}

/** Members tab's real worklists, matching the reference design's five
 *  categories (At risk / Sleeping / Arrears / Upgrade / Data gaps) — every
 *  number here is sourced from real data (Practice Plan statement events,
 *  Dentally appointments/patients/treatment items), never invented:
 *   - Sleeping: no completed appointment in the last year.
 *   - Arrears: this month's failed collections, enriched with the real
 *     all-time failed count/total for that patient.
 *   - Upgrade: real private (non-plan) treatment spend in the last year —
 *     a genuine proxy for "getting more from us than their plan covers";
 *     entitlement redemption (hygiene visits owed vs. taken) isn't tracked
 *     anywhere in this app yet (see CapacityTab), so it can't back this.
 *   - Data gaps: missing/placeholder date of birth, or no email on file.
 *   - At risk: the union of arrears, cancelled-this-month and archived
 *     members — each row keeps its own originating signal tag/detail. */
export function useMembersWorklists(): MembersWorklists {
  const { organizationId } = useOrganization();
  const { members: uploadedMembers, totalMembers, effectivePairs } = useMembershipUploadData();
  // Every statement in the header's selected range, not just its last month
  // — a wide range like "This Year" must surface arrears/cancelled rows from
  // every uploaded statement in range, matching how `members` already
  // aggregates the whole range.
  const statementQ = useMembershipStatementInsights(effectivePairs);

  const membersWithPatientIds = useMemo(
    () => uploadedMembers.filter((m) => m.patient_id != null),
    [uploadedMembers],
  );
  const patientKeysKey = membersWithPatientIds.map((m) => m.patient_id).sort().join(",");

  // One combined query: resolve each member's real pt_id (patient_id on
  // membership_upload_members may hold pt_id or pt_legacy_id — same caveat
  // useMembershipStatementInsights already documents), then check whether
  // they've visited recently, whether Dentally has archived them, and
  // whether they have an email on file.
  const statusQ = useQuery({
    queryKey: ["insights_members_status", organizationId, patientKeysKey],
    enabled: !!organizationId && membersWithPatientIds.length > 0,
    queryFn: async (): Promise<{
      visitedKeys: Set<string>;
      archivedKeys: Set<string>;
      noEmailKeys: Set<string>;
      lastVisitByKey: Map<string, string>;
      keyToPtId: Map<string, string>;
      uuidByKey: Map<string, string>;
      ptIds: string[];
      tenureBuckets: TenureBucket[];
    }> => {
      const keys = Array.from(new Set(membersWithPatientIds.map((m) => String(m.patient_id).trim())));
      const { data: patientRows, error: ptErr } = await (supabase as any)
        .from("patients")
        .select("pt_id, pt_legacy_id, pt_unique_id, pt_email, pt_created_at, is_active")
        .eq("organization_id", organizationId)
        .or(`pt_id.in.(${keys.join(",")}),pt_legacy_id.in.(${keys.join(",")})`);
      if (ptErr) throw ptErr;

      const keyToPtId = new Map<string, string>();
      const isActiveByPtId = new Map<string, boolean>();
      const hasEmailByPtId = new Map<string, boolean>();
      const createdAtByPtId = new Map<string, string>();
      const uuidByPtId = new Map<string, string>();
      for (const p of patientRows ?? []) {
        if (p.pt_id != null) {
          keyToPtId.set(String(p.pt_id), String(p.pt_id));
          isActiveByPtId.set(String(p.pt_id), p.is_active !== false);
          hasEmailByPtId.set(String(p.pt_id), !!String(p.pt_email ?? "").trim());
          if (p.pt_created_at) createdAtByPtId.set(String(p.pt_id), p.pt_created_at);
          if (p.pt_unique_id) uuidByPtId.set(String(p.pt_id), String(p.pt_unique_id));
        }
        if (p.pt_legacy_id != null && p.pt_id != null) {
          keyToPtId.set(String(p.pt_legacy_id).trim(), String(p.pt_id));
        }
      }
      const uuidByKey = new Map<string, string>();
      for (const key of keys) {
        const ptId = keyToPtId.get(key);
        const uuid = ptId ? uuidByPtId.get(ptId) : undefined;
        if (uuid) uuidByKey.set(key, uuid);
      }

      const archivedKeys = new Set<string>();
      const noEmailKeys = new Set<string>();
      for (const key of keys) {
        const ptId = keyToPtId.get(key);
        if (ptId && isActiveByPtId.get(ptId) === false) archivedKeys.add(key);
        if (ptId && hasEmailByPtId.get(ptId) === false) noEmailKeys.add(key);
      }

      const ptIds = Array.from(new Set([...keyToPtId.values()]));
      if (ptIds.length === 0) {
        // No real tenure/risk data possible without resolved patients — bucket
        // whatever createdAt dates we have (none) with atRisk always false.
        const tenureBuckets = bucketTenure([]);
        return { visitedKeys: new Set(), archivedKeys, noEmailKeys, lastVisitByKey: new Map(), keyToPtId, uuidByKey, ptIds, tenureBuckets };
      }

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - NO_VISIT_DAYS);
      const { data: appts, error: apErr } = await (supabase as any)
        .from("appointments")
        .select("apmt_patient_id, apmt_state")
        .eq("organization_id", organizationId)
        .in("apmt_patient_id", ptIds)
        .gte("apmt_start_time", ukDayStartInstant(cutoff));
      if (apErr) throw apErr;

      const visitedPtIds = new Set<string>();
      for (const a of appts ?? []) {
        const state = String(a.apmt_state ?? "").toLowerCase();
        if (INACTIVE_APPOINTMENT_STATES.has(state)) continue;
        visitedPtIds.add(String(a.apmt_patient_id));
      }
      // Re-key back onto membership_upload_members.patient_id so the
      // caller can filter the original member list directly.
      const visitedKeys = new Set<string>();
      for (const key of keys) {
        const ptId = keyToPtId.get(key);
        if (ptId && visitedPtIds.has(ptId)) visitedKeys.add(key);
      }

      // For the sleeping bucket only: their real last completed appointment
      // date (unbounded lookback), so the tab can show real days-overdue
      // instead of a fabricated risk score. Ordered desc and reduced to
      // first-seen-per-patient — cheap because this only covers patients
      // who already failed the 365-day cutoff above, a small subset.
      const notVisitedPtIds = ptIds.filter((id) => !visitedPtIds.has(id));
      const lastVisitByPtId = new Map<string, string>();
      if (notVisitedPtIds.length > 0) {
        const { data: history, error: histErr } = await (supabase as any)
          .from("appointments")
          .select("apmt_patient_id, apmt_state, apmt_start_time")
          .eq("organization_id", organizationId)
          .in("apmt_patient_id", notVisitedPtIds)
          .order("apmt_start_time", { ascending: false })
          .limit(5000);
        if (histErr) throw histErr;
        for (const a of history ?? []) {
          const state = String(a.apmt_state ?? "").toLowerCase();
          if (INACTIVE_APPOINTMENT_STATES.has(state)) continue;
          const ptId = String(a.apmt_patient_id);
          if (!lastVisitByPtId.has(ptId)) lastVisitByPtId.set(ptId, String(a.apmt_start_time).slice(0, 10));
        }
      }
      const lastVisitByKey = new Map<string, string>();
      for (const key of keys) {
        const ptId = keyToPtId.get(key);
        const lastVisit = ptId ? lastVisitByPtId.get(ptId) : undefined;
        if (lastVisit) lastVisitByKey.set(key, lastVisit);
      }

      // Real member tenure, bucketed the same way the reference design's
      // cohort chart is — but from `patients.pt_created_at` (Dentally's own
      // patient-record creation date), the closest real signal available.
      // NOT a true join-cohort survival rate: Dentally has no
      // subscription-history endpoint (see migration 20260807000001), so
      // there's no way to know how many past members in each cohort already
      // left (a current member can't have left by definition). The red
      // portion is a real CURRENT risk signal instead — archived-but-paying
      // or no visit in 6 months — cross-tabulated by tenure, not "left".
      const tenureBuckets = bucketTenure(
        keys
          .map((key) => {
            const ptId = keyToPtId.get(key);
            const createdAt = ptId ? createdAtByPtId.get(ptId) : undefined;
            if (!createdAt) return null;
            const atRisk = archivedKeys.has(key) || !visitedKeys.has(key);
            return { createdAt, atRisk };
          })
          .filter((e): e is { createdAt: string; atRisk: boolean } => e != null),
      );

      return { visitedKeys, archivedKeys, noEmailKeys, lastVisitByKey, keyToPtId, uuidByKey, ptIds, tenureBuckets };
    },
  });

  // Real all-time failed-collection history per Practice Plan patient id
  // (org-wide, every statement month) — lets an arrears row say "Two failed
  // collections, £12.28 outstanding" instead of just this month's amount.
  const arrearsHistoryQ = useQuery({
    queryKey: ["insights_arrears_history", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<Map<string, { count: number; total: number }>> => {
      const { data, error } = await (supabase as any)
        .from("membership_statement_events")
        .select("pp_patient_id, amount")
        .eq("organization_id", organizationId)
        .eq("event_type", "failed_collection")
        .not("pp_patient_id", "is", null);
      if (error) throw error;
      const byPpId = new Map<string, { count: number; total: number }>();
      for (const row of data ?? []) {
        const key = String(row.pp_patient_id);
        const cur = byPpId.get(key) ?? { count: 0, total: 0 };
        cur.count += 1;
        cur.total += Number(row.amount) || 0;
        byPpId.set(key, cur);
      }
      return byPpId;
    },
  });

  // Real private (non-plan) treatment spend per patient in the last year —
  // same reconciled gate as useMembershipAdditionalRevenue (completed,
  // dated, appointment-linked treatment_plan_items), just grouped by
  // patient instead of by plan.
  const upgradeQ = useQuery({
    queryKey: ["insights_upgrade_spend", organizationId, (statusQ.data?.ptIds ?? []).slice().sort().join(",")],
    enabled: !!organizationId && (statusQ.data?.ptIds.length ?? 0) > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const ptIds = statusQ.data!.ptIds;
      const since = new Date();
      since.setDate(since.getDate() - 365);
      const { data, error } = await (supabase as any)
        .from("treatment_plan_items")
        .select("tpi_patient_id, tpi_price")
        .eq("organization_id", organizationId)
        .eq("tpi_completed", true)
        .not("tpi_completed_at", "is", null)
        .not("tpi_treatment_appointment_id", "is", null)
        .gte("tpi_completed_at", ukDayStartInstant(since))
        .in("tpi_patient_id", ptIds);
      if (error) throw error;
      const byPtId = new Map<string, number>();
      for (const row of data ?? []) {
        if (row.tpi_patient_id == null) continue;
        const key = String(row.tpi_patient_id);
        const price = typeof row.tpi_price === "number" ? row.tpi_price : Number(row.tpi_price) || 0;
        byPtId.set(key, (byPtId.get(key) ?? 0) + price);
      }
      return byPtId;
    },
  });

  const sleeping = useMemo<WorklistRow[]>(() => {
    if (!statusQ.data) return [];
    return membersWithPatientIds
      .filter((m) => !statusQ.data!.visitedKeys.has(String(m.patient_id)))
      .map((m) => {
        const lastVisit = statusQ.data!.lastVisitByKey.get(String(m.patient_id));
        return {
          id: m.id,
          name: memberName(m),
          subtitle: [m.pay_grp_id, m.treating_dentist].filter(Boolean).join(" · ") || null,
          plan: m.fee_category,
          signal: "Sleeping",
          signalTone: "warn" as SignalTone,
          detail: lastVisit
            ? `Last completed visit ${new Date(`${lastVisit}T00:00:00`).toLocaleDateString("en-GB")}`
            : "No completed visit on record",
          amount: m.net_due,
          metric: lastVisit ? daysAgo(lastVisit) : null,
          metricUnit: "days" as const,
          patientUuid: statusQ.data!.uuidByKey.get(String(m.patient_id)) ?? null,
        };
      })
      // Never-visited (no record at all) is at least as urgent as any dated
      // gap, so it sorts first; otherwise longest-overdue first.
      .sort((a, b) => (b.metric ?? Infinity) - (a.metric ?? Infinity));
  }, [membersWithPatientIds, statusQ.data]);

  const archived = useMemo<WorklistRow[]>(() => {
    if (!statusQ.data) return [];
    return membersWithPatientIds
      .filter((m) => statusQ.data!.archivedKeys.has(String(m.patient_id)))
      .map((m) => ({
        id: m.id,
        name: memberName(m),
        subtitle: [m.pay_grp_id, m.treating_dentist].filter(Boolean).join(" · ") || null,
        plan: m.fee_category,
        signal: "Archived, still paying",
        signalTone: "risk" as SignalTone,
        detail: "Archived in Dentally, still on a paying plan",
        amount: m.net_due,
        metric: null,
        metricUnit: null,
        patientUuid: statusQ.data!.uuidByKey.get(String(m.patient_id)) ?? null,
      }))
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  }, [membersWithPatientIds, statusQ.data]);

  const gaps = useMemo<WorklistRow[]>(() => {
    if (!statusQ.data) return [];
    return membersWithPatientIds
      .filter((m) => {
        const dobGap = !m.dob || PLACEHOLDER_DOBS.has(String(m.dob).slice(0, 10));
        const emailGap = statusQ.data!.noEmailKeys.has(String(m.patient_id));
        return dobGap || emailGap;
      })
      .map((m) => {
        const dobGap = !m.dob || PLACEHOLDER_DOBS.has(String(m.dob).slice(0, 10));
        const emailGap = statusQ.data!.noEmailKeys.has(String(m.patient_id));
        const reasons = [dobGap && "no date of birth", emailGap && "no email address"].filter(Boolean);
        return {
          id: m.id,
          name: memberName(m),
          subtitle: [m.pay_grp_id, m.treating_dentist].filter(Boolean).join(" · ") || null,
          plan: m.fee_category,
          signal: "Data gap",
          signalTone: "info" as SignalTone,
          detail: `Missing ${reasons.join(" and ")} — can't be reached for recall or fee notices`,
          amount: m.net_due,
          metric: null,
          metricUnit: null,
          patientUuid: statusQ.data!.uuidByKey.get(String(m.patient_id)) ?? null,
        };
      });
  }, [membersWithPatientIds, statusQ.data]);

  const upgrade = useMemo<WorklistRow[]>(() => {
    if (!statusQ.data || !upgradeQ.data) return [];
    return membersWithPatientIds
      .flatMap((m) => {
        const key = String(m.patient_id);
        const ptId = statusQ.data!.keyToPtId.get(key);
        const spend = ptId ? upgradeQ.data!.get(ptId) ?? 0 : 0;
        if (spend < UPGRADE_SPEND_FLOOR) return [];
        const row: WorklistRow = {
          id: m.id,
          name: memberName(m),
          subtitle: [m.pay_grp_id, m.treating_dentist].filter(Boolean).join(" · ") || null,
          plan: m.fee_category,
          signal: "Upgrade candidate",
          signalTone: "good" as SignalTone,
          detail: `£${Math.round(spend)} in private treatment over the last year — beyond what their plan covers`,
          amount: m.net_due,
          metric: Math.round(spend),
          metricUnit: "gbp" as const,
          patientUuid: statusQ.data!.uuidByKey.get(key) ?? null,
        };
        return [row];
      })
      .sort((a, b) => (b.metric ?? 0) - (a.metric ?? 0));
  }, [membersWithPatientIds, statusQ.data, upgradeQ.data]);

  const arrears = useMemo<WorklistRow[]>(() => {
    const events = statementQ.data?.failedEvents ?? [];
    return events
      .map((e) => {
        const history = e.ppPatientId ? arrearsHistoryQ.data?.get(e.ppPatientId) : undefined;
        const row = fromStatementEvent(e, "In arrears", "risk");
        if (history && history.count > 0) {
          row.detail = `${history.count === 1 ? "One" : history.count} failed collection${history.count === 1 ? "" : "s"}, £${history.total.toFixed(2)} outstanding`;
        }
        return row;
      })
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  }, [statementQ.data, arrearsHistoryQ.data]);

  const cancelledThisMonth = useMemo<WorklistRow[]>(
    () =>
      (statementQ.data?.cancelledEvents ?? [])
        .map((e) => fromStatementEvent(e, "Cancelled", "warn"))
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    [statementQ.data],
  );

  // "At risk" — the union of every acute problem: money not collected,
  // patients who left the plan this month, and patients still being charged
  // after Dentally shows them archived. Each row keeps the tag/detail of
  // whichever bucket it came from, so — like the reference design — rows in
  // this view show varied, specific reasons rather than one generic label.
  const atRisk = useMemo<WorklistRow[]>(
    () => [...arrears, ...cancelledThisMonth, ...archived].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    [arrears, cancelledThisMonth, archived],
  );

  return {
    isLoading: statementQ.isLoading || statusQ.isLoading || upgradeQ.isLoading,
    hasStatementData: !!statementQ.data?.hasStatements,
    hasUploadData: totalMembers > 0,
    rows: { "at-risk": atRisk, sleeping, arrears, upgrade, gaps },
    counts: {
      "at-risk": atRisk.length,
      sleeping: sleeping.length,
      arrears: arrears.length,
      upgrade: upgrade.length,
      gaps: gaps.length,
    },
    archivedCount: archived.length,
    tenureBuckets: statusQ.data?.tenureBuckets ?? [],
  };
}
