import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import type { ChartPayload } from '@/hooks/useChatbot';

interface ChatInlineChartProps {
  chart: ChartPayload;
}

function formatValue(value: number, unit: string) {
  if (unit === 'currency') return '£' + value.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (unit === 'percent') return value.toFixed(1) + '%';
  return value.toLocaleString();
}

export function ChatInlineChart({ chart }: ChatInlineChartProps) {
  const data = useMemo(() =>
    chart.labels.map((label, i) => ({
      name: label,
      value: chart.values[i] ?? 0,
      ...(chart.secondaryValues?.[i] != null && { forecast: chart.secondaryValues[i] }),
    })),
    [chart.labels, chart.values, chart.secondaryValues]
  );

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border border-border rounded-md px-3 py-1.5 shadow-md text-xs">
        <p className="font-medium">{label}</p>
        {payload.map((p: any, i: number) => (
          <p key={i} style={{ color: p.color }}>
            {p.name === 'forecast' ? 'Forecast' : chart.title.split(' ')[0]}: {formatValue(p.value, chart.valueUnit)}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="w-full mt-2 mb-1">
      <p className="text-[11px] font-medium text-muted-foreground mb-1">{chart.title}</p>
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === 'bar' ? (
            <BarChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }}
                     tickFormatter={(v) => chart.valueUnit === 'currency' ? `£${(v/1000).toFixed(0)}k` : v} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }}
                     tickFormatter={(v) => chart.valueUnit === 'currency' ? `£${(v/1000).toFixed(0)}k` : v} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))"
                    strokeWidth={2} dot={{ r: 3 }} />
              {chart.secondaryValues && (
                <Line type="monotone" dataKey="forecast" stroke="hsl(var(--success))"
                      strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
              )}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
