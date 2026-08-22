import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { MainLayout } from "@/components/layout/MainLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTreatmentProfitPlanning } from "@/hooks/useTreatmentProfitPlanning";
import { ProfitPlanningByTreatmentPanel } from "./ProfitPlanningByTreatmentPanel";
import {
  AllTreatmentsProfitabilityTab,
  type TreatmentProfitabilitySnapshot,
} from "@/components/treatments/AllTreatmentsProfitabilityTab";
import { useFilters } from "@/contexts/FilterContext";
import { useLocations } from "@/hooks/useLocations";
import { cn } from "@/lib/utils";
import {
  Stethoscope,
  Banknote,
  TrendingUp,
  Target,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { formatCurrency as formatCurrencyBase } from "@/lib/currency";

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export default function ProfitByTreatments() {
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = (value: number) => formatCurrencyBase(value, showDecimals);
  // Summary-card numbers always show whole pounds, regardless of the Show Decimals setting.
  const formatCurrencyWhole = (value: number) => formatCurrencyBase(value, false);
  const [searchParams, setSearchParams] = useSearchParams();
  const viewFromUrl = searchParams.get("view");
  const [view, setView] = useState<"actual" | "planning">(
    viewFromUrl === "planning" ? "planning" : "actual",
  );
  const handleViewChange = (next: string) => {
    setView(next as "actual" | "planning");
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("view", next);
        return params;
      },
      { replace: true },
    );
  };

  const { planningData, isLoading } = useTreatmentProfitPlanning();
  const [isProfitabilityFilterOpen, setIsProfitabilityFilterOpen] =
    useState(false);
  const [profitabilitySnapshot, setProfitabilitySnapshot] =
    useState<TreatmentProfitabilitySnapshot | null>(null);
  const { selectedLocationId, selectedRegionId } = useFilters();
  const { allAvailableLocations } = useLocations();

  // Chatbot context for the Treatment Profitability Details table — ported
  // unchanged from the retired /treatments/profitability page so the bot keeps
  // mirroring the visible dataset.
  const aiContextData = useMemo(() => {
    if (!profitabilitySnapshot) return { page: "treatment-profitability" };

    const selectedLocationName = selectedLocationId
      ? (allAvailableLocations.find((l) => l.id === selectedLocationId)
          ?.location_name ?? null)
      : "All Locations";

    // Compact row shape — keep only what the LLM needs to answer
    // "which treatments are loss-making / lowest margin / highest cost ratio".
    // Sum the cost columns so the bot doesn't have to reconstruct totals.
    const compact = profitabilitySnapshot.rows.map((r) => {
      const totalCostPerUnit =
        r.materialCost +
        r.labBill +
        r.therapistPayRate +
        r.opCostPerTreatment +
        r.associatePay +
        r.financeFee;
      return {
        name: r.treatmentName,
        category: r.category,
        avgIncome: round2(r.avgIncome),
        materialCost: round2(r.materialCost),
        labBill: round2(r.labBill),
        therapistPay: round2(r.therapistPayRate),
        opCost: round2(r.opCostPerTreatment),
        associatePay: round2(r.associatePay),
        financeFee: round2(r.financeFee),
        totalCostPerUnit: round2(totalCostPerUnit),
        profitPerUnit: round2(r.profitLossPerUnit),
        marginPercent:
          r.avgIncome > 0
            ? round2((r.profitLossPerUnit / r.avgIncome) * 100)
            : null,
        unitsSold: r.noItems,
        totalIncome: round2(r.totalIncome),
        totalExpense: round2(r.totalExpense),
        totalProfitLoss: round2(r.totalPL),
        profitLossPercent: round2(r.plPercent),
      };
    });

    // Pre-computed rankings so the bot can answer without re-sorting.
    const sortedByProfit = [...compact].sort(
      (a, b) => a.totalProfitLoss - b.totalProfitLoss,
    );
    const lossMaking = sortedByProfit.filter((t) => t.totalProfitLoss < 0);
    const sortedByMargin = [...compact]
      .filter((t) => t.marginPercent !== null)
      .sort((a, b) => (a.marginPercent ?? 0) - (b.marginPercent ?? 0));

    // Cap the full list at 60 rows by absolute |profitLoss| so the most
    // material rows are always present even if there's a long tail.
    const top60ByImpact = [...compact]
      .sort((a, b) => Math.abs(b.totalProfitLoss) - Math.abs(a.totalProfitLoss))
      .slice(0, 60);

    return {
      page: "treatment-profitability",
      selectedLocationId: selectedLocationId || null,
      selectedLocationName,
      selectedRegionId: selectedRegionId || null,
      period: profitabilitySnapshot.period,
      totals: profitabilitySnapshot.totals,
      treatments: top60ByImpact,
      lossMaking: lossMaking.slice(0, 20),
      lowestMargin: sortedByMargin.slice(0, 10),
      highestMargin: [...sortedByMargin].reverse().slice(0, 10),
      rowCount: profitabilitySnapshot.rows.length,
      note: "treatments[] is capped at 60 by absolute profit impact. Use lossMaking/lowestMargin/highestMargin for ranked answers.",
    };
  }, [
    profitabilitySnapshot,
    selectedLocationId,
    selectedRegionId,
    allAvailableLocations,
  ]);

  const treatmentSummary = useMemo(() => {
    const activeTreatments = planningData.filter(
      (t) => t.currentVolume > 0,
    ).length;
    const totalRevenue = planningData.reduce(
      (sum, t) => sum + t.currentRevenue,
      0,
    );
    const totalProfitLoss = planningData.reduce(
      (sum, t) => sum + t.totalProfitLoss,
      0,
    );
    const avgPlMargin =
      totalRevenue !== 0 ? (totalProfitLoss / totalRevenue) * 100 : 0;
    return { activeTreatments, totalRevenue, totalProfitLoss, avgPlMargin };
  }, [planningData]);

  const categoryProfitData = useMemo(() => {
    const categoryTotals = new Map<
      string,
      { revenue: number; profit: number }
    >();
    planningData.forEach((treatment) => {
      const category = treatment.categoryName || "Uncategorized";
      const existing = categoryTotals.get(category) || {
        revenue: 0,
        profit: 0,
      };
      existing.revenue += treatment.currentRevenue;
      existing.profit += treatment.totalProfitLoss;
      categoryTotals.set(category, existing);
    });
    return Array.from(categoryTotals.entries())
      .map(([category, totals]) => ({
        category,
        revenue: totals.revenue,
        profit: totals.profit,
      }))
      .filter((d) => d.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [planningData]);

  const topTreatmentsByProfit = useMemo(() => {
    return [...planningData]
      .filter((t) => t.currentVolume > 0)
      .sort((a, b) => b.totalProfitLoss - a.totalProfitLoss)
      .slice(0, 5)
      .map((t) => ({
        treatment:
          t.treatmentName.length > 20
            ? t.treatmentName.substring(0, 20) + "..."
            : t.treatmentName,
        profit: t.totalProfitLoss,
      }));
  }, [planningData]);

  const topTreatmentPlPercent = useMemo(() => {
    const m = new Map<string, { fullName: string; plPercent: number }>();
    planningData
      .filter((t) => t.currentVolume > 0)
      .sort((a, b) => b.totalProfitLoss - a.totalProfitLoss)
      .slice(0, 5)
      .forEach((t) => {
        const key =
          t.treatmentName.length > 20
            ? t.treatmentName.substring(0, 20) + "..."
            : t.treatmentName;
        m.set(key, { fullName: t.treatmentName, plPercent: t.plPercent });
      });
    return m;
  }, [planningData]);

  return (
    <MainLayout aiContext={aiContextData}>
      <Helmet>
        <title>Profit by Treatments</title>
        <meta
          name="description"
          content="Analyse treatment profitability by category, volume, and margin."
        />
      </Helmet>

      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Profit by Treatments
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Treatment profitability by category, volume, and margin
          </p>
        </div>

        <Tabs value={view} onValueChange={handleViewChange} className="w-full">
          <TabsList className="w-full max-w-sm bg-muted/50 p-1 h-11">
            <TabsTrigger
              value="actual"
              className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Actual Vs Target
            </TabsTrigger>
            <TabsTrigger
              value="planning"
              className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Planning
            </TabsTrigger>
          </TabsList>

          <TabsContent value="actual" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Stethoscope className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Active Treatments
                  </p>
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <p className="text-2xl font-semibold">
                    {treatmentSummary.activeTreatments}
                  </p>
                )}
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Banknote className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Total Revenue</p>
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-28" />
                ) : (
                  <p className="text-2xl font-semibold">
                    {formatCurrencyWhole(treatmentSummary.totalRevenue)}
                  </p>
                )}
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Total Profit/Loss
                  </p>
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-28" />
                ) : (
                  <p
                    className={cn(
                      "text-2xl font-semibold",
                      treatmentSummary.totalProfitLoss >= 0
                        ? "text-success"
                        : "text-destructive",
                    )}
                  >
                    {formatCurrencyWhole(treatmentSummary.totalProfitLoss)}
                  </p>
                )}
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Avg P/L Margin
                  </p>
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <p
                    className={cn(
                      "text-2xl font-semibold",
                      treatmentSummary.avgPlMargin >= 0
                        ? "text-success"
                        : "text-destructive",
                    )}
                  >
                    {Math.round(treatmentSummary.avgPlMargin)}%
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-medium mb-4">
                  Revenue vs Profit by Category
                </h3>
                <div className="h-64">
                  {isLoading ? (
                    <Skeleton className="h-full w-full rounded-lg" />
                  ) : categoryProfitData.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-muted-foreground">
                        No data available
                      </p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categoryProfitData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis
                          dataKey="category"
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                        />
                        <YAxis
                          tick={{ fontSize: 12 }}
                          stroke="hsl(var(--muted-foreground))"
                          tickFormatter={(v) => formatCurrency(v)}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number, name: string) => [
                            <span
                              style={{
                                color:
                                  value < 0
                                    ? "hsl(var(--destructive))"
                                    : undefined,
                              }}
                            >
                              {formatCurrency(value)}
                            </span>,
                            name,
                          ]}
                        />
                        <Legend />
                        <Bar
                          dataKey="revenue"
                          name="Revenue"
                          fill="hsl(var(--muted-foreground) / 0.4)"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="profit"
                          name="Profit"
                          fill="hsl(var(--success))"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-medium mb-4">
                  Top Treatments by Profit
                </h3>
                <div className="h-64">
                  {isLoading ? (
                    <Skeleton className="h-full w-full rounded-lg" />
                  ) : topTreatmentsByProfit.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-muted-foreground">
                        No data available
                      </p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topTreatmentsByProfit} layout="vertical">
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 12 }}
                          stroke="hsl(var(--muted-foreground))"
                          tickFormatter={(v) => formatCurrency(v)}
                        />
                        <YAxis
                          dataKey="treatment"
                          type="category"
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                          width={120}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const data = payload[0]?.payload;
                            if (!data) return null;
                            const info = topTreatmentPlPercent.get(
                              data.treatment,
                            );
                            const pct = info?.plPercent ?? 0;
                            return (
                              <div
                                style={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "8px",
                                  padding: "8px 12px",
                                }}
                              >
                                <p style={{ fontWeight: 500, marginBottom: 4 }}>
                                  {info?.fullName || data.treatment}
                                </p>
                                <p
                                  style={{
                                    color:
                                      pct < 0
                                        ? "hsl(var(--destructive))"
                                        : "hsl(var(--success))",
                                  }}
                                >
                                  P/L % : {pct.toFixed(1)}%
                                </p>
                              </div>
                            );
                          }}
                        />
                        <Legend />
                        <Bar
                          dataKey="profit"
                          name="Profit"
                          fill="hsl(var(--success))"
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border">
              <div className="p-5 border-b border-border flex items-center justify-between gap-4">
                <h3 className="text-sm font-medium">
                  Treatment Profitability Details
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setIsProfitabilityFilterOpen(true)}
                >
                  <Filter className="w-4 h-4" />
                  Filters
                </Button>
              </div>
              <div className="p-5">
                <AllTreatmentsProfitabilityTab
                  standalone
                  externalFilterOpen={isProfitabilityFilterOpen}
                  onExternalFilterClose={() =>
                    setIsProfitabilityFilterOpen(false)
                  }
                  onDataChange={setProfitabilitySnapshot}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="planning" className="mt-6">
            <ProfitPlanningByTreatmentPanel />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
