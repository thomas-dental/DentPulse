import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildDistinctCategoryAliasMap } from "../_shared/distinctSetupMaps.ts";
import {
  countJournalLinesForSource,
  fetchCanonicalRowsLikePlBsForCashflowReport,
  resolveActiveCanonicalFinanceSource,
} from "./cashflowCanonicalGl.ts";
import {
  fetchXeroJournalDetailsLikePlBsForCashflowReport,
  loadXeroBankAccountIdsForCashflow,
  resolveXeroTenantOrgRowId,
} from "./xeroJournalDetailsCashflow.ts";
import { resolveXeroTrackingScope } from "../_shared/xeroTrackingScope.ts";
import { getXeroTransactionLink } from "./accountingTransactionLinks.ts";
import { selectCashEffectKeys } from "./cashEffectFilter.ts";
import { isManualJournalType } from "./manualJournalFilter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normStringId(id: unknown): string {
  const s = id == null ? "" : String(id).trim();
  return s;
}

function getMonthKey(dateStr: string): string {
  // Prefer YYYY-MM-DD / YYYY-MM parsing to avoid UTC timezone month shifts.
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/** monthKey is YYYY-MM (monthly) or week-start YYYY-MM-DD (weekly). */
function dateMatchesPeriod(dateStr: string, periodKey: string): boolean {
  const d = String(dateStr || "").substring(0, 10);
  const key = String(periodKey || "").trim();
  if (!d || !key) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const start = new Date(`${key}T00:00:00`);
    if (Number.isNaN(start.getTime())) return false;
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    return d >= key && d <= endStr;
  }
  return getMonthKey(d) === key;
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

function isXeroBankAccountType(value: string): boolean {
  const t = (value || "").trim().toUpperCase();
  return t === "BANK" || t === "CREDITCARD";
}

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) out.push(arr.slice(i, i + chunkSize));
  return out;
}

function isInternalTransfer(row: Record<string, unknown>): boolean {
  const docClass = String(row.doc_class || "").toUpperCase();
  const desc = String(row.description || row.doc_description || "").toLowerCase();
  if (/TRANSFER|BANKTRANSFER/.test(docClass)) return true;
  if (/internal transfer|intra-?account|intra-?company|bank transfer between/.test(desc)) return true;
  return false;
}

interface CategoryInfo {
  locationId: string;
  name: string;
  rangeGroup: string;
  rangeSubGroup: string;
  rangeOrder: number;
}

interface DrilldownTransaction {
  date: string;
  /** @deprecated kept for older clients */
  docId: string;
  /** @deprecated kept for older clients */
  docClass: string;
  /** @deprecated kept for older clients */
  description: string;
  accountId?: string;
  accountCode?: string;
  accountName?: string;
  amountRaw: number;
  amountDisplay: number;
  isInternalTransfer: boolean;
  /** Pro-parity columns */
  transactionType: string;
  transactionLink: string;
  name: string;
  memoOrDescription: string;
  whoPaid: string;
  forWhat: string;
  moneyIn: number;
  moneyOut: number;
}

function buildCategoryAliasMap(
  categoryMapRows: { location_id: string; category_range_id: number; mapping_location_id?: string | null }[],
  categoryMasterRows: { id: number; name: string; range_group: string; range_sub_group: string; range_order: number }[],
  allLocations = false,
): Map<string, CategoryInfo> {
  return buildDistinctCategoryAliasMap(categoryMapRows, categoryMasterRows, {
    allLocations,
  }) as Map<string, CategoryInfo>;
}

