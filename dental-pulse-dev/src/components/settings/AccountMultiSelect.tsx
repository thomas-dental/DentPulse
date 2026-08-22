import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AccountOption {
  value: string;
  label: string;
  /** Optional section heading in the dropdown (e.g. Dentally location). */
  group?: string;
}

interface AccountMultiSelectProps {
  options: AccountOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** If true, show selected account labels above the trigger (like chips) */
  showSelected?: boolean;
  /** What one option is called in trigger/search text (default 'account') */
  itemNoun?: string;
  /** Set true when rendered inside a Dialog: the dialog's scroll lock blocks
   *  wheel events in the popover's portal unless the popover is modal too. */
  modalPopover?: boolean;
}

function groupOptions(options: AccountOption[]): { heading: string | null; items: AccountOption[] }[] {
  const hasGroups = options.some((o) => !!o.group);
  if (!hasGroups) return [{ heading: null, items: options }];

  const order: string[] = [];
  const byGroup = new Map<string, AccountOption[]>();
  for (const opt of options) {
    const key = (opt.group || 'Unassigned location').trim() || 'Unassigned location';
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push(opt);
  }
  return order.map((heading) => ({ heading, items: byGroup.get(heading)! }));
}

export function AccountMultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select accounts...',
  disabled,
  className,
  showSelected = false,
  itemNoun = 'account',
  modalPopover = false,
}: AccountMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const grouped = useMemo(() => groupOptions(options), [options]);

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const selectedOptions = options.filter((o) => value.includes(o.value));

  const allValues = useMemo(() => options.map((o) => o.value), [options]);
  const allSelected = allValues.length > 0 && value.length === allValues.length;
  const someSelected = value.length > 0 && !allSelected;
  const toggleAll = () => onChange(allSelected ? [] : allValues);

  return (
    <div>
      {showSelected && selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedOptions.map((s) => (
            <div
              key={s.value}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary rounded-md border border-primary/30 text-sm max-w-full"
            >
              <span className="truncate min-w-0 max-w-[220px]" title={s.label}>
                {s.label}
              </span>
              <button
                onClick={() => toggle(s.value)}
                className="ml-1 hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                aria-label={`Remove ${s.label}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Popover modal={modalPopover} open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn('w-full justify-between font-normal min-h-10', className)}
          >
            <span className="truncate">
              {value.length === 0 ? placeholder : `${value.length} ${itemNoun}(s) selected`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[400px] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${itemNoun}s...`} />
            {options.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground border-b"
              >
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  tabIndex={-1}
                  className="mr-2 pointer-events-none"
                  aria-hidden="true"
                />
                <span className="truncate">{allSelected ? `Clear all ${itemNoun}s` : `Select all ${itemNoun}s`}</span>
              </button>
            )}
            <CommandList className="max-h-72">
              <CommandEmpty>No {itemNoun} found.</CommandEmpty>
              {grouped.map((section) => (
                <CommandGroup
                  key={section.heading ?? '__all__'}
                  heading={section.heading ?? undefined}
                >
                  {section.items.map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={`${opt.label} ${opt.group ?? ''} ${opt.value}`}
                      onSelect={() => toggle(opt.value)}
                      className="cursor-pointer"
                    >
                      <Checkbox
                        checked={value.includes(opt.value)}
                        tabIndex={-1}
                        className="mr-2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <span className="truncate">{opt.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
