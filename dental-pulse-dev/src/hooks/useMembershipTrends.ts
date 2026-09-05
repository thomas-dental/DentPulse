import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { MONTH_NAMES, PRACTICE_PLAN_MARKER } from '@/hooks/useMembershipUploadData';

/**
 * Trend series for the Membership page's Supportal-style charts, computed
 * from uploaded membership data:
 *
 * - Income: monthly sum of member net_due, this year vs the same month a
 *   year earlier (optionally filtered by treating dentist).
 * - Joiners / Leavers: per month, preferring the Practice Plan statement's
 *   own numbers (new_patient_count / cancelled_patient_count persisted in
 *   membership_statement_summaries); months without a statement fall back
 *   to a member-set diff against the previous uploaded month. Months with
 *   neither stay null (chart gap) — never fabricated zeros.
 * - Cancellations by plan for the anchor month, from
 *   membership_statement_events (statement PDFs carry no cancellation
 *   REASON, so the breakdown is by plan).
 *
 * One fetch per (org, anchor); the dentist filter is applied client-side.
 *
 * PRACTICE PLAN ONLY: every member-row query filters on the
 * 'Practice Plan statement' marker, so Denplan sheet uploads never feed
 * these charts — for a sheet-only org the whole section stays hidden.
 */

export interface TrendIncomePoint {
  month: string; // short label e.g. "Sep"
  fullLabel: string; // e.g. "Sep 2025"
  current: number | null;
  lastYear: number | null;
}

export interface TrendCountPoint {
  month: string;
  fullLabel: string;
  value: number | null;
}

export interface MembershipTrends {
  hasData: boolean;
  dentists: string[];
  income: TrendIncomePoint[];
  joiners: TrendCountPoint[];
  leavers: TrendCountPoint[];
  joinersTotal: number;
  leaversTotal: number;
  cancellations: {
    total: number;
    monthLabel: string;
    byPlan: Array<{ name: string; value: number }>;
  };
}

interface TrendsSource {
  members: Array<{
    upload_month: number;
    upload_year: number;
    net_due: number | null;
    treating_dentist: string | null;
    pay_grp_id: string | null;
    patient_id: string | null;
    surname: string | null;
    dob: string | null;
  }>;
  summaries: Array<{
    statement_month: number;
    statement_year: number;
    treating_dentist: string | null;
    new_patient_count: number | null;
    cancelled_patient_count: number | null;
  }>;
  /** Cancellation events for the anchor month, with the statement's dentist attached. */
  cancelEvents: Array<{ pp_patient_id: string | null; fee_category: string | null; plan_code: string | null; dentist: string | null }>;
}

const monthKey = (year: number, month: number) => year * 100 + month;

function memberIdentity(m: TrendsSource['members'][number]): string | null {
  const pg = m.pay_grp_id?.trim();
  if (pg) return `pg:${pg}`;
  const pid = m.patient_id?.trim();
  if (pid) return `pt:${pid}`;
  const surname = m.surname?.trim().toLowerCase();
  if (surname) return `nm:${surname}|${m.dob ?? ''}`;
  return null;
}

