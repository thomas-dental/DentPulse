import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  useRevenueSettings,
  type RevenueSettings,
  type RevenueSourceValue,
  type IncomeLevelValue,
} from "@/hooks/useRevenueSettings";

interface RevenueSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string | null;
  locationLabel: string;
}

const SOURCE_OPTIONS: { key: RevenueSourceValue; label: string }[] = [
  { key: "pms", label: "PMS" },
  { key: "accounting", label: "Accounting" },
  { key: "dentpulse", label: "DentPulse" },
];

interface RevenueRow {
  title: string;
  fromKey: keyof RevenueSettings & `${string}_income_from`;
  levelKey: keyof RevenueSettings & `${string}_income_level`;
  allowDentpulse: boolean;
}

const REVENUE_ROWS: RevenueRow[] = [
  {
    title: "Private Income",
    fromKey: "private_income_from",
    levelKey: "private_income_level",
    allowDentpulse: false,
  },
  {
    title: "Membership Income",
    fromKey: "membership_income_from",
    levelKey: "membership_income_level",
    allowDentpulse: true,
  },
  {
    title: "NHS Income",
    fromKey: "nhs_income_from",
    levelKey: "nhs_income_level",
    allowDentpulse: true,
  },
  {
    title: "MOS Income",
    fromKey: "mos_income_from",
    levelKey: "mos_income_level",
    allowDentpulse: true,
  },
];

// Source = PMS or DentPulse means the figure is inherently computed per
// provider (production, UDA/case obligations), so Income Level is forced to
// "By Provider" and locked — only Accounting allows a practice-wide mapping.
function isProviderOnly(source: RevenueSourceValue): boolean {
  return source === "pms" || source === "dentpulse";
}

export function RevenueSettingsModal({
  open,
  onOpenChange,
  locationId,
  locationLabel,
}: RevenueSettingsModalProps) {
  const { settings, isOverride, isLoading, save, isSaving } =
    useRevenueSettings(locationId);
  const [form, setForm] = useState<RevenueSettings>(settings);

  useEffect(() => {
    if (open) setForm(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLoading]);

  const updateSource = (row: RevenueRow, value: RevenueSourceValue) => {
    setForm((prev) => ({
      ...prev,
      [row.fromKey]: value,
      [row.levelKey]: isProviderOnly(value) ? "provider" : prev[row.levelKey],
    }));
  };

  const updateLevel = (row: RevenueRow, value: IncomeLevelValue) => {
    setForm((prev) => ({ ...prev, [row.levelKey]: value }));
  };

  const handleSave = async () => {
    await save(form);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Revenue Settings</DialogTitle>
          <DialogDescription>
            Configure Revenue Source and Income Source for{" "}
            {locationId
              ? locationLabel
              : "all locations (organisation default)"}
            .
            {isOverride && locationId && " This location has its own override."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_2fr_1fr] gap-4 px-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>Revenue Type</span>
              <span>Revenue Source</span>
              <span>Income Source</span>
            </div>
            {REVENUE_ROWS.map((row) => {
              const sourceValue = form[row.fromKey] as RevenueSourceValue;
              const levelValue = form[row.levelKey] as IncomeLevelValue;
              const levelLocked = isProviderOnly(sourceValue);
              const options = row.allowDentpulse
                ? SOURCE_OPTIONS
                : SOURCE_OPTIONS.filter((o) => o.key !== "dentpulse");

              return (
                <div
                  key={row.title}
                  className="grid grid-cols-[1fr_2fr_1fr] gap-4 items-center border-t py-3 px-1"
                >
                  <span className="text-sm font-medium">{row.title}</span>
                  <RadioGroup
                    value={sourceValue}
                    onValueChange={(v) =>
                      updateSource(row, v as RevenueSourceValue)
                    }
                    className="flex flex-wrap gap-4"
                  >
                    {options.map((opt) => (
                      <div
                        key={opt.key}
                        className="flex items-center space-x-2"
                      >
                        <RadioGroupItem
                          value={opt.key}
                          id={`${row.fromKey}-${opt.key}`}
                        />
                        <Label
                          htmlFor={`${row.fromKey}-${opt.key}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {opt.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                  <Select
                    value={levelValue}
                    onValueChange={(v) =>
                      updateLevel(row, v as IncomeLevelValue)
                    }
                  >
                    {/* disabled={levelLocked} */}
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="practice">By Practice</SelectItem>
                      <SelectItem value="provider">By Provider</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading || isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
