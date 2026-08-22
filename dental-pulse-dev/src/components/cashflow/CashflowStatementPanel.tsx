import { useState, useMemo, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useCashflowStatement } from '@/hooks/useCashflowStatement';
import {
  archiveCashflowReport,
  getCashflowCategoryDrilldown,
  type CashflowCategoryDrilldownTransaction,
} from '@/services/cashflowService';
import { CashflowStatementMergedTable, type CashflowDrilldownParams } from '@/components/cashflow/CashflowStatementMergedTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartDateFilter,
  calculateDateRangeFromFilter,
  getDateFilterLabel,
  type DateFilterType,
  type CustomRange,
} from '@/components/ui/chart-date-filter';
import {
  getInitialCashflowStatementDates,
  saveCashflowStatementDates,
} from '@/utils/cashflowStatementDatePersistence';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExternalLink, Calendar, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { accountingLinkClassName, isValidTransactionLink } from '@/utils/accountingTransactionLinks';
import { enrichCashflowReportWithTotalColumn, CASHFLOW_TOTAL_COLUMN } from '@/utils/cashflowReportTotals';

/**
 * Self-contained "Cash Flow Statement" panel — same feature as tab 2 of
 * /cashflow/preparing-statement (CashflowStatementMergedTable backed by
 * useCashflowStatement's cashflow-report query), extracted so it can be
 * embedded elsewhere (Financial Reports) without touching that page's
 * existing 3-tab layout/shared date range.
 *
 * NOTE: unlike the live Xero/QuickBooks Profit & Loss / Balance Sheet tabs,
 * this reads from pre-synced/canonicalized database tables (cashflow-report
 * Edge Function) — Xero/QuickBooks have no native "cash flow statement"
 * report to call live, so this is a derived view, only as fresh as the last
 * sync. It intentionally has its own date range + Monthly/Weekly toggle
 * rather than "Compare with", since that control doesn't apply to this data.
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type PeriodGranularity = 'monthly' | 'weekly';

function startOfWeekMonday(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay();
  const diff = (day + 6) % 7;
  r.setDate(r.getDate() - diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

const formatCurrency = (value: number, symbol = '£'): string => {
  if (value === 0) return '–';
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return value < 0 ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
};

const formatDisplayDate = (value: string): string => {
  if (!value) return '–';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, 'dd/MM/yyyy');
};

interface CashflowStatementPanelProps {
  /** Practice location to scope the statement to — pass the location the rest of the page is scoped to, or omit/null for all locations. */
  locationId?: string | null;
}

