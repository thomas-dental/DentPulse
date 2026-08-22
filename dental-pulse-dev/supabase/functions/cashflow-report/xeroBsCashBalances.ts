/**
 * Xero Balance Sheet month-end totals for cashflow Opening/Closing.
 *
 * Preferred source: Setup Categories → Bank account selection
 * (`category_range_map` where master range_group = 'Bank'). Closing = sum of
 * those accounts' BS amounts (as stored), including CREDITCARD when mapped.
 *
 * Fallback (no Bank setup yet): cash-section / BANK COA lines, excluding
 * CREDITCARD (matches Xero "Total Cash at bank and in hand").
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAGE = 1000;

function isCashBankSection(title: unknown): boolean {
  const t = String(title || "").trim().toLowerCase();
  return t.includes("cash at bank") || t === "bank" || t.includes("bank and in hand");
}

/** Convert a stored BS amount into Total Cash contribution (legacy fallback). */
export function cashContributionFromBsAmount(
  amount: number,
  isCreditCard: boolean
): number {
  if (isCreditCard) return 0;
  return amount;
}

/**
 * Account ids mapped under Setup Categories → Bank for a location (or all
 * practice locations when locationId is null).
 * `category_range_map.location_id` stores the COA / Xero account id.
 */
export async function loadSetupBankAccountIds(
  supabase: SupabaseClient<any>,
  organizationId: string,
  options?: {
    locationId?: string | null;
    platformIntegrationId?: string | null;
  }
): Promise<string[]> {
  const { data: bankMaster, error: masterErr } = await supabase
    .from("category_range_master")
    .select("id")
    .eq("range_group", "Bank")
    .limit(1)
    .maybeSingle();
  if (masterErr || !bankMaster?.id) {
    if (masterErr) console.warn("[cashflow-report] Bank category master:", masterErr.message);
    return [];
  }

  let q = supabase
    .from("category_range_map")
    .select("location_id")
    .eq("organization_id", organizationId)
    .eq("category_range_id", bankMaster.id);

  if (options?.platformIntegrationId) {
    q = q.eq("platform_integration_id", options.platformIntegrationId);
  }

  if (options?.locationId) {
    q = q.eq("mapping_location_id", options.locationId);
  } else {
    q = q.not("mapping_location_id", "is", null);
  }

  const { data, error } = await q;
  if (error) {
    console.warn("[cashflow-report] Setup Bank maps:", error.message);
    return [];
  }

  const ids = new Set<string>();
  for (const row of data || []) {
    const id = String((row as { location_id?: string }).location_id || "").trim();
    if (id) ids.add(id);
  }

  // Single location with no override → connection-level Bank maps (mapping_location_id null)
  if (ids.size === 0 && options?.locationId) {
    let fb = supabase
      .from("category_range_map")
      .select("location_id")
      .eq("organization_id", organizationId)
      .eq("category_range_id", bankMaster.id)
      .is("mapping_location_id", null);
    if (options?.platformIntegrationId) {
      fb = fb.or(
        `platform_integration_id.eq.${options.platformIntegrationId},platform_integration_id.is.null`
      );
    }
    const { data: fbRows, error: fbErr } = await fb;
    if (fbErr) {
      console.warn("[cashflow-report] Setup Bank connection fallback:", fbErr.message);
    } else {
      for (const row of fbRows || []) {
        const id = String((row as { location_id?: string }).location_id || "").trim();
        if (id) ids.add(id);
      }
    }
  }

  console.log("[cashflow-report] Setup Categories Bank accounts", {
    locationId: options?.locationId || "all",
    count: ids.size,
    ids: [...ids],
  });
  return [...ids];
}

