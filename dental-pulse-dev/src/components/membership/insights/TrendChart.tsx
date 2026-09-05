import { useId } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  YAxis,
} from "recharts";

/** 12-month trend card: big current value, %-change badge, and a soft
 *  area/line chart. `data` carries its own axis labels (real calendar
 *  months, not a fixed demo range) so this has no dependency on any
 *  hardcoded month list. */
export function TrendChart({
  data,
  formatter,
}: {
  data: Array<{ label: string; value: number }>;
  formatter: (v: number) => string;
}) {
  // Each mounted chart needs its own gradient id — two TrendCharts can
  // render side by side, and a shared literal id would make one chart's
  // fill silently resolve to the other's gradient.
  const gradientId = `mpiTrendFill-${useId()}`;
  const last = data[data.length - 1]?.value ?? 0;
  const first = data[0]?.value ?? 0;
  const changePct = first !== 0 ? (last / first - 1) * 100 : 0;
  const rising = last >= first;
  const color = rising ? "var(--mpi-verd)" : "var(--mpi-brick)";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[21px] font-semibold tracking-tight num" style={{ color: "var(--mpi-ink)" }}>
          {formatter(last)}
        </span>
        <span className="text-xs font-medium num" style={{ color }}>
          {changePct >= 0 ? "+" : ""}
          {changePct.toFixed(1)}% · {data.length} months
        </span>
      </div>
      <div style={{ width: "100%", height: 96 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.16} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={["dataMin", "dataMax"]} hide />
            <RechartsTooltip
              formatter={(v: number) => formatter(v)}
              labelFormatter={(label) => label}
              contentStyle={{
                background: "var(--mpi-surface)",
                border: "1px solid var(--mpi-line)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 3.5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[10.5px] mt-1.5 num" style={{ color: "var(--mpi-t3)" }}>
        <span>{data[0]?.label ?? ""}</span>
        <span>{data[data.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  );
}
