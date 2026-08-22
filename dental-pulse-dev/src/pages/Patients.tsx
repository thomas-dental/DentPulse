/**
 * Patients — patient roster KPIs on top, per-patient account balances below.
 *
 *  • KPI tiles: Total / Active / Inactive / New (all counts respect the global
 *    location filter; "New" uses the global date-range filter on pt_created_at;
 *    soft-deleted rows are excluded).
 *  • Table: rows from `dentally_patients_accounts` joined to `patients` so the
 *    grid shows the current account balance per patient plus planned NHS /
 *    private treatment value (synced from Dentally `/v1/accounts`).
 *  • Scope: only accounts with a minus (debit) balance are loaded — the table
 *    is the list of patients who currently owe money.
 *  • Search by patient name; sortable, paginated, CSV export.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import {
  ArrowUpDown, ArrowUp, ArrowDown, Download, Loader2, Search,
  ChevronLeft, ChevronRight, Users, UserCheck, UserX, UserPlus,
} from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Pagination, PaginationContent, PaginationItem, PaginationEllipsis,
} from '@/components/ui/pagination';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { useFilters } from '@/contexts/FilterContext';
import { toLocalYMD } from '@/utils/dateRangeUtils';

const PAGE_SIZE = 1000;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface AccountRow {
  id: string;
  daId: number | null;
  patientId: number | null;
  patientName: string;
  integrationKey: string;      // `${integration_id ?? '∅'}` — used with patientId to look up the resolved UUID
  accountUuid: string | null;  // dentally_patients_accounts.da_uuid — account UUID for the deep-link
  currentBalance: number;
  openingBalance: number;
  plannedNhs: number;
  plannedPrivate: number;
}

// Fetch all matching rows in chunks of PAGE_SIZE — Supabase caps a single
// query at 1k rows, and a practice can easily exceed that.
async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) { console.error('[Patients] fetch error:', error); break; }
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

interface ColumnDef<R> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right';
  render: (r: R) => ReactNode;
  sortVal?: (r: R) => string | number;
  csv: (r: R) => string | number;
}

export default function Patients() {
  const { organizationId } = useOrganization();
  const { showDecimals } = useOrganizationSettings();
  const fmtMoney = (n: number): string => {
    const abs = Math.abs(n).toLocaleString('en-GB', {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    });
    return n < 0 ? `-£${abs}` : `£${abs}`;
  };
  const { selectedLocationId, dateRange } = useFilters();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('currentBalance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // KPI counts — 3 parallel `count: exact, head: true` queries. Cheap because
  // they don't transfer rows, just a header. Replaces the prior approach of
  // pulling all 9K patient rows over ~10 sequential pages.
  const { data: counts = { total: 0, active: 0, inactive: 0, newCount: 0 }, isLoading: statsLoading } = useQuery({
    queryKey: ['patients-kpi-counts', organizationId, selectedLocationId, dateRange.startDate?.toISOString(), dateRange.endDate?.toISOString()],
    queryFn: async () => {
      if (!organizationId) return { total: 0, active: 0, inactive: 0, newCount: 0 };

      const baseQuery = () => {
        let q: any = (supabase as any).from('patients')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .is('deleted_at', null);
        if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
        return q;
      };

      const startYmd = toLocalYMD(dateRange.startDate);
      const endYmd = toLocalYMD(dateRange.endDate);

      // Mirror Dentally's filter semantics exactly:
      //  - Active   = is_active IS TRUE
      //  - Inactive = is_active IS FALSE
      //  - NULL is_active = "unknown" (counted in Total, neither Active nor
      //    Inactive). Earlier we treated NULL as Active, which inflated the
      //    Active count vs Dentally's "is active" filter.
      const [totalRes, activeRes, inactiveRes, newRes] = await Promise.all([
        baseQuery(),
        baseQuery().eq('is_active', true),
        baseQuery().eq('is_active', false),
        (startYmd && endYmd)
          ? baseQuery().gte('pt_created_at', startYmd).lte('pt_created_at', endYmd + 'T23:59:59')
          : Promise.resolve({ count: 0 }),
      ]);

      const total = totalRes.count ?? 0;
      const active = activeRes.count ?? 0;
      const inactive = inactiveRes.count ?? 0;
      const newCount = newRes.count ?? 0;
      return { total, active, inactive, newCount };
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });

  // Accounts — filter `location_id` server-side (populated by the post-sync
  // resolver in processor.js). For a single-location view this shrinks the
  // payload from org-wide to that one site, and the client-side join is gone
  // entirely. `da_patient_name` is the denormalised name captured at sync
  // time — we display that directly (good enough; renames show on next sync).
  //
  // The Dentally deep-link UUIDs are resolved in a SEPARATE background query
  // (see below) so the table renders the moment these account rows arrive —
  // it no longer blocks on the per-patient UUID lookup.
  const { data: rows = [], isLoading } = useQuery<AccountRow[]>({
    queryKey: ['patient-accounts', organizationId, selectedLocationId],
    queryFn: async (): Promise<AccountRow[]> => {
      if (!organizationId) return [];
      const data = await fetchAll<any>(() => {
        let q: any = (supabase as any)
          .from('dentally_patients_accounts')
          .select('id, da_id, da_uuid, da_patient_id, da_patient_name, da_current_balance, da_opening_balance, da_planned_nhs_treatment_value, da_planned_private_treatment_value, integration_id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          // Only load accounts with a minus (debit) balance — the table is
          // scoped to patients who owe money, so filtering server-side keeps the
          // payload small instead of pulling every account org-wide.
          .lt('da_current_balance', 0);
        if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
        return q;
      });

      return data.map((a, i): AccountRow => ({
        id: a.id ?? `a-${i}`,
        daId: a.da_id ?? null,
        patientId: a.da_patient_id != null ? Number(a.da_patient_id) : null,
        patientName: a.da_patient_name || '—',
        integrationKey: a.integration_id ?? '∅',
        accountUuid: a.da_uuid ?? null,
        currentBalance: Number(a.da_current_balance ?? 0),
        openingBalance: Number(a.da_opening_balance ?? 0),
        plannedNhs: Number(a.da_planned_nhs_treatment_value ?? 0),
        plannedPrivate: Number(a.da_planned_private_treatment_value ?? 0),
      }));
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });

  // Background UUID resolution — maps each account's patient to a Dentally UUID
  // (pt_unique_id) so a row click can deep-link to the Dentally account page.
  // This runs AFTER the accounts load and does NOT gate the table render; the
  // row links simply light up once it resolves. pt_id is reused across sibling
  // Dentally practices in the same org, so the lookup is scoped by
  // integration_id to stop the wrong patient leaking in.
  //
  // All lookups fan out concurrently (integration × 500-id chunk) via
  // Promise.all instead of the old sequential await-in-a-loop, which on a
  // multi-integration org was a long serial chain of round-trips.
  const { data: ptUuidByKey } = useQuery<Map<string, string>>({
    queryKey: ['patient-accounts-uuids', organizationId, selectedLocationId, rows.length],
    enabled: !!organizationId && rows.length > 0,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const idsByIntegration = new Map<string, Set<number>>();
      for (const r of rows) {
        if (r.patientId == null) continue;
        if (!idsByIntegration.has(r.integrationKey)) idsByIntegration.set(r.integrationKey, new Set());
        idsByIntegration.get(r.integrationKey)!.add(r.patientId);
      }

      const result = new Map<string, string>(); // `${integration_id}:${pt_id}` → pt_unique_id
      await Promise.all([...idsByIntegration].map(async ([intId, idSet]) => {
        const ids = [...idSet];
        const chunkQueries: Promise<any>[] = [];
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          let q: any = (supabase as any).from('patients')
            .select('pt_id, pt_unique_id, integration_id')
            .eq('organization_id', organizationId)
            .in('pt_id', chunk);
          if (intId !== '∅') q = q.eq('integration_id', intId);
          chunkQueries.push(q);
        }
        const responses = await Promise.all(chunkQueries);
        for (const { data: pts, error } of responses) {
          if (error) { console.error('[Patients] patient uuid lookup error:', error); continue; }
          for (const p of pts ?? []) {
            if (p.pt_id != null && p.pt_unique_id) {
              result.set(`${p.integration_id ?? '∅'}:${Number(p.pt_id)}`, String(p.pt_unique_id));
            }
          }
        }
      }));
      return result;
    },
  });

  const accountsTotal = useMemo(
    () => rows.reduce((sum, r) => sum + r.currentBalance, 0),
    [rows],
  );

  const columns: ColumnDef<AccountRow>[] = [
    { key: 'patientName', label: 'Patient', sortable: true,
      render: r => <span className="font-medium">{r.patientName}</span>,
      sortVal: r => r.patientName, csv: r => r.patientName },
    { key: 'currentBalance', label: 'Current Balance', sortable: true, align: 'right',
      render: r => (
        <span className={`whitespace-nowrap ${r.currentBalance < 0 ? 'text-red-600' : r.currentBalance > 0 ? 'text-green-700' : 'text-muted-foreground'}`}>
          {fmtMoney(r.currentBalance)}
        </span>
      ),
      sortVal: r => r.currentBalance, csv: r => r.currentBalance.toFixed(2) },
    { key: 'openingBalance', label: 'Opening Balance', sortable: true, align: 'right',
      render: r => <span className="whitespace-nowrap">{fmtMoney(r.openingBalance)}</span>,
      sortVal: r => r.openingBalance, csv: r => r.openingBalance.toFixed(2) },
    { key: 'plannedNhs', label: 'Planned NHS', sortable: true, align: 'right',
      render: r => <span className="whitespace-nowrap">{fmtMoney(r.plannedNhs)}</span>,
      sortVal: r => r.plannedNhs, csv: r => r.plannedNhs.toFixed(2) },
    { key: 'plannedPrivate', label: 'Planned Private', sortable: true, align: 'right',
      render: r => <span className="whitespace-nowrap">{fmtMoney(r.plannedPrivate)}</span>,
      sortVal: r => r.plannedPrivate, csv: r => r.plannedPrivate.toFixed(2) },
  ];

  const filtered = useMemo(() => {
    let arr = rows;
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter(r => r.patientName.toLowerCase().includes(q));
    return arr;
  }, [rows, search]);

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortVal) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = col.sortVal!(a); const bv = col.sortVal!(b);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );
  useEffect(() => { setPage(1); }, [search, sortKey, sortDir, pageSize, rows]);

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
    link.href = url; link.download = `patient_accounts_${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <MainLayout aiContext={{ page: 'patients' }}>
      <Helmet><title>Patients</title></Helmet>

      <div className="space-y-5 pt-6">
        <div>
          <h1 className="text-2xl font-bold">Patients</h1>
          <p className="text-muted-foreground">Patient roster summary and per-patient account balances.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 pb-5">
              <div className="flex items-start justify-between mb-2">
                <span className="text-sm text-muted-foreground">Total Patients</span>
                <div className="w-9 h-9 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800">
                  <Users className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                </div>
              </div>
              <p className="text-2xl font-bold">{statsLoading ? '—' : counts.total.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 pb-5">
              <div className="flex items-start justify-between mb-2">
                <span className="text-sm text-muted-foreground">Active</span>
                <div className="w-9 h-9 rounded-full flex items-center justify-center bg-green-100 dark:bg-green-900/40">
                  <UserCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                {statsLoading ? '—' : counts.active.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 pb-5">
              <div className="flex items-start justify-between mb-2">
                <span className="text-sm text-muted-foreground">Inactive</span>
                <div className="w-9 h-9 rounded-full flex items-center justify-center bg-red-100 dark:bg-red-900/40">
                  <UserX className="w-4 h-4 text-red-600 dark:text-red-400" />
                </div>
              </div>
              <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                {statsLoading ? '—' : counts.inactive.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 pb-5">
              <div className="flex items-start justify-between mb-2">
                <span className="text-sm text-muted-foreground">New Patients</span>
                <div className="w-9 h-9 rounded-full flex items-center justify-center bg-blue-100 dark:bg-blue-900/40">
                  <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                {statsLoading ? '—' : counts.newCount.toLocaleString()}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Registered {toLocalYMD(dateRange.startDate)} → {toLocalYMD(dateRange.endDate)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h2 className="text-base font-semibold">Accounts in Debt</h2>
                <p className="text-xs text-muted-foreground">
                  Total owed: <span className="text-red-600 font-medium">
                    {fmtMoney(accountsTotal)}
                  </span>
                  {selectedLocationId
                    ? <span className="ml-2">· Scoped to the selected location</span>
                    : <span className="ml-2">· Org-wide</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 ml-auto">
                <div className="relative w-full sm:w-[240px]">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search patient name…"
                    className="h-9 pl-9"
                  />
                </div>
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
                <div className="text-center py-20 text-muted-foreground text-sm">
                  No accounts match the current filter.
                </div>
              ) : (
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
                    {pageRows.map(r => {
                      const patientUuid = r.patientId != null
                        ? (ptUuidByKey?.get(`${r.integrationKey}:${r.patientId}`) ?? null)
                        : null;
                      const canLink = !!(patientUuid && r.accountUuid);
                      return (
                      <tr
                        key={r.id}
                        onClick={canLink
                          ? () => window.open(
                              `https://app.dentally.co/patients/${patientUuid}/account/${r.accountUuid}`,
                              '_blank', 'noopener,noreferrer')
                          : undefined}
                        title={canLink ? 'Open in Dentally' : undefined}
                        className={`border-b border-border/50 hover:bg-muted/30 ${canLink ? 'cursor-pointer' : ''}`}
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
                      );
                    })}
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
                            variant="ghost" size="default"
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
                            variant="ghost" size="default"
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
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
