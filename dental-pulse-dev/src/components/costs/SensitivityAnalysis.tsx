import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine
} from 'recharts';
import { Activity, TrendingUp, TrendingDown, Target, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip as UITooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

interface CalcStep {
  label: string;
  value: string;
}

interface MetricInfoTooltipProps {
  title: string;
  meaning: string;
  formula: string;
  inputs?: CalcStep[];
  steps?: CalcStep[];
  result?: CalcStep;
  note?: string;
}

function MetricInfoTooltip({ title, meaning, formula, inputs, steps, result, note }: MetricInfoTooltipProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <UITooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About ${title}`}
            className="inline-flex items-center justify-center text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm p-3 space-y-2">
          <div className="text-xs font-semibold">{title}</div>
          <div className="text-[11px] text-muted-foreground">{meaning}</div>
          <div className="text-[11px] font-mono bg-muted/60 rounded px-2 py-1">{formula}</div>
          {inputs && inputs.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Values used</div>
              <div className="space-y-0.5">
                {inputs.map((s) => (
                  <div key={s.label} className="flex justify-between text-[11px] font-mono">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="font-semibold">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {steps && steps.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Calculation</div>
              <div className="space-y-0.5">
                {steps.map((s) => (
                  <div key={s.label} className="flex justify-between text-[11px] font-mono">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result && (
            <div className="flex justify-between text-[11px] font-mono pt-1 border-t border-border/60">
              <span className="font-medium">{result.label}</span>
              <span className="font-bold text-primary">{result.value}</span>
            </div>
          )}
          {note && <div className="text-[11px] text-muted-foreground italic pt-1">{note}</div>}
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  );
}

export interface CostCenterInput {
  name: string;
  currentCost: number;
  percentChange: number;
  color: string;
  /** Fraction of this cost treated as fixed (0-1). Default 0.5 */
  fixedRatio?: number;
}

interface SensitivityAnalysisProps {
  totalRevenue: number;
  currentEBITDA: number;
  currentTotalCosts: number;
  costCenters: CostCenterInput[];
  /** @deprecated kept for backward compat — prefer costCenters */
  labFeesCost?: number;
  staffCostsCost?: number;
  operatingLeasesCost?: number;
  labFeesPercent?: number;
  staffCostsPercent?: number;
  operatingLeasesPercent?: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

const formatPct = (value: number, digits = 1) =>
  `${value.toFixed(digits)}%`;

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(262, 83%, 58%)',
];

export function SensitivityAnalysis({
  totalRevenue,
  currentEBITDA,
  currentTotalCosts,
  costCenters: costCentersProp,
  // legacy props
  labFeesCost = 0,
  staffCostsCost = 0,
  operatingLeasesCost = 0,
  labFeesPercent = 0,
  staffCostsPercent = 0,
  operatingLeasesPercent = 0,
}: SensitivityAnalysisProps) {

  // Use costCenters prop if provided, else build from legacy props
  const centers: CostCenterInput[] = costCentersProp && costCentersProp.length > 0
    ? costCentersProp
    : [
        { name: 'Lab Fees', currentCost: labFeesCost, percentChange: labFeesPercent, color: CHART_COLORS[0] },
        { name: 'Staff Costs', currentCost: staffCostsCost, percentChange: staffCostsPercent, color: CHART_COLORS[1], fixedRatio: 0.3 },
        { name: 'Operating Leases', currentCost: operatingLeasesCost, percentChange: operatingLeasesPercent, color: CHART_COLORS[2], fixedRatio: 0.8 },
      ];

  const analysis = useMemo(() => {
    // Fixed vs variable split
    const fixedCosts = centers.reduce((sum, c) => sum + c.currentCost * (c.fixedRatio ?? 0.5), 0);
    const variableCosts = currentTotalCosts - fixedCosts;

    // Break-even
    const grossMargin = totalRevenue > 0 ? (totalRevenue - variableCosts) / totalRevenue : 0;
    const breakEvenRevenue = grossMargin > 0 ? fixedCosts / grossMargin : 0;

    // New costs after changes
    const newCosts = centers.map(c => c.currentCost * (1 + c.percentChange / 100));
    const newTotalCosts = newCosts.reduce((s, v) => s + v, 0);

    // New fixed costs
    const newFixedCosts = centers.reduce((sum, c, i) => sum + newCosts[i] * (c.fixedRatio ?? 0.5), 0);
    const newVariableCosts = newTotalCosts - newFixedCosts;
    const newGrossMargin = totalRevenue > 0 ? (totalRevenue - newVariableCosts) / totalRevenue : 0;
    const newBreakEvenRevenue = newGrossMargin > 0 ? newFixedCosts / newGrossMargin : 0;

    // Margins
    const currentProfitMargin = totalRevenue > 0 ? (currentEBITDA / totalRevenue) * 100 : 0;
    const newEBITDA = currentEBITDA - (newTotalCosts - currentTotalCosts);
    const newProfitMargin = totalRevenue > 0 ? (newEBITDA / totalRevenue) * 100 : 0;

    const currentSafetyMargin = totalRevenue > 0 ? ((totalRevenue - breakEvenRevenue) / totalRevenue) * 100 : 0;
    const newSafetyMargin = totalRevenue > 0 ? ((totalRevenue - newBreakEvenRevenue) / totalRevenue) * 100 : 0;

    // Sensitivity per center
    const costCenterSensitivity = centers.map((c, i) => ({
      name: c.name,
      impact: c.currentCost * 0.01,
      percentOfCosts: currentTotalCosts > 0 ? (c.currentCost / currentTotalCosts) * 100 : 0,
      currentChange: c.percentChange,
      color: c.color || CHART_COLORS[i % CHART_COLORS.length],
    })).sort((a, b) => b.impact - a.impact);

    return {
      breakEvenRevenue,
      newBreakEvenRevenue,
      breakEvenChange: newBreakEvenRevenue - breakEvenRevenue,
      currentProfitMargin,
      newProfitMargin,
      profitMarginChange: newProfitMargin - currentProfitMargin,
      currentSafetyMargin,
      newSafetyMargin,
      safetyMarginChange: newSafetyMargin - currentSafetyMargin,
      costCenterSensitivity,
      newEBITDA,
      // Intermediate values exposed for tooltip breakdowns
      fixedCosts,
      variableCosts,
      grossMargin,
      newFixedCosts,
      newVariableCosts,
      newGrossMargin,
      newTotalCosts,
    };
  }, [totalRevenue, currentEBITDA, currentTotalCosts, centers]);

  const isImproved = analysis.newProfitMargin > analysis.currentProfitMargin;
  const chartHeight = Math.max(200, analysis.costCenterSensitivity.length * 45);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Sensitivity Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Break-Even Point */}
          <div className="p-4 rounded-lg bg-muted/30 border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Target className="w-4 h-4" />
              Break-Even Revenue
              <MetricInfoTooltip
                title="Break-Even Revenue"
                meaning="Revenue level where profit = 0. Below it you lose money; above it you start earning."
                formula="fixed costs ÷ gross margin %"
                inputs={[
                  { label: 'Total revenue', value: formatCurrency(totalRevenue) },
                  { label: 'Total costs', value: formatCurrency(analysis.newTotalCosts) },
                  { label: 'Fixed costs (after changes)', value: formatCurrency(analysis.newFixedCosts) },
                  { label: 'Variable costs (after changes)', value: formatCurrency(analysis.newVariableCosts) },
                ]}
                steps={[
                  { label: 'Gross margin %', value: `(${formatCurrency(totalRevenue)} − ${formatCurrency(analysis.newVariableCosts)}) ÷ ${formatCurrency(totalRevenue)} = ${formatPct(analysis.newGrossMargin * 100)}` },
                  { label: 'Break-even', value: `${formatCurrency(analysis.newFixedCosts)} ÷ ${formatPct(analysis.newGrossMargin * 100)}` },
                ]}
                result={{ label: 'Break-even revenue', value: formatCurrency(analysis.newBreakEvenRevenue) }}
                note="Fixed vs variable split uses each cost center's fixedRatio (e.g. rent 80% fixed, labs 50%)."
              />
            </div>
            <p className="text-xl font-bold">{formatCurrency(analysis.newBreakEvenRevenue)}</p>
            <div className={cn(
              "flex items-center gap-1 text-sm mt-1",
              analysis.breakEvenChange < 0 ? "text-success" : analysis.breakEvenChange > 0 ? "text-destructive" : "text-muted-foreground"
            )}>
              {analysis.breakEvenChange < 0 ? (
                <TrendingDown className="w-4 h-4" />
              ) : analysis.breakEvenChange > 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : null}
              <span>
                {analysis.breakEvenChange !== 0 && (
                  <>
                    {analysis.breakEvenChange > 0 ? '+' : ''}{formatCurrency(analysis.breakEvenChange)}
                    {' '}from current
                  </>
                )}
                {analysis.breakEvenChange === 0 && 'No change'}
              </span>
            </div>
          </div>

          {/* Profit Margin */}
          <div className="p-4 rounded-lg bg-muted/30 border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <TrendingUp className="w-4 h-4" />
              Profit Margin
              <MetricInfoTooltip
                title="Profit Margin"
                meaning="Profit as % of revenue. Negative means you are spending more than you earn."
                formula="EBITDA ÷ total revenue × 100"
                inputs={[
                  { label: 'Total revenue', value: formatCurrency(totalRevenue) },
                  { label: 'Current EBITDA', value: formatCurrency(currentEBITDA) },
                  { label: 'New EBITDA (after changes)', value: formatCurrency(analysis.newEBITDA) },
                ]}
                steps={[
                  { label: 'Current margin', value: `${formatCurrency(currentEBITDA)} ÷ ${formatCurrency(totalRevenue)} = ${formatPct(analysis.currentProfitMargin)}` },
                  { label: 'New margin', value: `${formatCurrency(analysis.newEBITDA)} ÷ ${formatCurrency(totalRevenue)} = ${formatPct(analysis.newProfitMargin)}` },
                ]}
                result={{ label: 'Profit margin', value: formatPct(analysis.newProfitMargin) }}
                note="EBITDA = revenue − total costs. Sub-line on card compares new vs current."
              />
            </div>
            <p className="text-xl font-bold">{analysis.newProfitMargin.toFixed(1)}%</p>
            <div className={cn(
              "flex items-center gap-1 text-sm mt-1",
              isImproved ? "text-success" : analysis.profitMarginChange < 0 ? "text-destructive" : "text-muted-foreground"
            )}>
              {isImproved ? (
                <TrendingUp className="w-4 h-4" />
              ) : analysis.profitMarginChange < 0 ? (
                <TrendingDown className="w-4 h-4" />
              ) : null}
              <span>
                {analysis.profitMarginChange !== 0 && (
                  <>
                    {analysis.profitMarginChange > 0 ? '+' : ''}{analysis.profitMarginChange.toFixed(2)}%
                    {' '}from {analysis.currentProfitMargin.toFixed(1)}%
                  </>
                )}
                {analysis.profitMarginChange === 0 && `Currently at ${analysis.currentProfitMargin.toFixed(1)}%`}
              </span>
            </div>
          </div>

          {/* Safety Margin */}
          <div className="p-4 rounded-lg bg-muted/30 border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <AlertTriangle className="w-4 h-4" />
              Safety Margin
              <MetricInfoTooltip
                title="Safety Margin"
                meaning="How far revenue is above break-even. Positive = buffer; negative = already below break-even."
                formula="(revenue − break-even) ÷ revenue × 100"
                inputs={[
                  { label: 'Total revenue', value: formatCurrency(totalRevenue) },
                  { label: 'Break-even (after changes)', value: formatCurrency(analysis.newBreakEvenRevenue) },
                ]}
                steps={[
                  { label: 'Revenue − break-even', value: formatCurrency(totalRevenue - analysis.newBreakEvenRevenue) },
                  { label: '÷ revenue × 100', value: `${formatCurrency(totalRevenue - analysis.newBreakEvenRevenue)} ÷ ${formatCurrency(totalRevenue)} × 100` },
                ]}
                result={{ label: 'Safety margin', value: formatPct(analysis.newSafetyMargin) }}
                note="+20% means revenue can fall 20% before losing money. Negative = the business is below break-even for this scope/period."
              />
            </div>
            <p className="text-xl font-bold">{analysis.newSafetyMargin.toFixed(1)}%</p>
            <div className={cn(
              "flex items-center gap-1 text-sm mt-1",
              analysis.safetyMarginChange > 0 ? "text-success" : analysis.safetyMarginChange < 0 ? "text-destructive" : "text-muted-foreground"
            )}>
              {analysis.safetyMarginChange > 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : analysis.safetyMarginChange < 0 ? (
                <TrendingDown className="w-4 h-4" />
              ) : null}
              <span>
                {analysis.safetyMarginChange !== 0 && (
                  <>
                    {analysis.safetyMarginChange > 0 ? '+' : ''}{analysis.safetyMarginChange.toFixed(2)}%
                    {' '}buffer
                  </>
                )}
                {analysis.safetyMarginChange === 0 && 'No change'}
              </span>
            </div>
          </div>
        </div>

        {/* Cost Center Sensitivity Chart */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            Cost Center Sensitivity (Impact per 1% Change)
            {analysis.costCenterSensitivity[0] && (
              <MetricInfoTooltip
                title="Cost Center Sensitivity"
                meaning="EBITDA change from a 1% move in that cost center. Bigger bars = more exposure."
                formula="current cost × 0.01"
                inputs={analysis.costCenterSensitivity.slice(0, 4).map((c) => {
                  const center = centers.find((x) => x.name === c.name);
                  return { label: c.name, value: formatCurrency(center?.currentCost ?? 0) };
                })}
                steps={[
                  {
                    label: `Top: ${analysis.costCenterSensitivity[0].name}`,
                    value: `${formatCurrency(centers.find((x) => x.name === analysis.costCenterSensitivity[0].name)?.currentCost ?? 0)} × 0.01`,
                  },
                ]}
                result={{ label: 'EBITDA impact per 1%', value: formatCurrency(analysis.costCenterSensitivity[0].impact) }}
                note="Ranked high to low. A 1% reduction in the top row saves more than a 1% reduction anywhere else."
              />
            )}
          </h4>
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analysis.costCenterSensitivity}
                layout="vertical"
                margin={{ top: 0, right: 30, left: 100, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  type="number"
                  tickFormatter={(value) => formatCurrency(value)}
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  width={95}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), 'EBITDA Impact']}
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
                  {analysis.costCenterSensitivity.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost Distribution with Changes */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            Cost Center Contribution & Applied Changes
            {analysis.costCenterSensitivity[0] && (
              <MetricInfoTooltip
                title="Cost Center Contribution"
                meaning="Share of total costs each center makes up, plus any % change applied in the simulator."
                formula="cost center ÷ total costs × 100"
                inputs={[
                  { label: 'Total costs', value: formatCurrency(currentTotalCosts) },
                  ...analysis.costCenterSensitivity.slice(0, 4).map((c) => {
                    const center = centers.find((x) => x.name === c.name);
                    return { label: c.name, value: formatCurrency(center?.currentCost ?? 0) };
                  }),
                ]}
                steps={[
                  {
                    label: `Top: ${analysis.costCenterSensitivity[0].name}`,
                    value: `${formatCurrency(centers.find((x) => x.name === analysis.costCenterSensitivity[0].name)?.currentCost ?? 0)} ÷ ${formatCurrency(currentTotalCosts)} × 100`,
                  },
                ]}
                result={{
                  label: `${analysis.costCenterSensitivity[0].name} share`,
                  value: formatPct(analysis.costCenterSensitivity[0].percentOfCosts),
                }}
                note="Red badge = simulated increase, green = simulated decrease. A 1% cut in a 40% center outweighs a 10% cut in a 4% center."
              />
            )}
          </h4>
          <div className="space-y-3">
            {analysis.costCenterSensitivity.map((center) => (
              <div key={center.name} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{center.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{center.percentOfCosts.toFixed(1)}% of costs</span>
                    {center.currentChange !== 0 && (
                      <Badge variant={center.currentChange < 0 ? "default" : "destructive"} className="text-xs">
                        {center.currentChange > 0 ? '+' : ''}{center.currentChange}%
                      </Badge>
                    )}
                  </div>
                </div>
                <Progress
                  value={center.percentOfCosts}
                  className="h-2"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Insight */}
        <div className={cn(
          "p-4 rounded-lg border",
          isImproved ? "bg-success/5 border-success/30" : "bg-muted/30"
        )}>
          <p className="text-sm text-muted-foreground">
            <strong className={isImproved ? "text-success" : "text-foreground"}>Key Insight:</strong>{' '}
            {analysis.costCenterSensitivity[0]?.name || 'N/A'} have the highest sensitivity to changes, with each 1% change impacting EBITDA by {formatCurrency(analysis.costCenterSensitivity[0]?.impact ?? 0)}.
            {analysis.profitMarginChange !== 0 && (
              <>
                {' '}The current scenario {isImproved ? 'improves' : 'reduces'} profit margin by {Math.abs(analysis.profitMarginChange).toFixed(2)}%
                and {analysis.breakEvenChange < 0 ? 'lowers' : 'raises'} the break-even point by {formatCurrency(Math.abs(analysis.breakEvenChange))}.
              </>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