export function useMembershipTrends(anchorMonth: number, anchorYear: number, dentist: string | null) {
  const { organizationId } = useOrganization();

  // A wide header range (e.g. "This Year") can pass an anchor that's still
  // in the future — the trailing-12-month window would then walk into
  // months that can't have "this year" data yet (while "last year"'s same
  // months, already past, show real figures), rendering as empty/missing
  // current-year bars next to populated prior-year ones. Clamp to the real
  // current month so the window only ever looks backward from "now",
  // exactly like a past-month anchor already does today.
  const now = new Date();
  const isFutureAnchor =
    anchorYear > now.getFullYear() || (anchorYear === now.getFullYear() && anchorMonth > now.getMonth() + 1);
  const effectiveAnchorMonth = isFutureAnchor ? now.getMonth() + 1 : anchorMonth;
  const effectiveAnchorYear = isFutureAnchor ? now.getFullYear() : anchorYear;

  const { data: src, isLoading } = useQuery<TrendsSource>({
    queryKey: ['membership_trends_src', organizationId, effectiveAnchorYear, effectiveAnchorMonth],
    enabled: !!organizationId && effectiveAnchorMonth >= 1 && effectiveAnchorMonth <= 12,
    queryFn: async () => {
      // Every lookup THROWS on error — a swallowed failure would let React
      // Query cache an empty result as fresh.

      // Member rows for the window + the year before it (for the YoY series
      // and the first window month's diff baseline). Paged: PostgREST caps
      // responses at 1000 rows.
      const PAGE = 1000;
      const members: TrendsSource['members'] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from('membership_upload_members')
          .select('upload_month, upload_year, net_due, treating_dentist, pay_grp_id, patient_id, surname, dob')
          .eq('organization_id', organizationId)
          .eq('explanatory_text', PRACTICE_PLAN_MARKER)
          .is('deleted_at', null)
          .gte('upload_year', effectiveAnchorYear - 2)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        members.push(...data);
        if (data.length < PAGE) break;
      }

      const { data: summaries, error: sumErr } = await (supabase as any)
        .from('membership_statement_summaries')
        .select('id, statement_month, statement_year, treating_dentist, new_patient_count, cancelled_patient_count')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .gte('statement_year', effectiveAnchorYear - 2);
      if (sumErr) throw sumErr;

      // Cancellation events for the anchor month's statements.
      const anchorSummaryIds = (summaries ?? [])
        .filter((s: any) => s.statement_year === effectiveAnchorYear && s.statement_month === effectiveAnchorMonth)
        .map((s: any) => s.id);
      let cancelEvents: TrendsSource['cancelEvents'] = [];
      if (anchorSummaryIds.length > 0) {
        const dentistByStatement = new Map<string, string | null>(
          (summaries ?? [])
            .filter((s: any) => anchorSummaryIds.includes(s.id))
            .map((s: any) => [s.id, s.treating_dentist ?? null]),
        );
        const { data: events, error: evErr } = await (supabase as any)
          .from('membership_statement_events')
          .select('statement_id, event_type, pp_patient_id, fee_category, plan_code')
          .eq('organization_id', organizationId)
          .in('statement_id', anchorSummaryIds)
          .eq('event_type', 'cancelled_patient');
        if (evErr) throw evErr;
        cancelEvents = (events ?? []).map((e: any) => ({
          pp_patient_id: e.pp_patient_id != null ? String(e.pp_patient_id) : null,
          fee_category: e.fee_category ?? null,
          plan_code: e.plan_code ?? null,
          dentist: dentistByStatement.get(e.statement_id) ?? null,
        }));

        // A cancelled row whose statement line carried no recognisable plan
        // code usually belongs to a patient who appears in an earlier month's
        // member rows — recover the plan from their most recent row.
        const unresolvedPpIds = Array.from(new Set(
          cancelEvents
            .filter(e => !e.fee_category && !e.plan_code && e.pp_patient_id)
            .map(e => e.pp_patient_id as string),
        ));
        if (unresolvedPpIds.length > 0) {
          const { data: planRows, error: prErr } = await (supabase as any)
            .from('membership_upload_members')
            .select('pay_grp_id, fee_category, upload_year, upload_month')
            .eq('organization_id', organizationId)
            .eq('explanatory_text', PRACTICE_PLAN_MARKER)
            .is('deleted_at', null)
            .in('pay_grp_id', unresolvedPpIds)
            .not('fee_category', 'is', null)
            .order('upload_year', { ascending: false })
            .order('upload_month', { ascending: false });
          if (prErr) throw prErr;
          const planByPpId = new Map<string, string>();
          for (const r of planRows ?? []) {
            const key = String(r.pay_grp_id).trim();
            if (!planByPpId.has(key)) planByPpId.set(key, r.fee_category);
          }
          for (const e of cancelEvents) {
            if (!e.fee_category && !e.plan_code && e.pp_patient_id) {
              e.fee_category = planByPpId.get(e.pp_patient_id) ?? null;
            }
          }
        }
      }

      return { members, summaries: summaries ?? [], cancelEvents };
    },
  });

  const trends = useMemo<MembershipTrends>(() => {
    const empty: MembershipTrends = {
      hasData: false,
      dentists: [],
      income: [],
      joiners: [],
      leavers: [],
      joinersTotal: 0,
      leaversTotal: 0,
      cancellations: { total: 0, monthLabel: '', byPlan: [] },
    };
    if (!src || src.members.length === 0) return empty;

    const dentists = Array.from(new Set(
      [...src.members.map(m => m.treating_dentist), ...src.summaries.map(s => s.treating_dentist)]
        .filter((d): d is string => !!d && d.trim() !== ''),
    )).sort((a, b) => a.localeCompare(b));

    const matchesDentist = (d: string | null) => !dentist || d === dentist;
    const members = src.members.filter(m => matchesDentist(m.treating_dentist));
    const summaries = src.summaries.filter(s => matchesDentist(s.treating_dentist));

    // ── Group member rows per month ──────────────────────────────────────
    const revenueByMonth = new Map<number, number>();
    const identsByMonth = new Map<number, Set<string>>();
    for (const m of members) {
      const key = monthKey(m.upload_year, m.upload_month);
      revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + (Number(m.net_due) || 0));
      const ident = memberIdentity(m);
      if (ident) {
        const set = identsByMonth.get(key) ?? new Set<string>();
        set.add(ident);
        identsByMonth.set(key, set);
      }
    }

    const statementCounts = new Map<number, { joiners: number; leavers: number }>();
    for (const s of summaries) {
      const key = monthKey(s.statement_year, s.statement_month);
      const cur = statementCounts.get(key) ?? { joiners: 0, leavers: 0 };
      cur.joiners += s.new_patient_count ?? 0;
      cur.leavers += s.cancelled_patient_count ?? 0;
      statementCounts.set(key, cur);
    }

    // ── 12-month window ending at the (clamped) anchor ────────────────────
    const window: Array<{ year: number; month: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(effectiveAnchorYear, effectiveAnchorMonth - 1 - i, 1);
      window.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    const income: TrendIncomePoint[] = window.map(({ year, month }) => {
      const cur = revenueByMonth.get(monthKey(year, month));
      const prev = revenueByMonth.get(monthKey(year - 1, month));
      return {
        month: MONTH_NAMES[month - 1].slice(0, 3),
        fullLabel: `${MONTH_NAMES[month - 1]} ${year}`,
        current: cur != null ? Math.round(cur * 100) / 100 : null,
        lastYear: prev != null ? Math.round(prev * 100) / 100 : null,
      };
    });

    const countPoint = (year: number, month: number, kind: 'joiners' | 'leavers'): number | null => {
      const key = monthKey(year, month);
      const stmt = statementCounts.get(key);
      if (stmt) return stmt[kind];
      // Fallback: set diff vs the previous uploaded month.
      const prevDate = new Date(year, month - 2, 1);
      const prevKey = monthKey(prevDate.getFullYear(), prevDate.getMonth() + 1);
      const curSet = identsByMonth.get(key);
      const prevSet = identsByMonth.get(prevKey);
      if (!curSet || !prevSet) return null;
      let n = 0;
      if (kind === 'joiners') {
        for (const id of curSet) if (!prevSet.has(id)) n++;
      } else {
        for (const id of prevSet) if (!curSet.has(id)) n++;
      }
      return n;
    };

    const joiners: TrendCountPoint[] = window.map(({ year, month }) => ({
      month: MONTH_NAMES[month - 1].slice(0, 3),
      fullLabel: `${MONTH_NAMES[month - 1]} ${year}`,
      value: countPoint(year, month, 'joiners'),
    }));
    const leavers: TrendCountPoint[] = window.map(({ year, month }) => ({
      month: MONTH_NAMES[month - 1].slice(0, 3),
      fullLabel: `${MONTH_NAMES[month - 1]} ${year}`,
      value: countPoint(year, month, 'leavers'),
    }));

    // ── Cancellations by plan (anchor month) ─────────────────────────────
    const cancelFiltered = src.cancelEvents.filter(e => matchesDentist(e.dentist));
    const byPlanMap = new Map<string, number>();
    for (const e of cancelFiltered) {
      const name = e.fee_category || e.plan_code || 'Unknown plan';
      byPlanMap.set(name, (byPlanMap.get(name) ?? 0) + 1);
    }
    const byPlan = Array.from(byPlanMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      hasData: true,
      dentists,
      income,
      joiners,
      leavers,
      joinersTotal: joiners.reduce((s, p) => s + (p.value ?? 0), 0),
      leaversTotal: leavers.reduce((s, p) => s + (p.value ?? 0), 0),
      cancellations: {
        total: cancelFiltered.length,
        monthLabel: `${MONTH_NAMES[effectiveAnchorMonth - 1]} ${effectiveAnchorYear}`,
        byPlan,
      },
    };
  }, [src, dentist, effectiveAnchorMonth, effectiveAnchorYear]);

  return { trends, isLoading };
}
