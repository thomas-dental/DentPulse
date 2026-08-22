import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

/**
 * Acquisition ramp — actual revenue vs the deal-case curve for a newly-acquired
 * practice on its 12-month ramp. SAMPLE DATA (indicative mockup) until a real
 * acquisitions feed exists; the shape mirrors the Group Dashboard design.
 */
const C_ACTUAL = 'var(--gdb-series-1)';
const C_CASE = '#008300';

// Month 1 = acquisition month (May 2026). Case curve = the deal model; actual only
// exists for the months elapsed so far (nulls after render as a stopped line).
const RAMP = [
  { m: 'May', label: 'May 26', case: 78, actual: 71 },
  { m: 'Jun', label: 'Jun 26', case: 84, actual: 80 },
  { m: 'Jul', label: 'Jul 26', case: 90, actual: 89 },
  { m: 'Aug', label: 'Aug 26', case: 96, actual: null },
  { m: 'Sep', label: 'Sep 26', case: 101, actual: null },
  { m: 'Oct', label: 'Oct 26', case: 106, actual: null },
  { m: 'Nov', label: 'Nov 26', case: 110, actual: null },
  { m: 'Dec', label: 'Dec 26', case: 114, actual: null },
  { m: 'Jan', label: 'Jan 27', case: 117, actual: null },
  { m: 'Feb', label: 'Feb 27', case: 120, actual: null },
  { m: 'Mar', label: 'Mar 27', case: 122, actual: null },
  { m: 'Apr', label: 'Apr 27', case: 124, actual: null },
];

function gbpK(v: number): string { return `£${Math.round(v)}k`; }

function RampTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ dataKey?: string; value?: number | null }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const actual = payload.find((p) => p.dataKey === 'actual');
  const dealCase = payload.find((p) => p.dataKey === 'case');
  return (
    <div className="gdb-tip">
      <div className="tm">{label}</div>
      {actual?.value != null && (
        <div className="tr">
          <span className="k"><span className="dotc" style={{ background: C_ACTUAL }} />Actual</span>
          <span className="v">{gbpK(actual.value)}</span>
        </div>
      )}
      {dealCase?.value != null && (
        <div className="tr">
          <span className="k"><span className="dotc" style={{ background: C_CASE }} />Deal case</span>
          <span className="v">{gbpK(dealCase.value)}</span>
        </div>
      )}
    </div>
  );
}

export function GroupAcquisitionRamp() {
  return (
    <div className="chart-wrap">
      <div className="chart-box short">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={RAMP} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--gdb-grid)" vertical={false} />
            <XAxis
              dataKey="m" tick={{ fontSize: 10.5, fill: 'var(--gdb-muted)' }}
              tickLine={false} axisLine={false} interval={1}
            />
            <YAxis
              tickFormatter={gbpK} tick={{ fontSize: 10.5, fill: 'var(--gdb-muted)' }}
              tickLine={false} axisLine={false} width={44} domain={[65, 130]}
            />
            <Tooltip content={<RampTooltip />} cursor={{ stroke: 'var(--gdb-muted)', strokeWidth: 1, opacity: 0.5 }} />
            <Line
              dataKey="case" stroke={C_CASE} strokeWidth={2} strokeDasharray="5 4"
              dot={false} isAnimationActive={false}
            />
            <Line
              dataKey="actual" stroke={C_ACTUAL} strokeWidth={2.5}
              dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
