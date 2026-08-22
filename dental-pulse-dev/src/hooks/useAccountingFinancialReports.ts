import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import {
  xeroBalanceSheetSectionRank,
  xeroProfitLossSectionRank,
} from "@/lib/financialStatementLayout";

export type CompareWithUnit = "month" | "quarter" | "year";

export interface CompareWith {
  amount: number;
  unit: CompareWithUnit;
}

// ── Connected entities (Xero tenants + QuickBooks companies) ──────

export type AccountingPlatform = "xero" | "quickbooks";

export interface AccountingEntity {
  /** platform_integration_organizations.id — the FK used as xero_tenant_id / quickbooks_company_id */
  id: string;
  platform: AccountingPlatform;
  platform_org_id: string;
  platform_org_name: string | null;
}

/** Accounting entity stamped with the practice location it was resolved from. */
export interface LocationAccountingEntity extends AccountingEntity {
  locationId: string;
  locationName: string;
  xeroTrackingCategoryId?: string | null;
  xeroTrackingOptionId?: string | null;
}

interface MappingRow {
  location_id: string | null;
  xero_tracking_category_id?: string | null;
  xero_tracking_option_id?: string | null;
  platform_integration_organizations: {
    id: string;
    platform_name: string;
    platform_org_id: string;
    platform_org_name: string | null;
  } | null;
}

function preferAccountingOrg(
  rows: MappingRow[],
): MappingRow | null {
  const platformName = (r: MappingRow) =>
    (r.platform_integration_organizations?.platform_name || "").toLowerCase();
  return (
    rows.find((r) => platformName(r) === "xero") ||
    rows.find((r) => platformName(r) === "quickbooks") ||
    null
  );
}

/**
 * Resolves the connected Xero/QuickBooks entity for a specific practice
 * location. Returns null when no location is selected / All Locations, or
 * when the selected location has no accounting mapping.
 */
export function useAccountingEntityForLocation(
  locationId: string | null | undefined,
) {
  const normalizedLocationId =
    locationId && locationId !== "all" ? locationId : null;
  const { data: entities, isLoading, ...rest } = useAccountingLocationEntities(
    normalizedLocationId,
    { enabled: !!normalizedLocationId },
  );
  return { data: entities?.[0] ?? null, isLoading, ...rest };
}

/**
 * Resolves Xero/QuickBooks entities for Financial Statements.
 * - Specific location (or an explicit list of locations, for the Compare
 *   Locations control) → at most one preferred entity per location.
 * - All Locations (`null` / `"all"` / `[]`) → one unfiltered report per Xero
 *   tenant (matches Xero with Compare tracking categories = None). Summing
 *   tracking-scoped P&amp;Ls drops untagged turnover and will not match Xero.
 * - Tracking is only applied when two or more visible locations share the
 *   same Xero tenant (location-split P&amp;L). A tenant used by a single
 *   clinic is fetched at organisation level so Turnover matches Xero.
 */
export function useAccountingLocationEntities(
  locationId: string | string[] | null | undefined,
  options?: { enabled?: boolean },
) {
  const { organizationId } = useOrganization();
  const isAllLocations =
    !locationId ||
    locationId === "all" ||
    (Array.isArray(locationId) && locationId.length === 0);
  const normalizedLocationIds: string[] | null = isAllLocations
    ? null
    : Array.isArray(locationId)
      ? locationId
      : [locationId];
  const enabled =
    !!organizationId && (options?.enabled !== undefined ? options.enabled : true);

  return useQuery({
    queryKey: [
      "accounting-location-entities",
      organizationId,
      normalizedLocationIds
        ? [...normalizedLocationIds].sort().join(",")
        : "all",
    ],
    queryFn: async (): Promise<LocationAccountingEntity[]> => {
      if (!organizationId) return [];

      // Load every mapping so we can tell whether a Xero tenant is shared
      // across clinics. Filtering to the requested location happens after
      // tracking is resolved — otherwise a single-clinic tenant would keep
      // a tracking filter and understate Turnover vs Xero's org P&L.
      const query = (supabase as any)
        .from("platform_integration_organization_mapping")
        .select(
          `
          location_id,
          xero_tracking_category_id,
          xero_tracking_option_id,
          platform_integration_organizations (
            id, platform_name, platform_org_id, platform_org_name
          )
        `,
        )
        .eq("organization_id", organizationId);

      const { data, error } = await query;
      if (error) {
        console.error("[useAccountingLocationEntities] error:", error);
        return [];
      }

      const rows = (data ?? []) as MappingRow[];
      if (rows.length === 0) return [];

      const locationIds = [
        ...new Set(
          rows
            .map((r) => r.location_id)
            .filter((id): id is string => !!id),
        ),
      ];

      const { data: locationRows, error: locError } = await (supabase as any)
        .from("practice_locations")
        .select("id, location_name, exclude_from_financial_display")
        .in("id", locationIds);

      if (locError) {
        console.error(
          "[useAccountingLocationEntities] location lookup error:",
          locError,
        );
      }

      const locationNameById = new Map<string, string>();
      const hiddenLocationIds = new Set<string>();
      for (const l of (locationRows ?? []) as Array<{
        id: string;
        location_name: string;
        exclude_from_financial_display?: boolean;
      }>) {
        locationNameById.set(l.id, l.location_name);
        if (l.exclude_from_financial_display) hiddenLocationIds.add(l.id);
      }

      // Prefer Xero over QuickBooks within each location, then keep one row per
      // accounting tenant+tracking option so shared tenants aren't double-counted.
      const byLocation = new Map<string, MappingRow[]>();
      for (const row of rows) {
        if (!row.location_id) continue;
        if (hiddenLocationIds.has(row.location_id)) continue;
        const list = byLocation.get(row.location_id) ?? [];
        list.push(row);
        byLocation.set(row.location_id, list);
      }

      const seenScopeKeys = new Set<string>();
      const allEntities: LocationAccountingEntity[] = [];

      for (const [locId, locRows] of byLocation) {
        const preferredRow = preferAccountingOrg(locRows);
        const org = preferredRow?.platform_integration_organizations;
        if (!org || !preferredRow) continue;

        const platform = (org.platform_name || "").toLowerCase();
        if (platform !== "xero" && platform !== "quickbooks") continue;

        const trackingOptionId =
          platform === "xero" ? preferredRow.xero_tracking_option_id || null : null;
        const scopeKey = `${org.id}::${trackingOptionId || ""}`;
        if (seenScopeKeys.has(scopeKey)) continue;
        seenScopeKeys.add(scopeKey);

        allEntities.push({
          id: org.id,
          platform: platform as AccountingPlatform,
          platform_org_id: org.platform_org_id,
          platform_org_name: org.platform_org_name,
          locationId: locId,
          locationName:
            locationNameById.get(locId) ||
            org.platform_org_name ||
            "Location",
          xeroTrackingCategoryId:
            platform === "xero" ? preferredRow.xero_tracking_category_id || null : null,
          xeroTrackingOptionId: trackingOptionId,
        });
      }

      // How many visible clinics share each Xero tenant? Tracking only splits
      // the P&L when the answer is 2+. A single-clinic tenant must use the
      // organisation report (Xero "Compare tracking categories: None").
      const locationsPerTenant = new Map<string, Set<string>>();
      for (const entity of allEntities) {
        if (entity.platform !== "xero") continue;
        const set = locationsPerTenant.get(entity.id) ?? new Set<string>();
        set.add(entity.locationId);
        locationsPerTenant.set(entity.id, set);
      }
      for (const entity of allEntities) {
        if (entity.platform !== "xero") continue;
        if ((locationsPerTenant.get(entity.id)?.size ?? 0) <= 1) {
          entity.xeroTrackingCategoryId = null;
          entity.xeroTrackingOptionId = null;
        }
      }

      let entities: LocationAccountingEntity[];
      if (!normalizedLocationIds) {
        // All Locations: one unfiltered P&L/BS per Xero tenant so untagged
        // turnover is included — summing option-scoped reports understates
        // Total Turnover vs Xero's org report.
        const collapsed: LocationAccountingEntity[] = [];
        const seenTenant = new Set<string>();
        for (const entity of allEntities) {
          if (entity.platform === "xero") {
            if (seenTenant.has(entity.id)) continue;
            seenTenant.add(entity.id);
            collapsed.push({
              ...entity,
              xeroTrackingCategoryId: null,
              xeroTrackingOptionId: null,
            });
          } else {
            collapsed.push(entity);
          }
        }
        entities = collapsed;
      } else {
        const wanted = new Set(normalizedLocationIds);
        entities = allEntities.filter((entity) => wanted.has(entity.locationId));
      }

      entities.sort((a, b) => a.locationName.localeCompare(b.locationName));
      return entities;
    },
    enabled,
  });
}

