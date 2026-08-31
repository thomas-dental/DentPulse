/**
 * PE Invoices — sortable, searchable invoice list (mockup-aligned).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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

const PAGE_SIZE = 15;

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

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

function displayStatusBadgeClass(status: PeInvoiceDisplayStatus): string {
  switch (status) {
    case 'paid':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'current':
      return 'bg-muted text-muted-foreground border-border';
    case 'part-paid':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'overdue':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function ageBadgeClass(days: number): string {
  if (days > 60) return 'bg-red-50 text-red-700 border-red-200';
  if (days > 30) return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-muted text-muted-foreground border-border';
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

function invoiceActionLabel(status: PeInvoiceDisplayStatus): string {
  if (status === 'paid') return 'View';
  if (status === 'current') return 'Remind';
  return 'Chase';
}

type InvoicesListTableProps = {
  rows: PeInvoiceListRow[];
  contextPracticeId: string | null | undefined;
  cashLeakageWindowDays: number;
  trailingMonths: number;
  cashLeakageCount: number;
  cashLeakageGbp: number;
};

export function InvoicesListTable({
  rows,
  contextPracticeId,
  cashLeakageWindowDays,
  trailingMonths,
  cashLeakageCount,
  cashLeakageGbp,
}: InvoicesListTableProps) {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [practiceFilter, setPracticeFilter] = useState<string>('all');
  const [leakageOnly, setLeakageOnly] = useState(false);
  const [sortBy, setSortBy] = useState<InvoiceListSortKey>('outstanding');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim().toLowerCase()), 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, practiceFilter, leakageOnly, sortBy, sortDir]);

  const practiceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.practiceId, r.practiceName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;

    if (practiceFilter !== 'all') {
      list = list.filter((r) => r.practiceId === practiceFilter);
    } else if (contextPracticeId && practiceOptions.length <= 1) {
      list = list.filter((r) => r.practiceId === contextPracticeId);
    }

    if (leakageOnly) {
      list = list.filter((r) => r.isCashLeakage);
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

    return sortRows(list, sortBy, sortDir);
  }, [
    rows,
    practiceFilter,
    contextPracticeId,
    practiceOptions.length,
    leakageOnly,
    debouncedSearch,
    sortBy,
    sortDir,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggleSort = (key: InvoiceListSortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'patient' || key === 'practice' || key === 'invoice' ? 'asc' : 'desc');
    }
  };

  const overdueBucketGbp = filtered
    .filter((r) => r.isOutstanding && r.agingBucket !== '0-30')
    .reduce((s, r) => s + r.outstandingGbp, 0);
  const currentBucketGbp = filtered
    .filter((r) => r.isOutstanding && r.agingBucket === '0-30')
    .reduce((s, r) => s + r.outstandingGbp, 0);

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
    <div className="rounded-[14px] border border-border bg-card shadow-sm">
      <div className="border-b border-border/60 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold text-foreground">Invoices</h3>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Outstanding first, oldest at the top. Chase by value, not by date raised.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {cashLeakageCount > 0 && (
              <span className="rounded-full border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-800">
                {formatGbp(cashLeakageGbp)} cash leakage
              </span>
            )}
            {overdueBucketGbp > 0 && (
              <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-[11px] font-semibold text-destructive">
                {formatGbp(overdueBucketGbp)} overdue
              </span>
            )}
            {currentBucketGbp > 0 && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-[11px] font-semibold text-warning">
                {formatGbp(currentBucketGbp)} current
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search invoice, patient, practice…"
              className="h-8 pl-8 text-xs"
            />
          </div>

          {practiceOptions.length > 1 && (
            <Select value={practiceFilter} onValueChange={setPracticeFilter}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Practice" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All practices</SelectItem>
                {practiceOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {cashLeakageCount > 0 && (
            <Button
              type="button"
              variant={leakageOnly ? 'default' : 'outline'}
              size="sm"
              className={cn('h-8 text-xs', leakageOnly && 'bg-violet-600 hover:bg-violet-700')}
              onClick={() => setLeakageOnly((v) => !v)}
            >
              Cash leakage only
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {debouncedSearch
            ? `No invoices match “${searchInput.trim()}”.`
            : leakageOnly
              ? 'No cash-leakage invoices in the current filter.'
              : 'No invoices match the current filters.'}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('invoice')}>
                      Invoice <SortIcon active={sortBy === 'invoice'} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('patient')}>
                      Patient <SortIcon active={sortBy === 'patient'} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('practice')}>
                      Practice <SortIcon active={sortBy === 'practice'} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('raised')}>
                      Raised <SortIcon active={sortBy === 'raised'} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('amount')}>
                      Amount <SortIcon active={sortBy === 'amount'} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('outstanding')}>
                      Outstanding <SortIcon active={sortBy === 'outstanding'} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('age')}>
                      Age <SortIcon active={sortBy === 'age'} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('status')}>
                      Status <SortIcon active={sortBy === 'status'} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const displayStatus = deriveInvoiceDisplayStatus(row);
                  const actionLabel = invoiceActionLabel(displayStatus);
                  const patientRecordsUrl =
                    row.patientUuid
                      ? `/patients?tab=patient-records&patientId=${encodeURIComponent(row.patientUuid)}`
                      : null;

                  return (
                    <tr
                      key={`${row.practiceId}-${row.platformInvoiceId}`}
                      className={cn(
                        'border-b border-border/40 last:border-b-0 hover:bg-primary/[0.04]',
                        row.isCashLeakage && 'bg-violet-50/60 dark:bg-violet-950/20',
                      )}
                    >
                      <td className="px-5 py-3 font-semibold text-foreground">
                        {row.invoiceNumber ?? row.platformInvoiceId}
                        {row.isCashLeakage && (
                          <span className="ml-2 inline-flex rounded-full border border-violet-300 bg-violet-100 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide text-violet-900">
                            Leakage
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {row.patientName ?? (row.patientId != null ? `#${row.patientId}` : '—')}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{row.practiceName}</td>
                      <td className="px-3 py-3 text-muted-foreground">{row.invoiceDate ?? '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatGbp(row.amountGbp)}</td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right font-semibold tabular-nums',
                          row.outstandingGbp > 0 ? 'text-danger-strong' : 'text-muted-foreground',
                        )}
                      >
                        {formatGbp(row.outstandingGbp)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                            ageBadgeClass(row.daysPastDue),
                          )}
                        >
                          {row.daysPastDue}d
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                            displayStatusBadgeClass(displayStatus),
                          )}
                        >
                          {PE_INVOICE_DISPLAY_STATUS_LABELS[displayStatus]}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {actionLabel === 'View' && patientRecordsUrl ? (
                          <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" asChild>
                            <Link to={patientRecordsUrl}>View</Link>
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            disabled={!patientRecordsUrl && actionLabel === 'View'}
                            title={
                              actionLabel !== 'View'
                                ? `${actionLabel} workflow not connected yet`
                                : undefined
                            }
                          >
                            {actionLabel}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
              <p className="text-[12px] text-muted-foreground">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
                {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-xs text-muted-foreground">
                  {safePage} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {cashLeakageCount > 0 && (
        <p className="border-t border-border/40 px-5 py-2 text-[11px] text-muted-foreground">
          Cash leakage = charged ≥{cashLeakageWindowDays}d ago, not fully collected.
        </p>
      )}
    </div>
  );
}
