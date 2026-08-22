/**
 * Profit Benchmark category detail — transaction drill-down + periodic Expected vs Actual.
 * Includes Manual Journals (unlike cashflow). Filtered by group_account mappings.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { distinctAccountKeysFromGroupRows } from "../_shared/distinctSetupMaps.ts";
import {
  fetchXeroJournalDetailsLikePlBsForCashflowReport,
  resolveXeroTenantOrgRowId,
} from "./xeroJournalDetailsCashflow.ts";
import { getXeroTransactionLink, getIplicitTransactionLink } from "./accountingTransactionLinks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LooseRow = Record<string, unknown>;
type PeriodGranularity = "weekly" | "monthly" | "yearly";

const norm = (v: unknown): string => (v == null ? "" : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;

function isProfitLossType(value: string): boolean {
  const t = (value || "").trim().toUpperCase();
  if (!t) return true;
  if (t === "PL" || t === "P&L") return true;
  if (t.includes("PROFIT") && t.includes("LOSS")) return true;
  if (t.includes("INCOME") || t.includes("EXPENSE") || t.includes("REVENUE") || t.includes("SALES")) return true;
  if (t.includes("COST") || t.includes("OVERHEAD")) return true;
  return false;
}

/** P&L net cost/expense: credits reduce (do not use abs per line). */
function toCostExpenseNet(signed: number, platform: string): number {
  return platform === "xero" ? -signed : signed;
}

function toIncomeNet(signed: number, _platform: string): number {
  return signed;
}

