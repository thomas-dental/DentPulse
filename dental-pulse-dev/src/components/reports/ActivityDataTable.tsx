/**
 * Generic sortable/searchable/paginated table with CSV export, shared by the
 * Dentally-matched activity reports (per-practitioner ProviderActivity page
 * and the all-practitioners PractitionerActivityReport page). Extracted from
 * ProviderActivity so both pages share one implementation instead of drifting.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronsUpDown, Download, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Pagination, PaginationContent, PaginationItem, PaginationEllipsis,
} from '@/components/ui/pagination';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export interface ColumnDef<R> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right';
  render: (r: R) => ReactNode;
  sortVal?: (r: R) => string | number;
  csv: (r: R) => string | number;
}

export function useTableState() {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  return { search, setSearch, sortKey, setSortKey, sortDir, setSortDir, page, setPage, pageSize, setPageSize };
}

export function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}: All</SelectItem>
        {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Checkbox-list dropdown filter — empty `values` means "All" (no filtering). */
export function MultiFilterSelect({ label, values, onChange, options }: {
  label: string; values: string[]; onChange: (v: string[]) => void; options: string[];
}) {
  const [open, setOpen] = useState(false);

  const toggle = (opt: string) => {
    onChange(values.includes(opt) ? values.filter(v => v !== opt) : [...values, opt]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-9 w-[170px] justify-between font-normal">
          <span className="truncate">
            {values.length === 0 ? `${label}: All` : `${label}: ${values.length} selected`}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup className="max-h-64 overflow-auto">
            {values.length > 0 && (
              <CommandItem onSelect={() => onChange([])} className="cursor-pointer text-muted-foreground">
                Clear selection
              </CommandItem>
            )}
            {options.map(opt => (
              <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)} className="cursor-pointer">
                <Checkbox checked={values.includes(opt)} tabIndex={-1} className="mr-2 pointer-events-none" aria-hidden="true" />
                <span className="truncate">{opt}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function DataTable<R extends { id: string }>({
  rows, columns, searchText, searchFields, ts, isLoading, emptyText, exportName, filtersSlot, onRowClick,
}: {
  rows: R[];
  columns: ColumnDef<R>[];
  searchText: string;
  searchFields: (r: R) => string;
  ts: ReturnType<typeof useTableState>;
  isLoading: boolean;
  emptyText: string;
  exportName: string;
  filtersSlot?: ReactNode;
  onRowClick?: (row: R) => void;
}) {
  const { sortKey, setSortKey, sortDir, setSortDir, page, setPage, pageSize, setPageSize } = ts;

  const searched = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => searchFields(r).toLowerCase().includes(q));
  }, [rows, searchText, searchFields]);

  const sorted = useMemo(() => {
    if (!sortKey) return searched;
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortVal) return searched;
    const arr = [...searched];
    arr.sort((a, b) => {
      const av = col.sortVal!(a); const bv = col.sortVal!(b);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [searched, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );
  useEffect(() => { setPage(1); }, [searchText, sortKey, sortDir, pageSize, rows, setPage]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortIcon = (key: string) =>
    sortKey !== key ? <ArrowUpDown className="w-3 h-3 opacity-40 inline" />
      : sortDir === 'asc' ? <ArrowUp className="w-3 h-3 inline" /> : <ArrowDown className="w-3 h-3 inline" />;

  const handleExport = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [columns.map(c => esc(c.label)).join(',')];
    for (const r of sorted) lines.push(columns.map(c => esc(c.csv(r))).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${exportName}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-[280px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={ts.search}
            onChange={e => ts.setSearch(e.target.value)}
            placeholder="Search…"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 ml-auto">
          {filtersSlot}
          <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
            <SelectTrigger className="h-9 w-[90px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={handleExport} disabled={sorted.length === 0}>
            <Download className="w-4 h-4 mr-1.5" /> Export
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground text-sm">{emptyText}</div>
        ) : (
          // text-sm matches the shared shadcn <Table> (w-full caption-bottom
          // text-sm) used on every other data-table page — without it this
          // raw <table> renders a step larger than the rest of the app.
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {columns.map(c => (
                  <th
                    key={c.key}
                    className={`py-3 px-4 font-medium text-muted-foreground ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {c.sortable ? (
                      <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                        {c.label} {sortIcon(c.key)}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => (
                <tr
                  key={r.id}
                  className={`border-b border-border/50 hover:bg-muted/30 ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={onRowClick ? (e) => {
                    // Don't hijack clicks on inner links/buttons (they own their own navigation).
                    const target = e.target as HTMLElement;
                    if (target.closest('a, button')) return;
                    onRowClick(r);
                  } : undefined}
                >
                  {columns.map((c, idx) => (
                    <td
                      key={c.key}
                      className={`py-3 px-4 ${c.align === 'right' ? 'text-right' : ''} ${idx === 0 ? 'font-medium' : ''}`}
                    >
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sorted.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length}
          </div>
          {totalPages > 1 && (() => {
            const maxVisible = 5;
            const pages: (number | string)[] = [];
            if (totalPages <= maxVisible) {
              for (let i = 1; i <= totalPages; i++) pages.push(i);
            } else {
              pages.push(1);
              if (page > 3) pages.push('ellipsis-start');
              const start = Math.max(2, page - 1);
              const end = Math.min(totalPages - 1, page + 1);
              for (let i = start; i <= end; i++) pages.push(i);
              if (page < totalPages - 2) pages.push('ellipsis-end');
              pages.push(totalPages);
            }
            return (
              <Pagination className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="gap-1 pl-2.5"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>Previous</span>
                    </Button>
                  </PaginationItem>
                  {pages.map((p, index) => (
                    (p === 'ellipsis-start' || p === 'ellipsis-end') ? (
                      <PaginationItem key={`ellipsis-${index}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={p}>
                        <Button
                          variant={page === p ? 'outline' : 'ghost'}
                          size="icon"
                          onClick={() => setPage(p as number)}
                          className="h-9 w-9"
                        >
                          {p}
                        </Button>
                      </PaginationItem>
                    )
                  ))}
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="gap-1 pr-2.5"
                    >
                      <span>Next</span>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            );
          })()}
        </div>
      )}
    </div>
  );
}

