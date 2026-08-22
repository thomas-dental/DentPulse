import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { useTreatmentCategories } from '@/hooks/useTreatmentCategories';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';
import { Treatment } from '@/types/treatment';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationEllipsis,
} from '@/components/ui/pagination';
import { Loader2, Search, Settings, Filter, ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { ConfigProvider, DatePicker } from 'antd';
import dayjs, { Dayjs } from 'dayjs';

// ─── Types ───────────────────────────────────────────────────
interface TreatmentProfitabilityTabProps {
  treatment: Treatment;
}

interface MonthlyRow {
  month: string;
  category: string;
  treatmentName: string;
  avgIncome: number;
  materialCost: number;
  labBill: number;
  therapistPayRate: number;
  opCostPerTreatment: number;
  associatePay: number;
  financeFee: number;
  expensePerUnit: number;
  profitLossPerUnit: number;
  noItems: number;
  totalIncome: number;
  totalExpense: number;
  totalPL: number;
  principalProfit: number;
  plPercent: number;
  principalProfitPercent: number;
}

// ─── Column definition ──────────────────────────────────────
type ColumnKey =
  | 'date'
  | 'category'
  | 'treatmentName'
  | 'avgIncome'
  | 'materialCost'
  | 'labBill'
  | 'therapistPayRate'
  | 'opCostPerTreatment'
  | 'associatePay'
  | 'financeFee'
  | 'expensePerUnit'
  | 'profitLossPerUnit'
  | 'noItems'
  | 'totalIncome'
  | 'totalExpense'
  | 'totalPL'
  | 'principalProfit'
  | 'plPercent'
  | 'principalProfitPercent';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  group: 'none' | 'perUnit' | 'total';
  defaultVisible: boolean;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'date', label: 'Date', group: 'none', defaultVisible: true },
  { key: 'category', label: 'Category', group: 'none', defaultVisible: false },
  { key: 'treatmentName', label: 'Treatment Name', group: 'none', defaultVisible: true },
  { key: 'avgIncome', label: 'Average Income', group: 'perUnit', defaultVisible: true },
  { key: 'materialCost', label: 'Material Cost', group: 'perUnit', defaultVisible: false },
  { key: 'labBill', label: 'Lab Bill', group: 'perUnit', defaultVisible: false },
  { key: 'therapistPayRate', label: 'Therapist Pay Rate', group: 'perUnit', defaultVisible: false },
  { key: 'opCostPerTreatment', label: 'OP. Cost / Treatment', group: 'perUnit', defaultVisible: true },
  { key: 'associatePay', label: 'Associate Pay', group: 'perUnit', defaultVisible: true },
  { key: 'financeFee', label: 'Finance Fee', group: 'perUnit', defaultVisible: true },
  { key: 'expensePerUnit', label: 'Expense / Unit', group: 'perUnit', defaultVisible: true },
  { key: 'profitLossPerUnit', label: 'Profit/Loss / Unit', group: 'perUnit', defaultVisible: true },
  { key: 'noItems', label: 'No Appointments', group: 'none', defaultVisible: true },
  { key: 'totalIncome', label: 'Total Income', group: 'total', defaultVisible: true },
  { key: 'totalExpense', label: 'Total Expense', group: 'total', defaultVisible: true },
  { key: 'totalPL', label: 'Total P/L', group: 'total', defaultVisible: true },
  { key: 'principalProfit', label: 'Principal Profit', group: 'total', defaultVisible: true },
  { key: 'plPercent', label: 'P/L %', group: 'total', defaultVisible: true },
  { key: 'principalProfitPercent', label: 'Principal Profit %', group: 'total', defaultVisible: true },
];

const DEFAULT_VISIBLE = new Set<ColumnKey>(
  ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
);

// ─── Helpers ─────────────────────────────────────────────────
const fmtCurrency = (v: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);

const fmtPercent = (v: number) => (isFinite(v) ? `${v.toFixed(0)}%` : '0%');

const fmtMonth = (key: string) => {
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
  });
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

