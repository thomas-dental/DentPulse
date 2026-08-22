import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
    console.warn("[cashflowCanonicalStatement] finance_data_sources:", error.message);
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
    console.warn("[cashflowCanonicalStatement] resolveActiveCanonicalFinanceSource:", error.message);
    return { sourceId: null, lineCount: 0, platform: null, integrationId: null };
  }

  const raw = [...(sources ?? [])];
  const integrationIds = [...new Set(raw.map((r) => String(r.platform_integration_id || "").trim()).filter(Boolean))];

  const connectedIds = new Set<string>();
  if (integrationIds.length > 0) {
    const { data: piRows, error: piErr } = await supabase
      .from("platform_integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_connected", true)
      .in("id", integrationIds);
    if (piErr) {
      console.warn("[cashflowCanonicalStatement] resolveActiveCanonicalFinanceSource integrations:", piErr.message);
    } else {
      for (const r of piRows || []) {
        if (r?.id) connectedIds.add(String(r.id));
      }
    }
  }

  const rows = raw
    .filter((s) => {
      const integ = s.platform_integration_id != null ? String(s.platform_integration_id).trim() : "";
      return integ && connectedIds.has(integ);
    })
    .sort((a, b) => {
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
    console.warn("[cashflowCanonicalStatement] count lines:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** True if any sampled line carries `dimensions_json.legal_entity_id` (iplicit-style tagging). */
function linesHaveLegalEntityDimension(
  lines: { dimensions_json?: unknown }[] | null | undefined
): boolean {
  if (!lines?.length) return false;
  return lines.some((l) => {
    const dim = (l.dimensions_json ?? {}) as Record<string, unknown>;
    return String(dim.legal_entity_id ?? "").trim() !== "";
  });
}

function docIdFromExternalJournalId(externalJournalId: string): string {
  const s = String(externalJournalId || "");
  const idx = s.indexOf("::");
  return idx >= 0 ? s.slice(idx + 2) : s;
}

/**
 * Map canonical journal lines to the loose row shape used by statement logic
 * (equivalent to iplicit PL/BS rows for filtering/split calculations).
 */
// deno-lint-ignore no-explicit-any
export async function fetchCanonicalStatementRowsLikePlBs(
  supabase: SupabaseClient<any>,
  organizationId: string,
  sourceId: string,
  fromDate: string,
  toDate: string,
  mappedLegalEntityId: string | null
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
    console.warn("[cashflowCanonicalStatement] statement lines:", linesError.message);
    return [];
  }
  if (!lines?.length) return [];

  let filtered = lines;
  if (mappedLegalEntityId) {
    const le = mappedLegalEntityId.trim();
    // Xero (and some sources) do not stamp legal_entity_id on journal lines; filtering would drop every row.
    if (linesHaveLegalEntityDimension(lines)) {
      filtered = lines.filter((l) => {
        const dim = (l.dimensions_json ?? {}) as Record<string, unknown>;
        const lid = dim.legal_entity_id != null ? String(dim.legal_entity_id).trim() : "";
        return lid === le;
      });
    } else {
      filtered = lines;
    }
  }
  if (!filtered.length) return [];

  const journalIds = [...new Set(filtered.map((l) => l.journal_entry_id).filter(Boolean))] as string[];
  const accountIds = [...new Set(filtered.map((l) => l.account_id).filter(Boolean))] as string[];

  const journalById = new Map<string, Record<string, unknown>>();
  for (const part of chunk(journalIds, 120)) {
    const { data: journals, error: jErr } = await supabase
      .from("finance_journal_entries")
      .select("id, external_journal_id, metadata_json, description, document_date, posting_date")
      .in("id", part);
    if (jErr) {
      console.error("[cashflowCanonicalStatement] statement journals:", jErr.message);
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
      console.error("[cashflowCanonicalStatement] statement accounts:", aErr.message);
      continue;
    }
    for (const a of accounts ?? []) {
      accountById.set(a.id as string, a as Record<string, unknown>);
    }
  }

  const out: Record<string, unknown>[] = [];
  for (const row of filtered) {
    const je = journalById.get(row.journal_entry_id as string);
    const fa = accountById.get(row.account_id as string);
    if (!je || !fa) continue;

    const ext = String(je.external_journal_id ?? "");
    const docId = docIdFromExternalJournalId(ext);
    const dims = (row.dimensions_json ?? {}) as Record<string, unknown>;
    const extras = (row.extras_json ?? {}) as {
      narrative?: string | null;
      line_description?: string | null;
    };
    const meta = (je.metadata_json ?? {}) as Record<string, unknown>;
    const attrs = (fa.attributes_json ?? {}) as { coa_account_code?: string | null };

    const debit = Number(row.debit_amount) || 0;
    const credit = Number(row.credit_amount) || 0;
    const xeroLineType =
      dims.xero_account_type != null ? String(dims.xero_account_type).trim() || null : null;

    out.push({
      id: row.id,
      journal_entry_id: row.journal_entry_id,
      doc_id: docId,
      account_id: fa.canonical_account_code ?? null,
      account_code: attrs.coa_account_code ?? fa.canonical_account_code ?? null,
      amount: debit - credit,
      period_date: row.posting_date,
      post_date: je.posting_date ?? row.posting_date,
      invoice_date: je.document_date ?? null,
      doc_class: dims.doc_class ?? meta.doc_class ?? null,
      description: extras.line_description ?? je.description ?? null,
      doc_description: extras.narrative ?? null,
      name: row.contact_ref ?? null,
      legal_entity_id: dims.legal_entity_id ?? null,
      /** Xero journal line AccountType — used for statement "For What" when COA flags are sparse. */
      xero_account_type: xeroLineType,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }
  return out;
}

/** Sum signed amounts on bank accounts before `fromDate` for opening balance. */
// deno-lint-ignore no-explicit-any
export async function sumCanonicalBankOpeningBalance(
  supabase: SupabaseClient<any>,
  organizationId: string,
  sourceId: string,
  bankFinanceAccountIds: string[],
  fromDate: string,
  mappedLegalEntityId: string | null
): Promise<number> {
  if (bankFinanceAccountIds.length === 0) return 0;

  let applyLegalEntityDim = false;
  if (mappedLegalEntityId?.trim()) {
    const { data: sample, error: sampleErr } = await supabase
      .from("finance_journal_lines")
      .select("dimensions_json")
      .eq("organization_id", organizationId)
      .eq("source_id", sourceId)
      .limit(200);
    if (sampleErr) {
      console.warn("[cashflowCanonicalStatement] opening balance LE sample:", sampleErr.message);
    } else {
      applyLegalEntityDim = linesHaveLegalEntityDimension(sample ?? []);
    }
  }

  let sum = 0;
  const CHUNK = 150;
  for (let i = 0; i < bankFinanceAccountIds.length; i += CHUNK) {
    const part = bankFinanceAccountIds.slice(i, i + CHUNK);
    const { data: obLines, error } = await supabase
      .from("finance_journal_lines")
      .select("debit_amount, credit_amount, dimensions_json")
      .eq("organization_id", organizationId)
      .eq("source_id", sourceId)
      .in("account_id", part)
      .lt("posting_date", fromDate);

    if (error) {
      console.warn("[cashflowCanonicalStatement] opening balance lines:", error.message);
      continue;
    }
    for (const l of obLines ?? []) {
      if (mappedLegalEntityId && applyLegalEntityDim) {
        const dim = (l.dimensions_json ?? {}) as Record<string, unknown>;
        const le = dim.legal_entity_id != null ? String(dim.legal_entity_id).trim() : "";
        if (le !== mappedLegalEntityId.trim()) continue;
      }
      sum += (Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0);
    }
  }
  return sum;
}