export function CashflowStatementPanel({ locationId }: CashflowStatementPanelProps) {
  const { organizationId } = useOrganization();
  const { dateRange: globalDateRange } = useFilters();

  // Restore last statement dates for this session; otherwise seed from the top-nav filter.
  const [dateFilter, setDateFilter] = useState<DateFilterType>(
    () =>
      getInitialCashflowStatementDates({
        from: globalDateRange.startDate,
        to: globalDateRange.endDate,
      }).dateFilter,
  );
  const [customRange, setCustomRange] = useState<CustomRange>(
    () =>
      getInitialCashflowStatementDates({
        from: globalDateRange.startDate,
        to: globalDateRange.endDate,
      }).customRange,
  );

  useEffect(() => {
    saveCashflowStatementDates({ dateFilter, customRange });
  }, [dateFilter, customRange]);

  // Follow the top-nav date filter when it changes, without clobbering a restored session range on first mount.
  const skipNextGlobalDateSync = useRef(true);
  useEffect(() => {
    if (skipNextGlobalDateSync.current) {
      skipNextGlobalDateSync.current = false;
      return;
    }
    setDateFilter('custom');
    setCustomRange({ from: globalDateRange.startDate, to: globalDateRange.endDate });
  }, [globalDateRange.startDate, globalDateRange.endDate]);

  const dateFilterLabel =
    dateFilter === 'custom' && customRange.from && customRange.to
      ? `${format(customRange.from, 'dd-MM-yyyy')} → ${format(customRange.to, 'dd-MM-yyyy')}`
      : getDateFilterLabel(dateFilter);
  const computedRange = useMemo(
    () => calculateDateRangeFromFilter(dateFilter, customRange),
    [dateFilter, customRange],
  );
  const dateRange = useMemo(
    () => ({ from: computedRange.startDate, to: computedRange.endDate }),
    [computedRange],
  );
  const [periodGranularity, setPeriodGranularity] = useState<PeriodGranularity>('monthly');
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({ 0: true, 1: true, 2: true });
  const [isArchiving, setIsArchiving] = useState(false);

  const fromDate = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
  const toDate = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';

  // Map backend column labels to period keys (YYYY-MM monthly, or week-start YYYY-MM-DD weekly) for the drilldown.
  const monthKeyByLabel = useMemo(() => {
    if (!fromDate || !toDate) return new Map<string, string>();
    const map = new Map<string, string>();
    if (periodGranularity === 'weekly') {
      const from = new Date(`${fromDate}T00:00:00`);
      const to = new Date(`${toDate}T00:00:00`);
      let cur = startOfWeekMonday(from);
      const last = startOfWeekMonday(to);
      while (cur <= last) {
        const weekEnd = new Date(cur);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const key = format(cur, 'yyyy-MM-dd');
        const label = `${cur.getDate()} ${MONTH_NAMES[cur.getMonth()]}–${weekEnd.getDate()} ${MONTH_NAMES[weekEnd.getMonth()]}`;
        map.set(label, key);
        cur = new Date(cur);
        cur.setDate(cur.getDate() + 7);
      }
      return map;
    }
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const start = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const yy = String(y).slice(-2);
      const label = `${MONTH_NAMES[m - 1]}-${yy}`;
      map.set(label, key);
    }
    return map;
  }, [fromDate, toDate, periodGranularity]);

  const {
    cashflowReport: apiReport,
    isLoadingReport,
    reportError,
    refetchReport,
    accountingPlatform,
    archiveError,
    isLoadingArchive,
    refetchArchive,
  } = useCashflowStatement(fromDate || undefined, toDate || undefined, undefined, locationId ?? null, periodGranularity);

  // Refetch when the date range or granularity changes.
  useEffect(() => {
    if (dateRange?.from && dateRange?.to) refetchReport();
  }, [dateRange, periodGranularity, refetchReport]);

  // Keep every activity section expanded when the report structure changes (CFO/CFI/CFF/Tax/Intra).
  useEffect(() => {
    const groups = apiReport?.tableGroupDataSet;
    if (!groups?.length) return;
    const next: Record<number, boolean> = {};
    groups.forEach((_, i) => { next[i] = true; });
    setOpenSections(next);
  }, [apiReport?.tableGroupDataSet?.length, fromDate, toDate, periodGranularity, locationId]);

  const report = useMemo(() => (apiReport ? enrichCashflowReportWithTotalColumn(apiReport) : null), [apiReport]);

  const totalReceived = report?.totalRowDataSet?.find((r) => r.name === 'Total Received');
  const totalPaid = report?.totalRowDataSet?.find((r) => r.name === 'Total Paid');
  const netCashflow = report?.totalRowDataSet?.find((r) => r.name === 'Net Cashflow');
  const closingBalance = report?.totalRowDataSet?.find((r) => r.name === 'Closing Balance');

  const chartData = useMemo(() => {
    if (!report?.columns) return [];
    return report.columns
      .map((col, i) => ({
        month: col,
        'Total Received': totalReceived?.colData?.[i]?.value ?? 0,
        'Total Paid': totalPaid?.colData?.[i]?.value ?? 0,
        'Net Cashflow': netCashflow?.colData?.[i]?.value ?? 0,
        'Closing Balance': closingBalance?.colData?.[i]?.value ?? 0,
      }))
      .filter((row) => row.month !== CASHFLOW_TOTAL_COLUMN);
  }, [report, totalReceived, totalPaid, netCashflow, closingBalance]);

  const toggleSection = (index: number) => {
    setOpenSections((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleExportToExcel = () => {
    if (!report || !report.columns?.length) return;

    const wb = XLSX.utils.book_new();
    const sheetRows: (string | number)[][] = [];

    const niceFrom = dateRange?.from ? format(dateRange.from, 'dd/MM/yyyy') : fromDate;
    const niceTo = dateRange?.to ? format(dateRange.to, 'dd/MM/yyyy') : toDate;

    sheetRows.push(['Cash Flow Statement', ...(report.columns.length > 0 ? Array(report.columns.length).fill('') : [])]);
    sheetRows.push([`Period: ${niceFrom || '-'} to ${niceTo || '-'}`, ...(report.columns.length > 0 ? Array(report.columns.length).fill('') : [])]);
    sheetRows.push([]);
    sheetRows.push(['', ...report.columns]);

    report.tableGroupDataSet.forEach((group) => {
      sheetRows.push([group.type, ...report.columns.map(() => '')]);
      group.subGroupDataSet.forEach((sub) => {
        sub.rowDataSet.forEach((rowSet) => {
          rowSet.rowData.forEach((row) => {
            sheetRows.push([`  ${row.name}`, ...row.colData.map((c) => c.value)]);
          });
          if (rowSet.total) {
            sheetRows.push([`  ${rowSet.total.name}`, ...rowSet.total.colData.map((c) => c.value)]);
          }
        });
        if (sub.total) {
          sheetRows.push([sub.total.name, ...sub.total.colData.map((c) => c.value)]);
        }
      });
      if (group.total) {
        sheetRows.push([group.total.name, ...group.total.colData.map((c) => c.value)]);
      }
      sheetRows.push([]);
    });

    if (report.totalRowDataSet?.length) {
      sheetRows.push([]);
      report.totalRowDataSet.forEach((row) => {
        sheetRows.push([row.name, ...row.colData.map((c) => c.value)]);
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetRows);
    const setBold = (cellRef: string) => {
      const cell = (ws as any)[cellRef];
      if (cell) cell.s = { ...(cell.s || {}), font: { ...(cell.s?.font || {}), bold: true } };
    };
    setBold('A1');
    setBold('A2');
    setBold('A4');
    report.columns.forEach((_, idx) => {
      const colLetter = XLSX.utils.encode_col(idx + 1);
      setBold(`${colLetter}4`);
    });
    ws['!cols'] = [{ wch: 40 }, ...report.columns.map(() => ({ wch: 14 }))];

    XLSX.utils.book_append_sheet(wb, ws, 'Cashflow Statement');
    const fileName = `CashflowStatement_${niceFrom || fromDate}_${niceTo || toDate}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleArchive = async () => {
    if (!organizationId || !fromDate || !toDate || !report) return;
    try {
      setIsArchiving(true);
      await archiveCashflowReport(organizationId, { fromDate, toDate });
      await refetchArchive();
    } catch (err) {
      console.error('Failed to archive cashflow report', err);
    } finally {
      setIsArchiving(false);
    }
  };

  // Category drill-down
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [drilldownTransactions, setDrilldownTransactions] = useState<CashflowCategoryDrilldownTransaction[]>([]);
  const [drilldownTitle, setDrilldownTitle] = useState('');
  const [drilldownMonthKey, setDrilldownMonthKey] = useState('');
  const [drilldownMonthLabel, setDrilldownMonthLabel] = useState('');
  const [drilldownCategoryLabel, setDrilldownCategoryLabel] = useState('');

  const openCategoryDrilldown = async (params: CashflowDrilldownParams) => {
    if (!organizationId) return;

    const resolvedMonthKey = monthKeyByLabel.get(params.monthLabel);
    if (!resolvedMonthKey) return;

    setDrilldownLoading(true);
    setDrilldownError(null);
    setDrilldownOpen(true);

    try {
      const txns = await getCashflowCategoryDrilldown(organizationId, {
        fromDate,
        toDate,
        rangeGroup: params.rangeGroup,
        rangeSubGroup: params.rangeSubGroup,
        categoryName: params.categoryName,
        locationId: params.locationId,
        monthKey: resolvedMonthKey,
        practiceLocationId: locationId ?? null,
      });

      setDrilldownTransactions(txns);
      setDrilldownMonthKey(resolvedMonthKey);
      setDrilldownMonthLabel(params.monthLabel);
      setDrilldownTitle(params.locationName || params.categoryName);
      setDrilldownCategoryLabel(params.categoryName);
    } catch (e) {
      setDrilldownError(e instanceof Error ? e.message : 'Failed to load drilldown');
      setDrilldownTransactions([]);
    } finally {
      setDrilldownLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base">Cash Flow Statement</CardTitle>
            <p className="text-sm text-muted-foreground">
              Total Received, Total Paid, Net Cashflow and Closing Balance by {periodGranularity === 'weekly' ? 'week' : 'month'}
            </p>
            {(archiveError || isLoadingArchive) && (
              <p className="text-xs text-muted-foreground mt-1">
                {isLoadingArchive ? 'Loading archive history…' : archiveError?.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ChartDateFilter
              filter={dateFilter}
              onFilterChange={setDateFilter}
              customRange={customRange}
              onCustomRangeChange={setCustomRange}
              align="start"
              trigger={
                <Button variant="outline" className="h-9 gap-2 font-normal">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{dateFilterLabel}</span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </Button>
              }
            />
            <ToggleGroup
              type="single"
              value={periodGranularity}
              onValueChange={(v) => { if (v === 'monthly' || v === 'weekly') setPeriodGranularity(v); }}
              variant="outline"
              size="sm"
              className="justify-start"
              aria-label="Statement period"
            >
              <ToggleGroupItem value="monthly" className="px-3">Monthly</ToggleGroupItem>
              <ToggleGroupItem value="weekly" className="px-3">Weekly</ToggleGroupItem>
            </ToggleGroup>
            <Button variant="outline" size="sm" onClick={handleExportToExcel} disabled={!report || isLoadingReport}>
              Export to Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleArchive} disabled={!report || isLoadingReport || isArchiving}>
              {isArchiving ? 'Archiving…' : 'Archive Statement'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {reportError ? (
            <Alert variant="destructive" className="m-6">
              <AlertDescription>{reportError.message}</AlertDescription>
            </Alert>
          ) : isLoadingReport ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-[340px] w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !report?.columns?.length ? (
            <div className="p-6 text-center text-muted-foreground">No data found</div>
          ) : (
            <CashflowStatementMergedTable
              report={report}
              chartData={chartData}
              formatCurrency={formatCurrency}
              openSections={openSections}
              onToggleSection={toggleSection}
              onCategoryDrilldown={(params) => void openCategoryDrilldown(params)}
            />
          )}
        </CardContent>
      </Card>

      {/* Category drill-down */}
      <Sheet open={drilldownOpen} onOpenChange={setDrilldownOpen}>
        <SheetContent side="right" className="w-full sm:max-w-5xl p-0 flex flex-col">
          <SheetHeader className="p-6 border-b border-border space-y-3">
            <SheetTitle className="text-lg">Preparing Your Cash Flow Statement</SheetTitle>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <SheetDescription className="text-left text-foreground font-medium">{drilldownMonthLabel || drilldownMonthKey || '—'}</SheetDescription>
              <SheetDescription className="sm:text-center text-foreground font-medium">{drilldownCategoryLabel || '—'}</SheetDescription>
              <SheetDescription className="sm:text-right text-foreground font-medium">{drilldownTitle || '—'}</SheetDescription>
            </div>
          </SheetHeader>
          <div className="p-4 overflow-y-auto flex-1" style={{ maxHeight: 'calc(100vh - 180px)' }}>
            {drilldownError ? (
              <Alert variant="destructive">
                <AlertDescription>{drilldownError}</AlertDescription>
              </Alert>
            ) : drilldownLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : drilldownTransactions.length === 0 ? (
              <div className="text-sm text-muted-foreground">No transactions found for this bucket.</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="whitespace-nowrap">Date</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[140px]">Transaction Type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Memo Or Description</TableHead>
                      <TableHead>Who Paid</TableHead>
                      <TableHead>For What</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1.5 text-green-600 font-semibold">Money (IN)</span>
                      </TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1.5 text-red-600 font-semibold">Money (OUT)</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drilldownTransactions.map((tx, idx) => {
                      const typeLabel = tx.transactionType || tx.docClass || '—';
                      const link = tx.transactionLink;
                      const name = tx.name || tx.description || '—';
                      const memo = tx.memoOrDescription || tx.description || '—';
                      const whoPaid = tx.whoPaid || '—';
                      const forWhat = tx.forWhat || tx.accountName || '—';
                      const moneyIn = tx.moneyIn ?? Math.max(tx.amountRaw ?? 0, 0);
                      const moneyOut = tx.moneyOut ?? Math.max(-(tx.amountRaw ?? 0), 0);
                      const linkClass = accountingLinkClassName(accountingPlatform);
                      return (
                        <TableRow key={`${tx.docId}-${tx.date}-${idx}`} className="hover:bg-muted/30">
                          <TableCell className="whitespace-nowrap tabular-nums">{formatDisplayDate(tx.date)}</TableCell>
                          <TableCell>
                            {isValidTransactionLink(link) ? (
                              <a href={link} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1.5 text-sm font-medium hover:underline', linkClass)}>
                                <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
                                <span>{typeLabel}</span>
                              </a>
                            ) : (
                              <span className="text-sm">{typeLabel}</span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium max-w-[180px] truncate" title={name}>{name}</TableCell>
                          <TableCell className="text-muted-foreground max-w-[200px] truncate" title={memo}>{memo}</TableCell>
                          <TableCell className="max-w-[160px] truncate" title={whoPaid}>{whoPaid}</TableCell>
                          <TableCell className="max-w-[160px] truncate" title={forWhat}>{forWhat}</TableCell>
                          <TableCell className="text-right tabular-nums text-green-600 font-medium">
                            {moneyIn > 0 ? formatCurrency(moneyIn, report?.currencySymbol ?? '£') : '–'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-red-600 font-medium">
                            {moneyOut > 0 ? formatCurrency(moneyOut, report?.currencySymbol ?? '£') : '–'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="bg-muted/30 font-semibold border-t-2 hover:bg-muted/30">
                      <TableCell colSpan={6} className="text-right">Total</TableCell>
                      <TableCell className="text-right tabular-nums text-green-600">
                        {formatCurrency(drilldownTransactions.reduce((s, t) => s + (t.moneyIn ?? Math.max(t.amountRaw ?? 0, 0)), 0), report?.currencySymbol ?? '£')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-600">
                        {formatCurrency(drilldownTransactions.reduce((s, t) => s + (t.moneyOut ?? Math.max(-(t.amountRaw ?? 0), 0)), 0), report?.currencySymbol ?? '£')}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </div>
          <div className="p-4 border-t border-border flex justify-end">
            <Button variant="secondary" onClick={() => setDrilldownOpen(false)}>Close</Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
