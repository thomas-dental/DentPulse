import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { ukDayStartInstant } from '@/utils/dateRangeUtils';

/**
 * Statement-health data for a membership month: the Practice Plan statement's
 * own Summary totals (what actually collected vs what failed) plus the Failed
 * Collections / Cancelled Patients rows persisted at upload time.
 *
 * Failed-collection rows are cross-referenced against recent Dentally
 * appointment activity: a patient whose payment failed but who is still
 * attending is an arrears leak the practice can act on.
 */

export interface StatementEventInsight {
  id: string;
  eventType: 'failed_collection' | 'cancelled_patient';
  ppPatientId: string | null;
  displayName: string;
  feeCategory: string | null;
  amount: number | null;
  eventDate: string | null; // YYYY-MM-DD
  /** The statement's own treating dentist — Practice Plan statements are
   *  per-dentist documents, so every event on a statement shares one. */
  dentist: string | null;
  /** Non-cancelled Dentally appointments in the last 60 days (failed collections only). */
  recentAppointments: number;
  /** patients.pt_unique_id — Dentally patient UUID for the row's deep-link
   *  to https://app.dentally.co/patients/<uuid>/appointments. Null when the
   *  event's pp_patient_id couldn't be resolved to a matched patient. */
  patientUuid: string | null;
}

export interface StatementPlanPrice {
  code: string;
  description: string;
  price: number;
  /** Member counts from the Plan Breakdown table — a plan with monthly = 0
   *  and annual > 0 is collected annually, so its members' paid amounts
   *  can't be compared to the (monthly) list price. */
  monthly: number;
  annual: number;
}

export interface StatementInsights {
  hasStatements: boolean;
  statementCount: number;
  dentists: string[];
  totalCollectedValue: number;
  failedCount: number;
  failedValue: number;
  cancelledCount: number;
  /** Collected + failed — what the month was worth before DD failures. */
  grossValue: number;
  failedEvents: StatementEventInsight[];
  cancelledEvents: StatementEventInsight[];
  /** Each plan's listed price from the statement's own Plan Breakdown table
   *  — used to derive the real Practice Plan admin-fee (the gap between
   *  this list price and what a member actually paid; see
   *  computePracticePlanFee in useOverviewData.ts). Not itself a fee. */
  planPrices: StatementPlanPrice[];
}

const EMPTY: StatementInsights = {
  hasStatements: false,
  statementCount: 0,
  dentists: [],
  totalCollectedValue: 0,
  failedCount: 0,
  failedValue: 0,
  cancelledCount: 0,
  grossValue: 0,
  failedEvents: [],
  cancelledEvents: [],
  planPrices: [],
};

const INACTIVE_APPOINTMENT_STATES = new Set(['cancelled', 'did not attend', 'dna']);

export type StatementMonthPair = { month: number; year: number };

/**
 * @param pairs Every (month, year) whose statement(s) should be summed into
 *   one result — normally the header's full selected range (so a "This Year"
 *   filter sums every uploaded statement in range instead of looking at a
 *   single arbitrary month, which previously left tiles showing "no
 *   statement uploaded" for wide ranges even when most months in range had
 *   real data). Pass a single-element array for a dedicated one-month view.
 */
