/**
 * PE Invoices — sortable, searchable invoice list (mockup-aligned).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatGbp } from '@/components/patient-economics/InvoicesCharts';
import type { PeInvoiceListRow } from '@/services/integrations/peInvoicesService';
import {
  deriveInvoiceDisplayStatus,
  PE_INVOICE_DISPLAY_STATUS_LABELS,
  type PeInvoiceDisplayStatus,
} from '@/lib/peInvoicesConstants';
import { cn } from '@/lib/utils';

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];

type InvoiceStatusFilter = 'all' | PeInvoiceDisplayStatus;

const STATUS_FILTERS: { key: InvoiceStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: PE_INVOICE_DISPLAY_STATUS_LABELS.paid },
  { key: 'current', label: PE_INVOICE_DISPLAY_STATUS_LABELS.current },
  { key: 'part-paid', label: PE_INVOICE_DISPLAY_STATUS_LABELS['part-paid'] },
  { key: 'overdue', label: PE_INVOICE_DISPLAY_STATUS_LABELS.overdue },
];

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
        active
          ? 'border-primary/30 bg-primary/12 text-primary'
          : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

export type InvoiceListSortKey =
  | 'invoice'
  | 'patient'
  | 'practice'
  | 'raised'
  | 'amount'
  | 'outstanding'
  | 'age'
  | 'status';

type SortDir = 'asc' | 'desc';

function displayStatusBadgeClass(status: PeInvoiceDisplayStatus): string {
  switch (status) {
    case 'paid':
      return 'border-success/30 bg-success-muted text-success';
    case 'current':
      return 'border-border bg-muted text-muted-foreground';
    case 'part-paid':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200';
    case 'overdue':
      return 'border-danger/30 bg-danger-muted text-danger-strong';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

function ageBadgeClass(days: number): string {
  if (days > 60) return 'border-danger/30 bg-danger-muted text-danger-strong';
  if (days > 30) return 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200';
  return 'border-border bg-muted text-muted-foreground';
}

function compareRows(a: PeInvoiceListRow, b: PeInvoiceListRow, key: InvoiceListSortKey): number {
  switch (key) {
    case 'invoice':
      return (a.invoiceNumber ?? a.platformInvoiceId).localeCompare(
        b.invoiceNumber ?? b.platformInvoiceId,
      );
    case 'patient':
      return (a.patientName ?? '').localeCompare(b.patientName ?? '');
    case 'practice':
      return a.practiceName.localeCompare(b.practiceName);
    case 'raised':
      return (a.invoiceDate ?? '').localeCompare(b.invoiceDate ?? '');
    case 'amount':
      return a.amountGbp - b.amountGbp;
    case 'outstanding':
      return a.outstandingGbp - b.outstandingGbp;
    case 'age':
      return a.daysPastDue - b.daysPastDue;
    case 'status':
      return deriveInvoiceDisplayStatus(a).localeCompare(deriveInvoiceDisplayStatus(b));
    default:
      return 0;
  }
}

function sortRows(
  list: PeInvoiceListRow[],
  sortBy: InvoiceListSortKey,
  sortDir: SortDir,
): PeInvoiceListRow[] {
  const sorted = [...list].sort((a, b) => {
    const cmp = compareRows(a, b, sortBy);
    if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;

    if (sortBy === 'outstanding' && sortDir === 'desc') {
      return (a.invoiceDate ?? '').localeCompare(b.invoiceDate ?? '');
    }
    return 0;
  });
  return sorted;
}

type InvoicesListTableProps = {
  rows: PeInvoiceListRow[];
  contextPracticeId: string | null | undefined;
  cashLeakageWindowDays: number;
  trailingMonths: number;
  cashLeakageCount: number;
  cashLeakageGbp: number;
  /** When location, show/filter by Dentally sites instead of organisation. */
  rollupMode?: 'location' | 'practice';
  /** All locations/practices in scope (so filter lists sites with £0 invoices too). */
  knownScopes?: Array<{ id: string; name: string }>;
};

const UNASSIGNED_LOCATION_ID = '__unassigned__';

