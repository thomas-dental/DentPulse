import { useEffect, useMemo, useState } from 'react';
import { Settings, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip as UITooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useLocations } from '@/hooks/useLocations';
import { useFilters } from '@/contexts/FilterContext';
import { ProductivityCategory } from '@/hooks/useProductivityTargetMultiplier';
import {
  useCostTrendMultipliers,
  BUDGET_MULTIPLIER_DEFAULT,
  BENCHMARK_MULTIPLIER_DEFAULT,
} from '@/hooks/useCostTrendMultipliers';

interface MonthlyTrendSettingsPopoverProps {
  category: ProductivityCategory;
  onEffectiveMultipliersChange: (budget: number, benchmark: number) => void;
}

export function MonthlyTrendSettingsPopover({
  category,
  onEffectiveMultipliersChange,
}: MonthlyTrendSettingsPopoverProps) {
  const {
    budgetMultiplier,
    benchmarkMultiplier,
    source,
    scope,
    saveMultipliers,
    isSaving,
    categoryLabel,
  } = useCostTrendMultipliers(category);
  const { selectedLocationId } = useFilters();
  const { locations } = useLocations();

  const scopeLabel = useMemo(() => {
    if (scope === 'org') return 'All Locations (organization-wide)';
    const loc = locations?.find((l) => l.id === selectedLocationId);
    return loc?.location_name ?? 'Selected location';
  }, [scope, locations, selectedLocationId]);

  const sourceNote = useMemo(() => {
    if (scope === 'org') {
      return source === 'org'
        ? 'Saved org-wide values.'
        : 'Built-in defaults (1.05 / 0.95).';
    }
    if (source === 'location') return 'Location override.';
    if (source === 'org') return 'Inherited from org-wide defaults.';
    return 'Built-in defaults (1.05 / 0.95).';
  }, [scope, source]);

  const [open, setOpen] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<string>(String(budgetMultiplier));
  const [benchmarkDraft, setBenchmarkDraft] = useState<string>(String(benchmarkMultiplier));

  useEffect(() => {
    onEffectiveMultipliersChange(budgetMultiplier, benchmarkMultiplier);
  }, [budgetMultiplier, benchmarkMultiplier, onEffectiveMultipliersChange]);

  useEffect(() => {
    if (!open) return;
    const b = parseFloat(budgetDraft);
    const k = parseFloat(benchmarkDraft);
    if (b > 0 && k > 0) {
      onEffectiveMultipliersChange(b, k);
    }
  }, [budgetDraft, benchmarkDraft, open, onEffectiveMultipliersChange]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setBudgetDraft(String(budgetMultiplier));
      setBenchmarkDraft(String(benchmarkMultiplier));
    } else {
      onEffectiveMultipliersChange(budgetMultiplier, benchmarkMultiplier);
    }
  };

  const handleSave = () => {
    const b = parseFloat(budgetDraft);
    const k = parseFloat(benchmarkDraft);
    if (!(b > 0) || !(k > 0)) return;
    saveMultipliers(
      { budgetMultiplier: b, benchmarkMultiplier: k },
      { onSuccess: () => setOpen(false) },
    );
  };

  return (
    <div className="ml-auto flex items-center gap-1">
      <TooltipProvider delayDuration={0}>
        <UITooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="How this chart works"
              className="inline-flex items-center justify-center text-muted-foreground/70 hover:text-foreground transition-colors h-8 w-8"
            >
              <Info className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs p-3 space-y-2">
            <div className="text-xs font-semibold">How this chart works</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <div><strong className="text-foreground">Actual</strong> — real spend per month, aggregated from invoices / P&L.</div>
              <div>
                <strong className="text-foreground">Budget</strong> — target spend. Formula:
                <div className="font-mono bg-muted/60 rounded px-1.5 py-0.5 mt-0.5">Actual × {budgetMultiplier}</div>
              </div>
              <div>
                <strong className="text-foreground">Benchmark</strong> — industry comparison. Formula:
                <div className="font-mono bg-muted/60 rounded px-1.5 py-0.5 mt-0.5">Actual × {benchmarkMultiplier}</div>
              </div>
              <div className="italic pt-1">Click the gear to change these multipliers for this {scope === 'org' ? 'organisation' : 'location'}.</div>
            </div>
          </TooltipContent>
        </UITooltip>
      </TooltipProvider>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Configure ${categoryLabel.toLowerCase()} trend settings`}
          >
            <Settings className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <div className="space-y-3">
            <div>
              <h4 className="font-medium text-sm">{categoryLabel} Trend Settings</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Configure how Budget and Benchmark lines are drawn against Actual.
                Values update live as you type; click Save to persist.
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 space-y-0.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Applies to</div>
              <div className="text-xs font-medium">{scopeLabel}</div>
              <div className="text-[11px] text-muted-foreground">{sourceNote}</div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`budget-mult-${category}`} className="text-xs">
                Budget multiplier (default {BUDGET_MULTIPLIER_DEFAULT}) — Actual &times; this
              </Label>
              <Input
                id={`budget-mult-${category}`}
                type="number"
                min={0.1}
                max={10}
                step={0.01}
                value={budgetDraft}
                onChange={(e) => setBudgetDraft(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`benchmark-mult-${category}`} className="text-xs">
                Benchmark multiplier (default {BENCHMARK_MULTIPLIER_DEFAULT}) — Actual &times; this
              </Label>
              <Input
                id={`benchmark-mult-${category}`}
                type="number"
                min={0.1}
                max={10}
                step={0.01}
                value={benchmarkDraft}
                onChange={(e) => setBenchmarkDraft(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={isSaving} onClick={handleSave}>
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                Save
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