// ── Date helpers ───────────────────────────────────────────────────

/**
 * `toISOString()` converts to UTC first — for any timezone ahead of UTC
 * (e.g. UK BST, UTC+1), a local midnight date rolls back to the previous
 * calendar day, shifting every report's from/to date sent to Xero/QuickBooks
 * by a day. Use the Date's own local calendar fields instead.
 */
function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftBackPeriod(d: Date, amount: number, unit: CompareWithUnit): Date {
  if (unit === "year") {
    return new Date(d.getFullYear() - amount, d.getMonth(), d.getDate());
  }
  // `Date#setMonth` overflows into the next month when the target month has
  // fewer days than `d`'s day-of-month (e.g. 31 Jul − 1 month would roll past
  // 30 Jun into 1 Jul instead of landing on 30 Jun) — compute the target
  // year/month first, then clamp the day to that month's actual length.
  const monthsBack = unit === "month" ? amount : amount * 3;
  const totalMonths = d.getMonth() - monthsBack;
  const targetYear = d.getFullYear() + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(d.getDate(), daysInTargetMonth));
}

interface PeriodWindow {
  fromDate: string;
  toDate: string;
}

/**
 * Xero's own "Compare with N [Month|Quarter|Year]" returns N+1 columns total —
 * the current period, then one column per unit going backward (e.g. "3 Months"
 * = current + 3 prior monthly snapshots, 4 columns) — not a single two-point
 * comparison. This builds that same window list: window[0] is the selected
 * date range as-is, window[k] is the same-length range shifted back k units.
 */
function buildPeriodWindows(
  dateRange: { startDate: Date; endDate: Date },
  compareWith: CompareWith | null | undefined,
): PeriodWindow[] {
  const count = compareWith ? compareWith.amount : 0;
  const windows: PeriodWindow[] = [];
  for (let k = 0; k <= count; k++) {
    const start =
      k === 0
        ? dateRange.startDate
        : shiftBackPeriod(dateRange.startDate, k, compareWith!.unit);
    const end =
      k === 0
        ? dateRange.endDate
        : shiftBackPeriod(dateRange.endDate, k, compareWith!.unit);
    windows.push({ fromDate: toISODate(start), toDate: toISODate(end) });
  }
  return windows;
}

/** Top-level Balance Sheet bucket as laid out by Xero/QBO (Assets → Liabilities → Equity). */
export type BalanceSheetGroup = "assets" | "liabilities" | "equity";

interface RawRow {
  accountId: string;
  section: string | null;
  accountName?: string | null;
  amount: number;
  /** Depth-first walk index of the leaf section in the platform report (stable layout order). */
  sectionOrder: number;
  /** Depth-first walk index of this account row in the platform report. */
  rowOrder: number;
  /** Balance Sheet only — which top-level group the platform placed this row under. */
  group?: BalanceSheetGroup | null;
}

/** A native Xero/QuickBooks total that isn't tied to a real account — e.g. "Total Income", "Gross Profit", "Net Profit"/"Net Income". */
interface RawSummaryRow {
  label: string;
  amount: number;
}

// ── Multi-column line item / section shape for the live report display ────

export interface LiveLineItem {
  id: string;
  name: string;
  /** One amount per column, index-aligned with the hook's columnLabels. */
  amounts: number[];
  /** Present when All Locations is selected — shown in a Location column. */
  locationName?: string;
  /** Platform report walk order — used to keep accounts in Xero/QBO sequence. */
  rowOrder?: number;
}

export interface LiveSection {
  id: string;
  name: string;
  items: LiveLineItem[];
  totalAmounts: number[];
  /** Platform report walk order of this section. */
  sectionOrder?: number;
  /** Balance Sheet top-level group from the platform layout (not keyword guessing). */
  group?: BalanceSheetGroup | null;
}

/**
 * Xero's Balance Sheet is a flat sibling list: a title-only "Assets" /
 * "Liabilities" / "Equity" banner section, then the real category sections
 * (Fixed Assets, Current Assets, Bank, …). Exact title match only —
 * "Current Assets" must NOT flip the group; it inherits from the last banner.
 */
function detectBalanceSheetGroup(
  title: string | null | undefined,
): BalanceSheetGroup | null {
  if (!title) return null;
  const n = title.trim().toLowerCase();
  if (n === "assets" || n === "asset") return "assets";
  if (n === "liabilities" || n === "liability") return "liabilities";
  if (
    n === "equity" ||
    n === "net assets" ||
    n === "shareholders' equity" ||
    n === "shareholders equity" ||
    n === "stockholders' equity" ||
    n === "stockholders equity"
  ) {
    return "equity";
  }
  return null;
}

