import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrendingUp, TrendingDown, ArrowRight, Calculator } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CostImpactSimulatorProps {
  currentCost: number;
  currentEBITDA?: number;
  percentOfRevenue: number;
  totalRevenue?: number;
  costCenterName: string;
  colorClass?: string;
}

const formatCurrency = (value: number) => {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const percentageOptions = [
  { value: '-15', label: '-15%' },
  { value: '-10', label: '-10%' },
  { value: '-5', label: '-5%' },
  { value: '5', label: '+5%' },
  { value: '10', label: '+10%' },
  { value: '15', label: '+15%' },
  { value: 'custom', label: 'Custom' },
];

export function CostImpactSimulator({
  currentCost,
  currentEBITDA = 0,
  percentOfRevenue,
  totalRevenue = currentCost / (percentOfRevenue / 100),
  costCenterName,
  colorClass = 'primary',
}: CostImpactSimulatorProps) {
  const [selectedPercent, setSelectedPercent] = useState<string>('5');
  const [customPercent, setCustomPercent] = useState<string>('');

  const percentageChange = selectedPercent === 'custom' 
    ? parseFloat(customPercent) || 0 
    : parseFloat(selectedPercent);

  const costChange = currentCost * (percentageChange / 100);
  const newCost = currentCost + costChange;
  // Revenue can be 0 (or the derived default can be non-finite when
  // percentOfRevenue is 0), which would otherwise render Infinity%/NaN%.
  const newPercentOfRevenue = totalRevenue > 0 && Number.isFinite(totalRevenue)
    ? (newCost / totalRevenue) * 100
    : null;
  const ebitdaImpact = -costChange; // Cost increase reduces EBITDA, cost decrease improves it
  const newEBITDA = currentEBITDA + ebitdaImpact;

  const isIncrease = percentageChange > 0;
  const isDecrease = percentageChange < 0;

  return (
    <Card className="border-2 border-dashed border-muted-foreground/30">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Calculator className="w-5 h-5 text-muted-foreground" />
          Cost Impact Simulator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Percentage Selection */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
          <div className="space-y-2 flex-1">
            <Label>If {costCenterName} change by:</Label>
            <Select value={selectedPercent} onValueChange={setSelectedPercent}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select percentage" />
              </SelectTrigger>
              <SelectContent>
                {percentageOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {selectedPercent === 'custom' && (
            <div className="space-y-2 flex-1">
              <Label>Enter custom %:</Label>
              <Input
                type="number"
                placeholder="e.g., -7.5 or 12"
                value={customPercent}
                onChange={(e) => setCustomPercent(e.target.value)}
                className="w-full"
              />
            </div>
          )}
        </div>

        {/* Before & After Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          {/* Before */}
          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Current</p>
            <div className="space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">{costCenterName}</p>
                <p className="text-xl font-bold">{formatCurrency(currentCost)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">% of Revenue</p>
                <p className="text-lg font-semibold">{percentOfRevenue.toFixed(1)}%</p>
              </div>
              {currentEBITDA !== 0 && (
                <div>
                  <p className="text-sm text-muted-foreground">EBITDA</p>
                  <p className="text-lg font-semibold">{formatCurrency(currentEBITDA)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Arrow */}
          <div className="flex justify-center items-center">
            <div className={cn(
              "flex flex-col items-center gap-2 p-3 rounded-lg",
              isIncrease ? "bg-destructive/10" : isDecrease ? "bg-success/10" : "bg-muted/30"
            )}>
              {isIncrease ? (
                <TrendingUp className="w-6 h-6 text-destructive" />
              ) : isDecrease ? (
                <TrendingDown className="w-6 h-6 text-success" />
              ) : (
                <ArrowRight className="w-6 h-6 text-muted-foreground" />
              )}
              <span className={cn(
                "text-lg font-bold",
                isIncrease ? "text-destructive" : isDecrease ? "text-success" : "text-muted-foreground"
              )}>
                {percentageChange > 0 ? '+' : ''}{percentageChange}%
              </span>
              <span className={cn(
                "text-sm",
                isIncrease ? "text-destructive" : isDecrease ? "text-success" : "text-muted-foreground"
              )}>
                {isIncrease ? `+${formatCurrency(Math.abs(costChange))}` : isDecrease ? formatCurrency(costChange) : '—'}
              </span>
            </div>
          </div>

          {/* After */}
          <div className={cn(
            "p-4 rounded-lg",
            isIncrease ? "bg-destructive/10 border border-destructive/30" : 
            isDecrease ? "bg-success/10 border border-success/30" : 
            "bg-muted/50"
          )}>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Projected</p>
            <div className="space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">{costCenterName}</p>
                <p className={cn(
                  "text-xl font-bold",
                  isIncrease ? "text-destructive" : isDecrease ? "text-success" : ""
                )}>
                  {formatCurrency(newCost)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">% of Revenue</p>
                <p className={cn(
                  "text-lg font-semibold",
                  isIncrease ? "text-destructive" : isDecrease ? "text-success" : ""
                )}>
                  {newPercentOfRevenue === null ? '—' : `${newPercentOfRevenue.toFixed(1)}%`}
                </p>
              </div>
              {currentEBITDA !== 0 && (
                <div>
                  <p className="text-sm text-muted-foreground">EBITDA Impact</p>
                  <p className={cn(
                    "text-lg font-semibold",
                    isIncrease ? "text-destructive" : isDecrease ? "text-success" : ""
                  )}>
                    {ebitdaImpact > 0 ? '+' : ''}{formatCurrency(ebitdaImpact)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Summary Insight */}
        {percentageChange !== 0 && (
          <div className={cn(
            "p-4 rounded-lg text-sm",
            isIncrease ? "bg-destructive/5 border border-destructive/20" : "bg-success/5 border border-success/20"
          )}>
            <p className={isIncrease ? "text-destructive" : "text-success"}>
              <strong>{isIncrease ? 'Impact:' : 'Savings:'}</strong>{' '}
              A {Math.abs(percentageChange)}% {isIncrease ? 'increase' : 'reduction'} in {costCenterName.toLowerCase()} would {' '}
              {isIncrease ? 'add' : 'save'} <strong>{formatCurrency(Math.abs(costChange))}</strong> annually, 
              {isIncrease ? ' reducing' : ' improving'} EBITDA by <strong>{formatCurrency(Math.abs(ebitdaImpact))}</strong>.
              {newPercentOfRevenue !== null && (
                <> The cost as a percentage of revenue would {isIncrease ? 'increase' : 'decrease'} from {percentOfRevenue.toFixed(1)}% to {newPercentOfRevenue.toFixed(1)}%.</>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
