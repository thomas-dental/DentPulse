import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { useCashflowStatement } from "@/hooks/useCashflowStatement";
import type { StatementReportRequest } from "@/services/cashflowService";
import {
  archiveCashflowReport,
  getArchivedCashflowReportById,
  getCashflowCategoryDrilldown,
  type CashflowCategoryDrilldownTransaction,
} from "@/services/cashflowService";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CashflowStatementMergedTable } from "@/components/cashflow/CashflowStatementMergedTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartDateFilter,
  calculateDateRangeFromFilter,
  getDateFilterLabel,
  type DateFilterType,
  type CustomRange,
} from "@/components/ui/chart-date-filter";
import {
  getInitialCashflowStatementDates,
  saveCashflowStatementDates,
} from "@/utils/cashflowStatementDatePersistence";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, FileText, ArrowLeft, ChevronLeft, ChevronRight as ChevronRightIcon, Filter, AlertCircle, RefreshCw, ExternalLink, Calendar } from "lucide-react";
import {
  TransactionsFilterDialog,
  type TransactionsFilterState,
} from "@/components/cashflow/TransactionsFilterDialog";
import { TransactionsToReviewTable } from "@/components/cashflow/TransactionsToReviewTable";
// import { BankAccountOverviewCards } from "@/components/cashflow/BankAccountOverviewCards";
// import { useXeroBankOverview } from "@/hooks/useXeroBankOverview";
import {
  accountingLinkClassName,
  isValidTransactionLink,
} from "@/utils/accountingTransactionLinks";
import {
  enrichCashflowReportWithTotalColumn,
  CASHFLOW_TOTAL_COLUMN,
} from "@/utils/cashflowReportTotals";
import type { CashflowReportVM } from "@/data/preparingCashflowStatementData";
import { useOrganization } from "@/hooks/useOrganization";
import { useFilters } from "@/contexts/FilterContext";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import * as XLSX from "xlsx";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250, 500];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type StatementPeriodGranularity = "monthly" | "weekly";