function rowLocationId(row: PeInvoiceListRow): string {
  return row.locationId ?? UNASSIGNED_LOCATION_ID;
}

function rowLocationLabel(row: PeInvoiceListRow): string {
  if (row.locationId) return row.locationName?.trim() || 'Location';
  return 'Unassigned';
}

export function InvoicesListTable({
  rows,
  contextPracticeId,
  cashLeakageWindowDays,
  trailingMonths,
  cashLeakageCount,
  cashLeakageGbp,
  rollupMode = 'practice',
  knownScopes = [],
}: InvoicesListTableProps) {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>('all');
  const [leakageOnly, setLeakageOnly] = useState(false);
  const [sortBy, setSortBy] = useState<InvoiceListSortKey>('outstanding');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim().toLowerCase()), 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, scopeFilter, statusFilter, leakageOnly, sortBy, sortDir, pageSize]);

  const locationOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of knownScopes) {
      map.set(s.id, s.name);
    }
    for (const r of rows) {
      map.set(rowLocationId(r), rowLocationLabel(r));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows, knownScopes]);

  const practiceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of knownScopes) {
      map.set(s.id, s.name);
    }
    for (const r of rows) {
      map.set(r.practiceId, r.practiceName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows, knownScopes]);

  const useLocationScope = rollupMode === 'location' || locationOptions.length > 1;
  const scopeOptions = useLocationScope ? locationOptions : practiceOptions;
  const scopeNoun = useLocationScope ? 'location' : 'practice';
  const scopeNounPlural = useLocationScope ? 'locations' : 'practices';

  const filtered = useMemo(() => {
    let list = rows;

    if (scopeFilter !== 'all') {
      list = useLocationScope
        ? list.filter((r) => rowLocationId(r) === scopeFilter)
        : list.filter((r) => r.practiceId === scopeFilter);
    } else if (!useLocationScope && contextPracticeId && practiceOptions.length <= 1) {
      list = list.filter((r) => r.practiceId === contextPracticeId);
    }
    // Location mode + "all": keep every invoice across all sites (no org collapse).

    if (leakageOnly) {
      list = list.filter((r) => r.isCashLeakage);
    }

    if (statusFilter !== 'all') {
      list = list.filter((r) => deriveInvoiceDisplayStatus(r) === statusFilter);
    }

    if (debouncedSearch) {
      list = list.filter((r) => {
        const hay = [
          r.invoiceNumber,
          r.platformInvoiceId,
          r.patientName,
          r.practiceName,
          r.locationName,
          r.patientId != null ? String(r.patientId) : '',
          r.status,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(debouncedSearch);
      });
    }

    if (useLocationScope && sortBy === 'practice') {
      const mul = sortDir === 'asc' ? 1 : -1;
      return [...list].sort(
        (a, b) => mul * rowLocationLabel(a).localeCompare(rowLocationLabel(b)),
      );
    }

    return sortRows(list, sortBy, sortDir);
  }, [
    rows,
    scopeFilter,
    statusFilter,
    useLocationScope,
    contextPracticeId,
    practiceOptions.length,
    leakageOnly,
    debouncedSearch,
    sortBy,
    sortDir,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key: InvoiceListSortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'patient' || key === 'practice' || key === 'invoice' ? 'asc' : 'desc');
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-border px-5 py-10 text-center">
        <p className="text-sm font-medium text-foreground">No invoices in scope</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Sync Dentally invoices for the last {trailingMonths} months, or any invoice still
          outstanding.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1 basis-[240px]">
          <h3 className="text-[15px] font-bold text-foreground">Invoices</h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Outstanding first, oldest at the top. Chase by value, not by date raised.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scopeOptions.length > 1 && (
            <Select value={scopeFilter} onValueChange={setScopeFilter}>
              <SelectTrigger className="h-9 w-[200px] max-w-full">
                <SelectValue placeholder={`All ${scopeNounPlural}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All {scopeNounPlural}</SelectItem>
                {scopeOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative w-[220px] max-w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={`Search invoice, patient, ${scopeNoun}…`}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-2.5">
        {STATUS_FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            active={statusFilter === f.key}
            onClick={() =>
              setStatusFilter(statusFilter === f.key ? 'all' : f.key)
            }
          />
        ))}
        {cashLeakageCount > 0 && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <FilterChip
              label="Cash leakage"
              active={leakageOnly}
              onClick={() => setLeakageOnly((v) => !v)}
            />
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
          {debouncedSearch
            ? `No invoices match “${searchInput.trim()}”.`
            : leakageOnly
              ? 'No cash-leakage invoices in the current filter.'
              : statusFilter !== 'all'
                ? `No invoices with status “${PE_INVOICE_DISPLAY_STATUS_LABELS[statusFilter]}”.`
                : scopeFilter !== 'all'
                  ? `No invoices for this ${scopeNoun}.`
                  : 'No invoices match the current filters.'}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full min-w-[960px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                  <th className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('invoice')}
                    >
                      Invoice
                      {sortBy === 'invoice' && (
                        <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('patient')}
                    >
                      Patient
                      {sortBy === 'patient' && (
                        <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('practice')}
                    >
                      {useLocationScope ? 'Location' : 'Practice'}
                      {sortBy === 'practice' && (
                        <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('raised')}
                    >
                      Raised
                      {sortBy === 'raised' && (
                        <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('amount')}
                    >
                      Amount
                      {sortBy === 'amount' && (
                        <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('outstanding')}
                    >
                      Outstanding
                      {sortBy === 'outstanding' && (
                        <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('age')}
                    >
                      Age
                      {sortBy === 'age' && (
                        <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('status')}
                    >
                      Status
                      {sortBy === 'status' && (
                        <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const displayStatus = deriveInvoiceDisplayStatus(row);
                  const patientRecordsUrl = row.patientUuid
                    ? `/patients?tab=patient-records&patientId=${encodeURIComponent(row.patientUuid)}`
                    : null;
                  const patientLabel =
                    row.patientName ?? (row.patientId != null ? `#${row.patientId}` : '—');

                  return (
                    <tr
                      key={`${row.practiceId}-${row.platformInvoiceId}`}
                      className={cn(
                        'border-b border-border/60 last:border-b-0 hover:bg-primary/[0.04]',
                        row.isCashLeakage && 'bg-primary/[0.03]',
                      )}
                    >
                      <td className="px-3 py-3 font-semibold text-foreground">
                        {row.invoiceNumber ?? row.platformInvoiceId}
                        {row.isCashLeakage && (
                          <span className="ml-2 inline-flex rounded-full border border-primary/25 bg-primary/12 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                            Leakage
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {patientRecordsUrl ? (
                          <Link
                            to={patientRecordsUrl}
                            className="font-semibold text-primary hover:underline"
                          >
                            {patientLabel}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{patientLabel}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-foreground">
                        {useLocationScope ? rowLocationLabel(row) : row.practiceName}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{row.invoiceDate ?? '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatGbp(row.amountGbp)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right tabular-nums',
                          row.outstandingGbp > 0 ? 'text-danger' : 'text-muted-foreground',
                        )}
                      >
                        {formatGbp(row.outstandingGbp)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums',
                            ageBadgeClass(row.daysPastDue),
                          )}
                        >
                          {row.daysPastDue}d
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                            displayStatusBadgeClass(displayStatus),
                          )}
                        >
                          {PE_INVOICE_DISPLAY_STATUS_LABELS[displayStatus]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
            <span>
              Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)}{' '}
              of {filtered.length.toLocaleString('en-GB')} invoices
              {filtered.length !== rows.length
                ? ` (filtered from ${rows.length.toLocaleString('en-GB')})`
                : ''}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {totalPages > 1 && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 px-0"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                    title="Previous"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="tabular-nums">
                    Page {safePage} of {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 px-0"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                    title="Next"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Select
                value={String(pageSize)}
                onValueChange={(v) => setPageSize(Number(v))}
              >
                <SelectTrigger className="h-8 w-[64px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </>
      )}

      {cashLeakageCount > 0 && (
        <p className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
          Cash leakage = charged ≥{cashLeakageWindowDays}d ago, not fully collected.
        </p>
      )}
    </div>
  );
}
