import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildDistinctGroupsByAccount } from "../_shared/distinctSetupMaps.ts";
import {
  fetchXeroJournalDetailsLikePlBsForCashflowReport,
  resolveXeroTenantOrgRowId,
} from "./xeroJournalDetailsCashflow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LooseRow = Record<string, unknown>;

/** Legacy KPI benchmarks when no expense groups are configured */
const BENCHMARKS: Record<string, { benchmark: number; group: number }> = {
  "Revenue/Chair": { benchmark: 78000, group: 75000 },
  "EBITDA Margin": { benchmark: 24.1, group: 26.0 },
  "Clinician Cost %": { benchmark: 36.2, group: 35.0 },
  "Staff Cost %": { benchmark: 18.0, group: 17.0 },
  "Lab/Materials %": { benchmark: 12.0, group: 11.0 },
  "Overhead %": { benchmark: 15.0, group: 14.0 },
  "Net Profit %": { benchmark: 21.0, group: 23.0 },
};

const norm = (v: unknown): string => (v == null ? "" : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;
const pct = (n: number, d: number): number => (d > 0 ? (n / d) * 100 : 0);
const monthKey = (dateStr: string): string =>
  /^\d{4}-\d{2}-\d{2}/.test(dateStr) ? dateStr.slice(0, 7) : "";

/** Match client date-fns format(monthStart, 'MMM-yy') for Group Dashboard trend keys. */
const MON_YY = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function toMonYyFromYmd(ymd: string): string {
  const s = String(ymd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  if (!y || !m || m < 1 || m > 12) return "";
  return `${MON_YY[m - 1]}-${String(y).slice(2)}`;
}

function enumerateMonYyKeys(fromDate: string, toDate: string): string[] {
  const keys: string[] = [];
  const fs = String(fromDate).slice(0, 10);
  const ts = String(toDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fs) || !/^\d{4}-\d{2}-\d{2}$/.test(ts)) return keys;
  let y = Number(fs.slice(0, 4));
  let m = Number(fs.slice(5, 7));
  const endY = Number(ts.slice(0, 4));
  const endM = Number(ts.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(`${MON_YY[m - 1]}-${String(y).slice(2)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

function rowMonYy(row: LooseRow): string {
  const dt = String(row.period_date || row.post_date || "").slice(0, 10);
  return toMonYyFromYmd(dt);
}

function isProfitLossType(value: string): boolean {
  const t = (value || "").trim().toUpperCase();
  if (!t) return true;
  if (t === "PL" || t === "P&L") return true;
  if (t.includes("PROFIT") && t.includes("LOSS")) return true;
  if (t.includes("INCOME")) return true;
  if (t.includes("EXPENSE")) return true;
  if (t.includes("REVENUE")) return true;
  if (t.includes("SALES")) return true;
  if (t.includes("COST")) return true; // DIRECTCOSTS
  if (t.includes("OVERHEAD")) return true; // OVERHEADS
  return false;
}

function isRevenueAccountType(value: string): boolean {
  const t = (value || "").trim().toUpperCase();
  return (
    t.includes("REVENUE") ||
    t.includes("SALES") ||
    t === "OTHERINCOME" ||
    (t.includes("INCOME") && !t.includes("EXPENSE"))
  );
}

/**
 * Profit Benchmark amount logic (not cashflow):
 * 1. Cost / expense / revenue category Actuals = sum of NET journal amounts for accounts
 *    mapped in Setup Categories → Profit (group_account). Credits reduce the total.
 * 2. No cashflow category_range / CFO Income checks on those category totals.
 * 3. Production Income = mapped Private + Membership + NHS when present; otherwise
 *    fallback = net sum of REVENUE/SALES/OTHERINCOME account types in range.
 * 4. For Xero, always prefer xero_journal_details over finance_journal_lines — the
 *    canonical store is often a partial invoice-derived sync and will not match Xero P&L.
 */
function toCostExpenseNet(signed: number, platform: string): number {
  return platform === "xero" ? -signed : signed;
}

function toIncomeNet(signed: number, _platform: string): number {
  return signed;
}

// deno-lint-ignore no-explicit-any
async function getFinanceSourceId(
  supabase: any,
  organizationId: string,
  platform: string,
  platformIntegrationId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("finance_data_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("platform", platform)
    .eq("platform_integration_id", platformIntegrationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data?.id ?? null;
}

// deno-lint-ignore no-explicit-any
async function resolveActiveCanonicalSource(
  supabase: any,
  organizationId: string
): Promise<{ sourceId: string | null; platform: string | null; integrationId: string | null }> {
  const { data: connectedIntegrations, error: integrationError } = await supabase
    .from("platform_integrations")
    .select("id, platform_name, updated_at")
    .eq("organization_id", organizationId)
    .in("platform_name", ["iplicit", "xero"])
    .eq("is_connected", true)
    .order("updated_at", { ascending: false });

  if (integrationError || !connectedIntegrations?.length) {
    return { sourceId: null, platform: null, integrationId: null };
  }

  const ranked = [...connectedIntegrations].sort((a: any, b: any) => {
    const rank = (platform: string) => (platform === "iplicit" ? 0 : platform === "xero" ? 1 : 2);
    const rankDiff = rank(String(a.platform_name ?? "")) - rank(String(b.platform_name ?? ""));
    if (rankDiff !== 0) return rankDiff;
    return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  });

  for (const row of ranked) {
    const integrationId = String(row.id ?? "").trim();
    const platform = String(row.platform_name ?? "").trim();
    if (!integrationId || !platform) continue;

    const sourceId = await getFinanceSourceId(supabase, organizationId, platform, integrationId);
    if (!sourceId) continue;
    const lineCount = await countJournalLinesForSource(supabase, sourceId);
    if (lineCount > 0) {
      return { sourceId, platform, integrationId };
    }
  }

  return { sourceId: null, platform: null, integrationId: null };
}

// deno-lint-ignore no-explicit-any
async function countJournalLinesForSource(supabase: any, sourceId: string): Promise<number> {
  const { count, error } = await supabase
    .from("finance_journal_lines")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId);
  if (error) return 0;
  return count ?? 0;
}

/** Same as cashflow-report: pick integration id used by category_range_map rows. */
// deno-lint-ignore no-explicit-any
async function resolveCategoryMappingIntegrationId(
  supabase: any,
  organizationId: string,
  preferredIntegrationId: string | null
): Promise<string | null> {
  const { data, error } = await supabase
    .from("category_range_map")
    .select("platform_integration_id")
    .eq("organization_id", organizationId)
    .not("platform_integration_id", "is", null);

  if (error || !data || data.length === 0) return preferredIntegrationId ?? null;

  const counts = new Map<string, number>();
  for (const row of data as { platform_integration_id: string | null }[]) {
    const id = row.platform_integration_id ? String(row.platform_integration_id).trim() : "";
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  if (preferredIntegrationId && counts.has(preferredIntegrationId)) {
    return preferredIntegrationId;
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? preferredIntegrationId ?? null;
}

/**
 * Prefer canonical finance_data_sources for the mapped integration (location),
 * then fall back to org-wide resolveActiveCanonicalSource.
 */
// deno-lint-ignore no-explicit-any
async function resolveCanonicalFinanceSourcePreferred(
  supabase: any,
  organizationId: string,
  preferredIntegrationId: string | null
): Promise<{ sourceId: string | null; platform: string | null; integrationId: string | null }> {
  const preferred = (preferredIntegrationId || "").trim();
  if (preferred) {
    const { data: sources, error } = await supabase
      .from("finance_data_sources")
      .select("id, platform, platform_integration_id")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", preferred)
      .in("platform", ["iplicit", "xero"]);

    if (!error && sources?.length) {
      const ranked = [...sources].sort((a: any, b: any) => {
        const rank = (p: string) => (p === "iplicit" ? 0 : p === "xero" ? 1 : 2);
        return rank(String(a.platform)) - rank(String(b.platform));
      });
      for (const s of ranked) {
        const sid = s.id != null ? String(s.id).trim() : "";
        const integ = s.platform_integration_id != null ? String(s.platform_integration_id).trim() : "";
        if (!sid || !integ) continue;
        const n = await countJournalLinesForSource(supabase, sid);
        if (n > 0) {
          return { sourceId: sid, platform: String(s.platform), integrationId: integ };
        }
      }
    }
  }
  return resolveActiveCanonicalSource(supabase, organizationId);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// deno-lint-ignore no-explicit-any
async function fetchCanonicalRowsLikePlBsForCashflowReport(
  supabase: any,
  organizationId: string,
  sourceId: string,
  fromDate: string,
  toDate: string,
  xeroTenantId?: string | null
): Promise<LooseRow[]> {
  const { data: lines, error: linesError } = await supabase
    .from("finance_journal_lines")
    .select(
      "id, posting_date, debit_amount, credit_amount, dimensions_json, extras_json, journal_entry_id, account_id, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .eq("source_id", sourceId)
    .gte("posting_date", fromDate)
    .lte("posting_date", toDate);
  if (linesError || !lines?.length) return [];

  const journalIds = [...new Set(lines.map((l: any) => l.journal_entry_id).filter(Boolean))] as string[];
  const accountIds = [...new Set(lines.map((l: any) => l.account_id).filter(Boolean))] as string[];

  const journalById = new Map<string, LooseRow>();
  for (const part of chunk(journalIds, 120)) {
    const { data, error } = await supabase
      .from("finance_journal_entries")
      .select("id, external_journal_id, metadata_json, description, posting_date")
      .in("id", part);
    if (error) continue;
    for (const r of data || []) journalById.set(String(r.id), r);
  }

  const accountById = new Map<string, LooseRow>();
  for (const part of chunk(accountIds, 120)) {
    const { data, error } = await supabase
      .from("finance_accounts")
      .select("id, canonical_account_code, account_type, attributes_json")
      .in("id", part);
    if (error) continue;
    for (const r of data || []) accountById.set(String(r.id), r);
  }

  const out: LooseRow[] = [];
  for (const row of lines) {
    const je = journalById.get(String(row.journal_entry_id));
    const fa = accountById.get(String(row.account_id));
    if (!je || !fa) continue;
    const ext = String(je.external_journal_id ?? "");
    const docId = ext.includes("::") ? ext.slice(ext.indexOf("::") + 2) : ext;
    const dims = (row.dimensions_json ?? {}) as Record<string, unknown>;
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
    out.push({
      id: row.id,
      doc_id: docId,
      account_id: fa.canonical_account_code ?? null,
      account_code: attrs.coa_account_code ?? fa.canonical_account_code ?? null,
      account_type: fa.account_type ?? null,
      is_control: Boolean(attrs.coa_is_ar_account) || Boolean(attrs.coa_is_ap_account),
      amount: num(row.debit_amount) - num(row.credit_amount),
      period_date: row.posting_date,
      post_date: je.posting_date ?? row.posting_date,
      doc_class: dims.doc_class ?? meta.doc_class ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }
  return out;
}

type CategoryMeta = {
  masterId: string;
  rangeSubGroup: string;
  categoryName: string;
  code: string;
  rangeGroup: string;
};

// deno-lint-ignore no-explicit-any
async function loadMergedBenchmarkPercents(
  supabase: any,
  organizationId: string,
  mappingIntegrationId: string | null
): Promise<{ byGroupId: Map<number, number>; profitPercent: number }> {
  const byGroupId = new Map<number, number>();
  let profitPercent = 0;

  const { data: rows, error } = await supabase
    .from("profit_benchmark_settings")
    .select("platform_integration_id, group_account_master_id, is_profit_row, benchmark_percent")
    .eq("organization_id", organizationId);

  if (error) {
    console.warn("[profit-benchmark] profit_benchmark_settings:", error.message);
    return { byGroupId, profitPercent };
  }
  if (!rows?.length) {
    return { byGroupId, profitPercent };
  }

  const scopedRows = (r: any) =>
    mappingIntegrationId && String(r.platform_integration_id ?? "") === String(mappingIntegrationId);
  const globalRows = (r: any) => r.platform_integration_id == null;

  const profitScoped = rows.find((r: any) => r.is_profit_row && scopedRows(r));
  const profitGlobal = rows.find((r: any) => r.is_profit_row && globalRows(r));
  if (profitScoped) profitPercent = Number(profitScoped.benchmark_percent) || 0;
  else if (profitGlobal) profitPercent = Number(profitGlobal.benchmark_percent) || 0;

  const groupIds = new Set<number>();
  for (const r of rows) {
    if (!r.is_profit_row && r.group_account_master_id != null) {
      groupIds.add(Number(r.group_account_master_id));
    }
  }
  for (const gid of groupIds) {
    const gScoped = rows.find(
      (r: any) => !r.is_profit_row && Number(r.group_account_master_id) === gid && scopedRows(r)
    );
    const gGlobal = rows.find(
      (r: any) => !r.is_profit_row && Number(r.group_account_master_id) === gid && globalRows(r)
    );
    if (gScoped) byGroupId.set(gid, Number(gScoped.benchmark_percent) || 0);
    else if (gGlobal) byGroupId.set(gid, Number(gGlobal.benchmark_percent) || 0);
  }

  return { byGroupId, profitPercent };
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
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
      revenueMin,
      revenueMax,
      ebitdaMarginMin,
      ebitdaMarginMax,
      granularity,
    } = body ?? {};

    if (!organizationId || !fromDate || !toDate) {
      return new Response(JSON.stringify({ error: "Missing organizationId, fromDate or toDate", resultMsg: "Bad request", status: 0 }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trimmedLoc = rawLocationId != null ? String(rawLocationId).trim() : "";
    const filterLocationId =
      trimmedLoc && trimmedLoc.toLowerCase() !== "all" ? trimmedLoc : "";

    let mappedIntegrationId: string | null = null;
    let mappedPlatformOrgId: string | null = null;
    let mappedXeroTrackingOptionId: string | null = rawTrackingOptionId
      ? String(rawTrackingOptionId).trim()
      : null;
    if (filterLocationId) {
      const { data: locMeta } = await supabase
        .from("practice_locations")
        .select("exclude_from_financial_display")
        .eq("id", filterLocationId)
        .maybeSingle();
      if (locMeta?.exclude_from_financial_display) {
        return new Response(
          JSON.stringify({
            resultMsg: "Location excluded from financial display",
            status: 1,
            categories: [],
            monthColumns: [],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: mappingRows } = await supabase
        .from("platform_integration_organization_mapping")
        .select(
          `
          platform_integration_id,
          xero_tracking_option_id,
          platform_integration_organizations!inner (
            platform_name,
            platform_org_id
          )
        `
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
      mappedPlatformOrgId =
        mapped?.platform_integration_organizations?.platform_org_id
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

    const { data: latestIplicitConnection } = await supabase
      .from("platform_integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "iplicit")
      .eq("is_connected", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: latestXeroConnection } = await supabase
      .from("platform_integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "xero")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestIplicitConnectionId = latestIplicitConnection?.id ? String(latestIplicitConnection.id) : null;
    const latestXeroConnectionId = latestXeroConnection?.id ? String(latestXeroConnection.id) : null;
    const preferredIntegrationId =
      mappedIntegrationId ?? latestIplicitConnectionId ?? latestXeroConnectionId;

    const categoryScopeIntegrationId = await resolveCategoryMappingIntegrationId(
      supabase,
      organizationId,
      preferredIntegrationId
    );

    const { sourceId: financeSourceId, platform: activeFinancePlatform, integrationId: sourceIntegrationId } =
      await resolveCanonicalFinanceSourcePreferred(supabase, organizationId, categoryScopeIntegrationId);

    let iplicitConnectionId = latestIplicitConnectionId;
    if (mappedIntegrationId) {
      const { data: mpRow } = await supabase
        .from("platform_integrations")
        .select("platform_name")
        .eq("id", mappedIntegrationId)
        .maybeSingle();
      if (String(mpRow?.platform_name || "").toLowerCase() === "iplicit") {
        iplicitConnectionId = mappedIntegrationId;
      }
    }

    const xeroIntegrationId =
      (mappedIntegrationId && mappedIntegrationId === latestXeroConnectionId ? mappedIntegrationId : null) ||
      (categoryScopeIntegrationId && categoryScopeIntegrationId === latestXeroConnectionId
        ? categoryScopeIntegrationId
        : null) ||
      latestXeroConnectionId;

    const mappingIntegrationId =
      sourceIntegrationId || categoryScopeIntegrationId || iplicitConnectionId || xeroIntegrationId;
    const hasCanonicalFinance = !!financeSourceId;
    let platformForSign = (activeFinancePlatform || (hasCanonicalFinance ? "" : "iplicit")).toLowerCase();

    let allRows: LooseRow[] = [];
    let usedXeroJournalDetails = false;

    // Prefer full Xero journals whenever a Xero connection exists.
    // finance_journal_lines is often a partial invoice-derived sync and must not win over
    // xero_journal_details (source of truth that matches Xero P&L / Excel).
    if (xeroIntegrationId) {
      const tenantOrgRowId = await resolveXeroTenantOrgRowId(
        supabase,
        organizationId,
        xeroIntegrationId,
        mappedPlatformOrgId
      );
      allRows = (await fetchXeroJournalDetailsLikePlBsForCashflowReport(
        supabase,
        organizationId,
        xeroIntegrationId,
        fromDate,
        toDate,
        tenantOrgRowId,
        mappedXeroTrackingOptionId
      )) as LooseRow[];
      platformForSign = "xero";
      usedXeroJournalDetails = true;
      for (const r of allRows) {
        (r as any).is_control = false;
      }
      console.log("[profit-benchmark] using xero_journal_details", {
        rows: allRows.length,
        xeroIntegrationId,
        tenantOrgRowId,
        mappedXeroTrackingOptionId,
      });
    }

    if (!allRows.length && hasCanonicalFinance) {
      allRows = await fetchCanonicalRowsLikePlBsForCashflowReport(
        supabase,
        organizationId,
        financeSourceId as string,
        fromDate,
        toDate,
        activeFinancePlatform === "xero" ? mappedPlatformOrgId : null
      );
      platformForSign = (activeFinancePlatform || platformForSign).toLowerCase();
      console.log("[profit-benchmark] using finance_journal_lines (canonical fallback)", {
        rows: allRows.length,
        financeSourceId,
        platform: platformForSign,
      });
    }

    if (!allRows.length && iplicitConnectionId) {
      const [plRes1, plRes2, bsRes1, bsRes2] = await Promise.all([
        supabase
          .from("iplicit_profit_loss")
          .select("doc_id, account_id, account_code, amount, period_date, post_date")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", iplicitConnectionId)
          .not("period_date", "is", null)
          .gte("period_date", fromDate)
          .lte("period_date", toDate),
        supabase
          .from("iplicit_profit_loss")
          .select("doc_id, account_id, account_code, amount, period_date, post_date")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", iplicitConnectionId)
          .is("period_date", null)
          .gte("post_date", fromDate)
          .lte("post_date", toDate),
        supabase
          .from("iplicit_balance_sheet")
          .select("doc_id, account_id, account_code, amount, period_date, post_date")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", iplicitConnectionId)
          .not("post_date", "is", null)
          .gte("post_date", fromDate)
          .lte("post_date", toDate),
        supabase
          .from("iplicit_balance_sheet")
          .select("doc_id, account_id, account_code, amount, period_date, post_date")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", iplicitConnectionId)
          .is("post_date", null)
          .gte("period_date", fromDate)
          .lte("period_date", toDate),
      ]);

      const plError = plRes1.error || plRes2.error;
      const bsError = bsRes1.error || bsRes2.error;
      if (plError || bsError) {
        const err = plError || bsError;
        return new Response(JSON.stringify({ error: err?.message ?? "Failed to fetch iplicit data", resultMsg: "Failed to fetch data", status: 0 }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      allRows = [
        ...((plRes1.data || []) as LooseRow[]),
        ...((plRes2.data || []) as LooseRow[]),
        ...((bsRes1.data || []) as LooseRow[]),
        ...((bsRes2.data || []) as LooseRow[]),
      ];
      platformForSign = "iplicit";
      for (const r of allRows) {
        (r as any).account_type = null;
        (r as any).is_control = false;
      }
    }

    if (!allRows.length && !hasCanonicalFinance && !iplicitConnectionId && !xeroIntegrationId) {
      return new Response(
        JSON.stringify({
          rows: [],
          productionIncome: 0,
          platformIntegrationId: mappingIntegrationId,
          resultMsg: "No Xero/Iplicit finance data found",
          status: 8,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Category maps: per-location when filtered; combine all location setups for All Locations.
    let categoryMapQuery = supabase
      .from("category_range_map")
      .select("location_id, category_range_id, mapping_location_id")
      .eq("organization_id", organizationId);
    if (filterLocationId) {
      if (categoryScopeIntegrationId) {
        categoryMapQuery = categoryMapQuery.eq("platform_integration_id", categoryScopeIntegrationId);
      }
      categoryMapQuery = categoryMapQuery.eq("mapping_location_id", filterLocationId);
    } else {
      categoryMapQuery = categoryMapQuery.not("mapping_location_id", "is", null);
    }
    let { data: categoryMapRows } = await categoryMapQuery;
    if ((!categoryMapRows || categoryMapRows.length === 0) && filterLocationId) {
      const { data: locAnyIntegration } = await supabase
        .from("category_range_map")
        .select("location_id, category_range_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .eq("mapping_location_id", filterLocationId);
      categoryMapRows = locAnyIntegration ?? categoryMapRows;
    }
    if ((!categoryMapRows || categoryMapRows.length === 0) && filterLocationId) {
      let connectionFallback = supabase
        .from("category_range_map")
        .select("location_id, category_range_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .is("mapping_location_id", null);
      if (categoryScopeIntegrationId) {
        connectionFallback = connectionFallback.or(
          `platform_integration_id.eq.${categoryScopeIntegrationId},platform_integration_id.is.null`
        );
      }
      const { data: connectionRows } = await connectionFallback;
      categoryMapRows = connectionRows ?? categoryMapRows;
    }
    if ((!categoryMapRows || categoryMapRows.length === 0) && !filterLocationId) {
      const { data: connectionLevelRows } = await supabase
        .from("category_range_map")
        .select("location_id, category_range_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .is("mapping_location_id", null);
      categoryMapRows = connectionLevelRows ?? categoryMapRows;
    }

    const { data: categoryMasterRows } = await supabase
      .from("category_range_master")
      .select("id, name, range_sub_group, code, range_group");

    const masterById = new Map<string, CategoryMeta>();
    for (const m of categoryMasterRows || []) {
      const idStr = String((m as any).id);
      masterById.set(idStr, {
        masterId: idStr,
        categoryName: String((m as any).name || ""),
        rangeSubGroup: String((m as any).range_sub_group || ""),
        code: String((m as any).code || ""),
        rangeGroup: String((m as any).range_group || ""),
      });
    }

    // All Locations: DISTINCT account → one category (first-wins). Single location: last-wins.
    const allLocationsCategory = !filterLocationId;
    const categoryByCode = new Map<string, CategoryMeta>();
    const locationScopedCategoryIds = new Set(
      (categoryMapRows || [])
        .filter((row: any) => !!row.mapping_location_id)
        .map((row: any) => Number(row.category_range_id))
    );
    const orderedCategoryMapRows = [...(categoryMapRows || [])].sort((a: any, b: any) => {
      const aLoc = (a as any).mapping_location_id ? 1 : 0;
      const bLoc = (b as any).mapping_location_id ? 1 : 0;
      if (aLoc !== bLoc) return bLoc - aLoc; // location-scoped first
      const aMap = String((a as any).mapping_location_id ?? "");
      const bMap = String((b as any).mapping_location_id ?? "");
      if (aMap !== bMap) return aMap.localeCompare(bMap);
      return Number((a as any).category_range_id) - Number((b as any).category_range_id);
    });
    for (const row of orderedCategoryMapRows) {
      if (!(row as any).mapping_location_id && locationScopedCategoryIds.has(Number((row as any).category_range_id))) {
        continue;
      }
      const locationId = norm((row as any).location_id).toLowerCase();
      if (!locationId) continue;
      const master = masterById.get(String((row as any).category_range_id));
      if (!master) continue;
      if (allLocationsCategory && categoryByCode.has(locationId)) continue;
      categoryByCode.set(locationId, { ...master });
    }

    const accountCategoryByCode = new Map<string, CategoryMeta>();
    for (const [k, v] of categoryByCode.entries()) accountCategoryByCode.set(k.toLowerCase(), v);

    const { data: expenseGroupMasters } = await supabase
      .from("group_account_master")
      .select("id, name, range_order, group_type")
      .in("group_type", [2, 3])
      .order("group_type", { ascending: true })
      .order("range_order", { ascending: true });

    // Expense groups: per-location when filtered; combine all location setups for All Locations.
    let groupAccountQuery = supabase
      .from("group_account")
      .select("group_account_master_id, account_id, mapping_location_id")
      .eq("organization_id", organizationId);
    if (filterLocationId) {
      if (mappingIntegrationId) {
        groupAccountQuery = groupAccountQuery.eq("platform_integration_id", mappingIntegrationId);
      }
      groupAccountQuery = groupAccountQuery.eq("mapping_location_id", filterLocationId);
    } else {
      groupAccountQuery = groupAccountQuery.not("mapping_location_id", "is", null);
    }

    let { data: groupAccountRows } = await groupAccountQuery;
    if ((!groupAccountRows || groupAccountRows.length === 0) && filterLocationId) {
      const { data: locAnyIntegration } = await supabase
        .from("group_account")
        .select("group_account_master_id, account_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .eq("mapping_location_id", filterLocationId);
      groupAccountRows = locAnyIntegration ?? groupAccountRows;
    }
    if ((!groupAccountRows || groupAccountRows.length === 0) && filterLocationId) {
      let connectionFallback = supabase
        .from("group_account")
        .select("group_account_master_id, account_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .is("mapping_location_id", null);
      if (mappingIntegrationId) {
        connectionFallback = connectionFallback.or(
          `platform_integration_id.eq.${mappingIntegrationId},platform_integration_id.is.null`
        );
      }
      const { data: connectionRows } = await connectionFallback;
      groupAccountRows = connectionRows ?? groupAccountRows;
    }
    if ((!groupAccountRows || groupAccountRows.length === 0) && !filterLocationId) {
      const { data: connectionLevelRows } = await supabase
        .from("group_account")
        .select("group_account_master_id, account_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .is("mapping_location_id", null);
      groupAccountRows = connectionLevelRows ?? groupAccountRows;
    }

    const groupNameById = new Map<number, string>();
    const groupOrderById = new Map<number, number>();
    const groupTypeById = new Map<number, number>();
    for (const m of expenseGroupMasters || []) {
      const id = Number((m as any).id);
      if (!Number.isFinite(id)) continue;
      groupNameById.set(id, String((m as any).name || ""));
      groupOrderById.set(id, Number((m as any).range_order ?? 0) || 0);
      groupTypeById.set(id, Number((m as any).group_type ?? 2) || 2);
    }

    const { data: revenueGroupMasters } = await supabase
      .from("group_account_master")
      .select("id, name, range_order, group_code, group_type")
      .eq("group_type", 1)
      .order("range_order", { ascending: true });

    const revenueNameById = new Map<number, string>();
    const revenueCodeById = new Map<number, string>();
    for (const m of revenueGroupMasters || []) {
      const id = Number((m as any).id);
      if (!Number.isFinite(id)) continue;
      revenueNameById.set(id, String((m as any).name || ""));
      revenueCodeById.set(id, String((m as any).group_code || "").toLowerCase());
    }

    // All Locations: DISTINCT account → one cost/expense group + one revenue group
    // (avoids double-counting the same COA when Hungerford/Queen Street disagree).
    const hasLocationGroupRows = new Set(
      (groupAccountRows || [])
        .filter((row: any) => filterLocationId && row.mapping_location_id === filterLocationId)
        .map((row: any) => Number(row.group_account_master_id))
    );
    const filteredGroupRows = (groupAccountRows || []).filter((row: any) => {
      if (
        filterLocationId &&
        !(row as any).mapping_location_id &&
        hasLocationGroupRows.has(Number((row as any).group_account_master_id))
      ) {
        return false;
      }
      return true;
    });
    const { groupsByAccount, revenueGroupsByAccount } = buildDistinctGroupsByAccount(
      filteredGroupRows as Array<{
        group_account_master_id: number;
        account_id: string;
        mapping_location_id?: string | null;
      }>,
      {
        allLocations: !filterLocationId,
        expenseGroupIds: new Set(groupNameById.keys()),
        revenueGroupIds: new Set(revenueNameById.keys()),
      },
    );

    // Canonical alias keys only when aggregating from finance_journal_lines.
    // Never register bare COA account codes (e.g. "311") — codes collide across
    // tenants/orgs and pull unrelated journals into Profit groups.
    // Skip entirely when using xero_journal_details (group_account already stores Xero GUIDs).
    if (!usedXeroJournalDetails && hasCanonicalFinance && financeSourceId) {
      const { data: faRows, error: faErr } = await supabase
        .from("finance_accounts")
        .select("id, canonical_account_code, attributes_json")
        .eq("organization_id", organizationId)
        .eq("source_id", financeSourceId);

      if (!faErr && faRows?.length) {
        const allLocationsGroups = !filterLocationId;
        const addKeys = (keys: string[], groupIds: number[]) => {
          for (const gid of groupIds) {
            for (const key of keys) {
              const k = key.toLowerCase();
              if (!k) continue;
              if (allLocationsGroups) {
                if (!groupsByAccount.has(k)) groupsByAccount.set(k, [gid]);
              } else {
                const existing = groupsByAccount.get(k) || [];
                if (!existing.includes(gid)) existing.push(gid);
                groupsByAccount.set(k, existing);
              }
            }
          }
        };

        for (const fa of faRows as any[]) {
          const canon = norm(fa.canonical_account_code);
          const idStr = norm(fa.id);
          // GUID / canonical account id only — do not add coa_account_code.
          const keys = [canon, idStr].filter((x) => !!x);
          const matchedGroupIds = new Set<number>();
          for (const key of keys) {
            const g = groupsByAccount.get(key.toLowerCase());
            if (g) for (const x of g) matchedGroupIds.add(x);
          }
          if (matchedGroupIds.size === 0) continue;
          const gidList = [...matchedGroupIds];
          addKeys(keys, gidList);
        }
      }
    }

    const { byGroupId: savedBenchByGroup } = await loadMergedBenchmarkPercents(
      supabase,
      organizationId,
      mappingIntegrationId
    );

    /** Same profit-benchmark aggregation for a journal slice (full range or one month). */
    const aggregateSlice = (sliceRows: LooseRow[]) => {
      let totalIncome = 0;
      let totalIncomeFallback = 0;
      const groupTotals = new Map<number, number>();
      const revenueTotals = new Map<number, number>();

      for (const row of sliceRows) {
        const acctId = norm(row.account_id);
        const acctCode = norm(row.account_code);
        const raw = num(row.amount);
        const signed = raw * (platformForSign === "xero" ? -1 : 1);

        const accType = norm(row.account_type);
        const isControl = Boolean((row as any).is_control);
        const isPl = isProfitLossType(accType);

        if (isPl && !isControl && isRevenueAccountType(accType)) {
          totalIncomeFallback += toIncomeNet(signed, platformForSign);
        }

        const mappedRevenueIds = [
          ...new Set([
            ...(acctId ? revenueGroupsByAccount.get(acctId.toLowerCase()) || [] : []),
            ...(acctCode ? revenueGroupsByAccount.get(acctCode.toLowerCase()) || [] : []),
          ]),
        ];
        if (mappedRevenueIds.length && isPl && !isControl) {
          const incomeNet = toIncomeNet(signed, platformForSign);
          for (const rid of mappedRevenueIds) {
            revenueTotals.set(rid, (revenueTotals.get(rid) || 0) + incomeNet);
          }
        }

        const mappedGroupIds = [
          ...new Set([
            ...(acctId ? groupsByAccount.get(acctId.toLowerCase()) || [] : []),
            ...(acctCode ? groupsByAccount.get(acctCode.toLowerCase()) || [] : []),
          ]),
        ];
        if (mappedGroupIds.length && isPl && !isControl) {
          const expenseNet = toCostExpenseNet(signed, platformForSign);
          for (const groupId of mappedGroupIds) {
            groupTotals.set(groupId, (groupTotals.get(groupId) || 0) + expenseNet);
          }
        }
      }

      if (totalIncomeFallback > 0) {
        totalIncome = totalIncomeFallback;
      }

      const pickRevenue = (codes: string[], ids: number[]): number => {
        for (const [rid, amt] of revenueTotals.entries()) {
          const code = revenueCodeById.get(rid) || "";
          if (codes.includes(code) || ids.includes(rid)) return Number(amt) || 0;
        }
        return 0;
      };

      let privateIncome = pickRevenue(["privateincome"], [1]);
      let membershipIncome = pickRevenue(["membershipincome"], [2]);
      let nhsIncome = pickRevenue(["nhsincome"], [3]);
      for (const [rid, amt] of revenueTotals.entries()) {
        const code = revenueCodeById.get(rid) || "";
        if (["privateincome", "membershipincome", "nhsincome"].includes(code) || [1, 2, 3].includes(rid)) {
          continue;
        }
        privateIncome += Number(amt) || 0;
      }

      const revenueMappedSum = privateIncome + membershipIncome + nhsIncome;
      if (revenueMappedSum > 0) {
        totalIncome = revenueMappedSum;
      } else if (totalIncome > 0) {
        privateIncome = totalIncome;
        membershipIncome = 0;
        nhsIncome = 0;
      }

      const round2 = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(2)) : 0);
      privateIncome = round2(privateIncome);
      membershipIncome = round2(membershipIncome);
      nhsIncome = round2(nhsIncome);

      const orderedGroupIds = [...groupNameById.keys()].sort((a, b) => {
        const typeDiff = (groupTypeById.get(a) || 2) - (groupTypeById.get(b) || 2);
        if (typeDiff !== 0) return typeDiff;
        return (groupOrderById.get(a) || 0) - (groupOrderById.get(b) || 0);
      });
      const totalExpense = orderedGroupIds.reduce((sum, gid) => sum + (groupTotals.get(gid) || 0), 0);
      const profitAmount = totalIncome - totalExpense;
      const profitPct = pct(profitAmount, totalIncome);

      const sumExpenseBenchmarks = orderedGroupIds.reduce((sum, gid) => {
        const b = savedBenchByGroup.has(gid) ? Number(savedBenchByGroup.get(gid)) || 0 : 0;
        return sum + b;
      }, 0);
      const derivedProfitBenchmark = Math.max(0, Math.min(100, 100 - sumExpenseBenchmarks));

      const rows = orderedGroupIds.map((gid) => {
        const name = groupNameById.get(gid) || "";
        const amount = groupTotals.get(gid) || 0;
        const currentPct = pct(amount, totalIncome);
        const bench = savedBenchByGroup.has(gid) ? savedBenchByGroup.get(gid)! : 0;
        return {
          metric: `${name} %`,
          groupAccountMasterId: gid,
          groupType: groupTypeById.get(gid) ?? 2,
          isProfitRow: false,
          current: Number.isFinite(currentPct) ? Number(currentPct.toFixed(2)) : 0,
          actualAmount: Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0,
          benchmark: Number.isFinite(bench) ? Number(bench.toFixed(2)) : 0,
          group: Number.isFinite(bench) ? Number(bench.toFixed(2)) : 0,
          _revenueChair: totalIncome,
          _ebitdaMargin: profitPct,
        };
      });

      rows.push({
        metric: "PROFIT %",
        groupAccountMasterId: null as any,
        groupType: null as any,
        isProfitRow: true,
        current: Number.isFinite(profitPct) ? Number(profitPct.toFixed(2)) : 0,
        actualAmount: Number.isFinite(profitAmount) ? Number(profitAmount.toFixed(2)) : 0,
        benchmark: Number.isFinite(derivedProfitBenchmark) ? Number(derivedProfitBenchmark.toFixed(2)) : 0,
        group: Number.isFinite(derivedProfitBenchmark) ? Number(derivedProfitBenchmark.toFixed(2)) : 0,
        _revenueChair: totalIncome,
        _ebitdaMargin: profitPct,
      });

      return {
        rows,
        totalIncome,
        privateIncome,
        membershipIncome,
        nhsIncome,
        revenueMappedSum,
        orderedGroupIds,
      };
    };

    // ── Monthly series (Group Dashboard trend): one journal fetch, bucket by month ──
    if (String(granularity || "").toLowerCase() === "month") {
      const monthKeys = enumerateMonYyKeys(fromDate, toDate);
      const byMonth = new Map<string, LooseRow[]>();
      for (const k of monthKeys) byMonth.set(k, []);
      for (const row of allRows) {
        const k = rowMonYy(row);
        if (!k || !byMonth.has(k)) continue;
        byMonth.get(k)!.push(row);
      }

      const monthly = monthKeys.map((key) => {
        const agg = aggregateSlice(byMonth.get(key) || []);
        const productionIncomeVal = Number.isFinite(agg.totalIncome)
          ? Number(agg.totalIncome.toFixed(2))
          : 0;
        return {
          monthKey: key,
          rows: agg.rows.map((r) => ({
            metric: r.metric,
            current: r.current,
            benchmark: r.benchmark,
            group: r.group,
            groupAccountMasterId: r.groupAccountMasterId ?? null,
            groupType: (r as any).groupType ?? null,
            isProfitRow: r.isProfitRow ?? false,
            actualAmount: (r as any).actualAmount ?? null,
          })),
          productionIncome: productionIncomeVal,
          incomeBreakdown: {
            privateIncome: agg.privateIncome,
            membershipIncome: agg.membershipIncome,
            nhsIncome: agg.nhsIncome,
            productionIncome: productionIncomeVal,
            fromRevenueMappings: agg.revenueMappedSum > 0,
          },
        };
      });

      return new Response(
        JSON.stringify({
          granularity: "month",
          monthly,
          platformIntegrationId: mappingIntegrationId,
          resultMsg: "Success",
          status: 8,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalIncome = 0;
    let totalIncomeFallback = 0;
    const groupTotals = new Map<number, number>();
    const revenueTotals = new Map<number, number>();

    for (const row of allRows) {
      const acctId = norm(row.account_id);
      const acctCode = norm(row.account_code);
      const raw = num(row.amount);
      const signed = raw * (platformForSign === "xero" ? -1 : 1);

      const accType = norm(row.account_type);
      const isControl = Boolean((row as any).is_control);
      const isPl = isProfitLossType(accType);

      // Production-income fallback from P&L revenue account types only (not cashflow CFO maps).
      if (isPl && !isControl && isRevenueAccountType(accType)) {
        totalIncomeFallback += toIncomeNet(signed, platformForSign);
      }

      const mappedRevenueIds = [
        ...new Set([
          ...(acctId ? revenueGroupsByAccount.get(acctId.toLowerCase()) || [] : []),
          ...(acctCode ? revenueGroupsByAccount.get(acctCode.toLowerCase()) || [] : []),
        ]),
      ];
      if (mappedRevenueIds.length && isPl && !isControl) {
        const incomeNet = toIncomeNet(signed, platformForSign);
        for (const rid of mappedRevenueIds) {
          revenueTotals.set(rid, (revenueTotals.get(rid) || 0) + incomeNet);
        }
      }

      // Cost/expense categories: Setup Categories (Profit) mappings only — never gated by cashflow CFO.
      const mappedGroupIds = [
        ...new Set([
          ...(acctId ? groupsByAccount.get(acctId.toLowerCase()) || [] : []),
          ...(acctCode ? groupsByAccount.get(acctCode.toLowerCase()) || [] : []),
        ]),
      ];
      if (mappedGroupIds.length && isPl && !isControl) {
        const expenseNet = toCostExpenseNet(signed, platformForSign);
        for (const groupId of mappedGroupIds) {
          groupTotals.set(groupId, (groupTotals.get(groupId) || 0) + expenseNet);
        }
      }
    }

    if (totalIncomeFallback > 0) {
      totalIncome = totalIncomeFallback;
    }

    const pickRevenue = (codes: string[], ids: number[]): number => {
      for (const [rid, amt] of revenueTotals.entries()) {
        const code = revenueCodeById.get(rid) || "";
        if (codes.includes(code) || ids.includes(rid)) return Number(amt) || 0;
      }
      return 0;
    };

    let privateIncome = pickRevenue(["privateincome"], [1]);
    let membershipIncome = pickRevenue(["membershipincome"], [2]);
    let nhsIncome = pickRevenue(["nhsincome"], [3]);
    // Sum any other group_type=1 masters into private so totals stay complete.
    for (const [rid, amt] of revenueTotals.entries()) {
      const code = revenueCodeById.get(rid) || "";
      if (["privateincome", "membershipincome", "nhsincome"].includes(code) || [1, 2, 3].includes(rid)) {
        continue;
      }
      privateIncome += Number(amt) || 0;
    }

    const revenueMappedSum = privateIncome + membershipIncome + nhsIncome;
    if (revenueMappedSum > 0) {
      totalIncome = revenueMappedSum;
    } else if (totalIncome > 0) {
      // No Profit Revenue mappings yet: show fallback revenue as Private.
      privateIncome = totalIncome;
      membershipIncome = 0;
      nhsIncome = 0;
    }

    const round2 = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(2)) : 0);
    privateIncome = round2(privateIncome);
    membershipIncome = round2(membershipIncome);
    nhsIncome = round2(nhsIncome);

    const orderedGroupIds = [...groupNameById.keys()].sort((a, b) => {
      const typeDiff = (groupTypeById.get(a) || 2) - (groupTypeById.get(b) || 2);
      if (typeDiff !== 0) return typeDiff;
      return (groupOrderById.get(a) || 0) - (groupOrderById.get(b) || 0);
    });
    const totalExpense = orderedGroupIds.reduce((sum, gid) => sum + (groupTotals.get(gid) || 0), 0);
    const profitAmount = totalIncome - totalExpense;
    const profitPct = pct(profitAmount, totalIncome);

    const sumExpenseBenchmarks = orderedGroupIds.reduce((sum, gid) => {
      const b = savedBenchByGroup.has(gid) ? Number(savedBenchByGroup.get(gid)) || 0 : 0;
      return sum + b;
    }, 0);
    /** Target net benchmark = remainder after expense budget % (not a separately stored profit %). */
    const derivedProfitBenchmark = Math.max(0, Math.min(100, 100 - sumExpenseBenchmarks));

    const rows = orderedGroupIds.map((gid) => {
      const name = groupNameById.get(gid) || "";
      const amount = groupTotals.get(gid) || 0;
      const currentPct = pct(amount, totalIncome);
      const bench = savedBenchByGroup.has(gid) ? savedBenchByGroup.get(gid)! : 0;
      return {
        metric: `${name} %`,
        groupAccountMasterId: gid,
        groupType: groupTypeById.get(gid) ?? 2,
        isProfitRow: false,
        current: Number.isFinite(currentPct) ? Number(currentPct.toFixed(2)) : 0,
        actualAmount: Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0,
        benchmark: Number.isFinite(bench) ? Number(bench.toFixed(2)) : 0,
        group: Number.isFinite(bench) ? Number(bench.toFixed(2)) : 0,
        _revenueChair: totalIncome,
        _ebitdaMargin: profitPct,
      };
    });

    rows.push({
      metric: "PROFIT %",
      groupAccountMasterId: null,
      groupType: null,
      isProfitRow: true,
      current: Number.isFinite(profitPct) ? Number(profitPct.toFixed(2)) : 0,
      actualAmount: Number.isFinite(profitAmount) ? Number(profitAmount.toFixed(2)) : 0,
      benchmark: Number.isFinite(derivedProfitBenchmark) ? Number(derivedProfitBenchmark.toFixed(2)) : 0,
      group: Number.isFinite(derivedProfitBenchmark) ? Number(derivedProfitBenchmark.toFixed(2)) : 0,
      _revenueChair: totalIncome,
      _ebitdaMargin: profitPct,
    });

    if (rows.length === 1 && orderedGroupIds.length === 0) {
      let totalPaid = 0;
      let clinicianCost = 0;
      let staffCost = 0;
      let labMaterialsCost = 0;
      let overheadCost = 0;
      let legacyIncome = 0;
      for (const row of allRows) {
        const dt = String(row.period_date || row.post_date || "");
        if (!monthKey(dt)) continue;
        const acctId = norm(row.account_id);
        const acctCode = norm(row.account_code);
        const mapped =
          (acctId && categoryByCode.get(acctId.toLowerCase())) ||
          (acctCode && categoryByCode.get(acctCode.toLowerCase()));
        if (!mapped) continue;
        const raw = num(row.amount);
        const signed = raw * (platformForSign === "xero" ? -1 : 1);
        const value = mapped.rangeSubGroup === "Payment" ? signed * -1 : signed;
        const categoryName = mapped.categoryName.toLowerCase();
        if (mapped.rangeSubGroup === "Income") {
          legacyIncome += signed;
        }
        if (mapped.rangeSubGroup === "Payment") {
          totalPaid += value;
          if (categoryName.includes("clinician")) clinicianCost += value;
          else if (categoryName.includes("staff")) staffCost += value;
          else if (categoryName.includes("lab") || categoryName.includes("material")) labMaterialsCost += value;
          else if (categoryName.includes("overhead")) overheadCost += value;
        }
      }
      const incomeBase = totalIncome > 0 ? totalIncome : legacyIncome;
      const ebitdaAmount = incomeBase - (clinicianCost + staffCost + labMaterialsCost + overheadCost);
      const netProfitAmount = incomeBase - totalPaid;
      const ebitdaMargin = pct(ebitdaAmount, incomeBase);
      const clinicianPct = pct(clinicianCost, incomeBase);
      const staffPct = pct(staffCost, incomeBase);
      const labPct = pct(labMaterialsCost, incomeBase);
      const overheadPct = pct(overheadCost, incomeBase);
      const netProfitPct = pct(netProfitAmount, incomeBase);
      rows.splice(
        0,
        rows.length,
        ...[
          { metric: "Revenue/Chair", groupAccountMasterId: null, isProfitRow: false, current: incomeBase, actualAmount: incomeBase },
          { metric: "EBITDA Margin", groupAccountMasterId: null, isProfitRow: false, current: ebitdaMargin, actualAmount: ebitdaAmount },
          { metric: "Clinician Cost %", groupAccountMasterId: null, isProfitRow: false, current: clinicianPct, actualAmount: clinicianCost },
          { metric: "Staff Cost %", groupAccountMasterId: null, isProfitRow: false, current: staffPct, actualAmount: staffCost },
          { metric: "Lab/Materials %", groupAccountMasterId: null, isProfitRow: false, current: labPct, actualAmount: labMaterialsCost },
          { metric: "Overhead %", groupAccountMasterId: null, isProfitRow: false, current: overheadPct, actualAmount: overheadCost },
          { metric: "Net Profit %", groupAccountMasterId: null, isProfitRow: false, current: netProfitPct, actualAmount: netProfitAmount },
        ].map((r) => ({
          metric: r.metric,
          groupAccountMasterId: r.groupAccountMasterId,
          isProfitRow: r.isProfitRow,
          current: Number.isFinite(r.current) ? Number(r.current.toFixed(2)) : 0,
          actualAmount: Number.isFinite((r as any).actualAmount) ? Number((r as any).actualAmount.toFixed(2)) : 0,
          benchmark: BENCHMARKS[r.metric]?.benchmark ?? 0,
          group: BENCHMARKS[r.metric]?.group ?? 0,
          _revenueChair: incomeBase,
          _ebitdaMargin: ebitdaMargin,
        }))
      );
    }

    let filtered = rows;
    if (revenueMin != null) filtered = filtered.filter((r) => (r._revenueChair ?? r.current) >= Number(revenueMin));
    if (revenueMax != null) filtered = filtered.filter((r) => (r._revenueChair ?? r.current) <= Number(revenueMax));
    if (ebitdaMarginMin != null) filtered = filtered.filter((r) => (r._ebitdaMargin ?? r.current) >= Number(ebitdaMarginMin));
    if (ebitdaMarginMax != null) filtered = filtered.filter((r) => (r._ebitdaMargin ?? r.current) <= Number(ebitdaMarginMax));

    const productionIncomeVal = Number.isFinite(totalIncome) ? Number(totalIncome.toFixed(2)) : 0;

    return new Response(
      JSON.stringify({
        rows: filtered.map((r) => ({
          metric: r.metric,
          current: r.current,
          benchmark: r.benchmark,
          group: r.group,
          groupAccountMasterId: r.groupAccountMasterId ?? null,
          groupType: (r as any).groupType ?? null,
          isProfitRow: r.isProfitRow ?? false,
          actualAmount: (r as any).actualAmount ?? null,
        })),
        productionIncome: productionIncomeVal,
        incomeBreakdown: {
          privateIncome,
          membershipIncome,
          nhsIncome,
          productionIncome: productionIncomeVal,
          fromRevenueMappings: revenueMappedSum > 0,
        },
        platformIntegrationId: mappingIntegrationId,
        resultMsg: "Success",
        status: 8,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("profit-benchmark error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        resultMsg: "Failed to process request",
        status: 0,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
