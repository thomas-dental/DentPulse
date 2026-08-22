import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { MainLayout } from "@/components/layout/MainLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendIndicator } from "@/components/dashboard/TrendIndicator";
import { useAssociateProfitPlanning } from "@/hooks/useAssociateProfitPlanning";
import { PractitionerHistoryPanel } from "./PractitionerHistoryPanel";
import { EditColumnsPopover } from "@/components/providers/EditColumnsPopover";
import { cn } from "@/lib/utils";
import { Users, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { usePlanAccess } from "@/hooks/usePlanAccess";
import { formatCurrency as formatCurrencyBase } from "@/lib/currency";

export default function ProfitByAssociates() {
  const { planTier } = usePlanAccess();
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = (value: number) =>
    formatCurrencyBase(value, showDecimals);
  // Summary-card numbers always show whole pounds, regardless of the Show Decimals setting.
  const formatCurrencyWhole = (value: number) =>
    formatCurrencyBase(value, false);
  const [searchParams, setSearchParams] = useSearchParams();
  const viewFromUrl = searchParams.get("view");
  const [view, setView] = useState<"history" | "actual">(
    viewFromUrl === "actual" ? "actual" : "history",
  );
  const handleViewChange = (next: string) => {
    setView(next as "history" | "actual");
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("view", next);
        return params;
      },
      { replace: true },
    );
  };

  const { associateData, monthlyTrends, isLoading } =
    useAssociateProfitPlanning();
  const [sortState, setSortState] = useState<{
    column: string;
    direction: "asc" | "desc";
  } | null>(null);

  const ASSOCIATE_TABLE_COLUMNS = [
    { id: "role", label: "Role" },
    { id: "currentRevenue", label: "Current Revenue" },
    { id: "plannedRevenue", label: "Target Revenue" },
    { id: "currentCost", label: "Current Cost" },
    { id: "plannedCost", label: "Target Cost" },
    { id: "currentProfit", label: "Current Profit" },
    { id: "plannedProfit", label: "Target Profit" },
    { id: "growth", label: "Growth" },
  ];
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    Object.fromEntries(ASSOCIATE_TABLE_COLUMNS.map((c) => [c.id, true])),
  );
  const handleColumnToggle = (columnId: string) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [columnId]: !(prev[columnId] ?? true),
    }));
  };

  const { totalCurrentProfit, totalPlannedProfit, profitGrowth } =
    useMemo(() => {
      const tcp = associateData.reduce((sum, a) => sum + a.currentProfit, 0);
      const tpp = associateData.reduce((sum, a) => sum + a.plannedProfit, 0);
      const growth =
        tcp !== 0 ? String(Math.round((tpp / tcp - 1) * 100)) : "0";
      return {
        totalCurrentProfit: tcp,
        totalPlannedProfit: tpp,
        profitGrowth: growth,
      };
    }, [associateData]);

  const sortedAssociateData = useMemo(() => {
    const filtered = associateData.filter((a) => a.currentRevenue > 0);
    if (!sortState) return filtered;
    return [...filtered].sort((a, b) => {
      const col = sortState.column;
      let aVal: number | string;
      let bVal: number | string;
      if (col === "name" || col === "role") {
        aVal = (a as any)[col] || "";
        bVal = (b as any)[col] || "";
      } else if (col === "growth") {
        aVal =
          a.currentProfit !== 0
            ? (a.plannedProfit / a.currentProfit - 1) * 100
            : 0;
        bVal =
          b.currentProfit !== 0
            ? (b.plannedProfit / b.currentProfit - 1) * 100
            : 0;
      } else {
        aVal = (a as any)[col] ?? 0;
        bVal = (b as any)[col] ?? 0;
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortState.direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortState.direction === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [associateData, sortState]);

  const handleSort = (column: string) => {
    setSortState((prev) => {
      if (!prev || prev.column !== column) return { column, direction: "desc" };
      if (prev.direction === "desc") return { column, direction: "asc" };
      return null;
    });
  };

  const getSortIcon = (column: string) => {
    if (!sortState || sortState.column !== column)
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />;
    if (sortState.direction === "desc")
      return <ArrowDown className="w-3.5 h-3.5" />;
    return <ArrowUp className="w-3.5 h-3.5" />;
  };

  const SortableTh = ({
    column,
    children,
    className = "",
  }: {
    column: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th
      className={cn(
        "cursor-pointer select-none hover:text-foreground",
        className,
      )}
      onClick={() => handleSort(column)}
    >
      <div className="flex items-center gap-1 justify-center">
        {children}
        {getSortIcon(column)}
      </div>
    </th>
  );

  return (
    <MainLayout locked={planTier === "basic"}>
      <Helmet>
        <title>Insights</title>
        <meta
          name="description"
          content="Compare current vs planned profit by associate across your practice providers."
        />
      </Helmet>

      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Insights</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Current vs planned profit performance by provider
          </p>
        </div>

        <Tabs value={view} onValueChange={handleViewChange} className="w-full">
          <TabsList className="w-full max-w-sm bg-muted/50 p-1 h-11">
            <TabsTrigger
              value="history"
              className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Provider History
            </TabsTrigger>
            <TabsTrigger
              value="actual"
              className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Actual vs Target
            </TabsTrigger>
          </TabsList>

          <TabsContent value="history" className="mt-6">
            <PractitionerHistoryPanel />
          </TabsContent>

          <TabsContent value="actual" className="mt-6 space-y-6">
            {isLoading ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="bg-card rounded-xl border border-border p-5"
                    >
                      <Skeleton className="h-4 w-28 mb-2" />
                      <Skeleton className="h-8 w-32" />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-card rounded-xl border border-border p-5">
                    <Skeleton className="h-4 w-52 mb-4" />
                    <Skeleton className="h-80 w-full rounded-lg" />
                  </div>
                  <div className="bg-card rounded-xl border border-border p-5">
                    <Skeleton className="h-4 w-40 mb-4" />
                    <Skeleton className="h-80 w-full rounded-lg" />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-card rounded-xl border border-border p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Total Providers
                      </p>
                    </div>
                    <p className="text-2xl font-semibold">
                      {associateData.filter((a) => a.currentRevenue > 0).length}
                    </p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-5">
                    <p className="text-sm text-muted-foreground mb-1">
                      Current Monthly Profit
                    </p>
                    <p className="text-2xl font-semibold">
                      {formatCurrencyWhole(totalCurrentProfit)}
                    </p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-5">
                    <p className="text-sm text-muted-foreground mb-1">
                      Target Monthly Profit
                    </p>
                    <p className="text-2xl font-semibold text-success">
                      {formatCurrencyWhole(totalPlannedProfit)}
                    </p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-5">
                    <p className="text-sm text-muted-foreground mb-1">
                      Profit Growth Target
                    </p>
                    <p
                      className={cn(
                        "text-2xl font-semibold",
                        Number(profitGrowth) >= 0
                          ? "text-success"
                          : "text-destructive",
                      )}
                    >
                      {Number(profitGrowth) >= 0 ? "+" : ""}
                      {profitGrowth}%
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-card rounded-xl border border-border p-5">
                    <h3 className="text-sm font-medium mb-4">
                      Profit by Associate - Current vs Planned
                    </h3>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={associateData
                            .filter((a) => a.currentRevenue > 0)
                            .slice(0, 15)}
                          layout="vertical"
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                          />
                          <XAxis
                            type="number"
                            tick={{ fontSize: 12 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickFormatter={(v) => `£${(v / 1000).toFixed(0)}K`}
                          />
                          <YAxis
                            dataKey="name"
                            type="category"
                            tick={{ fontSize: 11 }}
                            stroke="hsl(var(--muted-foreground))"
                            width={120}
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
                            dataKey="currentProfit"
                            name="Current Profit"
                            fill="hsl(var(--muted-foreground) / 0.4)"
                            radius={[0, 4, 4, 0]}
                          />
                          <Bar
                            dataKey="plannedProfit"
                            name="Planned Profit"
                            fill="hsl(var(--success))"
                            radius={[0, 4, 4, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-card rounded-xl border border-border p-5">
                    <h3 className="text-sm font-medium mb-4">
                      Monthly Profit Trend - Actual vs Target
                    </h3>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={monthlyTrends}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                          />
                          <XAxis
                            dataKey="month"
                            tick={{ fontSize: 12 }}
                            stroke="hsl(var(--muted-foreground))"
                          />
                          <YAxis
                            tick={{ fontSize: 12 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickFormatter={(v) => `£${(v / 1000).toFixed(0)}K`}
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
                          <Line
                            type="monotone"
                            dataKey="actual"
                            name="Actual"
                            stroke="hsl(var(--accent))"
                            strokeWidth={2}
                            dot={{ fill: "hsl(var(--accent))" }}
                          />
                          <Line
                            type="monotone"
                            dataKey="planned"
                            name="Target"
                            stroke="hsl(var(--success))"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            dot={{ fill: "hsl(var(--success))" }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="p-5 border-b border-border flex items-center justify-between">
                    <h3 className="text-sm font-medium">
                      Associate Profit Planning Details
                    </h3>
                    <EditColumnsPopover
                      columns={ASSOCIATE_TABLE_COLUMNS}
                      visibleColumns={visibleColumns}
                      onColumnToggle={handleColumnToggle}
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr className="bg-muted/50">
                          <SortableTh column="name" className="text-center">
                            Associate
                          </SortableTh>
                          {visibleColumns.role && (
                            <SortableTh column="role" className="text-center">
                              Role
                            </SortableTh>
                          )}
                          {visibleColumns.currentRevenue && (
                            <SortableTh
                              column="currentRevenue"
                              className="text-center"
                            >
                              Current Revenue
                            </SortableTh>
                          )}
                          {visibleColumns.plannedRevenue && (
                            <SortableTh
                              column="plannedRevenue"
                              className="text-center"
                            >
                              Target Revenue
                            </SortableTh>
                          )}
                          {visibleColumns.currentCost && (
                            <SortableTh
                              column="currentCost"
                              className="text-center"
                            >
                              Current Cost
                            </SortableTh>
                          )}
                          {visibleColumns.plannedCost && (
                            <SortableTh
                              column="plannedCost"
                              className="text-center"
                            >
                              Target Cost
                            </SortableTh>
                          )}
                          {visibleColumns.currentProfit && (
                            <SortableTh
                              column="currentProfit"
                              className="text-center"
                            >
                              Current Profit
                            </SortableTh>
                          )}
                          {visibleColumns.plannedProfit && (
                            <SortableTh
                              column="plannedProfit"
                              className="text-center"
                            >
                              Target Profit
                            </SortableTh>
                          )}
                          {visibleColumns.growth && (
                            <SortableTh column="growth" className="text-center">
                              Growth
                            </SortableTh>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAssociateData.map((associate) => {
                          const growth =
                            associate.currentProfit !== 0
                              ? (
                                  (associate.plannedProfit /
                                    associate.currentProfit -
                                    1) *
                                  100
                                ).toFixed(1)
                              : "0.0";
                          return (
                            <tr key={associate.id}>
                              <td className="font-medium">{associate.name}</td>
                              {visibleColumns.role && (
                                <td className="text-muted-foreground">
                                  {associate.role}
                                </td>
                              )}
                              {visibleColumns.currentRevenue && (
                                <td
                                  className={cn(
                                    "text-center",
                                    associate.currentRevenue < 0 &&
                                      "text-destructive",
                                  )}
                                >
                                  {formatCurrency(associate.currentRevenue)}
                                </td>
                              )}
                              {visibleColumns.plannedRevenue && (
                                <td
                                  className={cn(
                                    "text-center",
                                    associate.plannedRevenue < 0 &&
                                      "text-destructive",
                                  )}
                                >
                                  {formatCurrency(associate.plannedRevenue)}
                                </td>
                              )}
                              {visibleColumns.currentCost && (
                                <td
                                  className={cn(
                                    "text-center",
                                    associate.currentCost < 0 &&
                                      "text-destructive",
                                  )}
                                >
                                  {formatCurrency(associate.currentCost)}
                                </td>
                              )}
                              {visibleColumns.plannedCost && (
                                <td
                                  className={cn(
                                    "text-center",
                                    associate.plannedCost < 0 &&
                                      "text-destructive",
                                  )}
                                >
                                  {formatCurrency(associate.plannedCost)}
                                </td>
                              )}
                              {visibleColumns.currentProfit && (
                                <td
                                  className={cn(
                                    "text-center font-medium",
                                    associate.currentProfit >= 0
                                      ? "text-success"
                                      : "text-destructive",
                                  )}
                                >
                                  {formatCurrency(associate.currentProfit)}
                                </td>
                              )}
                              {visibleColumns.plannedProfit && (
                                <td
                                  className={cn(
                                    "text-center font-medium",
                                    associate.plannedProfit >= 0
                                      ? "text-success"
                                      : "text-destructive",
                                  )}
                                >
                                  {formatCurrency(associate.plannedProfit)}
                                </td>
                              )}
                              {visibleColumns.growth && (
                                <td className="text-center">
                                  <TrendIndicator value={parseFloat(growth)} />
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 font-semibold">
                          <td colSpan={visibleColumns.role ? 2 : 1}>Total</td>
                          {visibleColumns.currentRevenue && (
                            <td className="text-center">
                              {formatCurrency(
                                associateData.reduce(
                                  (s, a) => s + a.currentRevenue,
                                  0,
                                ),
                              )}
                            </td>
                          )}
                          {visibleColumns.plannedRevenue && (
                            <td className="text-center">
                              {formatCurrency(
                                associateData.reduce(
                                  (s, a) => s + a.plannedRevenue,
                                  0,
                                ),
                              )}
                            </td>
                          )}
                          {visibleColumns.currentCost && (
                            <td className="text-center">
                              {formatCurrency(
                                associateData.reduce(
                                  (s, a) => s + a.currentCost,
                                  0,
                                ),
                              )}
                            </td>
                          )}
                          {visibleColumns.plannedCost && (
                            <td className="text-center">
                              {formatCurrency(
                                associateData.reduce(
                                  (s, a) => s + a.plannedCost,
                                  0,
                                ),
                              )}
                            </td>
                          )}
                          {visibleColumns.currentProfit && (
                            <td className="text-center">
                              {formatCurrency(totalCurrentProfit)}
                            </td>
                          )}
                          {visibleColumns.plannedProfit && (
                            <td className="text-center text-success">
                              {formatCurrency(totalPlannedProfit)}
                            </td>
                          )}
                          {visibleColumns.growth && (
                            <td
                              className={cn(
                                "text-center",
                                Number(profitGrowth) >= 0
                                  ? "text-success"
                                  : "text-destructive",
                              )}
                            >
                              {Number(profitGrowth) >= 0 ? "+" : ""}
                              {profitGrowth}%
                            </td>
                          )}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
