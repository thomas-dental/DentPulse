/**
 * Profit Benchmark
 * Expense vs profit groups with tiered variance indicators (Version 2 style).
 */

import React, { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import { MainLayout } from "@/components/layout/MainLayout";
import { useOrganization } from "@/hooks/useOrganization";
import { useFilters } from "@/contexts/FilterContext";
import { useLocations } from "@/hooks/useLocations";
import { useProfitBenchmark } from "@/hooks/useProfitBenchmark";
import type { ProfitBenchmarkRow } from "@/services/profitBenchmarkService";
import {
  saveProfitBenchmarkSettings,
  profitBenchmarkRowKey,
  getProfitCategoryDrilldown,
  getProfitCategoryPeriodicPerformance,
  type ProfitCategoryDetailSummary,
  type ProfitCategoryDrilldownTransaction,
  type ProfitPeriodGranularity,
  type ProfitPeriodicPoint,
} from "@/services/profitBenchmarkService";
import { ProfitCategoryDrilldownDialog } from "@/components/profit/ProfitCategoryDrilldownDialog";
import { ProfitCategoryPeriodicChartDialog } from "@/components/profit/ProfitCategoryPeriodicChartDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
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
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  BarChart3,
  Pencil,
  Save,
  Home,
  Scale,
  MousePointerClick,
  LineChart,
  Calendar,
  ChevronDown,
} from "lucide-react";
import { formatGbp, formatPercentDisplay } from "@/utils/formatMoney";
import { useAllProvidersNetProduction } from "@/hooks/useAllProvidersNetProduction";
import { useLocationIncomeAccountingTotals } from "@/hooks/useLocationIncomeAccountingTotals";
import {
  ChartDateFilter,
  calculateDateRangeFromFilter,
  getDateFilterLabel,
  type DateFilterType,
  type CustomRange,
} from "@/components/ui/chart-date-filter";
import { Badge } from "@/components/ui/badge";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";

/** Map header FilterContext range ids to ChartDateFilter labels. */
function headerPeriodLabel(rangeId: string): string {
  const map: Record<string, DateFilterType> = {
    "this-month": "this-month",
    mtd: "this-month",
    "this-quarter": "this-quarter",
    qtd: "this-quarter",
    "this-year": "this-year",
    ytd: "this-year",
    "last-month": "last-month",
    "last-quarter": "last-quarter",
    "last-year": "last-year",
    custom: "custom",
    "last-12m": "custom",
    yoy: "custom",
  };
  return getDateFilterLabel(map[rangeId] ?? "custom");
}

const toNumeric = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const isParenNegative = /^\(.*\)$/.test(trimmed);
    const cleaned = trimmed.replace(/[£,%\s,()]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return 0;
    return isParenNegative ? -n : n;
  }
  return 0;
};

type VarianceTier = "fantastic" | "slight" | "stable" | "warning" | "action";

function expenseVarianceTier(
  actualPct: number,
  benchmarkPct: number,
): { tier: VarianceTier; label: string; delta: number } {
  const delta = actualPct - benchmarkPct;
  if (delta <= -3)
    return { tier: "fantastic", label: "Fantastic improvement", delta };
  if (delta <= -1)
    return { tier: "slight", label: "Slight improvement", delta };
  if (delta < 1) return { tier: "stable", label: "Stable", delta };
  if (delta < 3) return { tier: "warning", label: "Warning", delta };
  return { tier: "action", label: "Take action", delta };
}

function profitVarianceTier(
  actualPct: number,
  benchmarkPct: number,
): { tier: VarianceTier; label: string; delta: number } {
  const delta = actualPct - benchmarkPct;
  if (delta >= 3)
    return { tier: "fantastic", label: "Fantastic improvement", delta };
  if (delta >= 1) return { tier: "slight", label: "Slight improvement", delta };
  if (delta > -1) return { tier: "stable", label: "Stable", delta };
  if (delta > -3) return { tier: "warning", label: "Warning", delta };
  return { tier: "action", label: "Take action", delta };
}

