import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Filter, ArrowDownUp, AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Info, ExternalLink } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from 'recharts';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useBillsToPay, type Bill } from '@/hooks/useBillsToPay';
import { formatGbp } from '@/utils/formatMoney';

const PAGE_SIZE = 10;
const poundsWhole = (v: number) => formatGbp(v, { decimals: 0 });
const amount2 = (v: number) => formatGbp(v, { decimals: 2 });
/** Pro Payable Management date style: DD-MM-YYYY */
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
};
const fmtOverdueBy = (days: number) => {
  if (!days || days <= 0) return '';
  return days === 1 ? '1 Day' : `${days} Days`;
};
/** Deep-link a synced ACCPAY bill into Xero Accounts Payable (View). */
const xeroBillUrl = (invoiceId: string) =>
  `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${encodeURIComponent(invoiceId)}`;

type SortKey =
  | 'oldest_expected' | 'newest_expected' | 'oldest_due' | 'newest_due'
  | 'highest_amount' | 'lowest_amount' | 'supplier_az' | 'supplier_za'
  | 'oldest_invoice' | 'newest_invoice';

const SORT_OPTIONS: { v: SortKey; label: string }[] = [
  { v: 'oldest_expected', label: 'Oldest planned date' },
  { v: 'newest_expected', label: 'Newest planned date' },
  { v: 'oldest_due', label: 'Oldest due date' },
  { v: 'newest_due', label: 'Newest due date' },
  { v: 'oldest_invoice', label: 'Oldest invoice date' },
  { v: 'newest_invoice', label: 'Newest invoice date' },
  { v: 'highest_amount', label: 'Highest amount due' },
  { v: 'lowest_amount', label: 'Lowest amount due' },
  { v: 'supplier_az', label: 'From (A–Z)' },
  { v: 'supplier_za', label: 'From (Z–A)' },
];

