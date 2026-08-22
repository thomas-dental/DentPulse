/**
 * Build "Transactions to Review" from synced xero_journal_details (bank account lines).
 * Matches legacy v2 logic: cumulative GrossAmount/NetAmount on BANK accounts + opening balance
 * from all bank movements before fromDate — aligns with Xero Balance Sheet bank balances.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getXeroTransactionLink } from "./accountingTransactionLinks.ts";
import { selectCashEffectKeys } from "./cashEffectFilter.ts";
import { isManualJournalType } from "./manualJournalFilter.ts";
import {
  applyTrackingOptionIdsFilter,
  loadSetupBankAccountIds,
  normalizeTrackingOptionIds,
  type XeroTrackingOptionScope,
} from "../_shared/xeroTrackingScope.ts";
import { fetchLiveXeroTrackingCashTotal } from "../_shared/xeroLiveTrackingCash.ts";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAGE = 1000;
const IN_CHUNK = 150;

function formatDate(d: string): string {
  const iso = String(d || "").slice(0, 10);
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (parsed) {
    return `${Number(parsed[3])} ${MONTH_NAMES[Number(parsed[2]) - 1]} ${parsed[1]}`;
  }
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d || "");
  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatMoney(value: number | null | undefined, currency = "£"): string {
  if (value == null || value === 0) return "–";
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return value < 0 ? `(${currency}${formatted})` : `${currency}${formatted}`;
}

/** Shift running balances so the last row equals Xero BS cash as at the end date. */
export function rebaseStatementRunningBalances(
  list: Array<{ _balanceNum: number; balance: string }>,
  closing: number,
  currencySym = "£"
): void {
  if (list.length === 0) return;
  const last = Number(list[list.length - 1]._balanceNum) || 0;
  const drift = Math.round((last - closing) * 100) / 100;
  if (Math.abs(drift) < 0.005) return;
  for (const row of list) {
    row._balanceNum = Math.round((Number(row._balanceNum) - drift) * 100) / 100;
    row.balance = formatMoney(row._balanceNum, currencySym);
  }
}

function normTypeKey(type: unknown): string {
  return String(type || "").trim().replace(/\s+/g, "").toUpperCase();
}

function normId(id: unknown): string {
  return id != null && id !== "" ? String(id).trim() : "";
}

/** Signed movement on a bank line (v2 GrossAmount convention: + = money in, − = money out). */
function lineAmount(row: { gross_amount?: unknown; net_amount?: unknown }): number {
  const gross = row.gross_amount;
  if (gross != null && gross !== "" && !Number.isNaN(Number(gross))) {
    return Number(gross);
  }
  return Number(row.net_amount) || 0;
}

function trackingIdsOnRow(row: { tracking_option_ids?: unknown }): string[] {
  const raw = row.tracking_option_ids;
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => String(id || "").trim()).filter(Boolean);
}

function rowMatchesTracking(row: { tracking_option_ids?: unknown }, wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  const have = trackingIdsOnRow(row);
  return wanted.some((id) => have.includes(id));
}

