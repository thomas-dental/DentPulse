/**
 * NHS Claims — claim-level detail behind the "Total Claims" card on the NHS
 * Contract Performance page. Reached by clicking that card; inherits the global
 * location + period filters (FilterContext), so it shows the claims for the same
 * period/location the card counts. In-page filters (NHS ID search, Status,
 * Practitioner) refine client-side over the loaded set.
 *
 * Table styled to match the Treatment Insights profitability grid: bordered
 * cells, muted header with sort arrows, totals row, centered pagination.
 */

import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Download, Loader2, Search, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react';
import dayjs from 'dayjs';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  Pagination, PaginationContent, PaginationItem, PaginationEllipsis,
} from '@/components/ui/pagination';
import { useFilters } from '@/contexts/FilterContext';
import { useNHSClaims, type NHSClaimRow } from '@/hooks/useNHSClaims';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

type SortKey = 'tpId' | 'nhsId' | 'patient' | 'submitted' | 'start' | 'end' | 'performer' | 'contract' | 'status' | 'comments' | 'fee' | 'patientCharge';

interface ColumnDef {
  key: SortKey;
  label: string;
  align?: 'right';
  sortVal: (r: NHSClaimRow) => string | number;
}

const COLUMNS: ColumnDef[] = [
  { key: 'tpId', label: 'TP ID', sortVal: r => r.tpId ?? 0 },
  { key: 'nhsId', label: 'NHS ID', sortVal: r => r.nhsId ?? '' },
  { key: 'patient', label: 'Patient', sortVal: r => r.patient },
  { key: 'submitted', label: 'Submitted', sortVal: r => r.submitted ?? '' },
  { key: 'start', label: 'Start', sortVal: r => r.start ?? '' },
  { key: 'end', label: 'End', sortVal: r => r.end ?? '' },
  { key: 'performer', label: 'Performer', sortVal: r => r.performer },
  { key: 'contract', label: 'Contract', sortVal: r => r.contract },
  { key: 'status', label: 'Status', sortVal: r => r.status },
  { key: 'comments', label: 'Comments', sortVal: r => r.comments },
  { key: 'fee', label: 'Practice Fee', align: 'right', sortVal: r => r.dentistChargeDelivered },
  { key: 'patientCharge', label: 'Patient Charge', align: 'right', sortVal: r => r.patientCharge },
];

function fmtSubmitted(iso: string | null): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  return d.isValid() ? d.format('ddd DD MMM YY') : '—';
}
function fmtShortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  return d.isValid() ? d.format('DD/MM/YY') : '—';
}
function fmtCurrency(v: number): string {
  return `£${v.toFixed(2)}`;
}
function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'completed') return 'border-emerald-300 text-emerald-700 dark:text-emerald-400';
  if (s === 'error' || s === 'failed' || s === 'rejected') return 'border-red-300 text-red-700 dark:text-red-400';
  if (s === 'pending' || s === 'submitted') return 'border-amber-300 text-amber-700 dark:text-amber-400';
  return 'border-slate-300 text-slate-700 dark:text-slate-400';
}

