import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildDistinctCategoryAliasMap } from "../_shared/distinctSetupMaps.ts";
import {
  fetchCanonicalGlRowsLikeIplicit,
  fetchCanonicalRowsLikePlBsForCashflowReport,
  resolveActiveCanonicalFinanceSource,
} from "./cashflowCanonicalGl.ts";
import {
  buildBsAnchoredMonthlyBalances,
  dateToPriorMonthEnd,
  loadSetupBankAccountIds,
  loadXeroBsCashTotalsByMonthEnd,
  monthKeyToEndDate,
  periodClosingAsAt,
  priorMonthEndDate,
  resolveMappedPracticeXeroTenantOrgIds,
  resolveXeroTenantOrgUuid,
} from "./xeroBsCashBalances.ts";
import {
  fetchXeroJournalDetailsLikePlBsForCashflowReport,
  loadXeroBankAccountIdsForCashflow,
  resolveXeroTenantOrgRowId,
} from "./xeroJournalDetailsCashflow.ts";
import { resolveXeroTrackingScope } from "../_shared/xeroTrackingScope.ts";
import { fetchLiveXeroTrackingCashTotalsByDates } from "../_shared/xeroLiveTrackingCash.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ColData / RowData / CashflowReportVM – match frontend preparingCashflowStatementData */
interface ColData {
  column: string;
  value: number;
}
interface RowData {
  id?: string;
  name: string;
  colData: ColData[];
}
interface RowDataSet {
  id: number;
  header: string;
  rowData: RowData[];
  total?: RowData;
}
interface SubGroupDataSet {
  rowHeader: string;
  rowDataSet: RowDataSet[];
  total?: RowData;
}
interface TableGroupDataSet {
  type: string;
  subGroupDataSet: SubGroupDataSet[];
  total?: RowData;
}
interface CashflowReportVM {
  currencySymbol: string;
  columns: string[];
  tableGroupDataSet: TableGroupDataSet[];
  totalRowDataSet: RowData[];
}

function getMonthKey(dateStr: string): string {
  // Prefer calendar YYYY-MM from the date string — avoid `new Date('YYYY-MM-DD')`
  // UTC parsing shifting the month in non-UTC environments (Feb 1 → Jan 31).
  const iso = String(dateStr || "").substring(0, 10);
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = d.getMonth();
  return `${y}-${String(mo + 1).padStart(2, "0")}`;
}

/** Build list of month keys and labels between fromDate and toDate (label format MMM-yy to match GetCashflowReport.sql) */
function getMonthColumns(fromDate: string, toDate: string): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  // Parse as local calendar dates (append T00:00:00) to avoid UTC day-shift.
  const from = new Date(`${String(fromDate).substring(0, 10)}T00:00:00`);
  const to = new Date(`${String(toDate).substring(0, 10)}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return out;
  const start = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const yy = String(y).slice(-2);
    out.push({ key, label: `${MONTH_NAMES[m - 1]}-${yy}` });
  }
  return out;
}

function startOfWeekMonday(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay(); // 0=Sun … 6=Sat
  const diff = (day + 6) % 7; // Mon=0
  r.setDate(r.getDate() - diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday-start week columns; key = week-start YYYY-MM-DD; label = "29 Dec–4 Jan". */
function getWeekColumns(fromDate: string, toDate: string): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return out;
  let cur = startOfWeekMonday(from);
  const last = startOfWeekMonday(to);
  while (cur <= last) {
    const weekEnd = new Date(cur);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const key = ymdLocal(cur);
    const label = `${cur.getDate()} ${MONTH_NAMES[cur.getMonth()]}–${weekEnd.getDate()} ${MONTH_NAMES[weekEnd.getMonth()]}`;
    out.push({ key, label });
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 7);
  }
  return out;
}

type PeriodGranularity = "monthly" | "weekly";

function getPeriodColumns(
  fromDate: string,
  toDate: string,
  granularity: PeriodGranularity
): { key: string; label: string }[] {
  return granularity === "weekly"
    ? getWeekColumns(fromDate, toDate)
    : getMonthColumns(fromDate, toDate);
}

function getPeriodKey(dateStr: string, granularity: PeriodGranularity): string {
  const d = String(dateStr || "").substring(0, 10);
  if (!d || d.length < 8) return "";
  if (granularity === "weekly") {
    const dt = new Date(`${d}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return "";
    return ymdLocal(startOfWeekMonday(dt));
  }
  return getMonthKey(d);
}

function normStringId(id: unknown): string {
  const s = id == null ? '' : String(id).trim();
  return s;
}

function isProfitLossType(value: string): boolean {
  const t = (value || "").trim().toUpperCase();
  if (!t) return true; // keep legacy permissive behavior when type is missing
  if (t === "PL" || t === "P&L") return true;
  if (t.includes("PROFIT") && t.includes("LOSS")) return true;
  if (t.includes("INCOME")) return true;
  if (t.includes("EXPENSE")) return true;
  // Xero canonical / journal-detail types commonly used for P&L accounts.
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

/** Section for journal activity on accounts not mapped in Setup Categories. */
const UNCATEGORIZED_RANGE_GROUP = "UNCATEGORIZED";
const UNCATEGORIZED_RANGE_ORDER = 9999;

function formatUncategorizedAccountLabel(
  accountName: string,
  accountCode: string,
  accountType: string,
  fallbackId: string
): string {
  const name = (accountName || "").trim();
  const code = (accountCode || "").trim();
  const type = (accountType || "").trim().toUpperCase();
  const base =
    code && name && code !== name
      ? `${code} - ${name}`
      : name || code || fallbackId || "—";
  if (!type || type === "OTHER") return base;
  return `${base} (${type})`;
}

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) out.push(arr.slice(i, i + chunkSize));
  return out;
}

/** Category from category_range_map + category_range_master (reference: GetCashflowReport.sql) */
interface CategoryInfo {
  locationId: string;
  name: string;
  rangeGroup: string;
  rangeSubGroup: string;
  rangeOrder: number;
}

