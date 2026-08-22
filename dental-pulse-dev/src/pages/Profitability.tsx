import { Helmet } from "react-helmet-async";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { MetricHelp } from "@/components/dashboard/MetricHelp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendIndicator } from "@/components/dashboard/TrendIndicator";
import { AISummaryCard } from "@/components/ai/AISummaryCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Cell,
} from "recharts";
import { useLocations } from "@/hooks/useLocations";
import {
  ArrowRight,
  Building2,
  TrendingUp,
  Calculator,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatGbp, formatPercentDisplay } from "@/utils/formatMoney";
import {
  ProfitBenchmarkPanel,
  type ProfitBenchmarkSummary,
} from "@/pages/ProfitBenchmark";
import { useFilters } from "@/contexts/FilterContext";
import { useEbitdaBridge } from "@/hooks/useEbitdaBridge";
import { useEbitdaValuation } from "@/hooks/useEbitdaValuation";
import { usePnLComparison } from "@/hooks/usePnLComparison";

export default function Profitability() {
  // REAL practice locations (the old demo entity list — "LDN-07" etc. from
  // mockData — leaked fictional practice codes into the AI narrative).
  const { locations: practiceLocations } = useLocations();
  const [selectedEntity, setSelectedEntity] = useState<string>("");
  const [comparisonEntity, setComparisonEntity] = useState("group");
  const [profitSummary, setProfitSummary] =
    useState<ProfitBenchmarkSummary | null>(null);
  const { dateRange: globalDateRange, selectedLocationId } = useFilters();
  const pnl = usePnLComparison();

  // Default the entity picker to the globally selected location (else the
  // first real location) once locations load.
  useEffect(() => {
    if (
      selectedEntity &&
      practiceLocations.some((l) => l.id === selectedEntity)
    )
      return;
    const preferred =
      selectedLocationId &&
      practiceLocations.some((l) => l.id === selectedLocationId)
        ? selectedLocationId
        : practiceLocations[0]?.id;
    if (preferred) setSelectedEntity(preferred);
  }, [practiceLocations, selectedLocationId, selectedEntity]);

  const fromDate = format(globalDateRange.startDate, "yyyy-MM-dd");
  const toDate = format(globalDateRange.endDate, "yyyy-MM-dd");
  const locationIdForEbitda =
    selectedLocationId && String(selectedLocationId).toLowerCase() !== "all"
      ? selectedLocationId
      : null;

  // Only use live Profit Benchmark amounts — never fall back to mock plData.
  const hasProfitData = profitSummary != null;
  const netProfitForBridge = profitSummary?.actualAmount ?? 0;

  const { data: ebitdaBridge, isLoading: ebitdaBridgeLoading } =
    useEbitdaBridge(fromDate, toDate, netProfitForBridge, locationIdForEbitda);

  // Final Multiple from EBITDA to value (same figure as Valuation Multiple card).
  const { valuation: ebitdaValuation, isLoading: ebitdaValuationLoading } =
    useEbitdaValuation();
  const finalMultiple = ebitdaValuation?.multiple.finalMultiple ?? null;
  const netDebt = ebitdaValuation?.netDebt ?? 0;

  const ebitdaBridgeData = ebitdaBridge?.rows ?? [];
  const ebitdaTotal = hasProfitData
    ? (ebitdaBridge?.ebitda ?? netProfitForBridge)
    : null;
  const enterpriseValueFromBridge =
    ebitdaTotal != null &&
    finalMultiple != null &&
    Number.isFinite(finalMultiple)
      ? Math.round(ebitdaTotal * finalMultiple * 100) / 100
      : null;
  const equityValueFromBridge =
    enterpriseValueFromBridge != null
      ? Math.round((enterpriseValueFromBridge - netDebt) * 100) / 100
      : null;

  const productionIncomeForMargin = Math.abs(
    Number(profitSummary?.productionIncome) || 0,
  );
  const ebitdaMarginPct =
    productionIncomeForMargin > 0 && ebitdaTotal != null
      ? Math.round((ebitdaTotal / productionIncomeForMargin) * 1000) / 10
      : null;
  const netProfitMarginPct =
    productionIncomeForMargin > 0 && hasProfitData
      ? Math.round((netProfitForBridge / productionIncomeForMargin) * 1000) / 10
      : null;

  const formatCurrency = (value: number) => formatGbp(value);

  const formatPercent = (value: number) => formatPercentDisplay(value, 0);

  // AI context data
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const selectedEntityName =
    practiceLocations.find((l) => l.id === selectedEntity)?.location_name ??
    "this practice";

  const plComparisonData = pnl.periodRows;
  const entityVsGroupData = pnl.entityVsGroupRows;

  const clinicianCostPercent =
    pnl.current.revenue > 0
      ? round2((pnl.current.clinicianCosts / pnl.current.revenue) * 100)
      : 0;
  const groupEbitdaMarginPct =
    pnl.group.revenue > 0
      ? round2((pnl.groupEbitda / pnl.group.revenue) * 100)
      : 0;
  const groupNetProfitMarginPct =
    pnl.group.revenue > 0
      ? round2((pnl.group.netProfit / pnl.group.revenue) * 100)
      : 0;

  const plRows = plComparisonData
    .map((r) => ({
      category: r.category,
      current: round2(r.current),
      prior: round2(r.prior),
      variance: round2(r.variance),
      variancePct: round2(r.variancePct),
    }))
    .slice(0, 50);

  const ebitdaBridgeRows = ebitdaBridgeData
    .map((r) => ({
      component: r.name,
      amount: round2(r.value),
    }))
    .slice(0, 50);

  const largestAddBack = useMemo(() => {
    const adds = ebitdaBridgeData.filter(
      (r) => r.key !== "netProfit" && r.key !== "ebitda",
    );
    if (adds.length === 0) return null;
    return [...adds].sort((a, b) => b.value - a.value)[0];
  }, [ebitdaBridgeData]);

  const profitabilityData = {
    netProfit: hasProfitData ? netProfitForBridge : null,
    ebitda: ebitdaTotal,
    ebitdaMargin:
      ebitdaMarginPct != null ? `${ebitdaMarginPct.toFixed(1)}%` : "n/a",
    netProfitMargin:
      netProfitMarginPct != null ? `${netProfitMarginPct.toFixed(1)}%` : "n/a",
    groupEbitdaMargin: pnl.hasData
      ? `${groupEbitdaMarginPct.toFixed(1)}%`
      : "n/a",
    groupNetProfitMargin: pnl.hasData
      ? `${groupNetProfitMarginPct.toFixed(1)}%`
      : "n/a",
    clinicianCostPercent,
    selectedEntityName,
    comparisonEntity,
    rows: {
      plComparison: plRows,
      ebitdaBridge: ebitdaBridgeRows,
      entityVsGroup: entityVsGroupData,
    },
    rankings: {
      plLargestNegativeVariance: [...plRows]
        .sort((a, b) => a.variance - b.variance)
        .slice(0, 10),
      plLargestPositiveVariance: [...plRows]
        .sort((a, b) => b.variance - a.variance)
        .slice(0, 10),
    },
  };

  return (
    <MainLayout
      userRole="admin"
      aiContext={{ page: "profitability", data: profitabilityData }}
    >
      <Helmet>
        <title>Profitability Analysis</title>
        <meta
          name="description"
          content="Analyze profit and loss statements with benchmark comparisons and profitability trends by location."
        />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Profitability Analysis
            </h1>
            <p className="text-muted-foreground mt-1">
              Benchmark performance, P&L comparisons, and EBITDA impact analysis
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedEntity} onValueChange={setSelectedEntity}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select entity" />
              </SelectTrigger>
              <SelectContent>
                {practiceLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.location_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* AI Summary */}
        <AISummaryCard page="profitability" data={profitabilityData} />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Building2 className="w-4 h-4" />
                <span>Net Profit</span>
                <MetricHelp title="Net Profit">
                  Your bottom-line profit so far this month — total income less
                  all costs (cost of sales plus administrative and operating
                  expenses), measured from the 1st to today.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">
                {hasProfitData ? formatCurrency(netProfitForBridge) : "—"}
              </div>
              {hasProfitData && (
                <TrendIndicator value={profitSummary.actualPct} />
              )}
              {!hasProfitData && (
                <div className="text-xs text-muted-foreground">
                  Awaiting production income
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <TrendingUp className="w-4 h-4" />
                <span>EBITDA</span>
                <MetricHelp title="EBITDA">
                  Earnings Before Interest, Tax, Depreciation and Amortisation —
                  operating profit this month before financing and accounting
                  adjustments. It shows how much the practice earns from running
                  the business itself.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">
                {ebitdaTotal != null ? formatCurrency(ebitdaTotal) : "—"}
              </div>
              {!hasProfitData && (
                <div className="text-xs text-muted-foreground">
                  Awaiting production income
                </div>
              )}
              {hasProfitData && !ebitdaBridge?.hasAnyMapping && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Map D/A/I/T accounts in Setup Categories → EBITDA
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Calculator className="w-4 h-4" />
                <span>EBITDA Margin</span>
                <MetricHelp title="EBITDA Margin = EBITDA ÷ Production Income × 100">
                  The share of production income kept as EBITDA. Higher is
                  better. Revenue here is Profit Benchmark Production Income.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">
                {ebitdaMarginPct != null ? formatPercent(ebitdaMarginPct) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {productionIncomeForMargin > 0
                  ? "EBITDA ÷ Production Income"
                  : "Awaiting production income"}
              </div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <ArrowRight className="w-4 h-4" />
                <span>Net Profit Margin</span>
                <MetricHelp title="Net Profit Margin = Net Profit ÷ Revenue × 100">
                  The share of every £1 of revenue left as bottom-line profit
                  after all costs. The comparison shows how you sit against the
                  group average.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">
                {netProfitMarginPct != null
                  ? formatPercent(netProfitMarginPct)
                  : "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {productionIncomeForMargin > 0
                  ? "Net Profit ÷ Production Income"
                  : "Awaiting production income"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="benchmark" className="space-y-4">
          <TabsList>
            <TabsTrigger value="benchmark">Profit Benchmark</TabsTrigger>
            {/* <TabsTrigger value="pl-period">P&L Period Comparison</TabsTrigger> */}
            {/* <TabsTrigger value="pl-group">P&L vs Group</TabsTrigger> */}
            <TabsTrigger value="ebitda">EBITDA Impact</TabsTrigger>
          </TabsList>

          {/* Benchmark Tab */}
          <TabsContent
            value="benchmark"
            forceMount
            className="space-y-4 data-[state=inactive]:hidden"
          >
            <ProfitBenchmarkPanel onProfitSummaryChange={setProfitSummary} />
          </TabsContent>

          {/* P&L Period Comparison Tab */}
          <TabsContent value="pl-period" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>P&L: Current Period vs Prior Period</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Current {format(globalDateRange.startDate, "dd MMM yyyy")} –{" "}
                  {format(globalDateRange.endDate, "dd MMM yyyy")} vs prior{" "}
                  {pnl.priorLabel}. Revenue = Profit Benchmark Production Income
                  (Private + Membership + NHS). Net Profit = Revenue − mapped
                  Clinician, Staff, Lab & Materials, and Overhead costs.
                </p>
              </CardHeader>
              <CardContent>
                {pnl.isLoading ? (
                  <div className="space-y-3 py-6">
                    <Skeleton className="h-[280px] w-full" />
                    <Skeleton className="h-40 w-full" />
                  </div>
                ) : !pnl.hasData ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No Profit Benchmark data for this location and period.
                  </p>
                ) : (
                  <>
                    <div className="h-[350px] mb-6">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={plComparisonData} margin={{ left: 20 }}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                          />
                          <XAxis
                            dataKey="category"
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                          />
                          <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                            tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                          />
                          <Tooltip
                            formatter={(
                              value: number,
                              seriesName: string,
                              item,
                            ) => {
                              const category = String(
                                (item as { payload?: { category?: string } })
                                  ?.payload?.category ?? "",
                              );
                              const n = Number(value) || 0;
                              const display =
                                category === "Net Profit" ||
                                category === "Revenue"
                                  ? formatCurrency(n)
                                  : formatCurrency(Math.abs(n));
                              return [display, seriesName];
                            }}
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                            }}
                          />
                          <Legend />
                          <Bar
                            dataKey="current"
                            name="Current Period"
                            fill="hsl(var(--primary))"
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            dataKey="prior"
                            name="Prior Period"
                            fill="hsl(var(--chart-2))"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                              Category
                            </th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                              Current Period
                            </th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                              Prior Period
                            </th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                              Variance (£)
                            </th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                              Variance (%)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {plComparisonData.map((row) => {
                            const isFavourable = row.isIncomeLike
                              ? row.variance > 0
                              : row.variance < 0;
                            return (
                              <tr
                                key={row.category}
                                className={`border-b border-border/50 hover:bg-muted/30 ${row.category === "Net Profit" ? "font-semibold bg-muted/20" : ""}`}
                              >
                                <td className="py-3 px-4">{row.category}</td>
                                <td className="text-right py-3 px-4">
                                  {formatCurrency(
                                    row.isIncomeLike
                                      ? row.current
                                      : Math.abs(row.current),
                                  )}
                                </td>
                                <td className="text-right py-3 px-4 text-muted-foreground">
                                  {formatCurrency(
                                    row.isIncomeLike
                                      ? row.prior
                                      : Math.abs(row.prior),
                                  )}
                                </td>
                                <td
                                  className={`text-right py-3 px-4 ${isFavourable ? "text-success" : "text-danger"}`}
                                >
                                  {formatCurrency(row.variance)}
                                </td>
                                <td
                                  className={`text-right py-3 px-4 ${isFavourable ? "text-success" : "text-danger"}`}
                                >
                                  {formatPercentDisplay(row.variancePct, 1)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* P&L vs Group Tab */}
          <TabsContent value="pl-group" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Entity Performance vs Group</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Selected location vs all locations for{" "}
                  {format(globalDateRange.startDate, "dd MMM yyyy")} –{" "}
                  {format(globalDateRange.endDate, "dd MMM yyyy")}. Margins and
                  cost ratios use Profit Benchmark production income.
                </p>
              </CardHeader>
              <CardContent>
                {pnl.isLoading ? (
                  <div className="space-y-3 py-6">
                    <Skeleton className="h-[280px] w-full" />
                    <Skeleton className="h-40 w-full" />
                  </div>
                ) : !pnl.hasData ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No Profit Benchmark data for this location and period.
                  </p>
                ) : (
                  <>
                    <div className="h-[350px] mb-6">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={entityVsGroupData}
                          margin={{ left: 20 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                          />
                          <XAxis
                            dataKey="category"
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                          />
                          <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                            }}
                          />
                          <Legend />
                          <Bar
                            dataKey="entity"
                            name="Current Entity"
                            fill="hsl(var(--primary))"
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            dataKey="group"
                            name="Group Average"
                            fill="hsl(var(--chart-3))"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card className="bg-muted/30">
                        <CardContent className="pt-4">
                          <h4 className="font-medium mb-3">
                            Entity Contribution to Group
                          </h4>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Revenue Share
                              </span>
                              <span className="font-medium">
                                {formatPercentDisplay(
                                  pnl.contribution.revenueShare,
                                  1,
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Profit Share
                              </span>
                              <span className="font-medium">
                                {formatPercentDisplay(
                                  pnl.contribution.profitShare,
                                  1,
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                EBITDA Share
                              </span>
                              <span className="font-medium">
                                {formatPercentDisplay(
                                  pnl.contribution.ebitdaShare,
                                  1,
                                )}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="bg-muted/30">
                        <CardContent className="pt-4">
                          <h4 className="font-medium mb-3">
                            Performance vs Group
                          </h4>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                EBITDA Margin
                              </span>
                              <span
                                className={`font-medium ${pnl.vsGroup.ebitdaMarginPp >= 0 ? "text-success" : "text-danger"}`}
                              >
                                {pnl.vsGroup.ebitdaMarginPp > 0 ? "+" : ""}
                                {pnl.vsGroup.ebitdaMarginPp.toFixed(1)}pp
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Net Profit Margin
                              </span>
                              <span
                                className={`font-medium ${pnl.vsGroup.netProfitMarginPp >= 0 ? "text-success" : "text-danger"}`}
                              >
                                {pnl.vsGroup.netProfitMarginPp > 0 ? "+" : ""}
                                {pnl.vsGroup.netProfitMarginPp.toFixed(1)}pp
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Cost Efficiency
                              </span>
                              <span
                                className={`font-medium ${pnl.vsGroup.costEfficiencyPp >= 0 ? "text-success" : "text-danger"}`}
                              >
                                {pnl.vsGroup.costEfficiencyPp > 0 ? "+" : ""}
                                {pnl.vsGroup.costEfficiencyPp.toFixed(1)}pp
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* EBITDA Impact Tab */}
          <TabsContent value="ebitda" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Net Profit to EBITDA Bridge</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Add-backs from mapped Chart of Accounts (Setup Categories →
                    EBITDA) for{" "}
                    {format(globalDateRange.startDate, "dd MMM yyyy")} –{" "}
                    {format(globalDateRange.endDate, "dd MMM yyyy")}.
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/settings/setup-categories" className="gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" />
                    EBITDA settings
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {ebitdaBridgeLoading ? (
                  <div className="space-y-3 py-6">
                    <Skeleton className="h-[280px] w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : (
                  <>
                    {!ebitdaBridge?.hasAnyMapping && (
                      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        No Depreciation / Amortisation / Interest / Tax accounts
                        mapped for this location yet. Map them under{" "}
                        <Link
                          to="/settings/setup-categories"
                          className="font-medium underline"
                        >
                          Setup Categories → EBITDA
                        </Link>{" "}
                        to populate the bridge from your accounting app.
                      </div>
                    )}
                    <div className="h-[400px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={ebitdaBridgeData}
                          margin={{ left: 20 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                          />
                          <XAxis
                            dataKey="name"
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                          />
                          <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                            tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                          />
                          <Tooltip
                            formatter={(value: number) => formatCurrency(value)}
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                            }}
                          />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {ebitdaBridgeData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="mt-6 overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                              Component
                            </th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                              Amount
                            </th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                              % of EBITDA
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {ebitdaBridgeData.map((row) => (
                            <tr
                              key={row.name}
                              className={`border-b border-border/50 hover:bg-muted/30 ${row.isTotal ? "font-semibold bg-muted/20" : ""}`}
                            >
                              <td className="py-3 px-4">{row.name}</td>
                              <td className="text-right py-3 px-4">
                                {formatCurrency(row.value)}
                              </td>
                              <td className="text-right py-3 px-4 text-muted-foreground">
                                {row.isTotal
                                  ? "100%"
                                  : ebitdaTotal != null && ebitdaTotal !== 0
                                    ? `${((row.value / ebitdaTotal) * 100).toFixed(1)}%`
                                    : "—"}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-b border-border/50 hover:bg-muted/30">
                            <td className="py-3 px-4">
                              × Final Multiple
                              <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                                From EBITDA to value → Valuation Multiple
                              </span>
                            </td>
                            <td className="text-right py-3 px-4 tabular-nums">
                              {ebitdaValuationLoading
                                ? "…"
                                : finalMultiple != null
                                  ? `${finalMultiple.toFixed(1)}×`
                                  : "—"}
                            </td>
                            <td className="text-right py-3 px-4 text-muted-foreground">
                              —
                            </td>
                          </tr>
                          <tr className="border-b border-border font-semibold bg-primary/5">
                            <td className="py-3 px-4">
                              = Enterprise Value
                              <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                                EBITDA × Final Multiple
                                {equityValueFromBridge != null && netDebt !== 0
                                  ? ` · equity ${formatCurrency(equityValueFromBridge)} after net debt`
                                  : ""}
                              </span>
                            </td>
                            <td className="text-right py-3 px-4 tabular-nums text-primary">
                              {ebitdaValuationLoading
                                ? "…"
                                : enterpriseValueFromBridge != null
                                  ? formatCurrency(enterpriseValueFromBridge)
                                  : "—"}
                            </td>
                            <td className="text-right py-3 px-4 text-muted-foreground">
                              —
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-6 p-4 bg-muted/30 rounded-lg">
                      <h4 className="font-medium mb-2">Key Insights</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>
                          • Net Profit represents{" "}
                          {ebitdaTotal != null && ebitdaTotal !== 0
                            ? `${((netProfitForBridge / ebitdaTotal) * 100).toFixed(1)}%`
                            : "—"}{" "}
                          of EBITDA
                        </li>
                        {largestAddBack && largestAddBack.value > 0 ? (
                          <li>
                            • {largestAddBack.name.replace(/^\+ /, "")} is the
                            largest add-back at{" "}
                            {formatCurrency(largestAddBack.value)}
                            {ebitdaTotal != null && ebitdaTotal !== 0
                              ? ` (${((largestAddBack.value / ebitdaTotal) * 100).toFixed(1)}% of EBITDA)`
                              : ""}
                          </li>
                        ) : (
                          <li>
                            • No add-backs yet — map accounts in Setup
                            Categories → EBITDA
                          </li>
                        )}
                        <li>
                          • Total adjustments from Net Profit to EBITDA:{" "}
                          {formatCurrency(ebitdaBridge?.totalAddBacks ?? 0)}
                        </li>
                        {enterpriseValueFromBridge != null &&
                          finalMultiple != null &&
                          ebitdaTotal != null && (
                            <li>
                              • Enterprise Value: {formatCurrency(ebitdaTotal)}{" "}
                              EBITDA × {finalMultiple.toFixed(1)}× ={" "}
                              {formatCurrency(enterpriseValueFromBridge)}
                            </li>
                          )}
                      </ul>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
