import { useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useLocations } from "@/hooks/useLocations";

export type LocationCompareMode = "combined" | "side-by-side" | "average";

interface LocationCompareControlProps {
  /** The location currently selected in the top-nav filter — excluded from the pickable list. */
  primaryLocationId: string | null;
  selectedLocationIds: string[];
  onSelectedLocationIdsChange: (ids: string[]) => void;
  mode: LocationCompareMode;
  onModeChange: (mode: LocationCompareMode) => void;
  disabled?: boolean;
}

function describe(count: number, mode: LocationCompareMode): string {
  if (count === 0) return "Compare Locations";
  const total = count + 1;
  if (mode === "side-by-side") return `${total} Locations · Side by side`;
  if (mode === "average") return `${total} Locations · Group (Average)`;
  return `${total} Locations · Combined`;
}

export function LocationCompareControl({
  primaryLocationId,
  selectedLocationIds,
  onSelectedLocationIdsChange,
  mode,
  onModeChange,
  disabled,
}: LocationCompareControlProps) {
  const [open, setOpen] = useState(false);
  const { allAvailableLocations } = useLocations();

  const otherLocations = (allAvailableLocations ?? []).filter(
    (l) => l.id !== primaryLocationId,
  );

  const toggle = (id: string) => {
    onSelectedLocationIdsChange(
      selectedLocationIds.includes(id)
        ? selectedLocationIds.filter((x) => x !== id)
        : [...selectedLocationIds, id],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="gap-2 font-normal"
          title={
            disabled
              ? "Select a specific location above to compare locations"
              : undefined
          }
        >
          <MapPin className="w-4 h-4 opacity-50" />
          {describe(selectedLocationIds.length, mode)}
          <ChevronDown className="w-4 h-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="px-4 py-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Compare with other locations
          </p>
        </div>
        <div className="border-t border-border max-h-56 overflow-y-auto py-1">
          {otherLocations.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted-foreground">
              No other locations available.
            </p>
          ) : (
            otherLocations.map((loc) => (
              <label
                key={loc.id}
                className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedLocationIds.includes(loc.id)}
                  onCheckedChange={() => toggle(loc.id)}
                />
                {loc.location_name}
              </label>
            ))
          )}
        </div>
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Show as
          </p>
          <RadioGroup
            // Nothing should read as "selected" until the user has actually
            // picked a location to compare — otherwise reopening this after
            // clearing the selection still shows the last-used mode as
            // active even though there's nothing to apply it to.
            value={selectedLocationIds.length > 0 ? mode : undefined}
            onValueChange={(v) => onModeChange(v as LocationCompareMode)}
            className="gap-2"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem
                value="combined"
                id="location-compare-combined"
                className="mt-0.5"
              />
              <Label
                htmlFor="location-compare-combined"
                className="font-normal cursor-pointer"
              >
                Combined
                <span className="block text-xs text-muted-foreground">
                  Sum selected locations into one set of totals.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem
                value="side-by-side"
                id="location-compare-side-by-side"
                className="mt-0.5"
              />
              <Label
                htmlFor="location-compare-side-by-side"
                className="font-normal cursor-pointer"
              >
                Side by side
                <span className="block text-xs text-muted-foreground">
                  Show each location in its own columns.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem
                value="average"
                id="location-compare-average"
                className="mt-0.5"
              />
              <Label
                htmlFor="location-compare-average"
                className="font-normal cursor-pointer"
              >
                Group (Average)
                <span className="block text-xs text-muted-foreground">
                  Average the selected locations into one set of totals.
                </span>
              </Label>
            </div>
          </RadioGroup>
        </div>
        {selectedLocationIds.length > 0 && (
          <div className="border-t border-border px-4 py-2">
            <button
              type="button"
              onClick={() => onSelectedLocationIdsChange([])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear selection
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
