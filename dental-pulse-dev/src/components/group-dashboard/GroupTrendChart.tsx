import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import type { GroupTrendData } from '@/hooks/useGroupDashboardData';

type MetricKey = 'revenue' | 'profit' | 'netCashflow' | 'cashFlow' | 'prodVsColl';
type RangeKey = 1 | 3 | 6 | 12 | 'ytd' | 'custom';

const METRIC_LABELS: Record<MetricKey, string> = {
  revenue: 'Production',
  profit: 'Profit',
  netCashflow: 'Net Cash flow',
  cashFlow: 'Collection',
  prodVsColl: 'Production vs Collection',
};

const METRIC_HINTS: Record<MetricKey, string> = {
  revenue: ' · Profit Benchmark Production Income',
  profit: ' · Profit Benchmark Actual Profit',
  netCashflow: ' · Cash Flow Statement Net Cashflow',
  cashFlow: ' · Cash Flow Statement Total Received',
  prodVsColl: ' · Production Income vs Cash Flow Total Received',
};

/* App design-system colours: accent (blue-purple) for the current year,
   success green for the prior year. Resolve via CSS vars so dark mode follows. */
const C_ACTUAL = 'var(--gdb-series-1)';
const C_PRIOR = '#008300';
/* Collection series in the Production vs Collection view — amber, readable on
   both themes and distinct from the production blue and prior-year green. */
const C_COLL = '#d97706';

function fmtTick(v: number): string {
  const r = Math.round(v / 100) / 10; // → thousands, 1dp
  const abs = Math.abs(r);
  const num = abs >= 1000 ? `${(abs / 1000).toFixed(1)}m` : `${abs >= 100 ? Math.round(abs) : abs}k`;
  return `${r < 0 ? '-' : ''}£${num}`;
}

function TrendTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; payload?: { priorLabel?: string; prevActual?: number; prevLabel?: string; vs?: boolean } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const actual = payload.find((p) => p.dataKey === 'actual');
  const prior = payload.find((p) => p.dataKey === 'prior');
  const coll = payload.find((p) => p.dataKey === 'coll');
  // Rows are labelled with the actual MONTH ("Mar 26"), not "This year" /
  // "Last year", and include the PREVIOUS month for a this-month-vs-last-month
  // read ("Mar 26 / Feb 26 / Mar 25") — client request.
  const row = payload[0]?.payload;
  return (
    <div className="gdb-tip">
      <div className="tm">{label}</div>
      {actual?.value != null && (
        <div className="tr">
          <span className="k"><span className="dotc" style={{ background: C_ACTUAL }} />{row?.vs ? 'Production' : label}</span>
          <span className="v">{fmtTick(actual.value)}</span>
        </div>
      )}
      {coll?.value != null && (
        <div className="tr">
          <span className="k"><span className="dotc" style={{ background: C_COLL }} />Collection</span>
          <span className="v">{fmtTick(coll.value)}</span>
        </div>
      )}
      {row?.prevActual != null && (
        <div className="tr">
          <span className="k"><span className="dotc" style={{ background: 'var(--gdb-muted)' }} />{row.prevLabel ?? 'Last month'}</span>
          <span className="v">{fmtTick(row.prevActual)}</span>
        </div>
      )}
      {prior?.value != null && (
        <div className="tr">
          <span className="k"><span className="dotc" style={{ background: C_PRIOR }} />{row?.priorLabel ?? 'Last year'}</span>
          <span className="v">{fmtTick(prior.value)}</span>
        </div>
      )}
    </div>
  );
}

function seriesForMetric(trend: GroupTrendData, metric: MetricKey): number[] | null {
  switch (metric) {
    case 'revenue':
      return trend.revenue;
    case 'profit':
      return trend.profit;
    case 'netCashflow':
      return trend.cashflow;
    case 'cashFlow':
      return trend.collection;
    case 'prodVsColl':
      // Primary series is Production; the Collection overlay is added per-row.
      return trend.revenue;
    default:
      return null;
  }
}