export default function NHSClaims() {
  const { dateRange } = useFilters();
  const { rows, isLoading, practitionerOptions, statusOptions } = useNHSClaims();

  const [nhsIdSearch, setNhsIdSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [practitioner, setPractitioner] = useState('all');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('submitted');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = useMemo(() => {
    const search = nhsIdSearch.trim().toLowerCase();
    return rows.filter(r => {
      if (search && !(r.nhsId ?? '').toLowerCase().includes(search) && !r.patient.toLowerCase().includes(search)) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (practitioner !== 'all' && r.performer !== practitioner) return false;
      return true;
    });
  }, [rows, nhsIdSearch, status, practitioner]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find(c => c.key === sortKey);
    if (!col) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = col.sortVal(a); const bv = col.sortVal(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [nhsIdSearch, status, practitioner, pageSize, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const totals = useMemo(() => ({
    count: filtered.length,
    delivered: filtered.reduce((s, r) => s + r.dentistChargeDelivered, 0),
    expected: filtered.reduce((s, r) => s + r.dentistChargeExpected, 0),
    patientCharge: filtered.reduce((s, r) => s + r.patientCharge, 0),
  }), [filtered]);

  // Summary KPIs over the full loaded set (period + location), independent of
  // the in-page search/status/practitioner refine filters.
  const summary = useMemo(() => {
    const byStatus = (s: string) => rows.filter(r => r.status.toLowerCase() === s).length;
    return {
      total: rows.length,
      completed: byStatus('completed'),
      submitted: byStatus('submitted'),
    };
  }, [rows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const getPageNumbers = (): (number | string)[] => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('ellipsis-start');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('ellipsis-end');
      pages.push(totalPages);
    }
    return pages;
  };

  const exportCsv = () => {
    const headers = ['TP ID', 'NHS ID', 'Patient', 'Submitted', 'Start', 'End', 'Performer', 'Contract', 'Status', 'Comments', 'Practice Fee Delivered', 'Practice Fee Expected', 'Patient Charge'];
    const lines = sorted.map(r => [
      r.tpId ?? '', r.nhsId ?? '', r.patient,
      fmtSubmitted(r.submitted), fmtShortDate(r.start), fmtShortDate(r.end),
      r.performer, r.contract, r.status, r.comments,
      r.dentistChargeDelivered.toFixed(2), r.dentistChargeExpected.toFixed(2), r.patientCharge.toFixed(2),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nhs-claims.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const cellValue = (r: NHSClaimRow, key: SortKey) => {
    switch (key) {
      case 'tpId': return r.tpId ?? '—';
      case 'nhsId': return r.nhsId ?? '—';
      case 'patient':
        return r.patientId != null ? (
          <a href={`https://app.dentally.co/patients/${r.patientId}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {r.patient}
          </a>
        ) : r.patient;
      case 'submitted': return fmtSubmitted(r.submitted);
      case 'start': return fmtShortDate(r.start);
      case 'end': return fmtShortDate(r.end);
      case 'performer': return r.performer;
      case 'contract': return r.contract;
      case 'status':
        return <Badge variant="outline" className={statusBadgeClass(r.status)}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</Badge>;
      case 'comments':
        return <span className="block max-w-[240px] truncate" title={r.comments}>{r.comments || '—'}</span>;
      case 'fee': return `${fmtCurrency(r.dentistChargeDelivered)} / ${fmtCurrency(r.dentistChargeExpected)}`;
      case 'patientCharge': return fmtCurrency(r.patientCharge);
    }
  };

  const totalsValue = (key: SortKey) => {
    switch (key) {
      case 'tpId': return 'Total';
      case 'nhsId': return `${totals.count}`;
      case 'fee': return `${fmtCurrency(totals.delivered)} / ${fmtCurrency(totals.expected)}`;
      case 'patientCharge': return fmtCurrency(totals.patientCharge);
      default: return '';
    }
  };

  return (
    <MainLayout userRole="admin">
      <Helmet><title>NHS Claims | DentPulse</title></Helmet>

      <div className="space-y-4 pt-6">
        {/* Breadcrumb + header */}
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <Link to="/treatments/insights" className="hover:text-foreground">Treatment</Link>
            <span>/</span>
            <Link to="/treatments/nhs" className="hover:text-foreground">NHS</Link>
            <span>/</span>
            <span className="text-foreground font-medium">Claims</span>
          </div>
          <h1 className="text-2xl font-bold">NHS Claims</h1>
          <p className="text-muted-foreground">{isLoading ? 'Loading…' : `${filtered.length} found`}</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'TOTAL CLAIMS', value: summary.total },
            { label: 'COMPLETED', value: summary.completed },
            { label: 'SUBMITTED', value: summary.submitted },
          ].map(card => (
            <Card key={card.label} className="bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800">
              <CardContent className="pt-4 pb-3">
                <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">{card.label}</span>
                <div className="text-2xl font-bold mt-1">{isLoading ? '—' : card.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="pt-4 space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search NHS ID or patient…"
                  value={nhsIdSearch}
                  onChange={e => setNhsIdSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 ml-auto">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    {statusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={practitioner} onValueChange={setPractitioner}>
                  <SelectTrigger className="w-[170px]"><SelectValue placeholder="Practitioner" /></SelectTrigger>
                  <SelectContent>
                    {practitionerOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
                  <SelectTrigger className="w-[70px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={sorted.length === 0}>
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </div>
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="border rounded-lg overflow-x-auto">
                  <Table className="w-full" style={{ borderCollapse: 'collapse' }}>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        {COLUMNS.map(col => {
                          const isSorted = sortKey === col.key;
                          return (
                            <TableHead
                              key={col.key}
                              onClick={() => toggleSort(col.key)}
                              className={`px-3 py-2.5 text-xs font-medium text-muted-foreground border-r border-b border-border last:border-r-0 cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                            >
                              <div className={`flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                                <span>{col.label}</span>
                                {isSorted
                                  ? (sortDir === 'asc' ? <ChevronUp className="h-3 w-3 text-primary shrink-0" /> : <ChevronDown className="h-3 w-3 text-primary shrink-0" />)
                                  : <ArrowUpDown className="h-3 w-3 text-muted-foreground/30 shrink-0" />}
                              </div>
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={COLUMNS.length} className="text-center text-muted-foreground py-12 border-b border-border">
                            No NHS claims found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        pageRows.map(r => (
                          <TableRow key={r.id} className="hover:bg-muted/30">
                            {COLUMNS.map((col, idx) => (
                              <TableCell
                                key={col.key}
                                className={`px-3 py-2.5 text-sm border-r border-b border-border last:border-r-0 ${idx === 0 ? 'font-medium' : ''} ${col.align === 'right' ? 'text-right tabular-nums' : ''} ${col.key === 'comments' ? '' : 'whitespace-nowrap'}`}
                              >
                                {cellValue(r, col.key)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      )}

                      {/* Totals row */}
                      {pageRows.length > 0 && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30 font-semibold">
                          {COLUMNS.map(col => (
                            <TableCell
                              key={col.key}
                              className={`px-3 py-2.5 text-sm border-r border-b border-border last:border-r-0 whitespace-nowrap ${col.align === 'right' ? 'text-right tabular-nums' : ''}`}
                            >
                              {totalsValue(col.key)}
                            </TableCell>
                          ))}
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <Pagination className="mt-4">
                    <PaginationContent>
                      <PaginationItem>
                        <Button
                          variant="ghost"
                          size="default"
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="gap-1 pl-2.5"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          <span>Previous</span>
                        </Button>
                      </PaginationItem>
                      {getPageNumbers().map(p => (
                        typeof p === 'string' ? (
                          <PaginationItem key={p}><PaginationEllipsis /></PaginationItem>
                        ) : (
                          <PaginationItem key={p}>
                            <Button
                              variant={currentPage === p ? 'outline' : 'ghost'}
                              size="icon"
                              onClick={() => setPage(p)}
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
                          disabled={currentPage === totalPages}
                          className="gap-1 pr-2.5"
                        >
                          <span>Next</span>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
