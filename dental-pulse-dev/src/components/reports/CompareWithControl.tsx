import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { CompareWith, CompareWithUnit } from '@/hooks/useAccountingFinancialReports';

interface CompareWithControlProps {
  value: CompareWith | null;
  onChange: (value: CompareWith | null) => void;
}

const MONTH_PRESETS = [1, 2, 3, 4];

function unitLabel(unit: CompareWithUnit, amount: number): string {
  const base = unit === 'month' ? 'Month' : unit === 'quarter' ? 'Quarter' : 'Year';
  return amount === 1 ? base : `${base}s`;
}

function describe(value: CompareWith | null): string {
  if (!value) return 'None';
  return `${value.amount} ${unitLabel(value.unit, value.amount)}`;
}

export function CompareWithControl({ value, onChange }: CompareWithControlProps) {
  const [open, setOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [pendingUnit, setPendingUnit] = useState<CompareWithUnit>('month');

  // Keep the Period radio (and the custom-amount input) in sync with whatever
  // comparison is actually active, so reopening the dropdown reflects reality
  // instead of always resetting to "Month" regardless of the live selection.
  useEffect(() => {
    setPendingUnit(value?.unit ?? 'month');
    setCustomAmount(value ? String(value.amount) : '');
  }, [value]);

  const selectPreset = (amount: number | null) => {
    onChange(amount === null ? null : { amount, unit: 'month' });
    setOpen(false);
  };

  const applyCustom = () => {
    const amount = parseInt(customAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) return;
    onChange({ amount, unit: pendingUnit });
    setOpen(false);
  };

  const selectUnit = (unit: CompareWithUnit) => {
    setPendingUnit(unit);
    if (value) {
      // A comparison is already active (preset or custom) — switching Period
      // re-applies it immediately with the new unit. Without this, switching
      // Month <-> Quarter <-> Year did nothing until a separate "Apply" click,
      // which is what made it look broken.
      onChange({ amount: value.amount, unit });
    }
  };

  const isPresetSelected = (amount: number) => !!value && value.unit === 'month' && value.amount === amount;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-[160px] justify-between font-normal">
          {describe(value)}
          <ChevronDown className="w-4 h-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="px-4 py-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Compare with</p>
        </div>
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => selectPreset(null)}
            className={cn(
              'w-full text-left px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors',
              !value && 'bg-primary/10 text-primary font-medium',
            )}
          >
            None
          </button>
          {MONTH_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => selectPreset(n)}
              className={cn(
                'w-full text-left px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors',
                isPresetSelected(n) && 'bg-primary/10 text-primary font-medium',
              )}
            >
              {n} {unitLabel('month', n)}
            </button>
          ))}
          <div className="flex items-center gap-2 px-4 py-2.5">
            <Input
              type="number"
              min={1}
              placeholder="Enter a different number"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="h-9"
            />
            <Button size="sm" onClick={applyCustom} disabled={!customAmount}>
              Apply
            </Button>
          </div>
        </div>
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Period</p>
          <RadioGroup
            value={pendingUnit}
            onValueChange={(v) => selectUnit(v as CompareWithUnit)}
            className="gap-2"
          >
            {(['month', 'quarter', 'year'] as CompareWithUnit[]).map((unit) => (
              <div key={unit} className="flex items-center gap-2">
                <RadioGroupItem value={unit} id={`compare-period-${unit}`} />
                <Label htmlFor={`compare-period-${unit}`} className="font-normal capitalize cursor-pointer">
                  {unit}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      </PopoverContent>
    </Popover>
  );
}
