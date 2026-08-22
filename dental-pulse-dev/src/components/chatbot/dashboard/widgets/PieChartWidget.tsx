import { useMemo } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { formatValue, CHART_COLORS, type WidgetUnit } from '../format';
import type { DashboardWidget } from '@/hooks/useChatbot';

export function PieChartWidget({ widget }: { widget: DashboardWidget }) {
  const unit = widget.data?.unit as WidgetUnit;
  const data = useMemo(
    () => (widget.data?.points || [])
      .filter(p => Number(p.value) > 0)
      .map(p => ({ name: p.label, value: Number(p.value) || 0 })),
    [widget.data],
  );

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground py-6 text-center">No data for this breakdown.</p>;
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  const Tip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
    return (
      <div className="bg-popover border border-border rounded-md px-3 py-1.5 shadow-md text-xs">
        <p className="font-medium">{d.name}</p>
        <p style={{ color: d.payload.fill }}>{formatValue(d.value, unit)} ({pct}%)</p>
      </div>
    );
  };

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={38}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip content={<Tip />} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