/** Keyword fallback when the report walk never saw an Assets/Liabilities/Equity banner. */
export function inferBalanceSheetGroupFromSectionName(
  name: string,
): BalanceSheetGroup {
  const n = name.toLowerCase();
  if (n.includes("liabilit") || n.includes("creditor")) return "liabilities";
  if (
    n.includes("equity") ||
    n.includes("capital") ||
    n.includes("reserves") ||
    n.includes("retained earnings") ||
    n.includes("current year earnings") ||
    n.includes("shareholders") ||
    n.includes("stockholders")
  ) {
    return "equity";
  }
  return "assets";
}

export { xeroBalanceSheetSectionRank, xeroProfitLossSectionRank };

type LiveSectionLayout = "platform" | "profit-loss" | "balance-sheet";

function compareLiveSectionsByLayout(
  layout: Exclude<LiveSectionLayout, "platform">,
) {
  return (a: LiveSection, b: LiveSection): number => {
    const rankA =
      layout === "profit-loss"
        ? xeroProfitLossSectionRank(a.name)
        : xeroBalanceSheetSectionRank(a.name, a.group);
    const rankB =
      layout === "profit-loss"
        ? xeroProfitLossSectionRank(b.name)
        : xeroBalanceSheetSectionRank(b.name, b.group);
    if (rankA !== rankB) return rankA - rankB;
    return (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0);
  };
}

function sectionLayoutComparator(layout: LiveSectionLayout) {
  if (layout === "platform") {
    return (a: LiveSection, b: LiveSection) =>
      (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0);
  }
  return compareLiveSectionsByLayout(layout);
}

// ── Xero: both reports fetched live via the existing xero-data function ────
//
// Neither Profit & Loss nor Balance Sheet is read from a pre-synced table:
//  - xero_profit_loss exists but is only as fresh/complete as the last
//    scheduled backend sync, which has its OWN separately-configured date
//    window (Settings > Xero sync date range) — reading it can silently
//    understate a report whose period falls outside that window.
//  - xero_balance_sheet is deliberately cash/bank-only, kept that way to
//    anchor cashflow statements, not a full statement.
// xero-data is already deployed and already supports both endpoints — no new
// function needed. It returns raw Xero report JSON; the Section/Row tree is
// walked here into flat account rows.

/**
 * Walks Xero's Section/Row report tree so the Financial Statements P&L matches
 * Xero's own report (same accounts, same Total Turnover).
 *
 * - `Row` = an account line. Kept even without an accountId (custom layouts
 *   sometimes omit Attributes); keyed by section+name in that case.
 * - `SummaryRow` = a native total ("Total Turnover", "Gross Profit", "Net
 *   Profit"). NEVER treated as a line item — Xero often stamps a parent
 *   accountId on these, and including them doubled section totals.
 *
 * Section/account order follows the depth-first walk of the report JSON, then
 * P&L / Balance Sheet sections are re-ranked to the Xero account-type layout
 * (Income → Cost of Sales → Other Income → Expenses; Current Assets → Bank →
 * Fixed Assets → Non-current Assets → Liabilities → Equity). Title-only banner
 * sections ("Assets" / "Liabilities" / "Equity") update the current top-level
 * group so leaf categories inherit Xero's layout bucket.
 */
function parseXeroAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function resolveXeroAccountId(cells: any[] | undefined): string | null {
  const attrs = cells?.[0]?.Attributes || [];
  const hit =
    attrs.find((a: any) => a.Id === "account") ||
    attrs.find((a: any) => a.Id === "accountID") ||
    attrs.find((a: any) => String(a.Id || "").toLowerCase() === "accountid");
  const id = hit?.Value ? String(hit.Value).trim() : "";
  return id || null;
}

function parseXeroReportRows(report: any): {
  rows: RawRow[];
  summaryRows: RawSummaryRow[];
} {
  const out: RawRow[] = [];
  const summaryRows: RawSummaryRow[] = [];
  let sectionOrderCounter = 0;
  let rowOrderCounter = 0;
  const sectionOrderByLabel = new Map<string, number>();

  const sectionOrderFor = (label: string): number => {
    let order = sectionOrderByLabel.get(label);
    if (order === undefined) {
      order = sectionOrderCounter++;
      sectionOrderByLabel.set(label, order);
    }
    return order;
  };

  const walk = (
    rows: any[],
    sectionLabel: string | null,
    currentGroup: BalanceSheetGroup | null,
  ) => {
    for (const r of rows || []) {
      if (r.RowType === "Section") {
        const title = (r.Title as string | null | undefined) || null;
        const nextGroup = detectBalanceSheetGroup(title) ?? currentGroup;
        // Reserve walk order when the section is first seen (not only when the
        // first account appears), so empty leading sections don't scramble
        // later category indexes. Skip Assets/Liabilities/Equity banners.
        if (title && !detectBalanceSheetGroup(title)) {
          sectionOrderFor(title);
        }
        walk(r.Rows, title || sectionLabel, nextGroup);
      } else if (
        r.RowType === "SummaryRow" &&
        Array.isArray(r.Cells) &&
        r.Cells.length > 1
      ) {
        const label = (r.Cells[0]?.Value || "").trim();
        if (label) {
          summaryRows.push({ label, amount: parseXeroAmount(r.Cells[1]?.Value) });
        }
      } else if (
        r.RowType === "Row" &&
        Array.isArray(r.Cells) &&
        r.Cells.length > 1
      ) {
        const label = (r.Cells[0]?.Value || "").trim();
        if (!label || /^total\s+/i.test(label)) {
          // "Total …" rows that Xero emits as Row instead of SummaryRow.
          if (label) {
            summaryRows.push({
              label,
              amount: parseXeroAmount(r.Cells[1]?.Value),
            });
          }
          continue;
        }
        const section = sectionLabel || "Other";
        const accountId =
          resolveXeroAccountId(r.Cells) || `label:${section}::${label}`;
        out.push({
          accountId,
          section,
          accountName: label,
          amount: parseXeroAmount(r.Cells[1]?.Value),
          sectionOrder: sectionOrderFor(section),
          rowOrder: rowOrderCounter++,
          group: currentGroup,
        });
      }
    }
  };
  walk(report?.Rows, null, null);
  return { rows: out, summaryRows };
}

