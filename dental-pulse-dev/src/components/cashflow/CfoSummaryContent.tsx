/**
 * CFO Summary content — the executive read of the SAME 13-week forecast the main
 * forecast page builds (via useCashflowForecast). Rendered both as a standalone
 * page (CashflowCfoSummary) and as the "CFO Summary" tab on the forecast page.
 *
 * It owns its own data fetch (offset 0, current window) plus a compact toolbar
 * (period/threshold caption + Excel/PDF download). The host provides the page
 * title / layout.
 */

import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Download, ShieldAlert, AlertTriangle, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useCashflowForecast, type ForecastRow } from '@/hooks/useCashflowForecast';
import {
  SCENARIO_KEYS,
  SCENARIO_LABELS,
  scenarioPct,
  scenarioFactor,
  type ScenarioKey,
} from '@/hooks/useCashflowForecastSettings';
import {
  exportCfoSummaryXlsx,
  exportCfoSummaryPdf,
  serializeChartSvg,
  type CfoSummaryExportData,
} from '@/lib/cfoSummaryExport';
import { computeScenarioClosingCash } from '@/lib/forecastDisplay';
import { SITE_LOGOS } from '@/lib/integrationLogos';
import { MetricHelp } from '@/components/dashboard/MetricHelp';
import { useOrganization } from '@/hooks/useOrganization';
import { formatGbp } from '@/utils/formatMoney';

const END_CASH_THRESHOLD_KEY = 'end_cash_threshold';

// ── money formatting ──
const round = (v: number) => Math.round(v);

// Distinct colour per scenario case so all option lines read apart on the chart.
const SCENARIO_COLORS: Record<ScenarioKey, string> = {
  best: '#16a34a',   // green — upside
  likely: '#2563eb', // blue — most likely
  worst: '#dc2626',  // red — downside
};
const gbp = (v: number) => formatGbp(round(v));
const gbpCompact = (v: number) => {
  const n = round(v);
  const a = Math.abs(n);
  if (a >= 1_000_000) {
    const body = `£${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`;
    return n < 0 ? `(${body})` : body;
  }
  if (a >= 1_000) {
    const body = `£${(a / 1_000).toFixed(a >= 100_000 ? 0 : 1)}k`;
    return n < 0 ? `(${body})` : body;
  }
  return formatGbp(n);
};
const gbpSigned = (v: number) => gbpCompact(v);

interface CfoException { tone: 'cfo' | 'warning' | 'info'; title: string; detail: string; }
interface CashStats { ending: number; min: number; minWeek: number; weeksBelow: number; negativeWeeks: number; }

function cashStats(endCash: number[], startCash: number, thr: (number | null)[]): CashStats {
  let min = Infinity;
  let minWeek = 1;
  let weeksBelow = 0;
  let negativeWeeks = 0;
  endCash.forEach((v, i) => {
    if (v < min) { min = v; minWeek = i + 1; }
    const t = thr[i];
    if (t != null && v < t) weeksBelow++;
    if (v < 0) negativeWeeks++;
  });
  if (!Number.isFinite(min)) min = startCash;
  return { ending: endCash[endCash.length - 1] ?? startCash, min, minWeek, weeksBelow, negativeWeeks };
}