function startOfWeekMonday(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay();
  const diff = (day + 6) % 7;
  r.setDate(r.getDate() - diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

const formatCurrency = (value: number, symbol = "£"): string => {
  if (value === 0) return "–";
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return value < 0 ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
};

const formatDisplayDate = (value: string): string => {
  if (!value) return "–";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "dd/MM/yyyy");
};

/** Master category `name` is often a short code (CFO, CFI, CFF) — same under every line; real label is `row.name`. */
function isRedundantCategoryCodeHeader(header: string): boolean {
  const t = header.trim();
  if (!t) return true;
  return /^[A-Z]{2,4}$/.test(t);
}

/** Blank spacer row between rowSet sections (full column count for layout). */
function statementSectionSpacerRow(key: string, columnCount: number) {
  return (
    <TableRow
      key={key}
      aria-hidden
      className="bg-transparent hover:bg-transparent border-0 pointer-events-none"
    >
      <TableCell className="p-0 h-4 min-h-4 border-0 bg-transparent sticky left-0" />
      {Array.from({ length: columnCount }, (_, ci) => (
        <TableCell
          key={ci}
          className="p-0 h-4 min-h-4 border-0 bg-transparent"
        />
      ))}
    </TableRow>
  );
}

export default function PreparingCashflowStatement() {
  const { organizationId } = useOrganization();
  const { selectedLocationId, dateRange: globalDateRange } = useFilters();
  const { can, isOwner } = usePermissions();
  const canViewTransactions =
    isOwner || can("cash_flow", "view", "transactions_tab");
  const canViewStatement = isOwner || can("cash_flow", "view", "statement_tab");
  const canViewArchived = isOwner || can("cash_flow", "view", "archived_tab");
  const visibleTabCount = [
    canViewTransactions,
    canViewStatement,
    canViewArchived,
  ].filter(Boolean).length;
  const defaultTab = canViewTransactions
    ? "transactions"
    : canViewStatement
      ? "statement"
      : canViewArchived
        ? "archived"
        : "transactions";
  const [searchTerm, setSearchTerm] = useState("");
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({
    0: true,
    1: true,
    2: true,
  });
  const [filterOpen, setFilterOpen] = useState(false);

  // Pagination (same as Version 2.0: 10, 25, 50, 100, 250, 500)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filters (Version 2.0 equivalent)
  const [filters, setFilters] = useState<Partial<StatementReportRequest>>({
    name: "",
    memoOrDescription: "",
    transactionTypes: "",
    debitMin: null,
    debitMax: null,
    creditMin: null,
    creditMax: null,
    balanceMin: null,
    balanceMax: null,
  });

  // Who Paid (location), For What (split), and transaction type multi-select
  const [whoPaidSelected, setWhoPaidSelected] = useState<string[]>([]);
  const [forWhatSelected, setForWhatSelected] = useState<string[]>([]);
  const [transactionTypesSelected, setTransactionTypesSelected] = useState<
    string[]
  >([]);

  // Restore last statement dates for this session; otherwise seed from the top-nav filter.
  const [dateFilter, setDateFilter] = useState<DateFilterType>(
    () =>
      getInitialCashflowStatementDates({
        from: globalDateRange.startDate,
        to: globalDateRange.endDate,
      }).dateFilter,
  );
  const [customRange, setCustomRange] = useState<CustomRange>(
    () =>
      getInitialCashflowStatementDates({
        from: globalDateRange.startDate,
        to: globalDateRange.endDate,
      }).customRange,
  );

  useEffect(() => {
    saveCashflowStatementDates({ dateFilter, customRange });
  }, [dateFilter, customRange]);

  // Follow the top-nav date filter when it changes, without clobbering a restored session range on first mount.
  const skipNextGlobalDateSync = useRef(true);
  useEffect(() => {
    if (skipNextGlobalDateSync.current) {
      skipNextGlobalDateSync.current = false;
      return;
    }
    setDateFilter("custom");
    setCustomRange({
      from: globalDateRange.startDate,
      to: globalDateRange.endDate,
    });
  }, [globalDateRange.startDate, globalDateRange.endDate]);

  const dateFilterLabel =
    dateFilter === "custom" && customRange.from && customRange.to
      ? `${format(customRange.from, "dd-MM-yyyy")} → ${format(customRange.to, "dd-MM-yyyy")}`
      : getDateFilterLabel(dateFilter);
  const computedRange = useMemo(
    () => calculateDateRangeFromFilter(dateFilter, customRange),
    [dateFilter, customRange],
  );
  const dateRange = useMemo(
    () => ({ from: computedRange.startDate, to: computedRange.endDate }),
    [computedRange],
  );
  const [periodGranularity, setPeriodGranularity] =
    useState<StatementPeriodGranularity>("monthly");

  // Convert DateRange to string format for API
  const fromDate = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "";
  const toDate = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : "";

  // Map backend column labels to period keys (YYYY-MM monthly, or week-start YYYY-MM-DD weekly)
  const monthKeyByLabel = useMemo(() => {
    if (!fromDate || !toDate) return new Map<string, string>();
    const map = new Map<string, string>();
    if (periodGranularity === "weekly") {
      const from = new Date(`${fromDate}T00:00:00`);
      const to = new Date(`${toDate}T00:00:00`);
      let cur = startOfWeekMonday(from);
      const last = startOfWeekMonday(to);
      while (cur <= last) {
        const weekEnd = new Date(cur);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const key = format(cur, "yyyy-MM-dd");
        const label = `${cur.getDate()} ${MONTH_NAMES[cur.getMonth()]}–${weekEnd.getDate()} ${MONTH_NAMES[weekEnd.getMonth()]}`;
        map.set(label, key);
        cur = new Date(cur);
        cur.setDate(cur.getDate() + 7);
      }
      return map;
    }
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const start = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const yy = String(y).slice(-2);
      const label = `${MONTH_NAMES[m - 1]}-${yy}`;
      map.set(label, key);
    }
    return map;
  }, [fromDate, toDate, periodGranularity]);

  const statementReportFilters = useMemo<Partial<StatementReportRequest>>(
    () => ({
      ...filters,
      debitMin: filters.debitMin ?? null,
      debitMax: filters.debitMax ?? null,
      creditMin: filters.creditMin ?? null,
      creditMax: filters.creditMax ?? null,
      balanceMin: filters.balanceMin ?? null,
      balanceMax: filters.balanceMax ?? null,
      transactionTypes:
        transactionTypesSelected.length > 0
          ? transactionTypesSelected.join(",")
          : (filters.transactionTypes ?? ""),
      whoPaid:
        whoPaidSelected.length > 0 ? whoPaidSelected.join(",") : undefined,
      forWhat:
        forWhatSelected.length > 0 ? forWhatSelected.join(",") : undefined,
    }),
    [filters, whoPaidSelected, forWhatSelected, transactionTypesSelected],
  );

  const {
    transactions: apiTransactions,
    totals: apiTotals,
    isLoadingTransactions,
    transactionsError,
    refetchTransactions,
    whoPaidOptions,
    forWhatOptions,
    transactionTypeOptions,
    accountingPlatform,
    cashflowReport: apiReport,
    isLoadingReport,
    reportError,
    refetchReport,
    archiveReports,
    isLoadingArchive,
    archiveError,
    refetchArchive,
    isLoading,
    fromDate: apiFromDate,
    toDate: apiToDate,
  } = useCashflowStatement(
    fromDate || undefined,
    toDate || undefined,
    statementReportFilters,
    selectedLocationId || null,
    periodGranularity,
  );

  // Bank overview cards temporarily hidden on Money In & Out
  // const {
  //   cards: bankOverviewCards,
  //   isLoading: isLoadingBankOverview,
  //   message: bankOverviewMessage,
  // } = useXeroBankOverview(
  //   canViewTransactions && accountingPlatform === "xero",
  //   selectedLocationId || null,
  // );

  // Keep every activity section expanded when the report structure changes
  // (CFO / CFI / CFF / Tax / Intra — whatever has mapped data).
  useEffect(() => {
    const groups = apiReport?.tableGroupDataSet;
    if (!groups?.length) return;
    const next: Record<number, boolean> = {};
    groups.forEach((_, i) => {
      next[i] = true;
    });
    setOpenSections(next);
  }, [
    apiReport?.tableGroupDataSet?.length,
    fromDate,
    toDate,
    periodGranularity,
    selectedLocationId,
  ]);

  const [isArchiving, setIsArchiving] = useState(false);
  const [isLoadingArchiveDetail, setIsLoadingArchiveDetail] = useState(false);
  const [archiveDetailError, setArchiveDetailError] = useState<string | null>(
    null,
  );
  const [archiveDetail, setArchiveDetail] = useState<{
    id: number;
    report: any;
  } | null>(null);

  // Category drill-down (Version 2.0 style)
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [drilldownTransactions, setDrilldownTransactions] = useState<
    CashflowCategoryDrilldownTransaction[]
  >([]);
  const [drilldownTitle, setDrilldownTitle] = useState("");
  const [drilldownMonthKey, setDrilldownMonthKey] = useState("");
  const [drilldownMonthLabel, setDrilldownMonthLabel] = useState("");
  const [drilldownCategoryLabel, setDrilldownCategoryLabel] = useState("");

  const openCategoryDrilldown = async (params: {
    rangeGroup: string;
    rangeSubGroup: string;
    categoryName: string;
    locationId: string;
    locationName: string;
    monthLabel: string;
  }) => {
    if (!organizationId) return;

    const resolvedMonthKey = monthKeyByLabel.get(params.monthLabel);
    if (!resolvedMonthKey) return;

    setDrilldownLoading(true);
    setDrilldownError(null);
    setDrilldownOpen(true);

    try {
      const txns = await getCashflowCategoryDrilldown(organizationId, {
        fromDate,
        toDate,
        rangeGroup: params.rangeGroup,
        rangeSubGroup: params.rangeSubGroup,
        categoryName: params.categoryName,
        locationId: params.locationId,
        monthKey: resolvedMonthKey,
        practiceLocationId: selectedLocationId || null,
      });

      setDrilldownTransactions(txns);
      setDrilldownMonthKey(resolvedMonthKey);
      setDrilldownMonthLabel(params.monthLabel);
      setDrilldownTitle(params.locationName || params.categoryName);
      setDrilldownCategoryLabel(params.categoryName);
    } catch (e) {
      setDrilldownError(
        e instanceof Error ? e.message : "Failed to load drilldown",
      );
      setDrilldownTransactions([]);
    } finally {
      setDrilldownLoading(false);
    }
  };

  // Refetch data when date range or filters change
  useEffect(() => {
    if (dateRange?.from && dateRange?.to) {
      refetchTransactions();
      refetchReport();
    }
  }, [dateRange, statementReportFilters, refetchTransactions, refetchReport]);

  const transactions = apiTransactions ?? [];
  const report = useMemo(
    () => (apiReport ? enrichCashflowReportWithTotalColumn(apiReport) : null),
    [apiReport],
  );

  // Who Paid / For What options come from backend (full dataset for date range), not from filtered result
  const filteredTransactions = searchTerm
    ? transactions.filter(
        (t) =>
          t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          t.date.includes(searchTerm) ||
          t.transactionType.toLowerCase().includes(searchTerm.toLowerCase()) ||
          t.memoOrDescription
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          t.location.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : transactions;

  const totals = apiTotals
    ? {
        totalMoneyIn: apiTotals.totalMoneyIn,
        totalMoneyOut: apiTotals.totalMoneyOut,
        closingBalance: apiTotals.closingBalance,
      }
    : { totalMoneyIn: 0, totalMoneyOut: 0, closingBalance: 0 };

  // Pagination
  const totalRecords = filteredTransactions.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRecords);
  const paginatedTransactions = filteredTransactions.slice(
    startIndex,
    endIndex,
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (transactionTypesSelected.length > 0) count += 1;
    if (filters.name?.trim()) count += 1;
    if (filters.memoOrDescription?.trim()) count += 1;
    if (whoPaidSelected.length > 0) count += 1;
    if (forWhatSelected.length > 0) count += 1;
    if (filters.debitMin != null || filters.debitMax != null) count += 1;
    if (filters.creditMin != null || filters.creditMax != null) count += 1;
    if (filters.balanceMin != null || filters.balanceMax != null) count += 1;
    return count;
  }, [filters, whoPaidSelected, forWhatSelected, transactionTypesSelected]);

  const filterDialogValue: TransactionsFilterState = {
    filters,
    whoPaidSelected,
    forWhatSelected,
    transactionTypesSelected,
  };

  const applyFilters = useCallback(
    (next: TransactionsFilterState) => {
      setFilters(next.filters);
      setWhoPaidSelected(next.whoPaidSelected);
      setForWhatSelected(next.forWhatSelected);
      setTransactionTypesSelected(next.transactionTypesSelected);
      setPage(1);
      refetchTransactions();
    },
    [refetchTransactions],
  );

  const resetFilters = useCallback(() => {
    setFilters({
      name: "",
      memoOrDescription: "",
      transactionTypes: "",
      debitMin: null,
      debitMax: null,
      creditMin: null,
      creditMax: null,
      balanceMin: null,
      balanceMax: null,
    });
    setWhoPaidSelected([]);
    setForWhatSelected([]);
    setTransactionTypesSelected([]);
    setPage(1);
    refetchTransactions();
  }, [refetchTransactions]);

  // Chart data from totalRowDataSet
  const totalReceived = report?.totalRowDataSet?.find(
    (r) => r.name === "Total Received",
  );
  const totalPaid = report?.totalRowDataSet?.find(
    (r) => r.name === "Total Paid",
  );
  const netCashflow = report?.totalRowDataSet?.find(
    (r) => r.name === "Net Cashflow",
  );
  const closingBalance = report?.totalRowDataSet?.find(
    (r) => r.name === "Closing Balance",
  );

  const chartData = useMemo(() => {
    if (!report?.columns) return [];
    return report.columns
      .map((col, i) => ({
        month: col,
        "Total Received": totalReceived?.colData?.[i]?.value ?? 0,
        "Total Paid": totalPaid?.colData?.[i]?.value ?? 0,
        "Net Cashflow": netCashflow?.colData?.[i]?.value ?? 0,
        "Closing Balance": closingBalance?.colData?.[i]?.value ?? 0,
      }))
      .filter((row) => row.month !== CASHFLOW_TOTAL_COLUMN);
  }, [report, totalReceived, totalPaid, netCashflow, closingBalance]);

  const toggleSection = (index: number) => {
    setOpenSections((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleExportToExcel = () => {
    if (!report || !report.columns?.length) return;

    const wb = XLSX.utils.book_new();

    const sheetRows: (string | number)[][] = [];

    // Title and date range
    const niceFrom = dateRange?.from
      ? format(dateRange.from, "dd/MM/yyyy")
      : fromDate;
    const niceTo = dateRange?.to ? format(dateRange.to, "dd/MM/yyyy") : toDate;

    sheetRows.push([
      "Cash Flow Statement",
      ...(report.columns.length > 0
        ? Array(report.columns.length).fill("")
        : []),
    ]);
    sheetRows.push([
      `Period: ${niceFrom || "-"} to ${niceTo || "-"}`,
      ...(report.columns.length > 0
        ? Array(report.columns.length).fill("")
        : []),
    ]);
    sheetRows.push([]);

    // Header row for table
    sheetRows.push(["", ...report.columns]);

    // Body: groups, subgroups, rows, totals – mirroring table structure
    report.tableGroupDataSet.forEach((group) => {
      // Group row
      sheetRows.push([group.type, ...report.columns.map(() => "")]);

      group.subGroupDataSet.forEach((sub) => {
        sub.rowDataSet.forEach((rowSet) => {
          rowSet.rowData.forEach((row) => {
            sheetRows.push([
              `  ${row.name}`,
              ...row.colData.map((c) => c.value),
            ]);
          });
          if (rowSet.total) {
            sheetRows.push([
              `  ${rowSet.total.name}`,
              ...rowSet.total.colData.map((c) => c.value),
            ]);
          }
        });
        if (sub.total) {
          sheetRows.push([
            sub.total.name,
            ...sub.total.colData.map((c) => c.value),
          ]);
        }
      });

      if (group.total) {
        sheetRows.push([
          group.total.name,
          ...group.total.colData.map((c) => c.value),
        ]);
      }

      // Blank row between groups
      sheetRows.push([]);
    });

    // Overall total rows
    if (report.totalRowDataSet?.length) {
      sheetRows.push([]);
      report.totalRowDataSet.forEach((row) => {
        sheetRows.push([row.name, ...row.colData.map((c) => c.value)]);
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetRows);

    // Basic styling: bold headers and key rows
    const setBold = (cellRef: string) => {
      const cell = (ws as any)[cellRef];
      if (cell) {
        cell.s = {
          ...(cell.s || {}),
          font: { ...(cell.s?.font || {}), bold: true },
        };
      }
    };

    // Title rows
    setBold("A1");
    setBold("A2");

    // Header row (4th row)
    setBold("A4");
    report.columns.forEach((_, idx) => {
      const colLetter = XLSX.utils.encode_col(idx + 1);
      setBold(`${colLetter}4`);
    });

    ws["!cols"] = [{ wch: 40 }, ...report.columns.map(() => ({ wch: 14 }))];

    XLSX.utils.book_append_sheet(wb, ws, "Cashflow Statement");

    const fileName = `CashflowStatement_${niceFrom || fromDate}_${niceTo || toDate}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleArchive = async () => {
    if (!organizationId || !fromDate || !toDate || !report) return;

    try {
      setIsArchiving(true);
      await archiveCashflowReport(organizationId, { fromDate, toDate });
      await refetchArchive();
    } catch (err) {
      console.error("Failed to archive cashflow report", err);
    } finally {
      setIsArchiving(false);
    }
  };

  const handleViewArchive = async (archiveId: number) => {
    if (!organizationId) return;
    try {
      setArchiveDetailError(null);
      setIsLoadingArchiveDetail(true);
      const archived = await getArchivedCashflowReportById(
        organizationId,
        archiveId,
      );
      if (!archived) {
        setArchiveDetailError("Archived statement not found.");
        setArchiveDetail(null);
        return;
      }
      setArchiveDetail({
        id: archiveId,
        report: enrichCashflowReportWithTotalColumn(
          archived as CashflowReportVM,
        ),
      });
    } catch (err) {
      console.error("Failed to load archived cashflow report", err);
      setArchiveDetailError(
        err instanceof Error
          ? err.message
          : "Failed to load archived statement",
      );
      setArchiveDetail(null);
    } finally {
      setIsLoadingArchiveDetail(false);
    }
  };

  return (
    <MainLayout userRole="admin">
      {/* Viewport-locked layout: page chrome stays put; only table body scrolls */}
      <div className="flex flex-col gap-4 h-[calc(100vh-6rem)] overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="shrink-0 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/cashflow" aria-label="Back to Cash Flow">
                <ArrowLeft className="w-4 h-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
                <FileText className="w-6 h-6 text-primary" />
                Cash Flow Statement
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Review transactions and build your cash flow statement by period
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <ChartDateFilter
              filter={dateFilter}
              onFilterChange={setDateFilter}
              customRange={customRange}
              onCustomRangeChange={setCustomRange}
              align="start"
              trigger={
                <Button variant="outline" className="h-9 gap-2 font-normal">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{dateFilterLabel}</span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </Button>
              }
            />
            {(isLoadingTransactions || isLoadingReport) && (
              <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
            )}
            {(transactionsError || reportError) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  refetchTransactions();
                  refetchReport();
                }}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </Button>
            )}
          </div>
        </div>

        {(transactionsError || reportError) && (
          <Alert variant="destructive" className="shrink-0">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="block font-medium mb-1">
                {transactionsError
                  ? `Transactions: ${transactionsError.message}`
                  : ""}
                {reportError
                  ? `${transactionsError ? " — " : ""}Report: ${reportError.message}`
                  : ""}
              </span>
              {(transactionsError?.message?.includes("Edge Function") ||
                reportError?.message?.includes("Edge Function")) && (
                <span className="block mt-2 text-sm opacity-90">
                  Deploy the cashflow Edge Functions to your Supabase project:
                  run{" "}
                  <code className="bg-muted px-1 rounded">
                    supabase functions deploy cashflow-statement-report
                    cashflow-report
                  </code>{" "}
                  and ensure{" "}
                  <code className="bg-muted px-1 rounded">
                    VITE_SUPABASE_URL
                  </code>{" "}
                  points to that project.
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Tabs
          defaultValue={defaultTab || "transactions"}
          className="w-full flex flex-col flex-1 min-h-0"
        >
          <TabsList
            className={`shrink-0 grid w-full bg-muted/50 p-1 h-12 rounded-b-none border-b border-border [&>button]:min-w-0 [&>button]:overflow-hidden [&>button]:text-ellipsis ${visibleTabCount === 1 ? "grid-cols-1" : visibleTabCount === 2 ? "grid-cols-2" : "grid-cols-2"}`}
          >
            {canViewTransactions && (
              <TabsTrigger
                value="transactions"
                className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-md"
              >
                <span className="truncate">Money In & Out</span>
                {isLoadingTransactions && (
                  <RefreshCw className="w-3 h-3 ml-1 shrink-0" />
                )}
              </TabsTrigger>
            )}
            {canViewStatement && (
              <TabsTrigger
                value="statement"
                className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-md"
              >
                <span className="truncate">Cash Flow Statement</span>
                {isLoadingReport && (
                  <RefreshCw className="w-3 h-3 ml-1 shrink-0" />
                )}
              </TabsTrigger>
            )}
            {/* {canViewArchived && (
              <TabsTrigger
                value="archived"
                className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-md"
              >
                <span className="truncate">Archived Cash Flow Statements</span>
                {isLoadingArchive && (
                  <RefreshCw className="w-3 h-3 ml-1 shrink-0" />
                )}
              </TabsTrigger>
            )} */}
          </TabsList>

          {/* Tab 1: Transactions to Review — scrollable so bank tiles + table fit */}
          <TabsContent
            value="transactions"
            className="mt-0 pt-4 flex-1 min-h-0 overflow-y-auto data-[state=inactive]:hidden"
          >
            <Card className="flex flex-col min-h-0">
              <CardHeader className="shrink-0 border-b bg-muted/20 pb-5">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
                  <div>
                    <CardTitle className="text-base">Money In & Out</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Categorise and review transactions before building the
                      statement
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      placeholder="Search here..."
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setPage(1);
                      }}
                      className="w-[300px] lg:w-[350px]"
                    />
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={() => setFilterOpen(true)}
                    >
                      <Filter className="w-4 h-4" />
                      Filters
                      {activeFilterCount > 0 && (
                        <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs font-semibold">
                          {activeFilterCount}
                        </span>
                      )}
                    </Button>
                    <TransactionsFilterDialog
                      open={filterOpen}
                      onOpenChange={setFilterOpen}
                      whoPaidOptions={whoPaidOptions}
                      forWhatOptions={forWhatOptions}
                      transactionTypeOptions={transactionTypeOptions}
                      value={filterDialogValue}
                      onApply={applyFilters}
                      onReset={resetFilters}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex flex-col">
                {/* Bank overview cards temporarily hidden
                {accountingPlatform === "xero" && (
                  <div className="shrink-0 px-4 pt-4 border-b bg-muted/10">
                    <BankAccountOverviewCards
                      cards={bankOverviewCards}
                      isLoading={isLoadingBankOverview}
                      message={bankOverviewMessage}
                      currencySymbol="£"
                    />
                  </div>
                )}
                */}
                {isLoadingTransactions ? (
                  <div className="p-6 space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : (
                  <>
                    <TransactionsToReviewTable
                      className="min-h-[28rem]"
                      transactions={paginatedTransactions}
                      totals={totals}
                      accountingPlatform={accountingPlatform}
                      formatCurrency={formatCurrency}
                      formatDisplayDate={formatDisplayDate}
                      emptyMessage={
                        searchTerm
                          ? "No transactions match your search"
                          : "No data found"
                      }
                    />
                    <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-t bg-background">
                      <div className="flex items-center gap-4">
                        <Label className="text-sm font-normal flex items-center gap-2">
                          Show
                          <Select
                            value={String(pageSize)}
                            onValueChange={(v) => {
                              setPageSize(Number(v));
                              setPage(1);
                            }}
                          >
                            <SelectTrigger className="w-20 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PAGE_SIZE_OPTIONS.map((opt) => (
                                <SelectItem key={opt} value={String(opt)}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          entries
                        </Label>
                        <span className="text-sm text-muted-foreground">
                          Showing {totalRecords === 0 ? 0 : startIndex + 1} to{" "}
                          {endIndex} of {totalRecords} entries
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="text-sm px-2">
                          Page {page} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          disabled={page >= totalPages}
                          onClick={() =>
                            setPage((p) => Math.min(totalPages, p + 1))
                          }
                        >
                          <ChevronRightIcon className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 2: Cash Flow Statement — chart + month headers merged (Version 2.0) */}
          <TabsContent
            value="statement"
            className="mt-0 pt-4 flex-1 min-h-0 overflow-auto data-[state=inactive]:hidden"
          >
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    Cash Flow Statement
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Total Received, Total Paid, Net Cashflow and Closing Balance
                    by {periodGranularity === "weekly" ? "week" : "month"}
                  </p>
                  {(archiveError || isLoadingArchive) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {isLoadingArchive
                        ? "Loading archive history…"
                        : archiveError?.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <ToggleGroup
                    type="single"
                    value={periodGranularity}
                    onValueChange={(v) => {
                      if (v === "monthly" || v === "weekly")
                        setPeriodGranularity(v);
                    }}
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    aria-label="Statement period"
                  >
                    <ToggleGroupItem value="monthly" className="px-3">
                      Monthly
                    </ToggleGroupItem>
                    <ToggleGroupItem value="weekly" className="px-3">
                      Weekly
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportToExcel}
                    disabled={!report || isLoadingReport}
                  >
                    Export to Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleArchive}
                    disabled={!report || isLoadingReport || isArchiving}
                  >
                    {isArchiving ? "Archiving…" : "Archive Statement"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingReport ? (
                  <div className="p-6 space-y-3">
                    <Skeleton className="h-[340px] w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : !report?.columns?.length ? (
                  <div className="p-6 text-center text-muted-foreground">
                    No data found
                  </div>
                ) : (
                  <CashflowStatementMergedTable
                    report={report}
                    chartData={chartData}
                    formatCurrency={formatCurrency}
                    openSections={openSections}
                    onToggleSection={toggleSection}
                    onCategoryDrilldown={(params) =>
                      void openCategoryDrilldown(params)
                    }
                  />
                )}
              </CardContent>
            </Card>

            {/* Category drill-down — Pro parity columns */}
            <Sheet open={drilldownOpen} onOpenChange={setDrilldownOpen}>
              <SheetContent
                side="right"
                className="w-full sm:max-w-5xl p-0 flex flex-col"
              >
                <SheetHeader className="p-6 border-b border-border space-y-3">
                  <SheetTitle className="text-lg">
                    Preparing Your Cash Flow Statement
                  </SheetTitle>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <SheetDescription className="text-left text-foreground font-medium">
                      {drilldownMonthLabel || drilldownMonthKey || "—"}
                    </SheetDescription>
                    <SheetDescription className="sm:text-center text-foreground font-medium">
                      {drilldownCategoryLabel || "—"}
                    </SheetDescription>
                    <SheetDescription className="sm:text-right text-foreground font-medium">
                      {drilldownTitle || "—"}
                    </SheetDescription>
                  </div>
                </SheetHeader>
                <div
                  className="p-4 overflow-y-auto flex-1"
                  style={{ maxHeight: "calc(100vh - 180px)" }}
                >
                  {drilldownError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{drilldownError}</AlertDescription>
                    </Alert>
                  ) : drilldownLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-full" />
                    </div>
                  ) : drilldownTransactions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No transactions found for this bucket.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableHead className="whitespace-nowrap">
                              Date
                            </TableHead>
                            <TableHead className="whitespace-nowrap min-w-[140px]">
                              Transaction Type
                            </TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Memo Or Description</TableHead>
                            <TableHead>Who Paid</TableHead>
                            <TableHead>For What</TableHead>
                            <TableHead className="text-right">
                              <span className="inline-flex items-center justify-end gap-1.5 text-green-600 font-semibold">
                                Money (IN)
                              </span>
                            </TableHead>
                            <TableHead className="text-right">
                              <span className="inline-flex items-center justify-end gap-1.5 text-red-600 font-semibold">
                                Money (OUT)
                              </span>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drilldownTransactions.map((tx, idx) => {
                            const typeLabel =
                              tx.transactionType || tx.docClass || "—";
                            const link = tx.transactionLink;
                            const name = tx.name || tx.description || "—";
                            const memo =
                              tx.memoOrDescription || tx.description || "—";
                            const whoPaid = tx.whoPaid || "—";
                            const forWhat = tx.forWhat || tx.accountName || "—";
                            const moneyIn =
                              tx.moneyIn ?? Math.max(tx.amountRaw ?? 0, 0);
                            const moneyOut =
                              tx.moneyOut ?? Math.max(-(tx.amountRaw ?? 0), 0);
                            const linkClass =
                              accountingLinkClassName(accountingPlatform);
                            return (
                              <TableRow
                                key={`${tx.docId}-${tx.date}-${idx}`}
                                className="hover:bg-muted/30"
                              >
                                <TableCell className="whitespace-nowrap tabular-nums">
                                  {formatDisplayDate(tx.date)}
                                </TableCell>
                                <TableCell>
                                  {isValidTransactionLink(link) ? (
                                    <a
                                      href={link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={cn(
                                        "inline-flex items-center gap-1.5 text-sm font-medium hover:underline",
                                        linkClass,
                                      )}
                                    >
                                      <ExternalLink
                                        className="w-3.5 h-3.5 shrink-0"
                                        aria-hidden
                                      />
                                      <span>{typeLabel}</span>
                                    </a>
                                  ) : (
                                    <span className="text-sm">{typeLabel}</span>
                                  )}
                                </TableCell>
                                <TableCell
                                  className="font-medium max-w-[180px] truncate"
                                  title={name}
                                >
                                  {name}
                                </TableCell>
                                <TableCell
                                  className="text-muted-foreground max-w-[200px] truncate"
                                  title={memo}
                                >
                                  {memo}
                                </TableCell>
                                <TableCell
                                  className="max-w-[160px] truncate"
                                  title={whoPaid}
                                >
                                  {whoPaid}
                                </TableCell>
                                <TableCell
                                  className="max-w-[160px] truncate"
                                  title={forWhat}
                                >
                                  {forWhat}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-green-600 font-medium">
                                  {moneyIn > 0
                                    ? formatCurrency(
                                        moneyIn,
                                        report?.currencySymbol ?? "£",
                                      )
                                    : "–"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-red-600 font-medium">
                                  {moneyOut > 0
                                    ? formatCurrency(
                                        moneyOut,
                                        report?.currencySymbol ?? "£",
                                      )
                                    : "–"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                        <TableFooter>
                          <TableRow className="bg-muted/30 font-semibold border-t-2 hover:bg-muted/30">
                            <TableCell colSpan={6} className="text-right">
                              Total
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-green-600">
                              {formatCurrency(
                                drilldownTransactions.reduce(
                                  (s, t) =>
                                    s +
                                    (t.moneyIn ??
                                      Math.max(t.amountRaw ?? 0, 0)),
                                  0,
                                ),
                                report?.currencySymbol ?? "£",
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-red-600">
                              {formatCurrency(
                                drilldownTransactions.reduce(
                                  (s, t) =>
                                    s +
                                    (t.moneyOut ??
                                      Math.max(-(t.amountRaw ?? 0), 0)),
                                  0,
                                ),
                                report?.currencySymbol ?? "£",
                              )}
                            </TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </div>
                  )}
                </div>
                <div className="p-4 border-t border-border flex justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => setDrilldownOpen(false)}
                  >
                    Close
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </TabsContent>

          {/* Tab 3: Archived Cash Flow Statements */}
          <TabsContent
            value="archived"
            className="mt-0 pt-4 flex-1 min-h-0 overflow-auto data-[state=inactive]:hidden space-y-6"
          >
            {/* Archive list */}
            <Card>
              <CardHeader className="border-b bg-muted/20 pb-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      Archived Cash Flow Statements
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Review previously archived cash flow statements for this
                      organisation
                    </p>
                    {(archiveError || isLoadingArchiveDetail) && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {isLoadingArchiveDetail
                          ? "Loading archived statement…"
                          : archiveError?.message}
                      </p>
                    )}
                    {archiveDetailError && (
                      <p className="text-xs text-destructive mt-1">
                        {archiveDetailError}
                      </p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingArchive ? (
                  <div className="p-6 space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : !archiveReports?.length ? (
                  <div className="p-6 text-center text-muted-foreground">
                    No archived cash flow statements found for the selected
                    period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow className="bg-muted/50">
                          <TableHead className="w-[60px]">ID</TableHead>
                          <TableHead>Period</TableHead>
                          <TableHead>Created At</TableHead>
                          <TableHead>Format</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {archiveReports.map((item: any) => (
                          <TableRow key={item.id}>
                            <TableCell>{item.id}</TableCell>
                            <TableCell>
                              {item.start_date ?? "—"}{" "}
                              {item.end_date ? `to ${item.end_date}` : ""}
                            </TableCell>
                            <TableCell>
                              {item.created_date
                                ? formatDisplayDate(item.created_date)
                                : "—"}
                            </TableCell>
                            <TableCell>{item.download_format ?? "—"}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleViewArchive(item.id)}
                                disabled={isLoadingArchiveDetail}
                              >
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Selected archived statement preview */}
            {archiveDetail?.report && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Archived Statement #{archiveDetail.id}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Read-only view of the archived cash flow statement
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  {!archiveDetail.report.columns?.length ? (
                    <div className="p-6 text-center text-muted-foreground">
                      No data found in archived statement.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow className="bg-muted/50">
                            <TableHead className="w-[220px] min-w-[220px] sticky left-0 bg-muted/50 z-10"></TableHead>
                            {archiveDetail.report.columns.map((col: string) => (
                              <TableHead
                                key={col}
                                className="text-center min-w-[90px]"
                              >
                                {col}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {archiveDetail.report.tableGroupDataSet.map(
                            (group: any, groupIndex: number) => (
                              <React.Fragment key={groupIndex}>
                                <TableRow
                                  key={`arch-group-${groupIndex}`}
                                  className="bg-muted/30 font-medium"
                                >
                                  <TableCell className="sticky left-0 bg-muted/30 z-10">
                                    {group.type}
                                  </TableCell>
                                  {archiveDetail.report.columns.map(
                                    (_: string, ci: number) => (
                                      <TableCell
                                        key={ci}
                                        className="text-center"
                                      />
                                    ),
                                  )}
                                </TableRow>
                                {group.subGroupDataSet.flatMap(
                                  (sub: any, subIdx: number) => [
                                    ...sub.rowDataSet.flatMap(
                                      (rowSet: any, rsIdx: number) => {
                                        const keyBase = `arch-${groupIndex}-${subIdx}-${rowSet.id}-${rsIdx}`;
                                        const hasSectionTitle =
                                          !isRedundantCategoryCodeHeader(
                                            rowSet.header,
                                          );
                                        const linePad = hasSectionTitle
                                          ? "pl-10"
                                          : "pl-8";
                                        const block: React.ReactNode[] = [];
                                        const cols = archiveDetail.report
                                          .columns as string[];

                                        if (hasSectionTitle) {
                                          block.push(
                                            <TableRow
                                              key={`${keyBase}-title`}
                                              className="bg-muted/25 border-t border-border/60"
                                            >
                                              <TableCell className="pl-8 py-3 font-semibold text-sm text-foreground sticky left-0 bg-muted/25 z-10">
                                                {rowSet.header}
                                              </TableCell>
                                              {cols.map(
                                                (_: string, ci: number) => (
                                                  <TableCell
                                                    key={ci}
                                                    className="bg-muted/25"
                                                  />
                                                ),
                                              )}
                                            </TableRow>,
                                          );
                                        }

                                        rowSet.rowData.forEach(
                                          (row: any, rowIdx: number) => {
                                            block.push(
                                              <TableRow
                                                key={`${keyBase}-r-${rowIdx}`}
                                              >
                                                <TableCell
                                                  className={cn(
                                                    linePad,
                                                    "sticky left-0 bg-card z-10 py-2.5",
                                                  )}
                                                >
                                                  <span className="text-foreground">
                                                    {row.name}
                                                  </span>
                                                </TableCell>
                                                {row.colData.map(
                                                  (col: any, ci: number) => (
                                                    <TableCell
                                                      key={ci}
                                                      className={cn(
                                                        "text-center tabular-nums py-2.5",
                                                        col.value < 0 &&
                                                          "text-destructive",
                                                      )}
                                                    >
                                                      {formatCurrency(
                                                        col.value,
                                                        archiveDetail.report
                                                          .currencySymbol,
                                                      )}
                                                    </TableCell>
                                                  ),
                                                )}
                                              </TableRow>,
                                            );
                                          },
                                        );

                                        if (rowSet.total) {
                                          block.push(
                                            <TableRow
                                              key={`${keyBase}-total`}
                                              className="bg-muted/20 font-medium"
                                            >
                                              <TableCell
                                                className={cn(
                                                  linePad,
                                                  "sticky left-0 bg-muted/20 z-10",
                                                )}
                                              >
                                                {rowSet.total.name}
                                              </TableCell>
                                              {rowSet.total.colData.map(
                                                (col: any, ci: number) => (
                                                  <TableCell
                                                    key={ci}
                                                    className={cn(
                                                      "text-center tabular-nums",
                                                      col.value < 0 &&
                                                        "text-destructive",
                                                    )}
                                                  >
                                                    {formatCurrency(
                                                      col.value,
                                                      archiveDetail.report
                                                        .currencySymbol,
                                                    )}
                                                  </TableCell>
                                                ),
                                              )}
                                            </TableRow>,
                                          );
                                        }

                                        block.push(
                                          statementSectionSpacerRow(
                                            `${keyBase}-spacer`,
                                            cols.length,
                                          ),
                                        );
                                        return block;
                                      },
                                    ),
                                    sub.total ? (
                                      <TableRow
                                        key={`arch-${groupIndex}-${subIdx}-sub-total`}
                                        className="bg-muted/30 font-semibold"
                                      >
                                        <TableCell className="pl-8 sticky left-0 bg-muted/30 z-10">
                                          {sub.total.name}
                                        </TableCell>
                                        {sub.total.colData.map(
                                          (col: any, ci: number) => (
                                            <TableCell
                                              key={ci}
                                              className={cn(
                                                "text-center tabular-nums",
                                                col.value < 0 &&
                                                  "text-destructive",
                                              )}
                                            >
                                              {formatCurrency(
                                                col.value,
                                                archiveDetail.report
                                                  .currencySymbol,
                                              )}
                                            </TableCell>
                                          ),
                                        )}
                                      </TableRow>
                                    ) : null,
                                  ],
                                )}
                                {group.total && (
                                  <TableRow className="font-bold bg-muted/40 border-t-2">
                                    <TableCell className="sticky left-0 bg-muted/40 z-10 pl-6">
                                      {group.total.name}
                                    </TableCell>
                                    {group.total.colData.map(
                                      (col: any, ci: number) => (
                                        <TableCell
                                          key={ci}
                                          className={cn(
                                            "text-center tabular-nums",
                                            col.value < 0 && "text-destructive",
                                          )}
                                        >
                                          {formatCurrency(
                                            col.value,
                                            archiveDetail.report.currencySymbol,
                                          )}
                                        </TableCell>
                                      ),
                                    )}
                                  </TableRow>
                                )}
                              </React.Fragment>
                            ),
                          )}
                          {/* Total rows */}
                          {archiveDetail.report.totalRowDataSet.map(
                            (row: any) => (
                              <TableRow
                                key={row.name}
                                className="font-semibold bg-muted/20"
                              >
                                <TableCell className="sticky left-0 bg-muted/20 z-10">
                                  {row.name}
                                </TableCell>
                                {row.colData.map((col: any, ci: number) => (
                                  <TableCell
                                    key={ci}
                                    className={cn(
                                      "text-center tabular-nums",
                                      col.value < 0 &&
                                        row.name !== "Closing Balance" &&
                                        "text-destructive",
                                    )}
                                  >
                                    {formatCurrency(
                                      col.value,
                                      archiveDetail.report.currencySymbol,
                                    )}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ),
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