async function fetchXeroWindow(
  organizationId: string,
  tenantId: string,
  endpoint: "profit-and-loss" | "balance-sheet",
  window: PeriodWindow,
  tracking?: { categoryId?: string | null; optionId?: string | null },
): Promise<{
  rows: RawRow[];
  summaryRows: RawSummaryRow[];
  error: string | null;
}> {
  const body: Record<string, unknown> = {
    organization_id: organizationId,
    endpoint,
    tenant_ids: [tenantId],
    to_date: window.toDate,
  };
  if (endpoint === "profit-and-loss") body.from_date = window.fromDate;
  if (tracking?.categoryId && tracking?.optionId) {
    body.tracking_category_id = tracking.categoryId;
    body.tracking_option_id = tracking.optionId;
  }

  const { data, error } = await supabase.functions.invoke("xero-data", {
    body,
  });
  if (error || !data?.success) {
    return {
      rows: [],
      summaryRows: [],
      error:
        data?.error || error?.message || `Failed to fetch Xero ${endpoint}`,
    };
  }

  const key = endpoint === "balance-sheet" ? "balanceSheet" : "profitAndLoss";
  const result = data.data?.[`${key}_${tenantId}`] ?? data.data?.[key];
  if (!result?.success) {
    return {
      rows: [],
      summaryRows: [],
      error: result?.error || `Xero ${endpoint} request failed`,
    };
  }

  const report = result.data?.Reports?.[0] ?? null;
  const parsed = parseXeroReportRows(report);
  return { rows: parsed.rows, summaryRows: parsed.summaryRows, error: null };
}

// ── QuickBooks: both reports fetched live via the unified quickbooks-reports
// function. QuickBooks has no Balance Sheet sync at all, and quickbooks_profit_loss
// has the same staleness risk as Xero's synced table, so both go live too.

async function fetchQuickBooksWindow(
  organizationId: string,
  entityId: string,
  reportType: "profit-loss" | "balance-sheet",
  window: PeriodWindow,
): Promise<{
  rows: RawRow[];
  summaryRows: RawSummaryRow[];
  error: string | null;
}> {
  const body: Record<string, unknown> = {
    organization_id: organizationId,
    entity_id: entityId,
    report_type: reportType,
  };
  if (reportType === "balance-sheet") {
    body.as_of_date = window.toDate;
  } else {
    body.from_date = window.fromDate;
    body.to_date = window.toDate;
  }

  const { data, error } = await supabase.functions.invoke(
    "quickbooks-reports",
    { body },
  );
  if (error || !data?.success) {
    // FunctionsHttpError/FunctionsFetchError from the client SDK don't carry the
    // function's JSON body message — surface something actionable either way.
    const message =
      data?.error ||
      error?.message ||
      `${reportType} fetch failed (is the quickbooks-reports Edge Function deployed?)`;
    console.error(
      `[useAccountingFinancialReports] quickbooks-reports (${reportType}) error:`,
      message,
    );
    return { rows: [], summaryRows: [], error: message };
  }

  const toRaw = (rows: any[]): RawRow[] =>
    (rows ?? []).map((r, index) => ({
      accountId: r.accountId,
      section: r.section,
      accountName: r.name,
      amount: Number(r.amount) || 0,
      sectionOrder:
        typeof r.sectionOrder === "number" ? r.sectionOrder : index,
      rowOrder: typeof r.rowOrder === "number" ? r.rowOrder : index,
      group: (r.group as BalanceSheetGroup | null | undefined) ?? null,
    }));
  const toSummary = (rows: any[]): RawSummaryRow[] =>
    (rows ?? []).map((r) => ({
      label: r.label,
      amount: Number(r.amount) || 0,
    }));

  return {
    rows: toRaw(data.current?.rows),
    summaryRows: toSummary(data.current?.summaryRows),
    error: null,
  };
}

async function fetchAllWindows(
  fetchOne: (
    window: PeriodWindow,
  ) => Promise<{
    rows: RawRow[];
    summaryRows: RawSummaryRow[];
    error: string | null;
  }>,
  windows: PeriodWindow[],
): Promise<{
  rowsPerWindow: RawRow[][];
  summaryRowsPerWindow: RawSummaryRow[][];
  error: string | null;
}> {
  const results = await Promise.all(windows.map(fetchOne));
  const failed = results.find((r) => r.error);
  return {
    rowsPerWindow: results.map((r) => r.rows),
    summaryRowsPerWindow: results.map((r) => r.summaryRows),
    error: failed?.error ?? null,
  };
}

// ── Aggregation + section building ─────────────────────────────────

type AggEntry = {
  section: string;
  accountName?: string | null;
  amounts: number[];
  sectionOrder: number;
  rowOrder: number;
  group: BalanceSheetGroup | null;
};

/**
 * Sums each account's amount per window into a single {accountId -> amounts[]}
 * map, defensive against an account repeating within one window's rows
 * (parent shown as both header and leaf). Preserves first-seen report order
 * from window 0.
 *
 * `columnCount`/`offset` let the Compare Locations "side by side" mode place
 * one location's windows into its own slice of a wider column set — each
 * location gets `windows.length` columns starting at `offset`, so summing
 * these zero-elsewhere amounts across locations (via mergeLiveSections'
 * existing per-column sum) produces a concatenation rather than a blend.
 * Defaults preserve the original single-location behavior exactly.
 */
function aggregateMultiWindow(
  rowsPerWindow: RawRow[][],
  columnCount: number = rowsPerWindow.length,
  offset: number = 0,
): Map<string, AggEntry> {
  const map = new Map<string, AggEntry>();
  rowsPerWindow.forEach((rows, k) => {
    // De-duplicate within this window first — a parent account can appear as
    // both a section header and a sibling leaf row with the same amount
    // (this is what the QuickBooks edge function's own parseQboReport already
    // guards against via an identical last-one-wins Map). Without this, the
    // same account's amount gets summed twice into this window's column.
    // Prefer the last occurrence's amount, but keep the earliest rowOrder so
    // layout still matches the platform's first appearance.
    const byAccountThisWindow = new Map<string, RawRow>();
    for (const r of rows) {
      if (!r.accountId) continue;
      const prev = byAccountThisWindow.get(r.accountId);
      if (!prev) {
        byAccountThisWindow.set(r.accountId, r);
      } else {
        byAccountThisWindow.set(r.accountId, {
          ...r,
          sectionOrder: Math.min(prev.sectionOrder, r.sectionOrder),
          rowOrder: Math.min(prev.rowOrder, r.rowOrder),
          group: prev.group ?? r.group ?? null,
        });
      }
    }
    for (const r of byAccountThisWindow.values()) {
      let entry = map.get(r.accountId);
      if (!entry) {
        entry = {
          section: r.section || "Other",
          accountName: r.accountName,
          amounts: new Array(columnCount).fill(0),
          sectionOrder: r.sectionOrder,
          rowOrder: r.rowOrder,
          group: r.group ?? null,
        };
        map.set(r.accountId, entry);
      }
      entry.amounts[offset + k] = r.amount;
      if (!entry.section && r.section) entry.section = r.section;
      if (!entry.accountName && r.accountName)
        entry.accountName = r.accountName;
      // Keep current-period (window 0) walk order. Later comparison windows
      // often omit zero-balance sections (e.g. only Bank appears), and
      // Math.min'ing those indexes was scrambling Fixed Assets ahead/behind
      // Current Assets relative to Xero's Balance Sheet.
      if (k === 0) {
        entry.sectionOrder = r.sectionOrder;
        entry.rowOrder = r.rowOrder;
        if (r.section) entry.section = r.section;
        if (r.group) entry.group = r.group;
      }
      if (!entry.group && r.group) entry.group = r.group;
    }
  });
  return map;
}

