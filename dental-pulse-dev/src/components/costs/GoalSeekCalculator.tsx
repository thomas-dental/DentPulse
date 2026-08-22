import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Target,
  Calculator,
  Lightbulb,
  ArrowRight,
  Check,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface GoalSeekCostCenter {
  key: string;
  name: string;
  icon: React.ElementType;
  currentCost: number;
  colorClass: string;
}

interface GoalSeekCalculatorProps {
  costCenters: GoalSeekCostCenter[];
  totalRevenue: number;
  currentEBITDA: number;
  onApplySolution: (percentages: Record<string, number>) => void;
  /** @deprecated kept for backward compat */
  labFeesCost?: number;
  staffCostsCost?: number;
  operatingLeasesCost?: number;
  /** @deprecated */
  onApplySolutionLegacy?: (labPct: number, staffPct: number, leasesPct: number) => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

export function GoalSeekCalculator({
  costCenters,
  totalRevenue,
  currentEBITDA,
  onApplySolution,
}: GoalSeekCalculatorProps) {
  const [targetEBITDA, setTargetEBITDA] = useState('');
  const [selectedCenter, setSelectedCenter] = useState('all');

  const currentMargin = totalRevenue > 0 ? (currentEBITDA / totalRevenue) * 100 : 0;
  const targetValue = parseFloat(targetEBITDA) || 0;
  const costReductionNeeded = targetValue - currentEBITDA;
  const totalCosts = costCenters.reduce((s, c) => s + c.currentCost, 0);

  const solution = useMemo(() => {
    if (!targetValue || targetValue <= currentEBITDA) return null;

    if (selectedCenter === 'all') {
      if (totalCosts === 0) return { error: 'No costs configured. Add cost accounts first.' };
      const reductionPct = (costReductionNeeded / totalCosts) * 100;
      const percents: Record<string, number> = {};
      costCenters.forEach(c => { percents[c.key] = Math.round(-reductionPct * 10) / 10; });
      return {
        percents,
        description: `Reduce all cost centers by ${Math.abs(Math.round(reductionPct * 10) / 10)}%`,
      };
    }

    const center = costCenters.find(c => c.key === selectedCenter);
    if (!center || center.currentCost === 0) {
      return { error: `${center?.name || 'Selected center'} has no current costs. Choose a different center.` };
    }
    const reductionPct = (costReductionNeeded / center.currentCost) * 100;
    if (Math.abs(reductionPct) > 100) {
      return { error: `${center.name} alone cannot achieve this target. Consider multiple cost centers.` };
    }
    const percents: Record<string, number> = {};
    costCenters.forEach(c => { percents[c.key] = 0; });
    percents[center.key] = Math.round(-reductionPct * 10) / 10;
    return {
      percents,
      description: `Reduce ${center.name} by ${Math.abs(Math.round(reductionPct * 10) / 10)}%`,
    };
  }, [targetValue, currentEBITDA, costReductionNeeded, selectedCenter, costCenters, totalCosts]);

  const handleApply = () => {
    if (solution && 'percents' in solution) {
      onApplySolution(solution.percents);
    }
  };

  const targetMargin = targetValue && totalRevenue > 0 ? (targetValue / totalRevenue) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Target className="w-5 h-5" />
          Goal-Seek Calculator
          <Popover>
            <PopoverTrigger asChild>
              <button className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
                <Info className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 text-sm" side="bottom" align="start">
              <p className="font-medium mb-2">How this is calculated</p>
              <ul className="space-y-1 text-muted-foreground text-xs">
                <li>- Enter a target EBITDA higher than current</li>
                <li>- <strong>Cost Reduction Needed</strong> = Target EBITDA - Current EBITDA</li>
                <li>- <strong>"All Proportionally"</strong>: divides the needed reduction equally across all centers as a %</li>
                <li>- <strong>Single center</strong>: applies the full reduction to that center only</li>
                <li>- If a single center can't cover the target (would need &gt;100% cut), you'll see an error</li>
              </ul>
            </PopoverContent>
          </Popover>
        </CardTitle>
        <p className="text-sm text-muted-foreground">Set a target EBITDA and calculate required cost reductions</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current State */}
        <div className="p-4 bg-muted/30 rounded-lg space-y-2">
          <p className="text-sm font-medium">Current State</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">EBITDA</span>
            <span className="font-bold text-lg">{formatCurrency(currentEBITDA)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Margin</span>
            <span className="font-medium">{currentMargin.toFixed(1)}%</span>
          </div>
        </div>

        {/* Target Input */}
        <div className="space-y-3">
          <Label htmlFor="target-ebitda" className="font-medium">Target EBITDA</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">£</span>
            <Input
              id="target-ebitda"
              type="number"
              placeholder="Enter target EBITDA..."
              value={targetEBITDA}
              onChange={(e) => setTargetEBITDA(e.target.value)}
              className="pl-7"
            />
          </div>
          {targetValue > 0 && (
            <p className="text-xs text-muted-foreground">
              Target margin: {targetMargin.toFixed(1)}%
              {targetMargin > currentMargin && (
                <span className="text-success ml-1">(+{(targetMargin - currentMargin).toFixed(1)}pp)</span>
              )}
            </p>
          )}
        </div>

        {/* Cost Center Selection */}
        {targetValue > currentEBITDA && (
          <>
            <Separator />
            <div className="space-y-3">
              <Label className="font-medium">Reduce costs in:</Label>
              <RadioGroup
                value={selectedCenter}
                onValueChange={setSelectedCenter}
                className="grid grid-cols-2 gap-3"
              >
                <div className={cn(
                  "flex items-center space-x-2 p-3 rounded-lg border cursor-pointer transition-colors",
                  selectedCenter === 'all' ? "border-primary bg-primary/5" : "border-border"
                )}>
                  <RadioGroupItem value="all" id="goal-all" />
                  <Label htmlFor="goal-all" className="cursor-pointer text-sm">All Proportionally</Label>
                </div>
                {costCenters.map(center => {
                  const Icon = center.icon;
                  return (
                    <div
                      key={center.key}
                      className={cn(
                        "flex items-center space-x-2 p-3 rounded-lg border cursor-pointer transition-colors",
                        selectedCenter === center.key ? "border-primary bg-primary/5" : "border-border"
                      )}
                    >
                      <RadioGroupItem value={center.key} id={`goal-${center.key}`} />
                      <Label htmlFor={`goal-${center.key}`} className="cursor-pointer flex items-center gap-1 text-sm">
                        <Icon className={cn("w-4 h-4", center.colorClass)} />
                        {center.name}
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            </div>
          </>
        )}

        {/* Required Reduction */}
        {targetValue > currentEBITDA && (
          <>
            <Separator />
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 space-y-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-primary" />
                <p className="font-medium">Required Cost Reduction</p>
              </div>
              <div className="flex items-center justify-center gap-4 py-2">
                <div className="text-center">
                  <p className="text-2xl font-bold">{formatCurrency(currentEBITDA)}</p>
                  <p className="text-xs text-muted-foreground">Current</p>
                </div>
                <ArrowRight className="w-6 h-6 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-2xl font-bold text-success">{formatCurrency(targetValue)}</p>
                  <p className="text-xs text-muted-foreground">Target</p>
                </div>
              </div>
              <p className="text-sm text-center">
                Need to save <span className="font-bold text-success">{formatCurrency(costReductionNeeded)}</span> in costs
              </p>
            </div>
          </>
        )}

        {/* Solution */}
        {solution && (
          <div className={cn(
            "p-4 rounded-lg border space-y-3",
            'error' in solution ? "bg-destructive/5 border-destructive/20" : "bg-success/5 border-success/20"
          )}>
            {'error' in solution ? (
              <p className="text-sm text-destructive">{solution.error}</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Calculator className="w-5 h-5 text-success" />
                  <p className="font-medium text-success">Solution Found</p>
                </div>
                <p className="text-sm">{solution.description}</p>

                <div className={cn("grid gap-2 text-center text-sm", costCenters.length <= 3 ? "grid-cols-3" : "grid-cols-3")}>
                  {costCenters.map(c => (
                    <div key={c.key} className="p-2 bg-background rounded">
                      <p className="font-bold">{solution.percents[c.key]}%</p>
                      <p className="text-xs text-muted-foreground truncate">{c.name}</p>
                    </div>
                  ))}
                </div>

                <Button onClick={handleApply} className="w-full gap-2">
                  <Check className="w-4 h-4" />
                  Apply to Simulator
                </Button>
              </>
            )}
          </div>
        )}

        {/* Info when target is lower */}
        {targetValue > 0 && targetValue <= currentEBITDA && (
          <div className="p-4 bg-muted/30 rounded-lg text-center">
            <p className="text-sm text-muted-foreground">
              Target must be higher than current EBITDA to calculate required savings
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
