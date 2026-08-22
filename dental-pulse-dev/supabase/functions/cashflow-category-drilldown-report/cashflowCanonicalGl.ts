/**
 * Read canonical finance_journal_lines and map to the same loose shape as
 * iplicit_gl_entries for cashflow-report (non-category-based path).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
export async function getFinanceSourceId(
  supabase: SupabaseClient<any>,
  organizationId: string,
  platform: string,
  platformIntegrationId: string
): Promise<string | null> {
  const { data: rows, error } = await supabase
    .from("finance_data_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("platform", platform)
    .eq("platform_integration_id", platformIntegrationId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.warn("[cashflowCanonicalGl] finance_data_sources:", error.message);
    return null;
  }
  return rows?.[0]?.id ?? null;
}

// deno-lint-ignore no-explicit-any
export async function getIplicitFinanceSourceId(
  supabase: SupabaseClient<any>,
  organizationId: string,
  platformIntegrationId: string
): Promise<string | null> {
  return getFinanceSourceId(supabase, organizationId, "iplicit", platformIntegrationId);
}

// deno-lint-ignore no-explicit-any
export async function resolveActiveCanonicalFinanceSource(
  supabase: SupabaseClient<any>,
  organizationId: string
): Promise<{
  sourceId: string | null;
  lineCount: number;
  platform: string | null;
  integrationId: string | null;
}> {
  const { data: sources, error } = await supabase
    .from("finance_data_sources")
    .select("id, platform, platform_integration_id")
    .eq("organization_id", organizationId)
    .in("platform", ["iplicit", "xero"])
    .not("platform_integration_id", "is", null);

  if (error) {
    console.warn("[cashflowCanonicalGl] resolveActiveCanonicalFinanceSource:", error.message);
    return { sourceId: null, lineCount: 0, platform: null, integrationId: null };
  }

  const rows = [...(sources ?? [])].sort((a, b) => {
    const rank = (p: string) => (p === "iplicit" ? 0 : p === "xero" ? 1 : 2);
    return rank(String(a.platform)) - rank(String(b.platform));
  });

  for (const s of rows) {
    const sid = s.id != null ? String(s.id).trim() : "";
    const integ = s.platform_integration_id != null ? String(s.platform_integration_id).trim() : "";
    if (!sid || !integ) continue;
    const n = await countJournalLinesForSource(supabase, sid);
    if (n > 0) {
      return {
        sourceId: sid,
        lineCount: n,
        platform: String(s.platform),
        integrationId: integ,
      };
    }
  }
  return { sourceId: null, lineCount: 0, platform: null, integrationId: null };
}

// deno-lint-ignore no-explicit-any
export async function countJournalLinesForSource(
  supabase: SupabaseClient<any>,
  sourceId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("finance_journal_lines")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId);

  if (error) {
    console.warn("[cashflowCanonicalGl] count lines:", error.message);
    return 0;
  }
  return count ?? 0;
}

export type IplicitGlLikeRow = Record<string, unknown>;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// deno-lint-ignore no-explicit-any
export async function fetchCanonicalGlRowsLikeIplicit(
  supabase: SupabaseClient<any>,
  organizationId: string,
  sourceId: string,
  fromDate: string,
  toDate: string
): Promise<IplicitGlLikeRow[]> {
  const { data: lines, error: linesError } = await supabase
    .from("finance_journal_lines")
    .select("id, posting_date, debit_amount, credit_amount, net_amount, extras_json, account_id, journal_entry_id")
    .eq("organization_id", organizationId)
    .eq("source_id", sourceId)
    .gte("posting_date", fromDate)
    .lte("posting_date", toDate);

  if (linesError) {
    console.error("[cashflowCanonicalGl] lines query:", linesError.message);
    return [];
  }

  if (!lines?.length) return [];

  const journalIds = [...new Set(lines.map((l) => l.journal_entry_id).filter(Boolean))] as string[];
  const accountIds = [...new Set(lines.map((l) => l.account_id).filter(Boolean))] as string[];

  const journalById = new Map<string, Record<string, unknown>>();
  for (const part of chunk(journalIds, 120)) {
    const { data: journals, error: jErr } = await supabase
      .from("finance_journal_entries")
      .select("id, metadata_json, description, document_date, posting_date")
      .in("id", part);
    if (jErr) {
      console.error("[cashflowCanonicalGl] journals:", jErr.message);
      continue;
    }
    for (const j of journals ?? []) {
      journalById.set(j.id as string, j as Record<string, unknown>);
    }
  }

  const accountById = new Map<string, Record<string, unknown>>();
  for (const part of chunk(accountIds, 120)) {
    const { data: accounts, error: aErr } = await supabase
      .from("finance_accounts")
      .select("id, canonical_account_code, attributes_json")
      .in("id", part);
    if (aErr) {
      console.error("[cashflowCanonicalGl] accounts:", aErr.message);
      continue;
    }
    for (const a of accounts ?? []) {
      accountById.set(a.id as string, a as Record<string, unknown>);
    }
  }

  const out: IplicitGlLikeRow[] = [];

  for (const row of lines) {
    const je = journalById.get(row.journal_entry_id as string);
    const fa = accountById.get(row.account_id as string);
    const meta = (je?.metadata_json ?? {}) as Record<string, unknown>;
    const attrs = (fa?.attributes_json ?? {}) as { coa_account_code?: string | null };

    const posting = String(row.posting_date ?? "");
    const docDate = je?.document_date ? String(je.document_date) : posting;

    out.push({
      account_id: fa?.canonical_account_code ?? null,
      account_code: attrs?.coa_account_code ?? null,
      debit_amount: row.debit_amount ?? 0,
      credit_amount: row.credit_amount ?? 0,
      net_amount: row.net_amount ?? 0,
      entry_date: posting,
      doc_date: docDate,
      source_type: meta.source_type ?? "Document",
      doc_class: meta.doc_class ?? null,
      description: je?.description ?? null,
      narrative: (row.extras_json as { narrative?: string } | null)?.narrative ?? null,
    });
  }

  return out;
}

/**
 * Map canonical journal lines into the loose PL/BS-like shape used by
 * category-based cashflow-report aggregation.
 */