export function useMembershipStatementInsights(pairs: StatementMonthPair[]) {
  const { organizationId } = useOrganization();
  const validPairs = pairs.filter(p => p.month >= 1 && p.month <= 12);
  const pairsKey = validPairs.map(p => `${p.year}-${p.month}`).sort().join(',');

  return useQuery<StatementInsights>({
    queryKey: ['membership_statement_insights', organizationId, pairsKey],
    enabled: !!organizationId && validPairs.length > 0,
    queryFn: async () => {
      const orFilter = validPairs
        .map(p => `and(statement_month.eq.${p.month},statement_year.eq.${p.year})`)
        .join(',');
      // Every lookup THROWS on error — a swallowed failure here would let
      // React Query cache an empty result as fresh (the "hard refresh to get
      // data" class of bug).
      const { data: statements, error: stmtErr } = await (supabase as any)
        .from('membership_statement_summaries')
        .select('id, treating_dentist, total_collected_value, new_patient_value, existing_patient_value, failed_collection_count, failed_collection_value, cancelled_patient_count, plan_breakdown')
        .eq('organization_id', organizationId)
        .or(orFilter)
        .is('deleted_at', null);
      if (stmtErr) throw stmtErr;
      if (!statements || statements.length === 0) return EMPTY;

      const statementIds = statements.map((s: any) => s.id);
      const dentistByStatementId = new Map<string, string | null>(
        statements.map((s: any) => [s.id, s.treating_dentist ?? null]),
      );
      const { data: events, error: evErr } = await (supabase as any)
        .from('membership_statement_events')
        .select('id, statement_id, event_type, pp_patient_id, surname, title, initial, dob, fee_category, plan_code, amount, event_date')
        .eq('organization_id', organizationId)
        .in('statement_id', statementIds);
      if (evErr) throw evErr;

      // ── Resolve pp_patient_id → real Dentally patient (both event types) ──
      // pp_patient_id joins membership_upload_members.pay_grp_id (same month's
      // member rows carry the matched Dentally patient id), then patients →
      // appointments / uuid. Mirrors the page's own matching, org-wide.
      const failedPpIds = (events ?? [])
        .filter((e: any) => e.event_type === 'failed_collection' && e.pp_patient_id)
        .map((e: any) => String(e.pp_patient_id));
      const allPpIds = Array.from(new Set((events ?? [])
        .filter((e: any) => e.pp_patient_id)
        .map((e: any) => String(e.pp_patient_id))));
      const recentByPpId = new Map<string, number>();
      const uuidByPpId = new Map<string, string>();

      if (allPpIds.length > 0) {
        const { data: memberRows, error: memErr } = await (supabase as any)
          .from('membership_upload_members')
          .select('pay_grp_id, patient_id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .in('pay_grp_id', allPpIds)
          .not('patient_id', 'is', null);
        if (memErr) throw memErr;

        const patientKeys = Array.from(new Set(
          (memberRows ?? []).map((m: any) => String(m.patient_id).trim()).filter(Boolean),
        ));
        if (patientKeys.length > 0) {
          // patient_id may hold pt_id or pt_legacy_id — check both, and always
          // String() ids (bigint JSON numbers vs TEXT columns).
          const { data: patientRows, error: ptErr } = await (supabase as any)
            .from('patients')
            .select('pt_id, pt_legacy_id, pt_unique_id')
            .eq('organization_id', organizationId)
            .or(`pt_id.in.(${patientKeys.join(',')}),pt_legacy_id.in.(${patientKeys.join(',')})`);
          if (ptErr) throw ptErr;

          const keyToPtId = new Map<string, string>();
          const uuidByPtId = new Map<string, string>();
          for (const p of patientRows ?? []) {
            if (p.pt_id != null) keyToPtId.set(String(p.pt_id), String(p.pt_id));
            if (p.pt_legacy_id != null && p.pt_id != null) keyToPtId.set(String(p.pt_legacy_id).trim(), String(p.pt_id));
            if (p.pt_id != null && p.pt_unique_id) uuidByPtId.set(String(p.pt_id), String(p.pt_unique_id));
          }
          const ppToPtId = new Map<string, string>();
          for (const m of memberRows ?? []) {
            const ptId = keyToPtId.get(String(m.patient_id).trim());
            if (ptId && m.pay_grp_id != null) ppToPtId.set(String(m.pay_grp_id).trim(), ptId);
          }
          for (const [ppId, ptId] of ppToPtId) {
            const uuid = uuidByPtId.get(ptId);
            if (uuid) uuidByPpId.set(ppId, uuid);
          }

          // Recent-appointment lookback stays scoped to failed collections
          // only (recentAppointments' documented meaning) — cancelled events
          // just needed the uuid resolved above for their deep-link.
          const failedPtIds = Array.from(new Set(
            failedPpIds.map((ppId) => ppToPtId.get(ppId)).filter((v): v is string => !!v),
          ));
          if (failedPtIds.length > 0) {
            const sixtyDaysAgo = new Date();
            sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
            const { data: appts, error: apErr } = await (supabase as any)
              .from('appointments')
              .select('apmt_patient_id, apmt_state')
              .eq('organization_id', organizationId)
              .in('apmt_patient_id', failedPtIds)
              .gte('apmt_start_time', ukDayStartInstant(sixtyDaysAgo))
              .lte('apmt_start_time', new Date().toISOString());
            if (apErr) throw apErr;

            const countByPtId = new Map<string, number>();
            for (const a of appts ?? []) {
              const state = String(a.apmt_state ?? '').toLowerCase();
              if (INACTIVE_APPOINTMENT_STATES.has(state)) continue;
              const key = String(a.apmt_patient_id);
              countByPtId.set(key, (countByPtId.get(key) ?? 0) + 1);
            }
            for (const ppId of failedPpIds) {
              const ptId = ppToPtId.get(ppId);
              if (ptId) recentByPpId.set(ppId, countByPtId.get(ptId) ?? 0);
            }
          }
        }
      }

      // ── Shape the result ─────────────────────────────────────────────────
      const toInsight = (e: any): StatementEventInsight => ({
        id: e.id,
        eventType: e.event_type,
        ppPatientId: e.pp_patient_id != null ? String(e.pp_patient_id) : null,
        displayName: [e.title, e.initial, e.surname].filter(Boolean).join(' ').trim() || 'Unknown patient',
        feeCategory: e.fee_category ?? e.plan_code ?? null,
        amount: e.amount != null ? Number(e.amount) : null,
        eventDate: e.event_date ?? null,
        dentist: dentistByStatementId.get(e.statement_id) ?? null,
        recentAppointments: e.pp_patient_id != null
          ? (recentByPpId.get(String(e.pp_patient_id)) ?? 0)
          : 0,
        patientUuid: e.pp_patient_id != null
          ? (uuidByPpId.get(String(e.pp_patient_id)) ?? null)
          : null,
      });

      const failedEvents = (events ?? []).filter((e: any) => e.event_type === 'failed_collection').map(toInsight);
      const cancelledEvents = (events ?? []).filter((e: any) => e.event_type === 'cancelled_patient').map(toInsight);

      const sum = (vals: Array<number | null | undefined>) =>
        Math.round(vals.reduce((s: number, v) => s + (Number(v) || 0), 0) * 100) / 100;
      const totalCollectedValue = sum(statements.map((s: any) =>
        s.total_collected_value ?? (Number(s.new_patient_value ?? 0) + Number(s.existing_patient_value ?? 0)),
      ));
      const failedValue = sum(statements.map((s: any) => s.failed_collection_value));
      const failedCount = statements.reduce((s: number, r: any) => s + (r.failed_collection_count ?? 0), 0);
      const cancelledCount = statements.reduce((s: number, r: any) => s + (r.cancelled_patient_count ?? 0), 0);

      // Plan list-price table (practice-wide, so the same across dentists —
      // take the first sighting of each description).
      const planPricesByDescription = new Map<string, StatementPlanPrice>();
      for (const s of statements) {
        const rows = Array.isArray(s.plan_breakdown) ? s.plan_breakdown : [];
        for (const row of rows) {
          const description = String(row?.description ?? '').trim();
          if (!description || planPricesByDescription.has(description.toLowerCase())) continue;
          planPricesByDescription.set(description.toLowerCase(), {
            code: String(row?.code ?? ''),
            description,
            price: Number(row?.price) || 0,
            monthly: Number(row?.monthly) || 0,
            annual: Number(row?.annual) || 0,
          });
        }
      }
      const planPrices = Array.from(planPricesByDescription.values());

      return {
        hasStatements: true,
        statementCount: statements.length,
        dentists: Array.from(new Set(statements.map((s: any) => s.treating_dentist).filter(Boolean))) as string[],
        totalCollectedValue,
        failedCount,
        failedValue,
        cancelledCount,
        grossValue: Math.round((totalCollectedValue + failedValue) * 100) / 100,
        planPrices,
        failedEvents,
        cancelledEvents,
      };
    },
  });
}