/** Load platform journal_ids for Manual Journals (excluded from all cashflow paths). */
// deno-lint-ignore no-explicit-any
async function loadManualJournalIds(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string
): Promise<Set<string>> {
  const out = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("xero_journals")
      .select("journal_id, source_type, source_type_desc")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .or("source_type.eq.MANJOURNAL,source_type.eq.MANUALJOURNAL,source_type_desc.eq.ManualJournal")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.warn("[xeroJournalStatement] manual journal lookup:", error.message);
      break;
    }
    if (!data?.length) break;
    for (const row of data) {
      const jid = normId((row as { journal_id?: string }).journal_id);
      const st = (row as { source_type?: string }).source_type;
      const sd = (row as { source_type_desc?: string }).source_type_desc;
      if (jid && isManualJournalType(st, sd)) out.add(jid);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

function isBankAccountType(accountType: unknown): boolean {
  const t = String(accountType || "").trim().toUpperCase();
  return t === "BANK" || t === "CREDITCARD";
}

async function resolveTenantOrgUuid(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  mappedLegalEntityId: string | null
): Promise<string | null> {
  if (!mappedLegalEntityId?.trim()) return null;
  const { data, error } = await supabase
    .from("platform_integration_organizations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("platform_org_id", mappedLegalEntityId.trim())
    .maybeSingle();
  if (error) {
    console.warn("[xeroJournalStatement] tenant lookup:", error.message);
    return null;
  }
  return data?.id ? String(data.id) : null;
}

/** Xero PIO ids mapped to practice locations (excludes unmapped tenants like TFL). */
async function resolveMappedPracticeTenantOrgIds(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("platform_integration_organization_mapping")
    .select("platform_integration_organizations_id, platform_integration_id, location_id")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .not("location_id", "is", null);
  if (error) {
    console.warn("[xeroJournalStatement] mapped practice tenants:", error.message);
    return [];
  }
  const ids = new Set<string>();
  for (const row of data || []) {
    const id =
      (row as { platform_integration_organizations_id?: string }).platform_integration_organizations_id != null
        ? String((row as { platform_integration_organizations_id?: string }).platform_integration_organizations_id).trim()
        : "";
    if (id) ids.add(id);
  }
  return [...ids];
}

type TenantScope = { single: string | null; many: string[] | null };

function resolveTenantScope(
  tenantOrgUuid: string | null,
  tenantOrgUuids: string[] | null | undefined
): TenantScope {
  const single = tenantOrgUuid ? String(tenantOrgUuid).trim() : null;
  if (single) return { single, many: null };
  if (Array.isArray(tenantOrgUuids)) {
    return { single: null, many: tenantOrgUuids.map((id) => String(id).trim()).filter(Boolean) };
  }
  return { single: null, many: null };
}

type BankAccountMeta = {
  ids: string[];
  bankTypeById: Record<string, string>;
};

async function loadBankAccountMeta(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  tenantOrgUuid: string | null,
  tenantOrgUuids?: string[] | null
): Promise<BankAccountMeta> {
  let q = supabase
    .from("xero_chart_of_accounts")
    .select("xero_account_id, account_type, bank_account_type, xero_tenant_id")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("is_active", true);

  const scope = resolveTenantScope(tenantOrgUuid, tenantOrgUuids);
  if (scope.single) {
    q = q.eq("xero_tenant_id", scope.single);
  } else if (scope.many) {
    if (scope.many.length === 0) return { ids: [], bankTypeById: {} };
    q = q.in("xero_tenant_id", scope.many);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[xeroJournalStatement] bank COA error:", error);
    return { ids: [], bankTypeById: {} };
  }

  const idSet = new Set<string>();
  const bankTypeById: Record<string, string> = {};
  for (const r of data || []) {
    const row = r as { account_type?: string | null; bank_account_type?: string | null; xero_account_id?: string | null };
    const isBank =
      (row.bank_account_type != null && String(row.bank_account_type).trim() !== "") ||
      isBankAccountType(row.account_type);
    if (!isBank) continue;
    const id = normId(row.xero_account_id);
    if (!id || idSet.has(id)) continue;
    idSet.add(id);
    bankTypeById[id] = String(row.bank_account_type || row.account_type || "BANK").trim().toUpperCase();
  }
  return { ids: [...idSet], bankTypeById };
}

async function loadBankAccountIds(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  tenantOrgUuid: string | null
): Promise<string[]> {
  const meta = await loadBankAccountMeta(supabase, organizationId, xeroIntegrationId, tenantOrgUuid);
  return meta.ids;
}

function isCreditCardAccount(accId: string, bankTypeById: Record<string, string>): boolean {
  return bankTypeById[accId] === "CREDITCARD";
}

/**
 * Convert a stored BS amount into Total Cash contribution.
 * CREDITCARD is excluded from Xero "Total Cash at bank and in hand" — callers
 * should skip CC accounts; this returns 0 for CC for safety.
 */
function cashContributionFromBsAmount(amount: number, isCreditCard: boolean): number {
  if (isCreditCard) return 0;
  return amount;
}

/** Latest BS month-end on or before date for one cash account. */
async function getBsCashAmountOnOrBefore(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  accountId: string,
  onOrBefore: string,
  tenantOrgUuid: string | null,
  tenantOrgUuids?: string[] | null
): Promise<number | null> {
  let q = supabase
    .from("xero_balance_sheet")
    .select("amount, section")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("xero_account_id", accountId)
    .lte("to_date", onOrBefore)
    .order("to_date", { ascending: false })
    .limit(1);
  const scope = resolveTenantScope(tenantOrgUuid, tenantOrgUuids);
  if (scope.single) q = q.eq("xero_tenant_id", scope.single);
  else if (scope.many) {
    if (scope.many.length === 0) return null;
    q = q.in("xero_tenant_id", scope.many);
  }
  const { data, error } = await q;
  if (error || !data?.length) return null;
  const row = data[0] as { amount?: number; section?: string };
  // Individual account lookup already targets a bank/CC id — accept any section.
  return Number(row.amount) || 0;
}

/**
 * Credit-card lines affect Xero "Total Cash at bank and in hand" when the card
 * has a cash/bank BS balance (or a change over the period).
 *
 * Important: when the card is missing from synced BS (null open and close),
 * default to INCLUDING it — otherwise we drop real cash-at-bank cards like
 * BarclayCard (~£627) and understate opening/running balance vs Xero/Excel.
 * Only skip cards when BS explicitly shows ~£0 at both period edges.
 */
async function shouldIncludeCreditCardInRunningTotal(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  creditCardAccountIds: string[],
  fromDate: string,
  toDate: string,
  tenantOrgUuid: string | null,
  tenantOrgUuids?: string[] | null
): Promise<boolean> {
  if (creditCardAccountIds.length === 0) return false;
  let sawExplicitZeroPair = false;
  let sawMissingBs = false;
  for (const accId of creditCardAccountIds) {
    const openBs = await getBsCashAmountOnOrBefore(
      supabase,
      organizationId,
      xeroIntegrationId,
      accId,
      addDaysYmd(fromDate, -1),
      tenantOrgUuid,
      tenantOrgUuids
    );
    const closeBs = await getBsCashAmountOnOrBefore(
      supabase,
      organizationId,
      xeroIntegrationId,
      accId,
      toDate,
      tenantOrgUuid,
      tenantOrgUuids
    );
    if (openBs == null && closeBs == null) {
      sawMissingBs = true;
      continue;
    }
    const openAmt = openBs ?? 0;
    const closeAmt = closeBs ?? 0;
    if (Math.abs(closeAmt - openAmt) > 0.005 || Math.abs(closeAmt) > 0.005 || Math.abs(openAmt) > 0.005) {
      return true;
    }
    sawExplicitZeroPair = true;
  }
  // Missing BS for an active credit card → include (match Total Cash at bank).
  if (sawMissingBs) return true;
  // All cards explicitly £0 on BS at both edges → exclude from running total.
  return !sawExplicitZeroPair;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isCashBankSection(title: unknown): boolean {
  const t = String(title || "").trim().toLowerCase();
  return t.includes("cash at bank") || t === "bank" || t.includes("bank and in hand");
}

function applyTenantScopeToQuery<Q>(
  q: Q,
  tenantOrgUuid: string | null | undefined,
  tenantOrgUuids?: string[] | null
): Q {
  const scope = resolveTenantScope(tenantOrgUuid ?? null, tenantOrgUuids);
  if (scope.single) {
    return (q as { eq: (col: string, val: string) => Q }).eq(
      "platform_integration_organization_id",
      scope.single
    );
  }
  if (scope.many) {
    if (scope.many.length === 0) return q;
    return (q as { in: (col: string, val: string[]) => Q }).in(
      "platform_integration_organization_id",
      scope.many
    );
  }
  return q;
}

/** Sum journal movements on one account between inclusive dates. */
async function sumAccountJournalBetween(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  accountId: string,
  fromInclusive: string,
  toInclusive: string,
  tenantOrgUuid: string | null,
  excludeJournalIds?: Set<string> | null,
  extra?: { tenantOrgUuids?: string[] | null; trackingOptionIds?: string[] | null }
): Promise<number> {
  let sum = 0;
  let offset = 0;
  let includeTrackingCol = true;
  const trackingIds = normalizeTrackingOptionIds(extra?.trackingOptionIds);
  while (true) {
    let q = supabase
      .from("xero_journal_details")
      .select(
        includeTrackingCol
          ? "gross_amount, net_amount, platform_journal_id, tracking_option_ids"
          : "gross_amount, net_amount, platform_journal_id"
      )
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .eq("account_id", accountId)
      .gte("journal_date", fromInclusive)
      .lte("journal_date", toInclusive)
      .range(offset, offset + PAGE - 1);
    q = applyTenantScopeToQuery(q, tenantOrgUuid, extra?.tenantOrgUuids);
    q = applyTrackingOptionIdsFilter(q, trackingIds, includeTrackingCol);
    const { data, error } = await q;
    if (error) {
      if (includeTrackingCol && /tracking_option_ids/i.test(error.message || "")) {
        includeTrackingCol = false;
        offset = 0;
        sum = 0;
        continue;
      }
      break;
    }
    if (!data?.length) break;
    for (const row of data) {
      const pj = normId((row as { platform_journal_id?: string }).platform_journal_id);
      if (pj && excludeJournalIds?.has(pj)) continue;
      sum += lineAmount(row);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return sum;
}

/**
 * Opening balance anchored to synced Xero Balance Sheet (matches "Total Cash at bank and in hand"),
 * then bridged forward with journal movements from the snapshot date to the day before fromDate.
 */
async function resolveBsAnchoredOpeningBalance(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  bankAccountIds: string[],
  fromDate: string,
  tenantOrgUuid: string | null,
  log: (stage: string, meta?: Record<string, unknown>) => void,
  options?: {
    bankTypeById?: Record<string, string>;
    bridgeCreditCardJournals?: boolean;
    excludeJournalIds?: Set<string> | null;
    tenantOrgUuids?: string[] | null;
    trackingOptionIds?: string[] | null;
    /** When the first synced BS is inside the statement range (e.g. 31 Jul 2025 and fromDate is 1 Jul). */
    toDate?: string | null;
  }
): Promise<number | null> {
  const bankTypeById = options?.bankTypeById ?? {};
  const bridgeCreditCardJournals = options?.bridgeCreditCardJournals ?? true;
  const excludeJournalIds = options?.excludeJournalIds ?? null;
  const tenantOrgUuids = options?.tenantOrgUuids ?? null;
  const trackingOptionIds = normalizeTrackingOptionIds(options?.trackingOptionIds);
  const journalExtra = { tenantOrgUuids, trackingOptionIds };
  if (bankAccountIds.length === 0) return null;

  const scope = resolveTenantScope(tenantOrgUuid, tenantOrgUuids);
  if (scope.many && scope.many.length === 0) return null;

  let anchorQuery = supabase
    .from("xero_balance_sheet")
    .select("to_date")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .lt("to_date", fromDate)
    .order("to_date", { ascending: false })
    .limit(1);

  if (scope.single) {
    anchorQuery = anchorQuery.eq("xero_tenant_id", scope.single);
  } else if (scope.many) {
    anchorQuery = anchorQuery.in("xero_tenant_id", scope.many);
  }

  const { data: anchorRows, error: anchorErr } = await anchorQuery;
  if (anchorErr) {
    console.warn("[xeroJournalStatement] BS anchor lookup:", anchorErr.message);
    return null;
  }
  let anchorDate = anchorRows?.[0]?.to_date ? String(anchorRows[0].to_date).slice(0, 10) : null;
  let reverseBridge = false;

  // No snapshot before fromDate (typical when Xero sync starts in-range).
  // Use the earliest in-range month-end and subtract period journals back to fromDate.
  if (!anchorDate && options?.toDate) {
    let forwardQuery = supabase
      .from("xero_balance_sheet")
      .select("to_date")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .gte("to_date", fromDate)
      .lte("to_date", options.toDate)
      .order("to_date", { ascending: true })
      .limit(1);
    if (scope.single) {
      forwardQuery = forwardQuery.eq("xero_tenant_id", scope.single);
    } else if (scope.many) {
      forwardQuery = forwardQuery.in("xero_tenant_id", scope.many);
    }
    const { data: forwardRows } = await forwardQuery;
    const forwardDate = forwardRows?.[0]?.to_date ? String(forwardRows[0].to_date).slice(0, 10) : null;
    if (forwardDate) {
      anchorDate = forwardDate;
      reverseBridge = true;
    }
  }
  if (!anchorDate) return null;

  let bsQuery = supabase
    .from("xero_balance_sheet")
    .select("xero_account_id, amount, section")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("to_date", anchorDate);

  if (scope.single) {
    bsQuery = bsQuery.eq("xero_tenant_id", scope.single);
  } else if (scope.many) {
    bsQuery = bsQuery.in("xero_tenant_id", scope.many);
  }

  const { data: bsRows, error: bsErr } = await bsQuery;
  if (bsErr || !bsRows?.length) {
    console.warn("[xeroJournalStatement] BS rows:", bsErr?.message ?? "empty");
    return null;
  }

  const bankIdSet = new Set(bankAccountIds.map(normId).filter(Boolean));
  const bsByAccount = new Map<string, number>();
  for (const row of bsRows) {
    const accId = normId((row as { xero_account_id?: string }).xero_account_id);
    if (!accId) continue;
    const section = String((row as { section?: string }).section ?? "");
    // Include cash-section rows, and any known BANK/CREDITCARD account even if Xero
    // (or an older sync) stored it under a non-cash section label.
    if (!isCashBankSection(section) && !bankIdSet.has(accId)) continue;
    const raw = Number((row as { amount?: number }).amount) || 0;
    const isCc = isCreditCardAccount(accId, bankTypeById);
    bsByAccount.set(accId, cashContributionFromBsAmount(raw, isCc));
  }

  if (bsByAccount.size === 0) return null;

  const bridgeStart = reverseBridge ? fromDate : addDaysYmd(anchorDate, 1);
  const bridgeEnd = reverseBridge ? anchorDate : addDaysYmd(fromDate, -1);

  let totalOpening = 0;
  let missingBsBankAccounts = 0;
  for (const accId of bankAccountIds) {
    let accOpening = bsByAccount.has(accId) ? (bsByAccount.get(accId) as number) : 0;
    if (!bsByAccount.has(accId)) missingBsBankAccounts += 1;
    const isCc = isCreditCardAccount(accId, bankTypeById);
    if (bridgeStart <= bridgeEnd && (!isCc || bridgeCreditCardJournals)) {
      const movement = await sumAccountJournalBetween(
        supabase,
        organizationId,
        xeroIntegrationId,
        accId,
        bridgeStart,
        bridgeEnd,
        tenantOrgUuid,
        excludeJournalIds,
        journalExtra
      );
      accOpening = reverseBridge ? accOpening - movement : accOpening + movement;
    }
    totalOpening += accOpening;
  }

  log("opening-balance.bs-anchored", {
    anchorDate,
    reverseBridge,
    bsAccountCount: bsByAccount.size,
    bankAccountCount: bankAccountIds.length,
    missingBsBankAccounts,
    trackingOptionCount: trackingOptionIds.length,
    openingBalance: totalOpening,
  });

  return totalOpening;
}

/**
 * Closing balance anchored to synced Xero Balance Sheet (matches "Total Cash at bank and in hand"),
 * bridged forward with journal movements from the snapshot date to toDate when needed.
 */
async function resolveBsAnchoredClosingBalance(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  bankAccountIds: string[],
  toDate: string,
  tenantOrgUuid: string | null,
  log: (stage: string, meta?: Record<string, unknown>) => void,
  options?: {
    bankTypeById?: Record<string, string>;
    bridgeCreditCardJournals?: boolean;
    excludeJournalIds?: Set<string> | null;
    tenantOrgUuids?: string[] | null;
    trackingOptionIds?: string[] | null;
  }
): Promise<number | null> {
  const bankTypeById = options?.bankTypeById ?? {};
  const bridgeCreditCardJournals = options?.bridgeCreditCardJournals ?? true;
  const excludeJournalIds = options?.excludeJournalIds ?? null;
  const tenantOrgUuids = options?.tenantOrgUuids ?? null;
  if (bankAccountIds.length === 0) return null;

  const scope = resolveTenantScope(tenantOrgUuid, tenantOrgUuids);
  if (scope.many && scope.many.length === 0) return null;

  let anchorQuery = supabase
    .from("xero_balance_sheet")
    .select("to_date")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .lte("to_date", toDate)
    .order("to_date", { ascending: false })
    .limit(1);

  if (scope.single) {
    anchorQuery = anchorQuery.eq("xero_tenant_id", scope.single);
  } else if (scope.many) {
    anchorQuery = anchorQuery.in("xero_tenant_id", scope.many);
  }

  const { data: anchorRows, error: anchorErr } = await anchorQuery;
  if (anchorErr) {
    console.warn("[xeroJournalStatement] BS closing anchor lookup:", anchorErr.message);
    return null;
  }
  const anchorDate = anchorRows?.[0]?.to_date ? String(anchorRows[0].to_date).slice(0, 10) : null;
  if (!anchorDate) return null;

  let bsQuery = supabase
    .from("xero_balance_sheet")
    .select("xero_account_id, amount, section")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("to_date", anchorDate);

  if (scope.single) {
    bsQuery = bsQuery.eq("xero_tenant_id", scope.single);
  } else if (scope.many) {
    bsQuery = bsQuery.in("xero_tenant_id", scope.many);
  }

  const { data: bsRows, error: bsErr } = await bsQuery;
  if (bsErr || !bsRows?.length) {
    console.warn("[xeroJournalStatement] BS closing rows:", bsErr?.message ?? "empty");
    return null;
  }

  const bankIdSet = new Set(bankAccountIds.map(normId).filter(Boolean));
  const bsByAccount = new Map<string, number>();
  for (const row of bsRows) {
    const accId = normId((row as { xero_account_id?: string }).xero_account_id);
    if (!accId) continue;
    const section = String((row as { section?: string }).section ?? "");
    if (!isCashBankSection(section) && !bankIdSet.has(accId)) continue;
    const raw = Number((row as { amount?: number }).amount) || 0;
    const isCc = isCreditCardAccount(accId, bankTypeById);
    bsByAccount.set(accId, cashContributionFromBsAmount(raw, isCc));
  }

  if (bsByAccount.size === 0) return null;

  let totalClosing = 0;
  for (const accId of bankAccountIds) {
    totalClosing += bsByAccount.get(accId) ?? 0;
  }

  const bridgeStart = addDaysYmd(anchorDate, 1);
  if (bridgeStart <= toDate) {
    for (const accId of bankAccountIds) {
      const isCc = isCreditCardAccount(accId, bankTypeById);
      if (isCc && !bridgeCreditCardJournals) continue;
      totalClosing += await sumAccountJournalBetween(
        supabase,
        organizationId,
        xeroIntegrationId,
        accId,
        bridgeStart,
        toDate,
        tenantOrgUuid,
        excludeJournalIds,
        { tenantOrgUuids, trackingOptionIds: options?.trackingOptionIds }
      );
    }
  }

  log("closing-balance.bs-anchored", {
    anchorDate,
    bsAccountCount: bsByAccount.size,
    bankAccountCount: bankAccountIds.length,
    closingBalance: totalClosing,
    bridgedFrom: bridgeStart <= toDate ? bridgeStart : null,
  });

  return totalClosing;
}

/** Sum signed bank movements before fromDate (journal-only fallback). */
// deno-lint-ignore no-explicit-any
export async function sumXeroJournalBankOpeningBalance(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  bankAccountIds: string[],
  fromDate: string,
  tenantOrgUuid: string | null,
  excludeJournalIds?: Set<string> | null,
  tenantOrgUuids?: string[] | null,
  trackingOptionIds?: string[] | null
): Promise<number> {
  if (bankAccountIds.length === 0) return 0;

  let sum = 0;
  let includeTrackingCol = true;
  const trackingIds = normalizeTrackingOptionIds(trackingOptionIds);
  for (let i = 0; i < bankAccountIds.length; i += IN_CHUNK) {
    const part = bankAccountIds.slice(i, i + IN_CHUNK);
    let offset = 0;
    while (true) {
      let q = supabase
        .from("xero_journal_details")
        .select(
          includeTrackingCol
            ? "gross_amount, net_amount, platform_journal_id, tracking_option_ids"
            : "gross_amount, net_amount, platform_journal_id"
        )
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", xeroIntegrationId)
        .in("account_id", part)
        .lt("journal_date", fromDate)
        .range(offset, offset + PAGE - 1);

      q = applyTenantScopeToQuery(q, tenantOrgUuid, tenantOrgUuids);
      q = applyTrackingOptionIdsFilter(q, trackingIds, includeTrackingCol);

      const { data, error } = await q;
      if (error) {
        if (includeTrackingCol && /tracking_option_ids/i.test(error.message || "")) {
          includeTrackingCol = false;
          i = -IN_CHUNK;
          offset = 0;
          sum = 0;
          break;
        }
        console.warn("[xeroJournalStatement] opening balance chunk:", error.message);
        break;
      }
      if (!data?.length) break;
      for (const row of data) {
        const pj = normId((row as { platform_journal_id?: string }).platform_journal_id);
        if (pj && excludeJournalIds?.has(pj)) continue;
        sum += lineAmount(row);
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }
  return sum;
}

/** Opening balance for bank-feed fallback when journal lines exist but bank feed is used for rows. */
// deno-lint-ignore no-explicit-any
export async function resolveXeroBankOpeningBalanceForStatement(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  fromDate: string,
  mappedLegalEntityId: string | null
): Promise<number> {
  const tenantOrgUuid = await resolveTenantOrgUuid(
    supabase,
    organizationId,
    xeroIntegrationId,
    mappedLegalEntityId
  );
  const bankAccountIds = await loadBankAccountIds(
    supabase,
    organizationId,
    xeroIntegrationId,
    tenantOrgUuid
  );
  if (bankAccountIds.length === 0) return 0;

  const manualJournalIds = await loadManualJournalIds(supabase, organizationId, xeroIntegrationId);

  const bsOpening = await resolveBsAnchoredOpeningBalance(
    supabase,
    organizationId,
    xeroIntegrationId,
    bankAccountIds,
    fromDate,
    tenantOrgUuid,
    () => {},
    { excludeJournalIds: manualJournalIds }
  );
  if (bsOpening != null) return bsOpening;

  return sumXeroJournalBankOpeningBalance(
    supabase,
    organizationId,
    xeroIntegrationId,
    bankAccountIds,
    fromDate,
    tenantOrgUuid,
    manualJournalIds
  );
}

/** Closing balance for statement footer — BS-anchored when snapshots exist. */
// deno-lint-ignore no-explicit-any
export async function resolveXeroBankClosingBalanceForStatement(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  fromDate: string,
  toDate: string,
  mappedLegalEntityId: string | null,
  log: (stage: string, meta?: Record<string, unknown>) => void = () => {},
    extra?: {
      trackingOptionIds?: string[] | null;
      locationId?: string | null;
      optionScopes?: XeroTrackingOptionScope[] | null;
    }
): Promise<number | null> {
  const liveClosing = extra?.optionScopes?.length
    ? await fetchLiveXeroTrackingCashTotal(
        organizationId,
        xeroIntegrationId,
        toDate,
        extra.optionScopes
      )
    : null;
  if (liveClosing != null) return liveClosing;
  // Tracking-mapped locations must not fall back to unscoped org BS cash.
  if (extra?.optionScopes?.length) {
    log("closing-balance.live-tracking-unavailable", {
      toDate,
      optionScopeCount: extra.optionScopes.length,
    });
    return null;
  }
  const tenantOrgUuid = await resolveTenantOrgUuid(
    supabase,
    organizationId,
    xeroIntegrationId,
    mappedLegalEntityId
  );
  const trackingOptionIds = normalizeTrackingOptionIds(extra?.trackingOptionIds);
  const { ids: bankAccountIds, bankTypeById } = await loadBankAccountMeta(
    supabase,
    organizationId,
    xeroIntegrationId,
    tenantOrgUuid
  );
  if (bankAccountIds.length === 0) return null;

  const setupBankAccountIds = trackingOptionIds.length
    ? await loadSetupBankAccountIds(supabase, organizationId, {
        locationId: extra?.locationId || null,
        platformIntegrationId: xeroIntegrationId,
      })
    : [];
  const closingAccountIds =
    trackingOptionIds.length > 0 && setupBankAccountIds.length > 0
      ? setupBankAccountIds
      : bankAccountIds;

  const manualJournalIds = await loadManualJournalIds(supabase, organizationId, xeroIntegrationId);
  const creditCardAccountIds = closingAccountIds.filter((id) => isCreditCardAccount(id, bankTypeById));
  const includeCreditCardInTotal = await shouldIncludeCreditCardInRunningTotal(
    supabase,
    organizationId,
    xeroIntegrationId,
    creditCardAccountIds,
    fromDate,
    toDate,
    tenantOrgUuid
  );

  return resolveBsAnchoredClosingBalance(
    supabase,
    organizationId,
    xeroIntegrationId,
    closingAccountIds,
    toDate,
    tenantOrgUuid,
    log,
    {
      bankTypeById,
      bridgeCreditCardJournals: includeCreditCardInTotal,
      excludeJournalIds: manualJournalIds,
      trackingOptionIds,
    }
  );
}

type JournalDetailRow = Record<string, unknown>;
export type StatementTxnRow = Record<string, unknown>;

function buildSplitLabel(params: {
  siblingRows: JournalDetailRow[];
  bankAccountIdSet: Set<string>;
  accountNameById: Record<string, string>;
}): string {
  const { siblingRows, bankAccountIdSet, accountNameById } = params;
  const labels: string[] = [];
  for (const r of siblingRows) {
    const accId = normId(r.account_id);
    if (!accId || bankAccountIdSet.has(accId)) continue;
    const name = accountNameById[accId] || String(r.account_name || r.account_code || "").trim();
    if (name) labels.push(name);
  }
  const unique = [...new Set(labels)];
  return unique.length > 0 ? unique.join(", ") : "Bank";
}

// deno-lint-ignore no-explicit-any
export async function tryLoadXeroJournalBankStatement(
  supabase: SupabaseClient<any>,
  params: {
    organizationId: string;
    xeroIntegrationId: string;
    fromDate: string;
    toDate: string;
    mappedLegalEntityId: string | null;
    log: (stage: string, meta?: Record<string, unknown>) => void;
    trackingOptionIds?: string[] | null;
    locationId?: string | null;
    optionScopes?: XeroTrackingOptionScope[] | null;
  }
): Promise<{ list: StatementTxnRow[]; rows: JournalDetailRow[] } | null> {
  const {
    organizationId,
    xeroIntegrationId,
    fromDate,
    toDate,
    mappedLegalEntityId,
    log,
    locationId,
  } = params;
  const trackingOptionIds = normalizeTrackingOptionIds(params.trackingOptionIds);
  const optionScopes = params.optionScopes || [];

  const tenantOrgUuid = await resolveTenantOrgUuid(
    supabase,
    organizationId,
    xeroIntegrationId,
    mappedLegalEntityId
  );
  const tenantOrgUuids =
    !tenantOrgUuid && !mappedLegalEntityId
      ? await resolveMappedPracticeTenantOrgIds(supabase, organizationId, xeroIntegrationId)
      : null;
  if (!tenantOrgUuid && Array.isArray(tenantOrgUuids) && tenantOrgUuids.length === 0) {
    log("xero-journals.skip", { reason: "no_mapped_practice_tenants" });
    return null;
  }
  log("xero-journals.tenant-scope", {
    tenantOrgUuid,
    mappedPracticeTenantCount: tenantOrgUuids?.length ?? null,
    trackingOptionCount: trackingOptionIds.length,
    locationId: locationId || "all",
  });

  const { ids: bankAccountIds, bankTypeById } = await loadBankAccountMeta(
    supabase,
    organizationId,
    xeroIntegrationId,
    tenantOrgUuid,
    tenantOrgUuids
  );
  if (bankAccountIds.length === 0) {
    log("xero-journals.skip", { reason: "no_bank_accounts_in_coa" });
    return null;
  }

  const creditCardAccountIds = bankAccountIds.filter((id) => isCreditCardAccount(id, bankTypeById));
  const includeCreditCardInTotal = await shouldIncludeCreditCardInRunningTotal(
    supabase,
    organizationId,
    xeroIntegrationId,
    creditCardAccountIds,
    fromDate,
    toDate,
    tenantOrgUuid,
    tenantOrgUuids
  );
  const manualJournalIds = await loadManualJournalIds(supabase, organizationId, xeroIntegrationId);
  log("manual-journal.exclude", { count: manualJournalIds.size });

  const bankAccountIdSet = new Set(bankAccountIds);
  const accountNameById: Record<string, string> = {};

  {
    for (let i = 0; i < bankAccountIds.length; i += IN_CHUNK) {
      const part = bankAccountIds.slice(i, i + IN_CHUNK);
      const { data: coaRows } = await supabase
        .from("xero_chart_of_accounts")
        .select("xero_account_id, account_name, account_code")
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", xeroIntegrationId)
        .in("xero_account_id", part);
      for (const r of coaRows || []) {
        const id = normId((r as { xero_account_id?: string }).xero_account_id);
        const nm = String((r as { account_name?: string }).account_name || (r as { account_code?: string }).account_code || "").trim();
        if (id && nm) accountNameById[id] = nm;
      }
    }
  }

  const inRangeRows: JournalDetailRow[] = [];
  let includeTrackingCol = true;
  for (let i = 0; i < bankAccountIds.length; i += IN_CHUNK) {
    const part = bankAccountIds.slice(i, i + IN_CHUNK);
    let offset = 0;
    while (true) {
      const baseSelect =
        "id, journal_id, platform_journal_id, journal_date, account_id, account_code, account_name, account_type, description, net_amount, gross_amount, journal_line_id, platform_integration_organization_id";
      let q = supabase
        .from("xero_journal_details")
        .select(includeTrackingCol ? `${baseSelect}, tracking_option_ids` : baseSelect)
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", xeroIntegrationId)
        .in("account_id", part)
        .gte("journal_date", fromDate)
        .lte("journal_date", toDate)
        .order("journal_date", { ascending: true })
        .order("journal_line_id", { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (tenantOrgUuid) {
        q = q.eq("platform_integration_organization_id", tenantOrgUuid);
      } else if (tenantOrgUuids && tenantOrgUuids.length > 0) {
        q = q.in("platform_integration_organization_id", tenantOrgUuids);
      } else if (tenantOrgUuids && tenantOrgUuids.length === 0) {
        break;
      }

      const { data, error } = await q;
      if (error) {
        if (includeTrackingCol && /tracking_option_ids/i.test(error.message || "")) {
          log("xero-journals.tracking-col-missing", { message: error.message });
          includeTrackingCol = false;
          inRangeRows.length = 0;
          i = -IN_CHUNK;
          break;
        }
        console.error("[xeroJournalStatement] in-range lines:", error.message);
        break;
      }
      if (!data?.length) break;
      for (const row of data as JournalDetailRow[]) {
        const pj = normId(row.platform_journal_id);
        if (pj && manualJournalIds.has(pj)) continue;
        inRangeRows.push(row);
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  if (inRangeRows.length === 0) {
    if (trackingOptionIds.length > 0 || optionScopes.length > 0) {
      log("xero-journals.empty-in-range-tracking", {
        bankAccountCount: bankAccountIds.length,
        trackingOptionCount: trackingOptionIds.length,
      });
      return { list: [], rows: [] };
    }
    log("xero-journals.skip", { reason: "no_bank_journal_lines_in_range", bankAccountCount: bankAccountIds.length });
    return null;
  }

  const platformJournalIds = [
    ...new Set(inRangeRows.map((r) => normId(r.platform_journal_id)).filter(Boolean)),
  ] as string[];

  const journalHeaderByPlatformId = new Map<string, Record<string, unknown>>();
  const journalHeaderByUuid = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < platformJournalIds.length; i += IN_CHUNK) {
    const chunk = platformJournalIds.slice(i, i + IN_CHUNK);
    const { data: headers, error: hErr } = await supabase
      .from("xero_journals")
      .select("id, journal_id, source_type, source_type_desc, source_id, reference, contact_name, journal_date")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .in("journal_id", chunk);
    if (hErr) {
      console.error("[xeroJournalStatement] journal headers:", hErr.message);
      continue;
    }
    for (const h of headers || []) {
      const jid = normId((h as { journal_id?: string }).journal_id);
      const uuid = normId((h as { id?: string }).id);
      if (jid) journalHeaderByPlatformId.set(jid, h as Record<string, unknown>);
      if (uuid) journalHeaderByUuid.set(uuid, h as Record<string, unknown>);
    }
  }

  const siblingsByPlatformJournalId = new Map<string, JournalDetailRow[]>();
  for (let i = 0; i < platformJournalIds.length; i += IN_CHUNK) {
    const chunk = platformJournalIds.slice(i, i + IN_CHUNK);
    let offset = 0;
    while (true) {
      let q = supabase
        .from("xero_journal_details")
        .select(
          includeTrackingCol
            ? "platform_journal_id, account_id, account_code, account_name, account_type, description, tracking_option_ids"
            : "platform_journal_id, account_id, account_code, account_name, account_type, description"
        )
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", xeroIntegrationId)
        .in("platform_journal_id", chunk)
        .range(offset, offset + PAGE - 1);
      if (tenantOrgUuid) {
        q = q.eq("platform_integration_organization_id", tenantOrgUuid);
      }
      const { data, error } = await q;
      if (error) {
        if (includeTrackingCol && /tracking_option_ids/i.test(error.message || "")) {
          includeTrackingCol = false;
          siblingsByPlatformJournalId.clear();
          i = -IN_CHUNK;
          break;
        }
        break;
      }
      if (!data?.length) break;
      for (const row of data as JournalDetailRow[]) {
        const pjId = normId(row.platform_journal_id);
        if (!pjId) continue;
        const existing = siblingsByPlatformJournalId.get(pjId) ?? [];
        existing.push(row);
        siblingsByPlatformJournalId.set(pjId, existing);
        const accId = normId(row.account_id);
        const nm = String(row.account_name || row.account_code || "").trim();
        if (accId && nm && !accountNameById[accId]) accountNameById[accId] = nm;
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  if (trackingOptionIds.length > 0 && includeTrackingCol) {
    const before = inRangeRows.length;
    const kept: JournalDetailRow[] = [];
    for (const row of inRangeRows) {
      const pjId = normId(row.platform_journal_id);
      const siblings = (pjId && siblingsByPlatformJournalId.get(pjId)) || [];
      if (rowMatchesTracking(row, trackingOptionIds)) {
        kept.push(row);
        continue;
      }
      if (siblings.some((s) => rowMatchesTracking(s, trackingOptionIds))) {
        kept.push(row);
      }
    }
    inRangeRows.length = 0;
    inRangeRows.push(...kept);
    log("xero-journals.tracking-sibling-filter", {
      before,
      after: inRangeRows.length,
      trackingOptionCount: trackingOptionIds.length,
    });
    if (inRangeRows.length === 0) {
      log("xero-journals.empty-after-tracking", { trackingOptionCount: trackingOptionIds.length });
      return { list: [], rows: [] };
    }
  }

  const setupBankAccountIds = await loadSetupBankAccountIds(supabase, organizationId, {
    locationId: locationId || null,
    platformIntegrationId: xeroIntegrationId,
  });
  const inRangeBankIds = [
    ...new Set(inRangeRows.map((r) => normId(r.account_id)).filter(Boolean)),
  ];
  // When tracking is applied, do not open/close on the whole tenant cash total.
  // Prefer Setup Categories → Bank, else the bank accounts that actually moved.
  const cashAccountIds =
    trackingOptionIds.length > 0
      ? [...new Set([...setupBankAccountIds, ...inRangeBankIds].map(normId).filter(Boolean))]
      : bankAccountIds;
  const openingAccountIds = cashAccountIds.length > 0 ? cashAccountIds : bankAccountIds;

  const liveOpening =
    optionScopes.length > 0
      ? await fetchLiveXeroTrackingCashTotal(
          organizationId,
          xeroIntegrationId,
          addDaysYmd(fromDate, -1),
          optionScopes
        )
      : null;
  const liveClosing =
    optionScopes.length > 0
      ? await fetchLiveXeroTrackingCashTotal(
          organizationId,
          xeroIntegrationId,
          toDate,
          optionScopes
        )
      : null;
  log("opening-balance.live-tracking-cash", {
    liveOpening,
    liveClosing,
    asAtOpening: addDaysYmd(fromDate, -1),
    asAtClosing: toDate,
    optionScopeCount: optionScopes.length,
  });

  let openingBalance =
    liveOpening != null
      ? liveOpening
      : optionScopes.length > 0
        ? null
        : await resolveBsAnchoredOpeningBalance(
    supabase,
    organizationId,
    xeroIntegrationId,
    openingAccountIds,
    fromDate,
    tenantOrgUuid,
    log,
    {
      bankTypeById,
      bridgeCreditCardJournals: includeCreditCardInTotal,
      excludeJournalIds: manualJournalIds,
      tenantOrgUuids,
      trackingOptionIds,
      toDate,
    }
  );
  if (openingBalance == null) {
    openingBalance = await sumXeroJournalBankOpeningBalance(
      supabase,
      organizationId,
      xeroIntegrationId,
      openingAccountIds,
      fromDate,
      tenantOrgUuid,
      manualJournalIds,
      tenantOrgUuids,
      trackingOptionIds
    );
    log("opening-balance.calculated.journals-only-fallback", { openingBalance });
  }

  log("running-balance.credit-card-policy", {
    includeCreditCardInTotal,
    creditCardAccountCount: creditCardAccountIds.length,
  });

  // Pure bank↔bank / bank↔card journals (no non-bank sibling) have no consolidated cash effect.
  const pureBankTransferJournalIds = new Set<string>();
  for (const [pjId, siblings] of siblingsByPlatformJournalId.entries()) {
    if (siblings.length < 2) continue;
    let bankLegs = 0;
    let nonBankLegs = 0;
    for (const s of siblings) {
      const sid = normId(s.account_id);
      if (!sid) continue;
      if (bankAccountIdSet.has(sid) || isBankAccountType(s.account_type)) bankLegs++;
      else nonBankLegs++;
    }
    if (bankLegs >= 2 && nonBankLegs === 0) pureBankTransferJournalIds.add(pjId);
  }

  const cashEffectCandidates = inRangeRows.map((row, idx) => {
    const platformJournalId = normId(row.platform_journal_id);
    return {
      key: String(row.id || `${platformJournalId}:${idx}`),
      date: String(row.journal_date || "").slice(0, 10),
      amount: lineAmount(row),
      description: String(row.description || "").trim(),
      platformJournalId,
      row,
      idx,
    };
  });

  const cashEffectKeys = selectCashEffectKeys(cashEffectCandidates);
  const cashEffectRows = cashEffectCandidates
    .filter((c) => {
      if (c.platformJournalId && pureBankTransferJournalIds.has(c.platformJournalId)) return false;
      return cashEffectKeys.has(c.key);
    })
    .map((c) => c.row);

  log("cash-effect.filter", {
    before: inRangeRows.length,
    after: cashEffectRows.length,
    dropped: inRangeRows.length - cashEffectRows.length,
    pureBankTransferJournals: pureBankTransferJournalIds.size,
  });

  const currencySym = "£";
  let runningBalance = openingBalance;

  const list: StatementTxnRow[] = cashEffectRows.map((row) => {
    const amount = lineAmount(row);
    const debitNum = amount > 0 ? Math.abs(amount) : 0;
    const creditNum = amount < 0 ? Math.abs(amount) : 0;

    const bankAccId = normId(row.account_id);
    const isCcLine = bankAccId ? isCreditCardAccount(bankAccId, bankTypeById) : false;
    if (!isCcLine || includeCreditCardInTotal) {
      runningBalance += amount;
    }

    const platformJournalId = normId(row.platform_journal_id);
    const journalUuid = normId(row.journal_id);
    const header =
      (platformJournalId && journalHeaderByPlatformId.get(platformJournalId)) ||
      (journalUuid && journalHeaderByUuid.get(journalUuid)) ||
      null;

    const sourceType = String(header?.source_type || "").trim();
    const transactionType =
      String(header?.source_type_desc || sourceType || row.account_type || "").trim() || "Bank";

    const linkId =
      String(header?.source_id || "").trim() ||
      (normTypeKey(sourceType) === "MANUALJOURNAL" ? String(platformJournalId || "") : "");
    const transactionLink = getXeroTransactionLink(sourceType || transactionType, linkId);

    const rawDesc = String(row.description || header?.reference || "").trim();
    const displayName = rawDesc || "—";

    const location =
      (bankAccId && accountNameById[bankAccId]) ||
      String(row.account_name || row.account_code || "").trim() ||
      "—";

    const siblingRows = (platformJournalId && siblingsByPlatformJournalId.get(platformJournalId)) || [row];
    const splitLabel = buildSplitLabel({ siblingRows, bankAccountIdSet, accountNameById });

    const memo = String(row.description || "").trim();
    const effectiveDate = String(row.journal_date || header?.journal_date || "");

    return {
      id: String(row.id),
      date: formatDate(effectiveDate),
      transactionType,
      transactionLink,
      name: displayName,
      memoOrDescription: memo,
      location: String(location),
      split: splitLabel,
      debit: debitNum > 0 ? formatMoney(debitNum, currencySym) : "–",
      credit: creditNum > 0 ? formatMoney(creditNum, currencySym) : "–",
      balance: formatMoney(runningBalance, currencySym),
      _debitNum: debitNum,
      _creditNum: creditNum,
      _balanceNum: runningBalance,
      _nameLower: displayName.toLowerCase(),
      _memoLower: memo.toLowerCase(),
    };
  });

  const bsClosing =
    liveClosing != null
      ? liveClosing
      : optionScopes.length > 0
        ? null
        : await resolveBsAnchoredClosingBalance(
    supabase,
    organizationId,
    xeroIntegrationId,
    openingAccountIds,
    toDate,
    tenantOrgUuid,
    log,
    {
      bankTypeById,
      bridgeCreditCardJournals: includeCreditCardInTotal,
      excludeJournalIds: manualJournalIds,
      tenantOrgUuids,
      trackingOptionIds,
    }
  );

  // Rebase running balances onto Xero BS "Total Cash at bank and in hand".
  // Period bank journals already reconcile to BS month-ends; any constant drift
  // (e.g. ~£80 opening offset) is removed so the end-date row matches Xero.
  if (bsClosing != null && list.length > 0) {
    const last = Number(list[list.length - 1]._balanceNum) || 0;
    const drift = Math.round((last - bsClosing) * 100) / 100;
    if (Math.abs(drift) >= 0.005) {
      log("running-balance.rebase-to-bs", {
        lastBefore: last,
        bsClosing,
        drift,
        openingBefore: openingBalance,
        openingAfter: Math.round((openingBalance - drift) * 100) / 100,
      });
      rebaseStatementRunningBalances(list, bsClosing, currencySym);
    }
  }

  log("rows.mapped.xero-journals", {
    mappedCount: list.length,
    openingBalance,
    bsClosing,
    includeCreditCardInTotal,
    firstBalance: list[0]?._balanceNum ?? null,
    lastBalance: list[list.length - 1]?._balanceNum ?? null,
  });

  return { list, rows: cashEffectRows };
}
