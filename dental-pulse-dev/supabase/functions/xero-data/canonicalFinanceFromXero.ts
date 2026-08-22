/**
 * Materialize canonical finance_* rows from Xero Journals API + COA already in
 * platform_integration_chart_of_accounts (saved by xero-data accounts sync).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLATFORM = "xero" as const;
const CHUNK = 400;
const UNMAPPED_CODE = "_unmapped_xero_account";

export interface XeroCanonicalSyncResult {
  sourceId: string | null;
  accountsUpserted: number;
  journalEntriesUpserted: number;
  journalLinesUpserted: number;
  journalsProcessed: number;
  skippedReason?: string;
  error?: string;
}

export interface XeroJournalLine {
  JournalLineID?: string;
  AccountID?: string;
  AccountCode?: string;
  AccountType?: string;
  AccountName?: string;
  Description?: string;
  NetAmount?: number;
  TaxAmount?: number;
  TaxType?: string;
}

export interface XeroJournal {
  JournalID?: string;
  JournalDate?: string;
  JournalNumber?: number;
  CreatedDateUTC?: string;
  Reference?: string;
  SourceType?: string;
  SourceID?: string;
  JournalLines?: XeroJournalLine[];
}

/** Parse Xero .NET JSON date or ISO to YYYY-MM-DD for Postgres DATE. */
export function xeroJournalDateToYmd(xeroDate: string | null | undefined): string {
  if (!xeroDate) return new Date().toISOString().slice(0, 10);
  if (xeroDate.startsWith("/Date(")) {
    const match = xeroDate.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
    if (match) {
      const d = new Date(parseInt(match[1], 10));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(xeroDate);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
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
    console.error("[XeroCanonical] ensureFinanceDataSource select:", selectErr.message);
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
    const { data: racedRows, error: raceErr } = await supabase
      .from("finance_data_sources")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform", PLATFORM)
      .eq("platform_integration_id", connectionId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (raceErr || !racedRows || racedRows.length === 0 || !racedRows[0]?.id) {
      console.error("[XeroCanonical] ensureFinanceDataSource insert:", insertErr.message);
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
    console.warn("[XeroCanonical] buildAccountMaps:", error.message);
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
        account_name: "Unmapped Xero GL account",
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
    console.error("[XeroCanonical] ensureUnmappedAccount:", error.message);
    return null;
  }
  return data?.id ?? null;
}

function resolveFinanceAccountId(
  line: XeroJournalLine,
  maps: AccountMaps,
  unmappedId: string | null
): string | null {
  const aid = line.AccountID != null ? String(line.AccountID).trim() : "";
  if (aid && maps.byCanonicalCode.has(aid)) {
    return maps.byCanonicalCode.get(aid)!;
  }
  const code = line.AccountCode != null ? String(line.AccountCode).trim() : "";
  if (code && maps.byCoaCode.has(code)) {
    return maps.byCoaCode.get(code)!;
  }
  if (code && maps.byCanonicalCode.has(code)) {
    return maps.byCanonicalCode.get(code)!;
  }
  return unmappedId;
}

function netToDebitCredit(net: number): { debit: number; credit: number } {
  if (net >= 0) return { debit: Math.abs(net), credit: 0 };
  return { debit: 0, credit: Math.abs(net) };
}

/**
 * Upserts finance_accounts from platform_integration_chart_of_accounts for this Xero integration,
 * replaces finance_journal_* for the Xero finance_data_source from journal payloads.
 *
 * @param tenantId Xero tenant UUID (included in external_journal_id for multi-tenant safety)
 */
// deno-lint-ignore no-explicit-any
export async function syncCanonicalFinanceFromXeroJournals(
  supabase: SupabaseClient<any>,
  organizationId: string,
  platformIntegrationId: string,
  tenantId: string,
  journals: XeroJournal[],
  opts?: { baseCurrency?: string; fromYmd?: string; toYmd?: string }
): Promise<XeroCanonicalSyncResult> {
  const out: XeroCanonicalSyncResult = {
    sourceId: null,
    accountsUpserted: 0,
    journalEntriesUpserted: 0,
    journalLinesUpserted: 0,
    journalsProcessed: 0,
  };

  const fromYmd = opts?.fromYmd;
  const toYmd = opts?.toYmd;

  try {
    const sourceId = await ensureFinanceDataSource(
      supabase,
      organizationId,
      platformIntegrationId,
      opts?.baseCurrency ?? "GBP"
    );
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
      .eq("platform_integration_id", platformIntegrationId)
      .eq("platform_name", "xero");

    if (chartErr) {
      out.error = chartErr.message;
      return out;
    }

    const accountPayload = (chartRows ?? []).map((r: Record<string, unknown>) => ({
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
    }));

    for (let i = 0; i < accountPayload.length; i += CHUNK) {
      const chunk = accountPayload.slice(i, i + CHUNK);
      const { error: upErr } = await supabase.from("finance_accounts").upsert(chunk, {
        onConflict: "organization_id,source_id,canonical_account_code",
      });
      if (upErr) {
        console.error("[XeroCanonical] finance_accounts upsert:", upErr.message);
        out.error = upErr.message;
        return out;
      }
      out.accountsUpserted += chunk.length;
    }

    const unmappedId = await ensureUnmappedAccount(supabase, organizationId, sourceId);
    const maps = await buildAccountMaps(supabase, organizationId, sourceId);

    const filteredJournals = (journals || []).filter((j) => {
      if (!j?.JournalID) return false;
      const ymd = xeroJournalDateToYmd(j.JournalDate);
      if (fromYmd && ymd < fromYmd) return false;
      if (toYmd && ymd > toYmd) return false;
      return true;
    });

    if (filteredJournals.length === 0) {
      out.skippedReason = "no_journals_in_range - left existing finance_journal_* unchanged";
      console.warn(`[XeroCanonical] ${out.skippedReason} (org=${organizationId}, tenant=${tenantId})`);
      return out;
    }

    const tenantPrefix = `xero::${tenantId}::`;
    const { data: existingEntries, error: listEntErr } = await supabase
      .from("finance_journal_entries")
      .select("id")
      .eq("source_id", sourceId)
      .like("external_journal_id", `${tenantPrefix}%`);

    if (listEntErr) {
      out.error = `[list finance_journal_entries] ${listEntErr.message}`;
      return out;
    }

    const entryIdsToReplace = (existingEntries ?? [])
      .map((r: { id?: string }) => String(r.id || "").trim())
      .filter((id) => !!id);

    if (entryIdsToReplace.length > 0) {
      for (let i = 0; i < entryIdsToReplace.length; i += CHUNK) {
        const part = entryIdsToReplace.slice(i, i + CHUNK);
        const { error: delLines } = await supabase
          .from("finance_journal_lines")
          .delete()
          .in("journal_entry_id", part);
        if (delLines) {
          out.error = `[delete finance_journal_lines] ${delLines.message}`;
          return out;
        }
      }

      const { error: delEnt } = await supabase
        .from("finance_journal_entries")
        .delete()
        .eq("source_id", sourceId)
        .like("external_journal_id", `${tenantPrefix}%`);

      if (delEnt) {
        out.error = `[delete finance_journal_entries] ${delEnt.message}`;
        return out;
      }
    }

    const journalPayload: Record<string, unknown>[] = [];

    for (const j of filteredJournals) {
      const jid = String(j.JournalID);
      const posting = xeroJournalDateToYmd(j.JournalDate);
      const extKey = `xero::${tenantId}::${jid}`;
      journalPayload.push({
        organization_id: organizationId,
        source_id: sourceId,
        external_journal_id: extKey,
        journal_number: j.JournalNumber != null ? String(j.JournalNumber) : null,
        posting_date: posting,
        document_date: posting,
        description: (j.Reference && String(j.Reference).trim()) || `Journal ${jid}`,
        status: "posted",
        currency_code: opts?.baseCurrency ?? null,
        fx_rate: null,
        metadata_json: {
          source_type: "Journal",
          doc_class: j.SourceType ?? null,
          xero_tenant_id: tenantId,
          xero_source_id: j.SourceID ?? null,
          xero_journal_id: jid,
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

    const journalIdByExternal = new Map<string, string>();
    for (const row of insertedEntries) {
      journalIdByExternal.set(row.external_journal_id, row.id);
    }

    const linePayload: Record<string, unknown>[] = [];

    for (const j of filteredJournals) {
      const jid = String(j.JournalID);
      const extKey = `xero::${tenantId}::${jid}`;
      const journalEntryId = journalIdByExternal.get(extKey);
      if (!journalEntryId) continue;

      const lines = j.JournalLines ?? [];
      const posting = xeroJournalDateToYmd(j.JournalDate);

      for (let li = 0; li < lines.length; li++) {
        const jl = lines[li];
        const financeAccountId = resolveFinanceAccountId(jl, maps, unmappedId);
        if (!financeAccountId) continue;

        const net = Number(jl.NetAmount) || 0;
        const { debit, credit } = netToDebitCredit(net);
        const extLine =
          jl.JournalLineID != null && String(jl.JournalLineID).trim() !== ""
            ? String(jl.JournalLineID).trim()
            : `L${li}`;

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
          tax_code: jl.TaxType ?? null,
          cost_center: null,
          contact_ref: null,
          project_ref: null,
          dimensions_json: {
            doc_class: j.SourceType ?? null,
            source_type: "Journal",
            xero_account_type: jl.AccountType ?? null,
          },
          extras_json: {
            line_description: jl.Description ?? jl.AccountName ?? null,
            narrative: j.Reference ?? null,
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

    out.journalsProcessed = filteredJournals.length;
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
}