/**
 * Drops COA parent rows whose amount equals the sum of the other rows in the
 * same section. Xero compact view shows only the leaves; keeping the parent
 * doubles Turnover / Cost of Sales / etc.
 */
function dropParentRollupItems(items: LiveLineItem[]): LiveLineItem[] {
  if (items.length < 2) {
    return items.filter((item) => !/^total\s+/i.test((item.name || "").trim()));
  }
  const withoutTotalLabels = items.filter(
    (item) => !/^total\s+/i.test((item.name || "").trim()),
  );
  const leaves = withoutTotalLabels.filter((item) => {
    const colCount = item.amounts.length;
    let matchesSiblings = true;
    let anyNonZero = false;
    for (let i = 0; i < colCount; i++) {
      const own = item.amounts[i] ?? 0;
      if (Math.abs(own) > 0.005) anyNonZero = true;
      let siblings = 0;
      for (const other of withoutTotalLabels) {
        if (other === item) continue;
        siblings += other.amounts[i] ?? 0;
      }
      if (Math.abs(own - siblings) > 0.02) {
        matchesSiblings = false;
        break;
      }
    }
    return !(matchesSiblings && anyNonZero);
  });
  return leaves.length > 0 ? leaves : withoutTotalLabels;
}

function sumItemAmounts(items: LiveLineItem[], columnCount: number): number[] {
  const totalAmounts = new Array(columnCount).fill(0);
  for (const item of items) {
    item.amounts.forEach((a, i) => {
      totalAmounts[i] += a;
    });
  }
  return totalAmounts;
}

function buildLiveSections(
  agg: Map<string, AggEntry>,
  columnCount: number,
  locationName?: string,
  /** Canonical Xero P&L / Balance Sheet section order. */
  layout: LiveSectionLayout = "platform",
): LiveSection[] {
  const bySection = new Map<
    string,
    { items: LiveLineItem[]; sectionOrder: number; group: BalanceSheetGroup | null }
  >();

  // Sort accounts by report walk order before grouping so section insertion
  // order and within-section item order both match the platform layout.
  const orderedEntries = [...agg.entries()].sort(
    (a, b) =>
      a[1].sectionOrder - b[1].sectionOrder ||
      a[1].rowOrder - b[1].rowOrder,
  );

  for (const [accountId, entry] of orderedEntries) {
    const item: LiveLineItem = {
      id: locationName ? `${locationName}:${accountId}` : accountId,
      name: entry.accountName || accountId,
      amounts: entry.amounts,
      rowOrder: entry.rowOrder,
      ...(locationName ? { locationName } : {}),
    };
    let bucket = bySection.get(entry.section);
    if (!bucket) {
      bucket = {
        items: [],
        sectionOrder: entry.sectionOrder,
        group: entry.group,
      };
      bySection.set(entry.section, bucket);
    }
    bucket.items.push(item);
    bucket.sectionOrder = Math.min(bucket.sectionOrder, entry.sectionOrder);
    if (!bucket.group && entry.group) bucket.group = entry.group;
  }

  const sections: LiveSection[] = [];
  for (const [sectionName, bucket] of bySection) {
    const items = dropParentRollupItems(bucket.items);
    sections.push({
      id: sectionName,
      name: sectionName,
      items,
      totalAmounts: sumItemAmounts(items, columnCount),
      sectionOrder: bucket.sectionOrder,
      group: bucket.group,
    });
  }

  sections.sort(sectionLayoutComparator(layout));
  return sections;
}

/**
 * Prefer Xero's own "Total Turnover" / "Total Cost of Sales" summary amounts
 * for the section footer so the figure matches the Xero report even if a leaf
 * was dropped or a parent slipped through.
 */
function applyNativeSectionTotals(
  sections: LiveSection[],
  summaryRowsPerWindow: RawSummaryRow[][],
  columnCount: number,
  offset: number,
): LiveSection[] {
  return sections.map((section) => {
    const needle = `total ${section.name.trim().toLowerCase()}`;
    const native = summaryRowsPerWindow.map((rows) => {
      const match = rows.find(
        (r) => r.label.trim().toLowerCase() === needle,
      );
      return match ? match.amount : null;
    });
    if (!native.some((v) => v !== null)) return section;
    const totalAmounts = [...section.totalAmounts];
    native.forEach((value, k) => {
      if (value !== null) totalAmounts[offset + k] = value;
    });
    return { ...section, totalAmounts };
  });
}

/** Merges per-location section trees: same section name → combined items; totals summed. */
function mergeLiveSections(
  sectionLists: LiveSection[][],
  columnCount: number,
  /** Canonical Xero P&L / Balance Sheet section order. */
  layout: LiveSectionLayout = "platform",
): LiveSection[] {
  const sectionComparator = sectionLayoutComparator(layout);

  if (sectionLists.length === 0) return [];
  if (sectionLists.length === 1) {
    return [...sectionLists[0]].sort(sectionComparator);
  }

  const byName = new Map<string, LiveSection>();
  for (const sections of sectionLists) {
    for (const section of sections) {
      let merged = byName.get(section.name);
      if (!merged) {
        merged = {
          id: section.id,
          name: section.name,
          items: [],
          totalAmounts: new Array(columnCount).fill(0),
          sectionOrder: section.sectionOrder ?? Number.MAX_SAFE_INTEGER,
          group: section.group ?? null,
        };
        byName.set(section.name, merged);
      }
      merged.items.push(...section.items);
      section.totalAmounts.forEach((amount, i) => {
        merged!.totalAmounts[i] += amount;
      });
      merged.sectionOrder = Math.min(
        merged.sectionOrder ?? Number.MAX_SAFE_INTEGER,
        section.sectionOrder ?? Number.MAX_SAFE_INTEGER,
      );
      if (!merged.group && section.group) merged.group = section.group;
    }
  }

  for (const section of byName.values()) {
    // Report order first; location name only breaks ties for the same account
    // across locations — never alphabetize accounts (that breaks Xero order).
    section.items.sort(
      (a, b) =>
        (a.rowOrder ?? 0) - (b.rowOrder ?? 0) ||
        (a.locationName || "").localeCompare(b.locationName || ""),
    );
  }

  return [...byName.values()].sort(sectionComparator);
}

