/**
 * Profit Benchmark periodic Expected vs Actual chart (Pro-style).
 */
import React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type {
  ProfitCategoryDetailSummary,
  ProfitPeriodGranularity,
  ProfitPeriodicPoint,
} from '@/services/profitBenchmarkService';

import { formatGbp, formatPercentDisplay } from '@/utils/formatMoney';

function formatMoney(value: number, symbol = '£'): string {
  return formatGbp(value, { symbol });
}

function formatPct(value: number): string {
  return formatPercentDisplay(Number(value || 0));
}

export type ProfitCategoryPeriodicChartDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryName: string;
  loading: boolean;
  error: string | null;
  summary: ProfitCategoryDetailSummary | null;
  periods: ProfitPeriodicPoint[];
  granularity: ProfitPeriodGranularity;
  onGranularityChange: (g: ProfitPeriodGranularity) => void;
};

export function ProfitCategoryPeriodicChartDialog({
  open,
  onOpenChange,
  categoryName,
  loading,
  error,
  summary,
  periods,
  granularity,
  onGranularityChange,
}: ProfitCategoryPeriodicChartDialogProps) {
  const chartData = periods.map((p) => ({
    label: p.label,
    expected: p.expected,
    actual: p.actual,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col gap-4 overflow-hidden">
        <DialogHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 space-y-0">
          <DialogTitle className="text-xl">{categoryName || 'Category'}</DialogTitle>
          <div className="flex items-center gap-1 rounded-md border p-1 self-start">
            {([
              ['weekly', 'Weekly'],
              ['monthly', 'Monthly'],
              ['yearly', 'Yearly'],
            ] as const).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={granularity === key ? 'default' : 'ghost'}
                className="h-7 px-3"
                onClick={() => onGranularityChange(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        </DialogHeader>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm border rounded-lg p-3 bg-muted/30">
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">Expected</div>
              <div className="font-semibold tabular-nums">{formatMoney(summary.expected)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">Actual</div>
              <div className="font-semibold tabular-nums">{formatMoney(summary.actual)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">Variance</div>
              <div
                className={cn(
                  'font-semibold tabular-nums',
                  summary.variance > 0 ? 'text-red-600' : summary.variance < 0 ? 'text-green-600' : ''
                )}
              >
                {formatPct(summary.variance)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">Benchmark</div>
              <div className="font-semibold tabular-nums">{formatPct(summary.benchmarkPercent)}</div>
            </div>
          </div>
        )}

        <div className="min-h-[320px] flex-1 rounded-lg border p-3">
          <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {categoryName} — Periodic Performance
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No periodic data for this range.</div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) =>
                    `£${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
                  }
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatMoney(Number(value) || 0),
                    name === 'expected' ? 'Expected Amount' : 'Actual Amount',
                  ]}
                />
                <Legend
                  formatter={(value) =>
                    value === 'expected' ? 'Expected Amount' : 'Actual Amount'
                  }
                />
                <Area
                  type="monotone"
                  dataKey="actual"
                  name="actual"
                  stroke="#22c55e"
                  fill="#86efac"
                  fillOpacity={0.35}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="expected"
                  name="expected"
                  stroke="#3b82f6"
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
