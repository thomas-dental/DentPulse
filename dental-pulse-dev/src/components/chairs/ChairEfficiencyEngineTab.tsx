/**
 * ChairEfficiencyEngineTab
 *
 * Renders the "Chair Efficiency Engine" table inside the Chairs module. Each row
 * is a treatment (mirrors Treatment Insights currentItems: units = volume,
 * income = total revenue) with how long it occupies a chair. Data comes from
 * useChairEfficiencyEngine; this component is purely presentation — search,
 * client-side pagination, and a totals footer that follows the active filter.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Search, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useChairEfficiencyEngine, type ChairEfficiencyRow } from '@/hooks/useChairEfficiencyEngine';

// Thousands-separated number; pass maxFrac=1 for the one-decimal chair-hours column.
const fmtNumber = (n: number, maxFrac = 0) =>
  new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(n);

// GBP currency with 2 decimals, used for the Total Income column/footer.
const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

// YYYY-MM-DD → DD-MM-YYYY (matches the rest of the chairs/treatments tables).
const fmtDate = (ymd: string): string => {
  if (!ymd) return '-';
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${d}-${m}-${y}`;
};

export function ChairEfficiencyEngineTab() {
  // rows/totals already reflect the active period + location filter (handled in the hook).
  const { rows, totals, isLoading, isError } = useChairEfficiencyEngine();

  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Client-side search across treatment name and the formatted (DD-MM-YYYY) date.
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter(
      (r) =>
        r.treatmentName.toLowerCase().includes(q) ||
        fmtDate(r.itemDate).toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  // Clamp the page in case the filter shrank the result set below the current page.
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Totals reflect the search-filtered set so the footer matches what's shown.
  // No search → reuse the hook's pre-computed totals; otherwise recompute over the filtered rows.
  const visibleTotals = useMemo(() => {
    if (!searchQuery.trim()) return totals;
    const acc = filteredRows.reduce(
      (a, r) => {
        a.units += r.units;
        a.totalTimeMins += r.totalTimeMins;
        a.chairHrs += r.chairHrs;
        a.totalIncome += r.totalIncome;
        return a;
      },
      { units: 0, totalTimeMins: 0, chairHrs: 0, totalIncome: 0 },
    );
    // True weighted average (Σ time ÷ Σ units), matching the hook's totals.
    return { ...acc, avgTimeMins: acc.units > 0 ? acc.totalTimeMins / acc.units : 0 };
  }, [filteredRows, totals, searchQuery]);

  // Shared class for numeric cells: right-aligned, tabular figures, no wrapping.
  const colClass = 'py-3 px-4 text-right tabular-nums whitespace-nowrap';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chair Efficiency Engine</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toolbar: search box + page-size selector. Both reset to page 1 on change. */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search here..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Page Size</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table: three states — loading spinner, error placeholder, or the data table.
            On error we deliberately render nothing (not zeros) so figures are never misread. */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading chair efficiency data…</span>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <AlertTriangle className="w-8 h-8 text-warning" />
            <p className="font-medium text-foreground">Couldn’t load chair efficiency data</p>
            <p className="text-sm text-muted-foreground max-w-md">
              The data source isn’t available yet. Once the latest database update is
              applied, units and income will load here. Showing nothing rather than
              zeros so figures are never misread.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary/5 border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold text-foreground/80 whitespace-nowrap">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground/80">Treatment Name</th>
                  <th className="text-right py-3 px-4 font-semibold text-foreground/80">Avg Time to Complete Treatment (mins)</th>
                  <th className="text-right py-3 px-4 font-semibold text-foreground/80">Number Of Units</th>
                  <th className="text-right py-3 px-4 font-semibold text-foreground/80">Total Time (Minutes)</th>
                  <th className="text-right py-3 px-4 font-semibold text-foreground/80">Current Chair Time Occupied (Hrs)</th>
                  <th className="text-right py-3 px-4 font-semibold text-foreground/80">Total Income</th>
                </tr>
              </thead>
              <tbody>
                {/* Empty state vs. the current page of treatment rows. Key combines
                    date + treatment id (falls back to name) to stay unique. */}
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      No data for the selected period.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r: ChairEfficiencyRow) => (
                    <tr
                      key={`${r.itemDate}-${r.treatmentId ?? r.treatmentName}`}
                      className="border-b border-border/50 hover:bg-muted/30"
                    >
                      <td className="py-3 px-4 whitespace-nowrap">{fmtDate(r.itemDate)}</td>
                      <td className="py-3 px-4">{r.treatmentName}</td>
                      <td className={colClass}>{fmtNumber(r.avgTimeMins)}</td>
                      <td className={colClass}>{fmtNumber(r.units)}</td>
                      <td className={colClass}>{fmtNumber(r.totalTimeMins)}</td>
                      <td className={colClass}>{fmtNumber(r.chairHrs, 1)}</td>
                      <td className={colClass}>{fmtCurrency(r.totalIncome)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {/* Totals footer — sums the visible (filtered) rows, not just the current page. */}
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-3 px-4">Total</td>
                    <td className="py-3 px-4" />
                    <td className={colClass}>{fmtNumber(visibleTotals.avgTimeMins)}</td>
                    <td className={colClass}>{fmtNumber(visibleTotals.units)}</td>
                    <td className={colClass}>{fmtNumber(visibleTotals.totalTimeMins)}</td>
                    <td className={colClass}>{fmtNumber(visibleTotals.chairHrs, 1)}</td>
                    <td className={colClass}>{fmtCurrency(visibleTotals.totalIncome)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Pagination: only shown when there's more than one page of results. */}
        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredRows.length)} of {filteredRows.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="gap-1 h-8 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Button>
              <span className="text-xs px-2">
                Page {safePage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="gap-1 h-8 text-xs"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