async function resolveCategoryMappingIntegrationId(
  supabase: ReturnType<typeof createClient>,
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

    const body = (await req.json()) as {
      organizationId: string;
      fromDate: string;
      toDate: string;
      rangeGroup: string;
      rangeSubGroup: string; // Income | Payment
      categoryName: string; // category_range_master.name
      locationId: string; // row.id in cashflow-report VM (acct_id or acct_code)
      monthKey: string; // YYYY-MM (monthly) or week-start YYYY-MM-DD (weekly)
      /** Practice location filter from the statement page (optional). */
      practiceLocationId?: string | null;
    };

    const {
      organizationId,
      fromDate,
      toDate,
      rangeGroup,
      rangeSubGroup,
      categoryName,
      locationId,
      monthKey,
      practiceLocationId,
    } = body;

    if (
      !organizationId ||
      !fromDate ||
      !toDate ||
      !rangeGroup ||
      !rangeSubGroup ||
      !categoryName ||
      !locationId ||
      !monthKey
    ) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields",
          resultMsg:
            "organizationId, fromDate, toDate, rangeGroup, rangeSubGroup, categoryName, locationId, monthKey are required",
          transactionStatus: 0,
          returnObject: [],
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    const practiceLoc =
      practiceLocationId && practiceLocationId !== "all" ? String(practiceLocationId).trim() : null;

    // Resolve accounting connection for practice location (Xero/iplicit).
    let mappedIntegrationId: string | null = null;
    let mappedPlatformOrgId: string | null = null;
    if (practiceLoc) {
      const { data: mappingRows } = await supabase
        .from("platform_integration_organization_mapping")
        .select(`
          platform_integration_id,
          platform_integration_organizations!inner (
            platform_name,
            platform_org_id
          )
        `)
        .eq("organization_id", organizationId)
        .eq("location_id", practiceLoc);

      const mapped =
        (mappingRows || []).find((m: any) => m.platform_integration_organizations?.platform_name === "iplicit") ||
        (mappingRows || []).find((m: any) => m.platform_integration_organizations?.platform_name === "xero") ||
        (mappingRows || [])[0];
      mappedIntegrationId = mapped?.platform_integration_id ? String(mapped.platform_integration_id) : null;
      mappedPlatformOrgId = mapped?.platform_integration_organizations?.platform_org_id
        ? String(mapped.platform_integration_organizations.platform_org_id).trim()
        : null;
    }

    const { data: iplicitConnection } = await supabase
      .from("platform_integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "iplicit")
      .maybeSingle();
    const { data: xeroConnection } = await supabase
      .from("platform_integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "xero")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const preferredIntegrationId =
      mappedIntegrationId ?? iplicitConnection?.id ?? xeroConnection?.id ?? null;
    const platformIntegrationId = await resolveCategoryMappingIntegrationId(
      supabase,
      organizationId,
      preferredIntegrationId
    );

    // Category maps: practice location scoped, else combined per-location setups.
    let categoryMapQuery = supabase
      .from("category_range_map")
      .select("location_id, category_range_id, mapping_location_id")
      .eq("organization_id", organizationId);

    if (practiceLoc) {
      if (platformIntegrationId) {
        categoryMapQuery = categoryMapQuery.eq("platform_integration_id", platformIntegrationId);
      }
      categoryMapQuery = categoryMapQuery.eq("mapping_location_id", practiceLoc);
    } else {
      categoryMapQuery = categoryMapQuery.not("mapping_location_id", "is", null);
    }

    let { data: categoryMapRows } = await categoryMapQuery;
    if ((!categoryMapRows || categoryMapRows.length === 0) && practiceLoc) {
      const { data: locAnyIntegration } = await supabase
        .from("category_range_map")
        .select("location_id, category_range_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .eq("mapping_location_id", practiceLoc);
      categoryMapRows = locAnyIntegration ?? categoryMapRows;
    }
    if ((!categoryMapRows || categoryMapRows.length === 0)) {
      const { data: connectionLevelRows } = await supabase
        .from("category_range_map")
        .select("location_id, category_range_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .is("mapping_location_id", null);
      categoryMapRows = connectionLevelRows ?? categoryMapRows;
    }

    const { data: categoryMasterRows } = await supabase
      .from("category_range_master")
      .select("id, name, range_group, range_sub_group, range_order");

    let locationToCategory = new Map<string, CategoryInfo>();
    if (categoryMapRows?.length && categoryMasterRows?.length) {
      locationToCategory = buildCategoryAliasMap(
        categoryMapRows as {
          location_id: string;
          category_range_id: number;
          mapping_location_id?: string | null;
        }[],
        categoryMasterRows as {
          id: number;
          name: string;
          range_group: string;
          range_sub_group: string;
          range_order: number;
        }[],
        !practiceLoc, // All Locations → distinct account→category
      );
    }

    if (locationToCategory.size === 0) {
      return new Response(
        JSON.stringify({
          returnObject: [],
          transactionStatus: 0,
          resultMsg: "No category mappings configured",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const xeroIntegrationId =
      (mappedIntegrationId && mappedIntegrationId === xeroConnection?.id ? mappedIntegrationId : null) ||
      (platformIntegrationId && platformIntegrationId === xeroConnection?.id ? platformIntegrationId : null) ||
      (xeroConnection?.id ? String(xeroConnection.id) : null);

    const connId = iplicitConnection?.id ?? null;
    if (!connId && !xeroIntegrationId) {
      return new Response(
        JSON.stringify({
          returnObject: [],
          transactionStatus: 0,
          resultMsg: "No accounting integration found (Xero or iplicit)",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let financeSourceId: string | null = null;
    let hasCanonicalFinance = false;
    let canonicalPlatform: string | null = null;
    try {
      const resolved = await resolveActiveCanonicalFinanceSource(supabase, organizationId);
      financeSourceId = resolved.sourceId;
      canonicalPlatform = resolved.platform;
      hasCanonicalFinance = (resolved.lineCount ?? 0) > 0;
    } catch (e) {
      console.warn("[cashflow-category-drilldown] canonical availability check failed:", e);
    }

    // Alias expansion only for non-Xero canonical path. Never register bare COA codes.
    if (locationToCategory.size > 0 && !xeroIntegrationId && hasCanonicalFinance && financeSourceId) {
      const { data: canonicalAccounts } = await supabase
        .from("finance_accounts")
        .select("id, canonical_account_code, attributes_json")
        .eq("organization_id", organizationId)
        .eq("source_id", financeSourceId)
        .eq("is_active", true);

      for (const row of (canonicalAccounts || []) as {
        id: string;
        canonical_account_code: string | null;
        attributes_json?: { coa_account_code?: string | null } | null;
      }[]) {
        const aliases = [
          row.id,
          row.canonical_account_code || "",
        ]
          .map((v) => String(v || "").trim().toLowerCase())
          .filter(Boolean);
        const category = aliases.map((a) => locationToCategory.get(a)).find(Boolean);
        if (!category) continue;
        aliases.forEach((a) => locationToCategory.set(a, category));
      }
    }

    // 1) Bank accounts
    let bankAccountIds: string[] = [];
    let usedXeroJournalDetails = false;
    let xeroTenantOrgRowId: string | null = null;

    if (connId) {
      const { data: bankGroupsRaw, error: bankGroupsError } = await supabase
        .from("iplicit_coa_account_groups")
        .select("account_group_id,parent_coa_group_id,code")
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", connId)
        .eq("is_active", true);

      if (bankGroupsError) console.error("bankGroupsError:", bankGroupsError);

      const allGroups = (bankGroupsRaw || []) as {
        account_group_id?: string | null;
        parent_coa_group_id?: string | null;
        code?: string | null;
      }[];

      const rootBankIds = allGroups
        .filter((g) => (g.code || "").toUpperCase() === "BANK")
        .map((g) => g.account_group_id)
        .filter((id): id is string => !!id);

      const bankGroupIdSet = new Set<string>(rootBankIds);
      const queue: string[] = [...rootBankIds];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = allGroups.filter(
          (g) =>
            g.parent_coa_group_id === current &&
            g.account_group_id &&
            !bankGroupIdSet.has(g.account_group_id as string)
        );
        for (const child of children) {
          const id = child.account_group_id as string;
          bankGroupIdSet.add(id);
          queue.push(id);
        }
      }

      const bankGroupIds = Array.from(bankGroupIdSet);
      if (bankGroupIds.length > 0) {
        const { data: bankCoaRows, error: bankCoaError } = await supabase
          .from("iplicit_chart_of_accounts")
          .select("account_id")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connId)
          .in("coa_group_id", bankGroupIds)
          .eq("is_active", true);

        if (bankCoaError) console.error("bankCoaError:", bankCoaError);
        bankAccountIds = (bankCoaRows || [])
          .map((r: { account_id?: string | null }) => r.account_id)
          .filter((c): c is string => !!c);
      }
    }

    if ((!bankAccountIds.length || !hasCanonicalFinance) && xeroIntegrationId) {
      xeroTenantOrgRowId = await resolveXeroTenantOrgRowId(
        supabase,
        organizationId,
        xeroIntegrationId,
        mappedPlatformOrgId
      );
      if (!bankAccountIds.length) {
        bankAccountIds = await loadXeroBankAccountIdsForCashflow(
          supabase,
          organizationId,
          xeroIntegrationId,
          xeroTenantOrgRowId,
          mappedPlatformOrgId
        );
      }
    }

    // 2) Source rows: Xero journals → canonical → iplicit PL/BS.
    // Prefer xero_journal_details whenever Xero is connected — finance_journal_lines is
    // often a partial sync and will not match Xero / full journals.
    let allRows: Record<string, unknown>[] = [];
    if (xeroIntegrationId) {
      if (!xeroTenantOrgRowId) {
        xeroTenantOrgRowId = await resolveXeroTenantOrgRowId(
          supabase,
          organizationId,
          xeroIntegrationId,
          mappedPlatformOrgId
        );
      }
      allRows = await fetchXeroJournalDetailsLikePlBsForCashflowReport(
        supabase,
        organizationId,
        xeroIntegrationId,
        fromDate,
        toDate,
        xeroTenantOrgRowId,
        null,
        (
          await resolveXeroTrackingScope(
            supabase,
            organizationId,
            xeroIntegrationId,
            practiceLoc
          )
        ).trackingOptionIds
      );
      usedXeroJournalDetails = true;
      console.log("[cashflow-category-drilldown] using xero_journal_details", {
        rows: allRows.length,
        xeroIntegrationId,
        xeroTenantOrgRowId,
      });
    }

    if (!allRows.length && hasCanonicalFinance && financeSourceId) {
      allRows = await fetchCanonicalRowsLikePlBsForCashflowReport(
        supabase,
        organizationId,
        financeSourceId,
        fromDate,
        toDate
      );
      console.log("[cashflow-category-drilldown] using finance_journal_lines (canonical fallback)", {
        rows: allRows.length,
        financeSourceId,
        platform: canonicalPlatform,
      });
    }

    if (!allRows.length && connId) {
      const [plRes1, plRes2, bsRes1, bsRes2] = await Promise.all([
        supabase
          .from("iplicit_profit_loss")
          .select(
            "doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description"
          )
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connId)
          .not("period_date", "is", null)
          .gte("period_date", fromDate)
          .lte("period_date", toDate),
        supabase
          .from("iplicit_profit_loss")
          .select(
            "doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description"
          )
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connId)
          .is("period_date", null)
          .gte("post_date", fromDate)
          .lte("post_date", toDate),
        supabase
          .from("iplicit_balance_sheet")
          .select(
            "doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description"
          )
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connId)
          .not("post_date", "is", null)
          .gte("post_date", fromDate)
          .lte("post_date", toDate),
        supabase
          .from("iplicit_balance_sheet")
          .select(
            "doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description"
          )
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connId)
          .is("post_date", null)
          .gte("period_date", fromDate)
          .lte("period_date", toDate),
      ]);

      const plError = plRes1.error || plRes2.error;
      const bsError = bsRes1.error || bsRes2.error;
      if (plError || bsError) {
        const err = plError || bsError;
        return new Response(
          JSON.stringify({
            error: err?.message ?? "Failed to fetch iplicit data",
            returnObject: [],
            transactionStatus: 0,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      allRows = [
        ...(plRes1.data || []),
        ...(plRes2.data || []),
        ...(bsRes1.data || []),
        ...(bsRes2.data || []),
      ] as Record<string, unknown>[];
    }

    // 3) Invoice-linked filter (iplicit only)
    const bankAccountIdSet = new Set(bankAccountIds.map(normStringId).filter((s) => !!s));
    const bankDocIds = new Set<string>();
    for (const r of allRows) {
      const acctId = normStringId(r.account_id);
      if (!acctId) continue;
      if (bankAccountIdSet.has(acctId) || (usedXeroJournalDetails && isXeroBankAccountType(String(r.account_type || "")))) {
        const docId = normStringId(r.doc_id);
        if (docId) bankDocIds.add(docId);
      }
    }

    const invoiceDocIds = new Set<string>();
    if (connId) {
      const bankDocIdArr = Array.from(bankDocIds);
      const ALLOC_CHUNK = 200;
      for (const chunk of chunkArray(bankDocIdArr, ALLOC_CHUNK)) {
        const [
          { data: receiptAllocRows, error: receiptAllocError },
          { data: paymentAllocRows, error: paymentAllocError },
        ] = await Promise.all([
          supabase
            .from("iplicit_receipt_allocations")
            .select("receipt_id, doc_id")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connId)
            .in("receipt_id", chunk),
          supabase
            .from("iplicit_payment_allocations")
            .select("payment_id, doc_id")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connId)
            .in("payment_id", chunk),
        ]);

        if (receiptAllocError) console.error("receiptAllocError:", receiptAllocError);
        if (paymentAllocError) console.error("paymentAllocError:", paymentAllocError);

        (receiptAllocRows || []).forEach((a: any) => {
          const invId = normStringId(a.doc_id);
          if (invId) invoiceDocIds.add(invId);
        });
        (paymentAllocRows || []).forEach((a: any) => {
          const invId = normStringId(a.doc_id);
          if (invId) invoiceDocIds.add(invId);
        });
      }
    }

    // 4) Non-bank rows
    const nonBankRowsBase = allRows.filter((row: Record<string, unknown>) => {
      const acctId = normStringId(row.account_id);
      if (!acctId) return false;
      if (bankAccountIdSet.has(acctId)) return false;
      if (usedXeroJournalDetails && isXeroBankAccountType(String(row.account_type || ""))) return false;
      return true;
    });

    let nonBankRows = nonBankRowsBase;
    if (invoiceDocIds.size > 0) {
      const invoiceFilteredRows = nonBankRowsBase.filter((row: Record<string, unknown>) => {
        const docId = normStringId(row.doc_id);
        if (!docId) return false;
        return invoiceDocIds.has(docId);
      });
      nonBankRows = invoiceFilteredRows.length > 0 ? invoiceFilteredRows : nonBankRowsBase;
    }

    // 5) COA metadata
    const uniqueAccountIds = Array.from(
      new Set(nonBankRows.map((r) => normStringId(r.account_id)).filter((s) => !!s))
    );

    const accountNameById: Record<string, string> = {};
    const accountTypeById: Record<string, string> = {};
    const accountIsControlById: Record<string, boolean> = {};

    const COA_CHUNK = 150;
    if (usedXeroJournalDetails) {
      for (const row of nonBankRows) {
        const id = normStringId(row.account_id);
        if (!id) continue;
        const name = String(row.account_name || "").trim();
        const typ = String(row.account_type || "").trim();
        if (name && !accountNameById[id]) accountNameById[id] = name;
        if (typ && !accountTypeById[id]) accountTypeById[id] = typ;
      }
      if (xeroIntegrationId) {
        for (const chunk of chunkArray(uniqueAccountIds, COA_CHUNK)) {
          const { data: coaRows, error: coaError } = await supabase
            .from("xero_chart_of_accounts")
            .select("xero_account_id, account_name, account_type")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", xeroIntegrationId)
            .in("xero_account_id", chunk);
          if (coaError) {
            console.warn("[cashflow-category-drilldown] xero COA:", coaError.message);
            continue;
          }
          for (const r of (coaRows || []) as any[]) {
            const id = normStringId(r.xero_account_id);
            if (!id) continue;
            if (typeof r.account_name === "string" && r.account_name.trim() && !accountNameById[id]) {
              accountNameById[id] = r.account_name.trim();
            }
            if (typeof r.account_type === "string" && r.account_type.trim() && !accountTypeById[id]) {
              accountTypeById[id] = r.account_type.trim();
            }
          }
        }
      }
    } else if (hasCanonicalFinance && financeSourceId) {
      for (const chunk of chunkArray(uniqueAccountIds, COA_CHUNK)) {
        const { data: faRows, error: faError } = await supabase
          .from("finance_accounts")
          .select("canonical_account_code, account_name, account_type, attributes_json")
          .eq("organization_id", organizationId)
          .eq("source_id", financeSourceId)
          .in("canonical_account_code", chunk);

        if (faError) {
          console.error("finance_accounts drilldown metadata error:", faError);
          continue;
        }
        for (const r of (faRows || []) as any[]) {
          const id = normStringId(r.canonical_account_code);
          if (!id) continue;
          if (typeof r.account_name === "string" && r.account_name.trim()) {
            accountNameById[id] = r.account_name.trim();
          }
          if (typeof r.account_type === "string" && r.account_type.trim()) {
            accountTypeById[id] = r.account_type.trim();
          }
          const attrs = (r.attributes_json || {}) as {
            coa_is_ar_account?: boolean | null;
            coa_is_ap_account?: boolean | null;
          };
          accountIsControlById[id] = Boolean(attrs.coa_is_ar_account) || Boolean(attrs.coa_is_ap_account);
        }
      }
    } else if (connId) {
      for (const chunk of chunkArray(uniqueAccountIds, COA_CHUNK)) {
        const { data: coaRows, error: coaError } = await supabase
          .from("iplicit_chart_of_accounts")
          .select("account_id, name, ap_flag, ar_flag, account_type")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connId)
          .in("account_id", chunk);

        if (coaError) console.error("coaError:", coaError);
        for (const r of (coaRows || []) as any[]) {
          const id = normStringId(r.account_id);
          if (!id) continue;
          if (typeof r.name === "string" && r.name.trim()) accountNameById[id] = r.name.trim();
          if (typeof r.account_type === "string" && r.account_type.trim()) {
            accountTypeById[id] = r.account_type.trim();
          }
          accountIsControlById[id] = Boolean(r.ap_flag) || Boolean(r.ar_flag);
        }
      }
    }

    const requestedLocationId = normStringId(locationId).toLowerCase();
    const flipXeroSigns =
      (hasCanonicalFinance && canonicalPlatform === "xero") || usedXeroJournalDetails;

    type MatchedRow = {
      row: Record<string, unknown>;
      acctId: string;
      acctCode: string;
      dateStr: string;
      rawAmount: number;
      amountDisplay: number;
      docId: string;
      description: string;
      accountName: string;
    };

    const matched: MatchedRow[] = [];

    for (const row of nonBankRows) {
      const acctId = normStringId(row.account_id);
      const acctCode = normStringId(row.account_code);

      if (!acctId && !acctCode) continue;

      const isControl = acctId ? (accountIsControlById[acctId] ?? false) : false;
      if (isControl) continue;

      const category =
        (acctId ? locationToCategory.get(acctId.toLowerCase()) : undefined) ??
        (acctCode ? locationToCategory.get(acctCode.toLowerCase()) : undefined);
      if (!category) continue;

      // Mapped cashflow categories (CFI/CFF/Tax) include BS account types — do not require P&L.
      const accType = (
        (acctId && accountTypeById[acctId]) ||
        String(row.account_type || "")
      ).toUpperCase();
      if (accType === "BANK" || accType === "CREDITCARD") continue;

      if (category.rangeGroup !== rangeGroup) continue;
      if (category.rangeSubGroup !== rangeSubGroup) continue;
      if (category.name !== categoryName) continue;

      const locationComputedId = (acctId || acctCode || "").toLowerCase();
      if (locationComputedId !== requestedLocationId) continue;

      const dateStr = String(row.period_date || row.post_date || "");
      if (!dateMatchesPeriod(dateStr, monthKey)) continue;

      const sourceAmount = parseFloat(String(row.amount ?? 0)) || 0;
      const rawAmount = flipXeroSigns ? sourceAmount * -1 : sourceAmount;
      const amountDisplay = rangeSubGroup === "Payment" ? rawAmount * -1 : rawAmount;

      matched.push({
        row,
        acctId,
        acctCode,
        dateStr,
        rawAmount,
        amountDisplay,
        docId: normStringId(row.doc_id),
        description: String(row.description || row.doc_description || "").trim(),
        accountName:
          (acctId && accountNameById[acctId]) ||
          String(row.account_name || "").trim() ||
          acctCode ||
          "—",
      });
    }

    // Xero enrichment: journal headers (type/link/name) + sibling bank lines (Who Paid)
    const journalHeaderById = new Map<
      string,
      { sourceType: string; sourceTypeDesc: string; sourceId: string; contactName: string; reference: string }
    >();
    const whoPaidByJournalId = new Map<string, string>();

    if (usedXeroJournalDetails && xeroIntegrationId && matched.length > 0) {
      const platformJournalIds = [
        ...new Set(matched.map((m) => m.docId).filter(Boolean)),
      ];
      const IN_CHUNK = 150;
      for (let i = 0; i < platformJournalIds.length; i += IN_CHUNK) {
        const chunk = platformJournalIds.slice(i, i + IN_CHUNK);
        let hq = supabase
          .from("xero_journals")
          .select("journal_id, source_type, source_type_desc, source_id, reference, contact_name")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", xeroIntegrationId)
          .in("journal_id", chunk);
        const { data: headers, error: hErr } = await hq;
        if (hErr) {
          console.warn("[cashflow-category-drilldown] journal headers:", hErr.message);
          continue;
        }
        for (const h of headers || []) {
          const jid = normStringId((h as { journal_id?: string }).journal_id);
          if (!jid) continue;
          journalHeaderById.set(jid, {
            sourceType: String((h as { source_type?: string }).source_type || "").trim(),
            sourceTypeDesc: String((h as { source_type_desc?: string }).source_type_desc || "").trim(),
            sourceId: String((h as { source_id?: string }).source_id || "").trim(),
            contactName: String((h as { contact_name?: string }).contact_name || "").trim(),
            reference: String((h as { reference?: string }).reference || "").trim(),
          });
        }
      }

      const bankIdSet = new Set(bankAccountIds.map((id) => id.toLowerCase()));
      for (let i = 0; i < platformJournalIds.length; i += IN_CHUNK) {
        const chunk = platformJournalIds.slice(i, i + IN_CHUNK);
        let sq = supabase
          .from("xero_journal_details")
          .select("platform_journal_id, account_id, account_name, account_code, account_type")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", xeroIntegrationId)
          .in("platform_journal_id", chunk);
        if (xeroTenantOrgRowId) {
          sq = sq.eq("platform_integration_organization_id", xeroTenantOrgRowId);
        }
        const { data: siblings, error: sErr } = await sq;
        if (sErr) {
          console.warn("[cashflow-category-drilldown] siblings:", sErr.message);
          continue;
        }
        for (const s of siblings || []) {
          const pjId = normStringId((s as { platform_journal_id?: string }).platform_journal_id);
          const accId = normStringId((s as { account_id?: string }).account_id);
          const accType = String((s as { account_type?: string }).account_type || "").toUpperCase();
          const isBank =
            (accId && bankIdSet.has(accId.toLowerCase())) ||
            accType === "BANK" ||
            accType === "CREDITCARD";
          if (!pjId || !isBank || whoPaidByJournalId.has(pjId)) continue;
          const bankName =
            String((s as { account_name?: string }).account_name || "").trim() ||
            (accId && accountNameById[accId]) ||
            String((s as { account_code?: string }).account_code || "").trim() ||
            "—";
          whoPaidByJournalId.set(pjId, bankName);
        }
      }
    }

    const cashEffectKeys = selectCashEffectKeys(
      matched.map((m, idx) => ({
        key: `${m.docId || "row"}:${m.acctId || idx}:${m.rawAmount}:${idx}`,
        date: m.dateStr,
        amount: m.rawAmount,
        description: m.description,
      }))
    );
    const cashEffectMatched = matched.filter((m, idx) => {
      const key = `${m.docId || "row"}:${m.acctId || idx}:${m.rawAmount}:${idx}`;
      if (!cashEffectKeys.has(key)) return false;
      const header = m.docId ? journalHeaderById.get(m.docId) : undefined;
      if (header && isManualJournalType(header.sourceType, header.sourceTypeDesc)) return false;
      return true;
    });

    console.log("[cashflow-category-drilldown] cash-effect.filter", {
      before: matched.length,
      after: cashEffectMatched.length,
      dropped: matched.length - cashEffectMatched.length,
    });

    const drilldownTransactions: DrilldownTransaction[] = cashEffectMatched.map((m) => {
      const header = m.docId ? journalHeaderById.get(m.docId) : undefined;
      const sourceType = header?.sourceType || String(m.row.doc_class || "").trim();
      const transactionType =
        header?.sourceTypeDesc ||
        sourceType ||
        String(m.row.doc_class || "").trim() ||
        "Journal";
      const linkId =
        header?.sourceId ||
        (sourceType.toUpperCase().replace(/\s+/g, "") === "MANUALJOURNAL" ? m.docId : "");
      const transactionLink =
        usedXeroJournalDetails || canonicalPlatform === "xero"
          ? getXeroTransactionLink(sourceType || transactionType, linkId)
          : "#";

      const name =
        header?.contactName ||
        m.description ||
        header?.reference ||
        "—";
      const memoOrDescription = m.description || header?.reference || "—";
      const whoPaid = (m.docId && whoPaidByJournalId.get(m.docId)) || "—";
      const forWhat = m.accountName || "—";
      const moneyIn = Math.max(m.rawAmount, 0);
      const moneyOut = Math.max(-m.rawAmount, 0);

      return {
        date: m.dateStr,
        docId: m.docId,
        docClass: transactionType,
        description: memoOrDescription,
        accountId: m.acctId || undefined,
        accountCode: m.acctCode || undefined,
        accountName: m.accountName,
        amountRaw: m.rawAmount,
        amountDisplay: m.amountDisplay,
        isInternalTransfer: isInternalTransfer(m.row),
        transactionType,
        transactionLink,
        name,
        memoOrDescription,
        whoPaid,
        forWhat,
        moneyIn,
        moneyOut,
      };
    });

    drilldownTransactions.sort(
      (a, b) => a.date.localeCompare(b.date) || a.docId.localeCompare(b.docId)
    );

    console.log("[cashflow-category-drilldown] result", {
      practiceLoc,
      usedXeroJournalDetails,
      hasCanonicalFinance,
      allRows: allRows.length,
      nonBankRows: nonBankRows.length,
      matched: drilldownTransactions.length,
      categoryName,
      monthKey,
      accountId: locationId,
    });

    return new Response(
      JSON.stringify({
        returnObject: drilldownTransactions,
        transactionStatus: 8,
        resultMsg: "Success",
        accountingPlatform: usedXeroJournalDetails || canonicalPlatform === "xero"
          ? "xero"
          : connId
            ? "iplicit"
            : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("cashflow-category-drilldown-report error:", err);
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
