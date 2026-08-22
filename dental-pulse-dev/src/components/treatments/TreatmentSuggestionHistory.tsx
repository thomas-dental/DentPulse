import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  History,
  Loader2,
  Sparkles,
  RotateCcw,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Column order matches the form on the Edit Treatment tab.
// Excluded by request: percent_fees (Associate Pay %), lab_bill_discount, finance_fee.
const FIELDS: { key: string; label: string }[] = [
  { key: 'price', label: 'Amount' },
  { key: 'duration_minutes', label: 'Dentist mins' },
  { key: 'therapist_time_mins', label: 'Therapist mins' },
  { key: 'lab_bill', label: 'Lab Bill' },
  { key: 'material_cost', label: 'Material' },
  { key: 'therapist_pay_rate', label: 'Therapist Pay' },
  { key: 'hourly_rate', label: 'Op Cost/Hr' },
  { key: 'average_time_minutes', label: 'Completion mins' },
];

const CURRENCY_FIELDS = new Set([
  'price',
  'lab_bill',
  'lab_bill_discount',
  'material_cost',
  'therapist_pay_rate',
  'hourly_rate',
]);
const PERCENT_FIELDS = new Set(['percent_fees', 'finance_fee']);

function formatValue(field: string, value: number, currency = 'GBP'): string {
  if (CURRENCY_FIELDS.has(field)) {
    const localeMap: Record<string, string> = {
      GBP: 'en-GB',
      USD: 'en-US',
      EUR: 'en-IE',
    };
    try {
      return new Intl.NumberFormat(localeMap[currency] || 'en-GB', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${currency} ${value}`;
    }
  }
  if (PERCENT_FIELDS.has(field)) return `${value}%`;
  return `${value} mins`;
}

interface HistoryRow {
  id: string;
  applied_at: string;
  apply_action: 'single' | 'all' | 'generated';
  summary: string | null;
  currency: string | null;
  scope_label: string | null;
  peer_count: number | null;
  area_match_level: string | null;
  area_geo_level: string | null;
  area_geo_label: string | null;
  area_clinic_count: number | null;
  area_sample_count: number | null;
  ai_suggestions: Record<
    string,
    { value: number; reason?: string; sources?: string[] }
  >;
  applied_fields: Record<string, number>;
  applied_by: string | null;
}

type SortKey = 'applied_at' | string; // 'applied_at' or any field key
type SortDir = 'asc' | 'desc';

interface Props {
  treatmentId: string;
  onReapply?: (fieldValues: Record<string, number>) => void;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function TreatmentSuggestionHistory({ treatmentId, onReapply }: Props) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('applied_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const {
    data: rows,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['treatment_ai_suggestion_history', treatmentId],
    enabled: !!treatmentId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('treatment_ai_suggested_pricing')
        .select(
          `id, applied_at, apply_action, summary, currency, scope_label,
           peer_count, area_match_level, area_geo_level, area_geo_label,
           area_clinic_count, area_sample_count, ai_suggestions,
           applied_fields, applied_by`,
        )
        .eq('treatment_id', treatmentId)
        .order('applied_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as HistoryRow[];
    },
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      // Match against formatted date, summary, and any applied value rendered as text
      const dateText = format(new Date(row.applied_at), 'PPp').toLowerCase();
      if (dateText.includes(q)) return true;
      if ((row.summary ?? '').toLowerCase().includes(q)) return true;
      const applied = row.applied_fields ?? {};
      for (const f of FIELDS) {
        const v = (applied as any)[f.key];
        if (typeof v === 'number') {
          const formatted = formatValue(f.key, v, row.currency ?? 'GBP');
          if (formatted.toLowerCase().includes(q)) return true;
          if (f.label.toLowerCase().includes(q)) return true;
          if (String(v).includes(q)) return true;
        }
      }
      return false;
    });
  }, [rows, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === 'applied_at') {
        av = new Date(a.applied_at).getTime();
        bv = new Date(b.applied_at).getTime();
      } else {
        const ax = (a.applied_fields as any)?.[sortKey];
        const bx = (b.applied_fields as any)?.[sortKey];
        av = typeof ax === 'number' ? ax : -Infinity;
        bv = typeof bx === 'number' ? bx : -Infinity;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading history...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          Failed to load suggestion history.
        </CardContent>
      </Card>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Suggestion History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center text-center py-6 gap-2">
            <Sparkles className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No AI suggestions have been applied to this treatment yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Apply suggestions on the Edit tab and they'll appear here as a chronological log.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const showFrom = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const showTo = Math.min(safePage * pageSize, total);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Suggestion History
            <Badge variant="secondary" className="ml-2">
              {rows.length}
            </Badge>
          </CardTitle>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by date, value, or summary..."
              className="pl-8 h-9"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-t">
          <Table className="border-collapse">
            <TableHeader className="bg-muted/60">
              <TableRow className="border-b border-border hover:bg-muted/60">
                <TableHead
                  onClick={() => toggleSort('applied_at')}
                  className="w-[150px] min-w-[150px] sticky left-0 bg-muted/60 z-10 whitespace-nowrap border-r border-border font-semibold text-foreground cursor-pointer select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    Date {sortIcon('applied_at')}
                  </span>
                </TableHead>
                <TableHead className="w-[110px] whitespace-nowrap border-r border-border font-semibold text-foreground">
                  Status
                </TableHead>
                {FIELDS.map((f) => (
                  <TableHead
                    key={f.key}
                    onClick={() => toggleSort(f.key)}
                    className="text-right whitespace-nowrap border-r border-border font-semibold text-foreground cursor-pointer select-none"
                  >
                    <span className="inline-flex items-center gap-1 justify-end w-full">
                      {f.label} {sortIcon(f.key)}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="w-[110px] text-right sticky right-0 bg-muted/60 z-10 font-semibold text-foreground">
                  Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={FIELDS.length + 3}
                    className="text-center py-8 text-sm text-muted-foreground"
                  >
                    No rows match "{search}".
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row, idx) => {
                  // A row is treated as "Generated" (not applied) when its
                  // applied_fields object is empty — the hook writes those
                  // rows on every successful AI generation. Applied rows
                  // (single tick or Apply All) populate applied_fields with
                  // the chosen values.
                  const applied = row.applied_fields ?? {};
                  const appliedKeyCount = Object.keys(applied).filter(
                    (k) => typeof (applied as any)[k] === 'number',
                  ).length;
                  const isGenerated =
                    row.apply_action === 'generated' || appliedKeyCount === 0;

                  const valuesForRow: Record<string, number> = isGenerated
                    ? Object.fromEntries(
                        Object.entries(row.ai_suggestions ?? {})
                          .map(([k, s]) => [k, (s as any)?.value])
                          .filter(
                            ([, v]) =>
                              typeof v === 'number' && Number.isFinite(v),
                          ),
                      )
                    : (applied as Record<string, number>);
                  const hasAnyValue = Object.values(valuesForRow).some(
                    (v) => typeof v === 'number',
                  );
                  const stripeBg =
                    idx % 2 === 0 ? 'bg-background' : 'bg-muted/20';
                  return (
                    <TableRow
                      key={row.id}
                      className={`border-b border-border ${stripeBg}`}
                    >
                      <TableCell
                        className={`align-top sticky left-0 z-[1] whitespace-nowrap border-r border-border ${stripeBg}`}
                      >
                        <div className="text-sm font-medium">
                          {format(new Date(row.applied_at), 'PP')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(row.applied_at), 'p')}
                        </div>
                      </TableCell>
                      <TableCell
                        className={`align-top whitespace-nowrap border-r border-border`}
                      >
                        {isGenerated ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase bg-blue-50 text-blue-700 border-blue-200"
                          >
                            Generated
                          </Badge>
                        ) : row.apply_action === 'all' ? (
                          <Badge className="text-[10px] uppercase">
                            Applied · All
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase bg-emerald-50 text-emerald-700 border-emerald-200"
                          >
                            Applied
                          </Badge>
                        )}
                      </TableCell>
                      {FIELDS.map((f) => {
                        const v = valuesForRow[f.key];
                        const num = typeof v === 'number' ? v : Number(v);
                        const present = Number.isFinite(num);
                        return (
                          <TableCell
                            key={f.key}
                            className={`text-right whitespace-nowrap border-r border-border ${
                              present
                                ? isGenerated
                                  ? 'text-blue-700'
                                  : 'font-medium'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {present
                              ? formatValue(f.key, num, row.currency ?? 'GBP')
                              : '—'}
                          </TableCell>
                        );
                      })}
                      <TableCell
                        className={`align-top text-right sticky right-0 z-[1] ${stripeBg}`}
                      >
                        {onReapply && hasAnyValue ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 h-7 text-xs"
                            onClick={() =>
                              onReapply(
                                Object.fromEntries(
                                  Object.entries(valuesForRow).filter(
                                    ([, v]) => typeof v === 'number',
                                  ),
                                ) as Record<string, number>,
                              )
                            }
                            title={
                              isGenerated
                                ? 'Apply these AI suggestions to the form'
                                : 'Re-apply these values'
                            }
                          >
                            <RotateCcw className="h-3 w-3" />
                            {isGenerated ? 'Apply' : 'Re-apply'}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t bg-muted/20">
          <div className="text-xs text-muted-foreground">
            Showing <span className="font-medium">{showFrom}</span>–
            <span className="font-medium">{showTo}</span> of{' '}
            <span className="font-medium">{total}</span>
            {search && total !== rows.length && (
              <span className="ml-1">
                (filtered from {rows.length})
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Rows</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[70px]">
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
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage(1)}
                disabled={safePage === 1}
                title="First page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs px-2">
                Page <span className="font-medium">{safePage}</span> of{' '}
                <span className="font-medium">{totalPages}</span>
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage(totalPages)}
                disabled={safePage === totalPages}
                title="Last page"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
