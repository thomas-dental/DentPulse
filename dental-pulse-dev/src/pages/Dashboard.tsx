import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { KPICard } from '@/components/dashboard/KPICard';
import { ProgressBar } from '@/components/dashboard/ProgressBar';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { useAutoTriggerSync } from '@/hooks/useAutoTriggerSync';
import { Info, Calendar as CalendarIcon, X as XIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ChartDateFilter,
  calculateDateRangeFromFilter,
  getDateFilterLabel,
  type DateFilterType,
  type CustomRange,
} from '@/components/ui/chart-date-filter';
import { useFinancialMetricsWeekly } from '@/hooks/useFinancialMetricsWeekly';
import { useAllProvidersNetProduction } from '@/hooks/useAllProvidersNetProduction';
import { useCashflowStatement } from '@/hooks/useCashflowStatement';
import { useLocationMetrics } from '@/hooks/useLocationMetrics';
import { useLocations } from '@/hooks/useLocations';
import { useProfitLossOverview } from '@/hooks/useProfitLossOverview';
import { useCashflowOverview } from '@/hooks/useCashflowOverview';
import { useFilters } from '@/contexts/FilterContext';
import { cn } from '@/lib/utils';
import { Helmet } from 'react-helmet-async';

type WeeklyRow = {
  metric: string;
  lastWeek: string;
  thisWeek: string;
  change: string;
  status: 'success' | 'warning' | 'danger';
  /** Optional tooltip body shown on hover of an info icon next to the metric. */
  tooltip?: React.ReactNode;
};

const formatCurrency = (value: number): string => {
  return `£${Math.round(value).toLocaleString('en-GB')}`;
};

