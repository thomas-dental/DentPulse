import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';

/**
 * Income report — mirrors Dentally's Income report "Invoiced Items" section:
 * one row per treatment code with invoiced Quantity and Total for the selected
 * period + location, sorted by Total. Data comes from the same
 * get_profitability_invoice_items RPC the Profitability page uses, so this
 * screen reconciles with the rest of the app (invoice-based, not TPI-based).
 */
const asNum = (v: unknown) => {
  const n = typeof v === 'number' ? v : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const gbp = (v: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(v);

interface IncomeRow {
  name: string;
  quantity: number;
  total: number;
}

export default function TreatmentIncomeReport() {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId } = useFilters();
  const fromDate = format(dateRange.startDate, 'yyyy-MM-dd');
  const toDate = format(dateRange.endDate, 'yyyy-MM-dd');

  const { data: rows, isLoading } = useQuery({
    queryKey: ['treatment_income_report', organizationId, fromDate, toDate, selectedLocationId || 'all'],
    queryFn: async (): Promise<IncomeRow[]> => {
      if (!organizationId) return [];
      const { data, error } = await (supabase as any).rpc('get_profitability_invoice_items', {
        p_organization_id: organizationId,
        p_from_date: fromDate,
        p_to_date: toDate,
        p_location_id: selectedLocationId || null,
      });
      if (error) throw error;
      // Aggregate per treatment (RPC splits rows by month) and label rows the
      // way Dentally's report does: "203 - Hygiene 30".
      const byName = new Map<string, IncomeRow>();
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const code = String(r.treatment_code ?? '').trim();
        const name = `${code ? code + ' - ' : ''}${String(r.treatment_name ?? 'Unknown')}`;
        const e = byName.get(name) ?? { name, quantity: 0, total: 0 };
        e.quantity += asNum(r.no_of_treatments);
        e.total += asNum(r.total_revenue);
        byName.set(name, e);
      }
      return [...byName.values()].sort((a, b) => b.total - a.total);
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // Dentally-style controls: sortable columns + Zero Value Items toggle
  // (Dentally defaults to Excluded).
  type SortCol = 'name' | 'quantity' | 'total';
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' }>({ col: 'total', dir: 'desc' });
  const [zeroValueItems, setZeroValueItems] = useState<'included' | 'excluded'>('excluded');

  const handleSort = (col: SortCol) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: col === 'name' ? 'asc' : 'desc' }));
  const sortIcon = (col: SortCol) =>
    sort.col !== col ? <ArrowUpDown className="w-3.5 h-3.5 opacity-40 inline ml-1" />
      : sort.dir === 'desc' ? <ArrowDown className="w-3.5 h-3.5 inline ml-1" />
      : <ArrowUp className="w-3.5 h-3.5 inline ml-1" />;

  const displayRows = useMemo(() => {
    let d = rows ?? [];
    if (zeroValueItems === 'excluded') d = d.filter((r) => r.total !== 0);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...d].sort((a, b) =>
      sort.col === 'name' ? dir * a.name.localeCompare(b.name) : dir * (a[sort.col] - b[sort.col]),
    );
  }, [rows, sort, zeroValueItems]);

  const totals = useMemo(
    () => displayRows.reduce((a, r) => ({ quantity: a.quantity + r.quantity, total: a.total + r.total }), { quantity: 0, total: 0 }),
    [displayRows],
  );

  const exportCsv = () => {
    const lines = [
      ['Name', 'Quantity', 'Total'],
      ...displayRows.map((r) => [r.name, String(r.quantity), r.total.toFixed(2)]),
      ['Total', String(totals.quantity), totals.total.toFixed(2)],
    ];
    const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `income-report_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const aiContextData = {
    page: 'treatment-income-report',
    period: { from: fromDate, to: toDate },
    selectedLocationId: selectedLocationId || null,
    totals: { quantity: totals.quantity, total: Math.round(totals.total * 100) / 100 },
    topItems: (rows ?? []).slice(0, 40).map((r) => ({ name: r.name, quantity: r.quantity, total: Math.round(r.total * 100) / 100 })),
    rowCount: rows?.length ?? 0,
  };

  return (
    <MainLayout aiContext={aiContextData}>
      <Helmet><title>Income Report | DentPulse</title></Helmet>
      <div className="space-y-6 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Income</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Invoiced items for {format(dateRange.startDate, 'dd MMM yyyy')} — {format(dateRange.endDate, 'dd MMM yyyy')} · same figures as Dentally's Income report
            </p>
          </div>
          <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!rows || rows.length === 0}>
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between space-y-0 gap-3">
            <CardTitle className="text-lg">Invoiced Items</CardTitle>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Zero Value Items
              <select
                value={zeroValueItems}
                onChange={(e) => setZeroValueItems(e.target.value as 'included' | 'excluded')}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="excluded">Excluded</option>
                <option value="included">Included</option>
              </select>
            </label>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2 py-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : !rows || rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No invoiced items for this period and location.
              </p>
            ) : (
              <div className="overflow-x-auto min-w-0 max-w-full">
                <table className="w-full text-sm min-w-[480px]">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2.5 px-3 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('name')}>
                        Name{sortIcon('name')}
                      </th>
                      <th className="text-right py-2.5 px-3 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('quantity')}>
                        Quantity{sortIcon('quantity')}
                      </th>
                      <th className="text-right py-2.5 px-3 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('total')}>
                        Total{sortIcon('total')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r) => (
                      <tr key={r.name} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 px-3">{r.name}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.quantity.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{gbp(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-semibold">
                      <td className="py-2.5 px-3">Total ({displayRows.length} items)</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{totals.quantity.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{gbp(totals.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
