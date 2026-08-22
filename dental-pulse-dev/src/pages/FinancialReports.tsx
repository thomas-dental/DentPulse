import { Helmet } from "react-helmet-async";
import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { useTabPermissions } from "@/hooks/useTabPermissions";
import { useFilters } from "@/contexts/FilterContext";
import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveFinancialSection } from "@/components/reports/LiveFinancialSection";
import { buildLiveReportGridLayout } from "@/components/reports/liveReportGrid";
import { CashflowStatementPanel } from "@/components/cashflow/CashflowStatementPanel";
import { CompareWithControl } from "@/components/reports/CompareWithControl";
import {
  LocationCompareControl,
  type LocationCompareMode,
} from "@/components/reports/LocationCompareControl";
import {
  ChartDateFilter,
  calculateDateRangeFromFilter,
  getDateFilterLabel,
  type DateFilterType,
  type CustomRange,
} from "@/components/ui/chart-date-filter";
import { Button } from "@/components/ui/button";
import {
  useAccountingLocationEntities,
  useAccountingFinancialReports,
  inferBalanceSheetGroupFromSectionName,
  type CompareWith,
  type BalanceSheetGroup,
  type LiveSection,
  type LocationAccountingEntity,
} from "@/hooks/useAccountingFinancialReports";
import {
  partitionPlSections,
  partitionBsSections,
  splitEquityNetProfit,
  plSectionOperator,
  bsSectionOperator,
  type ReportOperator,
} from "@/lib/financialStatementLayout";
import { useLocations } from "@/hooks/useLocations";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { formatCurrency as formatCurrencyBase } from "@/lib/currency";
import { FileSpreadsheet, Loader2, Calendar, ChevronDown } from "lucide-react";

/** Resolve each BS section's top-level group from the platform walk, with a name-based fallback only when the report had no Assets/Liabilities/Equity banners. */
function resolveBalanceSheetGroup(section: LiveSection): BalanceSheetGroup {
  return section.group ?? inferBalanceSheetGroupFromSectionName(section.name);
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));

/**
 * Group (Average) mode keeps every real per-location column as-is and
 * APPENDS one more derived column per window: the average across every
 * location group for that window. `amounts`/`values` are already laid out
 * location-major (group 0's windows, then group 1's windows, …) by the
 * hook, so column `g * windowCount + k` is group g's value for window k —
 * these read that layout back out to average across groups per window.
 * `divisor` is the count of locations that actually resolved data (an
 * unmapped location's columns are 0/null and shouldn't deflate the average).
 */
function averageAcrossGroups(
  amounts: number[],
  groupCount: number,
  windowCount: number,
  divisor: number,
): number[] {
  const out: number[] = [];
  for (let k = 0; k < windowCount; k++) {
    let sum = 0;
    for (let g = 0; g < groupCount; g++) {
      sum += amounts[g * windowCount + k] ?? 0;
    }
    out.push(divisor > 0 ? sum / divisor : 0);
  }
  return out;
}

function averageAcrossGroupsNullable(
  values: (number | null)[],
  groupCount: number,
  windowCount: number,
  divisor: number,
): (number | null)[] {
  const out: (number | null)[] = [];
  for (let k = 0; k < windowCount; k++) {
    let sum = 0;
    let any = false;
    for (let g = 0; g < groupCount; g++) {
      const v = values[g * windowCount + k];
      if (v !== null && v !== undefined) {
        sum += v;
        any = true;
      }
    }
    out.push(any && divisor > 0 ? sum / divisor : null);
  }
  return out;
}

/** Same idea as averageAcrossGroupsNullable but for the label columns (e.g. plSummary.netProfitLabel) — picks the first group that actually had a label for that window. */
function appendAverageLabelColumns(
  labels: (string | null)[],
  groupCount: number,
  windowCount: number,
): (string | null)[] {
  const out: (string | null)[] = [];
  for (let k = 0; k < windowCount; k++) {
    let found: string | null = null;
    for (let g = 0; g < groupCount; g++) {
      const l = labels[g * windowCount + k];
      if (l) {
        found = l;
        break;
      }
    }
    out.push(found);
  }
  return out;
}