// ─── Component ───────────────────────────────────────────────
export function TreatmentProfitabilityTab({
  treatment,
}: TreatmentProfitabilityTabProps) {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();
  const { allAvailableLocations } = useLocations();
  const { categories } = useTreatmentCategories();

  // ── Derive which location IDs to filter by ──
  const targetLocationIds = useMemo(() => {
    if (selectedLocationId) return [selectedLocationId];
    if (selectedRegionId) {
      return allAvailableLocations
        .filter((l: any) => l.region_id === selectedRegionId)
        .map((l: any) => l.id);
    }
    return null; // null = show all locations
  }, [selectedLocationId, selectedRegionId, allAvailableLocations]);

  // ── local toolbar state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    () => new Set(DEFAULT_VISIBLE),
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterDateRange, setFilterDateRange] = useState<[Dayjs | null, Dayjs | null]>([
    dateRange.startDate ? dayjs(dateRange.startDate) : null,
    dateRange.endDate ? dayjs(dateRange.endDate) : null,
  ]);
  const [filterCategory, setFilterCategory] = useState<string[]>([]);
  const [appliedFilter, setAppliedFilter] = useState<{
    from: string;
    to: string;
    categories: string[];
  } | null>(null);

  // ── data fetch ──
  // tpi_treatment_id is BIGINT and stores Dentally's numeric treatment_id, which matches
  // treatments.external_id. Manually-created treatments without an external_id can't link
  // to any TPI and will show no data.
  const { data: tpiData = [], isLoading: isLoadingTPI, error: tpiError } = useQuery({
    queryKey: [
      'treatment-profitability',
      treatment.external_id,
      organizationId,
      dateRange.startDate?.toISOString(),
      dateRange.endDate?.toISOString(),
      appliedFilter,
    ],
    queryFn: async () => {
      if (!organizationId || treatment.external_id == null) return [];

      // Fall back to London day-boundary instants of the global filter —
      // viewer-independent, unlike toISOString() on local Dates. An explicit
      // appliedFilter keeps its own (already-ISO) bounds.
      const from =
        appliedFilter?.from || (dateRange.startDate ? ukDayStartInstant(dateRange.startDate) : '');
      const to =
        appliedFilter?.to || (dateRange.endDate ? ukDayEndInstant(dateRange.endDate) : '');

      // NOTE: Do NOT filter by location_id/region_id — these fields are often null on TPIs.
      const PAGE_SIZE = 1000;
      const allTpis: any[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        let query = (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_price, tpi_completed_at, tpi_treatment_id, tpi_practitioner_id, tpi_treatment_appointment_id, tpi_treatment_plan_id, tpi_patient_id, tpi_invoice_id, location_id')
          .eq('organization_id', organizationId)
          .eq('tpi_treatment_id', treatment.external_id)
          .eq('tpi_completed', true)
          .not('tpi_invoice_id', 'is', null)
          .not('tpi_completed_at', 'is', null)
          .is('deleted_at', null);

        if (from) query = query.gte('tpi_completed_at', from);
        if (to) query = query.lte('tpi_completed_at', to);

        const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data ?? [];
        allTpis.push(...rows);
        hasMore = rows.length === PAGE_SIZE;
        offset += PAGE_SIZE;
      }
      return allTpis;
    },
    enabled: !!organizationId && treatment.external_id != null,
  });

  // ── Resolve TPI location via practitioner ──
  // The Dentally API does NOT return site_id on treatment_plan_items, so TPI.location_id
  // is always NULL. The correct way to determine a TPI's location is through its
  // practitioner: TPI.tpi_practitioner_id → providers.external_id → providers.location_id.
  const { data: practitionerLocationMap = new Map<number, string>(), isFetching: isFetchingPractLoc } = useQuery({
    queryKey: ['treatment-prof-practitioner-location', organizationId],
    queryFn: async () => {
      if (!organizationId) return new Map<number, string>();

      const map = new Map<number, string>();
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from('providers')
          .select('external_id, location_id')
          .eq('organization_id', organizationId)
          .not('external_id', 'is', null)
          .not('location_id', 'is', null)
          .is('deleted_at', null)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error('[TreatmentProf] Error fetching providers:', error);
          break;
        }
        const rows = data ?? [];
        for (const p of rows) {
          if (p.external_id != null && p.location_id) {
            const extId = typeof p.external_id === 'number' ? p.external_id : Number(p.external_id);
            if (!isNaN(extId)) map.set(extId, p.location_id);
          }
        }
        hasMore = rows.length === PAGE_SIZE;
        offset += PAGE_SIZE;
      }
      return map;
    },
    enabled: !!organizationId,
  });

  // ── Paid invoice IDs ──
  // tpi_charged only means "invoiced", not "paid". Cross-reference with invoices to get truly paid items.
  const { data: paidInvoiceIds = new Set<string>(), isFetching: isFetchingPaidInv } = useQuery({
    queryKey: ['treatment-prof-paid-invoices', organizationId],
    queryFn: async () => {
      if (!organizationId) return new Set<string>();
      const ids = new Set<string>();
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from('platform_integration_invoices')
          .select('platform_invoice_id')
          .eq('organization_id', organizationId)
          .eq('is_paid', true)
          .is('deleted_at', null)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) {
          console.error('[TreatmentProf] Error fetching paid invoices:', error);
          break;
        }
        const rows = data ?? [];
        for (const inv of rows) {
          if (inv.platform_invoice_id) ids.add(inv.platform_invoice_id);
        }
        hasMore = rows.length === PAGE_SIZE;
        offset += PAGE_SIZE;
      }
      return ids;
    },
    enabled: !!organizationId,
  });

  // ── calculate rows ──
  const allRows: MonthlyRow[] = useMemo(() => {
    if (!tpiData.length) return [];

    const locationSet = targetLocationIds ? new Set(targetLocationIds) : null;

    const grouped: Record<string, { totalPrice: number; count: number }> = {};
    tpiData.forEach((tpi: any) => {
      // ── Only include TPIs whose invoice is actually paid ──
      if (tpi.tpi_invoice_id != null && !paidInvoiceIds.has(String(tpi.tpi_invoice_id))) {
        return;
      }

      // ── Location filter (practitioner-based) ──
      if (locationSet) {
        let matched = false;

        // Primary: Practitioner's location matches selected location
        if (tpi.tpi_practitioner_id != null) {
          const practId = typeof tpi.tpi_practitioner_id === 'number'
            ? tpi.tpi_practitioner_id : Number(tpi.tpi_practitioner_id);
          if (!isNaN(practId)) {
            const practLoc = practitionerLocationMap.get(practId);
            if (practLoc && locationSet.has(practLoc)) {
              matched = true;
            }
          }
        }

        // Fallback: Direct location_id on TPI (if ever populated in future)
        if (!matched && tpi.location_id && locationSet.has(tpi.location_id)) {
          matched = true;
        }

        if (!matched) return;
      }

      const d = new Date(tpi.tpi_completed_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[key]) grouped[key] = { totalPrice: 0, count: 0 };
      grouped[key].totalPrice += tpi.tpi_price || 0;
      grouped[key].count += 1;
    });

    const mat = treatment.material_cost || 0;
    const lab = treatment.lab_bill || 0;
    const thr = treatment.therapist_pay_rate || 0;
    const opCost = (treatment.hourly_rate || 0) * ((treatment.duration_minutes || 0) / 60);
    const pctFees = treatment.percent_fees || 0;
    const finPct = treatment.finance_fee || 0;
    const catName = treatment.category?.name || '-';

    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, { totalPrice, count }]) => {
        const avg = count > 0 ? totalPrice / count : 0;
        const assocPay = avg * (pctFees / 100);
        const finFee = avg * (finPct / 100);
        const expUnit = mat + lab + thr + opCost + assocPay + finFee;
        const plUnit = avg - expUnit;
        const totInc = totalPrice;
        const totExp = expUnit * count;
        const totPL = totInc - totExp;
        const plPct = totInc !== 0 ? (totPL / totInc) * 100 : 0;
        // Principal Profit = Total Income - Total Associate Pay
        const princProfit = totInc - assocPay * count;
        const princPct = totInc !== 0 ? (princProfit / totInc) * 100 : 0;

        return {
          month: monthKey,
          category: catName,
          treatmentName: treatment.treatment_name,
          avgIncome: avg,
          materialCost: mat,
          labBill: lab,
          therapistPayRate: thr,
          opCostPerTreatment: opCost,
          associatePay: assocPay,
          financeFee: finFee,
          expensePerUnit: expUnit,
          profitLossPerUnit: plUnit,
          noItems: count,
          totalIncome: totInc,
          totalExpense: totExp,
          totalPL: totPL,
          principalProfit: princProfit,
          plPercent: plPct,
          principalProfitPercent: princPct,
        };
      });
  }, [tpiData, treatment, targetLocationIds, practitionerLocationMap, paidInvoiceIds]);

  // ── search filter ──
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return allRows;
    const q = searchQuery.toLowerCase();
    return allRows.filter(
      (r) =>
        r.treatmentName.toLowerCase().includes(q) ||
        fmtMonth(r.month).toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  }, [allRows, searchQuery]);

  // ── category filter ──
  const categoryFilteredRows = useMemo(() => {
    if (!appliedFilter?.categories?.length) return filteredRows;
    const selected = appliedFilter.categories.map((c) => c.toLowerCase());
    return filteredRows.filter((r) => selected.includes(r.category.toLowerCase()));
  }, [filteredRows, appliedFilter]);

  // ── pagination ──
  const totalPages = Math.max(1, Math.ceil(categoryFilteredRows.length / pageSize));
  const paginatedRows = categoryFilteredRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  // ── totals ──
  const totals = useMemo(() => {
    const src = categoryFilteredRows;
    const n = src.reduce((s, r) => s + r.noItems, 0);
    const ti = src.reduce((s, r) => s + r.totalIncome, 0);
    const te = src.reduce((s, r) => s + r.totalExpense, 0);
    const tp = ti - te;
    const pp = src.reduce((s, r) => s + r.principalProfit, 0);
    const avg = n > 0 ? ti / n : 0;
    const mat = src[0]?.materialCost || 0;
    const lab = src[0]?.labBill || 0;
    const thr = src[0]?.therapistPayRate || 0;
    const op = src[0]?.opCostPerTreatment || 0;
    const ap = avg * ((treatment.percent_fees || 0) / 100);
    const ff = avg * ((treatment.finance_fee || 0) / 100);
    const eu = mat + lab + thr + op + ap + ff;

    return {
      avgIncome: avg,
      materialCost: mat,
      labBill: lab,
      therapistPayRate: thr,
      opCostPerTreatment: op,
      associatePay: ap,
      financeFee: ff,
      expensePerUnit: eu,
      profitLossPerUnit: avg - eu,
      noItems: n,
      totalIncome: ti,
      totalExpense: te,
      totalPL: tp,
      principalProfit: pp,
      plPercent: ti !== 0 ? (tp / ti) * 100 : 0,
      principalProfitPercent: ti !== 0 ? (pp / ti) * 100 : 0,
    };
  }, [categoryFilteredRows, treatment]);

  const isLocationResolving = !!targetLocationIds && isFetchingPractLoc;
  const isLoading = isLoadingTPI || isLocationResolving || isFetchingPaidInv;

  // ── column visibility helpers ──
  const toggleCol = (key: ColumnKey) =>
    setVisibleCols((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const isVisible = (key: ColumnKey) => visibleCols.has(key);

  // count visible columns per group for colSpan
  const visiblePerUnit = ALL_COLUMNS.filter(
    (c) => c.group === 'perUnit' && visibleCols.has(c.key),
  ).length;
  const visibleTotal = ALL_COLUMNS.filter(
    (c) => c.group === 'total' && visibleCols.has(c.key),
  ).length;
  const visibleNone = ALL_COLUMNS.filter(
    (c) => c.group === 'none' && visibleCols.has(c.key),
  ).length;
  const visibleNoItems = visibleCols.has('noItems') ? 1 : 0;
  const totalVisibleCols =
    visibleNone + visiblePerUnit + visibleNoItems + visibleTotal;

  // ── cell renderer ──
  const cellValue = (
    row: MonthlyRow | typeof totals,
    key: ColumnKey,
    isTotal = false,
  ) => {
    switch (key) {
      case 'date':
        return isTotal ? 'Total' : fmtMonth((row as MonthlyRow).month);
      case 'category':
        return isTotal ? '' : (row as MonthlyRow).category;
      case 'treatmentName':
        return isTotal ? '' : (row as MonthlyRow).treatmentName;
      case 'avgIncome':
        return fmtCurrency(row.avgIncome);
      case 'materialCost':
        return fmtCurrency(row.materialCost);
      case 'labBill':
        return fmtCurrency(row.labBill);
      case 'therapistPayRate':
        return fmtCurrency(row.therapistPayRate);
      case 'opCostPerTreatment':
        return fmtCurrency(row.opCostPerTreatment);
      case 'associatePay':
        return fmtCurrency(row.associatePay);
      case 'financeFee':
        return fmtCurrency(row.financeFee);
      case 'expensePerUnit':
        return fmtCurrency(row.expensePerUnit);
      case 'profitLossPerUnit':
        return fmtCurrency(row.profitLossPerUnit);
      case 'noItems':
        return row.noItems;
      case 'totalIncome':
        return fmtCurrency(row.totalIncome);
      case 'totalExpense':
        return fmtCurrency(row.totalExpense);
      case 'totalPL':
        return fmtCurrency(row.totalPL);
      case 'principalProfit':
        return fmtCurrency(row.principalProfit);
      case 'plPercent':
        return fmtPercent(row.plPercent);
      case 'principalProfitPercent':
        return fmtPercent(row.principalProfitPercent);
      default:
        return '';
    }
  };

  const isRightAlign = (key: ColumnKey) =>
    key !== 'date' && key !== 'category' && key !== 'treatmentName';

  // ── filter handlers ──
  const handleApplyFilter = () => {
    setAppliedFilter({
      from: filterDateRange[0] ? filterDateRange[0].startOf('day').toISOString() : '',
      to: filterDateRange[1] ? filterDateRange[1].endOf('day').toISOString() : '',
      categories: filterCategory,
    });
    setCurrentPage(1);
    setIsFilterOpen(false);
  };

  const handleResetFilter = () => {
    setFilterDateRange([
      dateRange.startDate ? dayjs(dateRange.startDate) : null,
      dateRange.endDate ? dayjs(dateRange.endDate) : null,
    ]);
    setFilterCategory([]);
    setAppliedFilter(null);
    setCurrentPage(1);
  };

  // ── pagination helpers ──
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('e1');
      const s = Math.max(2, currentPage - 1);
      const e = Math.min(totalPages - 1, currentPage + 1);
      for (let i = s; i <= e; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('e2');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profitability By Treatments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
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

          {/* Page Size */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              Page Size
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-[70px]">
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

          {/* Edit Columns (gear) */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px]" align="end">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold">Edit Columns</h4>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {ALL_COLUMNS.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={visibleCols.has(col.key)}
                      onCheckedChange={() => toggleCol(col.key)}
                    />
                    <span className="text-sm">{col.label}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Filters button */}
          <Button
            onClick={() => setIsFilterOpen(true)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filters
          </Button>
        </div>

        {/* ── Filter Dialog ── */}
        <Dialog open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <DialogContent className="sm:max-w-[650px]">
            <DialogHeader>
              <DialogTitle>Filter Options</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col sm:flex-row gap-4 py-4">
              <div className="flex-[3]">
                <Label className="text-sm text-muted-foreground">
                  Enter a date range
                </Label>
                <ConfigProvider
                  theme={{
                    token: {
                      colorPrimary: 'hsl(246, 79%, 62%)',
                      borderRadius: 8,
                    },
                  }}
                >
                  <DatePicker.RangePicker
                    value={filterDateRange}
                    onChange={(dates) =>
                      setFilterDateRange(dates || [null, null])
                    }
                    format="DD-MM-YYYY"
                    className="w-full mt-1 h-10"
                    allowClear
                  />
                </ConfigProvider>
              </div>
              <div className="flex-[2]">
                <Label className="text-sm text-muted-foreground">
                  Category
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full mt-1 h-10 justify-between font-normal"
                    >
                      <span className="truncate">
                        {filterCategory.length === 0
                          ? 'Select Categories'
                          : filterCategory.length <= 2
                            ? filterCategory.join(', ')
                            : `${filterCategory.length} categories selected`}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[250px] p-2 max-h-[250px] overflow-y-auto">
                    {categories.map((cat) => (
                      <label
                        key={cat.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      >
                        <Checkbox
                          checked={filterCategory.includes(cat.name)}
                          onCheckedChange={() =>
                            setFilterCategory((prev) =>
                              prev.includes(cat.name)
                                ? prev.filter((c) => c !== cat.name)
                                : [...prev, cat.name],
                            )
                          }
                        />
                        <span className="text-sm">{cat.name}</span>
                      </label>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleApplyFilter} className="gap-2">
                <Search className="h-4 w-4" />
                Search
              </Button>
              <Button
                variant="outline"
                onClick={handleResetFilter}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Table ── */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-muted-foreground">
              Loading profitability data...
            </p>
          </div>
        ) : (
          <>
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  {/* Group header pills */}
                  <TableRow className="border-b-0">
                    {/* ungrouped cols placeholder */}
                    {visibleNone > 0 && (
                      <TableHead
                        colSpan={visibleNone}
                        className="bg-transparent border-b-0"
                      />
                    )}
                    {/* PER UNIT pill */}
                    {visiblePerUnit > 0 && (
                      <TableHead
                        colSpan={visiblePerUnit}
                        className="p-1 pb-0 border-b-0 bg-transparent"
                      >
                        <div className="bg-primary/15 text-primary font-bold text-xs tracking-wider text-center py-2 px-4 rounded-t-full uppercase">
                          PER UNIT PROFIT/LOSS
                        </div>
                      </TableHead>
                    )}
                    {/* No Items placeholder */}
                    {visibleNoItems > 0 && (
                      <TableHead className="bg-transparent border-b-0" />
                    )}
                    {/* TOTAL pill */}
                    {visibleTotal > 0 && (
                      <TableHead
                        colSpan={visibleTotal}
                        className="p-1 pb-0 border-b-0 bg-transparent"
                      >
                        <div className="bg-primary text-white font-bold text-xs tracking-wider text-center py-2 px-4 rounded-t-full uppercase">
                          TOTAL PROFIT/LOSS
                        </div>
                      </TableHead>
                    )}
                  </TableRow>

                  {/* Column headers */}
                  <TableRow>
                    {ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map(
                      (col) => {
                        let bg = '';
                        if (col.group === 'perUnit') bg = 'bg-primary/5';
                        if (col.group === 'total') bg = 'bg-primary/10';
                        return (
                          <TableHead
                            key={col.key}
                            className={`whitespace-nowrap ${isRightAlign(col.key) ? 'text-right' : ''} ${bg}`}
                          >
                            {col.label}
                          </TableHead>
                        );
                      },
                    )}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {paginatedRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={totalVisibleCols}
                        className="text-center text-muted-foreground py-8"
                      >
                        {treatment.external_id == null
                          ? 'This treatment was not synced from Dentally — no profitability data available.'
                          : tpiError
                            ? `Failed to load: ${(tpiError as Error).message}`
                            : 'No Data'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedRows.map((row) => (
                      <TableRow key={row.month}>
                        {ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map(
                          (col) => (
                            <TableCell
                              key={col.key}
                              className={`whitespace-nowrap ${isRightAlign(col.key) ? 'text-right' : ''}`}
                            >
                              {cellValue(row, col.key)}
                            </TableCell>
                          ),
                        )}
                      </TableRow>
                    ))
                  )}

                  {/* Totals row */}
                  <TableRow className="font-semibold border-t-2">
                    {ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map(
                      (col) => (
                        <TableCell
                          key={col.key}
                          className={`whitespace-nowrap ${isRightAlign(col.key) ? 'text-right' : ''}`}
                        >
                          {cellValue(totals, col.key, true)}
                        </TableCell>
                      ),
                    )}
                  </TableRow>
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
                      onClick={() =>
                        setCurrentPage((p) => Math.max(1, p - 1))
                      }
                      disabled={currentPage === 1}
                      className="gap-1 pl-2.5"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>Previous</span>
                    </Button>
                  </PaginationItem>
                  {getPageNumbers().map((page, i) =>
                    typeof page === 'string' ? (
                      <PaginationItem key={page}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={page}>
                        <Button
                          variant={
                            currentPage === page ? 'outline' : 'ghost'
                          }
                          size="icon"
                          onClick={() => setCurrentPage(page)}
                          className="h-9 w-9"
                        >
                          {page}
                        </Button>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() =>
                        setCurrentPage((p) =>
                          Math.min(totalPages, p + 1),
                        )
                      }
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
  );
}