/** Sums nullable per-column totals across locations — null only when every location lacked that figure. */
function sumNullableColumns(
  columnsPerLocation: (number | null)[][],
  columnCount: number,
): (number | null)[] {
  return Array.from({ length: columnCount }, (_, i) => {
    let sum = 0;
    let any = false;
    for (const cols of columnsPerLocation) {
      const value = cols[i];
      if (value !== null && value !== undefined) {
        sum += value;
        any = true;
      }
    }
    return any ? sum : null;
  });
}

/**
 * Places `arr` into a `length`-sized array starting at `offset`, filling
 * everywhere else with `fill`. Used by the Compare Locations "side by side"
 * mode to give each location's per-window summary figures (Revenue, Total
 * Assets, etc.) their own slice of a wider column set, mirroring
 * aggregateMultiWindow's offset — so sumNullableColumns's existing per-column
 * sum across locations reduces to a concatenation.
 */
function expandToOffset<T>(
  arr: T[],
  offset: number,
  length: number,
  fill: T,
): T[] {
  const out = new Array<T>(length).fill(fill);
  for (let i = 0; i < arr.length; i++) {
    out[offset + i] = arr[i];
  }
  return out;
}

// ── Native platform totals (Total Income, Gross Profit, Net Income, Total
// Assets, Total Liabilities, Total Equity) — Xero/QuickBooks report these
// themselves as summary rows, one per column/window. Read directly off
// whatever the platform's response actually contains for that column — no
// locally-derived/estimated number. A column comes back `null` when that
// column's report simply didn't include that particular summary line.

const REVENUE_TOTAL_KEYWORDS = [
  "total income",
  "total revenue",
  "total turnover",
  "total sales",
];
const GROSS_PROFIT_TOTAL_KEYWORDS = ["gross profit"];
const NET_PROFIT_TOTAL_KEYWORDS = ["net profit", "net income", "net loss"];
const TOTAL_ASSETS_KEYWORDS = ["total assets"];
const TOTAL_LIABILITIES_KEYWORDS = ["total liabilities"];
const TOTAL_LIABILITIES_EXCLUDE_KEYWORDS = [
  "and equity",
  "and shareholders",
  "and stockholders",
];
const TOTAL_EQUITY_KEYWORDS = [
  "total equity",
  "total shareholders' equity",
  "total shareholders equity",
  "total stockholders equity",
];
const NET_ASSETS_KEYWORDS = ["net assets", "total net assets"];

/** Finds the native total (if the platform reported one) for each column/window independently — null when that column's report didn't include it. */
function findSummaryAmountPerColumn(
  rowsPerWindow: RawSummaryRow[][],
  keywords: string[],
  excludeKeywords: string[] = [],
): (number | null)[] {
  return findSummaryRowPerColumn(rowsPerWindow, keywords, excludeKeywords).map(
    (r) => r.amount,
  );
}

/**
 * Same match as findSummaryAmountPerColumn, but keeps the platform's own
 * label text too (e.g. Xero's "Net Profit" vs QuickBooks' "Net Income", or
 * "Net Loss" when the period ran negative) — the caller decides whether to
 * show that literal wording or a normalized one.
 */
function findSummaryRowPerColumn(
  rowsPerWindow: RawSummaryRow[][],
  keywords: string[],
  excludeKeywords: string[] = [],
): { amount: number | null; label: string | null }[] {
  return rowsPerWindow.map((rows) => {
    const match = rows.find((r) => {
      const label = r.label.toLowerCase();
      if (excludeKeywords.some((kw) => label.includes(kw))) return false;
      return keywords.some((kw) => label.includes(kw));
    });
    return match
      ? { amount: match.amount, label: match.label }
      : { amount: null, label: null };
  });
}

// ── Main hook ───────────────────────────────────────────────────────

type EntityReportBundle = {
  plRowsPerWindow: RawRow[][];
  bsRowsPerWindow: RawRow[][];
  plSummaryRowsPerWindow: RawSummaryRow[][];
  bsSummaryRowsPerWindow: RawSummaryRow[][];
  plError: string | null;
  bsError: string | null;
  sourceLabel: string;
  locationName: string;
};

async function fetchEntityReports(
  organizationId: string,
  entity: LocationAccountingEntity | AccountingEntity & { locationName?: string },
  windows: PeriodWindow[],
): Promise<EntityReportBundle> {
  const platform = entity.platform;
  const tenantVal = entity.id;
  const platformOrgId = entity.platform_org_id;
  const locationName =
    "locationName" in entity && entity.locationName
      ? entity.locationName
      : entity.platform_org_name || "Location";

  const tracking =
    platform === "xero"
      ? {
          categoryId:
            "xeroTrackingCategoryId" in entity
              ? (entity as LocationAccountingEntity).xeroTrackingCategoryId
              : null,
          optionId:
            "xeroTrackingOptionId" in entity
              ? (entity as LocationAccountingEntity).xeroTrackingOptionId
              : null,
        }
      : undefined;

  const fetchPL = (window: PeriodWindow) =>
    platform === "xero"
      ? fetchXeroWindow(
          organizationId,
          platformOrgId,
          "profit-and-loss",
          window,
          tracking,
        )
      : fetchQuickBooksWindow(
          organizationId,
          tenantVal,
          "profit-loss",
          window,
        );
  const fetchBS = (window: PeriodWindow) =>
    platform === "xero"
      ? fetchXeroWindow(
          organizationId,
          platformOrgId,
          "balance-sheet",
          window,
          tracking,
        )
      : fetchQuickBooksWindow(
          organizationId,
          tenantVal,
          "balance-sheet",
          window,
        );

  const [pl, bs] = await Promise.all([
    fetchAllWindows(fetchPL, windows),
    fetchAllWindows(fetchBS, windows),
  ]);

  return {
    plRowsPerWindow: pl.rowsPerWindow,
    bsRowsPerWindow: bs.rowsPerWindow,
    plSummaryRowsPerWindow: pl.summaryRowsPerWindow,
    bsSummaryRowsPerWindow: bs.summaryRowsPerWindow,
    plError: pl.error,
    bsError: bs.error,
    sourceLabel: platform === "xero" ? "Xero" : "QuickBooks",
    locationName,
  };
}