/** Aggregated row for category-based cashflow: (rangeGroup, rangeSubGroup, categoryName, location) -> amounts by month */
interface AggregatedRow {
  rangeGroup: string;
  rangeSubGroup: string;
  categoryName: string;
  location: string;
  locationId: string;
  rangeOrder: number;
  amountsByMonth: Record<string, number>;
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

const TOTAL_COLUMN_LABEL = "Total";

function monthOnlyColData(colData: ColData[]): ColData[] {
  return colData.filter((c) => c.column !== TOTAL_COLUMN_LABEL);
}

/** Row totals match DentPulse V2.0: sum months; opening = first month; closing = last month. */
function cashflowRowTotalValue(colData: ColData[], rowName?: string): number {
  const months = monthOnlyColData(colData);
  if (rowName === "Opening Balance") return months[0]?.value ?? 0;
  if (rowName === "Closing Balance") return months[months.length - 1]?.value ?? 0;
  return months.reduce((sum, c) => sum + (c.value ?? 0), 0);
}

function withCashflowRowTotal(colData: ColData[], rowName?: string): ColData[] {
  const months = monthOnlyColData(colData);
  return [...months, { column: TOTAL_COLUMN_LABEL, value: cashflowRowTotalValue(months, rowName) }];
}

function mapRowWithTotal(row: RowData): RowData {
  return { ...row, colData: withCashflowRowTotal(row.colData, row.name) };
}

function enrichCashflowReportWithTotalColumn(report: CashflowReportVM): CashflowReportVM {
  if (report.columns.includes(TOTAL_COLUMN_LABEL)) return report;
  const monthColumns = report.columns.filter((c) => c !== TOTAL_COLUMN_LABEL);
  return {
    ...report,
    columns: [...monthColumns, TOTAL_COLUMN_LABEL],
    totalRowDataSet: report.totalRowDataSet.map(mapRowWithTotal),
    tableGroupDataSet: report.tableGroupDataSet.map((group) => ({
      ...group,
      total: group.total ? mapRowWithTotal(group.total) : undefined,
      subGroupDataSet: group.subGroupDataSet.map((sub) => ({
        ...sub,
        total: sub.total ? mapRowWithTotal(sub.total) : undefined,
        rowDataSet: sub.rowDataSet.map((rowSet) => ({
          ...rowSet,
          rowData: rowSet.rowData.map(mapRowWithTotal),
          total: rowSet.total ? mapRowWithTotal(rowSet.total) : undefined,
        })),
      })),
    })),
  };
}

/** Sum colData arrays by column (for computing totals) */
function sumColData(colDataArrays: ColData[][]): ColData[] {
  if (colDataArrays.length === 0) return [];
  const cols = colDataArrays[0].map((c) => c.column);
  return cols.map((col) => ({
    column: col,
    value: colDataArrays.reduce((sum, arr) => sum + (arr.find((x) => x.column === col)?.value ?? 0), 0),
  }));
}

/** Build hierarchical tableGroupDataSet from aggregated rows (reference: CashflowService.SetCashflowTableValue) */
function buildTableGroupFromAggregated(
  aggregated: AggregatedRow[],
  monthCols: { key: string; label: string }[]
): TableGroupDataSet[] {
  const groups = new Map<string, TableGroupDataSet>();
  const groupOrder = new Map<string, number>();
  for (const row of aggregated) {
    if (!groups.has(row.rangeGroup)) {
      groups.set(row.rangeGroup, {
        type: row.rangeGroup,
        subGroupDataSet: [],
        total: { name: `NET ${row.rangeGroup}:`, colData: monthCols.map((c) => ({ column: c.label, value: 0 })) },
      });
      groupOrder.set(row.rangeGroup, row.rangeOrder ?? 0);
    } else {
      groupOrder.set(
        row.rangeGroup,
        Math.min(groupOrder.get(row.rangeGroup) ?? 0, row.rangeOrder ?? 0)
      );
    }
    const group = groups.get(row.rangeGroup)!;
    let subGroup = group.subGroupDataSet.find((s) => s.rowHeader === row.rangeSubGroup);
    if (!subGroup) {
      const hasSubGroupTotal =
        row.rangeGroup === "CASH FLOW FROM OPERATIONS" &&
        (row.rangeSubGroup === "Payment" || row.rangeSubGroup === "Income");
      subGroup = {
        rowHeader: row.rangeSubGroup,
        rowDataSet: [],
        ...(hasSubGroupTotal && { total: { name: `Total ${row.rangeSubGroup}:`, colData: monthCols.map((c) => ({ column: c.label, value: 0 })) } }),
      };
      group.subGroupDataSet.push(subGroup);
    }
    let rowSet = subGroup.rowDataSet.find((r) => r.header === row.categoryName);
    if (!rowSet) {
      const isUncategorized = row.rangeGroup === UNCATEGORIZED_RANGE_GROUP;
      rowSet = {
        id: groups.size + subGroup.rowDataSet.length,
        header: row.categoryName,
        rowData: [],
        // Flat Uncategorized list — no per-account "Total …" rows.
        ...(!isUncategorized && {
          total: {
            name: `Total ${row.categoryName}:`,
            colData: monthCols.map((c) => ({ column: c.label, value: 0 })),
          },
        }),
      };
      subGroup.rowDataSet.push(rowSet);
    }
    const colData: ColData[] = monthCols.map((c) => {
      const v = row.amountsByMonth[c.key] ?? 0;
      if (row.rangeSubGroup !== "Payment") {
        return { column: c.label, value: v };
      }
      return {
        column: c.label,
        value: v * -1,
      };
    });
    rowSet.rowData.push({
      id: row.locationId,
      name: row.location || "—",
      colData,
    });
  }

  // Compute totals: RowDataSet.total, SubGroupDataSet.total, TableGroupDataSet.total
  for (const group of groups.values()) {
    const isUncategorizedGroup = group.type === UNCATEGORIZED_RANGE_GROUP;
    let groupSum: ColData[] = monthCols.map((c) => ({ column: c.label, value: 0 }));
    const subTotalsByRowHeader = new Map<string, ColData[]>();
    for (const subGroup of group.subGroupDataSet) {
      let subSum: ColData[] = monthCols.map((c) => ({ column: c.label, value: 0 }));
      for (const rowSet of subGroup.rowDataSet) {
        const catTotal = sumColData(rowSet.rowData.map((r) => r.colData));
        if (!isUncategorizedGroup && rowSet.total) {
          rowSet.total = { ...rowSet.total, colData: catTotal };
        } else if (isUncategorizedGroup) {
          // Flat account list — no category sub-totals
          delete (rowSet as { total?: unknown }).total;
        }
        for (let i = 0; i < subSum.length; i++) {
          subSum[i].value += catTotal[i]?.value ?? 0;
        }
      }
      if (subGroup.total) subGroup.total = { ...subGroup.total, colData: subSum };
      subTotalsByRowHeader.set(subGroup.rowHeader, subSum);
      for (let i = 0; i < groupSum.length; i++) {
        groupSum[i].value += subSum[i]?.value ?? 0;
      }
    }
    if (group.total) {
      if (isUncategorizedGroup) {
        group.total = { name: "NET UNCATEGORIZED:", colData: groupSum };
      } else {
      const income = subTotalsByRowHeader.get("Income");
      const payment = subTotalsByRowHeader.get("Payment");
      if (income && payment) {
        group.total = {
          ...group.total,
          colData: monthCols.map((c, i) => ({
            column: c.label,
            value: (income[i]?.value ?? 0) - (payment[i]?.value ?? 0),
          })),
        };
      } else {
        group.total = { ...group.total, colData: groupSum };
      }
      }
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => (groupOrder.get(a.type) ?? 0) - (groupOrder.get(b.type) ?? 0)
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as {
      organizationId: string;
      fromDate: string;
      toDate: string;
      locationId?: string | null;
      periodGranularity?: PeriodGranularity | string | null;
    };
    const { organizationId, fromDate, toDate, locationId } = body;
    const periodGranularity: PeriodGranularity =
      String(body.periodGranularity || "monthly").toLowerCase() === "weekly"
        ? "weekly"
        : "monthly";

    if (!organizationId || !fromDate || !toDate) {
      return new Response(
        JSON.stringify({ error: "Missing organizationId, fromDate or toDate", transactionStatus: 0, returnObject: null, resultMsg: "Bad request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const monthCols = getPeriodColumns(fromDate, toDate, periodGranularity);
    if (monthCols.length === 0) {
      return new Response(
        JSON.stringify({
          returnObject: null,
          transactionStatus: 0,
          resultMsg: "No cashflow data available for the selected period.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const receivedByMonth: Record<string, number> = {};
    const paidByMonth: Record<string, number> = {};
    const receivedInternalTransferByMonth: Record<string, number> = {};
    const paidInternalTransferByMonth: Record<string, number> = {};
    for (const col of monthCols) {
      receivedByMonth[col.key] = 0;
      paidByMonth[col.key] = 0;
      receivedInternalTransferByMonth[col.key] = 0;
      paidInternalTransferByMonth[col.key] = 0;
    }

    let tableGroupDataSetFromCategory: TableGroupDataSet[] | null = null;

    // Resolve preferred integration by selected location mapping first.
    let mappedIntegrationId: string | null = null;
    let mappedPlatformOrgId: string | null = null;
    let mappedXeroTrackingOptionId: string | null = null;
    let mappedXeroTrackingCategoryId: string | null = null;
    if (locationId) {
      // Skip financially hidden locations (e.g. Saint Catherine's).
      // exclude_from_financial_display is optional until tracking-categories migration is applied.
      {
        const excl = await supabase
          .from("practice_locations")
          .select("exclude_from_financial_display")
          .eq("id", locationId)
          .maybeSingle();
        if (
          !excl.error &&
          (excl.data as { exclude_from_financial_display?: boolean } | null)?.exclude_from_financial_display
        ) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                monthColumns: [],
                tableGroupDataSet: [],
                message: "Location excluded from financial display",
              },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      // Prefer full select (with tracking columns). Fall back if migration not applied yet —
      // selecting missing columns returns null rows and zeros single-location cashflow.
      let mappingRows: any[] | null = null;
      {
        const full = await supabase
          .from("platform_integration_organization_mapping")
          .select(`
            platform_integration_id,
            xero_tracking_category_id,
            xero_tracking_option_id,
            platform_integration_organizations!inner (
              platform_name,
              platform_org_id
            )
          `)
          .eq("organization_id", organizationId)
          .eq("location_id", locationId);
        if (!full.error) {
          mappingRows = full.data;
        } else {
          console.warn(
            "[cashflow-report] mapping select with tracking cols failed; using legacy select:",
            full.error.message,
          );
          const legacy = await supabase
            .from("platform_integration_organization_mapping")
            .select(`
              platform_integration_id,
              platform_integration_organizations!inner (
                platform_name,
                platform_org_id
              )
            `)
            .eq("organization_id", organizationId)
            .eq("location_id", locationId);
          if (legacy.error) {
            console.warn("[cashflow-report] legacy mapping select failed:", legacy.error.message);
          }
          mappingRows = legacy.data;
        }
      }

      const mapped =
        (mappingRows || []).find((m: any) => m.platform_integration_organizations?.platform_name === "iplicit") ||
        (mappingRows || []).find((m: any) => m.platform_integration_organizations?.platform_name === "xero") ||
        (mappingRows || [])[0];
      mappedIntegrationId = mapped?.platform_integration_id ? String(mapped.platform_integration_id) : null;
      mappedPlatformOrgId =
        mapped?.platform_integration_organizations?.platform_org_id
          ? String(mapped.platform_integration_organizations.platform_org_id).trim()
          : null;
      if (mapped?.platform_integration_organizations?.platform_name === "xero") {
        mappedXeroTrackingCategoryId = mapped?.xero_tracking_category_id
          ? String(mapped.xero_tracking_category_id).trim()
          : null;
        mappedXeroTrackingOptionId = mapped?.xero_tracking_option_id
          ? String(mapped.xero_tracking_option_id).trim()
          : null;
      }
    }

    // Fetch iplicit connection (legacy fallback for category_range_map platform_integration_id)
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
    const preferredIntegrationId = mappedIntegrationId ?? iplicitConnection?.id ?? xeroConnection?.id ?? null;
    const platformIntegrationId = await resolveCategoryMappingIntegrationId(
      supabase,
      organizationId,
      preferredIntegrationId
    );

    // Fetch category_range_map + category_range_master (reference: GetCashflowReport.sql @Temp_Categories)
    // All Locations → combine each location's own Setup Categories (not mapping_location_id IS NULL).
    // Single location → that location's maps only; fall back to connection-level (null) if none saved.
    let categoryMapQuery = supabase
      .from("category_range_map")
      .select("location_id, category_range_id, mapping_location_id")
      .eq("organization_id", organizationId);

    if (locationId) {
      if (platformIntegrationId) {
        categoryMapQuery = categoryMapQuery.eq("platform_integration_id", platformIntegrationId);
      }
      categoryMapQuery = categoryMapQuery.eq("mapping_location_id", locationId);
    } else {
      // Union of all per-location setups across accounting connections.
      categoryMapQuery = categoryMapQuery.not("mapping_location_id", "is", null);
    }

    let { data: categoryMapRows } = await categoryMapQuery;

    if ((!categoryMapRows || categoryMapRows.length === 0) && locationId) {
      // Location has no override yet — use connection-level maps for the resolved integration.
      let connectionFallback = supabase
        .from("category_range_map")
        .select("location_id, category_range_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .is("mapping_location_id", null);
      if (platformIntegrationId) {
        connectionFallback = connectionFallback.or(
          `platform_integration_id.eq.${platformIntegrationId},platform_integration_id.is.null`
        );
      }
      const { data: connectionRows } = await connectionFallback;
      categoryMapRows = connectionRows ?? categoryMapRows;
    }

    if ((!categoryMapRows || categoryMapRows.length === 0) && locationId) {
      // Xero reconnect / integration id mismatch: any maps saved for this location.
      const { data: locationFallbackRows } = await supabase
        .from("category_range_map")
        .select("location_id, category_range_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .eq("mapping_location_id", locationId);
      categoryMapRows = locationFallbackRows ?? categoryMapRows;
    }

    if ((!categoryMapRows || categoryMapRows.length === 0) && !locationId) {
      // No per-location setups yet — last-resort connection-level maps.
      const { data: connectionLevelRows } = await supabase
        .from("category_range_map")
        .select("location_id, category_range_id, mapping_location_id")
        .eq("organization_id", organizationId)
        .is("mapping_location_id", null);
      categoryMapRows = connectionLevelRows ?? categoryMapRows;
    }

    console.log("[cashflow-report] category.map.scope", {
      locationId: locationId || "all",
      mapCount: categoryMapRows?.length ?? 0,
      platformIntegrationId,
    });

    // Setup Categories → Bank accounts drive Closing Balance (+ bank-line exclusion).
    const setupBankAccountIds = await loadSetupBankAccountIds(supabase, organizationId, {
      locationId,
      platformIntegrationId:
        platformIntegrationId ||
        mappedIntegrationId ||
        xeroConnection?.id ||
        null,
    });

    const { data: categoryMasterRows } = await supabase
      .from("category_range_master")
      .select("id, name, range_group, range_sub_group, range_order");

    let locationToCategory = new Map<string, CategoryInfo>();
    if (categoryMapRows?.length && categoryMasterRows?.length) {
      locationToCategory = buildCategoryAliasMap(
        categoryMapRows as { location_id: string; category_range_id: number; mapping_location_id?: string | null }[],
        categoryMasterRows as {
          id: number;
          name: string;
          range_group: string;
          range_sub_group: string;
          range_order: number;
        }[],
        !locationId, // All Locations → distinct account→category
      );
    }
    let financeSourceId: string | null = null;
    let canonicalLineCount = 0;
    let hasCanonicalFinance = false;
    let canonicalIntegrationId: string | null = null;
    let canonicalPlatform: string | null = null;
    try {
      const resolved = await resolveActiveCanonicalFinanceSource(
        supabase,
        organizationId,
        platformIntegrationId
      );
      financeSourceId = resolved.sourceId;
      canonicalLineCount = resolved.lineCount;
      canonicalIntegrationId = resolved.integrationId;
      canonicalPlatform = resolved.platform;
      hasCanonicalFinance = canonicalLineCount > 0;
      if (hasCanonicalFinance) {
        console.log(
          `[cashflow-report] canonical finance detected (${canonicalLineCount} lines, ` +
            `platform=${canonicalPlatform}) - available as fallback only when Xero journals absent`
        );
      }
    } catch (e) {
      console.warn("[cashflow-report] canonical availability check failed:", e);
    }

    const xeroIntegrationIdForCategory =
      (mappedIntegrationId && mappedIntegrationId === xeroConnection?.id
        ? mappedIntegrationId
        : null) ||
      (platformIntegrationId && platformIntegrationId === xeroConnection?.id
        ? platformIntegrationId
        : null) ||
      (xeroConnection?.id ? String(xeroConnection.id) : null);

    // Alias expansion only for non-Xero canonical path. Never register bare COA codes
    // (e.g. "311") — they collide across tenants and mis-bucket cashflow categories.
    if (locationToCategory.size > 0 && !xeroIntegrationIdForCategory && hasCanonicalFinance && financeSourceId) {
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

    const useCategoryBased = locationToCategory.size > 0;

    if (useCategoryBased && (hasCanonicalFinance || iplicitConnection?.id || xeroIntegrationIdForCategory)) {
      // Category-based path: Xero journals first, then canonical, then iplicit PL/BS.
      const connectionId = iplicitConnection?.id ?? null;
      let usedXeroJournalDetails = false;

      // 1) Resolve BANK accounts via iplicit groups, else Xero COA bank flags.
      const { data: bankGroupsRaw, error: bankGroupsError } = connectionId
        ? await supabase
            .from("iplicit_coa_account_groups")
            .select("account_group_id,parent_coa_group_id,code")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .eq("is_active", true)
        : { data: [], error: null as any };

      if (bankGroupsError) {
        console.error("iplicit_coa_account_groups bank filter error:", bankGroupsError);
      }

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
          (g) => g.parent_coa_group_id === current && g.account_group_id && !bankGroupIdSet.has(g.account_group_id)
        );
        for (const child of children) {
          const id = child.account_group_id as string;
          bankGroupIdSet.add(id);
          queue.push(id);
        }
      }

      const bankGroupIds = Array.from(bankGroupIdSet);

      let bankAccountIds: string[] = [];
      // Prefer Setup Categories → Bank selection over COA bank flags.
      if (setupBankAccountIds.length > 0) {
        bankAccountIds = [...setupBankAccountIds];
      }
      if (connectionId && bankGroupIds.length > 0 && bankAccountIds.length === 0) {
        const { data: bankCoaRows, error: bankCoaError } = await supabase
          .from("iplicit_chart_of_accounts")
          .select("account_id")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connectionId)
          .in("coa_group_id", bankGroupIds)
          .eq("is_active", true);

        if (bankCoaError) {
          console.error("iplicit_chart_of_accounts bank accounts error:", bankCoaError);
        } else {
          bankAccountIds = (bankCoaRows || [])
            .map((r: { account_id?: string | null }) => r.account_id)
            .filter((c): c is string => !!c);
        }
      }

      let xeroTenantOrgRowId: string | null = null;
      let mappedPracticeTenantOrgIds: string[] | null = null;
      if ((!bankAccountIds.length || !hasCanonicalFinance) && xeroIntegrationIdForCategory) {
        if (mappedPlatformOrgId) {
          xeroTenantOrgRowId = await resolveXeroTenantOrgRowId(
            supabase,
            organizationId,
            xeroIntegrationIdForCategory,
            mappedPlatformOrgId
          );
        } else if (!locationId) {
          mappedPracticeTenantOrgIds = await resolveMappedPracticeXeroTenantOrgIds(
            supabase,
            organizationId,
            xeroIntegrationIdForCategory
          );
        }
        if (!bankAccountIds.length) {
          bankAccountIds = await loadXeroBankAccountIdsForCashflow(
            supabase,
            organizationId,
            xeroIntegrationIdForCategory,
            xeroTenantOrgRowId,
            mappedPlatformOrgId,
            mappedPracticeTenantOrgIds
          );
        }
      }

      // 2) Fetch source rows for the period: Xero journals → canonical → iplicit PL/BS.
      // Prefer xero_journal_details whenever Xero is connected — finance_journal_lines is
      // often a partial invoice-derived sync and will not match Xero / full journals.
      let allRows: Record<string, unknown>[] = [];
      if (xeroIntegrationIdForCategory) {
        if (!xeroTenantOrgRowId && mappedPlatformOrgId) {
          xeroTenantOrgRowId = await resolveXeroTenantOrgRowId(
            supabase,
            organizationId,
            xeroIntegrationIdForCategory,
            mappedPlatformOrgId
          );
        }
        if (!xeroTenantOrgRowId && !locationId && mappedPracticeTenantOrgIds == null) {
          mappedPracticeTenantOrgIds = await resolveMappedPracticeXeroTenantOrgIds(
            supabase,
            organizationId,
            xeroIntegrationIdForCategory
          );
        }
        const trackingScope = await resolveXeroTrackingScope(
          supabase,
          organizationId,
          xeroIntegrationIdForCategory,
          locationId ?? null
        );
        const journalTrackingIds =
          trackingScope.trackingOptionIds.length > 0
            ? trackingScope.trackingOptionIds
            : locationId && mappedXeroTrackingOptionId
              ? [mappedXeroTrackingOptionId]
              : [];
        allRows = await fetchXeroJournalDetailsLikePlBsForCashflowReport(
          supabase,
          organizationId,
          xeroIntegrationIdForCategory,
          fromDate,
          toDate,
          xeroTenantOrgRowId,
          !xeroTenantOrgRowId && !locationId ? mappedPracticeTenantOrgIds : null,
          journalTrackingIds
        );
        usedXeroJournalDetails = true;
        console.log("[cashflow-report] using xero_journal_details", {
          rows: allRows.length,
          xeroIntegrationIdForCategory,
          xeroTenantOrgRowId,
          locationId: locationId || "all",
          trackingOptionCount: journalTrackingIds.length,
        });
      }

      if (!allRows.length && hasCanonicalFinance && financeSourceId) {
        allRows = await fetchCanonicalRowsLikePlBsForCashflowReport(
          supabase,
          organizationId,
          financeSourceId,
          fromDate,
          toDate,
          canonicalPlatform === "xero" ? mappedPlatformOrgId : null
        );
        console.log("[cashflow-report] using finance_journal_lines (canonical fallback)", {
          rows: allRows.length,
          financeSourceId,
          platform: canonicalPlatform,
        });
      }

      if (!allRows.length && connectionId) {
        const [plRes1, plRes2, bsRes1, bsRes2] = await Promise.all([
          supabase
            .from("iplicit_profit_loss")
            .select("doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .not("period_date", "is", null)
            .gte("period_date", fromDate)
            .lte("period_date", toDate),
          supabase
            .from("iplicit_profit_loss")
            .select("doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .is("period_date", null)
            .gte("post_date", fromDate)
            .lte("post_date", toDate),
          supabase
            .from("iplicit_balance_sheet")
            .select("doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .not("post_date", "is", null)
            .gte("post_date", fromDate)
            .lte("post_date", toDate),
          supabase
            .from("iplicit_balance_sheet")
            .select("doc_id, account_id, account_code, amount, period_date, post_date, doc_class, description, doc_description")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .is("post_date", null)
            .gte("period_date", fromDate)
            .lte("period_date", toDate),
        ]);

        const plError = plRes1.error || plRes2.error;
        const bsError = bsRes1.error || bsRes2.error;

        if (plError || bsError) {
          console.error("iplicit_profit_loss error:", plError);
          console.error("iplicit_balance_sheet error:", bsError);
          const err = plError || bsError;
          return new Response(
            JSON.stringify({
              error: err?.message ?? "Failed to fetch iplicit data",
              resultMsg: "Failed to fetch iplicit profit & loss / balance sheet data",
              transactionStatus: 0,
              returnObject: null,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const plRows = [...(plRes1.data || []), ...(plRes2.data || [])] as Record<string, unknown>[];
        const bsRows = [...(bsRes1.data || []), ...(bsRes2.data || [])] as Record<string, unknown>[];
        allRows = [...plRows, ...bsRows] as Record<string, unknown>[];
      }

      // 3) Build invoiceDocIds set from bank receipt/payment doc_ids (to match "split" logic)
      const bankAccountIdSet = new Set(bankAccountIds.map(normStringId).filter((s) => !!s));

      const bankDocIds = new Set<string>();
      for (const r of allRows) {
        const acctId = normStringId(r.account_id);
        if (!acctId) continue;
        if (bankAccountIdSet.has(acctId)) {
          const docId = normStringId(r.doc_id);
          if (docId) bankDocIds.add(docId);
        }
      }

      const invoiceDocIds = new Set<string>();
      const bankDocIdArr = Array.from(bankDocIds);
      const ALLOC_CHUNK = 200;
      for (const chunk of chunkArray(bankDocIdArr, ALLOC_CHUNK)) {
        if (!connectionId) break;
        const [{ data: receiptAllocRows, error: receiptAllocError }, { data: paymentAllocRows, error: paymentAllocError }] = await Promise.all([
          supabase
            .from("iplicit_receipt_allocations")
            .select("receipt_id, doc_id")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .in("receipt_id", chunk),
          supabase
            .from("iplicit_payment_allocations")
            .select("payment_id, doc_id")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .in("payment_id", chunk),
        ]);

        if (receiptAllocError) console.error("iplicit_receipt_allocations error:", receiptAllocError);
        if (paymentAllocError) console.error("iplicit_payment_allocations error:", paymentAllocError);

        (receiptAllocRows || []).forEach((a: any) => {
          const invId = normStringId(a.doc_id);
          if (invId) invoiceDocIds.add(invId);
        });
        (paymentAllocRows || []).forEach((a: any) => {
          const invId = normStringId(a.doc_id);
          if (invId) invoiceDocIds.add(invId);
        });
      }

      // 4) Filter non-bank rows.
      // Prefer invoice-linked rows when allocations are available, but if that results
      // in zero rows, fall back to all non-bank rows to avoid blank category output.
      const nonBankRowsBase = allRows.filter((row: Record<string, unknown>) => {
        const acctId = normStringId(row.account_id);
        if (!acctId) return false;
        if (bankAccountIdSet.has(acctId)) return false;
        if (usedXeroJournalDetails && isXeroBankAccountType(String(row.account_type || ""))) {
          return false;
        }
        return true;
      });

      let nonBankRows = nonBankRowsBase;
      if (invoiceDocIds.size > 0) {
        const invoiceFilteredRows = nonBankRowsBase.filter((row: Record<string, unknown>) => {
        // If we have invoice-linked docs, restrict to those.
          const docId = normStringId(row.doc_id);
          if (!docId) return false;
          return invoiceDocIds.has(docId);
        });
        nonBankRows = invoiceFilteredRows.length > 0 ? invoiceFilteredRows : nonBankRowsBase;
      }
      console.log("[cashflow-report] category.debug.rows", {
        useCategoryBased,
        hasCanonicalFinance,
        usedXeroJournalDetails,
        categoryMapCount: categoryMapRows?.length ?? 0,
        allRowsCount: allRows.length,
        bankAccountIdsCount: bankAccountIds.length,
        bankDocIdsCount: bankDocIds.size,
        invoiceDocIdsCount: invoiceDocIds.size,
        nonBankRowsBaseCount: nonBankRowsBase.length,
        nonBankRowsCount: nonBankRows.length,
      });

      // 5) Resolve COA metadata for display and to filter to PL/non-control accounts
      const uniqueAccountIds = Array.from(
        new Set(nonBankRows.map((r: Record<string, unknown>) => normStringId(r.account_id)).filter((s) => !!s))
      );

      let accountNameById: Record<string, string> = {};
      let accountTypeById: Record<string, string> = {};
      let accountIsControlById: Record<string, boolean> = {};

      const COA_CHUNK = 150;
      if (usedXeroJournalDetails) {
        // Journal detail rows already carry account_name / account_type.
        for (const row of nonBankRows) {
          const id = normStringId(row.account_id);
          if (!id) continue;
          const name = String(row.account_name || "").trim();
          const typ = String(row.account_type || "").trim();
          if (name && !accountNameById[id]) accountNameById[id] = name;
          if (typ && !accountTypeById[id]) accountTypeById[id] = typ;
        }
        // Fill gaps from xero_chart_of_accounts when present.
        for (const chunk of chunkArray(uniqueAccountIds, COA_CHUNK)) {
          const { data: coaRows, error: coaError } = await supabase
            .from("xero_chart_of_accounts")
            .select("xero_account_id, account_name, account_type")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", xeroIntegrationIdForCategory)
            .in("xero_account_id", chunk);
          if (coaError) {
            console.warn("[cashflow-report] xero_chart_of_accounts metadata:", coaError.message);
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
      } else if (hasCanonicalFinance && financeSourceId) {
        for (const chunk of chunkArray(uniqueAccountIds, COA_CHUNK)) {
          const { data: faRows, error: faError } = await supabase
            .from("finance_accounts")
            .select("canonical_account_code, account_name, account_type, attributes_json")
            .eq("organization_id", organizationId)
            .eq("source_id", financeSourceId)
            .in("canonical_account_code", chunk);

          if (faError) {
            console.error("finance_accounts category metadata error:", faError);
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
      } else if (connectionId) {
        for (const chunk of chunkArray(uniqueAccountIds, COA_CHUNK)) {
          const { data: coaRows, error: coaError } = await supabase
            .from("iplicit_chart_of_accounts")
            .select("account_id, name, ap_flag, ar_flag, account_type")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .in("account_id", chunk);

          if (coaError) console.error("iplicit_chart_of_accounts chunk error:", coaError);
          for (const r of (coaRows || []) as any[]) {
            const id = normStringId(r.account_id);
            if (!id) continue;
            if (typeof r.name === "string" && r.name.trim()) accountNameById[id] = r.name.trim();
            if (typeof r.account_type === "string" && r.account_type.trim()) accountTypeById[id] = r.account_type.trim();
            accountIsControlById[id] = Boolean(r.ap_flag) || Boolean(r.ar_flag);
          }
        }
      }

      const isInternalTransfer = (row: Record<string, unknown>): boolean => {
        const docClass = String(row.doc_class || "").toUpperCase();
        const desc = String(row.description || row.doc_description || "").toLowerCase();
        if (/TRANSFER|BANKTRANSFER/.test(docClass)) return true;
        if (/internal transfer|intra-?account|intra-?company|bank transfer between/.test(desc)) return true;
        return false;
      };

      const aggregatedByKey = new Map<string, AggregatedRow>();
      const rowKey = (rg: string, rsg: string, cat: string, loc: string, lid: string, ord: number) =>
        `${rg}|${rsg}|${cat}|${loc}|${lid}|${ord}`;
      const flipXeroSigns = canonicalPlatform === "xero" || usedXeroJournalDetails;

      for (const row of nonBankRows) {
        const acctId = normStringId(row.account_id);
        const acctCode = normStringId(row.account_code);

        const isControl = accountIsControlById[acctId] ?? false;
        if (isControl) continue;

        const accType = (accountTypeById[acctId] || String(row.account_type || "")).toUpperCase();
        if (isXeroBankAccountType(accType)) continue;

        let category =
          (acctId ? locationToCategory.get(acctId.toLowerCase()) : undefined) ??
          (acctCode ? locationToCategory.get(acctCode.toLowerCase()) : undefined);

        const rawAmount = parseFloat(String(row.amount ?? 0)) || 0;
        // Xero journal signs are reversed for this cashflow view:
        // flip so Income is positive and Payment is negative, matching iplicit path.
        const amount = flipXeroSigns ? rawAmount * -1 : rawAmount;
        if (!amount) continue;

        const dateStr = String(row.period_date || row.post_date || "");
        const monthKey = getPeriodKey(dateStr, periodGranularity);
        if (!(monthKey in receivedByMonth)) continue;

        // Unmapped COA with activity → flat Uncategorized group (one section, accounts as lines).
        let lineName =
          (acctId && accountNameById[acctId]) || acctCode || "—";
        if (!category) {
          lineName = formatUncategorizedAccountLabel(
            (acctId && accountNameById[acctId]) || "",
            acctCode,
            accType || String(row.account_type || ""),
            acctId || acctCode
          );
          category = {
            locationId: acctId || acctCode,
            // Shared bucket so UI does not create a sub-group per account.
            name: "UA",
            rangeGroup: UNCATEGORIZED_RANGE_GROUP,
            rangeSubGroup: "Accounts",
            rangeOrder: UNCATEGORIZED_RANGE_ORDER,
          };
        }

        const location = lineName;
        const locationId = acctId || acctCode || location;
        const key = rowKey(
          category.rangeGroup,
          category.rangeSubGroup,
          category.name,
          location,
          locationId,
          category.rangeOrder
        );

        if (!aggregatedByKey.has(key)) {
          const am: Record<string, number> = {};
          for (const c of monthCols) am[c.key] = 0;
          aggregatedByKey.set(key, {
            rangeGroup: category.rangeGroup,
            rangeSubGroup: category.rangeSubGroup,
            categoryName: category.name,
            location,
            locationId,
            rangeOrder: category.rangeOrder,
            amountsByMonth: am,
          });
        }
        const agg = aggregatedByKey.get(key)!;
        agg.amountsByMonth[monthKey] = (agg.amountsByMonth[monthKey] ?? 0) + amount;

        if (category.rangeGroup === UNCATEGORIZED_RANGE_GROUP) {
          if (amount >= 0) {
            receivedByMonth[monthKey] += amount;
          } else {
            paidByMonth[monthKey] += amount * -1;
          }
        } else if (category.rangeSubGroup === "Income") {
          receivedByMonth[monthKey] += amount;
          if (category.rangeGroup.toLowerCase().includes("intra") || isInternalTransfer(row))
            receivedInternalTransferByMonth[monthKey] += amount;
        } else {
          paidByMonth[monthKey] += amount * -1;
          if (category.rangeGroup.toLowerCase().includes("intra") || isInternalTransfer(row))
            paidInternalTransferByMonth[monthKey] += amount * -1;
        }
      }

      const aggregated = Array.from(aggregatedByKey.values())
        .filter((row) =>
          Object.values(row.amountsByMonth).some((v) => Math.abs(v) > 0.005)
        )
        .sort((a, b) => {
          if (a.rangeOrder !== b.rangeOrder) return a.rangeOrder - b.rangeOrder;
          if (a.rangeGroup === UNCATEGORIZED_RANGE_GROUP) {
            return a.location.localeCompare(b.location);
          }
          return a.categoryName.localeCompare(b.categoryName);
        });
      console.log("[cashflow-report] category.debug.aggregated", {
        aggregatedCount: aggregated.length,
        uncategorizedCount: aggregated.filter((r) => r.rangeGroup === UNCATEGORIZED_RANGE_GROUP)
          .length,
      });
      tableGroupDataSetFromCategory = buildTableGroupFromAggregated(aggregated, monthCols);
    } else if (
      (hasCanonicalFinance && financeSourceId && canonicalIntegrationId && canonicalPlatform) ||
      iplicitConnection?.id
    ) {
      // Source: canonical finance_journal_lines when populated (iplicit-sync or Xero journals); else iplicit_gl_entries
      const connectionId =
        hasCanonicalFinance && canonicalIntegrationId
          ? canonicalIntegrationId
          : (iplicitConnection!.id as string);
      const coaPlatform =
        hasCanonicalFinance && canonicalPlatform ? canonicalPlatform : "iplicit";

      const { data: bankCoaRows } = await supabase
        .from("platform_integration_chart_of_accounts")
        .select("coa_account_id, coa_account_code")
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", connectionId)
        .eq("platform_name", coaPlatform)
        .or("coa_bank_account_type.not.is.null,coa_account_type.eq.BANK");

      const bankAccountIds = (bankCoaRows || [])
        .map((r: { coa_account_id?: string | null }) => r.coa_account_id)
        .filter((c): c is string => !!c);
      const bankAccountCodes = (bankCoaRows || [])
        .map((r: { coa_account_code?: string | null }) => r.coa_account_code)
        .filter((c): c is string => !!c);

      let allGlRows: Record<string, unknown>[] = [];
      let glError: { message: string } | null = null;

      const useCanonicalGl = Boolean(financeSourceId && canonicalLineCount > 0);

      if (useCanonicalGl && financeSourceId) {
        const canonicalRows = await fetchCanonicalGlRowsLikeIplicit(
          supabase,
          organizationId,
          financeSourceId,
          fromDate,
          toDate,
          canonicalPlatform === "xero" ? mappedPlatformOrgId : null
        );
        allGlRows = canonicalRows as Record<string, unknown>[];
        console.log(
          `[cashflow-report] using canonical GL: ${allGlRows.length} lines (source ${financeSourceId})`
        );
      } else if (iplicitConnection?.id) {
        const [res1, res2] = await Promise.all([
          supabase
            .from("iplicit_gl_entries")
            .select(
              "account_id, account_code, debit_amount, credit_amount, net_amount, entry_date, doc_date, source_type, doc_class, description, narrative"
            )
            .eq("organization_id", organizationId)
            .eq("connection_id", connectionId)
            .gte("entry_date", fromDate)
            .lte("entry_date", toDate),
          supabase
            .from("iplicit_gl_entries")
            .select(
              "account_id, account_code, debit_amount, credit_amount, net_amount, entry_date, doc_date, source_type, doc_class, description, narrative"
            )
            .eq("organization_id", organizationId)
            .eq("connection_id", connectionId)
            .is("entry_date", null)
            .gte("doc_date", fromDate)
            .lte("doc_date", toDate),
        ]);

        glError = res1.error || res2.error || null;
        allGlRows = [...(res1.data || []), ...(res2.data || [])] as Record<string, unknown>[];

        if (glError) {
          console.error("iplicit_gl_entries error:", glError);
          return new Response(
            JSON.stringify({
              error: glError.message,
              resultMsg: "Failed to fetch iplicit GL entries",
              transactionStatus: 0,
              returnObject: null,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        allGlRows = [];
      }
      const filteredGlRows = allGlRows.filter((row: Record<string, unknown>) => {
        const acctId = row.account_id as string | null | undefined;
        const acctCode = row.account_code as string | null | undefined;
        const sourceType = String(row.source_type || "");

        if (bankAccountIds.length > 0 && acctId && bankAccountIds.includes(acctId)) return true;
        if (bankAccountCodes.length > 0 && acctCode && bankAccountCodes.includes(acctCode)) return true;
        return sourceType === "Payment" || sourceType === "Receipt";
      });

      const isInternalTransfer = (row: Record<string, unknown>): boolean => {
        const docClass = String(row.doc_class || "").toUpperCase();
        const desc = String(row.description || row.narrative || "").toLowerCase();
        if (/TRANSFER|BANKTRANSFER/.test(docClass)) return true;
        if (/internal transfer|intra-?account|intra-?company|bank transfer between/.test(desc)) return true;
        return false;
      };

      for (const row of filteredGlRows) {
        const debit = parseFloat(String(row.debit_amount ?? 0)) || 0;
        const credit = parseFloat(String(row.credit_amount ?? 0)) || 0;
        const net = parseFloat(String(row.net_amount ?? 0)) || 0;
        let inAmount = debit;
        let outAmount = credit;
        if (debit === 0 && credit === 0 && net !== 0) {
          if (net > 0) {
            inAmount = Math.abs(net);
            outAmount = 0;
          } else {
            outAmount = Math.abs(net);
            inAmount = 0;
          }
        }
        const dateStr = String(row.entry_date || row.doc_date || "");
        const monthKey = getPeriodKey(dateStr, periodGranularity);
        if (monthKey in receivedByMonth) {
          receivedByMonth[monthKey] += inAmount;
          paidByMonth[monthKey] += outAmount;
          if (isInternalTransfer(row)) {
            receivedInternalTransferByMonth[monthKey] += inAmount;
            paidInternalTransferByMonth[monthKey] += outAmount;
          }
        }
      }
    } else {
      // Fallback: xero_bank_transactions (e.g. Xero) when no canonical/iplicit GL path ran.
      let bankTxQuery = supabase
        .from("xero_bank_transactions")
        .select("type, transaction_date, total, platform_integration_organization_id")
        .eq("organization_id", organizationId)
        .gte("transaction_date", fromDate)
        .lte("transaction_date", toDate);

      if (mappedIntegrationId) {
        bankTxQuery = bankTxQuery.eq("platform_integration_id", mappedIntegrationId);
      }
      if (mappedPlatformOrgId) {
        const tenantRowId = await resolveXeroTenantOrgRowId(
          supabase,
          organizationId,
          mappedIntegrationId || xeroConnection?.id || "",
          mappedPlatformOrgId
        );
        if (tenantRowId) {
          bankTxQuery = bankTxQuery.eq("platform_integration_organization_id", tenantRowId);
        }
      } else if (!locationId && (mappedIntegrationId || xeroConnection?.id)) {
        const mappedTenants = await resolveMappedPracticeXeroTenantOrgIds(
          supabase,
          organizationId,
          String(mappedIntegrationId || xeroConnection?.id)
        );
        if (mappedTenants.length > 0) {
          bankTxQuery = bankTxQuery.in("platform_integration_organization_id", mappedTenants);
        }
      }

      const { data: rows, error } = await bankTxQuery;

      if (error) {
        console.error("Supabase error:", error);
        return new Response(
          JSON.stringify({
            error: error.message,
            resultMsg: "Failed to fetch data",
            transactionStatus: 0,
            returnObject: null,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      for (const row of rows || []) {
        const total = Number(row.total) || 0;
        const type = String(row.type || "").toUpperCase();
        const monthKey = getPeriodKey(String(row.transaction_date), periodGranularity);
        if (!(monthKey in receivedByMonth)) continue;
        const isReceive = type === "RECEIVE" || type.startsWith("RECEIVE");
        const isSpend = type === "SPEND" || type.startsWith("SPEND");
        const isTransfer = type === "TRANSFER" || type.includes("TRANSFER");
        if (isReceive || (isTransfer && !isSpend)) {
          receivedByMonth[monthKey] += total;
          if (isTransfer) receivedInternalTransferByMonth[monthKey] += total;
        }
        if (isSpend || (isTransfer && !isReceive)) {
          paidByMonth[monthKey] += total;
          if (isTransfer) paidInternalTransferByMonth[monthKey] += total;
        }
      }
    }

    const columns = monthCols.map((c) => c.label);

    const totalReceived = monthCols.map((c) => ({ column: c.label, value: receivedByMonth[c.key] ?? 0 }));
    const totalPaid = monthCols.map((c) => ({ column: c.label, value: paidByMonth[c.key] ?? 0 }));
    const totalReceivedExcludedInternalTransfer = monthCols.map((c) => ({
      column: c.label,
      value: Math.max(0, (receivedByMonth[c.key] ?? 0) - (receivedInternalTransferByMonth[c.key] ?? 0)),
    }));
    const totalPaidExcludedInternalTransfer = monthCols.map((c) => ({
      column: c.label,
      value: Math.max(0, (paidByMonth[c.key] ?? 0) - (paidInternalTransferByMonth[c.key] ?? 0)),
    }));
    const netCashflow = monthCols.map((c) => ({
      column: c.label,
      value: (receivedByMonth[c.key] ?? 0) - (paidByMonth[c.key] ?? 0),
    }));

    // Resolve Xero integration for BS-anchored opening/closing (matches Xero "Total Cash at bank and in hand")
    let xeroIntegrationIdForBs: string | null = null;
    if (canonicalPlatform === "xero" && canonicalIntegrationId) {
      xeroIntegrationIdForBs = canonicalIntegrationId;
    } else if (mappedIntegrationId) {
      const { data: mappedPi } = await supabase
        .from("platform_integrations")
        .select("platform_name")
        .eq("id", mappedIntegrationId)
        .maybeSingle();
      if (mappedPi?.platform_name === "xero") {
        xeroIntegrationIdForBs = mappedIntegrationId;
      }
    }
    if (!xeroIntegrationIdForBs) {
      const { data: xeroPi } = await supabase
        .from("platform_integrations")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("platform_name", "xero")
        .eq("is_connected", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      xeroIntegrationIdForBs = xeroPi?.id ? String(xeroPi.id) : null;
    }

    let openingBalance: ColData[] = [];
    let closingBalance: ColData[] = [];
    let usedBsBalances = false;

    if (xeroIntegrationIdForBs) {
      // BS cash anchors Opening (prior month-end) and Closing (month-end) when
      // snapshots exist, so each month column matches Xero Total Cash whether the
      // range is one month or many. Falls back to Opening + Received − Paid when
      // a month-end BS row is missing. Weekly columns rarely hit a month-end key,
      // so they keep rolling from the first prior-month BS open.
      let tenantOrgUuid: string | null = null;
      let mappedPracticeTenantOrgIds: string[] | null = null;

      if (mappedPlatformOrgId) {
        tenantOrgUuid = await resolveXeroTenantOrgUuid(
          supabase,
          organizationId,
          xeroIntegrationIdForBs,
          mappedPlatformOrgId
        );
      }
      if (!tenantOrgUuid) {
        mappedPracticeTenantOrgIds = await resolveMappedPracticeXeroTenantOrgIds(
          supabase,
          organizationId,
          xeroIntegrationIdForBs
        );
        // Single location without resolvable tenant must not fall back to All tenants.
        if (locationId) {
          console.warn("[cashflow-report] location has no resolvable Xero tenant; BS opening skipped", {
            locationId,
            mappedPlatformOrgId,
          });
          mappedPracticeTenantOrgIds = [];
        }
      }

      const trackingScopeForBs = await resolveXeroTrackingScope(
        supabase,
        organizationId,
        xeroIntegrationIdForBs,
        locationId ?? null
      );
      const optionScopes = trackingScopeForBs.optionScopes || [];
      const monthEndDates =
        periodGranularity === "weekly"
          ? [dateToPriorMonthEnd(monthCols[0].key)]
          : [
              ...new Set([
                priorMonthEndDate(monthCols[0].key),
                ...monthCols.map((c) => monthKeyToEndDate(c.key)),
              ]),
            ];
      const liveAsAtDates = [
        dateToPriorMonthEnd(monthCols[0].key),
        ...monthCols.map((c) => periodClosingAsAt(c.key, toDate)),
      ];
      let bsTotalByMonthEnd = new Map<string, number>();
      if (optionScopes.length > 0) {
        const liveCash = await fetchLiveXeroTrackingCashTotalsByDates(
          organizationId,
          xeroIntegrationIdForBs,
          liveAsAtDates,
          optionScopes
        );
        bsTotalByMonthEnd = liveCash;
        console.log("[cashflow-report] live tracking BS cash", {
          locationId: locationId || "all",
          optionScopeCount: optionScopes.length,
          asAtDates: liveAsAtDates,
          totals: Object.fromEntries(liveCash),
        });
      } else {
        bsTotalByMonthEnd = await loadXeroBsCashTotalsByMonthEnd(supabase, {
          organizationId,
          xeroIntegrationId: xeroIntegrationIdForBs,
          monthEndDates,
          tenantOrgUuid,
          // Always pass an array for All Locations so we never unscoped-sum all Xero orgs.
          tenantOrgUuids: tenantOrgUuid ? null : mappedPracticeTenantOrgIds ?? [],
          setupBankAccountIds,
        });
      }
      const bsAnchored = buildBsAnchoredMonthlyBalances(
        monthCols,
        bsTotalByMonthEnd,
        receivedByMonth,
        paidByMonth,
        toDate
      );
      if (bsAnchored.usedBs) {
        openingBalance = bsAnchored.openingBalance;
        closingBalance = bsAnchored.closingBalance;
        usedBsBalances = true;
        console.log("[cashflow-report] using BS-anchored opening/closing balances", {
          xeroIntegrationIdForBs,
          periodGranularity,
          locationId: locationId || "all",
          tenantOrgUuid,
          mappedPracticeTenantCount: mappedPracticeTenantOrgIds?.length ?? null,
          setupBankCount: setupBankAccountIds.length,
          closingSource:
            optionScopes.length > 0 && bsTotalByMonthEnd.size > 0
              ? "live_tracking_cash_at_bank"
              : setupBankAccountIds.length > 0
                ? "setup_categories_bank"
                : "xero_total_cash_fallback",
          bsMonthCount: bsTotalByMonthEnd.size,
          sampleOpening: openingBalance[0],
          sampleClosing: closingBalance[closingBalance.length - 1],
          firstAnchor: dateToPriorMonthEnd(monthCols[0].key),
        });
        if (bsAnchored.bsDrift.length > 0) {
          // Closing is BS-anchored; Opening + Received − Paid differing from BS
          // means categorised journals ≠ bank movement (often Uncategorized).
          console.warn("[cashflow-report] Opening+Net differs from Xero BS Closing", {
            locationId: locationId || "all",
            months: bsAnchored.bsDrift,
          });
        }
      }
    }

    if (!usedBsBalances) {
      let running = 0;
      closingBalance = monthCols.map((c) => {
        const net = (receivedByMonth[c.key] ?? 0) - (paidByMonth[c.key] ?? 0);
        running += net;
        return { column: c.label, value: running };
      });
      openingBalance = monthCols.map((c, i) => ({
        column: c.label,
        value: i === 0 ? 0 : closingBalance[Math.max(0, i - 1)].value,
      }));
    }

    const totalRowDataSet: RowData[] = [
      { name: "Opening Balance", colData: openingBalance },
      { name: "Total Received (Excluded Internal Transfer)", colData: totalReceivedExcludedInternalTransfer },
      { name: "Total Received", colData: totalReceived },
      { name: "Total Paid (Excluded Internal Transfer)", colData: totalPaidExcludedInternalTransfer },
      { name: "Total Paid", colData: totalPaid },
      { name: "Closing Balance", colData: closingBalance },
      { name: "Net Cashflow", colData: netCashflow },
    ];

    // Use category-based table when available, else simple Bank receipts/payments (reference: CashflowService)
    const tableGroupDataSet: TableGroupDataSet[] =
      tableGroupDataSetFromCategory && tableGroupDataSetFromCategory.length > 0
        ? tableGroupDataSetFromCategory
        : (() => {
            const bankReceiptsRow: RowData = {
              name: "Bank receipts",
              colData: totalReceived,
            };
            const bankPaymentsRow: RowData = {
              name: "Bank payments",
              colData: monthCols.map((c) => ({ column: c.label, value: paidByMonth[c.key] ?? 0 })),
            };
            return [
              {
                type: "Operating Activities",
                subGroupDataSet: [
                  {
                    rowHeader: "Cash from operations",
                    rowDataSet: [
                      {
                        id: 1,
                        header: "Bank",
                        rowData: [bankReceiptsRow, bankPaymentsRow],
                      },
                    ],
                  },
                ],
              },
            ];
          })();

    const returnObject = enrichCashflowReportWithTotalColumn({
      currencySymbol: "£",
      columns,
      tableGroupDataSet,
      totalRowDataSet,
    });

    return new Response(
      JSON.stringify({
        returnObject,
        transactionStatus: 8,
        resultMsg: "Success",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("cashflow-report error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        resultMsg: "Failed to process request",
        transactionStatus: 0,
        returnObject: null,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
