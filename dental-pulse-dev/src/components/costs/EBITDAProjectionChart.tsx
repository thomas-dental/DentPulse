import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, Calendar, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface CostCenterProjection {
  name: string;
  currentCost: number;
  percentChange: number;
}

interface EBITDAProjectionChartProps {
  currentEBITDA: number;
  projectedEBITDA: number;
  totalCostChange: number;
  costCenters?: CostCenterProjection[];
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

export function EBITDAProjectionChart({
  currentEBITDA,
  projectedEBITDA,
  totalCostChange,
  costCenters = [],
}: EBITDAProjectionChartProps) {
  const projectionData = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyEBITDAChange = (projectedEBITDA - currentEBITDA) / 12;

    return months.map((month, index) => {
      const cumulativeEBITDAChange = monthlyEBITDAChange * (index + 1);
      const ebitdaWithChanges = currentEBITDA + cumulativeEBITDAChange;

      return {
        month,
        baseline: currentEBITDA,
        projected: ebitdaWithChanges,
      };
    });
  }, [currentEBITDA, projectedEBITDA, totalCostChange]);

  const isPositiveChange = projectedEBITDA > currentEBITDA;
  const finalChange = projectedEBITDA - currentEBITDA;
  const noScenarioApplied = Math.abs(finalChange) < 1;

  // When no scenario is applied, the two lines overlap at the same value which makes recharts
  // auto-scale the Y-axis to a handful of pounds and the flat line looks like noisy data.
  // Pad the domain by ~10% of |currentEBITDA| so the chart reads cleanly.
  const yDomain = useMemo<[number | 'auto', number | 'auto']>(() => {
    if (!noScenarioApplied) return ['auto', 'auto'];
    const pad = Math.max(Math.abs(currentEBITDA) * 0.1, 1000);
    return [currentEBITDA - pad, currentEBITDA + pad];
  }, [noScenarioApplied, currentEBITDA]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          12-Month EBITDA Projection
          <Popover>
            <PopoverTrigger asChild>
              <button className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
                <Info className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 text-sm" side="bottom" align="start">
              <p className="font-medium mb-2">How this is calculated</p>
              <ul className="space-y-1 text-muted-foreground text-xs">
                <li>- <strong>Baseline EBITDA</strong> = Revenue - Total Costs (current)</li>
                <li>- <strong>Projected EBITDA</strong> = Baseline + cumulative cost change impact spread across 12 months</li>
                <li>- Cost changes from all {costCenters.length || 3} cost centers are applied gradually over the year</li>
                {costCenters.length > 0 && (
                  <li className="pt-1 border-t mt-1">
                    <strong>Active cost centers:</strong>{' '}
                    {costCenters.map(c => `${c.name} (${c.percentChange >= 0 ? '+' : ''}${c.percentChange}%)`).join(', ')}
                  </li>
                )}
                <li>- Monthly Impact = Total annual change / 12</li>
                <li>- Year-End EBITDA = Baseline + total annual change</li>
              </ul>
            </PopoverContent>
          </Popover>
          <span className="ml-auto text-sm font-normal text-muted-foreground flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            Gradual Implementation
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {noScenarioApplied && (
          <div className="mb-4 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
            <span>
              No cost changes applied yet — Baseline and Projected lines overlap. Adjust a cost
              center % in the simulator above to see the 12-month EBITDA trajectory.
            </span>
          </div>
        )}
        <div className="h-[350px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={projectionData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis
                tickFormatter={(value) => formatCurrency(value)}
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                domain={yDomain}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatCurrency(value),
                  name === 'baseline' ? 'Baseline EBITDA' :
                  name === 'projected' ? 'Projected EBITDA' : name
                ]}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <ReferenceLine
                y={currentEBITDA}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                label={{ value: 'Current', position: 'right', fill: 'hsl(var(--muted-foreground))' }}
              />
              <Line
                type="monotone"
                dataKey="baseline"
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                dot={false}
                name="Baseline EBITDA"
              />
              <Line
                type="monotone"
                dataKey="projected"
                stroke={isPositiveChange ? "hsl(var(--success))" : "hsl(var(--destructive))"}
                strokeWidth={3}
                dot={{ r: 4, fill: isPositiveChange ? "hsl(var(--success))" : "hsl(var(--destructive))" }}
                name="Projected EBITDA"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Starting EBITDA</p>
            <p className="text-lg font-semibold">{formatCurrency(currentEBITDA)}</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Monthly Impact</p>
            <p className={`text-lg font-semibold ${isPositiveChange ? 'text-success' : finalChange < 0 ? 'text-destructive' : ''}`}>
              {isPositiveChange ? '+' : ''}{formatCurrency(finalChange / 12)}/mo
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Year-End EBITDA</p>
            <p className={`text-lg font-semibold ${isPositiveChange ? 'text-success' : finalChange < 0 ? 'text-destructive' : ''}`}>
              {formatCurrency(projectedEBITDA)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