/**
 * Live Profit &amp; Loss + Balance Sheet for one or more accounting entities,
 * grouped into location "columns" for the Compare Locations control.
 *
 * `entityGroups` is an array of groups — normally one group (today's single
 * location, or every mapped location under All Locations, summed together as
 * before). When the Compare Locations control is in "side by side" mode, each
 * selected location becomes its OWN group; entities within a group are still
 * summed together (e.g. a location mapped to more than one tenant), but
 * groups are never summed across each other — each gets its own
 * `windows.length`-wide slice of the column set (see aggregateMultiWindow's
 * offset), so location-major columns come out as a natural side effect of
 * reusing the existing per-column sum across a wider, zero-elsewhere array.
 */
export function useAccountingFinancialReports(
  entityGroups:
    | (LocationAccountingEntity[] | AccountingEntity[])[]
    | undefined,
  compareWith: CompareWith | null | undefined,
  dateRange: { startDate: Date; endDate: Date },
  /**
   * One label per group, in the same order as `entityGroups` — pass the
   * user-selected location names explicitly so a group with no resolved
   * entity (no accounting mapping, or a tenant shared with another selected
   * location) still gets a real name instead of a generic "Location N"
   * fallback or vanishing column.
   */
  groupLabels?: string[],
) {
  const { organizationId } = useOrganization();

  const windows = useMemo(
    () => buildPeriodWindows(dateRange, compareWith),
    [dateRange, compareWith],
  );
  const windowCount = windows.length;

  const groups = entityGroups ?? [];
  const groupCount = groups.length;
  const finalColumnCount = windowCount * groupCount;

  // Flatten entities across groups, tracking which group (and therefore
  // which column offset) each one belongs to.
  const flatEntities = useMemo(
    () =>
      groups.flatMap((group, groupIndex) =>
        (group ?? []).map((entity) => ({ entity, groupIndex })),
      ),
    [groups],
  );

  const entityKey = flatEntities
    .map(({ entity, groupIndex }) => {
      const loc =
        "locationId" in entity &&
        typeof (entity as LocationAccountingEntity).locationId === "string"
          ? (entity as LocationAccountingEntity).locationId
          : "";
      const tracking =
        "xeroTrackingOptionId" in entity
          ? (entity as LocationAccountingEntity).xeroTrackingOptionId || ""
          : "";
      return `${groupIndex}:${entity.platform}:${entity.id}:${loc}:${tracking}`;
    })
    .join("|");
  const multiLocation = flatEntities.length > 1;

  const { data, isLoading } = useQuery({
    queryKey: [
      "accounting-financial-reports",
      organizationId,
      entityKey,
      windows.map((w) => `${w.fromDate}:${w.toDate}`).join(","),
    ],
    queryFn: async () => {
      const empty = {
        bundles: [] as (EntityReportBundle & { groupIndex: number })[],
      };
      if (!organizationId || flatEntities.length === 0) return empty;

      const bundles = await Promise.all(
        flatEntities.map(async ({ entity, groupIndex }) => ({
          ...(await fetchEntityReports(
            organizationId,
            entity as LocationAccountingEntity,
            windows,
          )),
          groupIndex,
        })),
      );

      return { bundles };
    },
    enabled: !!organizationId && flatEntities.length > 0,
  });

  const {
    profitAndLossData,
    balanceSheetData,
    plSummary,
    bsSummary,
    hasData,
    sourceLabel,
    plError,
    bsError,
  } = useMemo(() => {
    const bundles = data?.bundles ?? [];
    const emptySummary = {
      revenue: [] as (number | null)[],
      grossProfit: [] as (number | null)[],
      ebitda: [] as (number | null)[],
      netProfitLabel: [] as (string | null)[],
    };
    const emptyBs = {
      totalAssets: [] as (number | null)[],
      totalLiabilities: [] as (number | null)[],
      netAssets: [] as (number | null)[],
      equity: [] as (number | null)[],
    };

    if (bundles.length === 0) {
      return {
        profitAndLossData: [] as LiveSection[],
        balanceSheetData: [] as LiveSection[],
        plSummary: emptySummary,
        bsSummary: emptyBs,
        hasData: false,
        sourceLabel: "",
        plError: null as string | null,
        bsError: null as string | null,
      };
    }

    const stampLocation = multiLocation;
    const plSectionLists: LiveSection[][] = [];
    const bsSectionLists: LiveSection[][] = [];
    const plRevenue: (number | null)[][] = [];
    const plGross: (number | null)[][] = [];
    const plNetAmounts: (number | null)[][] = [];
    const plNetLabels: (string | null)[][] = [];
    const bsAssets: (number | null)[][] = [];
    const bsLiabilities: (number | null)[][] = [];
    const bsNetAssets: (number | null)[][] = [];
    const bsEquity: (number | null)[][] = [];

    for (const bundle of bundles) {
      const offset = bundle.groupIndex * windowCount;
      const locationName = stampLocation ? bundle.locationName : undefined;
      plSectionLists.push(
        applyNativeSectionTotals(
          buildLiveSections(
            aggregateMultiWindow(bundle.plRowsPerWindow, finalColumnCount, offset),
            finalColumnCount,
            locationName,
            "profit-loss",
          ),
          bundle.plSummaryRowsPerWindow,
          finalColumnCount,
          offset,
        ),
      );
      bsSectionLists.push(
        applyNativeSectionTotals(
          buildLiveSections(
            aggregateMultiWindow(bundle.bsRowsPerWindow, finalColumnCount, offset),
            finalColumnCount,
            locationName,
            "balance-sheet",
          ),
          bundle.bsSummaryRowsPerWindow,
          finalColumnCount,
          offset,
        ),
      );

      const netProfitPerColumn = findSummaryRowPerColumn(
        bundle.plSummaryRowsPerWindow,
        NET_PROFIT_TOTAL_KEYWORDS,
      );
      plRevenue.push(
        expandToOffset(
          findSummaryAmountPerColumn(
            bundle.plSummaryRowsPerWindow,
            REVENUE_TOTAL_KEYWORDS,
          ),
          offset,
          finalColumnCount,
          null,
        ),
      );
      plGross.push(
        expandToOffset(
          findSummaryAmountPerColumn(
            bundle.plSummaryRowsPerWindow,
            GROSS_PROFIT_TOTAL_KEYWORDS,
          ),
          offset,
          finalColumnCount,
          null,
        ),
      );
      plNetAmounts.push(
        expandToOffset(
          netProfitPerColumn.map((r) => r.amount),
          offset,
          finalColumnCount,
          null,
        ),
      );
      plNetLabels.push(
        expandToOffset(
          netProfitPerColumn.map((r) => r.label),
          offset,
          finalColumnCount,
          null,
        ),
      );
      bsAssets.push(
        expandToOffset(
          findSummaryAmountPerColumn(
            bundle.bsSummaryRowsPerWindow,
            TOTAL_ASSETS_KEYWORDS,
          ),
          offset,
          finalColumnCount,
          null,
        ),
      );
      bsLiabilities.push(
        expandToOffset(
          findSummaryAmountPerColumn(
            bundle.bsSummaryRowsPerWindow,
            TOTAL_LIABILITIES_KEYWORDS,
            TOTAL_LIABILITIES_EXCLUDE_KEYWORDS,
          ),
          offset,
          finalColumnCount,
          null,
        ),
      );
      bsNetAssets.push(
        expandToOffset(
          findSummaryAmountPerColumn(
            bundle.bsSummaryRowsPerWindow,
            NET_ASSETS_KEYWORDS,
          ),
          offset,
          finalColumnCount,
          null,
        ),
      );
      bsEquity.push(
        expandToOffset(
          findSummaryAmountPerColumn(
            bundle.bsSummaryRowsPerWindow,
            TOTAL_EQUITY_KEYWORDS,
          ),
          offset,
          finalColumnCount,
          null,
        ),
      );
    }

    const platforms = [...new Set(bundles.map((b) => b.sourceLabel))];
    const sourceLabel =
      platforms.length === 1
        ? platforms[0]
        : platforms.length > 1
          ? platforms.join(" + ")
          : "";

    const firstPlError = bundles.find((b) => b.plError)?.plError ?? null;
    const firstBsError = bundles.find((b) => b.bsError)?.bsError ?? null;
    const anyPlData = bundles.some((b) =>
      b.plRowsPerWindow.some((rows) => rows.length > 0),
    );
    const anyBsData = bundles.some((b) =>
      b.bsRowsPerWindow.some((rows) => rows.length > 0),
    );

    const totalAssets = sumNullableColumns(bsAssets, finalColumnCount);
    const totalLiabilities = sumNullableColumns(bsLiabilities, finalColumnCount);
    const nativeNetAssets = sumNullableColumns(bsNetAssets, finalColumnCount);
    const nativeEquity = sumNullableColumns(bsEquity, finalColumnCount);
    const computedNetAssets = totalAssets.map((assets, i) => {
      const liabilities = totalLiabilities[i];
      if (assets === null && liabilities === null) return null;
      return (assets ?? 0) - (liabilities ?? 0);
    });
    const netAssets = nativeNetAssets.map((value, i) =>
      value !== null ? value : computedNetAssets[i],
    );
    const equity = nativeEquity.map((value, i) =>
      value !== null ? value : netAssets[i],
    );

    return {
      profitAndLossData: mergeLiveSections(
        plSectionLists,
        finalColumnCount,
        "profit-loss",
      ),
      balanceSheetData: mergeLiveSections(
        bsSectionLists,
        finalColumnCount,
        "balance-sheet",
      ),
      plSummary: {
        revenue: sumNullableColumns(plRevenue, finalColumnCount),
        grossProfit: sumNullableColumns(plGross, finalColumnCount),
        ebitda: sumNullableColumns(plNetAmounts, finalColumnCount),
        netProfitLabel: Array.from({ length: finalColumnCount }, (_, i) => {
          for (const labels of plNetLabels) {
            if (labels[i]) return labels[i];
          }
          return null;
        }),
      },
      bsSummary: {
        totalAssets,
        totalLiabilities,
        netAssets,
        equity,
      },
      hasData: anyPlData || anyBsData,
      sourceLabel,
      plError: anyPlData ? null : firstPlError,
      bsError: anyBsData ? null : firstBsError,
    };
  }, [data, finalColumnCount, windowCount, multiLocation]);

  // One label per column: the location name (only when comparing 2+ location
  // groups side by side) and/or the window's date, index-aligned with every
  // section/line item's amounts[].
  const resolvedGroupLabels =
    groupLabels ??
    groups.map(
      (g, i) =>
        (g?.[0] as LocationAccountingEntity | undefined)?.locationName ??
        `Location ${i + 1}`,
    );
  const columnDates =
    groupCount > 1
      ? resolvedGroupLabels.flatMap(() => windows.map((w) => w.toDate))
      : windows.map((w) => w.toDate);
  const columnLocationNames: (string | null)[] | undefined =
    groupCount > 1
      ? resolvedGroupLabels.flatMap((label) => Array(windowCount).fill(label))
      : undefined;

  return {
    profitAndLossData,
    balanceSheetData,
    /** One label-worthy ISO date per column, index-aligned with every section/line item's amounts[]. */
    columnDates,
    /** Location name per column — only set when comparing 2+ location groups side by side (undefined otherwise). Index-aligned with columnDates. */
    columnLocationNames,
    /** Net Profit/Income, Gross Profit, Revenue — one value per column, index-aligned with columnDates. plSummary.netProfitLabel carries the platform's own wording for the net profit row. */
    plSummary,
    /** Total Assets, Total Liabilities, Net Assets, Total Equity — one value per column, index-aligned with columnDates. */
    bsSummary,
    isLoading,
    hasData,
    sourceLabel,
    /**
     * True when more than one location/tenant is combined into the SAME
     * columns (today's All Locations / Compare Locations "Combined" mode) —
     * the per-row Location cell is the only way to tell which location a
     * line came from, so it should render. False when comparing locations
     * "side by side" (groupCount > 1): each column's header already names
     * its location, so a per-row Location cell would just repeat it.
     */
    showLocationColumn: multiLocation && groupCount <= 1,
    /** How many location groups are being compared — 1 in the normal/Combined case, 2+ when Compare Locations is in "side by side" mode. */
    groupCount,
    plError,
    bsError,
    /** The overall period being viewed, plus the oldest comparison date (if any) for a quick "vs" summary line. */
    dateRange: {
      currentFrom: windows[0]?.fromDate ?? toISODate(dateRange.startDate),
      currentTo: windows[0]?.toDate ?? toISODate(dateRange.endDate),
      priorFrom:
        windows.length > 1 ? windows[windows.length - 1].fromDate : null,
      priorTo: windows.length > 1 ? windows[windows.length - 1].toDate : null,
    },
  };
}