/** Month key YYYY-MM → calendar month-end YYYY-MM-DD. */
export function monthKeyToEndDate(monthKey: string): string {
  const [yStr, mStr] = monthKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return monthKey;
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** Month key YYYY-MM → prior month-end YYYY-MM-DD. */
export function priorMonthEndDate(monthKey: string): string {
  const [yStr, mStr] = monthKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return monthKey;
  const d = new Date(Date.UTC(y, m - 1, 0));
  return d.toISOString().slice(0, 10);
}

export async function resolveXeroTenantOrgUuid(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  mappedPlatformOrgId: string | null
): Promise<string | null> {
  if (!mappedPlatformOrgId?.trim()) return null;
  const { data, error } = await supabase
    .from("platform_integration_organizations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("platform_org_id", mappedPlatformOrgId.trim())
    .maybeSingle();
  if (error) {
    console.warn("[cashflow-report] tenant lookup:", error.message);
    return null;
  }
  return data?.id ? String(data.id) : null;
}

/**
 * PIO row ids for Xero tenants mapped to at least one practice location.
 * Uses mapping table columns directly (avoids nested-join shape issues).
 */
export async function resolveMappedPracticeXeroTenantOrgIds(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("platform_integration_organization_mapping")
    .select(`
      platform_integration_organizations_id,
      platform_integration_id,
      location_id,
      practice_locations!inner ( exclude_from_financial_display )
    `)
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .not("location_id", "is", null);

  if (error) {
    console.warn("[cashflow-report] mapped practice tenants:", error.message);
    // Fallback without join if inner join shape fails
    const { data: fallback, error: fbErr } = await supabase
      .from("platform_integration_organization_mapping")
      .select("platform_integration_organizations_id, location_id")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .not("location_id", "is", null);
    if (fbErr || !fallback) return [];
    const { data: hiddenLocs } = await supabase
      .from("practice_locations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("exclude_from_financial_display", true);
    const hidden = new Set((hiddenLocs || []).map((l: { id: string }) => String(l.id)));
    const ids = new Set<string>();
    for (const row of fallback) {
      if (hidden.has(String(row.location_id))) continue;
      const id = row.platform_integration_organizations_id
        ? String(row.platform_integration_organizations_id).trim()
        : "";
      if (id) ids.add(id);
    }
    return [...ids];
  }

  const ids = new Set<string>();
  for (const row of data || []) {
    const loc = (row as any).practice_locations;
    if (loc?.exclude_from_financial_display) continue;
    const id =
      (row as { platform_integration_organizations_id?: string }).platform_integration_organizations_id != null
        ? String((row as { platform_integration_organizations_id?: string }).platform_integration_organizations_id).trim()
        : "";
    if (id) ids.add(id);
  }

  console.log("[cashflow-report] mapped practice Xero tenants", {
    xeroIntegrationId,
    count: ids.size,
    ids: [...ids],
  });
  return [...ids];
}

/** BANK / CREDITCARD account ids for the given tenant scope. */
async function loadBankAndCreditCardAccountIds(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  tenantOrgIds: string[]
): Promise<{ bankIds: Set<string>; creditCardIds: Set<string> }> {
  const bankIds = new Set<string>();
  const creditCardIds = new Set<string>();
  if (tenantOrgIds.length === 0) return { bankIds, creditCardIds };

  const { data, error } = await supabase
    .from("xero_chart_of_accounts")
    .select("xero_account_id, account_type, bank_account_type, xero_tenant_id")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("is_active", true)
    .in("xero_tenant_id", tenantOrgIds);

  if (error) {
    console.warn("[cashflow-report] bank/CC COA:", error.message);
    return { bankIds, creditCardIds };
  }

  for (const row of data || []) {
    const id = String((row as { xero_account_id?: string }).xero_account_id || "").trim();
    if (!id) continue;
    const accType = String((row as { account_type?: string }).account_type || "").trim().toUpperCase();
    const bankType = String((row as { bank_account_type?: string }).bank_account_type || "").trim().toUpperCase();
    const isBank =
      !!bankType || accType === "BANK" || accType === "CREDITCARD";
    if (!isBank) continue;
    bankIds.add(id);
    if (bankType === "CREDITCARD" || accType === "CREDITCARD") creditCardIds.add(id);
  }
  return { bankIds, creditCardIds };
}

async function sumJournalMovementsBetween(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  accountId: string,
  fromExclusive: string | null,
  toInclusive: string,
  tenantOrgIds: string[]
): Promise<number> {
  let sum = 0;
  let offset = 0;
  while (true) {
    let q = supabase
      .from("xero_journal_details")
      .select("gross_amount, net_amount")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .eq("account_id", accountId)
      .lte("journal_date", toInclusive)
      .range(offset, offset + PAGE - 1);
    if (fromExclusive) q = q.gt("journal_date", fromExclusive);
    if (tenantOrgIds.length === 1) {
      q = q.eq("platform_integration_organization_id", tenantOrgIds[0]);
    } else if (tenantOrgIds.length > 1) {
      q = q.in("platform_integration_organization_id", tenantOrgIds);
    }
    const { data, error } = await q;
    if (error || !data?.length) break;
    for (const row of data) {
      const gross = (row as { gross_amount?: unknown }).gross_amount;
      const net = (row as { net_amount?: unknown }).net_amount;
      const amt =
        gross != null && gross !== "" && !Number.isNaN(Number(gross))
          ? Number(gross)
          : Number(net) || 0;
      sum += amt;
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return sum;
}

/**
 * Latest BS amount for an account on or before a date (any section).
 * Returns { amount, toDate } or null.
 */
async function latestBsAmountOnOrBefore(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  accountId: string,
  onOrBefore: string,
  tenantOrgIds: string[]
): Promise<{ amount: number; toDate: string } | null> {
  let q = supabase
    .from("xero_balance_sheet")
    .select("amount, to_date")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("xero_account_id", accountId)
    .lte("to_date", onOrBefore)
    .order("to_date", { ascending: false })
    .limit(1);
  if (tenantOrgIds.length === 1) q = q.eq("xero_tenant_id", tenantOrgIds[0]);
  else if (tenantOrgIds.length > 1) q = q.in("xero_tenant_id", tenantOrgIds);

  const { data, error } = await q;
  if (error || !data?.length) return null;
  const row = data[0] as { amount?: number; to_date?: string };
  const toDate = String(row.to_date || "").slice(0, 10);
  if (!toDate) return null;
  return { amount: Number(row.amount) || 0, toDate };
}

/**
 * Sum of month-end balances for cashflow Opening/Closing.
 * When `setupBankAccountIds` is provided (Setup Categories → Bank), only those
 * accounts are summed (amounts as stored on BS, including mapped cards).
 * Otherwise falls back to Xero Total Cash (cash section / BANK COA, no CC).
 */
export async function loadXeroBsCashTotalsByMonthEnd(
  supabase: SupabaseClient<any>,
  params: {
    organizationId: string;
    xeroIntegrationId: string;
    monthEndDates: string[];
    /** Single tenant (location filter). */
    tenantOrgUuid?: string | null;
    /**
     * All Locations: restrict to these mapped practice tenants.
     * When provided (even empty), never falls back to unscoped all-tenants sum.
     */
    tenantOrgUuids?: string[] | null;
    /** Setup Categories → Bank account ids (preferred Closing source). */
    setupBankAccountIds?: string[] | null;
  }
): Promise<Map<string, number>> {
  const { organizationId, xeroIntegrationId, monthEndDates } = params;
  const out = new Map<string, number>();
  if (monthEndDates.length === 0) return out;

  const single = params.tenantOrgUuid ? String(params.tenantOrgUuid).trim() : "";
  const many = (params.tenantOrgUuids || []).map((id) => String(id).trim()).filter(Boolean);
  const useMany = Array.isArray(params.tenantOrgUuids);
  if (useMany && many.length === 0) {
    console.warn("[cashflow-report] BS load skipped: no mapped practice Xero tenants for All Locations");
    return out;
  }

  const tenantOrgIds = single ? [single] : useMany ? many : [];
  const setupBankIds = [...new Set(
    (params.setupBankAccountIds || []).map((id) => String(id).trim()).filter(Boolean)
  )];
  const useSetupBank = setupBankIds.length > 0;

  const { bankIds, creditCardIds } = useSetupBank
    ? { bankIds: new Set<string>(), creditCardIds: new Set<string>() }
    : await loadBankAndCreditCardAccountIds(
        supabase,
        organizationId,
        xeroIntegrationId,
        tenantOrgIds.length > 0
          ? tenantOrgIds
          : (
              await supabase
                .from("platform_integration_organizations")
                .select("id")
                .eq("organization_id", organizationId)
                .eq("platform_integration_id", xeroIntegrationId)
            ).data?.map((r: { id: string }) => String(r.id)) || []
      );

  let q = supabase
    .from("xero_balance_sheet")
    .select("to_date, amount, section, xero_account_id")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .in("to_date", monthEndDates);

  if (useSetupBank) {
    q = q.in("xero_account_id", setupBankIds);
  }

  if (single) {
    q = q.eq("xero_tenant_id", single);
  } else if (useMany) {
    q = q.in("xero_tenant_id", many);
  }

  const { data, error } = await q;
  if (error) {
    console.warn("[cashflow-report] xero_balance_sheet load:", error.message);
    return out;
  }

  for (const row of data || []) {
    const toDate = String((row as { to_date?: string }).to_date ?? "").slice(0, 10);
    if (!toDate) continue;
    const accId = String((row as { xero_account_id?: string }).xero_account_id || "").trim();
    if (!accId) continue;

    if (useSetupBank) {
      if (!setupBankIds.includes(accId)) continue;
      const raw = Number((row as { amount?: number }).amount) || 0;
      out.set(toDate, (out.get(toDate) ?? 0) + raw);
      continue;
    }

    const section = (row as { section?: string }).section;
    const isCc = creditCardIds.has(accId);
    if (isCc) continue;
    const include =
      isCashBankSection(section) || bankIds.has(accId);
    if (!include) continue;
    const raw = Number((row as { amount?: number }).amount) || 0;
    out.set(toDate, (out.get(toDate) ?? 0) + cashContributionFromBsAmount(raw, false));
  }

  console.log("[cashflow-report] BS cash totals", {
    tenantOrgIds,
    monthEnds: monthEndDates.length,
    source: useSetupBank ? "setup_categories_bank" : "xero_total_cash_fallback",
    setupBankCount: setupBankIds.length,
    totals: Object.fromEntries(out),
  });

  return out;
}

export interface MonthCol {
  key: string;
  label: string;
}

export interface ColData {
  column: string;
  value: number;
}

/** YYYY-MM or YYYY-MM-DD → prior calendar month-end YYYY-MM-DD. */
export function dateToPriorMonthEnd(dateOrMonthKey: string): string {
  if (/^\d{4}-\d{2}$/.test(dateOrMonthKey)) {
    return priorMonthEndDate(dateOrMonthKey);
  }
  const [yStr, mStr] = dateOrMonthKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return dateOrMonthKey;
  const d = new Date(Date.UTC(y, m - 1, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Closing as-at date for a statement column.
 * Monthly keys close on month-end; weekly keys close on Sunday.
 * Both are capped at `rangeToDate` so the last column matches Xero BS
 * "Cash at bank and in hand" on the Money In/Out end date.
 */
export function periodClosingAsAt(colKey: string, rangeToDate?: string | null): string {
  const to = rangeToDate ? String(rangeToDate).slice(0, 10) : "";
  let closing: string;
  if (/^\d{4}-\d{2}$/.test(colKey)) {
    closing = monthKeyToEndDate(colKey);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(colKey)) {
    const d = new Date(`${colKey}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return colKey;
    d.setUTCDate(d.getUTCDate() + 6);
    closing = d.toISOString().slice(0, 10);
  } else {
    closing = colKey;
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to) && closing > to) return to;
  return closing;
}

function resolveFirstOpeningFromBs(
  firstPeriodKey: string,
  bsTotalByMonthEnd: Map<string, number>,
  firstPeriodNet: number
): number | null {
  const firstPrior = dateToPriorMonthEnd(firstPeriodKey);
  if (bsTotalByMonthEnd.has(firstPrior)) {
    return bsTotalByMonthEnd.get(firstPrior)!;
  }

  // Nearest BS snapshot on or before the prior month-end
  const earlier = [...bsTotalByMonthEnd.keys()]
    .filter((d) => d <= firstPrior)
    .sort();
  if (earlier.length > 0) {
    return bsTotalByMonthEnd.get(earlier[earlier.length - 1])!;
  }

  // Last resort: first month-end BS minus that period's bank net
  const firstEnd =
    /^\d{4}-\d{2}$/.test(firstPeriodKey)
      ? monthKeyToEndDate(firstPeriodKey)
      : firstPeriodKey;
  if (bsTotalByMonthEnd.has(firstEnd)) {
    return bsTotalByMonthEnd.get(firstEnd)! - firstPeriodNet;
  }

  return null;
}

/** Pence-level tolerance when comparing a rolled balance to the Xero BS snapshot. */
const BS_DRIFT_TOLERANCE = 0.05;

export interface BsDriftEntry {
  column: string;
  monthEnd: string;
  rolled: number;
  balanceSheet: number;
  drift: number;
}

/**
 * Opening/closing balances:
 * - First Opening = Xero BS cash at prior month-end (when available)
 * - Closing(M) = Xero BS cash at month-end when available (matches Xero
 *   "Total Cash at bank and in hand" for that column — single or multi-month)
 * - Otherwise Closing = Opening + Received − Paid
 * - Next Opening = prior Closing (so May Opening = April Closing = April BS)
 *
 * Each month is re-anchored to the Balance Sheet whenever a month-end snapshot
 * exists. That keeps April Closing identical whether the range is April-only or
 * April–May (and matches the Xero BS). Pure roll-forward from the first Opening
 * was tried previously, but any month where categorised Received − Paid ≠ bank
 * movement permanently drifted every later column away from Xero.
 *
 * When Opening + Received − Paid differs from the BS Closing, the gap is logged
 * in `bsDrift` as a categorisation / sync signal (Uncategorized helps find it).
 * Prefer matching Xero cash over forcing the arithmetic identity on the
 * Closing row.
 */
export function buildBsAnchoredMonthlyBalances(
  monthCols: MonthCol[],
  bsTotalByMonthEnd: Map<string, number>,
  receivedByMonth: Record<string, number>,
  paidByMonth: Record<string, number>,
  rangeToDate?: string | null
): {
  openingBalance: ColData[];
  closingBalance: ColData[];
  usedBs: boolean;
  bsDrift: BsDriftEntry[];
} {
  if (monthCols.length === 0) {
    return { openingBalance: [], closingBalance: [], usedBs: false, bsDrift: [] };
  }

  const firstKey = monthCols[0].key;
  const firstNet =
    (receivedByMonth[firstKey] ?? 0) - (paidByMonth[firstKey] ?? 0);
  const firstOpening = resolveFirstOpeningFromBs(
    firstKey,
    bsTotalByMonthEnd,
    firstNet
  );
  if (firstOpening === null) {
    return { openingBalance: [], closingBalance: [], usedBs: false, bsDrift: [] };
  }

  const openingBalance: ColData[] = [];
  const closingBalance: ColData[] = [];
  const bsDrift: BsDriftEntry[] = [];
  let runningOpening = firstOpening;

  for (const col of monthCols) {
    const net = (receivedByMonth[col.key] ?? 0) - (paidByMonth[col.key] ?? 0);
    const priorEnd = dateToPriorMonthEnd(col.key);
    // Re-anchor Opening to prior month-end BS when present so a mid-range month
    // cannot inherit roll drift from an earlier incomplete journal month.
    const opening = bsTotalByMonthEnd.has(priorEnd)
      ? bsTotalByMonthEnd.get(priorEnd)!
      : runningOpening;

    const monthEnd = /^\d{4}-\d{2}$/.test(col.key)
      ? monthKeyToEndDate(col.key)
      : col.key;
    const closingDate = periodClosingAsAt(col.key, rangeToDate);
    const bsClosing =
      bsTotalByMonthEnd.get(closingDate) ??
      (closingDate !== monthEnd ? bsTotalByMonthEnd.get(monthEnd) : undefined);
    const rolled = Number((opening + net).toFixed(2));
    const closing =
      bsClosing != null ? Number(bsClosing.toFixed(2)) : rolled;

    if (bsClosing != null && Math.abs(rolled - closing) > BS_DRIFT_TOLERANCE) {
      bsDrift.push({
        column: col.label,
        monthEnd: closingDate,
        rolled,
        balanceSheet: closing,
        drift: Number((rolled - closing).toFixed(2)),
      });
    }

    openingBalance.push({
      column: col.label,
      value: Number(opening.toFixed(2)),
    });
    closingBalance.push({ column: col.label, value: closing });
    runningOpening = closing;
  }

  return { openingBalance, closingBalance, usedBs: true, bsDrift };
}