// deno-lint-ignore no-explicit-any
export async function fetchCanonicalRowsLikePlBsForCashflowReport(
  supabase: SupabaseClient<any>,
  organizationId: string,
  sourceId: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, unknown>[]> {
  const { data: lines, error: linesError } = await supabase
    .from("finance_journal_lines")
    .select(
      "id, posting_date, debit_amount, credit_amount, contact_ref, dimensions_json, extras_json, journal_entry_id, account_id, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .eq("source_id", sourceId)
    .gte("posting_date", fromDate)
    .lte("posting_date", toDate);

  if (linesError) {
    console.warn("[cashflowCanonicalGl] category lines:", linesError.message);
    return [];
  }
  if (!lines?.length) return [];

  const journalIds = [...new Set(lines.map((l) => l.journal_entry_id).filter(Boolean))] as string[];
  const accountIds = [...new Set(lines.map((l) => l.account_id).filter(Boolean))] as string[];

  const journalById = new Map<string, Record<string, unknown>>();
  for (const part of chunk(journalIds, 120)) {
    const { data: journals, error: jErr } = await supabase
      .from("finance_journal_entries")
      .select("id, external_journal_id, metadata_json, description, document_date, posting_date")
      .in("id", part);
    if (jErr) {
      console.error("[cashflowCanonicalGl] category journals:", jErr.message);
      continue;
    }
    for (const j of journals ?? []) {
      journalById.set(j.id as string, j as Record<string, unknown>);
    }
  }

  const accountById = new Map<string, Record<string, unknown>>();
  for (const part of chunk(accountIds, 120)) {
    const { data: accounts, error: aErr } = await supabase
      .from("finance_accounts")
      .select("id, canonical_account_code, attributes_json")
      .in("id", part);
    if (aErr) {
      console.error("[cashflowCanonicalGl] category accounts:", aErr.message);
      continue;
    }
    for (const a of accounts ?? []) {
      accountById.set(a.id as string, a as Record<string, unknown>);
    }
  }

  const out: Record<string, unknown>[] = [];
  for (const row of lines) {
    const je = journalById.get(row.journal_entry_id as string);
    const fa = accountById.get(row.account_id as string);
    if (!je || !fa) continue;

    const ext = String(je.external_journal_id ?? "");
    const docId = ext.includes("::") ? ext.slice(ext.indexOf("::") + 2) : ext;
    const dims = (row.dimensions_json ?? {}) as Record<string, unknown>;
    const extras = (row.extras_json ?? {}) as { narrative?: string | null; line_description?: string | null };
    const meta = (je.metadata_json ?? {}) as Record<string, unknown>;
    const attrs = (fa.attributes_json ?? {}) as { coa_account_code?: string | null };

    const debit = Number(row.debit_amount) || 0;
    const credit = Number(row.credit_amount) || 0;

    out.push({
      id: row.id,
      doc_id: docId,
      account_id: fa.canonical_account_code ?? null,
      account_code: attrs.coa_account_code ?? fa.canonical_account_code ?? null,
      amount: debit - credit,
      period_date: row.posting_date,
      post_date: je.posting_date ?? row.posting_date,
      doc_class: dims.doc_class ?? meta.doc_class ?? null,
      description: extras.line_description ?? je.description ?? null,
      doc_description: extras.narrative ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }
  return out;
}
