import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useMembershipUploadData, MONTH_NAMES } from "@/hooks/useMembershipUploadData";
import { useMembershipStatementInsights } from "@/hooks/useMembershipStatementInsights";
import { useMembershipTrends } from "@/hooks/useMembershipTrends";
import { useChairMetrics } from "@/hooks/useChairMetrics";
import { useLocationMetrics } from "@/hooks/useLocationMetrics";
import { useFilters } from "@/contexts/FilterContext";
import { toLocalYMD } from "@/utils/dateRangeUtils";
import { useMembersWorklists } from "./useMembersWorklists";
import { useChurnData } from "./useChurnData";

const PLACEHOLDER_DOBS = new Set(["1900-01-01", "1901-01-01"]);

// Clinician role match — same ilike patterns useAllProvidersWorkingHours.ts
// uses for its dentist/hygienist/therapist categories, combined into one
// OR filter (this table doesn't need the per-type breakdown that hook does).
const CLINICIAN_ROLE_FILTER = [
  "provider_role.ilike.%dentist%",
  "provider_role.ilike.%dental surgeon%",
  "provider_role.ilike.%principal dentist%",
  "provider_role.ilike.%hygienist%",
  "provider_role.ilike.%dental hygienist%",
  "provider_role.ilike.%hygiene%",
  "provider_role.ilike.%therapist%",
  "provider_role.ilike.%dental therapist%",
  "provider_role.ilike.%therapy%",
].join(",");
// No FTE/contracted-hours field exists anywhere in this app (confirmed 2026-08-14)
// — providers only have actual worked hours (appointment_summary). Per client
// decision, FTE here is hours-weighted: actual clinician hours in the selected
// period ÷ a standard full-time week, industry-standard 37.5h.
const STANDARD_FULL_TIME_HOURS_PER_WEEK = 37.5;

export interface OverviewLocationRow {
  locationId: string | null;
  name: string;
  members: number;
  net: number;
  churnPct: number | null;
  /** Location net due ÷ location chair-metrics revenue (same source as the
   *  page-level Plan share stat) — null when no revenue for the location. */
  planSharePct: number | null;
  /** Monthly net-due sums for the last up-to-12 uploaded months, oldest
   *  first — feeds the 12m sparkline column. */
  trend: number[];
  /** Profit Benchmark's Actual Profit for this site, for the header's
   *  selected period — same source as Group Dashboard's Operating Profit
   *  tile (useLocationMetrics' netProfit), so this table's EBITDA agrees
   *  with the rest of the app rather than introducing a second definition.
   *  null while useLocationMetrics hasn't resolved this location yet. */
  ebitda: number | null;
  ebitdaPct: number | null;
  /** Hours-weighted FTE clinician count for this site over the header's
   *  selected period — active dentist/hygienist/therapist providers' actual
   *  worked hours (appointment_summary) ÷ (37.5h × weeks in period). null
   *  when no clinician hours are recorded for the site in this period. */
  fte: number | null;
  /** members ÷ fte — null when fte is null or zero. */
  membersPerFte: number | null;
}

