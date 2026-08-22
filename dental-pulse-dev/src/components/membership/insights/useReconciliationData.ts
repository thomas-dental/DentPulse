import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useMembershipUploadData, MONTH_NAMES } from "@/hooks/useMembershipUploadData";

export interface ReconciliationMethodAmount {
  method: string;
  amount: number;
}

export interface ReconciliationMonthRow {
  month: number;
  year: number;
  monthLabel: string;
  /** Practice Plan statement's own Total Collected for this month (summed
   *  across every dentist's statement that month). */
  statementCollected: number;
  /** Real Dentally payments recorded against this month's plan members,
   *  dated within the month — every payment method, not just one guessed
   *  as "the DD one" (see dentallyByMethod). */
  dentallyTotal: number;
  /** Broken out by dentally_payments.dp_method — Dentally's own method
   *  labels are practice-configured (not a fixed enum), so this is shown
   *  rather than the app guessing which label means "Direct Debit" for
   *  this practice's setup. Sorted largest first. */
  dentallyByMethod: ReconciliationMethodAmount[];
  /** statementCollected − dentallyTotal. Positive = statement shows more
   *  collected than Dentally has recorded for these patients that month. */
  variance: number;
  variancePct: number | null;
  /** Distinct plan-member patients with at least one Dentally payment this
   *  month — a low count relative to the statement's member count is its
   *  own signal (payments not being posted to Dentally at all, not just a
   *  method-labelling mismatch). */
  matchedPatients: number;
}

export interface ReconciliationData {
  isLoading: boolean;
  hasData: boolean;
  rows: ReconciliationMonthRow[];
}

/**
 * Monthly cross-check between the Practice Plan statement's own "Total
 * Collected" figure and what Dentally has actually recorded as payments for
 * those same plan members that month — the Dentally leg of the client's
 * 3-way reconciliation ask (requirement "Net cash reality vs gross plan
 * value": "Reconciling that remittance to Xero and to what's posted in
 * Dentally is a manual monthly job, and I'm never fully confident the three
 * agree."). The Xero leg (matching to an actual bank deposit in
 * xero_bank_transactions) is a separate, not-yet-built check.
 *
 * Dentally's dp_method values are practice-configured free text, not a
 * fixed enum (confirmed via the dentally_payments migration's own comment:
 * "Debit Card, Credit Card, Cash, Cheque, BACS, etc." — no guarantee
 * "Direct Debit" is the literal label this practice's Dentally uses) — so
 * every payment against a plan member in the month is summed and broken out
 * by its own method label, rather than the app silently filtering to a
 * hardcoded string that might not match and would then show a false gap.
 */