export default function BillsToPay() {
  const { bills, summary, paymentTiming, topSuppliersLate, isLoading, setBillSetting } = useBillsToPay();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('oldest_expected');
  const [page, setPage] = useState(0);
  const defaultFilters = { upcoming: true, overdue: true, pastExpected: true, draft: true, repeating: true, min: '', max: '', showExcluded: true };
  const [filters, setFilters] = useState(defaultFilters);   // applied
  const [draft, setDraft] = useState(defaultFilters);       // edited inside the popover
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── Filter → search → sort ──
  const visible = useMemo(() => {
    const min = filters.min ? Number(filters.min) : -Infinity;
    const max = filters.max ? Number(filters.max) : Infinity;
    const q = search.trim().toLowerCase();
    const passStatus = (b: Bill) => {
      // A bill shows if any of its active statuses is enabled in the filter.
      const tags: boolean[] = [];
      if (b.overdue) tags.push(filters.overdue);
      if (b.upcoming) tags.push(filters.upcoming);
      if (b.pastExpected) tags.push(filters.pastExpected);
      if (b.isDraft) tags.push(filters.draft);
      return tags.length === 0 ? true : tags.some(Boolean);
    };
    const filtered = bills.filter((b) =>
      (filters.showExcluded || !b.excluded) &&
      passStatus(b) &&
      b.amount >= min && b.amount <= max &&
      (!q ||
        b.supplier.toLowerCase().includes(q) ||
        b.invoiceNumber.toLowerCase().includes(q) ||
        b.reference.toLowerCase().includes(q)));

    const byDate = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '');
    const sorted = [...filtered].sort((a, b) => {
      switch (sort) {
        case 'newest_expected': return byDate(b.expectedDate, a.expectedDate);
        case 'oldest_due': return byDate(a.originalDueDate, b.originalDueDate);
        case 'newest_due': return byDate(b.originalDueDate, a.originalDueDate);
        case 'oldest_invoice': return byDate(a.invoiceDate, b.invoiceDate);
        case 'newest_invoice': return byDate(b.invoiceDate, a.invoiceDate);
        case 'highest_amount': return b.amount - a.amount;
        case 'lowest_amount': return a.amount - b.amount;
        case 'supplier_az': return a.supplier.localeCompare(b.supplier);
        case 'supplier_za': return b.supplier.localeCompare(a.supplier);
        default: return byDate(a.expectedDate, b.expectedDate); // oldest_expected
      }
    });
    return sorted;
  }, [bills, filters, search, sort]);

  // Reset to first page when the filtered set changes meaningfully.
  useEffect(() => { setPage(0); setSelected(new Set()); }, [search, sort, filters]);

  // Drop selections that no longer exist in the filtered list (e.g. after exclude hide).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visibleIds = new Set(visible.map((b) => b.id));
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const paidTotal = visible.reduce((s, b) => s + b.amountPaid, 0);
  const dueTotal = visible.reduce((s, b) => s + b.amount, 0);

  const selectedBills = visible.filter((b) => selected.has(b.id));
  const selectedTotal = selectedBills.reduce((s, b) => s + b.amount, 0);
  const allPageSelected = pageRows.length > 0 && pageRows.every((b) => selected.has(b.id));

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const b of pageRows) next.delete(b.id);
      } else {
        for (const b of pageRows) next.add(b.id);
      }
      return next;
    });
  };
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const batchApply = (excluded: boolean) => {
    if (selected.size === 0) return;
    setBillSetting.mutate({ billIds: [...selected], excluded });
  };

  const summaryCard = (label: string, count: number, amount: number, tip: string) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {label} <span className="text-muted-foreground/70">({count})</span>
          <Info className="h-3 w-3 text-muted-foreground/50" aria-label={tip} />
        </div>
        <p className="mt-1 text-2xl font-semibold text-foreground">{poundsWhole(amount)}</p>
      </CardContent>
    </Card>
  );

  return (
    <MainLayout userRole="admin">
      <Helmet><title>Bills to Pay - DentPulse</title></Helmet>

      <div className="space-y-5 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Bills to Pay</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Outstanding supplier bills from your connected accounting (Xero), forecast as payable.</p>
        </div>

        {/* Summary + charts */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            {summaryCard('Outstanding', summary.outstanding.count, summary.outstanding.amount, 'All unpaid bills.')}
            {summaryCard('Overdue', summary.overdue.count, summary.overdue.amount, 'Bills past their due date.')}
            {summaryCard('Past expected', summary.pastExpected.count, summary.pastExpected.amount, 'Bills whose expected payment date has passed.')}
          </div>
          <Card>
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">Expected payment timing</h2>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={paymentTiming} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/60" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={3} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} width={40} stroke="hsl(var(--muted-foreground))" tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                    <RechartsTooltip formatter={(v: number) => [poundsWhole(Number(v)), 'Expected']} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="amount" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">Top suppliers paid late <span className="font-normal text-muted-foreground">(past 3 months)</span></h2>
              <div className="h-[240px]">
                {topSuppliersLate.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No late payments in the last 3 months.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topSuppliersLate} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border/60" />
                      <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v: number) => `${v}d`} />
                      <YAxis type="category" dataKey="supplier" tick={{ fontSize: 10 }} width={90} stroke="hsl(var(--muted-foreground))" />
                      <RechartsTooltip formatter={(v: number) => [`${v} days late`, 'Average']} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="avgDaysLate" fill="#f59e0b" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Past-expected warning banner */}
        {summary.pastExpected.count > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>You have <strong>{summary.pastExpected.count}</strong> bill{summary.pastExpected.count === 1 ? '' : 's'} with expected dates in the past — forecast as payable by the end of today. Update their expected dates or exclude them.</span>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={selected.size === 0 || setBillSetting.isPending}>
                Batch Actions <ChevronDown className="ml-1.5 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={setBillSetting.isPending}
                onClick={() => batchApply(false)}
              >
                Include in forecast
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={setBillSetting.isPending}
                onClick={() => batchApply(true)}
              >
                Exclude from forecast
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {selected.size > 0 && (
            <span className="text-sm text-primary">
              {selected.size} bill{selected.size === 1 ? '' : 's'} selected, total due: {poundsWhole(selectedTotal)}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Popover open={filtersOpen} onOpenChange={(o) => { if (o) setDraft(filters); setFiltersOpen(o); }}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm"><Filter className="mr-1.5 h-4 w-4" /> Filters</Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <p className="text-sm font-semibold text-foreground">Status</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  {([['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['pastExpected', 'Past expected date'], ['repeating', 'Repeating'], ['draft', 'Draft']] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2">
                      <Checkbox checked={draft[k]} onCheckedChange={(v) => setDraft((f) => ({ ...f, [k]: !!v }))} /> {label}
                    </label>
                  ))}
                </div>
                <div className="my-3 border-t border-border" />
                <p className="text-sm font-semibold text-foreground">Amount</p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Min</p>
                    <div className="flex items-center rounded-md border border-border">
                      <span className="border-r border-border bg-muted px-2.5 py-1.5 text-sm text-muted-foreground">£</span>
                      <input inputMode="numeric" placeholder="0.00" value={draft.min} onChange={(e) => setDraft((f) => ({ ...f, min: e.target.value }))} className="w-full rounded-r-md bg-background px-2 py-1.5 text-sm focus:outline-none" />
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Max</p>
                    <div className="flex items-center rounded-md border border-border">
                      <span className="border-r border-border bg-muted px-2.5 py-1.5 text-sm text-muted-foreground">£</span>
                      <input inputMode="numeric" placeholder="0.00" value={draft.max} onChange={(e) => setDraft((f) => ({ ...f, max: e.target.value }))} className="w-full rounded-r-md bg-background px-2 py-1.5 text-sm focus:outline-none" />
                    </div>
                  </div>
                </div>
                <div className="my-3 border-t border-border" />
                <p className="text-sm font-semibold text-foreground">Excluded bills</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Display excluded bills:</span>
                  <Switch checked={draft.showExcluded} onCheckedChange={(v) => setDraft((f) => ({ ...f, showExcluded: v }))} />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDraft(defaultFilters)}>Reset</Button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setFiltersOpen(false)}>Cancel</Button>
                    <Button size="sm" onClick={() => { setFilters(draft); setFiltersOpen(false); }}>Apply</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><ArrowDownUp className="mr-1.5 h-4 w-4" /> {SORT_OPTIONS.find((o) => o.v === sort)?.label} <ChevronDown className="ml-1.5 h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SORT_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.v} onClick={() => setSort(o.v)}>{o.label}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Input placeholder="Search by supplier or reference" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-64" />
          </div>
        </div>

        {/* Pro Accounts Payable report table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            ) : visible.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">No bills to pay match your filters.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 w-8">
                          <Checkbox
                            checked={allPageSelected}
                            onCheckedChange={togglePage}
                            aria-label="Select all bills on this page"
                          />
                        </th>
                        <th className="px-3 py-2">From</th>
                        <th className="px-3 py-2">Reference</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Due Date</th>
                        <th className="px-3 py-2">Overdue By</th>
                        <th className="px-3 py-2">Planned Date</th>
                        <th className="px-3 py-2 text-right">Paid</th>
                        <th className="px-3 py-2 text-right">Due</th>
                        <th className="px-3 py-2 text-right">In Forecast</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((b) => (
                        <tr key={b.id} className={`border-b border-border/60 hover:bg-muted/30 ${b.excluded ? 'text-muted-foreground/50 line-through' : ''}`}>
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={selected.has(b.id)}
                              onCheckedChange={() => toggleOne(b.id)}
                              aria-label={`Select ${b.reference}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-foreground">{b.supplier}</td>
                          <td className="px-3 py-2 text-foreground">
                            {b.platformInvoiceId ? (
                              <a
                                href={xeroBillUrl(b.platformInvoiceId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open bill in Xero"
                                className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 hover:underline font-medium"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {b.reference}
                                <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                              </a>
                            ) : (
                              b.reference
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(b.invoiceDate)}</td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(b.originalDueDate)}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {fmtOverdueBy(b.overdueDays) || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1.5 tabular-nums text-foreground">
                              {fmtDate(b.expectedDate)}
                              {b.pastExpected && !b.excluded && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-foreground">{amount2(b.amountPaid)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-foreground">{amount2(b.amount)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-2">
                              <span className="whitespace-nowrap text-xs text-muted-foreground">
                                {b.excluded ? 'Not included' : 'Included'}
                              </span>
                              <Switch
                                checked={!b.excluded}
                                disabled={setBillSetting.isPending}
                                onCheckedChange={(included) =>
                                  setBillSetting.mutate({
                                    billIds: [b.id],
                                    excluded: !included,
                                  })
                                }
                                aria-label={`${b.excluded ? 'Include' : 'Exclude'} ${b.reference} ${b.excluded ? 'in' : 'from'} forecast`}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/30 text-sm font-semibold text-foreground">
                        <td className="px-3 py-2" colSpan={7}>
                          Totals ({visible.length} bill{visible.length === 1 ? '' : 's'})
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{amount2(paidTotal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{amount2(dueTotal)}</td>
                        <td className="px-3 py-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground">
                  <span>
                    {visible.length === 0
                      ? '0 bills'
                      : `${safePage * PAGE_SIZE + 1}–${Math.min((safePage + 1) * PAGE_SIZE, visible.length)} of ${visible.length}`}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={safePage <= 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="px-2 tabular-nums">{safePage + 1} / {pageCount}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={safePage >= pageCount - 1}
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