export interface OverviewData {
  isLoading: boolean;
  hasUploadData: boolean;
  hasStatementData: boolean;
  monthLabel: string;
  /** True when the header's selected range spans more than one statement
   *  month — figures below are summed across every statement in range, not
   *  a single month's. Callers should say "statements"/"the period", not
   *  "the statement". */
  isMultiMonth: boolean;
  netCash: number;
  activeMembers: number;
  failedValue: number;
  failedCount: number;
  cancelledCount: number;
  noVisitCount: number;
  archivedCount: number;
  /** Joiners minus leavers for the shown month, from the statement's own
   *  new-patient / cancelled-patient counts (null when neither is known). */
  monthNetMembers: number | null;
  monthJoined: number;
  monthLeft: number;
  /** Cumulative failed collections across EVERY uploaded statement month —
   *  the practice's total observed arrears exposure, as opposed to
   *  failedCount/failedValue which are the displayed month only. The
   *  statements don't say whether an old failure was later re-collected,
   *  so this is "failures observed to date", labelled as such in the UI. */
  arrearsCount: number;
  arrearsValue: number;
  grossValue: number;
  planSharePct: number | null;
  totalRevenue: number;
  cashTrendData: Array<{ label: string; value: number }>;
  /** Active-member count per uploaded month — one row per member per month
   *  in membership_upload_members, so a row count per month is the real
   *  member count for that month. Same up-to-12-month axis as cashTrendData. */
  memberTrendData: Array<{ label: string; value: number }>;
  clinicianBreakdown: Array<{ name: string; members: number; value: number }>;
  dataGapsCount: number;
  showLocationComparison: boolean;
  locationComparison: OverviewLocationRow[];
  /** Whole-org monthly net-due series (same axis as each row's trend) —
   *  the Group total row's sparkline. */
  groupTrend: number[];
  /** Real Practice Plan admin-fee for the month — the statement's own Plan
   *  Breakdown price minus what each member actually paid (after their own
   *  discount, if any). Not a printed line item; derived from two figures
   *  the statement already prints per member. See useOverviewData.ts. */
  practicePlanFeeValue: number;
  /** How many members the fee was derived from (monthly payers on
   *  monthly-priced plans) — the denominator for a per-member figure. */
  practicePlanFeeMemberCount: number;
  churnTrackingSince: string | null;
  churnJoined: number;
  churnLeft: number;
  churnPct: number | null;
}

/** Overview tab's real data — reuses the exact hooks that already power the
 *  Plan Revenue tab and the Statement Health / Trends sections, so numbers
 *  here always agree with the rest of the page. Org-wide (Practice Plan
 *  statement data has no location column), except the location-comparison
 *  table, which is built from membersByLocation. */
