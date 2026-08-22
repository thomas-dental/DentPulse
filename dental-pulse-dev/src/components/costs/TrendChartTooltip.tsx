interface TrendPoint {
  month: string;
  actual: number;
  budget: number;
  benchmark: number;
  budgetMultiplier: number;
  benchmarkMultiplier: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

interface TrendChartTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TrendPoint }>;
  label?: string;
}

export function TrendChartTooltip({ active, payload, label }: TrendChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (!p) return null;

  const variance = p.actual - p.budget;
  const variancePct = p.budget !== 0 ? (variance / p.budget) * 100 : 0;

  return (
    <div className="rounded-lg border bg-card p-3 shadow-md space-y-2 text-xs min-w-[220px]">
      <div className="font-semibold text-sm">{label ?? p.month}</div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-success">● Actual</span>
          <span className="font-mono font-semibold">{formatCurrency(p.actual)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-warning">● Budget</span>
          <span className="font-mono">{formatCurrency(p.budget)}</span>
        </div>
        <div className="text-[10px] text-muted-foreground font-mono pl-3">
          = {formatCurrency(p.actual)} × {p.budgetMultiplier}
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-destructive">● Benchmark</span>
          <span className="font-mono">{formatCurrency(p.benchmark)}</span>
        </div>
        <div className="text-[10px] text-muted-foreground font-mono pl-3">
          = {formatCurrency(p.actual)} × {p.benchmarkMultiplier}
        </div>
      </div>
      <div className="pt-1 border-t border-border/60">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Actual vs Budget</span>
          <span className={`font-mono font-semibold ${variance < 0 ? 'text-success' : variance > 0 ? 'text-destructive' : ''}`}>
            {variance > 0 ? '+' : ''}{formatCurrency(variance)} ({variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%)
          </span>
        </div>
      </div>
    </div>
  );
}
