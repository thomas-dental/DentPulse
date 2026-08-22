/**
 * Build "Transactions to Review" from Xero canonical finance_journal_lines (bank accounts only).
 * Runs before xero_bank_transactions fallback.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  countJournalLinesForSource,
  fetchCanonicalStatementRowsLikePlBs,
  getFinanceSourceId,
  sumCanonicalBankOpeningBalance,
} from "./cashflowCanonicalStatement.ts";
import { getXeroTransactionLink } from "./accountingTransactionLinks.ts";
import { selectCashEffectKeys } from "./cashEffectFilter.ts";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(d: string): string {
  const date = new Date(d);
  const day = date.getDate();
  const month = MONTH_NAMES[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function formatMoney(value: number | null | undefined, currency = "£"): string {
  if (value == null || value === 0) return "–";
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return value < 0 ? `(${currency}${formatted})` : `${currency}${formatted}`;
}

function normAccountId(id: unknown): string {
  return id != null && id !== "" ? String(id).trim() : "";
}

function buildXeroSplitLabel(params: {
  candidateRows: Record<string, unknown>[];
  bankAccountIdSet: Set<string>;
  accountTypeById: Record<string, string>;
  accountIsControlById: Record<string, boolean>;
  accountNameById: Record<string, string>;
}): string {
  const { candidateRows, bankAccountIdSet, accountTypeById, accountIsControlById, accountNameById } = params;

  const rowLabel = (r: Record<string, unknown>) => {
    const accId = normAccountId(r.account_id);
    if (!accId) return "";
    const accName = accountNameById[accId];
    const code = String(r.account_code || "").trim();
    return String(accName || code || "").trim();
  };

  const isBank = (accId: string) => bankAccountIdSet.size > 0 && bankAccountIdSet.has(accId);

  const collect = (mode: "strict" | "with_control") => {
    const out: string[] = [];
    for (const r of candidateRows) {
      const accId = normAccountId(r.account_id);
      if (!accId || isBank(accId)) continue;

      if (mode === "strict" && accountIsControlById[accId]) continue;

      const lb = rowLabel(r);
      if (lb) out.push(lb);
    }
    return [...new Set(out)];
  };

  let labels = collect("strict");
  if (labels.length === 0) {
    labels = collect("with_control");
  }
  return labels.length > 0 ? labels.join(", ") : "Bank";
}

export type StatementTxnRow = Record<string, unknown>;

// deno-lint-ignore no-explicit-any
export async function tryLoadXeroCanonicalBankStatement(
  supabase: SupabaseClient<any>,
  params: {
    organizationId: string;
    xeroIntegrationId: string;
    fromDate: string;
    toDate: string;
    mappedLegalEntityId: string | null;
    log: (stage: string, meta?: Record<string, unknown>) => void;
  }
): Promise<{ list: StatementTxnRow[]; rows: Record<string, unknown>[] } | null> {
  const { organizationId, xeroIntegrationId, fromDate, toDate, mappedLegalEntityId, log } = params;

  const financeSourceId = await getFinanceSourceId(supabase, organizationId, "xero", xeroIntegrationId);
  if (!financeSourceId) {
    log("xero-canonical.skip", { reason: "no_finance_data_source" });
    return null;
  }

  const lineCount = await countJournalLinesForSource(supabase, financeSourceId);
  if (lineCount === 0) {
    log("xero-canonical.skip", { reason: "no_journal_lines", financeSourceId });
    return null;
  }

  const { data: bankCoaRows, error: bankCoaErr } = await supabase
    .from("platform_integration_chart_of_accounts")
    .select("coa_account_id")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("platform_name", "xero")
    .or("coa_bank_account_type.not.is.null,coa_account_type.eq.BANK,coa_account_type.eq.CREDITCARD");

  if (bankCoaErr) {
    console.error("xero bank COA error:", bankCoaErr);
  }

  const bankAccountIds = (bankCoaRows || [])
    .map((r: { coa_account_id?: string | null }) => normAccountId(r.coa_account_id))
    .filter((c): c is string => !!c);
  const bankAccountIdSet = new Set<string>(bankAccountIds);

  let bankFinanceAccountUuids: string[] = [];
  if (bankAccountIds.length > 0) {
    const { data: bankFaRows, error: bankFaErr } = await supabase
      .from("finance_accounts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source_id", financeSourceId)
      .in("canonical_account_code", bankAccountIds);

    if (bankFaErr) {
      console.warn("finance_accounts xero bank mapping:", bankFaErr.message);
    } else {
      bankFinanceAccountUuids = (bankFaRows || [])
        .map((r: { id?: string | null }) => String(r.id || "").trim())
        .filter((id): id is string => !!id);
    }
  }

  if (bankAccountIds.length === 0 || bankFinanceAccountUuids.length === 0) {
    log("xero-canonical.skip", {
      reason: "no_bank_accounts_mapped_to_finance_accounts",
      bankCoaCount: bankAccountIds.length,
      bankFinanceUuidCount: bankFinanceAccountUuids.length,
    });
    return null;
  }

  const allRows = await fetchCanonicalStatementRowsLikePlBs(
    supabase,
    organizationId,
    financeSourceId,
    fromDate,
    toDate,
    mappedLegalEntityId
  );

  const rowsByDocId = new Map<string, Record<string, unknown>[]>();
  for (const row of allRows) {
    const docId = String(row.doc_id || "");
    if (!docId) continue;
    const existing = rowsByDocId.get(docId) ?? [];
    existing.push(row);
    rowsByDocId.set(docId, existing);
  }

  const filteredGlRows = allRows.filter((row: Record<string, unknown>) => {
    const acctId = normAccountId(row.account_id);
    if (!acctId) return false;
    return bankAccountIdSet.has(acctId);
  });

  filteredGlRows.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const dateA = String(a.period_date || a.post_date || (a as { invoice_date?: unknown }).invoice_date || "");
    const dateB = String(b.period_date || b.post_date || (b as { invoice_date?: unknown }).invoice_date || "");
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const createdA = String((a as { created_at?: unknown }).created_at || (a as { updated_at?: unknown }).updated_at || "");
    const createdB = String((b as { created_at?: unknown }).created_at || (b as { updated_at?: unknown }).updated_at || "");
    return createdA.localeCompare(createdB);
  });

  if (filteredGlRows.length === 0) {
    log("xero-canonical.skip", {
      reason: "no_bank_gl_rows_in_range",
      allRowsCount: allRows.length,
    });
    return null;
  }

  const uniqueAccountIds = [
    ...new Set(
      allRows.map((r: Record<string, unknown>) => normAccountId(r.account_id)).filter((c): c is string => !!c)
    ),
  ];

  let accountNameById: Record<string, string> = {};
  let accountIsControlById: Record<string, boolean> = {};
  let accountTypeById: Record<string, string> = {};

  const COA_CHUNK = 150;
  for (let i = 0; i < uniqueAccountIds.length; i += COA_CHUNK) {
    const chunk = uniqueAccountIds.slice(i, i + COA_CHUNK);
    const { data: coaChunk, error: coaChunkError } = await supabase
      .from("platform_integration_chart_of_accounts")
      .select("coa_account_id, coa_account_name, coa_account_type, coa_is_ar_account, coa_is_ap_account")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .eq("platform_name", "xero")
      .in("coa_account_id", chunk);

    if (coaChunkError) {
      console.error("xero platform_integration_chart_of_accounts chunk error:", coaChunkError);
    } else {
      for (const r of coaChunk || []) {
        const id = normAccountId((r as { coa_account_id?: string | null }).coa_account_id);
        if (!id) continue;
        const nm = (r as { coa_account_name?: string | null }).coa_account_name;
        if (typeof nm === "string" && nm.trim()) accountNameById[id] = nm.trim();
        const tp = (r as { coa_account_type?: string | null }).coa_account_type;
        if (typeof tp === "string" && tp.trim()) accountTypeById[id] = tp.trim();
        const ar = Boolean((r as { coa_is_ar_account?: boolean | null }).coa_is_ar_account);
        const ap = Boolean((r as { coa_is_ap_account?: boolean | null }).coa_is_ap_account);
        accountIsControlById[id] = (accountIsControlById[id] ?? false) || ar || ap;
      }
    }
  }

  if (bankAccountIds.length > 0) {
    const { data: bankCoaMeta, error: bankCoaMetaError } = await supabase
      .from("platform_integration_chart_of_accounts")
      .select("coa_account_id, coa_account_name, coa_account_type, coa_is_ar_account, coa_is_ap_account")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .eq("platform_name", "xero")
      .in("coa_account_id", bankAccountIds);

    if (bankCoaMetaError) {
      console.error("xero bank COA meta error:", bankCoaMetaError);
    } else {
      for (const r of bankCoaMeta || []) {
        const id = normAccountId((r as { coa_account_id?: string | null }).coa_account_id);
        if (!id) continue;
        const nm = (r as { coa_account_name?: string | null }).coa_account_name;
        if (typeof nm === "string" && nm.trim()) accountNameById[id] = nm.trim();
        const tp = (r as { coa_account_type?: string | null }).coa_account_type;
        if (typeof tp === "string" && tp.trim()) accountTypeById[id] = tp.trim();
        const ar = Boolean((r as { coa_is_ar_account?: boolean | null }).coa_is_ar_account);
        const ap = Boolean((r as { coa_is_ap_account?: boolean | null }).coa_is_ap_account);
        accountIsControlById[id] = (accountIsControlById[id] ?? false) || ar || ap;
      }
    }
  }

  const openingBalance = await sumCanonicalBankOpeningBalance(
    supabase,
    organizationId,
    financeSourceId,
    bankFinanceAccountUuids,
    fromDate,
    mappedLegalEntityId
  );

  const cashEffectCandidates = filteredGlRows.map((row: Record<string, unknown>, idx: number) => ({
    key: String(row.id || `${row.doc_id || "doc"}:${idx}`),
    date: String(row.period_date || row.post_date || (row as { invoice_date?: unknown }).invoice_date || "").slice(0, 10),
    amount: parseFloat(String(row.amount ?? 0)) || 0,
    description: String(row.description || row.doc_description || "").trim(),
    row,
  }));
  const cashEffectKeys = selectCashEffectKeys(cashEffectCandidates);
  const cashEffectGlRows = cashEffectCandidates
    .filter((c) => cashEffectKeys.has(c.key))
    .map((c) => c.row);

  log("xero-canonical.cash-effect.filter", {
    before: filteredGlRows.length,
    after: cashEffectGlRows.length,
    dropped: filteredGlRows.length - cashEffectGlRows.length,
  });

  const currencySym = "£";
  let runningBalance = openingBalance;

  const list: StatementTxnRow[] = cashEffectGlRows.map((row: Record<string, unknown>) => {
    // Same sign convention as v2 GrossAmount / xero_journal_details: + = money in, − = money out.
    const amount = parseFloat(String(row.amount ?? 0)) || 0;
    const debitNum = amount > 0 ? Math.abs(amount) : 0;
    const creditNum = amount < 0 ? Math.abs(amount) : 0;

    runningBalance += debitNum - creditNum;

    const debitStr = debitNum > 0 ? formatMoney(debitNum, currencySym) : "–";
    const creditStr = creditNum > 0 ? formatMoney(creditNum, currencySym) : "–";
    const balanceStr = formatMoney(runningBalance, currencySym);

    const transactionType = String(row.doc_class || "").trim() || "Bank";
    const rawCode = String((row as { name?: unknown }).name ?? "").trim();
    const rawDesc = String(row.description || row.doc_description || "").trim();
    const displayName = rawDesc || rawCode || "—";
    const bankRowAccId = normAccountId(row.account_id);
    const accountName = bankRowAccId ? accountNameById[bankRowAccId] : undefined;
    const codeFallback = String(row.account_code ?? "").trim();
    const location = (accountName?.trim() || codeFallback || "—") as string;

    const docId = String(row.doc_id || "");
    const linkType = String(row.doc_class || transactionType).trim();
    const transactionLink = getXeroTransactionLink(linkType, docId);
    const baseDocRows = (docId && rowsByDocId.get(docId)) || [];

    // Xero: all lines on a journal share the same Xero JournalID as doc_id — use sibling lines for "For What".
    const splitLabel = buildXeroSplitLabel({
      candidateRows: baseDocRows,
      bankAccountIdSet,
      accountTypeById,
      accountIsControlById,
      accountNameById,
    });

    const memo = String(row.description || row.doc_description || "").trim() || "";
    const effectiveDate = String(row.period_date || row.post_date || (row as { invoice_date?: unknown }).invoice_date || "");

    return {
      id: String(row.id),
      date: formatDate(effectiveDate),
      transactionType,
      transactionLink,
      name: displayName,
      memoOrDescription: memo,
      location: String(location),
      split: splitLabel,
      debit: debitStr,
      credit: creditStr,
      balance: balanceStr,
      _debitNum: debitNum,
      _creditNum: creditNum,
      _balanceNum: runningBalance,
      _nameLower: displayName.toLowerCase(),
      _memoLower: memo.toLowerCase(),
    };
  });

  log("rows.mapped.xero-canonical", {
    mappedCount: list.length,
    allRowsCount: allRows.length,
    bankRowCount: filteredGlRows.length,
  });

  return { list, rows: filteredGlRows };
}