export function useOverviewData(): OverviewData {
  const { organizationId } = useOrganization();
  const { dateRange } = useFilters();
  const {
    members: uploadedMembers,
    totalMembers: uploadTotalMembers,
    displayMonth,
    effectivePairs,
    membersByLocation,
  } = useMembershipUploadData();

  // Every statement in the header's selected range, summed — not just
  // displayMonth (the range's last month), so a wide range like "This Year"
  // doesn't show "no statement uploaded" while earlier months in range have
  // real data. Single-month selections behave exactly as before (one pair).
  const statementQ = useMembershipStatementInsights(effectivePairs);
  const trendsQ = useMembershipTrends(displayMonth.month, displayMonth.year, null);
  const chairQ = useChairMetrics({ startDate: dateRange.startDate, endDate: dateRange.endDate });
  // Shares its query cache with the Members tab's own call to this hook —
  // no duplicate fetch, just the counts for the Needs Attention card.
  const worklists = useMembersWorklists();
  const churn = useChurnData();
  // Site Comparison's EBITDA column — same per-location Profit Benchmark
  // Actual Profit already used by Group Dashboard's Operating Profit tile
  // (see project_group_dashboard_operating_profit_source memory) rather than
  // a separate EBITDA definition for this one table.
  const locationMetricsQ = useLocationMetrics();

  // Site Comparison's "Per FTE" column — hours-weighted FTE clinician count
  // per site (client decision 2026-08-14: no contracted-FTE field exists
  // anywhere in this app, so this is actual clinician hours worked in the
  // header's selected period ÷ a standard 37.5h full-time week).
  const fteQ = useQuery({
    queryKey: [
      "insights_site_fte",
      organizationId,
      dateRange.startDate.toISOString(),
      dateRange.endDate.toISOString(),
    ],
    enabled: !!organizationId,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data: providerRows, error: provErr } = await (supabase as any)
        .from("providers")
        .select("external_id, location_id")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .not("external_id", "is", null)
        .or(CLINICIAN_ROLE_FILTER);
      if (provErr) throw provErr;

      const locationByExternalId = new Map<string, string | null>();
      const externalIds: number[] = [];
      for (const p of providerRows ?? []) {
        if (p.external_id == null) continue;
        const extId = Number(p.external_id);
        externalIds.push(extId);
        locationByExternalId.set(String(extId), p.location_id ?? null);
      }
      if (externalIds.length === 0) return new Map();

      const fromDate = toLocalYMD(dateRange.startDate);
      const toDate = toLocalYMD(dateRange.endDate);
      const { data: hoursRows, error: hoursErr } = await (supabase as any)
        .from("appointment_summary")
        .select("practitioner_id, working_duration_hours")
        .eq("organization_id", organizationId)
        .in("practitioner_id", externalIds)
        .gte("month", fromDate)
        .lte("month", toDate);
      if (hoursErr) throw hoursErr;

      const hoursByLocation = new Map<string, number>();
      for (const row of hoursRows ?? []) {
        const locId = locationByExternalId.get(String(row.practitioner_id));
        if (!locId) continue;
        hoursByLocation.set(locId, (hoursByLocation.get(locId) ?? 0) + (Number(row.working_duration_hours) || 0));
      }

      const days = Math.max(
        1,
        Math.round((dateRange.endDate.getTime() - dateRange.startDate.getTime()) / 86_400_000) + 1,
      );
      const standardHours = STANDARD_FULL_TIME_HOURS_PER_WEEK * (days / 7);
      if (standardHours <= 0) return new Map();

      const fteByLocation = new Map<string, number>();
      for (const [locId, hours] of hoursByLocation) {
        fteByLocation.set(locId, Math.round((hours / standardHours) * 100) / 100);
      }
      return fteByLocation;
    },
  });

  // Per-location monthly net-due history for the comparison table's 12m
  // sparklines — every uploaded month's member rows, grouped by location.
  // All upload sources (statement PDF or sheet), since monthly net_due sums
  // are real either way.
  const locTrendQ = useQuery({
    queryKey: ["insights_location_trends", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<
      Array<{ upload_month: number; upload_year: number; net_due: number | null; location_id: string | null }>
    > => {
      const PAGE = 1000;
      const rows: Array<{ upload_month: number; upload_year: number; net_due: number | null; location_id: string | null }> = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from("membership_upload_members")
          .select("upload_month, upload_year, net_due, location_id")
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      return rows;
    },
  });

  // Cumulative arrears exposure — failed collections summed across every
  // uploaded statement month (the month-scoped hook above only covers the
  // displayed month).
  const arrearsQ = useQuery({
    queryKey: ["insights_arrears_exposure", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<{ count: number; value: number }> => {
      const { data, error } = await (supabase as any)
        .from("membership_statement_summaries")
        .select("failed_collection_count, failed_collection_value")
        .eq("organization_id", organizationId)
        .is("deleted_at", null);
      if (error) throw error;
      let count = 0;
      let value = 0;
      for (const s of data ?? []) {
        count += s.failed_collection_count ?? 0;
        value += Number(s.failed_collection_value) || 0;
      }
      return { count, value: Math.round(value * 100) / 100 };
    },
  });

  const isLoading =
    statementQ.isLoading ||
    trendsQ.isLoading ||
    chairQ.isLoading ||
    worklists.isLoading ||
    churn.isLoading ||
    arrearsQ.isLoading ||
    locTrendQ.isLoading;
  const statement = statementQ.data;

  const totalRevenue = useMemo(
    () => (chairQ.data ?? []).reduce((s, r) => s + (r.revenue || 0), 0),
    [chairQ.data],
  );

  const netCash = statement?.totalCollectedValue ?? 0;
  const planSharePct = totalRevenue > 0 ? Math.round((netCash / totalRevenue) * 100) : null;

  const cashTrendData = useMemo(
    () =>
      trendsQ.trends.income
        .filter((p) => p.current != null)
        .map((p) => ({ label: p.month, value: p.current as number })),
    [trendsQ.trends.income],
  );

  // Net member movement for the shown month — joiners minus leavers, both
  // from the statement's own counts (the trend series' last point is the
  // anchor month). Null when neither figure is known for the month.
  const monthMovement = useMemo(() => {
    const joiners = trendsQ.trends.joiners;
    const leavers = trendsQ.trends.leavers;
    if (joiners.length === 0 && leavers.length === 0) return { net: null, joined: 0, left: 0 };
    const lastJ = joiners[joiners.length - 1]?.value ?? null;
    const lastL = leavers[leavers.length - 1]?.value ?? null;
    if (lastJ == null && lastL == null) return { net: null, joined: 0, left: 0 };
    return { net: (lastJ ?? 0) - (lastL ?? 0), joined: lastJ ?? 0, left: lastL ?? 0 };
  }, [trendsQ.trends.joiners, trendsQ.trends.leavers]);

  const clinicianBreakdown = useMemo(() => {
    const byDentist = new Map<string, { members: number; value: number }>();
    for (const m of uploadedMembers) {
      const name = m.treating_dentist?.trim() || "Unassigned";
      const cur = byDentist.get(name) ?? { members: 0, value: 0 };
      cur.members += 1;
      cur.value += m.net_due || 0;
      byDentist.set(name, cur);
    }
    return Array.from(byDentist.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.members - a.members)
      .slice(0, 4);
  }, [uploadedMembers]);

  const dataGapsCount = useMemo(
    () =>
      uploadedMembers.filter((m) => !m.dob || PLACEHOLDER_DOBS.has(String(m.dob).slice(0, 10)))
        .length,
    [uploadedMembers],
  );

  // Real Practice Plan admin fee — not printed as its own Summary-page
  // line, but recoverable: the statement's Plan Breakdown lists each plan's
  // list price, and each collected member's actual paid amount is already
  // stored (net_due). The gap between "price after this member's own
  // discount" and what they actually paid is the fee Practice Plan itself
  // deducted. Only positive gaps count — a member paying at or above their
  // expected price isn't a fee, and this must never go negative from a
  // pricing/timing edge case. Clamped 0..price so one bad row can't produce
  // a nonsense outlier fee.
  const { practicePlanFeeValue, practicePlanFeeMemberCount } = useMemo(() => {
    const planPrices = statement?.planPrices ?? [];
    if (planPrices.length === 0) return { practicePlanFeeValue: 0, practicePlanFeeMemberCount: 0 };
    // Annual-only plans (Plan Breakdown shows monthly 0, annual > 0, e.g. a
    // Registration plan): their list price is an annual figure, so the
    // gap-vs-price comparison is meaningless — exclude the whole plan. This
    // also covers rows imported before the parser captured the per-member
    // Freq column into annual_payer.
    const priceByDescription = new Map(
      planPrices
        .filter((p) => !(p.monthly === 0 && p.annual > 0))
        .map((p) => [p.description.toLowerCase(), p.price]),
    );
    let total = 0;
    let count = 0;
    for (const m of uploadedMembers) {
      // Annual payers' net_due for the period they were actually collected
      // isn't the same figure as the plan's monthly list price — exclude to
      // avoid a spurious outlier. TEXT column: any value except an explicit
      // negative marks the member as annual.
      const annualFlag = (m.annual_payer ?? "").trim().toLowerCase();
      if (annualFlag && !["n", "no", "false", "0"].includes(annualFlag)) continue;
      const price = priceByDescription.get((m.fee_category ?? "").trim().toLowerCase());
      if (price == null) continue;
      const discountPct = Math.min(100, Math.max(0, m.discount_percent || 0));
      const expected = price * (1 - discountPct / 100);
      const gap = expected - (m.net_due || 0);
      count += 1;
      if (gap > 0.001) total += Math.min(gap, price);
    }
    return {
      practicePlanFeeValue: Math.round(total * 100) / 100,
      practicePlanFeeMemberCount: count,
    };
  }, [uploadedMembers, statement?.planPrices]);

  // Shared month axis for the sparklines: the last up-to-12 uploaded month
  // keys, oldest first. A location with no rows in an uploaded month is a
  // genuine £0 for that month.
  const locationTrends = useMemo(() => {
    const rows = locTrendQ.data ?? [];
    const monthKeys = Array.from(new Set(rows.map((r) => r.upload_year * 100 + r.upload_month)))
      .sort((a, b) => a - b)
      .slice(-12);
    const keyIndex = new Map(monthKeys.map((k, i) => [k, i]));
    const byLoc = new Map<string, number[]>();
    const group: number[] = monthKeys.map(() => 0);
    // One row per member per uploaded month, so a row count per month IS
    // that month's active-member count — no separate identity/dedup query.
    const groupMemberCount: number[] = monthKeys.map(() => 0);
    for (const r of rows) {
      const idx = keyIndex.get(r.upload_year * 100 + r.upload_month);
      if (idx == null) continue;
      const locKey = r.location_id ?? "";
      let arr = byLoc.get(locKey);
      if (!arr) {
        arr = monthKeys.map(() => 0);
        byLoc.set(locKey, arr);
      }
      const v = Number(r.net_due) || 0;
      arr[idx] += v;
      group[idx] += v;
      groupMemberCount[idx] += 1;
    }
    const monthLabels = monthKeys.map((k) => MONTH_NAMES[(k % 100) - 1].slice(0, 3));
    return { byLoc, group, groupMemberCount, monthLabels };
  }, [locTrendQ.data]);

  const revenueByLocation = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of chairQ.data ?? []) {
      map.set(r.location_id, (map.get(r.location_id) ?? 0) + (r.revenue || 0));
    }
    return map;
  }, [chairQ.data]);

  const locationComparison = useMemo<OverviewLocationRow[]>(
    () =>
      membersByLocation.map((g) => {
        const locRevenue = g.locationId ? revenueByLocation.get(g.locationId) : undefined;
        const locMetrics = g.locationId ? locationMetricsQ.data?.get(g.locationId) : undefined;
        const fte = g.locationId ? fteQ.data?.get(g.locationId) ?? null : null;
        return {
          locationId: g.locationId,
          name: g.locationName,
          members: g.members.length,
          net: g.totalNetDue,
          churnPct: g.locationId ? (churn.byLocation.get(g.locationId)?.churnPct ?? null) : null,
          planSharePct:
            locRevenue && locRevenue > 0 ? Math.round((g.totalNetDue / locRevenue) * 100) : null,
          trend: locationTrends.byLoc.get(g.locationId ?? "") ?? [],
          ebitda: locMetrics?.netProfit ?? null,
          ebitdaPct: locMetrics?.ebitdaPercent ?? null,
          fte,
          membersPerFte: fte && fte > 0 ? Math.round((g.members.length / fte) * 10) / 10 : null,
        };
      }),
    [membersByLocation, churn.byLocation, revenueByLocation, locationTrends.byLoc, locationMetricsQ.data, fteQ.data],
  );

  // A wide header range (e.g. "This Year") spans several statement months —
  // label the span rather than naming only displayMonth (its last month),
  // which read as "the statement for December" when the figures below are
  // actually summed across the whole selected range.
  const monthLabel = useMemo(() => {
    if (effectivePairs.length <= 1) return `${MONTH_NAMES[displayMonth.month - 1]} ${displayMonth.year}`;
    const first = effectivePairs[0];
    const last = effectivePairs[effectivePairs.length - 1];
    const firstLabel = `${MONTH_NAMES[first.month - 1]}${first.year !== last.year ? ` ${first.year}` : ""}`;
    const lastLabel = `${MONTH_NAMES[last.month - 1]} ${last.year}`;
    return `${firstLabel} – ${lastLabel}`;
  }, [effectivePairs, displayMonth]);

  return {
    isLoading,
    hasUploadData: uploadTotalMembers > 0,
    hasStatementData: !!statement?.hasStatements,
    monthLabel,
    isMultiMonth: effectivePairs.length > 1,
    netCash,
    activeMembers: uploadTotalMembers,
    failedValue: statement?.failedValue ?? 0,
    failedCount: statement?.failedCount ?? 0,
    cancelledCount: statement?.cancelledCount ?? 0,
    noVisitCount: worklists.counts.sleeping,
    archivedCount: worklists.archivedCount,
    monthNetMembers: monthMovement.net,
    monthJoined: monthMovement.joined,
    monthLeft: monthMovement.left,
    arrearsCount: arrearsQ.data?.count ?? 0,
    arrearsValue: arrearsQ.data?.value ?? 0,
    grossValue: statement?.grossValue ?? 0,
    planSharePct,
    totalRevenue,
    cashTrendData,
    memberTrendData: locationTrends.monthLabels.map((label, i) => ({
      label,
      value: locationTrends.groupMemberCount[i] ?? 0,
    })),
    clinicianBreakdown,
    dataGapsCount,
    // Always shown when there's upload data — a single-location org still
    // gets its row plus the Group total (the user asked for this table to
    // be a fixed fixture of the page, not multi-location-only).
    showLocationComparison: locationComparison.length > 0,
    locationComparison,
    groupTrend: locationTrends.group,
    practicePlanFeeValue,
    practicePlanFeeMemberCount,
    churnTrackingSince: churn.trackingSince,
    churnJoined: churn.joined,
    churnLeft: churn.left,
    churnPct: churn.churnPct,
  };
}
