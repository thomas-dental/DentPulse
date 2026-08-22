import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, CheckCircle, XCircle, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, MapPin, Armchair, Mail, Phone, TrendingUp, Stethoscope, Layers, ArrowLeft, Download } from 'lucide-react';
import { useLocationHistory, LocationHistoryTreatment } from '@/hooks/useLocationHistory';
import { useCostImpactData } from '@/hooks/useCostImpactData';
import { useLocationMetrics } from '@/hooks/useLocationMetrics';
import { useChairMetrics } from '@/hooks/useChairMetrics';
import { useHourlyChairMetrics } from '@/hooks/useHourlyChairMetrics';
import { useWeeklyChairPattern } from '@/hooks/useWeeklyChairPattern';
import { useFilters } from '@/contexts/FilterContext';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend, AreaChart, Area,
} from 'recharts';

// ── Helpers ─────────────────────────────────────────────────────────

const formatCurrency = (value: number): string =>
  `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatCompact = (value: number): string =>
  value >= 1000 ? `£${(value / 1000).toFixed(1)}k` : `£${value.toFixed(0)}`;

const getInitials = (name: string): string => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const STATUS_COLORS = {
  completed: '#22c55e',
  cancelled: '#ef4444',
  dna: '#f59e0b',
};

const COST_COLORS = {
  labFees: 'hsl(var(--chart-1))',
  staffCosts: 'hsl(var(--chart-2))',
  operatingLeases: 'hsl(var(--chart-3))',
  clinicianCosts: 'hsl(var(--chart-4))',
  overheadCosts: 'hsl(var(--chart-5))',
  materialCosts: '#a855f7',
};

// ── Sort Types ──────────────────────────────────────────────────────

type ProviderSortKey = 'name' | 'role' | 'patients' | 'appointments' | 'revenue' | 'avgRevPerPatient' | 'utilisation' | 'associateSplit' | 'associateSplitAmount' | 'labSplit' | 'labSplitAmount';
type TreatmentSortKey = 'name' | 'type' | 'category' | 'count' | 'revenue' | 'avgPrice' | 'materialCost' | 'labBill' | 'therapistRate' | 'opCostPerTreatment' | 'associatePay' | 'financeFee' | 'expensePerUnit' | 'profitLossPerUnit' | 'totalExpense' | 'totalPL' | 'principalProfit' | 'plPercent' | 'principalProfitPercent';
type SortOrder = 'asc' | 'desc';

// ── Treatment Column Definitions ───────────────────────────────────

type TreatmentColumnKey = TreatmentSortKey;

interface TreatmentColumnDef {
  key: TreatmentColumnKey;
  label: string;
  group: 'none' | 'perUnit' | 'total';
  defaultVisible: boolean;
}

const TREATMENT_COLUMNS: TreatmentColumnDef[] = [
  { key: 'name', label: 'Treatment Name', group: 'none', defaultVisible: true },
  { key: 'category', label: 'Category', group: 'none', defaultVisible: true },
  { key: 'type', label: 'Type', group: 'none', defaultVisible: true },
  { key: 'count', label: 'No. of Treatments', group: 'none', defaultVisible: true },
  { key: 'avgPrice', label: 'Average Income', group: 'perUnit', defaultVisible: true },
  { key: 'materialCost', label: 'Material Cost', group: 'perUnit', defaultVisible: true },
  { key: 'labBill', label: 'Lab Bill', group: 'perUnit', defaultVisible: true },
  { key: 'therapistRate', label: 'Therapist Pay Rate', group: 'perUnit', defaultVisible: true },
  { key: 'opCostPerTreatment', label: 'OP. Cost / Treatment', group: 'perUnit', defaultVisible: true },
  { key: 'associatePay', label: 'Associate Pay', group: 'perUnit', defaultVisible: true },
  { key: 'financeFee', label: 'Finance Fee', group: 'perUnit', defaultVisible: true },
  { key: 'expensePerUnit', label: 'Expense / Unit', group: 'perUnit', defaultVisible: true },
  { key: 'profitLossPerUnit', label: 'Profit/Loss / Unit', group: 'perUnit', defaultVisible: true },
  { key: 'revenue', label: 'Total Income', group: 'total', defaultVisible: true },
  { key: 'totalExpense', label: 'Total Expense', group: 'total', defaultVisible: true },
  { key: 'totalPL', label: 'Total P/L', group: 'total', defaultVisible: true },
  { key: 'principalProfit', label: 'Principal Profit', group: 'total', defaultVisible: false },
  { key: 'plPercent', label: 'P/L %', group: 'total', defaultVisible: false },
  { key: 'principalProfitPercent', label: 'Principal Profit %', group: 'total', defaultVisible: true },
];

const DEFAULT_TREATMENT_COLS = new Set<TreatmentColumnKey>(
  TREATMENT_COLUMNS.filter(c => c.defaultVisible).map(c => c.key),
);

const TREATMENT_COL_STORAGE_KEY = 'dentpulse_location_history_treatment_cols';

// ── Component ───────────────────────────────────────────────────────

export default function LocationHistory() {
  const navigate = useNavigate();
  const { selectedLocationId, dateRange } = useFilters();
  const { data, isLoading } = useLocationHistory();
  const { data: costData } = useCostImpactData();
  const { data: metricsMap } = useLocationMetrics();

  // Chair metrics for selected location
  const { data: chairMetrics } = useChairMetrics({ startDate: dateRange.startDate, endDate: dateRange.endDate });
  const { data: hourlyChairData } = useHourlyChairMetrics({ startDate: dateRange.startDate, endDate: dateRange.endDate, locationId: selectedLocationId });
  const { data: weeklyChairData } = useWeeklyChairPattern({ startDate: dateRange.startDate, endDate: dateRange.endDate, locationId: selectedLocationId });

  // Provider table state
  const [providerSearch, setProviderSearch] = useState('');
  const [providerSortKey, setProviderSortKey] = useState<ProviderSortKey>('revenue');
  const [providerSortOrder, setProviderSortOrder] = useState<SortOrder>('desc');
  const [providerPage, setProviderPage] = useState(1);
  const [providerPageSize, setProviderPageSize] = useState(10);
  const [providerFilter, setProviderFilter] = useState<string>('all');

  // Treatment table state
  const [treatmentSearch, setTreatmentSearch] = useState('');
  const [treatmentSortKey, setTreatmentSortKey] = useState<TreatmentSortKey>('revenue');
  const [treatmentSortOrder, setTreatmentSortOrder] = useState<SortOrder>('desc');
  const [treatmentPage, setTreatmentPage] = useState(1);
  const [treatmentPageSize, setTreatmentPageSize] = useState(10);
  const [treatmentTypeFilter, setTreatmentTypeFilter] = useState<string>('all');
  const [treatmentVisibleCols, setTreatmentVisibleCols] = useState<Set<TreatmentColumnKey>>(() => {
    try {
      const stored = localStorage.getItem(TREATMENT_COL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) return new Set<TreatmentColumnKey>(parsed as TreatmentColumnKey[]);
      }
    } catch { /* ignore */ }
    return new Set(DEFAULT_TREATMENT_COLS);
  });

  // Chart view mode
  const [chartView, setChartView] = useState<string>('revenue');

  const location = data?.location;
  const providers = data?.providers ?? [];
  const treatments = data?.treatments ?? [];
  const monthlyTrend = data?.monthlyTrend ?? [];
  const summary = data?.summary;

  const locationMetrics = selectedLocationId && metricsMap ? metricsMap.get(selectedLocationId) : null;
  const locationChairMetric = useMemo(() => {
    if (!chairMetrics || !selectedLocationId) return null;
    return chairMetrics.find(m => m.location_id === selectedLocationId) ?? null;
  }, [chairMetrics, selectedLocationId]);

  // ── Provider sort/filter/paginate ─────────────────────────────────

  const handleProviderSort = (key: ProviderSortKey) => {
    if (providerSortKey === key) {
      setProviderSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setProviderSortKey(key);
      setProviderSortOrder('desc');
    }
    setProviderPage(1);
  };

  const uniqueRoles = useMemo(() => [...new Set(providers.map(p => p.role))].sort(), [providers]);

  const filteredProviders = useMemo(() => {
    return providers
      .filter(p => {
        if (!p.isActive) return false;
        const matchesSearch = p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
          p.role.toLowerCase().includes(providerSearch.toLowerCase());
        const matchesRole = providerFilter === 'all' || p.role === providerFilter;
        return matchesSearch && matchesRole;
      })
      .sort((a, b) => {
        let cmp = 0;
        switch (providerSortKey) {
          case 'name': cmp = a.name.localeCompare(b.name); break;
          case 'role': cmp = a.role.localeCompare(b.role); break;
          case 'associateSplitAmount': cmp = (a.revenue * a.associateSplit) - (b.revenue * b.associateSplit); break;
          case 'labSplitAmount': cmp = (a.revenue * a.labSplit) - (b.revenue * b.labSplit); break;
          default: cmp = (a[providerSortKey] as number) - (b[providerSortKey] as number); break;
        }
        return providerSortOrder === 'asc' ? cmp : -cmp;
      });
  }, [providers, providerSearch, providerFilter, providerSortKey, providerSortOrder]);

  const providerTotalPages = Math.max(1, Math.ceil(filteredProviders.length / providerPageSize));
  const paginatedProviders = filteredProviders.slice((providerPage - 1) * providerPageSize, providerPage * providerPageSize);

  // ── Treatment sort/filter/paginate ────────────────────────────────

  const handleTreatmentSort = (key: TreatmentSortKey) => {
    if (treatmentSortKey === key) {
      setTreatmentSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setTreatmentSortKey(key);
      setTreatmentSortOrder('desc');
    }
    setTreatmentPage(1);
  };

  const filteredTreatments = useMemo(() => {
    return treatments
      .filter(t => {
        const matchesSearch = t.name.toLowerCase().includes(treatmentSearch.toLowerCase());
        const matchesType = treatmentTypeFilter === 'all' || t.type === treatmentTypeFilter;
        return matchesSearch && matchesType;
      })
      .sort((a, b) => {
        let cmp = 0;
        switch (treatmentSortKey) {
          case 'name': cmp = a.name.localeCompare(b.name); break;
          case 'type': cmp = a.type.localeCompare(b.type); break;
          case 'category': cmp = a.category.localeCompare(b.category); break;
          default: cmp = (a[treatmentSortKey] as number) - (b[treatmentSortKey] as number); break;
        }
        return treatmentSortOrder === 'asc' ? cmp : -cmp;
      });
  }, [treatments, treatmentSearch, treatmentTypeFilter, treatmentSortKey, treatmentSortOrder]);

  const treatmentTotalPages = Math.max(1, Math.ceil(filteredTreatments.length / treatmentPageSize));
  const paginatedTreatments = filteredTreatments.slice((treatmentPage - 1) * treatmentPageSize, treatmentPage * treatmentPageSize);

  // ── Treatment column toggle ──
  const toggleTreatmentCol = (key: TreatmentColumnKey) =>
    setTreatmentVisibleCols(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try { localStorage.setItem(TREATMENT_COL_STORAGE_KEY, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });

  const visibleTreatmentColumns = TREATMENT_COLUMNS.filter(c => treatmentVisibleCols.has(c.key));

  // ── Treatment totals ──
  const treatmentTotals = useMemo(() => {
    const src = filteredTreatments;
    const n = src.reduce((s, r) => s + r.count, 0);
    const ti = src.reduce((s, r) => s + r.revenue, 0);
    const te = src.reduce((s, r) => s + r.totalExpense, 0);
    const tp = ti - te;
    const pp = src.reduce((s, r) => s + r.principalProfit, 0);
    return {
      count: n,
      avgPrice: src.reduce((s, r) => s + r.avgPrice, 0),
      materialCost: src.reduce((s, r) => s + r.materialCost, 0),
      labBill: src.reduce((s, r) => s + r.labBill, 0),
      therapistRate: src.reduce((s, r) => s + r.therapistRate, 0),
      opCostPerTreatment: src.reduce((s, r) => s + r.opCostPerTreatment, 0),
      associatePay: src.reduce((s, r) => s + r.associatePay, 0),
      financeFee: src.reduce((s, r) => s + r.financeFee, 0),
      expensePerUnit: src.reduce((s, r) => s + r.expensePerUnit, 0),
      profitLossPerUnit: src.reduce((s, r) => s + r.profitLossPerUnit, 0),
      revenue: ti,
      totalExpense: te,
      totalPL: tp,
      principalProfit: pp,
      plPercent: ti !== 0 ? (tp / ti) * 100 : 0,
      principalProfitPercent: ti !== 0 ? (pp / ti) * 100 : 0,
    };
  }, [filteredTreatments]);

  // ── Treatment CSV export ──
  const exportTreatmentCSV = useCallback(() => {
    if (filteredTreatments.length === 0) return;
    const cols = visibleTreatmentColumns;
    const getCellValue = (t: LocationHistoryTreatment, key: TreatmentColumnKey): string => {
      switch (key) {
        case 'name': return t.name;
        case 'category': return t.category;
        case 'type': return t.type;
        case 'count': return String(t.count);
        case 'plPercent': return `${t.plPercent.toFixed(1)}`;
        case 'principalProfitPercent': return `${t.principalProfitPercent.toFixed(1)}`;
        default: {
          const val = t[key as keyof LocationHistoryTreatment];
          return typeof val === 'number' ? val.toFixed(2) : String(val ?? '');
        }
      }
    };
    const header = cols.map(c => `"${c.label}"`).join(',');
    const csvRows = filteredTreatments.map(t =>
      cols.map(c => `"${getCellValue(t, c.key).replace(/"/g, '""')}"`).join(',')
    );
    // Totals row
    const totalsRow = cols.map(c => {
      if (c.key === 'name') return '"Total"';
      if (c.key === 'category' || c.key === 'type') return '""';
      if (c.key === 'count') return `"${treatmentTotals.count}"`;
      if (c.key === 'plPercent') return `"${treatmentTotals.plPercent.toFixed(1)}"`;
      if (c.key === 'principalProfitPercent') return `"${treatmentTotals.principalProfitPercent.toFixed(1)}"`;
      const val = treatmentTotals[c.key as keyof typeof treatmentTotals];
      return `"${typeof val === 'number' ? val.toFixed(2) : ''}"`;
    }).join(',');

    const csv = [header, ...csvRows, totalsRow].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `location-treatments-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredTreatments, visibleTreatmentColumns, treatmentTotals]);

  // ── Reusable sort header ──────────────────────────────────────────

  const ProviderSortHeader = ({ label, sortKeyValue, className }: { label: string; sortKeyValue: ProviderSortKey; className?: string }) => (
    <th className={cn('cursor-pointer hover:bg-muted/50 transition-colors', className)} onClick={() => handleProviderSort(sortKeyValue)}>
      <div className="flex items-center gap-1">
        {label}
        {providerSortKey === sortKeyValue
          ? (providerSortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </div>
    </th>
  );

  // ── Cost impact tiles data ────────────────────────────────────────

  const costTiles = costData ? [
    { label: 'Lab Fees', value: costData.labFeesCost, color: COST_COLORS.labFees },
    { label: 'Staff Costs', value: costData.staffCostsCost, color: COST_COLORS.staffCosts },
    { label: 'Operating Leases', value: costData.operatingLeasesCost, color: COST_COLORS.operatingLeases },
    { label: 'Clinician Costs', value: costData.clinicianCostCost, color: COST_COLORS.clinicianCosts },
    { label: 'Overhead Costs', value: costData.overheadCostCost, color: COST_COLORS.overheadCosts },
    { label: 'Material Costs', value: costData.materialCostCost, color: COST_COLORS.materialCosts },
  ] : [];

  const totalCostFromTiles = costTiles.reduce((s, t) => s + t.value, 0);

  // ── Role badge color ──────────────────────────────────────────────

  const getRoleBadgeVariant = (role: string) => {
    const r = role.toLowerCase();
    if (r.includes('dentist')) return 'default';
    if (r.includes('hygienist')) return 'secondary';
    if (r.includes('therapist')) return 'outline';
    return 'outline';
  };

  // ── No location selected state ────────────────────────────────────

  if (!selectedLocationId) {
    return (
      <MainLayout userRole="admin">
        <Helmet><title>Location History</title></Helmet>
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <MapPin className="w-12 h-12 text-muted-foreground/40" />
          <h2 className="text-xl font-semibold text-foreground">No Location Selected</h2>
          <p className="text-muted-foreground max-w-md">
            Select a location from the Locations page to view its historical data.
          </p>
          <Button onClick={() => navigate('/locations')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go to Locations
          </Button>
        </div>
      </MainLayout>
    );
  }

  // Snapshot the page's already-computed data for the chatbot. We send a
  // pruned summary (no raw appointment/TPI arrays) so payload stays small,
  // but it includes everything the chatbot needs to answer attendance/DNA,
  // revenue, and provider questions about THIS view — no extra DB roundtrip.
  const aiContextSnapshot = {
    page: 'location-history',
    data: {
      location: data?.location ? { id: data.location.id, name: data.location.name } : null,
      summary: data?.summary || null,
      providers: (data?.providers || []).map(p => ({
        name: p.name,
        role: p.role,
        revenue: p.revenue,
        appointments: p.appointments,
        patients: p.patients,
      })),
      monthlyTrend: data?.monthlyTrend || [],
      dateRange: {
        from: dateRange.startDate?.toISOString().slice(0, 10) || null,
        to: dateRange.endDate?.toISOString().slice(0, 10) || null,
      },
    },
  };

  return (
    <MainLayout userRole="admin" aiContext={aiContextSnapshot}>
      <Helmet><title>{location?.name || 'Location'} History</title></Helmet>

      <div className="space-y-6 animate-fade-in">
        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/locations')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Location History</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Historical snapshots — providers, treatments, costs &amp; appointments
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading location history...</p>
          </div>
        ) : (
          <>
            {/* ── Location Banner ─────────────────────────────────── */}
            {location && (
              <Card>
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-7 h-7 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h2 className="text-lg font-bold">{location.name}</h2>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1 text-sm text-muted-foreground">
                        {location.address && (
                          <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{location.address}</span>
                        )}
                        <span className="flex items-center gap-1">Region: {location.region}</span>
                        <span className="flex items-center gap-1"><Armchair className="w-3.5 h-3.5" />{locationChairMetric?.chairs_count ?? location.chairs} Chairs</span>
                        {location.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{location.email}</span>}
                        {location.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{location.phone}</span>}
                        <Badge variant={location.isActive ? 'default' : 'destructive'} className="text-xs">
                          {location.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Financial Summary ──────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-primary mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Financial Overview
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">Total Revenue</div>
                  <p className="text-2xl font-bold text-primary">{formatCurrency(summary?.totalRevenue ?? 0)}</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">Total Costs</div>
                  <p className="text-2xl font-bold">{formatCurrency(costData?.totalCosts ?? 0)}</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">EBITDA</div>
                  <p className={cn('text-2xl font-bold', ((summary?.totalRevenue ?? 0) - (costData?.totalCosts ?? 0)) >= 0 ? 'text-green-600' : 'text-red-600')}>
                    {formatCurrency((summary?.totalRevenue ?? 0) - (costData?.totalCosts ?? 0))}
                  </p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">EBITDA %</div>
                  <p className={cn('text-2xl font-bold', (locationMetrics?.ebitdaPercent ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                    {locationMetrics?.ebitdaPercent != null ? `${locationMetrics.ebitdaPercent}%` : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Operational Summary ──────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-gradient-to-br from-blue-500/5 via-card to-card p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-blue-600 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4" /> Operations
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Users className="w-3.5 h-3.5 text-blue-500" />Providers
                  </div>
                  <p className="text-2xl font-bold">{summary?.activeProviders ?? 0}</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Users className="w-3.5 h-3.5 text-indigo-500" />Patients
                  </div>
                  <p className="text-2xl font-bold">{(summary?.uniquePatients ?? 0).toLocaleString()}</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Stethoscope className="w-3.5 h-3.5 text-violet-500" />Treatments
                  </div>
                  <p className="text-2xl font-bold">{(summary?.treatmentsCompleted ?? 0).toLocaleString()}</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />Completed
                  </div>
                  <p className="text-2xl font-bold text-green-600">{(summary?.completedAppts ?? 0).toLocaleString()}</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <XCircle className="w-3.5 h-3.5 text-red-500" />Cancelled
                  </div>
                  <p className="text-2xl font-bold text-red-600">{(summary?.cancelledAppts ?? 0).toLocaleString()}</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />DNA
                  </div>
                  <p className="text-2xl font-bold text-amber-600">{(summary?.dnaAppts ?? 0).toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* ── Collection & Performance ──────────────────────────────── */}
            <div className="rounded-xl border border-border bg-gradient-to-br from-emerald-500/5 via-card to-card p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-600 mb-4 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" /> Collection & Performance
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">Collection Rate</div>
                  <p className={cn('text-2xl font-bold',
                    locationMetrics?.collectionRate != null && locationMetrics.collectionRate < 90 ? 'text-red-600' :
                    locationMetrics?.collectionRate != null && locationMetrics.collectionRate < 95 ? 'text-amber-600' : 'text-green-600'
                  )}>
                    {locationMetrics?.collectionRate != null ? `${locationMetrics.collectionRate}%` : '—'}
                  </p>
                  {locationMetrics?.collectionRate != null && (
                    <div className="mt-2 h-1.5 bg-muted rounded-full">
                      <div className={cn('h-full rounded-full', locationMetrics.collectionRate >= 95 ? 'bg-green-500' : locationMetrics.collectionRate >= 90 ? 'bg-amber-500' : 'bg-red-500')}
                        style={{ width: `${Math.min(100, locationMetrics.collectionRate)}%` }} />
                    </div>
                  )}
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">Avg Rev / Patient</div>
                  <p className="text-2xl font-bold">
                    {summary?.uniquePatients && summary.uniquePatients > 0
                      ? formatCurrency(summary.totalRevenue / summary.uniquePatients)
                      : '—'}
                  </p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground mb-1">Completion Rate</div>
                  <p className={cn('text-2xl font-bold',
                    summary?.totalAppointments && summary.totalAppointments > 0
                      ? (summary.completedAppts / summary.totalAppointments) * 100 < 80 ? 'text-red-600'
                        : (summary.completedAppts / summary.totalAppointments) * 100 < 90 ? 'text-amber-600' : 'text-green-600'
                      : ''
                  )}>
                    {summary?.totalAppointments && summary.totalAppointments > 0
                      ? `${((summary.completedAppts / summary.totalAppointments) * 100).toFixed(1)}%`
                      : '—'}
                  </p>
                  {summary?.totalAppointments != null && summary.totalAppointments > 0 && (
                    <div className="mt-2 h-1.5 bg-muted rounded-full">
                      <div className={cn('h-full rounded-full',
                        (summary.completedAppts / summary.totalAppointments) * 100 >= 90 ? 'bg-green-500' :
                        (summary.completedAppts / summary.totalAppointments) * 100 >= 80 ? 'bg-amber-500' : 'bg-red-500')}
                        style={{ width: `${Math.min(100, (summary.completedAppts / summary.totalAppointments) * 100)}%` }} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Trend Chart ──────────────────────────────────────── */}
            {monthlyTrend.length > 0 && (
              <Card className="border-border">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      {chartView === 'revenue' ? 'Revenue Trend' : 'Appointment Status Trend'}
                    </h3>
                    <Select value={chartView} onValueChange={setChartView}>
                      <SelectTrigger className="w-[180px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="revenue">Revenue Trend</SelectItem>
                        <SelectItem value="appointments">Appointment Trend</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    {chartView === 'revenue' ? (
                      <AreaChart data={monthlyTrend} margin={{ left: 0, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatCompact(v)} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} />
                      </AreaChart>
                    ) : (
                      <BarChart data={monthlyTrend} margin={{ left: 0, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="completed" name="Completed" fill={STATUS_COLORS.completed} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="cancelled" name="Cancelled" fill={STATUS_COLORS.cancelled} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="dna" name="DNA" fill={STATUS_COLORS.dna} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* ── Providers Section ────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-gradient-to-br from-violet-500/5 via-card to-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-600 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Top Providers
                  <Badge variant="secondary" className="text-xs ml-1">{filteredProviders.length} active</Badge>
                </h3>
              </div>

              {/* Top 5 + Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left: Top 5 Leaderboard */}
                <div className="bg-card rounded-lg border border-border p-4">
                  <h4 className="text-sm font-semibold mb-3">Revenue Leaderboard</h4>
                  <div className="space-y-3">
                    {filteredProviders.slice(0, 5).map((p, i) => {
                      const maxRev = filteredProviders[0]?.revenue || 1;
                      const barPct = (p.revenue / maxRev) * 100;
                      return (
                        <div key={p.id} className="flex items-center gap-3">
                          <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0',
                            i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-amber-700' : 'bg-muted-foreground/40'
                          )}>{i + 1}</span>
                          <Avatar className="h-8 w-8 flex-shrink-0">
                            <AvatarImage src={p.photoUrl || undefined} />
                            <AvatarFallback className="text-xs">{getInitials(p.name)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-medium text-sm truncate">{p.name}</span>
                                <Badge variant={getRoleBadgeVariant(p.role)} className="text-[10px] px-1.5 py-0 flex-shrink-0">{p.role}</Badge>
                              </div>
                              <span className="font-bold text-sm text-primary flex-shrink-0 ml-2">{formatCurrency(p.revenue)}</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full">
                              <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${barPct}%` }} />
                            </div>
                            <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground">
                              <span>{p.patients} patients</span>
                              <span>{p.appointments} appts</span>
                              <span>{formatCurrency(p.avgRevPerPatient)}/patient</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {filteredProviders.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center py-6">No providers found</div>
                    )}
                  </div>

                  {/* Role breakdown + key stats */}
                  {filteredProviders.length > 0 && (() => {
                    const roleStats = new Map<string, { count: number; revenue: number; patients: number }>();
                    for (const p of filteredProviders) {
                      const r = roleStats.get(p.role) || { count: 0, revenue: 0, patients: 0 };
                      r.count++; r.revenue += p.revenue; r.patients += p.patients;
                      roleStats.set(p.role, r);
                    }
                    const totalRev = filteredProviders.reduce((s, p) => s + p.revenue, 0);
                    const roles = [...roleStats.entries()].filter(([role]) => role !== 'Administrator').sort((a, b) => b[1].revenue - a[1].revenue);
                    return (
                      <div className="mt-4 space-y-3">
                        <h4 className="text-sm font-semibold">By Role</h4>
                        {roles.map(([role, stats]) => {
                          const pct = totalRev > 0 ? (stats.revenue / totalRev) * 100 : 0;
                          return (
                            <div key={role} className="flex items-center gap-3">
                              <Badge variant={getRoleBadgeVariant(role)} className="text-[10px] w-20 justify-center flex-shrink-0">{role}</Badge>
                              <div className="flex-1">
                                <div className="flex justify-between text-xs mb-0.5">
                                  <span className="text-muted-foreground">{stats.count} providers · {stats.patients} patients</span>
                                  <span className="font-medium">{formatCurrency(stats.revenue)}</span>
                                </div>
                                <div className="h-1.5 bg-muted rounded-full">
                                  <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* Right: Charts */}
                <div className="space-y-4">
                  {/* Revenue by Provider bar chart */}
                  <div className="bg-card rounded-lg border border-border p-4">
                    <h4 className="text-sm font-semibold mb-3">Revenue by Provider</h4>
                    {filteredProviders.length > 0 ? (
                      <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={filteredProviders.slice(0, 8).map(p => ({ name: p.name.split(' ')[0], revenue: p.revenue }))}
                            margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCompact(v)} />
                            <Tooltip formatter={(value: number) => [formatCurrency(value), 'Revenue']} contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                            <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
                    )}
                  </div>

                  {/* Utilisation by Provider */}
                  <div className="bg-card rounded-lg border border-border p-4">
                    <h4 className="text-sm font-semibold mb-3">Utilisation by Provider</h4>
                    {filteredProviders.length > 0 ? (
                      <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={filteredProviders.slice(0, 8).map(p => ({ name: p.name.split(' ')[0], utilisation: p.utilisation }))}
                            margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                            <Tooltip formatter={(value: number) => [`${value}%`, 'Utilisation']} contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                            <Bar dataKey="utilisation" radius={[4, 4, 0, 0]}>
                              {filteredProviders.slice(0, 8).map((p, i) => (
                                <Cell key={i} fill={p.utilisation >= 80 ? '#22c55e' : p.utilisation >= 60 ? '#f59e0b' : p.utilisation >= 30 ? '#f97316' : '#ef4444'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* ── Treatments Section ───────────────────────────────── */}
            <div className="rounded-xl border border-border bg-gradient-to-br from-cyan-500/5 via-card to-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-cyan-600 flex items-center gap-2">
                  <Stethoscope className="w-4 h-4" /> Top Treatments
                  <Badge variant="secondary" className="text-xs ml-1">{filteredTreatments.length}</Badge>
                </h3>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="gap-2 h-8 text-xs" onClick={exportTreatmentCSV} disabled={filteredTreatments.length === 0}>
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </Button>
                  <Select value={treatmentTypeFilter} onValueChange={(v) => { setTreatmentTypeFilter(v); setTreatmentPage(1); }}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="nhs">NHS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Top 5 + Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left: Top 5 Revenue Leaderboard */}
                <div className="bg-card rounded-lg border border-border p-4">
                  <h4 className="text-base font-semibold mb-3">Revenue Leaderboard</h4>
                  <div className="space-y-3">
                    {filteredTreatments.slice(0, 5).map((t, i) => {
                      const maxRev = filteredTreatments[0]?.revenue || 1;
                      const barPct = (t.revenue / maxRev) * 100;
                      return (
                        <div key={t.treatmentId} className="flex items-center gap-3">
                          <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0',
                            i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-amber-700' : 'bg-muted-foreground/40'
                          )}>{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-medium text-base truncate">{t.name}</span>
                                <Badge variant={t.type === 'nhs' ? 'secondary' : 'outline'} className="text-xs px-1.5 py-0 flex-shrink-0 capitalize">{t.type}</Badge>
                              </div>
                              <span className="font-bold text-base text-primary flex-shrink-0 ml-2">{formatCurrency(t.revenue)}</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full">
                              <div className="h-full bg-cyan-500/70 rounded-full transition-all" style={{ width: `${barPct}%` }} />
                            </div>
                            <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                              <span>{t.count} treatments</span>
                              <span>{formatCurrency(t.avgPrice)}/avg</span>
                              <span className={cn(t.profitLossPerUnit >= 0 ? 'text-green-600' : 'text-red-600')}>
                                {formatCurrency(t.profitLossPerUnit)}/unit P/L
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {filteredTreatments.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center py-6">No treatments found</div>
                    )}
                  </div>

                  {/* By Category breakdown */}
                  {filteredTreatments.length > 0 && (() => {
                    const catStats = new Map<string, { count: number; revenue: number }>();
                    for (const t of filteredTreatments) {
                      const r = catStats.get(t.category) || { count: 0, revenue: 0 };
                      r.count += t.count; r.revenue += t.revenue;
                      catStats.set(t.category, r);
                    }
                    const totalRev = filteredTreatments.reduce((s, t) => s + t.revenue, 0);
                    const cats = [...catStats.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
                    return (
                      <div className="mt-4 space-y-3">
                        <h4 className="text-base font-semibold">Top Categories</h4>
                        {cats.map(([cat, stats]) => {
                          const pct = totalRev > 0 ? (stats.revenue / totalRev) * 100 : 0;
                          return (
                            <div key={cat} className="flex items-center gap-3">
                              <div className="flex-1">
                                <div className="flex justify-between text-sm mb-0.5">
                                  <span className="text-muted-foreground truncate">{cat} <span className="text-xs">({stats.count})</span></span>
                                  <span className="font-medium flex-shrink-0 ml-2">{formatCurrency(stats.revenue)}</span>
                                </div>
                                <div className="h-1.5 bg-muted rounded-full">
                                  <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* Right: Charts */}
                <div className="flex flex-col gap-4">
                  {/* Revenue by Treatment bar chart */}
                  <div className="bg-card rounded-lg border border-border p-4 flex-1 flex flex-col">
                    <h4 className="text-sm font-semibold mb-3">Revenue by Treatment</h4>
                    {filteredTreatments.length > 0 ? (
                      <div className="flex-1 min-h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={filteredTreatments.slice(0, 8).map(t => ({
                              name: t.name.length > 15 ? t.name.slice(0, 15) + '…' : t.name,
                              revenue: t.revenue,
                            }))}
                            margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCompact(v)} />
                            <Tooltip formatter={(value: number) => [formatCurrency(value), 'Revenue']} contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                            <Bar dataKey="revenue" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="flex-1 min-h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
                    )}
                  </div>

                  {/* Profit/Loss by Treatment */}
                  <div className="bg-card rounded-lg border border-border p-4 flex-1 flex flex-col">
                    <h4 className="text-sm font-semibold mb-3">Profit/Loss by Treatment</h4>
                    {filteredTreatments.length > 0 ? (
                      <div className="flex-1 min-h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={filteredTreatments.slice(0, 8).map(t => ({
                              name: t.name.length > 15 ? t.name.slice(0, 15) + '…' : t.name,
                              pl: t.totalPL,
                            }))}
                            margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCompact(v)} />
                            <Tooltip formatter={(value: number) => [formatCurrency(value), 'P/L']} contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                            <Bar dataKey="pl" radius={[4, 4, 0, 0]}>
                              {filteredTreatments.slice(0, 8).map((t, i) => (
                                <Cell key={i} fill={t.totalPL >= 0 ? '#22c55e' : '#ef4444'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="flex-1 min-h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* ── Chair Detail Section ─────────────────────────────── */}
            <div className="rounded-xl border border-border bg-gradient-to-br from-orange-500/5 via-card to-card p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-orange-600 mb-4 flex items-center gap-2">
                <Armchair className="w-4 h-4" /> Chair Utilisation
              </h3>

              {/* KPI tiles */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                {[
                  { label: 'Chairs', value: locationChairMetric?.chairs_count ?? location?.chairs ?? 0, fmt: (v: number) => String(v), color: '' },
                  { label: 'Occupancy', value: locationChairMetric?.occupancy_pct ?? 0, fmt: (v: number) => `${v.toFixed(1)}%`, color: (locationChairMetric?.occupancy_pct ?? 0) >= 70 ? 'text-green-600' : (locationChairMetric?.occupancy_pct ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600' },
                  { label: 'Utilisation', value: locationChairMetric?.utilisation_pct ?? 0, fmt: (v: number) => `${v.toFixed(1)}%`, color: (locationChairMetric?.utilisation_pct ?? 0) >= 70 ? 'text-green-600' : (locationChairMetric?.utilisation_pct ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600' },
                  { label: 'Rev / Chair', value: locationChairMetric?.revenue_per_chair ?? 0, fmt: (v: number) => formatCurrency(v), color: 'text-primary' },
                  { label: 'Completed Hrs', value: locationChairMetric?.completed_hours ?? 0, fmt: (v: number) => `${v.toFixed(1)}h`, color: '' },
                  { label: 'Available Hrs', value: locationChairMetric?.available_hours ?? 0, fmt: (v: number) => `${v.toFixed(0)}h`, color: '' },
                ].map(tile => (
                  <div key={tile.label} className="bg-card rounded-lg border border-border p-4">
                    <div className="text-xs text-muted-foreground mb-1">{tile.label}</div>
                    <div className={cn('text-2xl font-bold', tile.color)}>{tile.fmt(tile.value)}</div>
                  </div>
                ))}
              </div>

              {/* Charts row: Hourly Utilisation + Weekly Pattern */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Hourly Utilisation */}
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <h4 className="text-sm font-semibold mb-3">Hourly Utilisation</h4>
                    {hourlyChairData && hourlyChairData.length > 0 ? (
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={hourlyChairData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="hour_label" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                            <Tooltip
                              formatter={(value: number) => [`${value.toFixed(1)}%`, 'Utilisation']}
                              contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))' }}
                            />
                            <Bar dataKey="utilisation_pct" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">No hourly data available</div>
                    )}
                  </CardContent>
                </Card>

                {/* Weekly Pattern */}
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <h4 className="text-sm font-semibold mb-3">Weekly Pattern</h4>
                    {weeklyChairData && weeklyChairData.length > 0 ? (
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={weeklyChairData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="day_name" tick={{ fontSize: 11 }} tickFormatter={(v) => v.substring(0, 3)} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                            <Tooltip
                              formatter={(value: number, name: string) => [
                                `${value.toFixed(1)}%`,
                                name === 'occupancy_pct' ? 'Occupancy' : 'Utilisation',
                              ]}
                              contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))' }}
                            />
                            <Legend formatter={(value) => value === 'occupancy_pct' ? 'Occupancy' : 'Utilisation'} />
                            <Bar dataKey="occupancy_pct" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                            <Bar dataKey="utilisation_pct" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">No weekly data available</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Peak / Low hours summary */}
              {hourlyChairData && hourlyChairData.length > 0 && (() => {
                const sorted = [...hourlyChairData].sort((a, b) => b.utilisation_pct - a.utilisation_pct);
                const avg = sorted.reduce((s, h) => s + h.utilisation_pct, 0) / sorted.length;
                const peakHours = sorted.filter(h => h.utilisation_pct > avg).slice(0, 3);
                const lowHours = sorted.filter(h => h.utilisation_pct <= avg && h.utilisation_pct > 0).reverse().slice(0, 3);
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <h4 className="text-sm font-semibold text-green-600 mb-2">Peak Hours</h4>
                        <div className="space-y-2">
                          {peakHours.map(h => (
                            <div key={h.hour_slot} className="flex justify-between items-center">
                              <span className="text-sm">{h.hour_label}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-muted rounded-full">
                                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, h.utilisation_pct)}%` }} />
                                </div>
                                <span className="text-sm font-medium w-12 text-right">{h.utilisation_pct.toFixed(1)}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <h4 className="text-sm font-semibold text-amber-600 mb-2">Low Utilisation Hours</h4>
                        <div className="space-y-2">
                          {lowHours.map(h => (
                            <div key={h.hour_slot} className="flex justify-between items-center">
                              <span className="text-sm">{h.hour_label}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-muted rounded-full">
                                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(100, h.utilisation_pct)}%` }} />
                                </div>
                                <span className="text-sm font-medium w-12 text-right">{h.utilisation_pct.toFixed(1)}%</span>
                              </div>
                            </div>
                          ))}
                          {lowHours.length === 0 && <div className="text-sm text-muted-foreground">No low utilisation hours</div>}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                );
              })()}
            </div>

            {/* ── Cost Impact Section ──────────────────────────────── */}
            <div className="rounded-xl border border-border bg-gradient-to-br from-rose-500/5 via-card to-card p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-rose-600 mb-4 flex items-center gap-2">
                <Layers className="w-4 h-4" /> Cost Breakdown
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                {costTiles.map((tile) => {
                  const pct = totalCostFromTiles > 0 ? (tile.value / totalCostFromTiles) * 100 : 0;
                  return (
                    <div key={tile.label} className="bg-card rounded-lg border border-border p-4">
                      <div className="text-xs text-muted-foreground mb-1">{tile.label}</div>
                      <div className="text-xl font-bold">{formatCurrency(tile.value)}</div>
                      <div className="text-xs text-muted-foreground mt-1">{pct.toFixed(1)}% of total</div>
                      <div className="mt-2 h-1.5 bg-muted rounded-full">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: tile.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-card rounded-lg border border-border p-4 text-center">
                  <div className="text-xs text-muted-foreground mb-1">Revenue</div>
                  <div className="text-xl font-bold text-primary">{formatCurrency(summary?.totalRevenue ?? 0)}</div>
                </div>
                <div className="bg-card rounded-lg border border-border p-4 text-center">
                  <div className="text-xs text-muted-foreground mb-1">Total Costs</div>
                  <div className="text-xl font-bold">{formatCurrency(costData?.totalCosts ?? 0)}</div>
                </div>
                <div className="bg-card rounded-lg border border-border p-4 text-center">
                  <div className="text-xs text-muted-foreground mb-1">EBITDA</div>
                  <div className={cn('text-xl font-bold', (summary?.totalRevenue ?? 0) - (costData?.totalCosts ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                    {formatCurrency((summary?.totalRevenue ?? 0) - (costData?.totalCosts ?? 0))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Appointment History Chart ─────────────────────────── */}
            {monthlyTrend.length > 0 && (
              <div className="rounded-xl border border-border bg-gradient-to-br from-teal-500/5 via-card to-card p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-teal-600 mb-4 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> Appointment History
                </h3>
                <div className="bg-card rounded-lg border border-border p-4">
                  <h4 className="text-sm font-medium text-muted-foreground mb-4">Appointment Status Breakdown</h4>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={monthlyTrend} margin={{ left: 0, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="completed" name="Completed" stackId="a" fill={STATUS_COLORS.completed} radius={[0, 0, 0, 0]} />
                        <Bar dataKey="cancelled" name="Cancelled" stackId="a" fill={STATUS_COLORS.cancelled} radius={[0, 0, 0, 0]} />
                        <Bar dataKey="dna" name="DNA" stackId="a" fill={STATUS_COLORS.dna} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
}
