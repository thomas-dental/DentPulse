import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts';
import { useCashflowForecast, type ForecastRow } from '@/hooks/useCashflowForecast';
import {
  SCENARIO_KEYS,
  SCENARIO_LABELS,
  scenarioFactor,
  type ScenarioKey,
} from '@/hooks/useCashflowForecastSettings';
import { computeScenarioClosingCash } from '@/lib/forecastDisplay';

const END_CASH_THRESHOLD_KEY = 'end_cash_threshold';
// Same palette as the CFO Summary chart so the two read as one report.
const C_BASE = '#94a3b8';
const SCENARIO_COLORS: Record<ScenarioKey, string> = {
  best: '#16a34a',   // green — upside
  likely: '#2563eb', // blue — most likely
  worst: '#dc2626',  // red — downside
};

function gbpCompact(v: number): string {
  const n = Math.round(v);
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}£${(a / 1_000_000).toFixed(1)}m`;
  if (a >= 1_000) return `${s}£${Math.round(a / 1000)}k`;
  return `${s}£${a}`;
}

function RunwayTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; stroke?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const names: Record<string, string> = {
    base: 'Base closing cash',
    best: SCENARIO_LABELS.best,
    likely: SCENARIO_LABELS.likely,
    worst: SCENARIO_LABELS.worst,
  };
  return (
    <div className="gdb-tip">
      <div className="tm">Week of {label}</div>
      {payload.map((p) => (
        p.value != null && p.dataKey && names[p.dataKey] ? (
          <div className="tr" key={p.dataKey}>
            <span className="k"><span className="dotc" style={{ background: p.stroke }} />{names[p.dataKey]}</span>
            <span className="v">{gbpCompact(p.value)}</span>
          </div>
        ) : null
      ))}
    </div>
  );
}

/** Inner component so the (heavy) 13-week forecast hook only mounts on expand. */
function RunwayInner() {
  const f = useCashflowForecast(0, { includeCurrentWindow: false });
  const {
    weeks, weeklyTotals, totalWeeklyNet, endCash, startCash, startCashSet,
    thresholdsByKey, nhsRow, membershipRows, privateRow, forecastSettings,
    isLoading, outflowLoading,
  } = f;

  // Click a legend entry to show/hide its line — same interaction as the CFO
  // Summary chart.
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({
    base: true, best: true, likely: true, worst: true,
  });
  const toggleLine = (key: string) =>
    setVisibleLines((prev) => ({ ...prev, [key]: !prev[key] }));

  const vm = useMemo(() => {
    // SAME series as the CFO Summary's "Closing cash — base vs scenarios"
    // chart, via the shared computeScenarioClosingCash — identical lines.
    const scenario = forecastSettings.scenario;
    const incomeRows = [nhsRow, ...(membershipRows ?? []), privateRow].filter(Boolean) as ForecastRow[];
    const series = computeScenarioClosingCash({
      weekCount: weeks?.length ?? 0,
      weeklyTotals: weeklyTotals ?? [],
      totalWeeklyNet: totalWeeklyNet ?? [],
      endCash: endCash ?? null,
      startCash: startCash ?? 0,
      incomeRows,
      factor: scenarioFactor(scenario),
      bestPct: scenario.bestPct,
      likelyPct: scenario.likelyPct,
      worstPct: scenario.worstPct,
    });

    const rows = (weeks ?? []).map((w, i) => ({
      label: w.weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      base: Math.round(series.baseEnd[i] ?? 0),
      best: Math.round(series.scnEndByKey.best[i] ?? 0),
      likely: Math.round(series.scnEndByKey.likely[i] ?? 0),
      worst: Math.round(series.scnEndByKey.worst[i] ?? 0),
    }));

    // Verdict follows the BASE line (the CFO Summary's default case), checked
    // against the End Cash minimum-balance threshold when one is set.
    const thrSeries: Array<number | null> = thresholdsByKey?.[END_CASH_THRESHOLD_KEY]
      ?? (weeks ?? []).map(() => null);
    const thrValue = [...thrSeries].reverse().find((t) => t != null) ?? null;
    let min = Infinity; let minWeekLabel = ''; let weeksBelow = 0;
    series.baseEnd.forEach((v, i) => {
      if (v < min) { min = v; minWeekLabel = rows[i]?.label ?? ''; }
      const t = thrSeries[i] ?? thrValue;
      if (t != null && v < t) weeksBelow++;
    });
    if (!Number.isFinite(min)) min = startCash ?? 0;

    const pctLabel = (k: ScenarioKey) => {
      const p = k === 'best' ? scenario.bestPct : k === 'likely' ? scenario.likelyPct : scenario.worstPct;
      return `${p >= 0 ? '+' : ''}${p}%`;
    };
    return { rows, thrValue, min, minWeekLabel, weeksBelow, pctLabel };
  }, [weeks, weeklyTotals, totalWeeklyNet, endCash, startCash, thresholdsByKey,
      nhsRow, membershipRows, privateRow, forecastSettings]);

  const loading = isLoading || outflowLoading;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="cashhead">
        <div className="tctitle">Closing cash — base vs scenarios</div>
        {!startCashSet && !loading && (
          <span className="pqspill a" title="Set your opening bank balance on the 13-Week Forecast page — the runway is indicative until it's set.">
            Opening cash not set
          </span>
        )}
      </div>
      <div className="legend" title="Click a series to show or hide it">
        <span
          className="lk" role="button"
          onClick={() => toggleLine('base')}
          style={{ cursor: 'pointer', opacity: visibleLines.base ? 1 : 0.35 }}
        >
          <span className="ld" style={{ background: C_BASE }} />Base closing cash
        </span>
        {SCENARIO_KEYS.map((k) => (
          <span
            className="lk" key={k} role="button"
            onClick={() => toggleLine(k)}
            style={{ cursor: 'pointer', opacity: visibleLines[k] ? 1 : 0.35 }}
          >
            <span className="ld" style={{ background: SCENARIO_COLORS[k] }} />
            {SCENARIO_LABELS[k]} ({vm.pctLabel(k)})
          </span>
        ))}
      </div>
      {loading ? (
        <div className="loading-note">Building the 13-week forecast…</div>
      ) : (
        <>
          <div className="chart-wrap">
            <div className="chart-box short">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={vm.rows} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--gdb-grid)" vertical={false} />
                  <XAxis
                    dataKey="label" tick={{ fontSize: 11.5, fill: 'var(--gdb-muted)' }}
                    tickLine={false} axisLine={false} interval={0}
                  />
                  <YAxis
                    tickFormatter={gbpCompact} tick={{ fontSize: 12, fill: 'var(--gdb-muted)' }}
                    tickLine={false} axisLine={false} width={56} domain={['auto', 'auto']}
                  />
                  <Tooltip content={<RunwayTooltip />} cursor={{ stroke: 'var(--gdb-muted)', strokeWidth: 1, opacity: 0.5 }} />
                  {visibleLines.base && (
                    <Line
                      dataKey="base" stroke={C_BASE} strokeWidth={2} strokeDasharray="6 4"
                      dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false}
                    />
                  )}
                  {SCENARIO_KEYS.filter((k) => visibleLines[k]).map((k) => (
                    <Line
                      key={k} dataKey={k} stroke={SCENARIO_COLORS[k]} strokeWidth={2}
                      dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="verdict" style={{ marginTop: 12 }}>
            <span className="vi">!</span>
            <div>
              <b>Base case lowest point {gbpCompact(vm.min)} in the week of {vm.minWeekLabel || '—'}.</b>{' '}
              {vm.thrValue == null
                ? 'Set a minimum-balance threshold on the 13-Week Forecast page to flag weeks that dip too low.'
                : vm.weeksBelow > 0
                  ? `Base-case cash closes below the ${gbpCompact(vm.thrValue)} floor in ${vm.weeksBelow} week${vm.weeksBelow === 1 ? '' : 's'} — plan cover or pull forward income before then.`
                  : `Base-case cash stays above the ${gbpCompact(vm.thrValue)} floor for all 13 weeks.`}
              {' '}Same lines as the CFO Summary.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function GroupCashRunway() {
  const [open, setOpen] = useState(false);
  return (
    <section className="collapsible">
      <div className="sec-head" onClick={() => setOpen((o) => !o)}>
        <h2>Cash Runway</h2>
        <span className="sub">Next 13 weeks — closing cash with scenarios, same lines as the CFO Summary</span>
        <span className="foldind">{open ? '▾ hide' : '▸ show'}</span>
      </div>
      {open && <RunwayInner />}
    </section>
  );
}
