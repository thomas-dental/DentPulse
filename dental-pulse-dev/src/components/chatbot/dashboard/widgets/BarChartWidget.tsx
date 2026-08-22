import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { formatValue, formatAxis, CHART_COLORS, type WidgetUnit } from '../format';
import type { DashboardWidget } from '@/hooks/useChatbot';

export function BarChartWidget({ widget }: { widget: DashboardWidget }) {
  const unit = widget.data?.unit as WidgetUnit;
  const data = useMemo(
    () => (widget.data?.points || []).map(p => ({ name: p.label, value: p.value })),
    [widget.data],
  );

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground py-6 text-center">No data for this breakdown.</p>;
  }

  const Tip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border border-border rounded-md px-3 py-1.5 shadow-md text-xs">
        <p className="font-medium">{label}</p>
        <p style={{ color: payload[0].color }}>{formatValue(payload[0].value, unit)}</p>
      </div>
    );
  };

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: -8, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="name" fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }}
                 interval={0} angle={data.length > 5 ? -25 : 0} textAnchor={data.length > 5 ? 'end' : 'middle'} height={data.length > 5 ? 50 : 30} />
          <YAxis fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }}
                 tickFormatter={(v) => formatAxis(v, unit)} />
          <Tooltip content={<Tip />} cursor={{ fill: 'hsl(var(--muted)/0.4)' }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
