import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CommonFilterValues = Record<string, string | boolean>;

type BaseField = {
  id: string;
  label: string;
  group?: string;
};

type SelectField = BaseField & {
  type: "select";
  placeholder?: string;
  options: Array<{ label: string; value: string }>;
};

type TextField = BaseField & {
  type: "text";
  placeholder?: string;
};

type CheckboxField = BaseField & {
  type: "checkbox";
  layout?: "full" | "half";
};

type NumberRangeField = BaseField & {
  type: "numberRange";
  minKey: string;
  maxKey: string;
  minPlaceholder?: string;
  maxPlaceholder?: string;
};

type DateRangeField = BaseField & {
  type: "dateRange";
  fromKey: string;
  toKey: string;
};

export type CommonFilterField =
  | SelectField
  | TextField
  | CheckboxField
  | NumberRangeField
  | DateRangeField;

export type ColumnVisibilityOption = {
  id: string;
  label: string;
  layout?: "full" | "half";
};

type CommonFilterDialogProps = {
  title?: string;
  description?: string;
  triggerLabel?: string;
  fields: CommonFilterField[];
  values: CommonFilterValues;
  onApply: (nextValues: CommonFilterValues) => void;
  onReset?: (emptyValues: CommonFilterValues) => void;
};

const EMPTY_SELECT_VALUE = "__all__";

export function buildColumnVisibilityDefaults(
  options: ColumnVisibilityOption[],
  isVisibleByDefault = false,
): CommonFilterValues {
  return options.reduce<CommonFilterValues>((acc, option) => {
    acc[option.id] = isVisibleByDefault;
    return acc;
  }, {});
}

export function buildColumnVisibilityFields(
  options: ColumnVisibilityOption[],
  group = "Edit Columns",
): CommonFilterField[] {
  return options.map((option) => ({
    id: option.id,
    type: "checkbox",
    label: option.label,
    layout: option.layout ?? "half",
    group,
  }));
}

function buildEmptyValues(fields: CommonFilterField[]): CommonFilterValues {
  const next: CommonFilterValues = {};
  fields.forEach((field) => {
    if (field.type === "numberRange") {
      next[field.minKey] = "";
      next[field.maxKey] = "";
      return;
    }
    if (field.type === "dateRange") {
      next[field.fromKey] = "";
      next[field.toKey] = "";
      return;
    }
    if (field.type === "checkbox") {
      next[field.id] = false;
      return;
    }
    next[field.id] = "";
  });
  return next;
}

function countActiveFilters(fields: CommonFilterField[], values: CommonFilterValues) {
  let active = 0;
  fields.forEach((field) => {
    if (field.type === "numberRange") {
      if ((values[field.minKey] ?? "") !== "" || (values[field.maxKey] ?? "") !== "") active += 1;
      return;
    }
    if (field.type === "dateRange") {
      if ((values[field.fromKey] ?? "") !== "" || (values[field.toKey] ?? "") !== "") active += 1;
      return;
    }
    if (field.type === "checkbox") {
      if (Boolean(values[field.id])) active += 1;
      return;
    }
    if ((values[field.id] ?? "") !== "") active += 1;
  });
  return active;
}

export function CommonFilterDialog({
  title = "Filters",
  description = "Refine results with advanced filters.",
  triggerLabel = "Filters",
  fields,
  values,
  onApply,
  onReset,
}: CommonFilterDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CommonFilterValues>(values);

  useEffect(() => {
    if (open) setDraft(values);
  }, [open, values]);

  const activeCount = useMemo(() => countActiveFilters(fields, values), [fields, values]);

  const setValue = (key: string, value: string | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const groupedFields = useMemo(() => {
    const groups: Array<{ name: string; fields: CommonFilterField[] }> = [];
    const map = new Map<string, CommonFilterField[]>();

    fields.forEach((field) => {
      const groupName = field.group || "General";
      if (!map.has(groupName)) {
        map.set(groupName, []);
      }
      map.get(groupName)!.push(field);
    });

    map.forEach((groupFields, name) => {
      groups.push({ name, fields: groupFields });
    });

    return groups;
  }, [fields]);

  const resetDraft = () => {
    const empty = buildEmptyValues(fields);
    setDraft((prev) => ({ ...prev, ...empty }));
  };

  const applyDraft = () => {
    onApply(draft);
    setOpen(false);
  };

  const resetAndApply = () => {
    const empty = buildEmptyValues(fields);
    const next = { ...draft, ...empty };
    setDraft(next);
    onReset?.(next);
    onApply(next);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          {triggerLabel}
          {activeCount > 0 ? <Badge variant="secondary">{activeCount}</Badge> : null}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          {groupedFields.map((group) => (
            <div key={group.name} className="space-y-3">
              <div className="text-sm font-medium text-foreground">{group.name}</div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {group.fields.map((field) => {
            if (field.type === "select") {
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Select
                    value={(draft[field.id] as string) || EMPTY_SELECT_VALUE}
                    onValueChange={(v) => setValue(field.id, v === EMPTY_SELECT_VALUE ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EMPTY_SELECT_VALUE}>All</SelectItem>
                      {field.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            if (field.type === "text") {
              return (
                <div key={field.id} className="space-y-2 md:col-span-2">
                  <Label>{field.label}</Label>
                  <Input
                    value={(draft[field.id] as string) || ""}
                    onChange={(e) => setValue(field.id, e.target.value)}
                    placeholder={field.placeholder}
                  />
                </div>
              );
            }

            if (field.type === "checkbox") {
              return (
                <div
                  key={field.id}
                  className={`flex items-center gap-3 rounded-md border p-3 ${
                    field.layout === "half" ? "md:col-span-1" : "md:col-span-2"
                  }`}
                >
                  <Checkbox
                    checked={Boolean(draft[field.id])}
                    onCheckedChange={(checked) => setValue(field.id, checked === true)}
                    id={field.id}
                  />
                  <Label htmlFor={field.id} className="cursor-pointer">
                    {field.label}
                  </Label>
                </div>
              );
            }

            if (field.type === "numberRange") {
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      value={(draft[field.minKey] as string) || ""}
                      onChange={(e) => setValue(field.minKey, e.target.value)}
                      placeholder={field.minPlaceholder || "Min"}
                    />
                    <Input
                      type="number"
                      value={(draft[field.maxKey] as string) || ""}
                      onChange={(e) => setValue(field.maxKey, e.target.value)}
                      placeholder={field.maxPlaceholder || "Max"}
                    />
                  </div>
                </div>
              );
            }

            return (
              <div key={field.id} className="space-y-2">
                <Label>{field.label}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={(draft[field.fromKey] as string) || ""}
                    onChange={(e) => setValue(field.fromKey, e.target.value)}
                  />
                  <Input
                    type="date"
                    value={(draft[field.toKey] as string) || ""}
                    onChange={(e) => setValue(field.toKey, e.target.value)}
                  />
                </div>
              </div>
            );
                })}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={resetDraft}>
            Reset Draft
          </Button>
          <Button type="button" variant="outline" onClick={resetAndApply}>
            Clear All
          </Button>
          <Button type="button" onClick={applyDraft}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