export default function CfoSummaryContent() {
  // Chart wrappers — their <svg> is captured (with computed styles inlined) for
  // the PDF export so the graphs travel with the data.
  const chart1Ref = useRef<HTMLDivElement>(null);
  const chart2Ref = useRef<HTMLDivElement>(null);

  // The practice/company name shown on the LEFT of the exported masthead.
  const { organization } = useOrganization();
  const f = useCashflowForecast(0, { includeCurrentWindow: false });
  const {
    weeks,
    weeklyTotals,
    weeklyOutflowTotals,
    netCashFlow,
    totalWeeklyNet,
    endCash,
    startCash,
    startCashSet,
    startCashAutofilled,
    thresholdsByKey,
    nhsRow,
    membershipRows,
    privateRow,
    directCostRows,
    expenseRows,
    forecastSettings,
    saveForecastSettings,
    isLoading,
  } = f;

  const scenario = forecastSettings.scenario;
  const factor = scenarioFactor(scenario);

  // Which of the 4 closing-cash lines are drawn. Base is on by default; each line
  // can be toggled on/off by clicking its legend entry.
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({ base: true, best: true, likely: true, worst: true });
  const toggleLine = (key: string) => setVisibleLines((prev) => ({ ...prev, [key]: !prev[key] }));
  // The active scenario drives the KPI cards / impact table and thickens its line.
  const setScenarioActive = (active: ScenarioKey | null) =>
    saveForecastSettings({ ...forecastSettings, preset: 'custom', scenario: { ...forecastSettings.scenario, active } });

  // The CFO Summary always opens on Base case — reset the active scenario to Base once
  // the settings have loaded (only when it isn't already Base, to avoid a needless write).
  const didResetScenario = useRef(false);
  useEffect(() => {
    if (isLoading || didResetScenario.current) return;
    didResetScenario.current = true;
    if (forecastSettings.scenario.active !== null) setScenarioActive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // The end-cash minimum-balance threshold (carried forward per week; may be unset).
  const thrSeries = thresholdsByKey?.[END_CASH_THRESHOLD_KEY] ?? weeks.map(() => null);
  const thrSet = thrSeries.some((t) => t != null);
  const thrValue = [...thrSeries].reverse().find((t) => t != null) ?? null;

  const weekLabels = weeks.map((w) => w.weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  const asOf = weeks[0]?.weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) ?? '';
  const periodLabel = weeks.length
    ? `${weekLabels[0]} – ${new Date(weeks[weeks.length - 1].weekStart.getTime() + 6 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '';

  // Income rows carry the scenario factor; invert it per cell (skipping overridden /
  // known-fact cells, which the engine never scaled) to recover the exact base income.
  const incomeRows = useMemo(() => [nhsRow, ...(membershipRows ?? []), privateRow].filter(Boolean) as ForecastRow[], [nhsRow, membershipRows, privateRow]);

  const derived = useMemo(() => {
    // Series computation is SHARED with the Group Dashboard Cash Runway
    // (src/lib/forecastDisplay.ts) so both draw identical lines.
    const series = computeScenarioClosingCash({
      weekCount: weeks.length,
      weeklyTotals: weeklyTotals ?? [],
      totalWeeklyNet: totalWeeklyNet ?? [],
      endCash: endCash ?? null,
      startCash,
      incomeRows,
      factor,
      bestPct: scenario.bestPct,
      likelyPct: scenario.likelyPct,
      worstPct: scenario.worstPct,
    });
    const { scnEnd, baseEnd, scnEndByKey, baseInflow } = series;
    return {
      scn: cashStats(scnEnd, startCash, thrSeries),
      base: cashStats(baseEnd, startCash, thrSeries),
      scnEnd,
      baseEnd,
      scnEndByKey,
      scnInflowTotal: (weeklyTotals ?? []).reduce((s, v) => s + v, 0),
      baseInflowTotal: baseInflow.reduce((s, v) => s + v, 0),
      outflowTotal: (weeklyOutflowTotals ?? []).reduce((s, v) => s + v, 0),
    };
  }, [weeklyTotals, totalWeeklyNet, endCash, weeklyOutflowTotals, incomeRows, factor, startCash, thrSeries, weeks, scenario.bestPct, scenario.likelyPct, scenario.worstPct]);

  const endDelta = derived.scn.ending - derived.base.ending;
  const minDelta = derived.scn.min - derived.base.min;

  const chartData = weeks.map((_, i) => ({
    week: weekLabels[i],
    base: round(derived.baseEnd[i] ?? 0),
    scenario: round(derived.scnEnd[i] ?? 0),
    best: round(derived.scnEndByKey.best[i] ?? 0),
    likely: round(derived.scnEndByKey.likely[i] ?? 0),
    worst: round(derived.scnEndByKey.worst[i] ?? 0),
    threshold: thrSet ? round(thrSeries[i] ?? 0) : undefined,
    inflow: round(weeklyTotals?.[i] ?? 0),
    outflow: -round(weeklyOutflowTotals?.[i] ?? 0),
    net: round(totalWeeklyNet?.[i] ?? 0),
  }));

  // Biggest inflow / outflow drivers by 13-week total (drops empty rows).
  const rowTotal = (r: ForecastRow) => (r.values ?? []).reduce((s, v) => s + v, 0);
  const outflowRows = [...(directCostRows ?? []), ...(expenseRows ?? [])];
  const topInflow = incomeRows.map((r) => ({ label: r.label, total: rowTotal(r) })).filter((r) => Math.round(r.total) !== 0).sort((a, b) => b.total - a.total).slice(0, 6);
  const topOutflow = outflowRows.map((r) => ({ label: r.label, total: rowTotal(r) })).filter((r) => Math.round(r.total) !== 0).sort((a, b) => b.total - a.total).slice(0, 6);

  // CFO-review exceptions — data-quality + risk checks on the real forecast, grouped
  // into review-required / warnings / informational (no top-of-page status badge).
  const exceptions = useMemo<CfoException[]>(() => {
    const out: CfoException[] = [];
    if (!startCashSet || startCash === 0) out.push({ tone: 'cfo', title: 'Opening cash not set', detail: 'Enter your current bank balance on the forecast — closing cash is meaningless without it.' });
    if (derived.scn.weeksBelow > 0 && thrSet) out.push({ tone: 'cfo', title: 'Cash dips below your minimum', detail: `Closing cash falls under ${thrValue != null ? gbp(thrValue) : 'your threshold'} in ${derived.scn.weeksBelow} week(s), first at Week ${derived.scn.minWeek}.` });
    if (derived.scn.negativeWeeks > 0) out.push({ tone: 'cfo', title: 'Cash goes negative', detail: `Projected closing cash is below zero in ${derived.scn.negativeWeeks} week(s) — an overdraft or funding gap.` });
    if (!thrSet) out.push({ tone: 'warning', title: 'No minimum-balance threshold set', detail: 'Set one on the full forecast (End Cash row) to flag weeks that dip too low.' });
    if (derived.outflowTotal === 0) out.push({ tone: 'warning', title: 'Outflows look understated', detail: 'No cost rows carry figures — check your cost accounts are mapped so outflows are captured.' });
    if (scenario.active) out.push({ tone: 'info', title: `${SCENARIO_LABELS[scenario.active]} scenario active`, detail: `Projected income is ${scenarioPct(scenario) >= 0 ? 'lifted' : 'lowered'} ${Math.abs(scenarioPct(scenario))}%. Switch to Base case for reconciled figures.` });
    return out;
  }, [startCashSet, startCash, derived, thrSet, thrValue, scenario]);

  const cfoItems = exceptions.filter((e) => e.tone === 'cfo');
  const warnItems = exceptions.filter((e) => e.tone === 'warning');
  const infoItems = exceptions.filter((e) => e.tone === 'info');

  const countDelta = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  const buildExportData = (): CfoSummaryExportData => {
    const rootStyle = getComputedStyle(document.documentElement);
    const hsl = (v: string) => `hsl(${v.trim()})`;
    const foregroundColor = hsl(rootStyle.getPropertyValue('--foreground'));

    return {
      brand: {
        name: 'DentPulse',
        logoUrl: SITE_LOGOS.logoLight,
        tagline: 'Practice financial intelligence',
        companyName: organization?.name ?? undefined,
        faviconUrl: `${window.location.origin}/favicon-icon-design.ico`,
      },
      title: '13-Week Cash Flow Forecast — CFO Summary',
      period: periodLabel,
      asOf,
      thresholdLabel: thrSet && thrValue != null ? gbp(thrValue) : 'not set',
      scenarioLabel: scenario.active ? `${SCENARIO_LABELS[scenario.active]} (${scenarioPct(scenario) >= 0 ? '+' : ''}${scenarioPct(scenario)}%)` : undefined,
      generatedOn: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      kpis: [
        { label: 'Opening cash', value: gbpCompact(startCash) },
        { label: 'Base ending', value: gbpCompact(derived.base.ending) },
        { label: 'Scenario ending', value: gbpCompact(derived.scn.ending) },
        { label: 'Base min cash', value: gbpCompact(derived.base.min), sub: `Week ${derived.base.minWeek}` },
        { label: 'Scenario min cash', value: gbpCompact(derived.scn.min), sub: `Week ${derived.scn.minWeek}` },
        { label: 'Weeks below threshold', value: thrSet ? `${derived.scn.weeksBelow}` : '—', sub: thrSet ? `base ${derived.base.weeksBelow}` : 'no threshold' },
        { label: 'Δ vs base ending', value: gbpSigned(endDelta) },
      ],
      weekLabels,
      series: {
        base: derived.baseEnd.map(round),
        scenario: derived.scnEnd.map(round),
        inflow: (weeklyTotals ?? []).map(round),
        outflow: (weeklyOutflowTotals ?? []).map(round),
        net: (totalWeeklyNet ?? []).map(round),
        threshold: thrSet ? thrSeries : undefined,
      },
      impact: [
        { metric: 'Closing cash (Week 13)', base: gbp(derived.base.ending), scenario: gbp(derived.scn.ending), delta: gbpSigned(endDelta) },
        { metric: 'Total income (13wk)', base: gbp(derived.baseInflowTotal), scenario: gbp(derived.scnInflowTotal), delta: gbpSigned(derived.scnInflowTotal - derived.baseInflowTotal) },
        { metric: 'Minimum cash', base: gbp(derived.base.min), scenario: gbp(derived.scn.min), delta: gbpSigned(minDelta) },
        { metric: 'Minimum cash week', base: `Week ${derived.base.minWeek}`, scenario: `Week ${derived.scn.minWeek}`, delta: '—' },
        { metric: 'Weeks below threshold', base: thrSet ? `${derived.base.weeksBelow}` : '—', scenario: thrSet ? `${derived.scn.weeksBelow}` : '—', delta: thrSet ? countDelta(derived.base.weeksBelow - derived.scn.weeksBelow) : '—' },
      ],
      topInflow,
      topOutflow,
      exceptions: [
        { group: 'CFO review required', items: cfoItems.map((e) => ({ title: e.title, detail: e.detail })) },
        { group: 'Warnings', items: warnItems.map((e) => ({ title: e.title, detail: e.detail })) },
        { group: 'Informational', items: infoItems.map((e) => ({ title: e.title, detail: e.detail })) },
      ],
      interpretation: [
        `Under ${scenario.active ? `${SCENARIO_LABELS[scenario.active]} (${scenarioPct(scenario) >= 0 ? '+' : ''}${scenarioPct(scenario)}% income)` : 'the base case'}, closing cash moves ${gbpSigned(endDelta)} vs base to ${gbp(derived.scn.ending)}, and minimum cash lands at ${gbp(derived.scn.min)} in Week ${derived.scn.minWeek}${thrSet ? (derived.scn.weeksBelow > 0 ? `, breaching your minimum in ${derived.scn.weeksBelow} week(s).` : ', staying above your minimum all quarter.') : '.'}`,
        thrSet
          ? derived.scn.weeksBelow > 0
            ? `Plan cover before Week ${derived.scn.minWeek}, when closing cash is at its lowest (${gbp(derived.scn.min)}).`
            : `The lowest point is ${gbp(derived.scn.min)} in Week ${derived.scn.minWeek} — comfortably above your minimum balance.`
          : `Set a minimum-balance threshold on the full forecast to flag any weeks that dip too low.`,
      ],
      charts: [
        {
          title: 'Closing cash — base vs scenarios',
          svg: serializeChartSvg(chart1Ref.current?.querySelector('svg')),
          legend: [
            { label: 'Base closing cash', color: '#94a3b8' },
            { label: SCENARIO_LABELS.best, color: SCENARIO_COLORS.best },
            { label: SCENARIO_LABELS.likely, color: SCENARIO_COLORS.likely },
            { label: SCENARIO_LABELS.worst, color: SCENARIO_COLORS.worst },
            ...(thrSet ? [{ label: 'Minimum balance', color: '#f59e0b' }] : []),
          ],
        },
        {
          title: 'Weekly cash movement',
          svg: serializeChartSvg(chart2Ref.current?.querySelector('svg')),
          legend: [
            { label: 'Inflow', color: '#16a34a' },
            { label: 'Outflow', color: '#ef4444' },
            { label: 'Net cash flow', color: foregroundColor },
          ],
        },
      ],
    };
  };

  return (
    <div className="space-y-5">
      {/* Toolbar — period / threshold caption + download */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {asOf ? `As of ${asOf} · ` : ''}13-week horizon · threshold {thrSet && thrValue != null ? gbp(thrValue) : 'not set'}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Download" className="inline-flex items-center justify-center rounded-md border border-border px-2 py-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
              <Download className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportCfoSummaryXlsx(buildExportData())}>Export to Excel</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportCfoSummaryPdf(buildExportData())}>Export to PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <>
          {/* KPI cards — base vs scenario */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Opening cash" value={gbpCompact(startCash)} sub={startCashAutofilled ? 'from accounting' : undefined} help={startCashAutofilled
              ? "Your starting cash for the 13-week horizon, auto-filled from your connected accounting software's closing bank balance. Enter a figure on the forecast to override it."
              : "Your bank balance at the start of the 13-week horizon — the cash you're starting from. Set it on the forecast, or connect your accounting software to auto-fill it."} />
            <Kpi label="Base ending" value={gbpCompact(derived.base.ending)} help="Projected closing cash at the end of Week 13 under the Base case (no scenario uplift) — opening cash plus every week's net cash flow." />
            <Kpi label="Scenario ending" value={gbpCompact(derived.scn.ending)} accent={endDelta > 0 ? 'pos' : endDelta < 0 ? 'neg' : undefined} help="Projected closing cash at Week 13 under the selected scenario. On Base case this equals Base ending; Best/Most likely/Worst flex projected income by their %." />
            <Kpi label="Base min cash" value={gbpCompact(derived.base.min)} sub={`Week ${derived.base.minWeek}`} help="The lowest weekly closing cash across the 13 weeks under the Base case, and the week it happens — your tightest point." />
            <Kpi label="Scenario min cash" value={gbpCompact(derived.scn.min)} sub={`Week ${derived.scn.minWeek}`} accent={thrSet && thrValue != null && derived.scn.min < thrValue ? 'neg' : minDelta >= 0 ? 'pos' : 'neg'} help="The lowest weekly closing cash under the selected scenario, and the week it happens. Turns red if it dips below your minimum-balance threshold." />
            <Kpi label="Weeks below threshold" value={thrSet ? `${derived.scn.weeksBelow}` : '—'} sub={thrSet ? `base ${derived.base.weeksBelow}` : 'no threshold'} accent={derived.scn.weeksBelow > 0 ? 'neg' : 'pos'} help="How many of the 13 weeks close below your minimum-balance threshold under the selected scenario (Base case shown alongside). Shows a dash until you set a threshold on the forecast." />
            <Kpi label="Δ vs base ending" value={gbpSigned(endDelta)} accent={endDelta > 0 ? 'pos' : endDelta < 0 ? 'neg' : undefined} help="The difference between the scenario's Week-13 closing cash and the Base case — how much better or worse off the scenario leaves you. £0 on Base case." />
          </div>

          {/* Scenario selector — opens on Base; picks the active case (drives KPIs / impact table) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Scenario:</span>
            <button type="button" onClick={() => setScenarioActive(null)} className={pill(scenario.active === null)}>Base case</button>
            {SCENARIO_KEYS.map((k) => {
              const pct = k === 'best' ? scenario.bestPct : k === 'likely' ? scenario.likelyPct : scenario.worstPct;
              return (
                <button key={k} type="button" onClick={() => setScenarioActive(k)} className={pill(scenario.active === k)}>
                  {SCENARIO_LABELS[k]} <span className="tabular-nums opacity-80">({pct >= 0 ? '+' : ''}{pct}%)</span>
                </button>
              );
            })}
          </div>

          {/* Ending cash — base vs scenarios */}
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Closing cash — base vs scenarios</h2>
              <p className="mb-3 text-xs text-muted-foreground">Click a series in the legend below to show or hide it.</p>
              <div ref={chart1Ref}>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => gbpCompact(v)} width={64} />
                  <RTooltip formatter={(v: number, n: string) => [gbp(v), labelFor(n)]} contentStyle={{ fontSize: 12 }} />
                  <Legend
                    formatter={(value) => (
                      <span style={{ opacity: visibleLines[String(value)] === false ? 0.4 : 1 }}>{labelFor(String(value))}</span>
                    )}
                    onClick={(entry) => {
                      const key = (entry as { dataKey?: unknown; value?: unknown }).dataKey ?? (entry as { dataKey?: unknown; value?: unknown }).value;
                      if (typeof key === 'string') toggleLine(key);
                    }}
                    wrapperStyle={{ fontSize: 12, cursor: 'pointer' }}
                  />
                  {thrSet && <ReferenceLine y={thrValue ?? 0} stroke="#f59e0b" strokeDasharray="5 4" label={{ value: 'Threshold', position: 'insideTopRight', fontSize: 11, fill: '#f59e0b' }} />}
                  <Line type="monotone" dataKey="base" stroke="#94a3b8" strokeWidth={2} dot={false} strokeDasharray="4 3" hide={visibleLines.base === false} />
                  {SCENARIO_KEYS.map((k) => (
                    <Line
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stroke={SCENARIO_COLORS[k]}
                      strokeWidth={scenario.active === k ? 3 : 2}
                      strokeOpacity={scenario.active == null || scenario.active === k ? 1 : 0.4}
                      dot={false}
                      hide={visibleLines[k] === false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Weekly cash movement */}
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Weekly cash movement</h2>
              <div ref={chart2Ref}>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => gbpCompact(v)} width={64} />
                  <RTooltip formatter={(v: number, n: string) => [gbp(Math.abs(v)), labelFor(n)]} contentStyle={{ fontSize: 12 }} />
                  <Legend formatter={labelFor} wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="#cbd5e1" />
                  <Bar dataKey="inflow" fill="#16a34a" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="outflow" fill="#ef4444" radius={[0, 0, 2, 2]} />
                  <Line type="monotone" dataKey="net" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Scenario impact vs base */}
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Scenario impact vs base</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Metric</th>
                      <th className="py-2 pr-4 font-medium">Base</th>
                      <th className="py-2 pr-4 font-medium">Scenario</th>
                      <th className="py-2 font-medium">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ImpactRow label="Closing cash (Week 13)" base={gbp(derived.base.ending)} scen={gbp(derived.scn.ending)} delta={endDelta} />
                    <ImpactRow label="Total income (13wk)" base={gbp(derived.baseInflowTotal)} scen={gbp(derived.scnInflowTotal)} delta={derived.scnInflowTotal - derived.baseInflowTotal} />
                    <ImpactRow label="Minimum cash" base={gbp(derived.base.min)} scen={gbp(derived.scn.min)} delta={minDelta} />
                    <ImpactRow label="Minimum cash week" base={`Week ${derived.base.minWeek}`} scen={`Week ${derived.scn.minWeek}`} />
                    <ImpactRow label="Weeks below threshold" base={thrSet ? `${derived.base.weeksBelow}` : '—'} scen={thrSet ? `${derived.scn.weeksBelow}` : '—'} delta={thrSet ? derived.base.weeksBelow - derived.scn.weeksBelow : undefined} isCount />
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {scenario.active ? `Driver: ${SCENARIO_LABELS[scenario.active]} — projected income ${scenarioPct(scenario) >= 0 ? '+' : ''}${scenarioPct(scenario)}%.` : 'No scenario applied (base case) — pick a case above to compare.'}
              </p>
            </CardContent>
          </Card>

          {/* Top drivers */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <DriverCard title="Biggest inflows" icon={<ArrowUpRight className="h-4 w-4 text-emerald-600" />} rows={topInflow} tone="pos" total={derived.scnInflowTotal} />
            <DriverCard title="Biggest outflows" icon={<ArrowDownRight className="h-4 w-4 text-red-600" />} rows={topOutflow} tone="neg" total={derived.outflowTotal} />
          </div>

          {/* Exceptions / CFO review */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ExceptionGroup icon={<ShieldAlert className="h-4 w-4" />} title="CFO review required" tone="danger" items={cfoItems} />
            <ExceptionGroup icon={<AlertTriangle className="h-4 w-4" />} title="Warnings" tone="warning" items={warnItems} />
            <ExceptionGroup icon={<Info className="h-4 w-4" />} title="Informational" tone="info" items={infoItems} />
          </div>

          {/* Interpretation */}
          <Card>
            <CardContent className="space-y-2 p-5 text-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {derived.scn.ending >= startCash ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
                CFO interpretation
              </h2>
              <p className="text-muted-foreground">
                Under <span className="font-medium text-foreground">{scenario.active ? `${SCENARIO_LABELS[scenario.active]} (${scenarioPct(scenario) >= 0 ? '+' : ''}${scenarioPct(scenario)}% income)` : 'the base case'}</span>,
                closing cash {endDelta >= 0 ? 'moves' : 'moves'} {gbpSigned(endDelta)} vs base to <span className="font-medium text-foreground">{gbp(derived.scn.ending)}</span>, and minimum cash lands at {gbp(derived.scn.min)} in Week {derived.scn.minWeek}
                {thrSet ? (derived.scn.weeksBelow > 0 ? `, breaching your minimum in ${derived.scn.weeksBelow} week(s).` : ', staying above your minimum all quarter.') : '.'}
              </p>
              <p className="text-muted-foreground">
                {thrSet
                  ? derived.scn.weeksBelow > 0
                    ? `Plan cover before Week ${derived.scn.minWeek}, when closing cash is at its lowest (${gbp(derived.scn.min)}).`
                    : `The lowest point is ${gbp(derived.scn.min)} in Week ${derived.scn.minWeek} — comfortably above your minimum balance.`
                  : `Set a minimum-balance threshold on the full forecast to flag any weeks that dip too low.`}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── sub-components ──
const pill = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'}`;

function Kpi({ label, value, sub, accent, help }: { label: string; value: string; sub?: string; accent?: 'pos' | 'neg'; help?: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          {help && <MetricHelp title={label}>{help}</MetricHelp>}
        </div>
        <div className={`mt-1 text-lg font-semibold ${accent === 'neg' ? 'text-red-600' : accent === 'pos' ? 'text-emerald-600' : 'text-foreground'}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ImpactRow({ label, base, scen, delta, isCount }: { label: string; base: string; scen: string; delta?: number; isCount?: boolean }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4">{label}</td>
      <td className="py-2 pr-4 tabular-nums text-muted-foreground">{base}</td>
      <td className="py-2 pr-4 font-medium tabular-nums">{scen}</td>
      <td className="py-2 tabular-nums">
        {delta == null ? '—' : (
          <span className={delta >= 0 ? 'text-emerald-600' : 'text-red-600'}>
            {isCount ? String(delta) : gbpSigned(delta)}
          </span>
        )}
      </td>
    </tr>
  );
}

function DriverCard({ title, icon, rows, tone, total }: { title: string; icon: React.ReactNode; rows: { label: string; total: number }[]; tone: 'pos' | 'neg'; total: number }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.total)));
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">{icon}{title}</div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate pr-2 text-foreground">{r.label}</span>
                  <span className="shrink-0 tabular-nums font-medium text-foreground">{gbp(r.total)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${tone === 'pos' ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.round((Math.abs(r.total) / max) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {total !== 0 && rows.length > 0 && (
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
            <span>Shown</span>
            <span className="tabular-nums">{Math.round((rows.reduce((s, r) => s + Math.abs(r.total), 0) / Math.abs(total)) * 100)}% of total</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExceptionGroup({ icon, title, tone, items }: { icon: React.ReactNode; title: string; tone: 'danger' | 'warning' | 'info'; items: CfoException[] }) {
  const toneCls = tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-sky-600';
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${toneCls}`}>
          {icon}{title}
          <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((e, i) => (
              <li key={i} className="text-xs">
                <div className="font-medium text-foreground">{e.title}</div>
                <div className="text-muted-foreground">{e.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── helpers ──
function labelFor(key: string): string {
  const map: Record<string, string> = {
    base: 'Base closing cash',
    scenario: 'Scenario closing cash',
    best: SCENARIO_LABELS.best,
    likely: SCENARIO_LABELS.likely,
    worst: SCENARIO_LABELS.worst,
    threshold: 'Minimum balance',
    inflow: 'Inflow',
    outflow: 'Outflow',
    net: 'Net cash flow',
  };
  return map[key] ?? key;
}
