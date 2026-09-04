/**
 * PE Invoices — sortable, searchable invoice list (mockup-aligned).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatGbp } from '@/components/patient-economics/InvoicesCharts';
import {
  DentallyInvoiceLink,
  DentallyPatientLink,
} from '@/components/patient-economics/DentallyLinks';
import type { PeInvoiceListRow, PeInvoicesListParams } from '@/services/integrations/peInvoicesTypes';
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

type InvoicesListTableProps = {
  rows: PeInvoiceListRow[];
  total: number;
  listParams: PeInvoicesListParams;
  onListParamsChange: (patch: Partial<PeInvoicesListParams>) => void;
  isFetching?: boolean;
  contextPracticeId: string | null | undefined;
  cashLeakageWindowDays: number;
  cashLeakageCount: number;
  cashLeakageGbp: number;
  rollupMode?: 'location' | 'practice';
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
  total,
  listParams,
  onListParamsChange,
  isFetching = false,
  contextPracticeId,
  cashLeakageWindowDays,
  cashLeakageCount,
  cashLeakageGbp,
  rollupMode = 'practice',
  knownScopes = [],
}: InvoicesListTableProps) {
  const page = listParams.page ?? 1;
  const pageSize = listParams.pageSize ?? 5;
  const sortBy = (listParams.sort ?? 'outstanding') as InvoiceListSortKey;
  const sortDir = listParams.sortDir ?? 'desc';
  const statusFilter = (listParams.statusFilter ?? 'all') as InvoiceStatusFilter;
  const leakageOnly = listParams.cashLeakageOnly ?? false;
  const searchInput = listParams.search ?? '';

  const [localSearch, setLocalSearch] = useState(searchInput);

  useEffect(() => {
    setLocalSearch(searchInput);
  }, [searchInput]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = localSearch.trim();
      if (trimmed !== (listParams.search ?? '')) {
        onListParamsChange({ search: trimmed, page: 1 });
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [localSearch, listParams.search, onListParamsChange]);

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
  const scopeNoun = useLocationScope ? 'location' : 'practice';
  const scopeNounPlural = useLocationScope ? 'locations' : 'practices';

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const toggleSort = (key: InvoiceListSortKey) => {
    if (sortBy === key) {
      onListParamsChange({
        sortDir: sortDir === 'asc' ? 'desc' : 'asc',
        page: 1,
      });
    } else {
      onListParamsChange({
        sort: key,
        sortDir: key === 'patient' || key === 'practice' || key === 'invoice' ? 'asc' : 'desc',
        page: 1,
      });
    }
  };

  if (total === 0 && !isFetching && rows.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-border px-5 py-10 text-center">
        <p className="text-sm font-medium text-foreground">No invoices in scope</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          No invoices with a raised date in the selected period.
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
            Raised in the selected period · sorted by outstanding, oldest overdue first
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-[220px] max-w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
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
            onClick={() => {
              const next =
                statusFilter === f.key ? 'all' : f.key;
              onListParamsChange({ statusFilter: next, page: 1 });
            }}
          />
        ))}
        {cashLeakageCount > 0 && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <FilterChip
              label="Cash leakage"
              active={leakageOnly}
              onClick={() =>
                onListParamsChange({
                  cashLeakageOnly: !leakageOnly,
                  page: 1,
                })
              }
            />
          </>
        )}
      </div>

      {total === 0 && !isFetching ? (
        <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
          {searchInput
            ? `No invoices match “${localSearch.trim()}”.`
            : leakageOnly
              ? 'No cash-leakage invoices in the current filter.'
              : statusFilter !== 'all'
                ? `No invoices with status “${PE_INVOICE_DISPLAY_STATUS_LABELS[statusFilter]}”.`
                : 'No invoices raised in the selected period.'}
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
                {isFetching &&
                  Array.from({ length: pageSize }).map((_, i) => (
                    <tr key={`sk-${i}`} className="border-b border-border/60">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-3 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))}
                {!isFetching &&
                  rows.map((row) => {
                  const displayStatus = deriveInvoiceDisplayStatus(row);
                  const patientLabel =
                    row.patientName ?? (row.patientId != null ? `#${row.patientId}` : '—');
                  const invoiceLabel = row.invoiceNumber ?? row.platformInvoiceId;

                  return (
                    <tr
                      key={`${row.practiceId}-${row.platformInvoiceId}`}
                      className={cn(
                        'border-b border-border/60 last:border-b-0 hover:bg-primary/[0.04]',
                        row.isCashLeakage && 'bg-primary/[0.03]',
                      )}
                    >
                      <td className="px-3 py-3 font-semibold text-foreground">
                        <DentallyInvoiceLink
                          label={
                            <>
                              {invoiceLabel}
                              {row.isCashLeakage && (
                                <span className="ml-2 inline-flex rounded-full border border-primary/25 bg-primary/12 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                                  Leakage
                                </span>
                              )}
                            </>
                          }
                          dentallyPatientUuid={row.dentallyPatientUuid}
                          accountUuid={row.accountUuid}
                          invoiceUuid={row.invoiceUuid}
                          className="text-foreground"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <DentallyPatientLink dentallyPatientUuid={row.dentallyPatientUuid}>
                          {patientLabel}
                        </DentallyPatientLink>
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
              {isFetching && total === 0 ? (
                <Skeleton className="h-3 w-48" />
              ) : (
                <>
                  Showing {total === 0 ? 0 : (safePage - 1) * pageSize + 1}–
                  {Math.min(safePage * pageSize, total)} of {total.toLocaleString('en-GB')} invoices
                </>
              )}
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
                    onClick={() =>
                      onListParamsChange({ page: Math.max(1, safePage - 1) })
                    }
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
                    onClick={() =>
                      onListParamsChange({ page: Math.min(totalPages, safePage + 1) })
                    }
                    aria-label="Next page"
                    title="Next"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Select
                value={String(pageSize)}
                onValueChange={(v) =>
                  onListParamsChange({ pageSize: Number(v), page: 1 })
                }
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