export function GroupTrendChart({ trend }: { trend: GroupTrendData }) {
  const [metric, setMetric] = useState<MetricKey>('revenue');
  const [range, setRange] = useState<RangeKey>(6);
  // Custom month window ('MMM-yy' keys); seeded when Custom is first selected.
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const series = seriesForMetric(trend, metric);
  const metricUnavailable =
    (metric === 'profit' && !trend.profit) ||
    (metric === 'netCashflow' && !trend.cashflow) ||
    ((metric === 'cashFlow' || metric === 'prodVsColl') && !trend.collection);

  const { data, showPrior, change, last, lastColl } = useMemo(() => {
    const n = trend.keys.length;
    if (!series || n === 0) return { data: [], showPrior: false, change: 0, last: 0, lastColl: 0 };
    let startIdx: number;
    let endIdx = n; // exclusive
    if (range === 'ytd') {
      const janKey = trend.keys.findIndex((k) => k.startsWith('Jan-') && trend.keys.indexOf(k) >= n - 12);
      startIdx = janKey >= 0 ? janKey : Math.max(0, n - 12);
    } else if (range === 'custom') {
      const fi = customFrom ? trend.keys.indexOf(customFrom) : -1;
      const ti = customTo ? trend.keys.indexOf(customTo) : -1;
      startIdx = fi >= 0 ? fi : Math.max(0, n - 6);
      endIdx = ti >= 0 ? ti + 1 : n;
      if (endIdx <= startIdx) endIdx = Math.min(n, startIdx + 1);
    } else {
      startIdx = Math.max(0, n - range);
    }
    const vs = metric === 'prodVsColl';
    const collSeries = vs ? trend.collection : null;
    // The comparison view plots two live series — the prior-year and
    // previous-month overlays would make it unreadable, so they're off there.
    const showPrior = !vs && startIdx - 12 >= 0;
    const rows = [];
    for (let i = startIdx; i < endIdx; i++) {
      rows.push({
        label: trend.labels[i],
        actual: Math.round(series[i]),
        coll: collSeries ? Math.round(collSeries[i]) : undefined,
        vs,
        prior: showPrior ? Math.round(series[i - 12]) : undefined,
        priorLabel: showPrior ? trend.labels[i - 12] : undefined,
        // Previous month of the SAME series — powers the tooltip's
        // this-month-vs-last-month row.
        prevActual: !vs && i - 1 >= 0 ? Math.round(series[i - 1]) : undefined,
        prevLabel: !vs && i - 1 >= 0 ? trend.labels[i - 1] : undefined,
      });
    }
    const first = rows[0]?.actual ?? 0;
    const lastV = rows[rows.length - 1]?.actual ?? 0;
    const lastCollV = rows[rows.length - 1]?.coll ?? 0;
    return { data: rows, showPrior, change: lastV - first, last: lastV, lastColl: lastCollV };
  }, [trend, series, metric, range, customFrom, customTo]);

  // Net cashflow crosses zero; collection (Total Received) stays non-negative —
  // use a line + zero guide. The comparison view uses lines for both series.
  const zeroBased = metric === 'netCashflow' || metric === 'cashFlow' || metric === 'prodVsColl';
  const up = change >= 0;
  const rangeText =
    range === 'ytd' ? 'the year to date'
      : range === 'custom' ? 'the selected months'
      : range === 1 ? 'the last month'
      : `${range} months`;

  return (
    <div className="card trend">
      <div className="trend-controls">
        <div className="seg">
          {(Object.keys(METRIC_LABELS) as MetricKey[]).map((m) => (
            <button
              key={m}
              className={metric === m ? 'on' : ''}
              disabled={
                (m === 'profit' && !trend.profit) ||
                (m === 'netCashflow' && !trend.cashflow) ||
                ((m === 'cashFlow' || m === 'prodVsColl') && !trend.collection)
              }
              title={
                (m === 'profit' && !trend.profit) ||
                (m === 'netCashflow' && !trend.cashflow) ||
                ((m === 'cashFlow' || m === 'prodVsColl') && !trend.collection)
                  ? 'Connect your accounting software to see this trend'
                  : undefined
              }
              onClick={() => setMetric(m)}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="seg small">
          {([1, 3, 6, 12, 'ytd', 'custom'] as RangeKey[]).map((r) => (
            <button
              key={String(r)}
              className={range === r ? 'on' : ''}
              onClick={() => {
                setRange(r);
                if (r === 'custom') {
                  const n = trend.keys.length;
                  if (!customFrom) setCustomFrom(trend.keys[Math.max(0, n - 6)] ?? '');
                  if (!customTo) setCustomTo(trend.keys[n - 1] ?? '');
                }
              }}
            >
              {r === 'ytd' ? 'YTD' : r === 'custom' ? 'Custom' : `${r}M`}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="seg small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {([['From', customFrom, setCustomFrom], ['To', customTo, setCustomTo]] as const).map(([lbl, val, set]) => (
              <select
                key={lbl}
                aria-label={`${lbl} month`}
                value={val}
                onChange={(e) => set(e.target.value)}
                style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--gdb-grid)', background: 'transparent', color: 'inherit' }}
              >
                {trend.keys.map((k, i) => (
                  <option key={k} value={k}>{lbl}: {trend.labels[i]}</option>
                ))}
              </select>
            ))}
          </div>
        )}
      </div>

      <div className="tctitle">{METRIC_LABELS[metric]}</div>
      <div className="tcsub">
        {trend.loading || metricUnavailable ? 'Loading…' : (
          <>
            <span className="delta" style={{ color: up ? 'var(--gdb-good-ink)' : 'var(--gdb-critical-ink)' }}>
              {up ? '▲' : '▼'} {up ? '+' : ''}{fmtTick(change)}
            </span>{' '}
            over {rangeText} · now {fmtTick(last)}
            {metric === 'prodVsColl' && <> · Collection now {fmtTick(lastColl)}</>}
            {METRIC_HINTS[metric]}
          </>
        )}
      </div>
      <div className="legend">
        {metric === 'prodVsColl' ? (
          <>
            <span className="lk"><span className="ld" style={{ background: C_ACTUAL }} />Production</span>
            <span className="lk"><span className="ld" style={{ background: C_COLL }} />Collection</span>
          </>
        ) : (
          <>
            <span className="lk"><span className="ld" style={{ background: C_ACTUAL }} />This year</span>
            {showPrior && <span className="lk"><span className="ld" style={{ background: C_PRIOR }} />Last year</span>}
          </>
        )}
      </div>

      <div className="chart-wrap">
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--gdb-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: 'var(--gdb-muted)' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tickFormatter={fmtTick}
                tick={{ fontSize: 12, fill: 'var(--gdb-muted)' }}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--gdb-muted)', strokeWidth: 1, opacity: 0.5 }} />
              {zeroBased && <ReferenceLine y={0} stroke="var(--gdb-muted)" strokeWidth={1} />}
              {showPrior && (
                <Line
                  type="monotone" dataKey="prior" stroke={C_PRIOR} strokeWidth={2}
                  dot={false} activeDot={{ r: 4 }} isAnimationActive={false}
                />
              )}
              {zeroBased ? (
                <Line
                  type="monotone" dataKey="actual" stroke={C_ACTUAL} strokeWidth={2}
                  dot={data.length === 1} activeDot={{ r: 4 }} isAnimationActive={false}
                />
              ) : (
                <Area
                  type="monotone" dataKey="actual" stroke={C_ACTUAL} strokeWidth={2}
                  fill={C_ACTUAL} fillOpacity={0.1} dot={data.length === 1} activeDot={{ r: 4 }} isAnimationActive={false}
                />
              )}
              {metric === 'prodVsColl' && (
                <Line
                  type="monotone" dataKey="coll" stroke={C_COLL} strokeWidth={2}
                  dot={data.length === 1} activeDot={{ r: 4 }} isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