function VarianceIndicator({
  isProfit,
  actualPct,
  benchmarkPct,
}: {
  isProfit: boolean;
  actualPct: number;
  benchmarkPct: number;
}) {
  const { tier, label, delta } = isProfit
    ? profitVarianceTier(actualPct, benchmarkPct)
    : expenseVarianceTier(actualPct, benchmarkPct);

  const color =
    tier === "fantastic"
      ? "text-green-600 dark:text-green-400"
      : tier === "slight"
        ? "text-emerald-600 dark:text-emerald-400"
        : tier === "stable"
          ? "text-blue-600 dark:text-blue-400"
          : tier === "warning"
            ? "text-amber-600 dark:text-amber-500"
            : "text-red-600 dark:text-red-400";

  const Icon =
    tier === "fantastic" || tier === "slight"
      ? Home
      : tier === "stable"
        ? Scale
        : tier === "warning"
          ? AlertCircle
          : MousePointerClick;

  const deltaStr = formatPercentDisplay(delta);

  return (
    <div
      className={`flex items-center justify-end gap-2 text-sm font-medium ${color}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="text-right">
        <span className="sr-only">{label}: </span>
        {deltaStr}
      </span>
    </div>
  );
}

function isCategoryBenchmarkRows(rows: ProfitBenchmarkRow[]): boolean {
  return rows.some(
    (r) =>
      r.isProfitRow === true ||
      (r.groupAccountMasterId != null &&
        Number.isFinite(r.groupAccountMasterId)),
  );
}

type DisplayRow = {
  key: string;
  row: ProfitBenchmarkRow;
  category: string;
  benchmarkPct: number;
  actualPct: number;
  benchmarkAmount: number;
  actualAmount: number;
  variance: number;
  isProfitRow: boolean;
  /** Pro: 2 = Costs, 3 = Expenses */
  groupType: number | null;
};

/** Fallback when API omits groupType (pre-deploy): Costs = Materials…Therapist, Expenses = Staff… */
function resolveGroupType(
  row: ProfitBenchmarkRow,
  category: string,
): number | null {
  if (row.isProfitRow) return null;
  if (row.groupType === 2 || row.groupType === 3) return row.groupType;
  const id = row.groupAccountMasterId;
  if (id != null && id >= 100 && id <= 104) return 2;
  if (id != null && id >= 105 && id <= 108) return 3;
  const name = category.toLowerCase();
  if (
    ["materials", "lab fees", "hygienist", "dentist", "therapist"].includes(
      name,
    )
  )
    return 2;
  if (
    ["staff", "marketing", "operating lease", "other fixed costs"].includes(
      name,
    )
  )
    return 3;
  return 2;
}

export type ProfitBenchmarkSummary = {
  actualAmount: number;
  actualPct: number;
  benchmarkPct: number;
  variance: number;
  /** Production Income used for margins (EBITDA Margin / Net Profit Margin). */
  productionIncome: number;
};

export function ProfitBenchmarkPanel({
  onAiContextChange,
  onProfitSummaryChange,
}: {
  onAiContextChange?: (ctx: Record<string, any>) => void;
  onProfitSummaryChange?: (summary: ProfitBenchmarkSummary | null) => void;
} = {}) {
  const { organizationId } = useOrganization();
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = (value: number): string => {
    const n = Number(value) || 0;
    const abs = Math.abs(n);
    return abs.toLocaleString("en-GB", {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    });
  };
  const formatPercent = (value: number) =>
    formatPercentDisplay(value, showDecimals ? 2 : 0);
  const formatCurrencyParensIfNegative = (value: number): string =>
    formatGbp(value, { decimals: showDecimals ? 2 : 0 });
  const {
    selectedLocationId,
    dateRange: globalDateRange,
    selectedDateRangeId,
  } = useFilters();
  const { allAvailableLocations } = useLocations();
  const [saving, setSaving] = useState(false);

  const locationScopeLabel = useMemo(() => {
    if (!selectedLocationId) return "All locations";
    const loc = allAvailableLocations?.find((l) => l.id === selectedLocationId);
    return loc?.location_name ?? "Selected location";
  }, [selectedLocationId, allAvailableLocations]);

  // Local period for the benchmark — starts from (and resets with) the header date filter.
  const [dateFilter, setDateFilter] = useState<DateFilterType>("custom");
  const [customRange, setCustomRange] = useState<CustomRange>(() => ({
    from: globalDateRange.startDate,
    to: globalDateRange.endDate,
  }));

  useEffect(() => {
    setDateFilter("custom");
    setCustomRange({
      from: globalDateRange.startDate,
      to: globalDateRange.endDate,
    });
  }, [globalDateRange.startDate.getTime(), globalDateRange.endDate.getTime()]);

  const computedRange = useMemo(
    () => calculateDateRangeFromFilter(dateFilter, customRange),
    [dateFilter, customRange],
  );
  const dateRange = useMemo(
    () => ({ from: computedRange.startDate, to: computedRange.endDate }),
    [computedRange],
  );
  // Show the actual selected dates for a custom range instead of the generic
  // "Custom Range" label, so the trigger always reflects what's applied.
  const dateFilterLabel =
    dateFilter === "custom" && customRange.from && customRange.to
      ? `${format(customRange.from, "dd-MM-yyyy")} → ${format(customRange.to, "dd-MM-yyyy")}`
      : getDateFilterLabel(dateFilter);

  const fromDate = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "";
  const toDate = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : "";

  const followsHeaderPeriod = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return false;
    return (
      format(dateRange.from, "yyyy-MM-dd") ===
        format(globalDateRange.startDate, "yyyy-MM-dd") &&
      format(dateRange.to, "yyyy-MM-dd") ===
        format(globalDateRange.endDate, "yyyy-MM-dd")
    );
  }, [dateRange, globalDateRange.startDate, globalDateRange.endDate]);

  const periodBadgeLabel = followsHeaderPeriod
    ? headerPeriodLabel(selectedDateRangeId)
    : "Custom range";

  const locationIdForProviders =
    selectedLocationId && String(selectedLocationId).toLowerCase() !== "all"
      ? selectedLocationId
      : null;

  const {
    rows,
    platformIntegrationId,
    isLoading: benchmarkLoading,
    error,
    refetch: refetchBenchmark,
  } = useProfitBenchmark(fromDate, toDate, undefined, selectedLocationId);

  // Production income base = Provider Net Production (Dentist + Therapist + Hygienist + Other).
  // When Revenue Settings (Settings → Setup Categories) has a type set to Accounting App, that
  // slice is replaced by ledger revenue for the mapped Chart of Accounts (Xero).
  const {
    data: providerProduction,
    isLoading: providerProductionLoading,
    refetch: refetchProviderProduction,
  } = useAllProvidersNetProduction(
    null,
    dateRange?.from ?? null,
    dateRange?.to ?? null,
    locationIdForProviders,
  );

  const {
    data: accountingIncome,
    isLoading: accountingIncomeLoading,
    refetch: refetchAccountingIncome,
  } = useLocationIncomeAccountingTotals(
    fromDate,
    toDate,
    locationIdForProviders,
  );

  const { productionIncome, incomeBreakdown } = useMemo(() => {
    const providers = providerProduction?.providers ?? [];
    const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
    const pmsPrivate = round2(
      providers.reduce((s, p) => s + (Number(p.totalPrivate) || 0), 0),
    );
    const pmsMembership = round2(
      providers.reduce((s, p) => s + (Number(p.totalMembership) || 0), 0),
    );
    const pmsNhs = round2(
      providers.reduce((s, p) => s + (Number(p.totalNhs) || 0), 0),
    );

    // null = PMS App path; number = Accounting App ledger total for that type.
    const privateIncome = round2(
      accountingIncome?.private != null ? accountingIncome.private : pmsPrivate,
    );
    const membershipIncome = round2(
      accountingIncome?.membership != null
        ? accountingIncome.membership
        : pmsMembership,
    );
    const nhsIncome = round2(
      accountingIncome?.nhs != null ? accountingIncome.nhs : pmsNhs,
    );
    const total = round2(privateIncome + membershipIncome + nhsIncome);
    const anyAccounting =
      accountingIncome?.private != null ||
      accountingIncome?.membership != null ||
      accountingIncome?.nhs != null;
    return {
      productionIncome: total,
      incomeBreakdown: {
        privateIncome,
        membershipIncome,
        nhsIncome,
        productionIncome: total,
        fromRevenueMappings: anyAccounting,
        fromProviderProduction: !anyAccounting,
        sources: accountingIncome?.sources,
      },
    };
  }, [providerProduction, accountingIncome]);

  const isLoading =
    benchmarkLoading || providerProductionLoading || accountingIncomeLoading;
  const refetch = async () => {
    await Promise.all([
      refetchBenchmark(),
      refetchProviderProduction(),
      refetchAccountingIncome(),
    ]);
  };

  const [benchmarkDraft, setBenchmarkDraft] = useState<Record<string, number>>(
    {},
  );

  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [drilldownCategory, setDrilldownCategory] = useState("");
  const [drilldownSearch, setDrilldownSearch] = useState("");
  const [drilldownSummary, setDrilldownSummary] =
    useState<ProfitCategoryDetailSummary | null>(null);
  const [drilldownTxns, setDrilldownTxns] = useState<
    ProfitCategoryDrilldownTransaction[]
  >([]);
  const [drilldownPlatform, setDrilldownPlatform] = useState<
    "xero" | "iplicit" | null
  >(null);

  const [chartOpen, setChartOpen] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartCategory, setChartCategory] = useState("");
  const [chartSummary, setChartSummary] =
    useState<ProfitCategoryDetailSummary | null>(null);
  const [chartPeriods, setChartPeriods] = useState<ProfitPeriodicPoint[]>([]);
  const [chartGranularity, setChartGranularity] =
    useState<ProfitPeriodGranularity>("monthly");
  const [chartContext, setChartContext] = useState<{
    groupAccountMasterId: number;
    benchmarkPercent: number;
    categoryName: string;
  } | null>(null);

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const r of rows) {
      next[profitBenchmarkRowKey(r)] = r.benchmark;
    }
    setBenchmarkDraft(next);
  }, [rows]);

  const categoryMode = useMemo(() => isCategoryBenchmarkRows(rows), [rows]);

  const displayRowsAll = useMemo((): DisplayRow[] => {
    const baseRows = rows.map((row) => {
      const key = profitBenchmarkRowKey(row);
      const category = row.metric.replace(/\s*%$/, "").trim();
      const isProfitRow =
        row.isProfitRow === true || category.toUpperCase() === "PROFIT";
      const benchmarkPct = benchmarkDraft[key] ?? row.benchmark;
      const incomeForCalc = Math.abs(toNumeric(productionIncome));
      const benchmarkAmount = (incomeForCalc * benchmarkPct) / 100;
      const rawActual =
        row.actualAmount != null && Number.isFinite(row.actualAmount)
          ? Number(row.actualAmount)
          : (incomeForCalc * row.current) / 100;
      const actualAmount = isProfitRow ? rawActual : Math.abs(rawActual);
      const actualPct =
        incomeForCalc > 0
          ? Number(((actualAmount / incomeForCalc) * 100).toFixed(2))
          : 0;
      const variance = benchmarkPct - actualPct;
      return {
        key,
        row,
        category,
        benchmarkPct,
        actualPct,
        benchmarkAmount,
        actualAmount,
        variance,
        isProfitRow,
        groupType: resolveGroupType(row, category),
      };
    });

    if (!categoryMode) return baseRows;

    // Derive PROFIT from the same visible expense rows.
    const expenseRows = baseRows.filter((r) => !r.isProfitRow);
    const expenseBenchmarkSum = expenseRows.reduce(
      (sum, r) => sum + (Number(r.benchmarkPct) || 0),
      0,
    );
    const totalExpenseActual = expenseRows.reduce(
      (sum, r) => sum + Math.abs(toNumeric(r.actualAmount)),
      0,
    );

    const pincome = Math.abs(toNumeric(productionIncome));
    const profitDerivedBench = Math.max(
      0,
      Math.min(100, 100 - expenseBenchmarkSum),
    );
    const profitDerivedAmount = pincome - totalExpenseActual;
    const totalExpensePct =
      pincome > 0 ? (totalExpenseActual / pincome) * 100 : 0;
    const profitDerivedPct = 100 - totalExpensePct;

    return baseRows.map((r) => {
      if (!r.isProfitRow) return r;
      const actualPct = Number.isFinite(profitDerivedPct)
        ? Number(profitDerivedPct.toFixed(2))
        : 0;
      return {
        ...r,
        benchmarkPct: Number.isFinite(profitDerivedBench)
          ? Number(profitDerivedBench.toFixed(2))
          : 0,
        benchmarkAmount: pincome * (profitDerivedBench / 100),
        actualAmount: Number.isFinite(profitDerivedAmount)
          ? Number(profitDerivedAmount.toFixed(2))
          : 0,
        actualPct,
        variance: profitDerivedBench - actualPct,
      };
    });
  }, [rows, productionIncome, benchmarkDraft, categoryMode]);

  const { costRows, expenseRows, profitRow } = useMemo(() => {
    const profit = displayRowsAll.find((d) => d.isProfitRow);
    const nonProfit = displayRowsAll.filter((d) => !d.isProfitRow);
    const costs = nonProfit.filter((d) => d.groupType !== 3);
    const expenses = nonProfit.filter((d) => d.groupType === 3);
    return { costRows: costs, expenseRows: expenses, profitRow: profit };
  }, [displayRowsAll]);

  // Mirrors the "Profit" row rendered at the bottom of the table below.
  const profitSummary = useMemo((): ProfitBenchmarkSummary | null => {
    if (!profitRow) return null;
    const incomeBase = Math.abs(toNumeric(productionIncome));
    const actualAmount = toNumeric(profitRow.actualAmount);
    const actualPct =
      incomeBase > 0 ? Number(((actualAmount / incomeBase) * 100).toFixed(2)) : 0;
    return {
      actualAmount,
      actualPct,
      benchmarkPct: profitRow.benchmarkPct,
      variance: actualPct - profitRow.benchmarkPct,
      productionIncome: incomeBase,
    };
  }, [profitRow, productionIncome]);

  useEffect(() => {
    onProfitSummaryChange?.(profitSummary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profitSummary]);

  const sectionTotal = (sectionRows: DisplayRow[]) => {
    const pincome = Math.abs(toNumeric(productionIncome));
    const actualAmount = sectionRows.reduce(
      (sum, r) => sum + Math.abs(toNumeric(r.actualAmount)),
      0,
    );
    const benchmarkPct = sectionRows.reduce(
      (sum, r) => sum + (Number(r.benchmarkPct) || 0),
      0,
    );
    const benchmarkAmount = pincome * (benchmarkPct / 100);
    const actualPct = pincome > 0 ? (actualAmount / pincome) * 100 : 0;
    return {
      actualAmount: Number(actualAmount.toFixed(2)),
      actualPct: Number(actualPct.toFixed(2)),
      benchmarkPct: Number(benchmarkPct.toFixed(2)),
      benchmarkAmount: Number(benchmarkAmount.toFixed(2)),
    };
  };

  const handleSaveBenchmarks = async () => {
    if (!organizationId || !categoryMode) return;
    setSaving(true);
    try {
      const expenseRowsForSave = rows.filter(
        (r) =>
          r.groupAccountMasterId != null &&
          Number.isFinite(Number(r.groupAccountMasterId)) &&
          !r.isProfitRow,
      );
      const expenseBenchSum = expenseRowsForSave.reduce(
        (sum, r) =>
          sum +
          (Number(benchmarkDraft[profitBenchmarkRowKey(r)] ?? r.benchmark) ||
            0),
        0,
      );
      const derivedProfitBench = Math.max(
        0,
        Math.min(100, 100 - expenseBenchSum),
      );

      const items = [
        ...expenseRowsForSave.map((r) => ({
          groupAccountMasterId: r.groupAccountMasterId ?? null,
          isProfitRow: false as const,
          benchmarkPercent:
            Number(benchmarkDraft[profitBenchmarkRowKey(r)] ?? r.benchmark) ||
            0,
        })),
        ...(rows.some((r) => r.isProfitRow)
          ? [
              {
                groupAccountMasterId: null as null,
                isProfitRow: true as const,
                benchmarkPercent: derivedProfitBench,
              },
            ]
          : []),
      ];
      await saveProfitBenchmarkSettings(
        organizationId,
        platformIntegrationId ?? null,
        items,
      );
      toast.success("Benchmark percentages saved.");
      await refetch();
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const openCategoryDrilldown = async (dr: DisplayRow) => {
    const gid = dr.row.groupAccountMasterId;
    if (
      !organizationId ||
      gid == null ||
      !Number.isFinite(gid) ||
      !fromDate ||
      !toDate
    )
      return;
    setDrilldownOpen(true);
    setDrilldownLoading(true);
    setDrilldownError(null);
    setDrilldownCategory(dr.category);
    setDrilldownSearch("");
    setDrilldownTxns([]);
    setDrilldownSummary(null);
    try {
      const res = await getProfitCategoryDrilldown(organizationId, {
        fromDate,
        toDate,
        groupAccountMasterId: Number(gid),
        locationId: selectedLocationId,
        benchmarkPercent: dr.benchmarkPct,
        productionIncome: Math.abs(toNumeric(productionIncome)),
        categoryName: dr.category,
      });
      setDrilldownTxns(res.transactions);
      setDrilldownSummary(res.summary);
      setDrilldownPlatform(res.accountingPlatform);
    } catch (e) {
      setDrilldownError(
        e instanceof Error ? e.message : "Failed to load drill-down",
      );
    } finally {
      setDrilldownLoading(false);
    }
  };

  const loadPeriodicChart = async (
    ctx: {
      groupAccountMasterId: number;
      benchmarkPercent: number;
      categoryName: string;
    },
    granularity: ProfitPeriodGranularity,
  ) => {
    if (!organizationId || !fromDate || !toDate) return;
    setChartLoading(true);
    setChartError(null);
    try {
      const res = await getProfitCategoryPeriodicPerformance(organizationId, {
        fromDate,
        toDate,
        groupAccountMasterId: ctx.groupAccountMasterId,
        locationId: selectedLocationId,
        benchmarkPercent: ctx.benchmarkPercent,
        productionIncome: Math.abs(toNumeric(productionIncome)),
        categoryName: ctx.categoryName,
        periodGranularity: granularity,
      });
      setChartPeriods(res.periods);
      setChartSummary(res.summary);
      setChartCategory(res.categoryName || ctx.categoryName);
    } catch (e) {
      setChartError(e instanceof Error ? e.message : "Failed to load chart");
      setChartPeriods([]);
    } finally {
      setChartLoading(false);
    }
  };

  const openCategoryChart = async (dr: DisplayRow) => {
    const gid = dr.row.groupAccountMasterId;
    if (
      !organizationId ||
      gid == null ||
      !Number.isFinite(gid) ||
      !fromDate ||
      !toDate
    )
      return;
    const ctx = {
      groupAccountMasterId: Number(gid),
      benchmarkPercent: dr.benchmarkPct,
      categoryName: dr.category,
    };
    setChartContext(ctx);
    setChartGranularity("monthly");
    setChartOpen(true);
    setChartCategory(dr.category);
    setChartSummary(null);
    setChartPeriods([]);
    await loadPeriodicChart(ctx, "monthly");
  };

  const renderDataRow = (
    dr: DisplayRow,
    variant: "cost" | "expense" | "profit",
  ) => {
    const canEditBench = categoryMode && !dr.isProfitRow;
    const canDrill =
      categoryMode && !dr.isProfitRow && dr.row.groupAccountMasterId != null;
    const incomeBase = Math.abs(toNumeric(productionIncome));
    const actualAmountBase = dr.isProfitRow
      ? toNumeric(dr.actualAmount)
      : Math.abs(toNumeric(dr.actualAmount));
    const actualPctFromAmount =
      incomeBase > 0
        ? Number(((actualAmountBase / incomeBase) * 100).toFixed(2))
        : 0;
    const varianceFromAmount = actualPctFromAmount - dr.benchmarkPct;
    const rowClass =
      variant === "profit"
        ? "bg-card border-t-2 border-border"
        : variant === "cost"
          ? "bg-orange-50/50 hover:bg-orange-50/80 dark:bg-orange-950/20 dark:hover:bg-orange-950/30"
          : "bg-rose-50/60 hover:bg-rose-50/80 dark:bg-rose-950/25 dark:hover:bg-rose-950/35";

    return (
      <TableRow key={dr.key} className={rowClass}>
        <TableCell className="font-medium">{dr.category}</TableCell>
        <TableCell className="text-right tabular-nums">
          £{formatCurrency(Math.abs(dr.benchmarkAmount))}
        </TableCell>
        <TableCell className="text-right">
          {canEditBench ? (
            <Input
              type="number"
              step="0.1"
              className="ml-auto h-8 w-20 text-right"
              value={benchmarkDraft[dr.key] ?? dr.row.benchmark}
              onChange={(e) => {
                const v = e.target.value === "" ? 0 : Number(e.target.value);
                setBenchmarkDraft((prev) => ({
                  ...prev,
                  [dr.key]: Number.isFinite(v) ? v : 0,
                }));
              }}
            />
          ) : dr.isProfitRow && categoryMode ? (
            <span className="font-semibold text-green-600 dark:text-green-400 tabular-nums">
              {formatPercent(dr.benchmarkPct)}
            </span>
          ) : (
            formatPercent(dr.benchmarkPct)
          )}
        </TableCell>
        <TableCell
          className={
            canDrill
              ? "text-right tabular-nums cursor-pointer text-primary hover:underline underline-offset-2"
              : "text-right tabular-nums"
          }
          title={canDrill ? "View transactions" : undefined}
          onClick={canDrill ? () => void openCategoryDrilldown(dr) : undefined}
        >
          {dr.isProfitRow
            ? formatCurrencyParensIfNegative(dr.actualAmount)
            : `£${formatCurrency(dr.actualAmount)}`}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatPercent(actualPctFromAmount)}
        </TableCell>
        <TableCell className="text-right">
          <VarianceIndicator
            isProfit={dr.isProfitRow}
            actualPct={actualPctFromAmount}
            benchmarkPct={dr.benchmarkPct}
          />
        </TableCell>
        <TableCell className="text-center">
          <div className="inline-flex items-center justify-center gap-0.5">
            {canDrill && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Periodic performance"
                onClick={() => void openCategoryChart(dr)}
              >
                <LineChart className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              asChild
              title="Advice / action"
            >
              <Link
                to={`/profitability/benchmark/${encodeURIComponent(dr.category)}`}
                state={{
                  category: dr.category,
                  benchmarkAmount: dr.benchmarkAmount,
                  benchmarkPct: dr.benchmarkPct,
                  actualAmount: dr.actualAmount,
                  actualPct: actualPctFromAmount,
                  variance: varianceFromAmount,
                }}
              >
                <Pencil className="w-4 h-4" />
              </Link>
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const renderSectionTotalRow = (label: string, sectionRows: DisplayRow[]) => {
    const t = sectionTotal(sectionRows);
    return (
      <TableRow className="bg-muted/30 hover:bg-muted/30 font-semibold border-t border-border">
        <TableCell>{label}</TableCell>
        <TableCell className="text-right tabular-nums">
          £{formatCurrency(Math.abs(t.benchmarkAmount))}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatPercent(t.benchmarkPct)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          £{formatCurrency(t.actualAmount)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatPercent(t.actualPct)}
        </TableCell>
        <TableCell className="text-right">
          <VarianceIndicator
            isProfit={false}
            actualPct={t.actualPct}
            benchmarkPct={t.benchmarkPct}
          />
        </TableCell>
        <TableCell />
      </TableRow>
    );
  };

  const renderSectionHeader = (label: string) => (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell
        colSpan={7}
        className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </TableCell>
    </TableRow>
  );

  const r2 = (n: number) => Math.round((n ?? 0) * 100) / 100;
  const aiRows = displayRowsAll.slice(0, 60).map((r) => ({
    category: r.category,
    isProfitRow: r.isProfitRow,
    benchmarkPct: r2(r.benchmarkPct),
    actualPct: r2(r.actualPct),
    benchmarkAmount: r2(r.benchmarkAmount),
    actualAmount: r2(r.actualAmount),
    variance: r2(r.actualPct - r.benchmarkPct),
  }));
  const expenseOnly = aiRows.filter((r) => !r.isProfitRow);
  const worstVariance = [...expenseOnly].sort(
    (a, b) => b.variance - a.variance,
  );
  const bestVariance = [...expenseOnly].sort((a, b) => a.variance - b.variance);
  const aiContextData = {
    page: "profit-benchmark",
    selectedLocationName: locationScopeLabel,
    period: { startDate: fromDate, endDate: toDate },
    productionIncome: r2(productionIncome),
    categoryMode,
    rows: aiRows,
    topOverspendingExpenses: worstVariance
      .slice(0, 10)
      .map((r) => ({
        category: r.category,
        variance: r.variance,
        actualPct: r.actualPct,
        benchmarkPct: r.benchmarkPct,
      })),
    topUnderspendingExpenses: bestVariance
      .slice(0, 10)
      .map((r) => ({
        category: r.category,
        variance: r.variance,
        actualPct: r.actualPct,
        benchmarkPct: r.benchmarkPct,
      })),
  };

  useEffect(() => {
    onAiContextChange?.(aiContextData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRows, productionIncome, categoryMode, locationScopeLabel, fromDate, toDate]);

  return (
    <>
      <div className="space-y-6 animate-fade-in">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="block font-medium mb-1">{error.message}</span>
              {error.message?.toLowerCase().includes("failed to send") && (
                <span className="block mt-2 text-sm opacity-90">
                  Deploy the profit-benchmark Edge Function: run{" "}
                  <code className="bg-muted px-1 rounded">
                    supabase functions deploy profit-benchmark
                  </code>{" "}
                  and ensure{" "}
                  <code className="bg-muted px-1 rounded">
                    VITE_SUPABASE_URL
                  </code>{" "}
                  points to that project.
                </span>
              )}
              {(error.message?.toLowerCase().includes("session") ||
                error.message?.toLowerCase().includes("sign out")) && (
                <span className="block mt-2 text-sm opacity-90">
                  Hard refresh alone does not renew your login token. Sign out,
                  sign back in, then click Retry.
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <CardTitle className="text-base">Performance benchmark</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Costs and expenses compare actual % to your benchmark (lower is
                  better). Profit is net of both vs production income (higher is
                  better).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Badge
                  variant="secondary"
                  className="font-normal text-xs"
                  title={
                    followsHeaderPeriod
                      ? "Matches the header date filter. Change the header to reset this period."
                      : "Custom period for this benchmark. Changing the header date will reset it."
                  }
                >
                  {periodBadgeLabel}
                </Badge>
                <ChartDateFilter
                  filter={dateFilter}
                  onFilterChange={setDateFilter}
                  customRange={customRange}
                  onCustomRangeChange={setCustomRange}
                  align="end"
                  trigger={
                    <Button variant="outline" className="h-9 gap-2 font-normal">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{dateFilterLabel}</span>
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  }
                />
                {isLoading && (
                  <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                )}
                {error && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetch()}
                    className="gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retry
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <>
                <div className="p-4 border-b">
                  <Label className="text-xs text-muted-foreground">
                    Production income
                  </Label>
                  <div className="mt-3 flex flex-wrap items-stretch gap-2 sm:gap-3">
                    {(
                      [
                        {
                          key: "private",
                          label: "Private Income",
                          amount:
                            incomeBreakdown?.privateIncome ?? productionIncome,
                          accent: "border-l-sky-500",
                        },
                        {
                          key: "membership",
                          label: "Membership",
                          amount: incomeBreakdown?.membershipIncome ?? 0,
                          accent: "border-l-emerald-500",
                        },
                        {
                          key: "nhs",
                          label: "NHS",
                          amount: incomeBreakdown?.nhsIncome ?? 0,
                          accent: "border-l-amber-400",
                        },
                      ] as const
                    ).map((item, idx) => (
                      <div key={item.key} className="contents">
                        {idx > 0 && (
                          <div className="flex items-center text-lg font-semibold text-muted-foreground px-0.5">
                            +
                          </div>
                        )}
                        <div
                          className={`min-w-[140px] flex-1 rounded-md border border-border bg-card px-3 py-2 border-l-4 ${item.accent}`}
                        >
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {item.label}
                          </div>
                          <div className="mt-0.5 text-sm font-semibold tabular-nums">
                            £{formatCurrency(item.amount)}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center text-lg font-semibold text-muted-foreground px-0.5">
                      =
                    </div>
                    <div className="min-w-[160px] flex-1 rounded-md border border-border bg-card px-3 py-2 border-l-4 border-l-blue-600">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Production Income
                      </div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums">
                        £{formatCurrency(productionIncome)}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Location scope: {locationScopeLabel}. Each income type follows
                    Revenue Settings (Settings → Setup Categories → Revenue Settings):
                    Accounting App + By Practice uses Profit (Revenue) Chart of
                    Accounts mappings; PMS App or By Provider uses Provider Net
                    Production.
                  </p>
                  {!categoryMode && rows.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Configure Profit (Costs &amp; Expenses) groups under
                      Settings → Setup Categories for category benchmarks.
                    </p>
                  )}
                  {categoryMode && productionIncome === 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                      No production income for this period. Check Revenue Settings
                      (PMS vs Accounting, By Practice vs By Provider) and Setup
                      Categories → Profit (Revenue) mappings, or Providers →
                      Production Data for By Provider / PMS types.
                    </p>
                  )}
                </div>

                <div className="overflow-x-auto rounded-b-lg border border-t-0 border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">
                          Expected Amount
                        </TableHead>
                        <TableHead className="text-right w-[120px] whitespace-nowrap">
                          Benchmark %
                        </TableHead>
                        <TableHead className="text-right">
                          Actual amount
                        </TableHead>
                        <TableHead className="text-right">Actual %</TableHead>
                        <TableHead className="text-right">Indicator</TableHead>
                        <TableHead className="text-center w-[120px]">
                          Action
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayRowsAll.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="text-center text-muted-foreground py-8"
                          >
                            No data found
                          </TableCell>
                        </TableRow>
                      ) : categoryMode &&
                        (costRows.length > 0 ||
                          expenseRows.length > 0 ||
                          profitRow) ? (
                        <>
                          {renderSectionHeader("Costs Of Treatment Delivery")}
                          {renderSectionTotalRow(
                            "Total Costs Of Treatment Delivery",
                            costRows,
                          )}
                          {costRows.map((dr) => renderDataRow(dr, "cost"))}
                          {renderSectionHeader("Expenses To Run Your Business")}
                          {renderSectionTotalRow(
                            "Total Expenses To Run Your Business",
                            expenseRows,
                          )}
                          {expenseRows.map((dr) =>
                            renderDataRow(dr, "expense"),
                          )}
                          {renderSectionHeader("Profit")}
                          {profitRow
                            ? renderDataRow(profitRow, "profit")
                            : null}
                        </>
                      ) : (
                        displayRowsAll.map((dr) =>
                          renderDataRow(
                            dr,
                            dr.isProfitRow
                              ? "profit"
                              : dr.groupType === 3
                                ? "expense"
                                : "cost",
                          ),
                        )
                      )}
                    </TableBody>
                  </Table>
                </div>

                {categoryMode && (
                  <div className="flex justify-end p-4 border-t border-border">
                    <Button
                      size="sm"
                      className="gap-2 min-w-[120px]"
                      onClick={handleSaveBenchmarks}
                      disabled={saving || isLoading}
                    >
                      <Save className="w-4 h-4" />
                      {saving ? "Saving…" : "Submit"}
                    </Button>
                  </div>
                )}

                {categoryMode && (
                  <div className="grid gap-4 p-4 pt-0 md:grid-cols-2 border-t border-border bg-muted/20">
                    <Card className="shadow-sm">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">
                          Expense indicators
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Variance = actual % − benchmark % (lower is better).
                        </p>
                      </CardHeader>
                      <CardContent className="text-xs space-y-2 text-muted-foreground">
                        <p>
                          <span className="font-medium text-green-600 dark:text-green-400">
                            −3% &amp; below:
                          </span>{" "}
                          Fantastic improvement
                        </p>
                        <p>
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            −1 to −3%:
                          </span>{" "}
                          Slight improvement
                        </p>
                        <p>
                          <span className="font-medium text-blue-600 dark:text-blue-400">
                            −1 to 1%:
                          </span>{" "}
                          Stable
                        </p>
                        <p>
                          <span className="font-medium text-amber-600 dark:text-amber-500">
                            1 to 3%:
                          </span>{" "}
                          Warning
                        </p>
                        <p>
                          <span className="font-medium text-red-600 dark:text-red-400">
                            +3% &amp; above:
                          </span>{" "}
                          Take action
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="shadow-sm">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">
                          Profit indicators
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Variance = actual % − benchmark % (higher is better).
                        </p>
                      </CardHeader>
                      <CardContent className="text-xs space-y-2 text-muted-foreground">
                        <p>
                          <span className="font-medium text-green-600 dark:text-green-400">
                            3% &amp; above:
                          </span>{" "}
                          Fantastic improvement
                        </p>
                        <p>
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            1 to 3%:
                          </span>{" "}
                          Slight improvement
                        </p>
                        <p>
                          <span className="font-medium text-blue-600 dark:text-blue-400">
                            −1 to 1%:
                          </span>{" "}
                          Stable
                        </p>
                        <p>
                          <span className="font-medium text-amber-600 dark:text-amber-500">
                            −1 to −3%:
                          </span>{" "}
                          Warning
                        </p>
                        <p>
                          <span className="font-medium text-red-600 dark:text-red-400">
                            −3% &amp; below:
                          </span>{" "}
                          Take action
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ProfitCategoryDrilldownDialog
        open={drilldownOpen}
        onOpenChange={setDrilldownOpen}
        categoryName={drilldownCategory}
        loading={drilldownLoading}
        error={drilldownError}
        summary={drilldownSummary}
        transactions={drilldownTxns}
        accountingPlatform={drilldownPlatform}
        search={drilldownSearch}
        onSearchChange={setDrilldownSearch}
      />

      <ProfitCategoryPeriodicChartDialog
        open={chartOpen}
        onOpenChange={setChartOpen}
        categoryName={chartCategory}
        loading={chartLoading}
        error={chartError}
        summary={chartSummary}
        periods={chartPeriods}
        granularity={chartGranularity}
        onGranularityChange={(g) => {
          setChartGranularity(g);
          if (chartContext) void loadPeriodicChart(chartContext, g);
        }}
      />
    </>
  );
}

export default function ProfitBenchmark() {
  const [aiContext, setAiContext] = useState<Record<string, any>>({});

  return (
    <MainLayout userRole="admin" aiContext={aiContext}>
      <Helmet>
        <title>Profit Benchmark</title>
        <meta
          name="description"
          content="Profit benchmark by date range and saved benchmark targets."
        />
      </Helmet>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/profitability" aria-label="Back to Profitability">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-primary" />
              Profit Benchmark
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Production income and expense groups from your accounting data;
              benchmark targets are saved for this organization.
            </p>
          </div>
        </div>
        <ProfitBenchmarkPanel onAiContextChange={setAiContext} />
      </div>
    </MainLayout>
  );
}
