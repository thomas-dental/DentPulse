import { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { formatValue, formatAxis, type WidgetUnit } from '../format';
import type { DashboardWidget } from '@/hooks/useChatbot';

export function LineChartWidget({ widget }: { widget: DashboardWidget }) {
  const unit = widget.data?.unit as WidgetUnit;
  const data = useMemo(
    () => (widget.data?.points || []).map(p => ({ name: p.label, value: p.value })),
    [widget.data],
  );

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground py-6 text-center">No data for this period.</p>;
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
        <LineChart data={data} margin={{ top: 5, right: 5, left: -8, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="name" fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }}
                 tickFormatter={(v) => formatAxis(v, unit)} />
          <Tooltip content={<Tip />} />
          <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