export function useReconciliationData(): ReconciliationData {
  const { organizationId } = useOrganization();
  const { members: uploadedMembers, effectivePairs } = useMembershipUploadData();

  const pairsKey = effectivePairs.map((p) => `${p.year}-${p.month}`).sort().join(",");
  const memberKeysKey = Array.from(new Set(uploadedMembers.map((m) => m.patient_id).filter(Boolean)))
    .sort()
    .join(",");

  const statementQ = useQuery({
    queryKey: ["insights_reconciliation_statements", organizationId, pairsKey],
    enabled: !!organizationId && effectivePairs.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const orFilter = effectivePairs
        .map((p) => `and(statement_month.eq.${p.month},statement_year.eq.${p.year})`)
        .join(",");
      const { data, error } = await (supabase as any)
        .from("membership_statement_summaries")
        .select("statement_month, statement_year, total_collected_value, new_patient_value, existing_patient_value")
        .eq("organization_id", organizationId)
        .or(orFilter)
        .is("deleted_at", null);
      if (error) throw error;
      const byMonth = new Map<string, number>();
      for (const s of (data ?? []) as Array<{
        statement_month: number;
        statement_year: number;
        total_collected_value: number | null;
        new_patient_value: number | null;
        existing_patient_value: number | null;
      }>) {
        const key = `${s.statement_year}-${s.statement_month}`;
        const value =
          s.total_collected_value ?? Number(s.new_patient_value ?? 0) + Number(s.existing_patient_value ?? 0);
        byMonth.set(key, (byMonth.get(key) ?? 0) + (Number(value) || 0));
      }
      return byMonth;
    },
  });

  const dentallyQ = useQuery({
    queryKey: ["insights_reconciliation_dentally", organizationId, memberKeysKey, pairsKey],
    enabled: !!organizationId && effectivePairs.length > 0 && uploadedMembers.length > 0,
    queryFn: async (): Promise<{
      byMonth: Map<string, number>;
      byMonthMethod: Map<string, Map<string, number>>;
      matchedPatientsByMonth: Map<string, Set<string>>;
    }> => {
      const empty = { byMonth: new Map<string, number>(), byMonthMethod: new Map<string, Map<string, number>>(), matchedPatientsByMonth: new Map<string, Set<string>>() };
      const legacyKeys = Array.from(
        new Set(uploadedMembers.map((m) => m.patient_id).filter((x): x is string => !!x).map((k) => String(k).trim())),
      );
      if (legacyKeys.length === 0) return empty;

      const { data: patientRows, error: ptErr } = await (supabase as any)
        .from("patients")
        .select("pt_id, pt_legacy_id")
        .eq("organization_id", organizationId)
        .or(`pt_id.in.(${legacyKeys.join(",")}),pt_legacy_id.in.(${legacyKeys.join(",")})`);
      if (ptErr) throw ptErr;
      const ptIds = new Set<string>();
      for (const p of (patientRows ?? []) as Array<{ pt_id: number | string | null }>) {
        if (p.pt_id != null) ptIds.add(String(p.pt_id));
      }
      if (ptIds.size === 0) return empty;

      const sortedPairs = [...effectivePairs].sort((a, b) => a.year - b.year || a.month - b.month);
      const first = sortedPairs[0];
      const last = sortedPairs[sortedPairs.length - 1];
      const fromDate = `${first.year}-${String(first.month).padStart(2, "0")}-01`;
      const lastDay = new Date(last.year, last.month, 0).getDate();
      const toDate = `${last.year}-${String(last.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const byMonth = new Map<string, number>();
      const byMonthMethod = new Map<string, Map<string, number>>();
      const matchedPatientsByMonth = new Map<string, Set<string>>();
      const ptIdList = Array.from(ptIds);
      const PAGE_SIZE = 1000;
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from("dentally_payments")
          .select("dp_patient_id, dp_amount, dp_dated_on, dp_method")
          .eq("organization_id", organizationId)
          .in("dp_patient_id", ptIdList)
          .eq("dp_deleted", false)
          .is("deleted_at", null)
          .gte("dp_dated_on", fromDate)
          .lte("dp_dated_on", toDate)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        for (const row of (data ?? []) as Array<{
          dp_patient_id: number | string | null;
          dp_amount: number | string | null;
          dp_dated_on: string | null;
          dp_method: string | null;
        }>) {
          if (!row.dp_dated_on) continue;
          const [y, m] = row.dp_dated_on.split("-");
          const key = `${Number(y)}-${Number(m)}`;
          const amount = Number(row.dp_amount) || 0;
          byMonth.set(key, (byMonth.get(key) ?? 0) + amount);
          const methodMap = byMonthMethod.get(key) ?? new Map<string, number>();
          const method = (row.dp_method ?? "").trim() || "Unspecified";
          methodMap.set(method, (methodMap.get(method) ?? 0) + amount);
          byMonthMethod.set(key, methodMap);
          const patSet = matchedPatientsByMonth.get(key) ?? new Set<string>();
          if (row.dp_patient_id != null) patSet.add(String(row.dp_patient_id));
          matchedPatientsByMonth.set(key, patSet);
        }
        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        from += PAGE_SIZE;
      }
      return { byMonth, byMonthMethod, matchedPatientsByMonth };
    },
  });

  const rows = useMemo<ReconciliationMonthRow[]>(() => {
    if (!statementQ.data || !dentallyQ.data) return [];
    const sortedPairs = [...effectivePairs].sort((a, b) => a.year - b.year || a.month - b.month);
    return sortedPairs
      .map((p): ReconciliationMonthRow | null => {
        const key = `${p.year}-${p.month}`;
        const statementCollected = Math.round((statementQ.data!.get(key) ?? 0) * 100) / 100;
        if (statementCollected === 0) return null; // no statement this month — nothing to reconcile
        const dentallyTotal = Math.round((dentallyQ.data!.byMonth.get(key) ?? 0) * 100) / 100;
        const methodMap = dentallyQ.data!.byMonthMethod.get(key) ?? new Map<string, number>();
        const dentallyByMethod = Array.from(methodMap.entries())
          .map(([method, amount]) => ({ method, amount: Math.round(amount * 100) / 100 }))
          .sort((a, b) => b.amount - a.amount);
        const variance = Math.round((statementCollected - dentallyTotal) * 100) / 100;
        return {
          month: p.month,
          year: p.year,
          monthLabel: `${MONTH_NAMES[p.month - 1]} ${p.year}`,
          statementCollected,
          dentallyTotal,
          dentallyByMethod,
          variance,
          variancePct: statementCollected > 0 ? Math.round((variance / statementCollected) * 1000) / 10 : null,
          matchedPatients: dentallyQ.data!.matchedPatientsByMonth.get(key)?.size ?? 0,
        };
      })
      .filter((r): r is ReconciliationMonthRow => r != null);
  }, [effectivePairs, statementQ.data, dentallyQ.data]);

  return {
    isLoading: statementQ.isLoading || dentallyQ.isLoading,
    hasData: rows.length > 0,
    rows,
  };
}