function isIncomeAccountType(value: string): boolean {
  const t = (value || "").trim().toUpperCase();
  return t.includes("REVENUE") || t.includes("SALES") || t.includes("INCOME") || t === "OTHERINCOME";
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseDateOnly(dateStr: string): Date | null {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function periodKey(dateStr: string, granularity: PeriodGranularity): string {
  const d = parseDateOnly(dateStr);
  if (!d) return "";
  const y = d.getFullYear();
  const mo = d.getMonth();
  if (granularity === "yearly") return String(y);
  if (granularity === "monthly") return `${y}-${String(mo + 1).padStart(2, "0")}`;
  // weekly: ISO-like week start Monday
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  const wy = monday.getFullYear();
  const wm = String(monday.getMonth() + 1).padStart(2, "0");
  const wd = String(monday.getDate()).padStart(2, "0");
  return `${wy}-${wm}-${wd}`;
}

function periodLabel(key: string, granularity: PeriodGranularity): string {
  if (!key) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (granularity === "yearly") return key;
  if (granularity === "monthly") {
    const [y, m] = key.split("-");
    const mi = Number(m) - 1;
    return `${months[mi] || m}-${String(y).slice(2)}`;
  }
  const d = parseDateOnly(key);
  if (!d) return key;
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function enumeratePeriods(fromDate: string, toDate: string, granularity: PeriodGranularity): string[] {
  const start = parseDateOnly(fromDate);
  const end = parseDateOnly(toDate);
  if (!start || !end || start > end) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const mo = cur.getMonth();
    const day = String(cur.getDate()).padStart(2, "0");
    const dateStr = `${y}-${String(mo + 1).padStart(2, "0")}-${day}`;
    const key = periodKey(dateStr, granularity);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    if (granularity === "yearly") {
      cur.setFullYear(cur.getFullYear() + 1);
      cur.setMonth(0, 1);
    } else if (granularity === "monthly") {
      cur.setMonth(cur.getMonth() + 1, 1);
    } else {
      cur.setDate(cur.getDate() + 7);
    }
  }
  return keys;
}

// deno-lint-ignore no-explicit-any
async function getFinanceSourceId(
  supabase: any,
  organizationId: string,
  platform: string,
  platformIntegrationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("finance_data_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("platform", platform)
    .eq("platform_integration_id", platformIntegrationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// deno-lint-ignore no-explicit-any
async function countJournalLinesForSource(supabase: any, sourceId: string): Promise<number> {
  const { count } = await supabase
    .from("finance_journal_lines")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId);
  return count ?? 0;
}

// deno-lint-ignore no-explicit-any
async function resolveCanonicalFinanceSourcePreferred(
  supabase: any,
  organizationId: string,
  preferredIntegrationId: string | null
): Promise<{ sourceId: string | null; platform: string | null; integrationId: string | null }> {
  const preferred = (preferredIntegrationId || "").trim();
  if (preferred) {
    const { data: sources } = await supabase
      .from("finance_data_sources")
      .select("id, platform, platform_integration_id")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", preferred)
      .in("platform", ["iplicit", "xero"]);
    if (sources?.length) {
      const ranked = [...sources].sort((a: any, b: any) => {
        const rank = (p: string) => (p === "iplicit" ? 0 : p === "xero" ? 1 : 2);
        return rank(String(a.platform)) - rank(String(b.platform));
      });
      for (const s of ranked) {
        const sid = String(s.id ?? "").trim();
        const integ = String(s.platform_integration_id ?? "").trim();
        if (!sid || !integ) continue;
        if ((await countJournalLinesForSource(supabase, sid)) > 0) {
          return { sourceId: sid, platform: String(s.platform), integrationId: integ };
        }
      }
    }
  }

  const { data: connectedIntegrations } = await supabase
    .from("platform_integrations")
    .select("id, platform_name, updated_at")
    .eq("organization_id", organizationId)
    .in("platform_name", ["iplicit", "xero"])
    .eq("is_connected", true)
    .order("updated_at", { ascending: false });

  for (const row of connectedIntegrations || []) {
    const integrationId = String(row.id ?? "").trim();
    const platform = String(row.platform_name ?? "").trim();
    if (!integrationId || !platform) continue;
    const sourceId = await getFinanceSourceId(supabase, organizationId, platform, integrationId);
    if (!sourceId) continue;
    if ((await countJournalLinesForSource(supabase, sourceId)) > 0) {
      return { sourceId, platform, integrationId };
    }
  }
  return { sourceId: null, platform: null, integrationId: null };
}

// deno-lint-ignore no-explicit-any
async function fetchCanonicalRows(
  supabase: any,
  organizationId: string,
  sourceId: string,
  fromDate: string,
  toDate: string,
  xeroTenantId?: string | null
): Promise<LooseRow[]> {
  const { data: lines, error } = await supabase
    .from("finance_journal_lines")
    .select(
      "id, posting_date, debit_amount, credit_amount, dimensions_json, extras_json, journal_entry_id, account_id"
    )
    .eq("organization_id", organizationId)
    .eq("source_id", sourceId)
    .gte("posting_date", fromDate)
    .lte("posting_date", toDate);
  if (error || !lines?.length) return [];

  const journalIds = [...new Set(lines.map((l: any) => l.journal_entry_id).filter(Boolean))] as string[];
  const accountIds = [...new Set(lines.map((l: any) => l.account_id).filter(Boolean))] as string[];
  const journalById = new Map<string, LooseRow>();
  const accountById = new Map<string, LooseRow>();

  for (const part of chunk(journalIds, 120)) {
    const { data } = await supabase
      .from("finance_journal_entries")
      .select("id, external_journal_id, metadata_json, description, posting_date")
      .in("id", part);
    for (const r of data || []) journalById.set(String(r.id), r);
  }
  for (const part of chunk(accountIds, 120)) {
    const { data } = await supabase
      .from("finance_accounts")
      .select("id, canonical_account_code, account_type, account_name, attributes_json")
      .in("id", part);
    for (const r of data || []) accountById.set(String(r.id), r);
  }

  const out: LooseRow[] = [];
  for (const row of lines) {
    const je = journalById.get(String(row.journal_entry_id));
    const fa = accountById.get(String(row.account_id));
    if (!je || !fa) continue;
    const meta = (je.metadata_json ?? {}) as Record<string, unknown>;
    if (xeroTenantId) {
      const tenant = String(meta.xero_tenant_id ?? meta.tenant_id ?? "").trim();
      if (!tenant || tenant !== xeroTenantId) continue;
    }
    const attrs = (fa.attributes_json ?? {}) as {
      coa_account_code?: string | null;
      coa_is_ar_account?: boolean | null;
      coa_is_ap_account?: boolean | null;
    };
    const ext = String(je.external_journal_id ?? "");
    const docId = ext.includes("::") ? ext.slice(ext.indexOf("::") + 2) : ext;
    const debit = num(row.debit_amount);
    const credit = num(row.credit_amount);
    const amount = debit - credit;
    const dateStr = String(row.posting_date || je.posting_date || "");
    out.push({
      doc_id: docId,
      account_id: fa.canonical_account_code ?? row.account_id,
      account_code: attrs.coa_account_code ?? fa.canonical_account_code,
      account_name: fa.account_name,
      account_type: fa.account_type,
      amount,
      period_date: dateStr,
      post_date: dateStr,
      doc_class: String(meta.doc_class || meta.source_type || ""),
      description: je.description ?? null,
      doc_description: null,
      is_control: Boolean(attrs.coa_is_ar_account) || Boolean(attrs.coa_is_ap_account),
    });
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      organizationId,
      fromDate,
      toDate,
      locationId: rawLocationId,
      trackingOptionId: rawTrackingOptionId,
      groupAccountMasterId,
      mode = "transactions",
      periodGranularity = "monthly",
      benchmarkPercent = 0,
      productionIncome = 0,
      categoryName = "",
      search = "",
    } = body ?? {};

    const gid = Number(groupAccountMasterId);
    if (!organizationId || !fromDate || !toDate || !Number.isFinite(gid)) {
      return new Response(
        JSON.stringify({
          error: "Missing organizationId, fromDate, toDate or groupAccountMasterId",
          transactionStatus: 0,
          returnObject: [],
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const filterLocationId =
      rawLocationId != null && String(rawLocationId).trim() && String(rawLocationId).toLowerCase() !== "all"
        ? String(rawLocationId).trim()
        : "";

    let mappedIntegrationId: string | null = null;
    let mappedPlatformOrgId: string | null = null;
    let mappedXeroTrackingOptionId: string | null = rawTrackingOptionId
      ? String(rawTrackingOptionId).trim()
      : null;
    if (filterLocationId) {
      const { data: mappingRows } = await supabase
        .from("platform_integration_organization_mapping")
        .select(
          `platform_integration_id, xero_tracking_option_id, platform_integration_organizations!inner (platform_name, platform_org_id)`
        )
        .eq("organization_id", organizationId)
        .eq("location_id", filterLocationId);

      const platformName = (m: any) =>
        String(m?.platform_integration_organizations?.platform_name || "").toLowerCase();
      const mapped =
        (mappingRows || []).find((m: any) => platformName(m) === "iplicit") ||
        (mappingRows || []).find((m: any) => platformName(m) === "xero") ||
        (mappingRows || [])[0];
      mappedIntegrationId = mapped?.platform_integration_id ? String(mapped.platform_integration_id) : null;
      mappedPlatformOrgId = mapped?.platform_integration_organizations?.platform_org_id
        ? String(mapped.platform_integration_organizations.platform_org_id).trim()
        : null;
      if (!mappedXeroTrackingOptionId) {
        const xeroMapped =
          (mappingRows || []).find((m: any) => platformName(m) === "xero" && m.xero_tracking_option_id) ||
          mapped;
        if (xeroMapped?.xero_tracking_option_id) {
          mappedXeroTrackingOptionId = String(xeroMapped.xero_tracking_option_id).trim();
        }
      }
    }

    const { data: latestIplicit } = await supabase
      .from("platform_integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "iplicit")
      .eq("is_connected", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: latestXero } = await supabase
      .from("platform_integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "xero")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const iplicitConnectionId = latestIplicit?.id ? String(latestIplicit.id) : null;
    const xeroIntegrationId =
      (mappedIntegrationId && mappedIntegrationId === (latestXero?.id ? String(latestXero.id) : ""))
        ? mappedIntegrationId
        : latestXero?.id
          ? String(latestXero.id)
          : null;

    const preferredIntegrationId = mappedIntegrationId ?? iplicitConnectionId ?? xeroIntegrationId;
    const { sourceId: financeSourceId, platform: activeFinancePlatform } =
      await resolveCanonicalFinanceSourcePreferred(supabase, organizationId, preferredIntegrationId);

    let platformForSign = (activeFinancePlatform || "").toLowerCase();
    let usedXeroJournalDetails = false;
    let xeroTenantOrgRowId: string | null = null;
    let allRows: LooseRow[] = [];

    // Prefer full Xero journals whenever a Xero connection exists.
    // finance_journal_lines is often a partial sync and must not win over xero_journal_details.
    if (xeroIntegrationId) {
      xeroTenantOrgRowId = await resolveXeroTenantOrgRowId(
        supabase,
        organizationId,
        xeroIntegrationId,
        mappedPlatformOrgId
      );
      allRows = await fetchXeroJournalDetailsLikePlBsForCashflowReport(
        supabase,
        organizationId,
        xeroIntegrationId,
        fromDate,
        toDate,
        xeroTenantOrgRowId,
        mappedXeroTrackingOptionId
      );
      platformForSign = "xero";
      usedXeroJournalDetails = true;
    }

    if (!allRows.length && financeSourceId) {
      allRows = await fetchCanonicalRows(
        supabase,
        organizationId,
        financeSourceId,
        fromDate,
        toDate,
        activeFinancePlatform === "xero" ? mappedPlatformOrgId : null
      );
      platformForSign = (activeFinancePlatform || platformForSign).toLowerCase();
    }

    if (!allRows.length && iplicitConnectionId) {
      const [pl1, pl2] = await Promise.all([
        supabase
          .from("iplicit_profit_loss")
          .select("doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", iplicitConnectionId)
          .not("period_date", "is", null)
          .gte("period_date", fromDate)
          .lte("period_date", toDate),
        supabase
          .from("iplicit_profit_loss")
          .select("doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", iplicitConnectionId)
          .is("period_date", null)
          .gte("post_date", fromDate)
          .lte("post_date", toDate),
      ]);
      allRows = [...(pl1.data || []), ...(pl2.data || [])] as LooseRow[];
      platformForSign = "iplicit";
    }

    // Resolve mapped account keys for this group
    let groupAccountQuery = supabase
      .from("group_account")
      .select("account_id, mapping_location_id")
      .eq("organization_id", organizationId)
      .eq("group_account_master_id", gid);

    if (filterLocationId) {
      if (preferredIntegrationId) {
        groupAccountQuery = groupAccountQuery.eq("platform_integration_id", preferredIntegrationId);
      }
      groupAccountQuery = groupAccountQuery.eq("mapping_location_id", filterLocationId);
    } else {
      groupAccountQuery = groupAccountQuery.not("mapping_location_id", "is", null);
    }

    let { data: groupAccountRows } = await groupAccountQuery;
    if ((!groupAccountRows || groupAccountRows.length === 0) && filterLocationId) {
      const { data: locAny } = await supabase
        .from("group_account")
        .select("account_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .eq("group_account_master_id", gid)
        .eq("mapping_location_id", filterLocationId);
      groupAccountRows = locAny ?? groupAccountRows;
    }
    if ((!groupAccountRows || groupAccountRows.length === 0) && filterLocationId) {
      const { data: connectionRows } = await supabase
        .from("group_account")
        .select("account_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .eq("group_account_master_id", gid)
        .is("mapping_location_id", null);
      groupAccountRows = connectionRows ?? groupAccountRows;
    }
    if ((!groupAccountRows || groupAccountRows.length === 0) && !filterLocationId) {
      const { data: connectionRows } = await supabase
        .from("group_account")
        .select("account_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .eq("group_account_master_id", gid)
        .is("mapping_location_id", null);
      groupAccountRows = connectionRows ?? groupAccountRows;
    }

    const accountKeySet = distinctAccountKeysFromGroupRows(
      (groupAccountRows || []) as Array<{ account_id?: string | null }>,
    );

    // Expand keys via finance_accounts aliases only for canonical path.
    // Never add bare COA codes (collide across tenants). Skip when using xero journals
    // (group_account already stores Xero account GUIDs).
    if (!usedXeroJournalDetails && financeSourceId && accountKeySet.size > 0) {
      const { data: faRows } = await supabase
        .from("finance_accounts")
        .select("id, canonical_account_code, attributes_json")
        .eq("organization_id", organizationId)
        .eq("source_id", financeSourceId);
      for (const fa of faRows || []) {
        const keys = [
          norm((fa as any).canonical_account_code),
          norm((fa as any).id),
        ]
          .map((k) => k.toLowerCase())
          .filter(Boolean);
        if (keys.some((k) => accountKeySet.has(k))) {
          for (const k of keys) accountKeySet.add(k);
        }
      }
    }

    type Matched = {
      row: LooseRow;
      acctId: string;
      acctCode: string;
      dateStr: string;
      rawAmount: number;
      docId: string;
      description: string;
      accountName: string;
    };

    const matched: Matched[] = [];
    const incomeByPeriod = new Map<string, number>();
    const granularity = (["weekly", "monthly", "yearly"].includes(periodGranularity)
      ? periodGranularity
      : "monthly") as PeriodGranularity;

    for (const row of allRows) {
      const acctId = norm(row.account_id);
      const acctCode = norm(row.account_code);
      const dateStr = String(row.period_date || row.post_date || "");
      if (!dateStr) continue;

      const accType = norm(row.account_type);
      const isControl = Boolean((row as any).is_control);
      const isPl = isProfitLossType(accType);
      const raw = num(row.amount);
      const signed = raw * (platformForSign === "xero" ? -1 : 1);

      // Period income proxy for expected line
      if (mode === "periodic" && isPl && !isControl && isIncomeAccountType(accType)) {
        const pk = periodKey(dateStr, granularity);
        if (pk) incomeByPeriod.set(pk, (incomeByPeriod.get(pk) || 0) + toIncomeNet(signed, platformForSign));
      }

      const inGroup =
        (acctId && accountKeySet.has(acctId.toLowerCase())) ||
        (acctCode && accountKeySet.has(acctCode.toLowerCase()));
      if (!inGroup) continue;
      if (!isPl || isControl) continue;

      matched.push({
        row,
        acctId,
        acctCode,
        dateStr,
        rawAmount: signed,
        docId: norm(row.doc_id),
        description: String(row.description || row.doc_description || "").trim(),
        accountName: String(row.account_name || acctCode || acctId || "—").trim() || "—",
      });
    }

    // --- Periodic mode ---
    if (mode === "periodic") {
      const periodKeys = enumeratePeriods(fromDate, toDate, granularity);
      const actualByPeriod = new Map<string, number>();
      for (const m of matched) {
        const pk = periodKey(m.dateStr, granularity);
        if (!pk) continue;
        actualByPeriod.set(
          pk,
          (actualByPeriod.get(pk) || 0) + toCostExpenseNet(m.rawAmount, platformForSign)
        );
      }

      const bench = Number(benchmarkPercent) || 0;
      const totalIncomeHint = Number(productionIncome) || 0;
      const incomeSum = [...incomeByPeriod.values()].reduce((a, b) => a + b, 0);
      const periods = periodKeys.map((key) => {
        const actual = Number((actualByPeriod.get(key) || 0).toFixed(2));
        let periodIncome = incomeByPeriod.get(key) || 0;
        if (periodIncome <= 0 && totalIncomeHint > 0 && periodKeys.length > 0) {
          periodIncome = totalIncomeHint / periodKeys.length;
        } else if (periodIncome <= 0 && incomeSum > 0 && periodKeys.length > 0) {
          periodIncome = incomeSum / periodKeys.length;
        }
        const expected = Number(((periodIncome * bench) / 100).toFixed(2));
        return {
          key,
          label: periodLabel(key, granularity),
          expected,
          actual,
        };
      });

      const totalActual = periods.reduce((s, p) => s + p.actual, 0);
      const totalExpected = periods.reduce((s, p) => s + p.expected, 0);

      return new Response(
        JSON.stringify({
          transactionStatus: 8,
          resultMsg: "Success",
          mode: "periodic",
          categoryName,
          groupAccountMasterId: gid,
          periodGranularity: granularity,
          benchmarkPercent: bench,
          summary: {
            expected: Number(totalExpected.toFixed(2)),
            actual: Number(totalActual.toFixed(2)),
            variance:
              totalIncomeHint > 0
                ? Number((((totalActual / totalIncomeHint) * 100 - bench)).toFixed(2))
                : 0,
            benchmarkPercent: bench,
            productionIncome: totalIncomeHint,
          },
          periods,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Transactions mode ---
    const journalHeaderById = new Map<
      string,
      { sourceType: string; sourceTypeDesc: string; sourceId: string; contactName: string; reference: string }
    >();
    const whoPaidByJournalId = new Map<string, string>();

    if (usedXeroJournalDetails && xeroIntegrationId && matched.length > 0) {
      const platformJournalIds = [...new Set(matched.map((m) => m.docId).filter(Boolean))];
      for (const part of chunk(platformJournalIds, 150)) {
        const { data: headers } = await supabase
          .from("xero_journals")
          .select("journal_id, source_type, source_type_desc, source_id, reference, contact_name")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", xeroIntegrationId)
          .in("journal_id", part);
        for (const h of headers || []) {
          const jid = norm((h as any).journal_id);
          if (!jid) continue;
          journalHeaderById.set(jid, {
            sourceType: String((h as any).source_type || "").trim(),
            sourceTypeDesc: String((h as any).source_type_desc || "").trim(),
            sourceId: String((h as any).source_id || "").trim(),
            contactName: String((h as any).contact_name || "").trim(),
            reference: String((h as any).reference || "").trim(),
          });
        }
      }

      for (const part of chunk(platformJournalIds, 150)) {
        let sq = supabase
          .from("xero_journal_details")
          .select("platform_journal_id, account_id, account_name, account_code, account_type")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", xeroIntegrationId)
          .in("platform_journal_id", part);
        if (xeroTenantOrgRowId) {
          sq = sq.eq("platform_integration_organization_id", xeroTenantOrgRowId);
        }
        const { data: siblings } = await sq;
        for (const s of siblings || []) {
          const pjId = norm((s as any).platform_journal_id);
          const accType = String((s as any).account_type || "").toUpperCase();
          const isBank = accType === "BANK" || accType === "CREDITCARD";
          if (!pjId || !isBank || whoPaidByJournalId.has(pjId)) continue;
          whoPaidByJournalId.set(
            pjId,
            String((s as any).account_name || (s as any).account_code || "—").trim() || "—"
          );
        }
      }
    }

    const searchLower = String(search || "").trim().toLowerCase();
    let transactions = matched.map((m) => {
      const header = m.docId ? journalHeaderById.get(m.docId) : undefined;
      const sourceType = header?.sourceType || String(m.row.doc_class || "").trim();
      const transactionType =
        header?.sourceTypeDesc || sourceType || String(m.row.doc_class || "").trim() || "Journal";
      const linkId =
        header?.sourceId ||
        (sourceType.toUpperCase().replace(/\s+/g, "") === "MANUALJOURNAL" ||
        sourceType.toUpperCase().replace(/\s+/g, "") === "MANJOURNAL"
          ? m.docId
          : "");
      const transactionLink = usedXeroJournalDetails || platformForSign === "xero"
        ? getXeroTransactionLink(sourceType || transactionType, linkId)
        : iplicitConnectionId
          ? getIplicitTransactionLink(null, transactionType, m.docId)
          : "#";

      const costNet = toCostExpenseNet(m.rawAmount, platformForSign);
      // Cost/expense: debits as Money OUT; credits/returns as Money IN (net = out − in)
      const moneyOut = costNet > 0 ? costNet : 0;
      const moneyIn = costNet < 0 ? -costNet : 0;

      return {
        date: m.dateStr,
        docId: m.docId,
        docClass: transactionType,
        description: m.description || header?.reference || "—",
        accountId: m.acctId || undefined,
        accountCode: m.acctCode || undefined,
        accountName: m.accountName,
        amountRaw: costNet,
        amountDisplay: Math.abs(costNet),
        transactionType,
        transactionLink,
        name: header?.contactName || m.description || header?.reference || "—",
        memoOrDescription: m.description || header?.reference || "—",
        whoPaid: (m.docId && whoPaidByJournalId.get(m.docId)) || m.accountName || "—",
        forWhat: m.accountName || "—",
        moneyIn,
        moneyOut,
      };
    });

    if (searchLower) {
      transactions = transactions.filter((t) => {
        const hay = [
          t.name,
          t.memoOrDescription,
          t.whoPaid,
          t.forWhat,
          t.transactionType,
          t.accountName,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(searchLower);
      });
    }

    transactions.sort((a, b) => a.date.localeCompare(b.date) || a.docId.localeCompare(b.docId));

    const totalOut = transactions.reduce((s, t) => s + (t.moneyOut || 0), 0);
    const totalIn = transactions.reduce((s, t) => s + (t.moneyIn || 0), 0);
    const netActual = totalOut - totalIn;

    return new Response(
      JSON.stringify({
        transactionStatus: 8,
        resultMsg: "Success",
        mode: "transactions",
        categoryName,
        groupAccountMasterId: gid,
        accountingPlatform: usedXeroJournalDetails || platformForSign === "xero"
          ? "xero"
          : iplicitConnectionId
            ? "iplicit"
            : null,
        summary: {
          expected: Number((((Number(productionIncome) || 0) * (Number(benchmarkPercent) || 0)) / 100).toFixed(2)),
          actual: Number(netActual.toFixed(2)),
          actualPct:
            Number(productionIncome) > 0
              ? Number(((netActual / Number(productionIncome)) * 100).toFixed(2))
              : 0,
          benchmarkPercent: Number(benchmarkPercent) || 0,
          variance:
            Number(productionIncome) > 0
              ? Number(
                  (
                    (netActual / Number(productionIncome)) * 100 -
                    (Number(benchmarkPercent) || 0)
                  ).toFixed(2)
                )
              : 0,
          moneyIn: Number(totalIn.toFixed(2)),
          moneyOut: Number(totalOut.toFixed(2)),
        },
        returnObject: transactions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("profit-benchmark-category-detail error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        resultMsg: "Failed to process request",
        transactionStatus: 0,
        returnObject: [],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