function appendAverageColumns(
  sections: LiveSection[],
  groupCount: number,
  windowCount: number,
  divisor: number,
): LiveSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      amounts: [
        ...item.amounts,
        ...averageAcrossGroups(item.amounts, groupCount, windowCount, divisor),
      ],
    })),
    totalAmounts: [
      ...section.totalAmounts,
      ...averageAcrossGroups(section.totalAmounts, groupCount, windowCount, divisor),
    ],
  }));
}

export default function FinancialReports() {
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyBase(value, showDecimals),
    [showDecimals],
  );
  const { canViewTab, defaultTab } = useTabPermissions("financial_reports");
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(
    tabFromUrl || defaultTab || "profit-loss",
  );

  // Keep tab in sync with URL (sidebar links like Balance Sheet, back/forward).
  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab && canViewTab(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (defaultTab && !canViewTab(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const { selectedLocationId, dateRange: globalDateRange, selectedDateRangeId } =
    useFilters();
  const isAllLocations =
    !selectedLocationId || selectedLocationId === "all";

  // Compare Locations — lets the user add other locations to the one
  // selected up top, either Combined (summed into one set of totals) or
  // Side by side (each location gets its own columns). Meaningless (and
  // disabled) when the top-nav filter is already "All Locations".
  const [compareLocationIds, setCompareLocationIds] = useState<string[]>([]);
  const [locationCompareMode, setLocationCompareMode] =
    useState<LocationCompareMode>("combined");

  // If the top-nav location changes to something already in the compare
  // list, drop it from the list — otherwise it'd show up twice.
  useEffect(() => {
    setCompareLocationIds((prev) =>
      prev.filter((id) => id !== selectedLocationId),
    );
  }, [selectedLocationId]);

  const locationIdsToResolve = isAllLocations
    ? null
    : compareLocationIds.length > 0
      ? Array.from(new Set([selectedLocationId as string, ...compareLocationIds]))
      : selectedLocationId;

  const { data: locationEntities = [], isLoading: entityLoading } =
    useAccountingLocationEntities(locationIdsToResolve);

  const { allAvailableLocations } = useLocations();
  const locationNameById = useMemo(() => {
    const map = new Map<string, string>();
    (allAvailableLocations ?? []).forEach((l) => map.set(l.id, l.location_name));
    return map;
  }, [allAvailableLocations]);

  // One group = today's behavior (single location, or every mapped location
  // summed under All Locations/Combined). Side by side AND Group (Average)
  // both split the resolved entities into one group per selected location,
  // in selection order, so each location gets its own slice of report
  // columns (see useAccountingFinancialReports) — Average then appends one
  // more derived "Average" column on top of those real per-location columns
  // (see profitAndLossData/balanceSheetData/plSummary/bsSummary below),
  // rather than collapsing everything into a single blended column. Groups
  // are kept even when a location has no accounting entity resolved (no
  // mapping, or it shares a tenant with another selected location) — the
  // column still shows, empty, rather than silently disappearing.
  const { entityGroups, groupLabels } = useMemo(() => {
    if (
      !isAllLocations &&
      (locationCompareMode === "side-by-side" || locationCompareMode === "average") &&
      compareLocationIds.length > 0 &&
      selectedLocationId
    ) {
      const order = [selectedLocationId, ...compareLocationIds];
      return {
        entityGroups: order.map((locId) =>
          locationEntities.filter((e) => e.locationId === locId),
        ),
        groupLabels: order.map(
          (locId) => locationNameById.get(locId) ?? "Location",
        ),
      };
    }
    return {
      entityGroups: [locationEntities] as LocationAccountingEntity[][],
      groupLabels: undefined as string[] | undefined,
    };
  }, [
    isAllLocations,
    locationCompareMode,
    compareLocationIds,
    selectedLocationId,
    locationEntities,
    locationNameById,
  ]);

  const [compareWith, setCompareWith] = useState<CompareWith | null>(null);

  const reportFilterFromGlobal = (
    ["this-month", "this-quarter", "this-year", "last-month", "last-quarter", "last-year", "custom"] as DateFilterType[]
  ).includes(selectedDateRangeId as DateFilterType)
    ? (selectedDateRangeId as DateFilterType)
    : "custom";

  // Follow the top-bar period (e.g. Last Month → 1–31 Jul) so this screen
  // requests the same from/to dates as Xero's P&L, not a copied custom range
  // that can drift when the global filter is a named preset.
  const [reportDateFilter, setReportDateFilter] = useState<DateFilterType>(
    reportFilterFromGlobal,
  );
  const [reportCustomRange, setReportCustomRange] = useState<CustomRange>({
    from: globalDateRange.startDate,
    to: globalDateRange.endDate,
  });

  useEffect(() => {
    setReportDateFilter(reportFilterFromGlobal);
    setReportCustomRange({
      from: globalDateRange.startDate,
      to: globalDateRange.endDate,
    });
  }, [selectedDateRangeId, globalDateRange.startDate, globalDateRange.endDate]);

  // Show the actual selected dates for a custom range instead of the generic
  // "Custom Range" label, so the trigger always reflects what's applied.
  const reportFilterLabel =
    reportDateFilter === "custom" &&
    reportCustomRange.from &&
    reportCustomRange.to
      ? `${format(reportCustomRange.from, "dd-MM-yyyy")} → ${format(reportCustomRange.to, "dd-MM-yyyy")}`
      : getDateFilterLabel(reportDateFilter);
  const dateRange = useMemo(
    () => calculateDateRangeFromFilter(reportDateFilter, reportCustomRange),
    [reportDateFilter, reportCustomRange],
  );

  const report = useAccountingFinancialReports(
    entityGroups,
    compareWith,
    dateRange,
    groupLabels,
  );

  // How many report columns each location group occupies — 1 unless
  // "Compare With" (time-period) is also active, matching how the hook
  // builds its windows.
  const windowCount = (compareWith?.amount ?? 0) + 1;
  const hasMultipleLocationGroups = report.groupCount > 1;
  // Group (Average): keep every real per-location column as-is (same
  // fetch/aggregation as Side by side) and append one more derived column
  // per window — the average across every group for that window. Divide by
  // the count of locations that actually resolved data, not the raw
  // requested count, so an unmapped location's empty columns don't deflate
  // the average.
  const isAveragingLocations =
    !isAllLocations && locationCompareMode === "average" && hasMultipleLocationGroups;
  const dataGroupCount = useMemo(
    () => entityGroups.filter((group) => group.length > 0).length,
    [entityGroups],
  );
  const showAverageColumn = isAveragingLocations && dataGroupCount > 0;

  const profitAndLossData = useMemo(
    () =>
      showAverageColumn
        ? appendAverageColumns(
            report.profitAndLossData,
            report.groupCount,
            windowCount,
            dataGroupCount,
          )
        : report.profitAndLossData,
    [report.profitAndLossData, showAverageColumn, report.groupCount, windowCount, dataGroupCount],
  );
  const balanceSheetData = useMemo(
    () =>
      showAverageColumn
        ? appendAverageColumns(
            report.balanceSheetData,
            report.groupCount,
            windowCount,
            dataGroupCount,
          )
        : report.balanceSheetData,
    [report.balanceSheetData, showAverageColumn, report.groupCount, windowCount, dataGroupCount],
  );
  const plSummary = useMemo(
    () =>
      showAverageColumn
        ? {
            revenue: [
              ...report.plSummary.revenue,
              ...averageAcrossGroupsNullable(
                report.plSummary.revenue,
                report.groupCount,
                windowCount,
                dataGroupCount,
              ),
            ],
            grossProfit: [
              ...report.plSummary.grossProfit,
              ...averageAcrossGroupsNullable(
                report.plSummary.grossProfit,
                report.groupCount,
                windowCount,
                dataGroupCount,
              ),
            ],
            ebitda: [
              ...report.plSummary.ebitda,
              ...averageAcrossGroupsNullable(
                report.plSummary.ebitda,
                report.groupCount,
                windowCount,
                dataGroupCount,
              ),
            ],
            netProfitLabel: [
              ...report.plSummary.netProfitLabel,
              ...appendAverageLabelColumns(
                report.plSummary.netProfitLabel,
                report.groupCount,
                windowCount,
              ),
            ],
          }
        : report.plSummary,
    [report.plSummary, showAverageColumn, report.groupCount, windowCount, dataGroupCount],
  );
  const bsSummary = useMemo(
    () =>
      showAverageColumn
        ? {
            totalAssets: [
              ...report.bsSummary.totalAssets,
              ...averageAcrossGroupsNullable(
                report.bsSummary.totalAssets,
                report.groupCount,
                windowCount,
                dataGroupCount,
              ),
            ],
            totalLiabilities: [
              ...report.bsSummary.totalLiabilities,
              ...averageAcrossGroupsNullable(
                report.bsSummary.totalLiabilities,
                report.groupCount,
                windowCount,
                dataGroupCount,
              ),
            ],
            equity: [
              ...report.bsSummary.equity,
              ...averageAcrossGroupsNullable(
                report.bsSummary.equity,
                report.groupCount,
                windowCount,
                dataGroupCount,
              ),
            ],
            netAssets: [
              ...report.bsSummary.netAssets,
              ...averageAcrossGroupsNullable(
                report.bsSummary.netAssets,
                report.groupCount,
                windowCount,
                dataGroupCount,
              ),
            ],
          }
        : report.bsSummary,
    [report.bsSummary, showAverageColumn, report.groupCount, windowCount, dataGroupCount],
  );

  // Xero/QuickBooks don't return "Budget"/"Variance"/"Source" for a live
  // report — those columns only make sense for the mock/Iplicit-derived data
  // model. The detail tables show exactly the columns the platform returned:
  // one per comparison period (Xero's own "Compare with N Months" returns
  // N+1 columns — current + one per prior period — not just a single prior
  // column), each dated with the real period end. When Compare Locations is
  // in "side by side" or "average" mode, each real per-location column is
  // also prefixed with its location; the appended Average block (if any)
  // reuses the same window dates with "Average" as its location name.
  const columnDatesForDisplay = showAverageColumn
    ? [...report.columnDates, ...report.columnDates.slice(0, windowCount)]
    : report.columnDates;
  const columnLocationNamesForDisplay = showAverageColumn
    ? [...(report.columnLocationNames ?? []), ...Array(windowCount).fill("Average")]
    : report.columnLocationNames;
  const columnLabels = columnDatesForDisplay.map((iso, i) => {
    const locationName = columnLocationNamesForDisplay?.[i];
    return locationName ? `${locationName} — ${formatDate(iso)}` : formatDate(iso);
  });
  // Per-row Location cell — only meaningful when multiple locations are
  // SUMMED into the same columns (All Locations / Combined): there, the
  // number in a row genuinely IS that location's real figure, so naming it
  // helps. When comparing locations "side by side" or "Group (Average)"
  // each real column's own header already names its location, so the hook
  // reports showLocationColumn false for both (groupCount > 1).
  const showLocationColumn = report.showLocationColumn;
  const locationHeadingSuffix = isAllLocations
    ? " — All Locations"
    : isAveragingLocations
      ? " — Locations + Average"
      : hasMultipleLocationGroups
        ? " — Multiple Locations"
        : showLocationColumn
          ? " — Combined Locations"
          : "";
  // Locations picked for side-by-side/average compare whose column will be
  // empty — no accounting entity resolved for them (no mapping, or they
  // share a tenant with another selected location) — surfaced so an empty
  // column reads as "not connected", not as a bug.
  const unmappedCompareLocationNames = hasMultipleLocationGroups
    ? entityGroups
        .map((group, i) => (group.length === 0 ? groupLabels?.[i] : null))
        .filter((name): name is string => !!name)
    : [];

  // Canonical Xero account-type layout:
  // P&L: Income → Less Cost of Sales → GROSS PROFIT → Plus Other Income → Less Expenses → NET PROFIT
  // BS:  Current Assets → Plus Bank → Plus Fixed Assets → Plus Non-current Assets → TOTAL ASSETS
  //      → Less Current Liabilities → Less Non-current Liabilities → NET ASSETS
  //      → Equity → Plus Net Profit → TOTAL EQUITY
  const plLayout = partitionPlSections(profitAndLossData);
  const bsLayout = partitionBsSections(balanceSheetData, resolveBalanceSheetGroup);
  const { equitySections: bsEquitySections, netProfitAmounts: bsNetProfitFromEquity } =
    splitEquityNetProfit(bsLayout.equity, bsLayout.netProfit);
  const plusNetProfitAmounts: (number | null)[] = plSummary.ebitda.some(
    (value) => value !== null,
  )
    ? plSummary.ebitda
    : Array.from(
        { length: columnLabels.length },
        (_, i) => bsNetProfitFromEquity[i] ?? null,
      );

  // Same grid as LiveFinancialSection so summary rows (Gross Profit, Net Profit,
  // Total Assets, etc.) line up with LINE ITEM / period columns pixel-for-pixel.
  // Widen the amount columns when headers also carry a location name
  // (Compare Locations side-by-side / Group (Average)) — otherwise a name
  // like "Woodbridge Dental Care" has nowhere to go but overlap the next column.
  const { gridTemplateColumns, minWidthPx: reportGridMinWidth } =
    buildLiveReportGridLayout(
      columnLabels.length,
      showLocationColumn,
      !!columnLocationNamesForDisplay,
    );

  /**
   * Summary total row using the live report grid. Transparent border matches
   * LiveFinancialSection's bordered table so columns line up. `null` means the
   * platform's report for that column didn't include this total — shown as "—".
   *
   * `subtotal` = GROSS PROFIT / TOTAL ASSETS / NET ASSETS (rules above and below).
   * `total`    = NET PROFIT / TOTAL EQUITY (emphasized, double-underlined).
   * `flow`     = Plus Net Profit (italic operator, no heavy rules).
   */
  const renderSummaryRow = (
    label: string,
    amounts: (number | null)[],
    opts?: {
      variant?: "subtotal" | "total" | "flow";
      operator?: ReportOperator | null;
    },
  ) => {
    const variant = opts?.variant ?? "subtotal";
    const isTotal = variant === "total";
    const isFlow = variant === "flow";
    return (
      <div
        className={
          isTotal
            ? "border-t-2 border-foreground/40 rounded-none [border-bottom-width:3px] [border-bottom-style:double]"
            : isFlow
              ? "border border-transparent rounded-lg"
              : "border-y-2 border-foreground/25 rounded-none"
        }
      >
        <div
          className={
            isTotal
              ? "grid items-center py-3 px-4 bg-primary/5"
              : isFlow
                ? "grid items-center py-3 px-4"
                : "grid items-center py-3 px-4 bg-muted/30"
          }
          style={{ gridTemplateColumns }}
        >
          {showLocationColumn && <span />}
          <span
            className={
              isTotal
                ? "text-sm font-bold uppercase tracking-wide text-foreground pr-4"
                : isFlow
                  ? "text-sm font-semibold text-foreground pr-4"
                  : "text-sm font-bold uppercase tracking-wide text-foreground pr-4"
            }
          >
            {opts?.operator && (
              <em className="font-normal italic mr-1.5 text-muted-foreground normal-case tracking-normal">
                {opts.operator === "less" ? "Less" : "Plus"}
              </em>
            )}
            {label}
          </span>
          {amounts.map((amount, i) => (
            <span
              key={i}
              className={
                isTotal
                  ? "text-sm font-bold text-right text-foreground px-2 whitespace-nowrap tabular-nums"
                  : i === 0
                    ? "text-sm font-semibold text-right text-foreground px-2 whitespace-nowrap tabular-nums"
                    : "text-sm font-semibold text-right text-muted-foreground px-2 whitespace-nowrap tabular-nums"
              }
            >
              {amount === null ? "—" : formatCurrency(amount)}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderLiveSections = (
    sections: LiveSection[],
    operator: ReportOperator | null = null,
  ) =>
    sections.map((section) => (
      <LiveFinancialSection
        key={section.id}
        section={section}
        columnLabels={columnLabels}
        showLocationColumn={showLocationColumn}
        gridTemplateColumns={gridTemplateColumns}
        operator={operator}
      />
    ));

  /** One horizontal scroll for all period columns so sections + totals stay aligned. */
  const renderScrollableReport = (children: ReactNode) => (
    <div className="overflow-x-auto -mx-1 px-1">
      <div style={{ minWidth: reportGridMinWidth }}>{children}</div>
    </div>
  );

  const noAccountingConnected = !entityLoading && locationEntities.length === 0;

  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>Financial Statements</title>
        <meta
          name="description"
          content="Balance Sheet and Profit & Loss statements synced from Xero or QuickBooks."
        />
      </Helmet>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="pb-4 border-b border-border">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <FileSpreadsheet className="w-7 h-7 text-primary" />
            Financial Statements
          </h1>
          <p className="text-muted-foreground mt-1">
            {isAllLocations
              ? "Balance Sheet and Profit & Loss across all mapped locations — totals are summed"
              : "Balance Sheet and Profit & Loss statements for the location selected above"}
          </p>
        </div>

        {entityLoading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-16">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Resolving accounting connection…</span>
          </div>
        ) : noAccountingConnected ? (
          <div className="bg-card rounded-xl border border-border p-10 text-center space-y-3">
            <FileSpreadsheet className="w-10 h-10 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold text-foreground">
              No accounting platform connected
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              {isAllLocations
                ? "None of your locations are mapped to a Xero or QuickBooks account yet. Map them under Settings > Accounting Integrations."
                : "This location isn't mapped to a Xero or QuickBooks account yet. Map it under Settings > Accounting Integrations."}
            </p>
            <Button asChild>
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="w-full bg-muted/50 p-1 h-12">
              {canViewTab("profit-loss") && (
                <TabsTrigger
                  value="profit-loss"
                  className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Profit &amp; Loss
                </TabsTrigger>
              )}
              {canViewTab("cashflow-statement") && (
                <TabsTrigger
                  value="cashflow-statement"
                  className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Cash Flow Statement
                </TabsTrigger>
              )}
              {canViewTab("balance-sheet") && (
                <TabsTrigger
                  value="balance-sheet"
                  className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Balance Sheet
                </TabsTrigger>
              )}
            </TabsList>

            {/* Date Range / Compare with only apply to the live Profit & Loss and
                Balance Sheet tabs — Cash Flow Statement has its own date range +
                Monthly/Weekly toggle built in, since it's a different data model. */}
            {activeTab !== "cashflow-statement" && (
              <div className="flex items-center gap-3 mt-4 flex-wrap">
                <ChartDateFilter
                  filter={reportDateFilter}
                  onFilterChange={setReportDateFilter}
                  customRange={reportCustomRange}
                  onCustomRangeChange={setReportCustomRange}
                  align="start"
                  trigger={
                    <Button variant="outline" className="h-9 gap-2 font-normal">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{reportFilterLabel}</span>
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  }
                />
                <CompareWithControl
                  value={compareWith}
                  onChange={setCompareWith}
                />
                <LocationCompareControl
                  disabled={isAllLocations}
                  primaryLocationId={selectedLocationId}
                  selectedLocationIds={compareLocationIds}
                  onSelectedLocationIdsChange={setCompareLocationIds}
                  mode={locationCompareMode}
                  onModeChange={setLocationCompareMode}
                />
                {report.dateRange.priorFrom && report.dateRange.priorTo && (
                  <div className="text-sm text-muted-foreground">
                    vs {formatDate(report.dateRange.priorFrom)} –{" "}
                    {formatDate(report.dateRange.priorTo)}
                  </div>
                )}
                {(showLocationColumn || hasMultipleLocationGroups) && (
                  <div className="text-sm text-muted-foreground">
                    {isAveragingLocations
                      ? `Comparing ${report.groupCount} locations + average`
                      : hasMultipleLocationGroups
                        ? `Comparing ${report.groupCount} locations side by side`
                        : `${locationEntities.length} locations combined`}
                  </div>
                )}
                {unmappedCompareLocationNames.length > 0 && (
                  <div className="text-sm text-amber-600">
                    {unmappedCompareLocationNames.join(", ")}{" "}
                    {unmappedCompareLocationNames.length === 1 ? "has" : "have"}{" "}
                    no accounting connection — that column will be empty.
                  </div>
                )}
                {report.isLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading statements…
                  </div>
                )}
              </div>
            )}

            {/* Profit & Loss Tab */}
            <TabsContent value="profit-loss" className="mt-6 space-y-6">
              <div className="bg-card rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground pb-3 mb-4 border-b border-border">
                  Profit &amp; Loss Statement
                  {locationHeadingSuffix}
                </h2>
                {profitAndLossData.length === 0 ? (
                  <p className="text-sm">
                    {report.plError ? (
                      <span className="text-danger">
                        Couldn't load the Profit &amp; Loss: {report.plError}
                      </span>
                    ) : report.isLoading ? (
                      <span className="text-muted-foreground flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading Profit &amp; Loss…
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        No Profit &amp; Loss data available for this entity yet.
                      </span>
                    )}
                  </p>
                ) : (
                  renderScrollableReport(
                    <>
                      {renderLiveSections(plLayout.income)}
                      {renderLiveSections(
                        plLayout.costOfSales,
                        plSectionOperator("cost_of_sales"),
                      )}
                      <div className="mb-4">
                        {renderSummaryRow("Gross Profit", plSummary.grossProfit)}
                      </div>
                      {renderLiveSections(
                        plLayout.otherIncome,
                        plSectionOperator("other_income"),
                      )}
                      {renderLiveSections(
                        plLayout.expenses,
                        plSectionOperator("expenses"),
                      )}
                      <div className="mt-4">
                        {renderSummaryRow("Net Profit", plSummary.ebitda, {
                          variant: "total",
                        })}
                      </div>
                    </>,
                  )
                )}
              </div>
            </TabsContent>

            {/* Cash Flow Statement Tab */}
            <TabsContent value="cashflow-statement" className="mt-6 space-y-6">
              <CashflowStatementPanel locationId={selectedLocationId} />
            </TabsContent>

            {/* Balance Sheet Tab */}
            <TabsContent value="balance-sheet" className="mt-6 space-y-6">
              <div className="bg-card rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground pb-3 mb-4 border-b border-border">
                  Balance Sheet
                  {locationHeadingSuffix}
                </h2>

                {balanceSheetData.length === 0 ? (
                  <p className="text-sm">
                    {report.bsError ? (
                      <span className="text-danger">
                        Couldn't load the Balance Sheet: {report.bsError}
                      </span>
                    ) : report.isLoading ? (
                      <span className="text-muted-foreground flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading Balance Sheet…
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        No Balance Sheet data available for this entity yet.
                      </span>
                    )}
                  </p>
                ) : (
                  renderScrollableReport(
                    <>
                      {renderLiveSections(bsLayout.currentAssets)}
                      {renderLiveSections(
                        bsLayout.bank,
                        bsSectionOperator("bank"),
                      )}
                      {renderLiveSections(
                        bsLayout.fixedAssets,
                        bsSectionOperator("fixed_assets"),
                      )}
                      {renderLiveSections(
                        bsLayout.nonCurrentAssets,
                        bsSectionOperator("non_current_assets"),
                      )}
                      <div className="my-4">
                        {renderSummaryRow("Total Assets", bsSummary.totalAssets)}
                      </div>

                      {renderLiveSections(
                        bsLayout.currentLiabilities,
                        bsSectionOperator("current_liabilities"),
                      )}
                      {renderLiveSections(
                        bsLayout.nonCurrentLiabilities,
                        bsSectionOperator("non_current_liabilities"),
                      )}
                      <div className="my-4">
                        {renderSummaryRow("Net Assets", bsSummary.netAssets)}
                      </div>

                      {bsEquitySections.length === 0 ? (
                        <div className="mb-4">
                          <div className="flex items-center py-3 px-4 bg-muted/50 rounded-lg">
                            <span className="font-semibold text-foreground">
                              Equity
                            </span>
                          </div>
                        </div>
                      ) : (
                        renderLiveSections(bsEquitySections)
                      )}
                      <div className="mb-4">
                        {renderSummaryRow("Net Profit", plusNetProfitAmounts, {
                          variant: "flow",
                          operator: bsSectionOperator("net_profit"),
                        })}
                      </div>
                      <div className="mt-4">
                        {renderSummaryRow("Total Equity", bsSummary.equity, {
                          variant: "total",
                        })}
                      </div>
                    </>,
                  )
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </MainLayout>
  );
}
