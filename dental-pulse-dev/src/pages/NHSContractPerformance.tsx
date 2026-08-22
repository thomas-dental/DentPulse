import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { Calendar, Download, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useNHSContractPerformance,
  type ContractCard,
  type ProviderRow,
  type RiskSignal,
} from "@/hooks/useNHSContractPerformance";
import { useFilters } from "@/contexts/FilterContext";
import { useLocations } from "@/hooks/useLocations";
import { NhsUdaSettingsSection } from "@/components/treatments/NhsUdaSettingsSection";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString("en-GB");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ContractCard["status"] }) {
  const config = {
    Profitable:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    "At Risk":
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    "Loss-Making":
      "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  };
  return (
    <span
      className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
        config[status],
      )}
    >
      {status}
    </span>
  );
}

function DeliveryBar({
  progress,
  status,
  label,
}: {
  progress: number;
  status: string;
  label: string;
}) {
  const barColor =
    status === "on-track"
      ? "bg-emerald-500"
      : status === "behind"
        ? "bg-amber-500"
        : "bg-red-500";
  const textColor =
    status === "on-track"
      ? "text-emerald-600"
      : status === "behind"
        ? "text-amber-600"
        : "text-red-600";
  const dotColor =
    status === "on-track"
      ? "bg-emerald-500"
      : status === "behind"
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>Fee delivery progress</span>
        <span className={cn("flex items-center gap-1 font-medium", textColor)}>
          <span className={cn("w-2 h-2 rounded-full", dotColor)} />
          {label}
        </span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ContractCardComponent({ contract }: { contract: ContractCard }) {
  const borderColor =
    contract.status === "Profitable"
      ? "border-t-emerald-500"
      : contract.status === "At Risk"
        ? "border-t-amber-500"
        : "border-t-red-500";

  return (
    <Card className={cn("border-t-4", borderColor)}>
      <CardContent className="pt-5 pb-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="font-semibold">{contract.name}</span>
          <StatusBadge status={contract.status} />
        </div>

        {/* UDA info */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
            {contract.udaTarget}
          </span>
          <span className="flex items-center gap-1">
            <span>↗</span>
            {contract.udaRate}
          </span>
        </div>

        {/* Value / Avg UDA Rate row */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              Contract Value
            </span>
            <div className="font-bold text-lg">{contract.contractValue}</div>
            <span className="text-xs text-muted-foreground">
              {contract.contractValuePeriod}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              Fee Awarded
            </span>
            <div className="font-bold text-lg">{contract.ytdCosts}</div>
            <span className="text-xs text-muted-foreground">
              {contract.ytdCostsPeriod}
            </span>
          </div>
        </div>

        {/* Total Claims / Delivery row */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              Total Claims
            </span>
            <div className="font-bold text-lg">{contract.ytdProfit}</div>
            <span className="text-xs text-muted-foreground">
              {contract.ytdProfitPct}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              Fee Delivery
            </span>
            <div className="font-bold text-lg">{contract.udaDelivery}</div>
            <span className="text-xs text-muted-foreground">
              {contract.udaDeliveryRatio}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <DeliveryBar
          progress={contract.deliveryProgress}
          status={contract.deliveryStatus}
          label={contract.deliveryLabel}
        />
        <span className="text-xs text-muted-foreground">
          {contract.expectedLabel}
        </span>
      </CardContent>
    </Card>
  );
}

function ProviderStatusBadge({ status }: { status: ProviderRow["status"] }) {
  const config = {
    "On Track": "text-emerald-600 dark:text-emerald-400",
    Behind: "text-amber-600 dark:text-amber-400",
    "At Risk": "text-red-600 dark:text-red-400",
  };
  return (
    <span className={cn("text-sm font-semibold", config[status])}>
      {status}
    </span>
  );
}

function ProviderDeliveryBar({ pct }: { pct: number }) {
  const color =
    pct >= 90
      ? "#10b981"
      : pct >= 75
        ? "#14b8a6"
        : pct >= 60
          ? "#f59e0b"
          : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-sm font-semibold" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

function RiskSignalCard({ signal }: { signal: RiskSignal }) {
  const isCritical = signal.severity === "Critical";
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        isCritical
          ? "border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800"
          : "border-border",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle
          className={cn(
            "w-4 h-4",
            isCritical ? "text-red-500" : "text-amber-500",
          )}
        />
        <span className="font-semibold">{signal.title}</span>
        {isCritical && (
          <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-semibold">
            Critical
          </span>
        )}
      </div>
      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground ml-6">
        {signal.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg px-3 py-2 shadow-md text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-muted-foreground">
          <span style={{ color: p.color }} className="font-medium">
            {p.name}:{" "}
          </span>
          {typeof p.value === "number" ? formatNumber(p.value) : "--"}
        </p>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NHSContractPerformance() {
  const [bandFilter, setBandFilter] = useState<string>("all");
  const navigate = useNavigate();

  const {
    financialYear,
    isLoading,
    isScottish,
    hasClaims,
    summaryCards,
    contractCards,
    cumulativeData,
    bandMixData,
    monthlyUDAData,
    bandBreakdown,
    providerPerformance,
    riskSignals,
    contractFilterOptions,
    getBandBreakdownForContract,
  } = useNHSContractPerformance();

  const { selectedLocationId, dateRange } = useFilters();
  const { locations: allLocations } = useLocations();

  const filteredBandBreakdown =
    bandFilter === "all"
      ? bandBreakdown
      : getBandBreakdownForContract(bandFilter);

  // Build AI context — compact rows, top/bottom rankings
  const round2 = (n: number | null | undefined) =>
    n === null || n === undefined
      ? null
      : Math.round((Number(n) || 0) * 100) / 100;
  const selectedLocationName = selectedLocationId
    ? (allLocations.find((l: any) => l.id === selectedLocationId)?.name ??
      "Selected Location")
    : "All Locations";

  const aiContractCards = (contractCards || []).slice(0, 60).map((c) => ({
    name: c.name,
    status: c.status,
    udaTarget: c.udaTarget,
    udaRate: c.udaRate,
    contractValue: c.contractValue,
    feeAwarded: c.ytdCosts,
    totalClaims: c.ytdProfit,
    udaDelivery: c.udaDelivery,
    deliveryProgressPercent: round2(c.deliveryProgress),
    deliveryStatus: c.deliveryStatus,
  }));

  const aiProviderRows = (providerPerformance || []).slice(0, 60).map((p) => ({
    name: p.name,
    role: p.role,
    udasDelivered: p.udasDelivered,
    target: p.target,
    deliveryPercent: round2(p.deliveryPct),
    udasPerSession: p.udasPerSession,
    band1: p.band1,
    band2: p.band2,
    band3: p.band3,
    status: p.status,
  }));

  const topProvidersByDelivery = [...aiProviderRows]
    .sort((a, b) => (b.deliveryPercent ?? 0) - (a.deliveryPercent ?? 0))
    .slice(0, 10);
  const bottomProvidersByDelivery = [...aiProviderRows]
    .sort((a, b) => (a.deliveryPercent ?? 0) - (b.deliveryPercent ?? 0))
    .slice(0, 10);

  const aiBandBreakdown = (bandBreakdown || []).slice(0, 60).map((b) => ({
    band: b.band,
    udaValue: b.udaValue,
    courses: b.courses,
    totalUDAs: b.totalUDAs,
    avgRevenue: b.avgRevenue,
    avgCost: b.avgCost,
    avgTime: b.avgTime,
    benchmark: b.benchmark,
    margin: b.margin,
    marginPositive: b.marginPositive,
  }));

  const aiContextData = {
    page: "nhs-contract-performance",
    selectedLocationName,
    selectedLocationId: selectedLocationId || null,
    period: {
      from: dateRange?.startDate
        ? dateRange.startDate.toISOString().slice(0, 10)
        : null,
      to: dateRange?.endDate
        ? dateRange.endDate.toISOString().slice(0, 10)
        : null,
    },
    financialYearLabel: financialYear?.label ?? null,
    isScottish,
    hasClaims,
    summaryCards: (summaryCards || []).map((s) => ({
      label: s.label,
      value: s.value,
      sub: s.sub,
    })),
    contractCount: contractCards?.length ?? 0,
    contracts: aiContractCards,
    providerCount: providerPerformance?.length ?? 0,
    providers: aiProviderRows,
    topProvidersByDelivery,
    bottomProvidersByDelivery,
    bandBreakdown: aiBandBreakdown,
    riskSignals: (riskSignals || []).slice(0, 20).map((r) => ({
      title: r.title,
      severity: r.severity,
      items: r.items?.slice(0, 10) ?? [],
    })),
  };

  const overviewContent = isLoading ? (
    <div className="flex items-center justify-center h-96">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  ) : !hasClaims ? (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-lg font-semibold text-muted-foreground mb-2">
          No NHS claims found
        </p>
      </CardContent>
    </Card>
  ) : (
    <>
      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {summaryCards.map((card) => {
          const isClaimsCard = card.label === "TOTAL CLAIMS";
          return (
            <Card
              key={card.label}
              className={cn(
                "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800",
                isClaimsCard &&
                  "cursor-pointer transition-shadow hover:shadow-md hover:border-teal-300 dark:hover:border-teal-700",
              )}
              onClick={
                isClaimsCard
                  ? () => navigate("/treatments/nhs/claims")
                  : undefined
              }
              role={isClaimsCard ? "button" : undefined}
              tabIndex={isClaimsCard ? 0 : undefined}
              onKeyDown={
                isClaimsCard
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate("/treatments/nhs/claims");
                      }
                    }
                  : undefined
              }
              title={isClaimsCard ? "View NHS claim details" : undefined}
            >
              <CardContent className="pt-4 pb-3">
                <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                  {card.label}
                </span>
                <div
                  className={cn(
                    "text-2xl font-bold mt-1",
                    card.highlight === "teal"
                      ? "text-teal-600 dark:text-teal-400"
                      : "text-foreground",
                  )}
                >
                  {card.value}
                </div>
                <span className="text-xs text-muted-foreground">
                  {card.sub}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Contract Cards */}
      {contractCards.length > 0 && (
        <div
          className={cn(
            "grid gap-4",
            contractCards.length === 1
              ? "grid-cols-1 max-w-md"
              : contractCards.length === 2
                ? "grid-cols-1 md:grid-cols-2"
                : "grid-cols-1 md:grid-cols-3",
          )}
        >
          {contractCards.map((c) => (
            <ContractCardComponent key={c.name} contract={c} />
          ))}
        </div>
      )}

      {/* Charts Row: Cumulative UDA + Band Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Cumulative UDA Delivery */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">
              {isScottish
                ? "Cumulative Fee Delivery"
                : "Cumulative UDA Delivery"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Target vs delivered over contract year ({financialYear.label})
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={cumulativeData}
                margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tickFormatter={(v: number) =>
                    isScottish
                      ? v >= 1000
                        ? `£${(v / 1000).toFixed(0)}k`
                        : `£${v}`
                      : v >= 1000
                        ? `${(v / 1000).toFixed(0)}k`
                        : String(v)
                  }
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                  formatter={(value: string) => (
                    <span className="text-muted-foreground">{value}</span>
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="target"
                  name={
                    isScottish ? "Cumulative Fee Target" : "Cumulative Target"
                  }
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ r: 3, fill: "#94a3b8" }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="delivered"
                  name={
                    isScottish
                      ? "Cumulative Fee Awarded"
                      : "Cumulative Delivered"
                  }
                  stroke="#14b8a6"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#14b8a6" }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Band Mix Donut */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">
              {isScottish ? "Claim Status Mix" : "Band Mix"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {isScottish
                ? "Fee distribution by claim status"
                : "UDA distribution by treatment band"}
            </p>
          </CardHeader>
          <CardContent>
            {bandMixData.length > 0 ? (
              <>
                <div className="flex justify-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={bandMixData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        nameKey="name"
                        stroke="none"
                      >
                        {bandMixData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => formatNumber(value)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend */}
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {bandMixData.map((b) => (
                    <div key={b.name} className="text-center">
                      <div className="flex items-center justify-center gap-1.5 mb-0.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: b.color }}
                        />
                        <span className="text-sm font-semibold">{b.name}</span>
                      </div>
                      <div className="text-lg font-bold">
                        {formatNumber(b.value)}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {b.courses}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No band data available
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly UDA Delivery */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold">
            {isScottish ? "Monthly Fee Delivery" : "Monthly UDA Delivery"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Month-by-month target vs actual delivery
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={monthlyUDAData}
              margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                fontSize={12}
              />
              <YAxis axisLine={false} tickLine={false} fontSize={12} />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                formatter={(value: string) => (
                  <span className="text-muted-foreground">{value}</span>
                )}
              />
              <Bar
                dataKey="target"
                name={isScottish ? "Monthly Fee Target" : "Monthly Target"}
                fill="#1e3a5f"
                radius={[2, 2, 0, 0]}
                barSize={24}
              />
              <Bar
                dataKey="delivered"
                name={isScottish ? "Fee Expected" : "Delivered"}
                fill="#14b8a6"
                radius={[2, 2, 0, 0]}
                barSize={24}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Band Performance Breakdown */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">
              {isScottish
                ? "Claim Status Breakdown"
                : "Band Performance Breakdown"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {isScottish
                ? "Fee analysis per claim status"
                : "Revenue, cost and time analysis per treatment band"}
            </p>
          </div>
          <Select value={bandFilter} onValueChange={setBandFilter}>
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {contractFilterOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">
                  {isScottish ? "Status" : "Band"}
                </TableHead>
                {!isScottish && <TableHead>UDA Value</TableHead>}
                <TableHead className="text-right">
                  {isScottish ? "Claims" : "Courses"}
                </TableHead>
                <TableHead className="text-right">
                  {isScottish ? "Total Fee" : "Total UDAs"}
                </TableHead>
                <TableHead className="text-right">Avg Revenue</TableHead>
                {!isScottish && (
                  <TableHead className="text-right">Avg Cost</TableHead>
                )}
                {!isScottish && (
                  <TableHead className="text-right">Avg Time</TableHead>
                )}
                {!isScottish && (
                  <TableHead className="text-right">Benchmark</TableHead>
                )}
                {!isScottish && (
                  <TableHead className="text-right pr-6">Margin</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBandBreakdown.length > 0 ? (
                filteredBandBreakdown.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6 font-medium">
                      {row.band}
                    </TableCell>
                    {!isScottish && <TableCell>{row.udaValue}</TableCell>}
                    <TableCell className="text-right">
                      {formatNumber(row.courses)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isScottish
                        ? `£${formatNumber(row.totalUDAs)}`
                        : formatNumber(row.totalUDAs)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.avgRevenue}
                    </TableCell>
                    {!isScottish && (
                      <TableCell className="text-right">
                        {row.avgCost}
                      </TableCell>
                    )}
                    {!isScottish && (
                      <TableCell className="text-right">
                        {row.avgTime}
                      </TableCell>
                    )}
                    {!isScottish && (
                      <TableCell className="text-right">
                        {row.benchmark}
                      </TableCell>
                    )}
                    {!isScottish && (
                      <TableCell className="text-right pr-6">
                        <span
                          className={cn(
                            "inline-flex px-2 py-0.5 rounded text-xs font-semibold",
                            row.marginPositive
                              ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
                          )}
                        >
                          {row.margin}
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={isScottish ? 4 : 9}
                    className="text-center text-muted-foreground py-4"
                  >
                    {isScottish
                      ? "No claim data for this contract"
                      : "No band data for this contract"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Provider UDA Performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold">
            {isScottish
              ? "Provider Fee Performance"
              : "Provider UDA Performance"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isScottish
              ? "Individual clinician fee delivery and claim activity"
              : "Individual clinician delivery rates and band mix"}
          </p>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Provider</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">
                  {isScottish ? "Fee Expected" : "UDAs Delivered"}
                </TableHead>
                <TableHead className="text-right">
                  {isScottish ? "Fee Awarded" : "Target"}
                </TableHead>
                <TableHead>Delivery %</TableHead>
                <TableHead className="text-right">
                  {isScottish ? "Claims" : "UDAs / Session"}
                </TableHead>
                <TableHead className="text-right">
                  {isScottish ? "Claims" : "Band 1"}
                </TableHead>
                <TableHead className="text-right">
                  {isScottish ? "Fee Expected" : "Band 2"}
                </TableHead>
                <TableHead className="text-right">
                  {isScottish ? "Fee Awarded" : "Band 3"}
                </TableHead>
                <TableHead className="text-right pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providerPerformance.length > 0 ? (
                providerPerformance.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="pl-6 font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.role}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {isScottish
                        ? `£${formatNumber(p.udasDelivered)}`
                        : formatNumber(p.udasDelivered)}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.target > 0
                        ? isScottish
                          ? `£${formatNumber(p.target)}`
                          : formatNumber(p.target)
                        : "--"}
                    </TableCell>
                    <TableCell>
                      {p.target > 0 ? (
                        <ProviderDeliveryBar pct={p.deliveryPct} />
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.udasPerSession > 0 ? p.udasPerSession : "--"}
                    </TableCell>
                    <TableCell className="text-right">{p.band1}</TableCell>
                    <TableCell className="text-right">{p.band2}</TableCell>
                    <TableCell className="text-right">{p.band3}</TableCell>
                    <TableCell className="text-right pr-6">
                      <ProviderStatusBadge status={p.status} />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="text-center text-muted-foreground py-4"
                  >
                    No provider data available
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Contract Risk Signals */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Contract Risk Signals</h2>
          <p className="text-sm text-muted-foreground">
            {isScottish
              ? "Automated alerts for low award rates and pending claims"
              : "Automated alerts for clawback risk, margin erosion and under-delivery"}
          </p>
        </div>
        <div className="space-y-3">
          {riskSignals.length > 0 ? (
            riskSignals.map((signal, i) => (
              <RiskSignalCard key={i} signal={signal} />
            ))
          ) : (
            <div className="rounded-lg border border-border p-4 text-center text-muted-foreground">
              No risk signals detected — all contracts appear on track
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>NHS Contract Performance | DentPulse</title>
      </Helmet>

      <div className="space-y-6 pt-6">
        {/* Breadcrumb + Header */}
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <Link to="/treatments/insights" className="hover:text-foreground">
              Treatment
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">NHS</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">NHS Contract Performance</h1>
              <p className="text-muted-foreground">
                {isScottish
                  ? "Contract-wise fee delivery, claim status, provider performance and profitability"
                  : "Contract-wise UDA delivery, band breakdown, provider performance and profitability"}
              </p>
            </div>
            {hasClaims && !isLoading && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  {financialYear.label}
                </Button>
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="w-4 h-4" />
                  Export
                </Button>
              </div>
            )}
          </div>
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="nhs">Contract 1</TabsTrigger>
            <TabsTrigger value="mos">Contract 2</TabsTrigger>
            <TabsTrigger value="uoa">Contract 3</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-6 mt-4">
            {overviewContent}
          </TabsContent>
          <TabsContent value="nhs" className="mt-4">
            <NhsUdaSettingsSection contractType="NHS" />
          </TabsContent>
          <TabsContent value="mos" className="mt-4">
            <NhsUdaSettingsSection contractType="MOS" />
          </TabsContent>
          <TabsContent value="uoa" className="mt-4">
            <NhsUdaSettingsSection contractType="UOA" />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