export default function Dashboard() {
  const navigate = useNavigate();
  // Auto-trigger queued sync jobs after onboarding
  useAutoTriggerSync();

  const financial = useFinancialMetricsWeekly();

  // Per-column date overrides. Each of the four columns (P/L Last, P/L This,
  // Cashflow Last, Cashflow This) can pick its own date range via the
  // calendar icon in its header. `filter === null` means "use the default
  // Monday-anchored week" computed inside the hook.
  type ColFilter = { filter: DateFilterType | null; customRange: CustomRange };
  const initialCol: ColFilter = { filter: null, customRange: { from: null, to: null } };
  const [pnlLastCol, setPnlLastCol] = useState<ColFilter>(initialCol);
  const [pnlThisCol, setPnlThisCol] = useState<ColFilter>(initialCol);
  const [cfLastCol, setCfLastCol]   = useState<ColFilter>(initialCol);
  const [cfThisCol, setCfThisCol]   = useState<ColFilter>(initialCol);

  // Column-header label: filter label when overridden (or formatted custom
  // range), otherwise the static fallback ("Last Week" / "This Week").
  const columnHeaderLabel = (c: ColFilter, fallback: string): string => {
    if (!c.filter) return fallback;
    if (c.filter === 'custom' && c.customRange.from && c.customRange.to) {
      const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      return `${fmt(c.customRange.from)} – ${fmt(c.customRange.to)}`;
    }
    return getDateFilterLabel(c.filter);
  };

  const colOverride = (c: ColFilter): { start: Date | null; end: Date | null } => {
    if (!c.filter) return { start: null, end: null };
    const r = calculateDateRangeFromFilter(c.filter, c.customRange);
    return { start: r.startDate, end: r.endDate };
  };

  const pnlLastOv = colOverride(pnlLastCol);
  const pnlThisOv = colOverride(pnlThisCol);
  const cfLastOv  = colOverride(cfLastCol);
  const cfThisOv  = colOverride(cfThisCol);

  const profitLoss = useProfitLossOverview({
    lastStart: pnlLastOv.start, lastEnd: pnlLastOv.end,
    thisStart: pnlThisOv.start, thisEnd: pnlThisOv.end,
  });
  const cashflowOverview = useCashflowOverview({
    lastStart: cfLastOv.start, lastEnd: cfLastOv.end,
    thisStart: cfThisOv.start, thisEnd: cfThisOv.end,
  });
  const { selectedLocationId, dateRange } = useFilters();
  const { locations } = useLocations();
  const { data: locationMetricsMap, isLoading: isLocationMetricsLoading } = useLocationMetrics();

  // Org-wide revenue and costs aggregated from per-location metrics (current
  // period from the global date filter). Powers the EBITDA Margin KPI card.
  const orgAggregate = useMemo(() => {
    if (!locationMetricsMap) return { revenue: 0, totalCosts: 0, ebitdaPercent: null as number | null };
    let revenue = 0;
    let totalCosts = 0;
    for (const [locId, m] of locationMetricsMap) {
      if (selectedLocationId && locId !== selectedLocationId) continue;
      revenue += m.revenue;
      totalCosts += m.totalCosts;
    }
    const ebitdaPercent = revenue > 0 ? ((revenue - totalCosts) / revenue) * 100 : null;
    return { revenue, totalCosts, ebitdaPercent };
  }, [locationMetricsMap, selectedLocationId]);

  // Net Production KPI card.
  // Pulls a window covering the **selected date range + the equivalent
  // previous period** so we can compute both this-period total and a
  // prev-period comparison from a single fetch. The sparkline below the
  // value still shows the per-month breakdown of this period.
  const { netProductionFetchStart, netProductionFetchEnd, netProductionPrevStart } = useMemo(() => {
    const periodMs = dateRange.endDate.getTime() - dateRange.startDate.getTime();
    const prevStart = new Date(dateRange.startDate.getTime() - periodMs);
    return {
      netProductionFetchStart: prevStart,
      netProductionFetchEnd: dateRange.endDate,
      netProductionPrevStart: prevStart,
    };
  }, [dateRange.startDate, dateRange.endDate]);

  const { data: providerProductionData, isLoading: isProductionLoading } = useAllProvidersNetProduction(
    null,
    netProductionFetchStart,
    netProductionFetchEnd,
    selectedLocationId,
  );

  // Bucket months returned by the RPC into "this period" vs "previous
  // period" by comparing each month's first day to dateRange.startDate.
  const { monthlyTotals, currentMonthTotal, netProductionTrend } = useMemo(() => {
    const months = providerProductionData?.months ?? [];
    const providers = providerProductionData?.providers ?? [];
    const periodStartIso = dateRange.startDate.toISOString().slice(0, 7); // YYYY-MM
    const prevStartIso = netProductionPrevStart.toISOString().slice(0, 7);

    let curTotal = 0;
    let prevTotal = 0;
    const curMonthly: number[] = [];
    for (const m of months) {
      const monthTotal = providers.reduce((sum, p) => sum + (p.monthlyData[m]?.amount ?? 0), 0);
      const inCurrent = m >= periodStartIso;
      const inPrev = !inCurrent && m >= prevStartIso;
      if (inCurrent) {
        curTotal += monthTotal;
        curMonthly.push(monthTotal);
      } else if (inPrev) {
        prevTotal += monthTotal;
      }
    }
    const trend = prevTotal > 0 ? ((curTotal - prevTotal) / prevTotal) * 100 : 0;
    return {
      monthlyTotals: curMonthly,
      currentMonthTotal: curTotal,
      netProductionTrend: trend,
    };
  }, [providerProductionData, dateRange.startDate, netProductionPrevStart]);

  // Collection Amount = Cash Flow → Total Received summed across the
  // selected date range, compared against the equivalent previous period.
  // Bounds are extended to calendar-month edges so a sub-monthly date range
  // (e.g. "20-26 April") still pulls April's monthly cashflow column.
  const { cashflowFromIso, cashflowToIso, prevCashflowFromIso, prevCashflowToIso } = useMemo(() => {
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
    const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const tStart = monthStart(dateRange.startDate);
    const tEnd = monthEnd(dateRange.endDate);
    const periodMs = tEnd.getTime() - tStart.getTime();
    const prevEnd = monthEnd(new Date(tStart.getTime() - 1));
    const prevStart = monthStart(new Date(tStart.getTime() - periodMs - 1));
    return {
      cashflowFromIso: fmt(tStart),
      cashflowToIso: fmt(tEnd),
      prevCashflowFromIso: fmt(prevStart),
      prevCashflowToIso: fmt(prevEnd),
    };
  }, [dateRange.startDate, dateRange.endDate]);

  const cashflowRange = useCashflowStatement(cashflowFromIso, cashflowToIso, undefined, selectedLocationId);
  const prevCashflowRange = useCashflowStatement(prevCashflowFromIso, prevCashflowToIso, undefined, selectedLocationId);
  const isCashflowLoading = cashflowRange.isLoadingReport || prevCashflowRange.isLoadingReport;

  // Sum Total Received across all months returned by the cashflow report.
  // If every column is 0 (e.g. only the in-progress month was returned and
  // it hasn't synced yet), fall back to the latest non-zero column from the
  // wider lookback so the user sees their most recent meaningful figure.
  const sumTotalReceived = (report: any): number => {
    const row = report?.totalRowDataSet?.find((r: any) => r.name === 'Total Received');
    const colData = (row?.colData ?? []) as Array<{ value: unknown }>;
    let total = 0;
    for (const c of colData) total += Number(c?.value) || 0;
    if (total !== 0) return total;
    for (let i = colData.length - 1; i >= 0; i--) {
      const v = Number(colData[i]?.value) || 0;
      if (v !== 0) return v;
    }
    return 0;
  };

  const collectionAmountThisPeriod = useMemo(
    () => sumTotalReceived(cashflowRange.cashflowReport),
    [cashflowRange.cashflowReport],
  );
  const collectionAmountLastPeriod = useMemo(
    () => sumTotalReceived(prevCashflowRange.cashflowReport),
    [prevCashflowRange.cashflowReport],
  );

  const fmtCurrencyShort = (v: number) => formatCurrency(v);
  const fmtDelta = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  const loadingRow = (metric: string): WeeklyRow => ({
    metric, lastWeek: '—', thisWeek: '—', change: '—', status: 'success',
  });

  // Build a generic financial row (currency-formatted, status by sign of change).
  // For balance snapshots (Closing Balance) we suppress the change indicator
  // since comparing one balance to another as a % isn't meaningful.
  const buildFinancialRow = (
    label: string,
    metric: { thisWeek: number; lastWeek: number; change: number; changePct: number; isBalance?: boolean },
  ): WeeklyRow => ({
    metric: label,
    lastWeek: fmtCurrencyShort(metric.lastWeek),
    thisWeek: fmtCurrencyShort(metric.thisWeek),
    change: metric.isBalance ? '—' : fmtDelta(metric.changePct),
    status: metric.isBalance ? 'success' : (metric.change >= 0 ? 'success' : 'danger'),
  });

  // ── Profit/Loss Overview (left table) ──────────────────────────────
  // Production revenue from Dentally TPIs.
  // Cost of Sales / Admin cost summed at the journal-line level for
  // accounts mapped per location, scoped to the actual week date range.
  const profitLossRows: WeeklyRow[] = useMemo(() => {
    if (profitLoss.isLoading) {
      return [
        loadingRow('Production revenue'),
        loadingRow('Gross profit'),
        loadingRow('Expenses'),
        loadingRow('Net profit'),
      ];
    }

    const { thisPeriod: tp, lastPeriod: lp } = profitLoss.breakdown;
    const fmt = (n: number) => fmtCurrencyShort(n);
    const prettyWeek = (start: string | null, end: string | null) => {
      if (!start || !end) return '—';
      const s = new Date(start);
      const e = new Date(end);
      return `${s.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${e.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
    };

    const weekHeader = (
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs font-semibold text-foreground border-b border-border pb-1.5">
        <div></div>
        <div className="text-right whitespace-nowrap">{prettyWeek(lp.weekStart, lp.weekEnd)}</div>
        <div className="text-right whitespace-nowrap">{prettyWeek(tp.weekStart, tp.weekEnd)}</div>
      </div>
    );
    const breakdownLine = (
      label: string,
      lastVal: number,
      thisVal: number,
      opts: { emphasis?: boolean } = {},
    ) => (
      <div
        className={cn(
          'grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs',
          opts.emphasis && 'font-semibold border-t border-border/60 pt-1.5 mt-0.5 text-foreground',
        )}
      >
        <div className="text-muted-foreground">{label}</div>
        <div className="text-right font-mono whitespace-nowrap text-foreground">{fmt(lastVal)}</div>
        <div className="text-right font-mono whitespace-nowrap text-foreground">{fmt(thisVal)}</div>
      </div>
    );

    return [
      {
        ...buildFinancialRow('Production revenue', profitLoss.production),
        tooltip: (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Production revenue</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              Total revenue from completed treatments by Dentists, Hygienists
              and Therapists, summed within each column's selected date range.
            </div>
            {weekHeader}
            {breakdownLine('Production', profitLoss.production.lastWeek, profitLoss.production.thisWeek, { emphasis: true })}
          </div>
        ),
      },
      {
        ...buildFinancialRow('Gross profit', profitLoss.grossProfit),
        tooltip: (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Gross profit = Production revenue − Cost of Sales</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              Production revenue is the sum of completed treatments by
              Dentists, Hygienists and Therapists for the period (same as
              the main Production revenue row). Cost of Sales is the total
              of all transactions posted to the accounts you've mapped
              under <em>Cost of sales</em> in Location Settings, within
              the selected date range.
            </div>
            {weekHeader}
            {breakdownLine('Production revenue', lp.productionWeek, tp.productionWeek)}
            {breakdownLine('− Cost of Sales', lp.costOfSales, tp.costOfSales)}
            {breakdownLine('= Gross profit', lp.productionWeek - lp.costOfSales, tp.productionWeek - tp.costOfSales, { emphasis: true })}
          </div>
        ),
      },
      {
        ...buildFinancialRow('Expenses', profitLoss.expenses),
        tooltip: (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Expenses = Administrative cost</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              Total of all transactions posted to the accounts you've mapped
              under <em>Administrative cost</em> in Location Settings, within
              the selected date range. Matches the spreadsheet's "Total
              Administrative Costs" line item.
            </div>
            {weekHeader}
            {breakdownLine('Admin cost', lp.adminCost, tp.adminCost, { emphasis: true })}
          </div>
        ),
      },
      {
        ...buildFinancialRow('Net profit', profitLoss.netProfit),
        tooltip: (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Net profit = Gross profit − Administrative cost</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              Gross profit (Treatment Insights Total Revenue minus Cost of
              Sales) less Administrative cost, all totalled within the
              selected date range.
            </div>
            {weekHeader}
            {breakdownLine('Gross profit', lp.productionWeek - lp.costOfSales, tp.productionWeek - tp.costOfSales)}
            {breakdownLine('− Administrative cost', lp.adminCost, tp.adminCost)}
            {breakdownLine('= Net profit', lp.productionWeek - lp.costOfSales - lp.adminCost, tp.productionWeek - tp.costOfSales - tp.adminCost, { emphasis: true })}
          </div>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profitLoss]);

  // ── Cashflow Overview (right table) ────────────────────────────────
  // Same bank-transaction source as the Statement of Cash Flows, summed
  // by transaction date for the actual week (no monthly pro-rating).
  const cashflowRows: WeeklyRow[] = useMemo(() => {
    if (cashflowOverview.isLoading) {
      return [
        loadingRow('Total cash received'),
        loadingRow('Total cash paid'),
        loadingRow('Net cashflow'),
        loadingRow('Closing balance'),
      ];
    }

    const fmt = (n: number) => fmtCurrencyShort(n);
    const cfBreakdownLine = (
      label: string,
      lastVal: number,
      thisVal: number,
      opts: { emphasis?: boolean } = {},
    ) => (
      <div
        className={cn(
          'grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs',
          opts.emphasis && 'font-semibold border-t border-border/60 pt-1.5 mt-0.5 text-foreground',
        )}
      >
        <div className="text-muted-foreground">{label}</div>
        <div className="text-right font-mono whitespace-nowrap text-foreground">{fmt(lastVal)}</div>
        <div className="text-right font-mono whitespace-nowrap text-foreground">{fmt(thisVal)}</div>
      </div>
    );
    const cfLastLabel = columnHeaderLabel(cfLastCol, 'Last Week');
    const cfThisLabel = columnHeaderLabel(cfThisCol, 'This Week');
    const cfHeader = (
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs font-semibold text-foreground border-b border-border pb-1.5">
        <div></div>
        <div className="text-right whitespace-nowrap">{cfLastLabel}</div>
        <div className="text-right whitespace-nowrap">{cfThisLabel}</div>
      </div>
    );

    return [
      {
        ...buildFinancialRow('Total cash received', cashflowOverview.totalReceived),
        tooltip: (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Total cash received</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              All money coming into the bank within the selected period —
              patient payments, deposits, transfers in. Same data as the
              Statement of Cash Flows, totalled for the column's exact
              date range.
            </div>
            {cfHeader}
            {cfBreakdownLine('Total received', cashflowOverview.totalReceived.lastWeek, cashflowOverview.totalReceived.thisWeek, { emphasis: true })}
          </div>
        ),
      },
      {
        ...buildFinancialRow('Total cash paid', cashflowOverview.totalPaid),
        tooltip: (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Total cash paid</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              All money going out of the bank within the selected period —
              bills, payroll, transfers out. Same source as the Statement
              of Cash Flows, totalled for the column's exact date range.
            </div>
            {cfHeader}
            {cfBreakdownLine('Total paid', cashflowOverview.totalPaid.lastWeek, cashflowOverview.totalPaid.thisWeek, { emphasis: true })}
          </div>
        ),
      },
      {
        ...buildFinancialRow('Net cashflow', cashflowOverview.netCashflow),
        tooltip: (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Net cashflow = Total received − Total paid</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              The selected period's net movement of cash. Positive means
              more came in than went out; negative means the bank balance
              fell.
            </div>
            {cfHeader}
            {cfBreakdownLine('Total received', cashflowOverview.totalReceived.lastWeek, cashflowOverview.totalReceived.thisWeek)}
            {cfBreakdownLine('− Total paid', cashflowOverview.totalPaid.lastWeek, cashflowOverview.totalPaid.thisWeek)}
            {cfBreakdownLine('= Net cashflow', cashflowOverview.netCashflow.lastWeek, cashflowOverview.netCashflow.thisWeek, { emphasis: true })}
          </div>
        ),
      },
      {
        ...buildFinancialRow('Closing balance', cashflowOverview.closingBalance),
        tooltip: (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Closing balance</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              Cumulative receipts minus payments from the start of the
              current year up to the last day of the selected period — the
              same way the Statement of Cash Flows page calculates it,
              just sliced for the column's date range. A snapshot, so the
              % change column is hidden.
            </div>
            {cfHeader}
            {cfBreakdownLine('Closing balance', cashflowOverview.closingBalance.lastWeek, cashflowOverview.closingBalance.thisWeek, { emphasis: true })}
          </div>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashflowOverview]);

  // Presets allowed for each column kind.
  // "Last Week" column → only Last Month/Quarter/Year (+ Custom).
  // "This Week" column → only This Month/Quarter/Year (+ Custom).
  const lastColumnPresets: Array<'last-month' | 'last-quarter' | 'last-year'> = [
    'last-month', 'last-quarter', 'last-year',
  ];
  const thisColumnPresets: Array<'this-month' | 'this-quarter' | 'this-year'> = [
    'this-month', 'this-quarter', 'this-year',
  ];

  // Renders the column header content: label + calendar trigger that opens
  // a per-column ChartDateFilter, plus a clear-icon when overridden.
  const renderColumnHeader = (
    c: ColFilter,
    setC: Dispatch<SetStateAction<ColFilter>>,
    fallbackLabel: string,
    kind: 'last' | 'this',
  ) => (
    <div className="flex items-center justify-end gap-1">
      <span className="whitespace-nowrap">{columnHeaderLabel(c, fallbackLabel)}</span>
      <ChartDateFilter
        filter={c.filter ?? (kind === 'this' ? 'this-month' : 'last-month')}
        // Use functional updates: ChartDateFilter fires
        // onCustomRangeChange and onFilterChange back-to-back when the user
        // confirms a custom range. Object-spread updates would both read
        // the same stale `c`, causing the second update to clobber the
        // first (the customRange would reset back to {from:null,to:null}).
        onFilterChange={(f) => setC((prev) => ({ ...prev, filter: f }))}
        customRange={c.customRange}
        onCustomRangeChange={(cr) => setC((prev) => ({ ...prev, customRange: cr }))}
        align="end"
        allowedFilters={kind === 'this' ? thisColumnPresets : lastColumnPresets}
        trigger={
          <button
            type="button"
            className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground p-0.5 rounded"
            aria-label={`Filter ${fallbackLabel} column`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
          </button>
        }
      />
      {c.filter && (
        <button
          type="button"
          onClick={() => setC({ filter: null, customRange: { from: null, to: null } })}
          className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground p-0.5 rounded"
          aria-label={`Reset ${fallbackLabel} column to default`}
        >
          <XIcon className="w-3 h-3" />
        </button>
      )}
    </div>
  );

  // Prepare context data for AI (real values only — reflects the selected date range)
  const round2 = (n: number | null | undefined) =>
    n === null || n === undefined ? null : Math.round((Number(n) || 0) * 100) / 100;
  const selectedLocationName = selectedLocationId
    ? (locations.find(l => l.id === selectedLocationId)?.location_name || null)
    : 'All Locations';
  const perLocationRows = locationMetricsMap
    ? Array.from(locationMetricsMap.entries()).map(([id, m]) => {
        const loc = locations.find(l => l.id === id);
        return {
          name: loc?.location_name || id,
          revenue: round2(m.revenue),
          totalCosts: round2(m.totalCosts),
          netProfit: round2(m.revenue - m.totalCosts),
          ebitdaPercent: m.revenue > 0 ? round2(((m.revenue - m.totalCosts) / m.revenue) * 100) : null,
        };
      })
    : [];
  const byRevenueDesc = [...perLocationRows].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const byEbitdaAsc = [...perLocationRows].sort((a, b) => (a.ebitdaPercent ?? Infinity) - (b.ebitdaPercent ?? Infinity));

  const dashboardData = {
    page: 'dashboard',
    selectedLocationId: selectedLocationId || null,
    selectedLocationName,
    period: {
      from: dateRange.startDate ? dateRange.startDate.toISOString().slice(0, 10) : null,
      to: dateRange.endDate ? dateRange.endDate.toISOString().slice(0, 10) : null,
    },
    netProduction: {
      currentMonth: round2(currentMonthTotal),
      trendPct: round2(netProductionTrend),
    },
    ebitda: {
      revenue: round2(orgAggregate.revenue),
      totalCosts: round2(orgAggregate.totalCosts),
      percentage: round2(orgAggregate.ebitdaPercent),
    },
    collections: {
      latestPeriodAmount: round2(collectionAmountThisPeriod),
      previousPeriodAmount: round2(collectionAmountLastPeriod),
      collectionRatePct: financial.isLoading ? null : round2(financial.collectionRate.thisWeek),
    },
    profitLoss: profitLossRows,
    cashflow: cashflowRows,
    locationsCount: locations.length,
    locations: perLocationRows,
    topByRevenue: byRevenueDesc.slice(0, 10),
    bottomByRevenue: [...byRevenueDesc].reverse().slice(0, 10),
    lowestEbitda: byEbitdaAsc.slice(0, 10),
    lossMaking: perLocationRows.filter(l => (l.netProfit ?? 0) < 0),
    isMetricsLoading: isLocationMetricsLoading,
  };

  return (
    <MainLayout userRole="admin" aiContext={dashboardData}>
       <Helmet>
        <title>Dashboard</title>
        <meta
          name="description"
          content="View real-time dental practice performance, revenue, and patient metrics."
        />
      </Helmet>
      <div className="space-y-6 animate-fade-in">


{/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Executive Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Financial overview across {locations.length} location{locations.length === 1 ? '' : 's'} •{' '}
              {dateRange.startDate.toLocaleDateString('en-GB')} – {dateRange.endDate.toLocaleDateString('en-GB')}
            </p>
          </div>
        </div>

        {/* AI Summary Card */}
        <AISummaryCard
          page="dashboard"
          role="admin"
          data={dashboardData}
          // className="lg:max-w-2xl"
        />

        {/* Primary KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Net Production/Revenue — monthly production summed across providers (dentists + therapists + hygienists) */}
          <KPICard
            title="Net Production"
            value={isProductionLoading ? '—' : formatCurrency(currentMonthTotal)}
            trend={netProductionTrend}
            trendLabel="vs previous period"
            status={netProductionTrend >= 0 ? 'success' : 'warning'}
            sparklineData={monthlyTotals}
            subtitle={`For ${dateRange.startDate.toLocaleDateString('en-GB')} – ${dateRange.endDate.toLocaleDateString('en-GB')}`}
            onClick={() => navigate('/performance')}
            helpText={
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">Net Production</div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  The total value of completed treatments delivered by all
                  providers — dentists, therapists and hygienists — added up
                  across the selected period. The trend compares this period
                  against the previous period of the same length.
                </div>
              </div>
            }
          />

          {/* EBITDA Margin = (Revenue - Costs) / Revenue × 100, aggregated across locations */}
          <KPICard
            title="EBITDA Margin"
            value={
              isLocationMetricsLoading
                ? '—'
                : orgAggregate.ebitdaPercent != null
                  ? `${Math.round(orgAggregate.ebitdaPercent)}%`
                  : '—'
            }
            status={
              orgAggregate.ebitdaPercent != null && orgAggregate.ebitdaPercent < 25 ? 'warning' : 'success'
            }
            onClick={() => navigate('/profitability')}
            helpText={
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">EBITDA Margin = (Revenue − Costs) ÷ Revenue × 100</div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  The share of revenue left as operating profit after running
                  costs, shown as a percentage. Revenue and costs are totalled
                  across all your locations for the selected period. A margin
                  below 25% is flagged for review.
                </div>
              </div>
            }
          >
            <div className="space-y-2">
              <ProgressBar
                value={orgAggregate.ebitdaPercent ?? 0}
                max={100}
                variant={
                  orgAggregate.ebitdaPercent != null && orgAggregate.ebitdaPercent < 25 ? 'warning' : 'success'
                }
                size="sm"
              />
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  Revenue: {formatCurrency(orgAggregate.revenue)}
                </span>
                <span className="text-muted-foreground">
                  Costs: {formatCurrency(orgAggregate.totalCosts)}
                </span>
              </div>
            </div>
          </KPICard>

          {/* Collections — Total Received (latest month) from cashflow + invoice paid rate */}
          <KPICard
            title="Collections"
            value={isCashflowLoading ? '—' : formatCurrency(collectionAmountThisPeriod)}
            status={
              !financial.isLoading && financial.collectionRate.thisWeek < 97 ? 'warning' : 'success'
            }
            onClick={() => navigate('/cashflow/preparing-statement')}
            helpText={
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">Collections</div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  The total cash actually received in the period. The collection
                  rate underneath is the share of invoiced amounts that has been
                  paid — money collected ÷ money invoiced. A rate below 97% is
                  flagged so you can chase what's outstanding.
                </div>
              </div>
            }
          >
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold">
                  {financial.isLoading ? '—' : `${financial.collectionRate.thisWeek.toFixed(2)}%`}
                </span>
                <span className="text-xs text-muted-foreground">collection rate (this week)</span>
              </div>
              <ProgressBar
                value={financial.isLoading ? 0 : financial.collectionRate.thisWeek}
                max={100}
                variant={
                  !financial.isLoading && financial.collectionRate.thisWeek < 97 ? 'warning' : 'success'
                }
                size="sm"
              />
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  Last period: {isCashflowLoading ? '—' : formatCurrency(collectionAmountLastPeriod)}
                </span>
                <TrendIndicator value={financial.isLoading ? 0 : financial.collectionRate.changePct} />
              </div>
            </div>
          </KPICard>

        </div>

        {/* Secondary Section: Profit/Loss Overview + Cashflow Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Profit/Loss Overview */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="text-base font-semibold mb-4">Profit/Loss Overview</h2>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="data-table">
                <thead>
                  <tr className="bg-muted/50">
                    <th>Metric</th>
                    <th className="text-right">
                      {renderColumnHeader(pnlLastCol, setPnlLastCol, 'Last Week', 'last')}
                    </th>
                    <th className="text-right">
                      {renderColumnHeader(pnlThisCol, setPnlThisCol, 'This Week', 'this')}
                    </th>
                    <th className="text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  <TooltipProvider delayDuration={150}>
                    {profitLossRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {row.metric}
                            {row.tooltip && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-muted-foreground/60 hover:text-muted-foreground"
                                    aria-label={`How ${row.metric} is calculated`}
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  align="start"
                                  sideOffset={8}
                                  collisionPadding={16}
                                  className="!overflow-visible w-[420px] max-w-[calc(100vw-2rem)] p-4 whitespace-normal break-words"
                                >
                                  {row.tooltip}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        </td>
                        <td className="text-right text-muted-foreground">{row.lastWeek}</td>
                        <td className="text-right">{row.thisWeek}</td>
                        <td className="text-right">
                          <span className={cn(
                            'font-medium',
                            row.status === 'success' ? 'text-success' : 'text-danger'
                          )}>
                            {row.change}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </TooltipProvider>
                </tbody>
              </table>
            </div>
          </div>

          {/* Cashflow Overview */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="text-base font-semibold mb-4">Cashflow Overview</h2>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="data-table">
                <thead>
                  <tr className="bg-muted/50">
                    <th>Metric</th>
                    <th className="text-right">
                      {renderColumnHeader(cfLastCol, setCfLastCol, 'Last Week', 'last')}
                    </th>
                    <th className="text-right">
                      {renderColumnHeader(cfThisCol, setCfThisCol, 'This Week', 'this')}
                    </th>
                    <th className="text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  <TooltipProvider delayDuration={150}>
                    {cashflowRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {row.metric}
                            {row.tooltip && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-muted-foreground/60 hover:text-muted-foreground"
                                    aria-label={`How ${row.metric} is calculated`}
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  align="start"
                                  sideOffset={8}
                                  collisionPadding={16}
                                  className="!overflow-visible w-[420px] max-w-[calc(100vw-2rem)] p-4 whitespace-normal break-words"
                                >
                                  {row.tooltip}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        </td>
                        <td className="text-right text-muted-foreground">{row.lastWeek}</td>
                        <td className="text-right">{row.thisWeek}</td>
                        <td className="text-right">
                          <span className={cn(
                            'font-medium',
                            row.status === 'success' ? 'text-success' : 'text-danger'
                          )}>
                            {row.change}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </TooltipProvider>
                </tbody>
              </table>
            </div>
          </div>

        </div>

      </div>
    </MainLayout>
  );
}
