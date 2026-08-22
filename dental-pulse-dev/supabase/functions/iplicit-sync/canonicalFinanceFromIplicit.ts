/**
 * Populate canonical finance_* tables from iplicit staging:
 * - platform_integration_chart_of_accounts -> finance_accounts
 * - iplicit_gl_entries -> finance_journal_entries + finance_journal_lines
 *
 * Called after GL sync (edge function) using service role.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLATFORM = "iplicit" as const;
const CHUNK = 400;
const UNMAPPED_CODE = "_unmapped_iplicit_gl";

export interface CanonicalSyncResult {
  sourceId: string | null;
  accountsUpserted: number;
  journalEntriesUpserted: number;
  journalLinesUpserted: number;
  /** Rows read from iplicit_profit_loss + iplicit_balance_sheet for this connection */
  sourceRowCount?: number;
  sourcePlRowCount?: number;
  sourceBsRowCount?: number;
  sourceFilterMode?: "org_and_integration" | "org_only_fallback";
  /** Set when we skip journal rebuild (e.g. no staging GL rows - avoids wiping finance_* ) */
  skippedReason?: string;
  error?: string;
}

// deno-lint-ignore no-explicit-any
async function ensureFinanceDataSource(
  supabase: SupabaseClient<any>,
  organizationId: string,
  connectionId: string,
  baseCurrency = "GBP"
): Promise<string | null> {
  const { data: existingRows, error: selectErr } = await supabase
    .from("finance_data_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("platform", PLATFORM)
    .eq("platform_integration_id", connectionId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (selectErr) {
    console.error("[CanonicalFinance] ensureFinanceDataSource select:", selectErr.message);
    return null;
  }

  if (existingRows && existingRows.length > 0 && existingRows[0]?.id) {
    return existingRows[0].id as string;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("finance_data_sources")
    .insert({
      organization_id: organizationId,
      platform: PLATFORM,
      platform_integration_id: connectionId,
      base_currency: baseCurrency,
      is_active: true,
      metadata_json: {},
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    // Handle race: if another process inserted between select and insert, read again.
    const { data: racedRows, error: raceErr } = await supabase
      .from("finance_data_sources")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform", PLATFORM)
      .eq("platform_integration_id", connectionId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (raceErr || !racedRows || racedRows.length === 0 || !racedRows[0]?.id) {
      console.error("[CanonicalFinance] ensureFinanceDataSource insert:", insertErr.message);
      return null;
    }
    return racedRows[0].id as string;
  }

  return (inserted?.id as string) ?? null;
}

interface AccountMaps {
  byCanonicalCode: Map<string, string>;
  byCoaCode: Map<string, string>;
}

// deno-lint-ignore no-explicit-any
async function buildAccountMaps(
  supabase: SupabaseClient<any>,
  organizationId: string,
  sourceId: string
): Promise<AccountMaps> {
  const byCanonicalCode = new Map<string, string>();
  const byCoaCode = new Map<string, string>();

  const { data, error } = await supabase
    .from("finance_accounts")
    .select("id, canonical_account_code, attributes_json")
    .eq("organization_id", organizationId)
    .eq("source_id", sourceId);

  if (error) {
    console.warn("[CanonicalFinance] buildAccountMaps:", error.message);
    return { byCanonicalCode, byCoaCode };
  }

  for (const row of data ?? []) {
    const id = row.id as string;
    byCanonicalCode.set(String(row.canonical_account_code), id);
    const attrs = row.attributes_json as { coa_account_code?: string } | null;
    const c = attrs?.coa_account_code;
    if (c != null && String(c).trim() !== "") {
      byCoaCode.set(String(c).trim(), id);
    }
  }

  return { byCanonicalCode, byCoaCode };
}

// deno-lint-ignore no-explicit-any
async function ensureUnmappedAccount(
  supabase: SupabaseClient<any>,
  organizationId: string,
  sourceId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("finance_accounts")
    .upsert(
      {
        organization_id: organizationId,
        source_id: sourceId,
        canonical_account_code: UNMAPPED_CODE,
        account_name: "Unmapped iplicit GL account",
        account_type: null,
        report_category: null,
        is_active: true,
        attributes_json: { placeholder: true },
      },
      { onConflict: "organization_id,source_id,canonical_account_code" }
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[CanonicalFinance] ensureUnmappedAccount:", error.message);
    return null;
  }
  return data?.id ?? null;
}

function resolveAccountId(
  row: Record<string, unknown>,
  maps: AccountMaps,
  unmappedId: string | null
): string | null {
  const aid = row.account_id != null ? String(row.account_id).trim() : "";
  if (aid && maps.byCanonicalCode.has(aid)) {
    return maps.byCanonicalCode.get(aid)!;
  }
  const code = row.account_code != null ? String(row.account_code).trim() : "";
  if (code && maps.byCoaCode.has(code)) {
    return maps.byCoaCode.get(code)!;
  }
  if (code && maps.byCanonicalCode.has(code)) {
    return maps.byCanonicalCode.get(code)!;
  }
  return unmappedId;
}

// deno-lint-ignore no-explicit-any
export async function syncCanonicalFinanceFromIplicitEdge(
  supabase: SupabaseClient<any>,
  organizationId: string,
  connectionId: string
): Promise<CanonicalSyncResult> {
  const out: CanonicalSyncResult = {
    sourceId: null,
    accountsUpserted: 0,
    journalEntriesUpserted: 0,
    journalLinesUpserted: 0,
  };

  try {
    const sourceId = await ensureFinanceDataSource(supabase, organizationId, connectionId);
    out.sourceId = sourceId;
    if (!sourceId) {
      out.error = "finance_data_sources upsert failed";
      return out;
    }

    const { data: chartRows, error: chartErr } = await supabase
      .from("platform_integration_chart_of_accounts")
      .select(
        "coa_account_id, coa_account_code, coa_account_name, coa_account_type, coa_classification, coa_is_active, coa_description"
      )
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", connectionId);

    if (chartErr) {
      out.error = chartErr.message;
      return out;
    }

    const accountPayload = (chartRows ?? []).map(
      (r: Record<string, unknown>) => ({
        organization_id: organizationId,
        source_id: sourceId,
        canonical_account_code: String(r.coa_account_id),
        account_name: String(r.coa_account_name ?? r.coa_account_code ?? r.coa_account_id),
        account_type: r.coa_account_type ? String(r.coa_account_type) : null,
        report_category: r.coa_classification ? String(r.coa_classification) : null,
        is_active: r.coa_is_active !== false,
        attributes_json: {
          coa_account_code: r.coa_account_code ?? null,
          coa_description: r.coa_description ?? null,
        },
      })
    );

    for (let i = 0; i < accountPayload.length; i += CHUNK) {
      const chunk = accountPayload.slice(i, i + CHUNK);
      const { error: upErr } = await supabase.from("finance_accounts").upsert(chunk, {
        onConflict: "organization_id,source_id,canonical_account_code",
      });
      if (upErr) {
        console.error("[CanonicalFinance] finance_accounts upsert:", upErr.message);
        out.error = upErr.message;
        return out;
      }
      out.accountsUpserted += chunk.length;
    }

    const unmappedId = await ensureUnmappedAccount(supabase, organizationId, sourceId);
    const maps = await buildAccountMaps(supabase, organizationId, sourceId);

    let sourceFilterMode: "org_and_integration" | "org_only_fallback" = "org_and_integration";

    const { data: plRowsByConn, error: plErrByConn } = await supabase
      .from("iplicit_profit_loss")
      .select(
        "id, doc_id, doc_no, doc_class, trans_line_no, amount, account_id, account_code, " +
          "period_date, post_date, invoice_date, description, doc_description, currency, base_currency, " +
          "contact_account_code, contact_account_id, legal_entity_id"
      )
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", connectionId);

    if (plErrByConn) {
      out.error = plErrByConn.message;
      return out;
    }

    const { data: bsRowsByConn, error: bsErrByConn } = await supabase
      .from("iplicit_balance_sheet")
      .select(
        "id, doc_id, doc_no, doc_class, trans_line_no, amount, account_id, account_code, " +
          "period_date, post_date, invoice_date, description, doc_description, currency, base_currency, " +
          "contact_account_code, contact_account_id, legal_entity_id"
      )
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", connectionId);

    if (bsErrByConn) {
      out.error = bsErrByConn.message;
      return out;
    }

    let plRows = plRowsByConn || [];
    let bsRows = bsRowsByConn || [];

    // Legacy data may have organization rows with missing/mismatched platform_integration_id.
    // If org+connection filter returns no source rows, fallback to org-only to materialize canonical data.
    if (plRows.length + bsRows.length === 0) {
      sourceFilterMode = "org_only_fallback";

      const { data: plRowsOrgOnly, error: plOrgErr } = await supabase
        .from("iplicit_profit_loss")
        .select(
          "id, doc_id, doc_no, doc_class, trans_line_no, amount, account_id, account_code, " +
            "period_date, post_date, invoice_date, description, doc_description, currency, base_currency, " +
            "contact_account_code, contact_account_id, legal_entity_id"
        )
        .eq("organization_id", organizationId);
      if (plOrgErr) {
        out.error = plOrgErr.message;
        return out;
      }

      const { data: bsRowsOrgOnly, error: bsOrgErr } = await supabase
        .from("iplicit_balance_sheet")
        .select(
          "id, doc_id, doc_no, doc_class, trans_line_no, amount, account_id, account_code, " +
            "period_date, post_date, invoice_date, description, doc_description, currency, base_currency, " +
            "contact_account_code, contact_account_id, legal_entity_id"
        )
        .eq("organization_id", organizationId);
      if (bsOrgErr) {
        out.error = bsOrgErr.message;
        return out;
      }

      plRows = plRowsOrgOnly || [];
      bsRows = bsRowsOrgOnly || [];
    }

    const list = [
      ...(plRows || []).map((r) => ({ ...r, source_type: "profit_loss" })),
      ...(bsRows || []).map((r) => ({ ...r, source_type: "balance_sheet" })),
    ] as Record<string, unknown>[];

    out.sourceFilterMode = sourceFilterMode;
    out.sourcePlRowCount = plRows.length;
    out.sourceBsRowCount = bsRows.length;
    out.sourceRowCount = list.length;

    // If source enquiry rows are empty, do NOT delete existing finance journal data.
    if (list.length === 0) {
      out.skippedReason =
        `no_iplicit_pl_bs_rows (${sourceFilterMode}) - nothing to materialize; left existing finance_journal_* unchanged`;
      console.warn(
        `[CanonicalFinance] ${out.skippedReason} (org=${organizationId}, connection=${connectionId})`
      );
      return out;
    }

    const { error: delLines } = await supabase
      .from("finance_journal_lines")
      .delete()
      .eq("source_id", sourceId);

    if (delLines) {
      out.error = `[delete finance_journal_lines] ${delLines.message}`;
      return out;
    }

    const { error: delEnt } = await supabase
      .from("finance_journal_entries")
      .delete()
      .eq("source_id", sourceId);

    if (delEnt) {
      out.error = `[delete finance_journal_entries] ${delEnt.message}`;
      return out;
    }

    type SourceRow = Record<string, unknown>;
    const byJournal = new Map<string, SourceRow[]>();
    for (const row of list) {
      const st = String(row.source_type ?? "unknown");
      const ext = String(row.doc_id ?? "");
      const key = `${st}::${ext}`;
      if (!byJournal.has(key)) byJournal.set(key, []);
      byJournal.get(key)!.push(row);
    }

    const journalPayload: Record<string, unknown>[] = [];

    for (const [jkey, lines] of byJournal) {
      const sorted = [...lines].sort(
        (a, b) => (Number(a.line_number) || 0) - (Number(b.line_number) || 0)
      );
      const first = sorted[0];
      const posting =
        (first.period_date as string | null) ||
        (first.post_date as string | null) ||
        (first.invoice_date as string | null) ||
        new Date().toISOString().slice(0, 10);

      const cur = (first.currency as string) || (first.base_currency as string) || "GBP";
      const currencyCode = cur.length >= 3 ? cur.slice(0, 3) : cur;

      journalPayload.push({
        organization_id: organizationId,
        source_id: sourceId,
        external_journal_id: jkey,
        journal_number: (first.doc_no as string) || null,
        posting_date: posting,
        document_date: (first.invoice_date as string) || (first.post_date as string) || null,
        description:
          (first.description as string) ||
          (first.doc_description as string) ||
          (first.doc_no as string) ||
          null,
        status: "posted",
        currency_code: currencyCode,
        fx_rate: null,
        metadata_json: {
          source_type: first.source_type,
          source_ref: first.doc_no,
          doc_class: first.doc_class,
        },
      });
    }

    const insertedEntries: { id: string; external_journal_id: string }[] = [];

    for (let i = 0; i < journalPayload.length; i += CHUNK) {
      const chunk = journalPayload.slice(i, i + CHUNK);
      const { data: ins, error: insErr } = await supabase
        .from("finance_journal_entries")
        .upsert(chunk, { onConflict: "source_id,external_journal_id" })
        .select("id, external_journal_id");

      if (insErr) {
        out.error = insErr.message;
        return out;
      }
      insertedEntries.push(...(ins ?? []));
      out.journalEntriesUpserted += ins?.length ?? 0;
    }

    const journalIdByKey = new Map<string, string>();
    for (const row of insertedEntries) {
      journalIdByKey.set(row.external_journal_id, row.id);
    }

    const linePayload: Record<string, unknown>[] = [];

    for (const [jkey, lines] of byJournal) {
      const journalEntryId = journalIdByKey.get(jkey);
      if (!journalEntryId) continue;

      const sorted = [...lines].sort(
        (a, b) => (Number(a.line_number) || 0) - (Number(b.line_number) || 0)
      );

      for (let li = 0; li < sorted.length; li++) {
        const row = sorted[li];
        const financeAccountId = resolveAccountId(row, maps, unmappedId);
        if (!financeAccountId) continue;

        const signedAmount = Number(row.amount) || 0;
        const debit = signedAmount >= 0 ? Math.abs(signedAmount) : 0;
        const credit = signedAmount < 0 ? Math.abs(signedAmount) : 0;
        const posting =
          (row.period_date as string) ||
          (row.post_date as string) ||
          (row.invoice_date as string) ||
          new Date().toISOString().slice(0, 10);

        const extLine = row.trans_line_no != null ? String(row.trans_line_no) : `L${li}`;

        linePayload.push({
          organization_id: organizationId,
          source_id: sourceId,
          journal_entry_id: journalEntryId,
          external_line_id: extLine,
          account_id: financeAccountId,
          posting_date: posting,
          line_order: li,
          debit_amount: debit,
          credit_amount: credit,
          tax_code: null,
          cost_center: null,
          contact_ref:
            (row.contact_account_code as string) ||
            (row.contact_account_id as string) ||
            null,
          project_ref: null,
          dimensions_json: {
            doc_class: row.doc_class ?? null,
            source_type: row.source_type ?? null,
            legal_entity_id: row.legal_entity_id ?? null,
          },
          extras_json: {
            source_row_id: row.id ?? null,
            narrative: row.doc_description ?? null,
            line_description: row.description ?? null,
            mapped_to_unmapped: financeAccountId === unmappedId,
          },
        });
      }
    }

    for (let i = 0; i < linePayload.length; i += CHUNK) {
      const chunk = linePayload.slice(i, i + CHUNK);
      const { error: lErr } = await supabase
        .from("finance_journal_lines")
        .upsert(chunk, { onConflict: "journal_entry_id,external_line_id" });
      if (lErr) {
        out.error = lErr.message;
        return out;
      }
      out.journalLinesUpserted += chunk.length;
    }

    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
}
