/**
 * Profit Benchmark category transaction drill-down (Pro-style modal).
 */
import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  accountingLinkClassName,
  isValidTransactionLink,
} from '@/utils/accountingTransactionLinks';
import type {
  ProfitCategoryDetailSummary,
  ProfitCategoryDrilldownTransaction,
} from '@/services/profitBenchmarkService';
import { cn } from '@/lib/utils';
import { formatGbp, formatPercentDisplay } from '@/utils/formatMoney';

const PAGE_SIZES = [10, 25, 50, 100];

function formatMoney(value: number, symbol = '£'): string {
  return formatGbp(value, { symbol });
}

function formatPct(value: number): string {
  return formatPercentDisplay(Number(value || 0));
}

function formatDisplayDate(value: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, 'dd-MM-yyyy');
}

export type ProfitCategoryDrilldownDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryName: string;
  loading: boolean;
  error: string | null;
  summary: ProfitCategoryDetailSummary | null;
  transactions: ProfitCategoryDrilldownTransaction[];
  accountingPlatform?: 'xero' | 'iplicit' | null;
  search: string;
  onSearchChange: (value: string) => void;
};

export function ProfitCategoryDrilldownDialog({
  open,
  onOpenChange,
  categoryName,
  loading,
  error,
  summary,
  transactions,
  accountingPlatform,
  search,
  onSearchChange,
}: ProfitCategoryDrilldownDialogProps) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const linkClass = accountingLinkClassName(accountingPlatform);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((t) =>
      [t.name, t.memoOrDescription, t.whoPaid, t.forWhat, t.transactionType, t.accountName]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [transactions, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const totalIn = filtered.reduce((s, t) => s + (t.moneyIn || 0), 0);
  const totalOut = filtered.reduce((s, t) => s + (t.moneyOut || 0), 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPage(0);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-xl">{categoryName || 'Category'}</DialogTitle>
        </DialogHeader>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm border rounded-lg p-3 bg-muted/30">
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">Expected</div>
              <div className="font-semibold tabular-nums">{formatMoney(summary.expected)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">Actual</div>
              <div className="font-semibold tabular-nums">{formatMoney(summary.actual)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">Actual %</div>
              <div className="font-semibold tabular-nums">{formatPct(summary.actualPct ?? 0)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">Benchmark</div>
              <div className="font-semibold tabular-nums">{formatPct(summary.benchmarkPercent)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">Variance</div>
              <div
                className={cn(
                  'font-semibold tabular-nums',
                  summary.variance > 0 ? 'text-red-600' : summary.variance < 0 ? 'text-green-600' : ''
                )}
              >
                {formatPct(summary.variance)}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => {
              setPage(0);
              onSearchChange(e.target.value);
            }}
            className="max-w-sm"
          />
        </div>

        <div className="flex-1 overflow-auto min-h-0 rounded-lg border">
          {error ? (
            <Alert variant="destructive" className="m-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No transactions found for this category.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Date</TableHead>
                  <TableHead className="min-w-[120px]">Transaction Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Memo Or Description</TableHead>
                  <TableHead>Who Paid</TableHead>
                  <TableHead>For What</TableHead>
                  <TableHead className="text-right text-green-600">Money (IN)</TableHead>
                  <TableHead className="text-right text-red-600">Money (OUT)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((tx, idx) => {
                  const link = tx.transactionLink;
                  return (
                    <TableRow key={`${tx.docId}-${tx.date}-${idx}`}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDisplayDate(tx.date)}
                      </TableCell>
                      <TableCell>
                        {isValidTransactionLink(link) ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn('inline-flex items-center gap-1.5 text-sm font-medium hover:underline', linkClass)}
                          >
                            <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            {tx.transactionType || '—'}
                          </a>
                        ) : (
                          <span className="text-sm">{tx.transactionType || '—'}</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate font-medium" title={tx.name}>
                        {tx.name || '—'}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground" title={tx.memoOrDescription}>
                        {tx.memoOrDescription || '—'}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate" title={tx.whoPaid}>
                        {tx.whoPaid || '—'}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate" title={tx.forWhat}>
                        {tx.forWhat || '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-green-600">
                        {tx.moneyIn > 0 ? formatMoney(tx.moneyIn) : '£0'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-600">
                        {tx.moneyOut > 0 ? formatMoney(tx.moneyOut) : '£0'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-muted/30 font-semibold">
                  <TableCell colSpan={6} className="text-right">
                    Total
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-green-600">{formatMoney(totalIn)}</TableCell>
                  <TableCell className="text-right tabular-nums text-red-600">{formatMoney(totalOut)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Page Size:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-8 w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>
              {filtered.length === 0
                ? '0'
                : `${safePage * pageSize + 1} - ${Math.min((safePage + 1) * pageSize, filtered.length)} of ${filtered.length}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
