import { useEffect, useMemo, useState } from 'react';
import { Settings, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLocations } from '@/hooks/useLocations';
import { useFilters } from '@/contexts/FilterContext';
import {
  useProductivityTargetMultiplier,
  ProductivityCategory,
  PRODUCTIVITY_TARGET_DEFAULT,
} from '@/hooks/useProductivityTargetMultiplier';

interface ProductivityTargetPopoverProps {
  category: ProductivityCategory;
  // Called whenever the effective multiplier changes — either from a live draft or from a save.
  // Consumers use this to update displayed target values in real time.
  onEffectiveMultiplierChange: (value: number) => void;
}

export function ProductivityTargetPopover({
  category,
  onEffectiveMultiplierChange,
}: ProductivityTargetPopoverProps) {
  const { targetMultiplier, source, scope, saveTargetMultiplier, isSaving, categoryLabel } =
    useProductivityTargetMultiplier(category);
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
        ? 'Current value: saved org-wide default.'
        : 'Current value: built-in default (no org-wide override set).';
    }
    if (source === 'location') return 'Current value: location override.';
    if (source === 'org') return 'Current value: inherited from org-wide default.';
    return 'Current value: built-in default.';
  }, [scope, source]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(String(targetMultiplier));

  // Broadcast the saved value whenever it changes (initial load, after save, or scope change).
  useEffect(() => {
    onEffectiveMultiplierChange(targetMultiplier);
  }, [targetMultiplier, onEffectiveMultiplierChange]);

  // While the popover is open, live-preview the draft if it parses to a valid positive number.
  useEffect(() => {
    if (!open) return;
    const parsed = parseFloat(draft);
    if (parsed > 0) {
      onEffectiveMultiplierChange(parsed);
    }
  }, [draft, open, onEffectiveMultiplierChange]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setDraft(String(targetMultiplier));
    } else {
      // Restore saved value on close (cancel or outside click)
      onEffectiveMultiplierChange(targetMultiplier);
    }
  };

  const handleSave = () => {
    const parsed = parseFloat(draft);
    if (!(parsed > 0)) return;
    saveTargetMultiplier(parsed, {
      onSuccess: () => setOpen(false),
    });
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-8 w-8"
          aria-label={`Configure ${categoryLabel.toLowerCase()} productivity target`}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div>
            <h4 className="font-medium text-sm">{categoryLabel} Target Multiplier</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Target = actual cost &times; multiplier. E.g. 1.1 = 10% above current spend.
              Values update live as you type; click Save to persist.
            </p>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 space-y-0.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Applies to</div>
            <div className="text-xs font-medium">{scopeLabel}</div>
            <div className="text-[11px] text-muted-foreground">{sourceNote}</div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`productivity-target-${category}`} className="text-xs">
              Multiplier (default {PRODUCTIVITY_TARGET_DEFAULT})
            </Label>
            <Input
              id={`productivity-target-${category}`}
              type="number"
              min={0.1}
              max={10}
              step={0.05}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
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
  );
}
