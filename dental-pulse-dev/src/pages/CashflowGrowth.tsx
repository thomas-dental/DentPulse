import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Banknote,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Droplets,
  Shield,
  Scale,
  Plus,
  BarChart3,
  TableProperties,
} from 'lucide-react';
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  Area,
  ReferenceLine,
  ComposedChart,
} from 'recharts';
import { useCashflowGrowth } from '@/hooks/useCashflowGrowth';
import { useLiquiditySolvency, type RatioStatus } from '@/hooks/useLiquiditySolvency';

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatAxisCurrency = (value: number, symbol = '£'): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${(value / 1_000).toFixed(0)}K`;
  return `${symbol}${value.toFixed(0)}`;
};

function statusBadgeClass(status: RatioStatus): string {
  if (status === 'Strong') return 'bg-blue-500/20 text-blue-500';
  if (status === 'Healthy') return 'bg-success/20 text-success';
  if (status === 'Watch') return 'bg-warning/20 text-warning';
  if (status === 'Weak') return 'bg-destructive/20 text-destructive';
  return 'bg-muted text-muted-foreground';
}

/** Format BS as-of date for the UI, e.g. "31 Jul 2026". */
function formatBsAsOf(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Validated categorical palette — matches the Cash Flow Statement chart.
const FLOW_COLORS = {
  inflow: '#008300',
  outflow: '#e34948',
  net: '#2a78d6',
  balance: '#eb6834',
};

interface FlowChartPoint {
  month: string;
  monthFull: string;
  openingBalance: number;
  inflows: number;
  /** Plotted below the axis so money in / money out mirror each other. */
  outflowsNegative: number;
  outflows: number;
  netFlow: number;
  closingBalance: number;
}

function CashFlowDetailsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: FlowChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const rows: Array<{ label: string; value: number; color?: string; strong?: boolean }> = [
    { label: 'Opening Balance', value: d.openingBalance },
    { label: 'Money In', value: d.inflows, color: FLOW_COLORS.inflow },
    { label: 'Money Out', value: -d.outflows, color: FLOW_COLORS.outflow },
    { label: 'Net Flow', value: d.netFlow, color: d.netFlow >= 0 ? FLOW_COLORS.inflow : FLOW_COLORS.outflow, strong: true },
    { label: 'Closing Balance', value: d.closingBalance, color: FLOW_COLORS.balance, strong: true },
  ];

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="mb-2 text-xs font-semibold text-foreground">{d.monthFull}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-6 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {r.color && (
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
              )}
              {r.label}
            </span>
            <span className={cn('tabular-nums', r.strong ? 'font-semibold' : 'font-medium')} style={{ color: r.color }}>
              {formatCurrency(r.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const growthInvestments = [
  { id: 1, initiative: 'New Practice Acquisition', investment: 500000, timeline: 'Q2 2024', expectedROI: 25, paybackMonths: 24, status: 'Planned' },
  { id: 2, initiative: 'Digital Equipment Upgrade', investment: 150000, timeline: 'Q1 2024', expectedROI: 35, paybackMonths: 18, status: 'In Progress' },
  { id: 3, initiative: 'Marketing Campaign', investment: 50000, timeline: 'Q1 2024', expectedROI: 200, paybackMonths: 6, status: 'Active' },
  { id: 4, initiative: 'Staff Training Program', investment: 25000, timeline: 'Q2 2024', expectedROI: 150, paybackMonths: 8, status: 'Planned' },
  { id: 5, initiative: 'New Treatment Room', investment: 120000, timeline: 'Q3 2024', expectedROI: 40, paybackMonths: 20, status: 'Planned' },
];

export default function CashflowGrowth() {
  const [sortState, setSortState] = useState<Record<string, { column: string; direction: 'asc' | 'desc' } | null>>({});
  const [detailsView, setDetailsView] = useState<'chart' | 'table'>('chart');
  const {
    openingBalance,
    totalNetCashFlow,
    closingBalance,
    periodEndLabel,
    monthlySeries,
    scenarios,
    currencySymbol,
    isLoading: isLoadingKpis,
    isEmpty,
  } = useCashflowGrowth();

  const ls = useLiquiditySolvency(monthlySeries);

  const chartData = useMemo(
    () =>
      monthlySeries.map((m) => ({
        month: m.monthLabel,
        monthFull: m.month,
        netFlow: m.netFlow,
        closingBalance: m.closingBalance,
        openingBalance: m.openingBalance,
        inflows: m.inflows,
        outflows: m.outflows,
      })),
    [monthlySeries],
  );

  const detailsChartData = useMemo<FlowChartPoint[]>(
    () =>
      monthlySeries.map((m) => ({
        month: m.monthLabel,
        monthFull: m.month,
        openingBalance: m.openingBalance,
        inflows: m.inflows,
        outflows: Math.abs(m.outflows),
        outflowsNegative: -Math.abs(m.outflows),
        netFlow: m.netFlow,
        closingBalance: m.closingBalance,
      })),
    [monthlySeries],
  );

  const detailsSummary = useMemo(() => {
    if (detailsChartData.length === 0) return null;
    const totalIn = detailsChartData.reduce((s, m) => s + m.inflows, 0);
    const totalOut = detailsChartData.reduce((s, m) => s + m.outflows, 0);
    const best = detailsChartData.reduce((a, b) => (b.netFlow > a.netFlow ? b : a));
    const worst = detailsChartData.reduce((a, b) => (b.netFlow < a.netFlow ? b : a));
    const peak = detailsChartData.reduce((a, b) => (b.closingBalance > a.closingBalance ? b : a));
    const positiveMonths = detailsChartData.filter((m) => m.netFlow >= 0).length;
    return {
      totalIn,
      totalOut,
      best,
      worst,
      peak,
      positiveMonths,
      monthCount: detailsChartData.length,
      /** Share of inflow retained as cash — the headline efficiency read. */
      conversion: totalIn > 0 ? ((totalIn - totalOut) / totalIn) * 100 : 0,
    };
  }, [detailsChartData]);

  const scenarioMaxBalance = useMemo(() => {
    const max = Math.max(...scenarios.map((s) => Math.abs(s.endBalance)), 1);
    return max;
  }, [scenarios]);

  const handleSort = (tableKey: string, column: string) => {
    setSortState((prev) => {
      const current = prev[tableKey];
      if (!current || current.column !== column) {
        return { ...prev, [tableKey]: { column, direction: 'desc' } };
      }
      if (current.direction === 'desc') {
        return { ...prev, [tableKey]: { column, direction: 'asc' } };
      }
      return { ...prev, [tableKey]: null };
    });
  };

  const getSortIcon = (tableKey: string, column: string) => {
    const current = sortState[tableKey];
    if (!current || current.column !== column) return <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />;
    if (current.direction === 'desc') return <ArrowDown className="w-3.5 h-3.5" />;
    return <ArrowUp className="w-3.5 h-3.5" />;
  };

  const applySortToArray = <T,>(
    tableKey: string,
    data: T[],
    accessor: (item: T, col: string) => number | string,
  ): T[] => {
    const current = sortState[tableKey];
    if (!current) return data;
    return [...data].sort((a, b) => {
      const aVal = accessor(a, current.column);
      const bVal = accessor(b, current.column);
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return current.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return current.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  };

  const sortedCashFlowData = useMemo(() => {
    return applySortToArray('cashflow', [...monthlySeries], (item, col) => {
      if (col === 'month') return item.month;
      return (item as Record<string, number | string>)[col] ?? 0;
    });
  }, [sortState, monthlySeries]);

  const sortedGrowthData = useMemo(() => {
    return applySortToArray('growth', [...growthInvestments], (item, col) => {
      if (col === 'initiative' || col === 'timeline' || col === 'status') return (item as Record<string, number | string>)[col] || '';
      return (item as Record<string, number | string>)[col] ?? 0;
    });
  }, [sortState]);

  const SortableTh = ({
    tableKey,
    column,
    children,
    className = '',
  }: {
    tableKey: string;
    column: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th
      className={cn('cursor-pointer select-none hover:text-foreground', className)}
      onClick={() => handleSort(tableKey, column)}
    >
      <div className="flex items-center gap-1 justify-center">
        {children}
        {getSortIcon(tableKey, column)}
      </div>
    </th>
  );

  const formatGrowthLabel = (rate: number) => {
    const sign = rate > 0 ? '+' : '';
    return `${sign}${rate.toFixed(1)}% Growth`;
  };

  return (
    <MainLayout>
      <Helmet>
        <title>Growth</title>
        <meta
          name="description"
          content="Cash flow projections, liquidity and solvency ratios, and growth investment planning."
        />
      </Helmet>

      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Growth</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Cash flow projections, liquidity ratios, and growth investments
          </p>
        </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Banknote className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Opening Balance</p>
                </div>
                {isLoadingKpis ? (
                  <Skeleton className="h-8 w-36 mt-1" />
                ) : (
                  <p className="text-2xl font-semibold">{formatCurrency(openingBalance)}</p>
                )}
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Year-End Projection</p>
                {isLoadingKpis ? (
                  <Skeleton className="h-8 w-36 mt-1" />
                ) : (
                  <>
                    <p className={`text-2xl font-semibold ${closingBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {formatCurrency(closingBalance)}
                    </p>
                    {periodEndLabel && (
                      <p className="text-xs text-muted-foreground mt-1">Closing as of {periodEndLabel}</p>
                    )}
                  </>
                )}
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Total Net Cash Flow</p>
                {isLoadingKpis ? (
                  <Skeleton className="h-8 w-36 mt-1" />
                ) : (
                  <p className={`text-2xl font-semibold ${totalNetCashFlow >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(totalNetCashFlow)}
                  </p>
                )}
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Planned Investments</p>
                <p className="text-2xl font-semibold">{formatCurrency(growthInvestments.reduce((s, g) => s + g.investment, 0))}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Cash Flow Chart */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-medium mb-4">Monthly Cash Flow</h3>
                <div className="h-72">
                  {isLoadingKpis ? (
                    <div className="h-full flex flex-col justify-center gap-3 px-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-40 w-full" />
                      <Skeleton className="h-6 w-1/2 mx-auto" />
                    </div>
                  ) : isEmpty ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      No cash flow data for the selected filters.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis
                          tick={{ fontSize: 12 }}
                          stroke="hsl(var(--muted-foreground))"
                          tickFormatter={(v) => formatAxisCurrency(Number(v), currencySymbol)}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                          }}
                          labelFormatter={(_, payload) => {
                            const full = payload?.[0]?.payload?.monthFull;
                            return full ? String(full) : '';
                          }}
                          formatter={(value: number, name: string) => [
                            <span key={name} style={{ color: value < 0 ? 'hsl(var(--destructive))' : undefined }}>
                              {formatCurrency(value)}
                            </span>,
                            name,
                          ]}
                        />
                        <Legend />
                        <Bar dataKey="netFlow" name="Net Flow" fill="hsl(var(--accent) / 0.6)" radius={[4, 4, 0, 0]} />
                        <Line
                          type="monotone"
                          dataKey="closingBalance"
                          name="Closing Balance"
                          stroke="hsl(var(--success))"
                          strokeWidth={2}
                          dot={{ fill: 'hsl(var(--success))' }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Scenario Comparison */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-medium mb-1">Scenario Analysis</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Base case uses actual period-end balance; conservative/optimistic scale net cash flow by 0.7× / 1.3×.
                </p>
                <div className="space-y-4">
                  {isLoadingKpis ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="p-4 rounded-lg bg-muted/30 border border-border space-y-3">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-2 w-full" />
                      </div>
                    ))
                  ) : (
                    scenarios.map((scenario) => (
                      <div key={scenario.scenario} className="p-4 rounded-lg bg-muted/30 border border-border">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{scenario.scenario}</span>
                          <span className={cn(
                            'text-sm font-medium',
                            scenario.scenario === 'Optimistic' && 'text-success',
                            scenario.scenario === 'Conservative' && 'text-warning',
                            scenario.scenario === 'Base Case' && 'text-accent'
                          )}>
                            {formatGrowthLabel(scenario.growthRate)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Year-End Balance</span>
                          <span className="text-lg font-semibold">{formatCurrency(scenario.endBalance)}</span>
                        </div>
                        <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              scenario.scenario === 'Optimistic' && 'bg-success',
                              scenario.scenario === 'Conservative' && 'bg-warning',
                              scenario.scenario === 'Base Case' && 'bg-accent'
                            )}
                            style={{
                              width: `${Math.min(100, (Math.abs(scenario.endBalance) / scenarioMaxBalance) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Liquidity & Solvency Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Liquidity Ratios */}
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Droplets className="w-5 h-5 text-blue-500" />
                    <h3 className="text-sm font-medium">Liquidity Position</h3>
                  </div>
                  {!ls.isLoading && !ls.hasFullBalanceSheet && (
                    <span className="text-[11px] text-muted-foreground">Re-sync Balance Sheet for full ratios</span>
                  )}
                  {!ls.isLoading && ls.hasFullBalanceSheet && formatBsAsOf(ls.balanceSheetAsOf) && (
                    <span className="text-[11px] text-muted-foreground">
                      As of {formatBsAsOf(ls.balanceSheetAsOf)}
                    </span>
                  )}
                </div>

                {ls.isLoading ? (
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-24 w-full rounded-lg" />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">Current Ratio</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeClass(ls.currentRatio.status))}>
                            {ls.currentRatio.status}
                          </span>
                        </div>
                        <div className="text-2xl font-bold">
                          {ls.currentRatio.available ? `${ls.currentRatio.current.toFixed(1)}x` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">Benchmark: {ls.currentRatio.benchmark}x</div>
                      </div>
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">Quick Ratio</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeClass(ls.quickRatio.status))}>
                            {ls.quickRatio.status}
                          </span>
                        </div>
                        <div className="text-2xl font-bold">
                          {ls.quickRatio.available ? `${ls.quickRatio.current.toFixed(1)}x` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">Benchmark: {ls.quickRatio.benchmark}x</div>
                      </div>
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">Cash Ratio</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeClass(ls.cashRatio.status))}>
                            {ls.cashRatio.status}
                          </span>
                        </div>
                        <div className="text-2xl font-bold">
                          {ls.cashRatio.available ? `${ls.cashRatio.current.toFixed(1)}x` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">Benchmark: {ls.cashRatio.benchmark}x</div>
                      </div>
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">Days of Cash</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeClass(ls.daysOfCash.status))}>
                            {ls.daysOfCash.status}
                          </span>
                        </div>
                        <div className="text-2xl font-bold">
                          {ls.daysOfCash.available ? ls.daysOfCash.current.toFixed(0) : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">Benchmark: {ls.daysOfCash.benchmark} days</div>
                      </div>
                    </div>

                    <div className="p-4 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 rounded-lg border border-blue-500/20 mb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-muted-foreground">Working Capital</div>
                          <div className="text-xl font-bold">
                            {ls.workingCapital.available ? formatCurrency(ls.workingCapital.current) : '—'}
                          </div>
                        </div>
                        <div className="text-right">
                          {ls.workingCapital.change != null ? (
                            <TrendIndicator value={ls.workingCapital.change} />
                          ) : (
                            <span className="text-xs text-muted-foreground">N/A</span>
                          )}
                          <div className="text-xs text-muted-foreground">vs Prior Year</div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="h-48">
                  {ls.isLoading ? (
                    <Skeleton className="h-full w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={ls.liquidityTrends}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {ls.hasFullBalanceSheet ? (
                          <>
                            <Line type="monotone" dataKey="currentRatio" name="Current" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} connectNulls />
                            <Line type="monotone" dataKey="quickRatio" name="Quick" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} connectNulls />
                            <Line type="monotone" dataKey="cashRatio" name="Cash" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} connectNulls />
                          </>
                        ) : (
                          <Line type="monotone" dataKey="daysOfCash" name="Days of Cash" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} connectNulls />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Solvency Ratios */}
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-green-500" />
                    <h3 className="text-sm font-medium">Solvency Position</h3>
                  </div>
                  {!ls.isLoading && ls.hasFullBalanceSheet && formatBsAsOf(ls.balanceSheetAsOf) && (
                    <span className="text-[11px] text-muted-foreground">
                      As of {formatBsAsOf(ls.balanceSheetAsOf)}
                    </span>
                  )}
                </div>

                {ls.isLoading ? (
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-24 w-full rounded-lg" />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">Debt to Equity</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeClass(ls.debtToEquity.status))}>
                            {ls.debtToEquity.status}
                          </span>
                        </div>
                        <div className="text-2xl font-bold">
                          {ls.debtToEquity.available ? `${ls.debtToEquity.current.toFixed(2)}x` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">Benchmark: &lt;{ls.debtToEquity.benchmark}x</div>
                      </div>
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">Debt to Assets</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeClass(ls.debtToAssets.status))}>
                            {ls.debtToAssets.status}
                          </span>
                        </div>
                        <div className="text-2xl font-bold">
                          {ls.debtToAssets.available ? `${(ls.debtToAssets.current * 100).toFixed(0)}%` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Benchmark: &lt;{(ls.debtToAssets.benchmark * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">Interest Coverage</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeClass(ls.interestCoverage.status))}>
                            {ls.interestCoverage.status}
                          </span>
                        </div>
                        <div className="text-2xl font-bold">
                          {ls.interestCoverage.available ? `${ls.interestCoverage.current.toFixed(1)}x` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">Benchmark: &gt;{ls.interestCoverage.benchmark}x</div>
                      </div>
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">Equity Ratio</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeClass(ls.equityRatio.status))}>
                            {ls.equityRatio.status}
                          </span>
                        </div>
                        <div className="text-2xl font-bold">
                          {ls.equityRatio.available ? `${(ls.equityRatio.current * 100).toFixed(0)}%` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Benchmark: &gt;{(ls.equityRatio.benchmark * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-lg border border-green-500/20 mb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-muted-foreground">Debt Service Coverage</div>
                          <div className="text-xl font-bold">—</div>
                        </div>
                        <div className="text-right">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Needs loan data</span>
                          <div className="text-xs text-muted-foreground mt-1">Min: {ls.debtServiceCoverage.benchmark}x</div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="h-48">
                  {ls.isLoading ? (
                    <Skeleton className="h-full w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={ls.solvencyTrends}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {ls.hasFullBalanceSheet && (
                          <Line type="monotone" dataKey="debtToEquity" name="D/E" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} connectNulls />
                        )}
                        <Line type="monotone" dataKey="interestCoverage" name="Int. Cov." stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Capital Structure & Debt Maturity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Scale className="w-5 h-5 text-purple-500" />
                    <h3 className="text-sm font-medium">Capital Structure</h3>
                  </div>
                  {!ls.isLoading && ls.capitalStructure.available && formatBsAsOf(ls.balanceSheetAsOf) && (
                    <span className="text-[11px] text-muted-foreground">
                      As of {formatBsAsOf(ls.balanceSheetAsOf)}
                    </span>
                  )}
                </div>
                {ls.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : !ls.capitalStructure.available ? (
                  <p className="text-sm text-muted-foreground">
                    Re-sync Xero Balance Sheet to load assets, equity, and liabilities.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Total Assets</span>
                        <span className="font-semibold">{formatCurrency(ls.capitalStructure.totalAssets)}</span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: '100%' }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                        <div className="text-xs text-muted-foreground">Equity</div>
                        <div className="font-bold text-green-600">{formatCurrency(ls.capitalStructure.totalEquity)}</div>
                        <div className="text-xs text-green-600">
                          {ls.capitalStructure.totalAssets > 0
                            ? `${((ls.capitalStructure.totalEquity / ls.capitalStructure.totalAssets) * 100).toFixed(0)}%`
                            : '—'}
                        </div>
                      </div>
                      <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                        <div className="text-xs text-muted-foreground">Liabilities</div>
                        <div className="font-bold text-red-600">{formatCurrency(ls.capitalStructure.totalLiabilities)}</div>
                        <div className="text-xs text-red-600">
                          {ls.capitalStructure.totalAssets > 0
                            ? `${((ls.capitalStructure.totalLiabilities / ls.capitalStructure.totalAssets) * 100).toFixed(0)}%`
                            : '—'}
                        </div>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-border">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Current Assets</span>
                        <span>{formatCurrency(ls.capitalStructure.currentAssets)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mt-2">
                        <span className="text-muted-foreground">Current Liabilities</span>
                        <span>{formatCurrency(ls.capitalStructure.currentLiabilities)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Debt Maturity — Step 3: needs loan schedules */}
              <div className="bg-card rounded-xl border border-border p-5 lg:col-span-2">
                <h3 className="text-sm font-medium mb-2">Debt Maturity Profile</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Maturity buckets and Debt Service Coverage need loan / facility schedules (not available from Xero Balance Sheet alone).
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted/30 rounded-lg border border-border">
                    <div className="text-sm text-muted-foreground">Short-term Debt (&lt;1 yr)</div>
                    <div className="text-xl font-bold">
                      {ls.capitalStructure.available ? formatCurrency(ls.capitalStructure.shortTermDebt) : '—'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Approx. = Current Liabilities (until loan data)</div>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-lg border border-border">
                    <div className="text-sm text-muted-foreground">Long-term Debt</div>
                    <div className="text-xl font-bold">
                      {ls.capitalStructure.available ? formatCurrency(ls.capitalStructure.longTermDebt) : '—'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Approx. = Non-current Liabilities</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Growth Investments Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-medium">Growth Investment Pipeline</h3>
                <Button size="sm" variant="outline" className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add Initiative
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr className="bg-muted/50">
                      <SortableTh tableKey="growth" column="initiative">Initiative</SortableTh>
                      <SortableTh tableKey="growth" column="investment">Investment</SortableTh>
                      <SortableTh tableKey="growth" column="timeline">Timeline</SortableTh>
                      <SortableTh tableKey="growth" column="expectedROI">Expected ROI</SortableTh>
                      <SortableTh tableKey="growth" column="paybackMonths">Payback (Months)</SortableTh>
                      <SortableTh tableKey="growth" column="status">Status</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGrowthData.map((investment) => (
                      <tr key={investment.id}>
                        <td className="font-medium">{investment.initiative}</td>
                        <td>{formatCurrency(investment.investment)}</td>
                        <td>{investment.timeline}</td>
                        <td className="text-success">{investment.expectedROI}%</td>
                        <td>{investment.paybackMonths}</td>
                        <td>
                          <span className={cn(
                            'px-2 py-1 rounded-full text-xs font-medium',
                            investment.status === 'Active' && 'bg-success/20 text-success',
                            investment.status === 'In Progress' && 'bg-info/20 text-info',
                            investment.status === 'Planned' && 'bg-muted text-muted-foreground'
                          )}>
                            {investment.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td>Total Investment</td>
                      <td>{formatCurrency(growthInvestments.reduce((s, g) => s + g.investment, 0))}</td>
                      <td colSpan={4}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Cash Flow Details */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-5 border-b border-border flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Monthly Cash Flow Details</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Money in against money out each month, with the running closing balance.
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                  {(['chart', 'table'] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setDetailsView(view)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        detailsView === view
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {view === 'chart' ? (
                        <BarChart3 className="w-3.5 h-3.5" />
                      ) : (
                        <TableProperties className="w-3.5 h-3.5" />
                      )}
                      {view === 'chart' ? 'Chart' : 'Table'}
                    </button>
                  ))}
                </div>
              </div>

              {isLoadingKpis ? (
                <div className="p-5 space-y-3">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                </div>
              ) : isEmpty ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No monthly cash flow rows for the selected filters.
                </div>
              ) : detailsView === 'chart' ? (
                <div className="p-5 space-y-5">
                  {detailsSummary && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Total Money In</p>
                        <p className="mt-1 text-lg font-semibold text-success tabular-nums">
                          {formatCurrency(detailsSummary.totalIn)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Across {detailsSummary.monthCount} month{detailsSummary.monthCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Total Money Out</p>
                        <p className="mt-1 text-lg font-semibold text-danger tabular-nums">
                          {formatCurrency(detailsSummary.totalOut)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {detailsSummary.totalIn > 0
                            ? `${((detailsSummary.totalOut / detailsSummary.totalIn) * 100).toFixed(0)}% of money in`
                            : '—'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Net Change</p>
                        <p
                          className={cn(
                            'mt-1 text-lg font-semibold tabular-nums',
                            totalNetCashFlow >= 0 ? 'text-success' : 'text-danger',
                          )}
                        >
                          {totalNetCashFlow >= 0 ? '+' : ''}
                          {formatCurrency(totalNetCashFlow)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {detailsSummary.conversion.toFixed(0)}% cash conversion
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Best / Weakest Month</p>
                        <p className="mt-1 text-lg font-semibold tabular-nums">{detailsSummary.best.month}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Weakest {detailsSummary.worst.month} ({formatCurrency(detailsSummary.worst.netFlow)})
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Peak Cash Balance</p>
                        <p className="mt-1 text-lg font-semibold tabular-nums" style={{ color: FLOW_COLORS.balance }}>
                          {formatCurrency(detailsSummary.peak.closingBalance)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {detailsSummary.peak.month} · {detailsSummary.positiveMonths}/{detailsSummary.monthCount} months cash positive
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="h-[420px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={detailsChartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="cfInflowFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={FLOW_COLORS.inflow} stopOpacity={0.95} />
                            <stop offset="100%" stopColor={FLOW_COLORS.inflow} stopOpacity={0.45} />
                          </linearGradient>
                          <linearGradient id="cfOutflowFill" x1="0" y1="1" x2="0" y2="0">
                            <stop offset="0%" stopColor={FLOW_COLORS.outflow} stopOpacity={0.95} />
                            <stop offset="100%" stopColor={FLOW_COLORS.outflow} stopOpacity={0.45} />
                          </linearGradient>
                          <linearGradient id="cfBalanceFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={FLOW_COLORS.balance} stopOpacity={0.28} />
                            <stop offset="100%" stopColor={FLOW_COLORS.balance} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis
                          dataKey="month"
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          yAxisId="flow"
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                          width={62}
                          tickFormatter={(value: number) =>
                            `${value < 0 ? '-' : ''}${formatAxisCurrency(Math.abs(value), currencySymbol)}`
                          }
                        />
                        <YAxis
                          yAxisId="balance"
                          orientation="right"
                          stroke={FLOW_COLORS.balance}
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                          width={62}
                          tickFormatter={(value: number) => formatAxisCurrency(value, currencySymbol)}
                        />
                        <Tooltip
                          content={<CashFlowDetailsTooltip />}
                          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconSize={10} iconType="circle" />
                        <ReferenceLine yAxisId="flow" y={0} stroke="hsl(var(--border))" strokeWidth={1.5} />
                        <Area
                          yAxisId="balance"
                          type="monotone"
                          dataKey="closingBalance"
                          name="Closing Balance"
                          stroke={FLOW_COLORS.balance}
                          strokeWidth={2.5}
                          fill="url(#cfBalanceFill)"
                          dot={false}
                          activeDot={{ r: 5, fill: FLOW_COLORS.balance, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                        />
                        <Bar
                          yAxisId="flow"
                          dataKey="inflows"
                          name="Money In"
                          fill="url(#cfInflowFill)"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={28}
                        />
                        <Bar
                          yAxisId="flow"
                          dataKey="outflowsNegative"
                          name="Money Out"
                          fill="url(#cfOutflowFill)"
                          radius={[0, 0, 4, 4]}
                          maxBarSize={28}
                        />
                        <Line
                          yAxisId="flow"
                          type="monotone"
                          dataKey="netFlow"
                          name="Net Flow"
                          stroke={FLOW_COLORS.net}
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          dot={{ r: 3, fill: FLOW_COLORS.net, strokeWidth: 0 }}
                          activeDot={{ r: 5, fill: FLOW_COLORS.net, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr className="bg-muted/50">
                        <SortableTh tableKey="cashflow" column="month">Month</SortableTh>
                        <SortableTh tableKey="cashflow" column="openingBalance">Opening Balance</SortableTh>
                        <SortableTh tableKey="cashflow" column="inflows">Inflows</SortableTh>
                        <SortableTh tableKey="cashflow" column="outflows">Outflows</SortableTh>
                        <SortableTh tableKey="cashflow" column="netFlow">Net Flow</SortableTh>
                        <SortableTh tableKey="cashflow" column="closingBalance">Closing Balance</SortableTh>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCashFlowData.map((month) => (
                        <tr key={month.sortKey}>
                          <td className="font-medium">{month.month}</td>
                          <td>{formatCurrency(month.openingBalance)}</td>
                          <td className="text-success">{formatCurrency(month.inflows)}</td>
                          <td className="text-danger">{formatCurrency(month.outflows)}</td>
                          <td className={cn(
                            'font-medium',
                            month.netFlow >= 0 ? 'text-success' : 'text-danger'
                          )}>
                            {month.netFlow >= 0 ? '+' : ''}{formatCurrency(month.netFlow)}
                          </td>
                          <td className="font-medium">{formatCurrency(month.closingBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        <td>Period Total</td>
                        <td>{formatCurrency(openingBalance)}</td>
                        <td className="text-success">
                          {formatCurrency(monthlySeries.reduce((s, m) => s + m.inflows, 0))}
                        </td>
                        <td className="text-danger">
                          {formatCurrency(monthlySeries.reduce((s, m) => s + m.outflows, 0))}
                        </td>
                        <td className={cn(
                          totalNetCashFlow >= 0 ? 'text-success' : 'text-danger'
                        )}>
                          {totalNetCashFlow >= 0 ? '+' : ''}{formatCurrency(totalNetCashFlow)}
                        </td>
                        <td>{formatCurrency(closingBalance)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
      </div>
    </MainLayout>
  );
}
