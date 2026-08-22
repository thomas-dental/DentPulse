import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Line, Legend } from 'recharts';
import { PoundSterling, Users, TrendingUp, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { usePrivateTreatmentData } from '@/hooks/usePrivateTreatmentData';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { toLocalYMD } from '@/utils/dateRangeUtils';
import { DateBasisToggle } from '@/components/treatments/DateBasisToggle';
import type { TreatmentDateBasis } from '@/lib/paidDateBasis';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { formatCurrency as formatCurrencyBase } from '@/lib/currency';

// Plain whole-pound formatter used only as formatCompact's fallback for sub-£1k amounts.
function formatCurrencyPlain(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCompact(amount: number): string {
  if (amount >= 1_000_000) return `£${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `£${(amount / 1_000).toFixed(2)}k`;
  return formatCurrencyPlain(amount);
}

const RANK_COLORS: Record<number, string> = {
  1: 'bg-amber-500',
  2: 'bg-emerald-500',
  3: 'bg-red-500',
};
const RANK_SUFFIXES: Record<number, string> = {
  1: 'st',
  2: 'nd',
  3: 'rd',
};

function RankBadge({ rank }: { rank: number }) {
  const bg = RANK_COLORS[rank] || 'bg-gray-400';
  const suffix = RANK_SUFFIXES[rank] || 'th';
  return (
    <span className={cn('inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-bold', bg)}>
      {rank}<sup className="text-[8px] ml-px">{suffix}</sup>
    </span>
  );
}

function TrendIndicator({ value, label }: { value: number; label?: string }) {
  if (value === 0) return <span className="text-sm text-muted-foreground">-- {label}</span>;
  const isUp = value > 0;
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm', isUp ? 'text-emerald-600' : 'text-red-500')}>
      <span className="text-base">{isUp ? '↗' : '↘'}</span>
      <span className="font-medium">{isUp ? '+' : ''}{Math.round(value)}%</span>
      {label && <span className="text-muted-foreground font-normal">{label}</span>}
    </span>
  );
}

export default function PrivateTreatment() {
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = (amount: number) => formatCurrencyBase(amount, showDecimals);
  // Overview tile numbers always show whole pounds, regardless of the Show Decimals setting.
  const formatCurrencyWhole = (amount: number) => formatCurrencyBase(amount, false);
  // Completed on / Paid on — mirrors the Date dropdown on Dentally's
  // Practitioner Activity report. On the paid basis every figure is dated by
  // the treatment invoice's paid day instead of the completion day.
  const [dateBasis, setDateBasis] = useState<TreatmentDateBasis>('completed');
  const { summary, categories, monthlyPerformance, isLoading, isPerformanceLoading } = usePrivateTreatmentData(dateBasis);
  const { dateRange: filterDateRange, selectedLocationId } = useFilters();
  const { locations: allLocations } = useLocations();
  const [perfView, setPerfView] = useState<'month' | 'quarter'>('month');

  // Drop treatment groups with no activity at all (zero revenue AND zero
  // units). Keep the original rank from `categories` so the badge
  // numbers stay stable — filtering after the map ensures e.g. a 9th
  // rank that's all zero just disappears, rather than every row above
  // it shifting up. Rows with revenue OR units (e.g. Prosthodontics
  // removable: 5 units, £0) still appear since they represent real
  // activity even without revenue attached.
  const rankedCategories = useMemo(
    () =>
      categories
        .map((cat, i) => ({ ...cat, rank: i + 1 }))
        .filter((cat) => cat.revenue > 0 || cat.units > 0),
    [categories],
  );

  const fmt = (d: Date) => d.toLocaleString('default', { month: 'short', year: 'numeric' });
  const dateRangeLabel = `${fmt(filterDateRange.startDate)} - ${fmt(filterDateRange.endDate)}`;

  const summaryCards = [
    {
      title: 'Private Revenue',
      value: formatCurrencyWhole(summary.privateRevenue),
      trend: summary.revenueTrend,
      icon: PoundSterling,
      iconBg: 'bg-teal-100 dark:bg-teal-900/40',
      iconColor: 'text-teal-600 dark:text-teal-400',
    },
    {
      title: 'Treatment Units',
      value: summary.treatmentUnits.toLocaleString(),
      trend: summary.unitsTrend,
      icon: Users,
      iconBg: 'bg-blue-100 dark:bg-blue-900/40',
      iconColor: 'text-blue-600 dark:text-blue-400',
    },
    {
      title: 'Avg. Treatment Value',
      value: formatCurrencyWhole(summary.avgTreatmentValue),
      trend: summary.avgValueTrend,
      icon: TrendingUp,
      iconBg: 'bg-teal-100 dark:bg-teal-900/40',
      iconColor: 'text-teal-600 dark:text-teal-400',
    },
    {
      title: 'Chair Time Utilized',
      value: summary.chairTimeUtilized > 0 ? `${Math.floor(summary.chairTimeUtilized / 60)}h ${Math.round(summary.chairTimeUtilized % 60)}m` : '--',
      trend: summary.chairTimeTrend,
      icon: Clock,
      iconBg: 'bg-slate-100 dark:bg-slate-900/40',
      iconColor: 'text-slate-600 dark:text-slate-400',
    },
  ];

  // Build AI context for chatbot
  const round2 = (n: number | null | undefined) =>
    n === null || n === undefined ? null : Math.round((Number(n) || 0) * 100) / 100;
  const selectedLocationName = selectedLocationId
    ? (allLocations.find((l: any) => l.id === selectedLocationId)?.name ?? 'Selected Location')
    : 'All Locations';

  const aiCategories = (rankedCategories || []).slice(0, 60).map(c => ({
    category: c.category,
    revenue: round2(c.revenue),
    units: c.units,
    rank: c.rank,
  }));
  const topCategoriesByRevenue = [...aiCategories].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)).slice(0, 10);
  const topCategoriesByUnits = [...aiCategories].sort((a, b) => b.units - a.units).slice(0, 10);

  const aiMonthlyPerformance = (monthlyPerformance || []).slice(0, 36).map((m: any) => ({
    month: m.month,
    actual: round2(m.actual ?? 0),
    target: round2(m.target ?? 0),
  }));

  const aiContextData = {
    page: 'private-treatment',
    selectedLocationName,
    selectedLocationId: selectedLocationId || null,
    // 'completed' dates figures by the treatment's completion day; 'paid'
    // dates them by the invoice's paid day (Dentally report Date filter).
    dateBasis,
    period: {
      // Local calendar date — NOT toISOString() (UTC), which rolls the
      // local-midnight startDate back a day in UTC+ timezones.
      from: toLocalYMD(filterDateRange?.startDate),
      to: toLocalYMD(filterDateRange?.endDate),
    },
    summary: {
      privateRevenue: round2(summary.privateRevenue),
      revenueTrendPercent: round2(summary.revenueTrend),
      treatmentUnits: summary.treatmentUnits,
      unitsTrendPercent: round2(summary.unitsTrend),
      avgTreatmentValue: round2(summary.avgTreatmentValue),
      avgValueTrendPercent: round2(summary.avgValueTrend),
      chairTimeUtilizedMinutes: round2(summary.chairTimeUtilized),
      chairTimeTrendPercent: round2(summary.chairTimeTrend),
    },
    categoryCount: categories?.length ?? 0,
    categories: aiCategories,
    topCategoriesByRevenue,
    topCategoriesByUnits,
    monthlyPerformance: aiMonthlyPerformance,
  };

  if (isLoading) {
    return (
      <MainLayout userRole="admin" aiContext={aiContextData}>
        <Helmet><title>Private Treatment | DentPulse</title></Helmet>
        <div className="space-y-6 pt-6">
          {/* Breadcrumb + Header skeleton */}
          <div>
            <Skeleton className="h-4 w-48 mb-2" />
            <Skeleton className="h-8 w-72 mb-1" />
            <Skeleton className="h-4 w-96" />
          </div>

          {/* Tab bar skeleton */}
          <Skeleton className="h-10 w-72 rounded-lg" />

          {/* Summary Cards skeleton */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6 pb-5">
                  <div className="flex items-start justify-between mb-4">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="w-9 h-9 rounded-full" />
                  </div>
                  <Skeleton className="h-9 w-32 mb-2" />
                  <Skeleton className="h-4 w-28" />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Chart + Ranking skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-52 mb-1" />
                <Skeleton className="h-4 w-36" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-[380px] w-full rounded-lg" />
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 flex flex-col" style={{ maxHeight: '500px' }}>
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-24 mb-1" />
                <Skeleton className="h-4 w-20" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-12" />
                    <Skeleton className="w-8 h-8 rounded-full" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet><title>Private Treatment | DentPulse</title></Helmet>

      <div className="space-y-6 pt-6">
        {/* Breadcrumb + Header */}
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <Link to="/treatments/insights" className="hover:text-foreground">Treatment</Link>
            <span>/</span>
            <span className="text-foreground font-medium">Private Treatment</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold">Private Treatment Performance</h1>
            <p className="text-muted-foreground">Analyze revenue, profitability, and trends for private treatments</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="trends">Trends</TabsTrigger>
            </TabsList>
            <DateBasisToggle value={dateBasis} onChange={setDateBasis} />
          </div>

          {/* ═══════ OVERVIEW TAB ═══════ */}
          <TabsContent value="overview" className="space-y-6 mt-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {summaryCards.map((card) => {
                const Icon = card.icon;
                return (
                  <Card key={card.title}>
                    <CardContent className="pt-6 pb-5">
                      <div className="flex items-start justify-between mb-4">
                        <span className="text-sm text-muted-foreground">{card.title}</span>
                        <div className={cn('w-9 h-9 rounded-full flex items-center justify-center', card.iconBg)}>
                          <Icon className={cn('w-4 h-4', card.iconColor)} />
                        </div>
                      </div>
                      <div className="text-3xl font-bold mb-1">{card.value}</div>
                      <TrendIndicator value={card.trend} label="vs prior period" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Revenue by Treatment Type + Ranking */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Bar chart — 3/5 */}
              <Card className="lg:col-span-3">
                <CardHeader className="pb-2 flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold">Revenue by Treatment Type</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {dateRangeLabel}
                    </p>
                  </div>
                  {/* <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="w-4 h-4" />
                  </Button> */}
                </CardHeader>
                <CardContent>
                  {categories.length > 0 ? (
                    <ResponsiveContainer width="100%" height={420}>
                      <ComposedChart
                        data={categories.slice(0, 8)}
                        margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="category"
                          interval={0}
                          axisLine={false}
                          tickLine={false}
                          height={80}
                          tick={({ x, y, payload }: any) => {
                            const words = (payload.value as string).split(' ');
                            const lines: string[] = [];
                            let current = '';
                            for (const w of words) {
                              if ((current + ' ' + w).trim().length > 14) {
                                if (current) lines.push(current);
                                current = w;
                              } else {
                                current = current ? current + ' ' + w : w;
                              }
                            }
                            if (current) lines.push(current);
                            return (
                              <g transform={`translate(${x},${y + 8})`}>
                                {lines.map((line, i) => (
                                  <text key={i} x={0} y={i * 13} textAnchor="middle" fontSize={10} fill="currentColor">
                                    {line}
                                  </text>
                                ))}
                              </g>
                            );
                          }}
                        />
                        <YAxis
                          yAxisId="revenue"
                          tickFormatter={(v: number) => formatCompact(v)}
                          axisLine={false}
                          tickLine={false}
                          fontSize={12}
                        />
                        <YAxis
                          yAxisId="units"
                          orientation="right"
                          axisLine={false}
                          tickLine={false}
                          fontSize={12}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => {
                            if (name === 'Revenue') return [formatCurrency(value), name];
                            return [value, name];
                          }}
                          contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                        />
                        <Legend verticalAlign="top" height={30} />
                        <Bar
                          yAxisId="revenue"
                          dataKey="revenue"
                          name="Revenue"
                          fill="#14b8a6"
                          radius={[4, 4, 0, 0]}
                          barSize={32}
                        />
                        <Bar
                          yAxisId="units"
                          dataKey="units"
                          name="Units"
                          fill="#f59e0b"
                          radius={[4, 4, 0, 0]}
                          barSize={32}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[380px] text-muted-foreground text-sm">
                      No treatment data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Ranking Table — 2/5, same height as chart card with scroll */}
              <Card className="lg:col-span-2 flex flex-col" style={{ maxHeight: '500px' }}>
                <CardHeader className="pb-2 flex-shrink-0">
                  <CardTitle className="text-lg font-semibold">Ranking</CardTitle>
                  <p className="text-sm text-muted-foreground">By revenue</p>
                </CardHeader>
                <CardContent className="px-0 flex-1 overflow-hidden flex flex-col">
                  {rankedCategories.length > 0 ? (
                    <>
                      <div className="pr-[scrollbar-gutter] overflow-y-scroll" style={{ overflowY: 'hidden', scrollbarGutter: 'stable' }}>
                        <Table style={{ tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: '40%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '15%' }} />
                            <col style={{ width: '20%' }} />
                          </colgroup>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-6 uppercase text-xs tracking-wider font-semibold text-muted-foreground">Treatment Group</TableHead>
                              <TableHead className="text-center uppercase text-xs tracking-wider font-semibold text-muted-foreground">Revenue</TableHead>
                              <TableHead className="text-center uppercase text-xs tracking-wider font-semibold text-muted-foreground">Units</TableHead>
                              <TableHead className="text-center uppercase text-xs tracking-wider font-semibold text-muted-foreground">Rank</TableHead>
                            </TableRow>
                          </TableHeader>
                        </Table>
                      </div>
                      <div className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
                        <Table style={{ tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: '40%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '15%' }} />
                            <col style={{ width: '20%' }} />
                          </colgroup>
                          <TableBody>
                            {rankedCategories.map((cat) => (
                              <TableRow key={cat.category} className="h-14">
                                <TableCell className="pl-6 font-medium">{cat.category}</TableCell>
                                <TableCell className="text-center font-medium text-teal-600">
                                  {formatCurrency(cat.revenue)}
                                </TableCell>
                                <TableCell className="text-center">{cat.units}</TableCell>
                                <TableCell className="text-center">
                                  <RankBadge rank={cat.rank} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                      No ranking data available
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ═══════ PERFORMANCE TAB ═══════ */}
          <TabsContent value="performance" className="space-y-6 mt-4">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold">Actual vs Target Performance</CardTitle>
                  <p className="text-sm text-muted-foreground">Monthly comparison</p>
                </div>
                <div className="flex items-center border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setPerfView('month')}
                    className={cn(
                      'px-4 py-1.5 text-sm font-medium transition-colors',
                      perfView === 'month' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Month
                  </button>
                  <button
                    onClick={() => setPerfView('quarter')}
                    className={cn(
                      'px-4 py-1.5 text-sm font-medium transition-colors',
                      perfView === 'quarter' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Quarter
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                {isPerformanceLoading ? (
                  <Skeleton className="h-[400px] w-full rounded-lg" />
                ) : monthlyPerformance.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <ComposedChart data={monthlyPerformance} margin={{ top: 20, right: 20, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} />
                      <YAxis tickFormatter={(v: number) => formatCompact(v)} axisLine={false} tickLine={false} fontSize={12} />
                      <Tooltip
                        formatter={(value: number, name: string) => [formatCurrency(value), name]}
                        contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                      />
                      <Legend />
                      <Bar
                        dataKey="actual"
                        name="Actual"
                        fill="#14b8a6"
                        radius={[4, 4, 0, 0]}
                        barSize={80}
                      />
                      <Line
                        dataKey="target"
                        name="Target"
                        stroke="#94a3b8"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={{ r: 4, fill: '#94a3b8', stroke: '#fff', strokeWidth: 2 }}
                        type="monotone"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[400px] text-muted-foreground text-sm">
                    No performance data available
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════ TRENDS TAB ═══════ */}
          <TabsContent value="trends" className="mt-4">
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              Trend analysis coming soon...
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

