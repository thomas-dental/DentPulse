import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronsUpDown, RotateCcw, Search } from 'lucide-react';
import type { StatementReportRequest } from '@/services/cashflowService';

export interface TransactionsFilterState {
  filters: Partial<StatementReportRequest>;
  whoPaidSelected: string[];
  forWhatSelected: string[];
  transactionTypesSelected: string[];
}

interface TransactionsFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  whoPaidOptions: string[];
  forWhatOptions: string[];
  transactionTypeOptions: string[];
  value: TransactionsFilterState;
  onApply: (next: TransactionsFilterState) => void;
  onReset: () => void;
}

function MultiSelectField(props: {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { label, placeholder, searchPlaceholder, emptyText, options, selected, onChange } = props;

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-10">
            <span className="truncate">
              {selected.length === 0 ? placeholder : `${selected.length} selected`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup className="max-h-48 overflow-auto">
              {options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => {
                    onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt]);
                  }}
                  className="cursor-pointer"
                >
                  <Checkbox
                    checked={selected.includes(opt)}
                    className="mr-2"
                    onCheckedChange={() => {
                      onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt]);
                    }}
                  />
                  <span className="truncate">{opt}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function AmountRangeField(props: {
  label: string;
  minValue: number | null | undefined;
  maxValue: number | null | undefined;
  onMinChange: (v: number | null) => void;
  onMaxChange: (v: number | null) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{props.label}</Label>
      <div className="grid grid-cols-2 gap-3">
        <Input
          type="number"
          placeholder="Min"
          min={0}
          value={props.minValue ?? ''}
          onChange={(e) => props.onMinChange(e.target.value ? Number(e.target.value) : null)}
        />
        <Input
          type="number"
          placeholder="Max"
          min={0}
          value={props.maxValue ?? ''}
          onChange={(e) => props.onMaxChange(e.target.value ? Number(e.target.value) : null)}
        />
      </div>
    </div>
  );
}

export function TransactionsFilterDialog({
  open,
  onOpenChange,
  whoPaidOptions,
  forWhatOptions,
  transactionTypeOptions,
  value,
  onApply,
  onReset,
}: TransactionsFilterDialogProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const setFilter = (patch: Partial<StatementReportRequest>) => {
    setDraft((prev) => ({ ...prev, filters: { ...prev.filters, ...patch } }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Filter Options</DialogTitle>
          <DialogDescription>
            Narrow transactions by type, account, category, and amount ranges.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <MultiSelectField
            label="Transaction type"
            placeholder="All types"
            searchPlaceholder="Search transaction types..."
            emptyText="No types found."
            options={transactionTypeOptions}
            selected={draft.transactionTypesSelected}
            onChange={(transactionTypesSelected) => setDraft((prev) => ({ ...prev, transactionTypesSelected }))}
          />

          <div className="grid gap-2">
            <Label>Name</Label>
            <Input
              placeholder="Enter name"
              value={draft.filters.name ?? ''}
              onChange={(e) => setFilter({ name: e.target.value })}
            />
          </div>

          <div className="grid gap-2">
            <Label>Memo or Description</Label>
            <Input
              placeholder="Enter memo or description"
              value={draft.filters.memoOrDescription ?? ''}
              onChange={(e) => setFilter({ memoOrDescription: e.target.value })}
            />
          </div>

          <MultiSelectField
            label="Who Paid"
            placeholder="All accounts"
            searchPlaceholder="Search accounts..."
            emptyText="No account found."
            options={whoPaidOptions}
            selected={draft.whoPaidSelected}
            onChange={(whoPaidSelected) => setDraft((prev) => ({ ...prev, whoPaidSelected }))}
          />

          <MultiSelectField
            label="For What"
            placeholder="All categories"
            searchPlaceholder="Search categories..."
            emptyText="No category found."
            options={forWhatOptions}
            selected={draft.forWhatSelected}
            onChange={(forWhatSelected) => setDraft((prev) => ({ ...prev, forWhatSelected }))}
          />

          <AmountRangeField
            label="Money In (Min to Max)"
            minValue={draft.filters.debitMin}
            maxValue={draft.filters.debitMax}
            onMinChange={(debitMin) => setFilter({ debitMin })}
            onMaxChange={(debitMax) => setFilter({ debitMax })}
          />

          <AmountRangeField
            label="Money Out (Min to Max)"
            minValue={draft.filters.creditMin}
            maxValue={draft.filters.creditMax}
            onMinChange={(creditMin) => setFilter({ creditMin })}
            onMaxChange={(creditMax) => setFilter({ creditMax })}
          />

          <AmountRangeField
            label="Balance (Min to Max)"
            minValue={draft.filters.balanceMin}
            maxValue={draft.filters.balanceMax}
            onMinChange={(balanceMin) => setFilter({ balanceMin })}
            onMaxChange={(balanceMax) => setFilter({ balanceMax })}
          />

          <div className="flex gap-3 pt-2">
            <Button
              className="gap-2 flex-1"
              onClick={() => {
                onApply(draft);
                onOpenChange(false);
              }}
            >
              <Search className="w-4 h-4" />
              Search
            </Button>
            <Button
              variant="outline"
              className="gap-2 flex-1"
              onClick={() => {
                onReset();
                onOpenChange(false);
              }}
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
