import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { useTreatmentCategories } from '@/hooks/useTreatmentCategories';
import { useTreatments } from '@/hooks/useTreatments';
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
import {
  Loader2,
  Search,
  Settings,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  RotateCcw,
  Download,
  CalendarDays,
} from 'lucide-react';
import { ConfigProvider, DatePicker } from 'antd';
import dayjs, { Dayjs } from 'dayjs';

// ─── Types ───────────────────────────────────────────────────
interface ProfitabilityRow {
  key: string; // unique row key (treatmentId-month)
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
  { key: 'treatmentName', label: 'Treatment Name', group: 'none', defaultVisible: true },
  { key: 'category', label: 'Category', group: 'none', defaultVisible: true },
  { key: 'avgIncome', label: 'Average Income', group: 'perUnit', defaultVisible: true },
  { key: 'materialCost', label: 'Material Cost', group: 'perUnit', defaultVisible: true },
  { key: 'labBill', label: 'Lab Bill', group: 'perUnit', defaultVisible: true },
  { key: 'therapistPayRate', label: 'Therapist Pay Rate', group: 'perUnit', defaultVisible: true },
  { key: 'opCostPerTreatment', label: 'OP. Cost / Treatment', group: 'perUnit', defaultVisible: true },
  { key: 'associatePay', label: 'Associate Pay', group: 'perUnit', defaultVisible: true },
  { key: 'financeFee', label: 'Finance Fee', group: 'perUnit', defaultVisible: true },
  { key: 'expensePerUnit', label: 'Expense / Unit', group: 'perUnit', defaultVisible: true },
  { key: 'profitLossPerUnit', label: 'Profit/Loss / Unit', group: 'perUnit', defaultVisible: true },
  { key: 'noItems', label: 'No. of Treatments', group: 'none', defaultVisible: true },
  { key: 'totalIncome', label: 'Total Income', group: 'total', defaultVisible: true },
  { key: 'totalExpense', label: 'Total Expense', group: 'total', defaultVisible: true },
  { key: 'totalPL', label: 'Total P/L', group: 'total', defaultVisible: true },
  { key: 'principalProfit', label: 'Principal Profit', group: 'total', defaultVisible: false },
  { key: 'plPercent', label: 'P/L %', group: 'total', defaultVisible: false },
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

const fmtCurrency2 = (v: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);

const fmtPercent = (v: number) => (isFinite(v) ? `${v.toFixed(0)}%` : '0%');

const fmtMonth = (key: string) => {
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
  });
};

const fmtDateDMY = (key: string) => {
  const [y, m] = key.split('-');
  const d = new Date(+y, +m - 1);
  const lastDay = new Date(+y, +m, 0).getDate();
  return `${String(lastDay).padStart(2, '0')}-${String(+m).padStart(2, '0')}-${y}`;
};

// ─── Component ───────────────────────────────────────────────
export interface TreatmentProfitabilitySnapshot {
  rows: ProfitabilityRow[];
  totals: {
    noItems: number;
    totalIncome: number;
    totalExpense: number;
    totalProfit: number;
  };
  period: { from: string | null; to: string | null } | null;
}

interface AllTreatmentsProfitabilityTabProps {
  standalone?: boolean;
  externalFilterOpen?: boolean;
  onExternalFilterClose?: () => void;
  /** Called whenever the visible/filtered dataset changes. Lets parents (e.g. the page) expose the dataset to the AI chatbot via aiContext. */
  onDataChange?: (snapshot: TreatmentProfitabilitySnapshot) => void;
}

export function AllTreatmentsProfitabilityTab({ standalone = false, externalFilterOpen, onExternalFilterClose, onDataChange }: AllTreatmentsProfitabilityTabProps) {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId, selectedRegionId, selectedDateRangeId } = useFilters();
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
  const [sortColumn, setSortColumn] = useState<ColumnKey | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const STORAGE_KEY = standalone
    ? 'dentpulse_profitability_cols_standalone'
    : 'dentpulse_profitability_cols';

  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    () => {
      // Try to restore from localStorage
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as string[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return new Set<ColumnKey>(parsed as ColumnKey[]);
          }
        }
      } catch {
        // ignore parse errors
      }
      if (standalone) {
        return new Set<ColumnKey>([
          'treatmentName',
          'avgIncome', 'materialCost', 'labBill', 'therapistPayRate',
          'opCostPerTreatment', 'associatePay', 'financeFee',
          'expensePerUnit', 'profitLossPerUnit', 'noItems',
        ]);
      }
      return new Set(DEFAULT_VISIBLE);
    },
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

  // Sync local date range picker when global date filter changes (e.g. "Last Month")
  // Depends on selectedDateRangeId + dateRange object ref (from useMemo in FilterContext)
  useEffect(() => {
    setFilterDateRange([
      dateRange.startDate ? dayjs(dateRange.startDate) : null,
      dateRange.endDate ? dayjs(dateRange.endDate) : null,
    ]);
    // Clear applied filter so the RPC uses the new global date range
    setAppliedFilter(null);
  }, [selectedDateRangeId, dateRange]);

  // Sync external filter open state (standalone mode)
  useEffect(() => {
    if (externalFilterOpen) setIsFilterOpen(true);
  }, [externalFilterOpen]);

  const handleFilterClose = (open: boolean) => {
    setIsFilterOpen(open);
    if (!open && onExternalFilterClose) onExternalFilterClose();
  };

  // ── Fetch treatments (scoped to selected location — same behaviour as Treatment Setup) ──
  // When a specific location is selected, this resolves the location to its Dentally
  // integration_id and returns only treatments synced under that integration. Locations
  // sharing a Dentally API key share the same treatment catalog. With no location
  // selected ("All Regions"), the full org catalog is returned.
  const { treatments, isLoading: isLoadingTreatments } = useTreatments({
    locationId: selectedLocationId,
  });

  // ── Build treatment lookup maps (external_id → treatment AND uuid id → treatment) ──
  const { treatmentByExtId, treatmentById } = useMemo(() => {
    const byExt = new Map<number, any>();
    const byId = new Map<string, any>();
    treatments.forEach((t: any) => {
      if (t.id) byId.set(t.id, t);
      if (t.external_id != null) {
        const extId = typeof t.external_id === 'number' ? t.external_id : Number(t.external_id);
        if (!isNaN(extId)) byExt.set(extId, t);
      }
    });
    return { treatmentByExtId: byExt, treatmentById: byId };
  }, [treatments]);

  // ── Helper: convert Date to YYYY-MM-DD (local, no timezone shift) ──
  const toDateStr = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // ── Invoice line item data via RPC (matches Dentally Income Report) ──
  // Uses security definer RPC to bypass RLS issues on invoice line items table.
  // SQL: paid invoices (is_paid=true) by paid_date → join line items → resolve to treatments
  interface TpiRow {
    tpiPrice: number;
    treatmentUUID: string | null;
    treatmentName: string; // from RPC (treatment_name or invoice item_name fallback)
    categoryName: string;
    paidMonth: string; // YYYY-MM (from paid_date)
    practitionerId: number | null;
    // Cost fields from RPC (used when no treatment match)
    materialCost: number;
    labBill: number;
    therapistPayRate: number;
    percentFees: number;
    financeFee: number;
    hourlyRate: number;
    durationMinutes: number;
  }

  // Compute effective date range: appliedFilter overrides global dateRange only for category filtering
  // Date always comes from the global top bar filter to avoid stale appliedFilter race condition
  const effectiveFromDate = dateRange.startDate ? toDateStr(dateRange.startDate) : '';
  const effectiveToDate = dateRange.endDate ? toDateStr(dateRange.endDate) : '';

  const { data: tpiData = [] as TpiRow[], isLoading: isLoadingTpiData } = useQuery({
    queryKey: [
      'all-treatments-profitability-invoice-items',
      organizationId,
      effectiveFromDate,
      effectiveToDate,
      targetLocationIds?.join(',') ?? 'all',
    ],
    queryFn: async (): Promise<TpiRow[]> => {
      if (!organizationId) return [];
      if (!effectiveFromDate || !effectiveToDate) return [];

      // Single location ID for the RPC (null = all locations)
      const locationId = targetLocationIds && targetLocationIds.length === 1
        ? targetLocationIds[0]
        : null;

      const rpcParams = {
        p_organization_id: organizationId,
        p_from_date: effectiveFromDate,
        p_to_date: effectiveToDate,
        p_location_id: locationId,
      };
      console.log('[Profitability] RPC params:', JSON.stringify(rpcParams));

      const { data, error } = await (supabase as any).rpc('get_profitability_invoice_items', rpcParams);

      if (error) {
        console.error('[Profitability] RPC error:', error);
        return [];
      }

      const rows = (data ?? []) as Array<{
        treatment_id: string | null;
        treatment_name: string;
        treatment_code: string;
        category_name: string;
        paid_month: string;
        no_of_treatments: number;
        total_revenue: number;
        material_cost: number;
        lab_bill: number;
        therapist_pay_rate: number;
        percent_fees: number;
        finance_fee: number;
        hourly_rate: number;
        duration_minutes: number;
      }>;

      console.log(`[Profitability] RPC returned ${rows.length} grouped rows`, rows.length > 0 ? rows.slice(0, 3) : 'EMPTY');

      // Expand grouped rows into individual TpiRow entries for the existing calculation pipeline
      const result: TpiRow[] = [];
      for (const row of rows) {
        const count = Number(row.no_of_treatments) || 0;
        const totalRev = Number(row.total_revenue) || 0;
        const avgPrice = count > 0 ? totalRev / count : 0;

        for (let i = 0; i < count; i++) {
          result.push({
            tpiPrice: avgPrice,
            treatmentUUID: row.treatment_id,
            treatmentName: row.treatment_name,
            categoryName: row.category_name || '-',
            paidMonth: row.paid_month,
            practitionerId: null,
            materialCost: Number(row.material_cost) || 0,
            labBill: Number(row.lab_bill) || 0,
            therapistPayRate: Number(row.therapist_pay_rate) || 0,
            percentFees: Number(row.percent_fees) || 0,
            financeFee: Number(row.finance_fee) || 0,
            hourlyRate: Number(row.hourly_rate) || 0,
            durationMinutes: Number(row.duration_minutes) || 0,
          });
        }
      }

      console.log(`[Profitability] Expanded to ${result.length} items`);
      return result;
    },
    enabled: !!organizationId,
  });

  // ── Calculate rows from invoice line items (matches Dentally Income Report) ──
  const hasActiveFilter = !!(appliedFilter?.categories?.length);

  const allRows: ProfitabilityRow[] = useMemo(() => {
    if (treatments.length === 0) return [];

    // Group invoice line items by treatment key + paid month
    // Use treatmentUUID when available, otherwise use treatmentName as key
    const grouped: Record<
      string,
      { totalPrice: number; count: number; treatmentUUID: string | null; treatmentName: string; categoryName: string; materialCost: number; labBill: number; therapistPayRate: number; percentFees: number; financeFee: number; hourlyRate: number; durationMinutes: number }
    > = {};

    for (const tpi of tpiData) {
      const groupKey = tpi.treatmentUUID || `name:${tpi.treatmentName}`;
      const key = groupKey;
      if (!grouped[key])
        grouped[key] = { totalPrice: 0, count: 0, treatmentUUID: tpi.treatmentUUID, treatmentName: tpi.treatmentName, categoryName: tpi.categoryName, materialCost: tpi.materialCost, labBill: tpi.labBill, therapistPayRate: tpi.therapistPayRate, percentFees: tpi.percentFees, financeFee: tpi.financeFee, hourlyRate: tpi.hourlyRate, durationMinutes: tpi.durationMinutes };
      grouped[key].totalPrice += tpi.tpiPrice;
      grouped[key].count += 1;
    }

    // Track which treatments have data
    const treatmentsWithData = new Set<string>();

    // Build rows
    const dataRows: ProfitabilityRow[] = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([compositeKey, g]) => {
        const { totalPrice, count, treatmentUUID } = g;
        // Use treatment from DB when matched, otherwise use RPC-provided data
        const t = treatmentUUID ? treatmentById.get(treatmentUUID) : null;

        if (t) treatmentsWithData.add(t.id);

        const mat = t ? (t.material_cost || 0) : g.materialCost;
        const lab = t ? (t.lab_bill || 0) : g.labBill;
        const thr = t ? (t.therapist_pay_rate || 0) : g.therapistPayRate;
        const opCost = t
          ? (t.hourly_rate || 0) * ((t.duration_minutes || 0) / 60)
          : g.hourlyRate * (g.durationMinutes / 60);
        const pctFees = t ? (t.percent_fees || 0) : g.percentFees;
        const finPct = t ? (t.finance_fee || 0) : g.financeFee;
        const catName = t ? (t.category?.name || '-') : g.categoryName;

        const avg = count > 0 ? totalPrice / count : 0;
        const assocPay = avg * (pctFees / 100);
        const finFee = avg * (finPct / 100);
        const expUnit = mat + lab + thr + opCost + assocPay + finFee;
        const plUnit = avg - expUnit;
        const totInc = totalPrice;
        const totExp = expUnit * count;
        const totPL = totInc - totExp;
        const plPct = totInc !== 0 ? (totPL / totInc) * 100 : 0;
        const princProfit = totInc - assocPay * count;
        const princPct = totInc !== 0 ? (princProfit / totInc) * 100 : 0;

        return {
          key: compositeKey,
          month: '-',
          category: catName,
          treatmentName: t ? t.treatment_name : g.treatmentName,
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

    // Only add zero rows when NO filter is applied (show all treatments by default)
    if (!hasActiveFilter) {
      const endRef = dateRange.endDate || new Date();
      const zeroMonthKey = `${endRef.getFullYear()}-${String(endRef.getMonth() + 1).padStart(2, '0')}`;

      const zeroRows: ProfitabilityRow[] = treatments
        .filter((t: any) => !treatmentsWithData.has(t.id))
        .map((t: any) => ({
          key: t.id,
          month: zeroMonthKey,
          category: t.category?.name || '-',
          treatmentName: t.treatment_name,
          avgIncome: 0,
          materialCost: t.material_cost || 0,
          labBill: t.lab_bill || 0,
          therapistPayRate: t.therapist_pay_rate || 0,
          opCostPerTreatment: (t.hourly_rate || 0) * ((t.duration_minutes || 0) / 60),
          associatePay: 0,
          financeFee: 0,
          expensePerUnit: 0,
          profitLossPerUnit: 0,
          noItems: 0,
          totalIncome: 0,
          totalExpense: 0,
          totalPL: 0,
          principalProfit: 0,
          plPercent: 0,
          principalProfitPercent: 0,
        }));

      return [...dataRows, ...zeroRows];
    }

    return dataRows;
  }, [tpiData, treatments, treatmentById, hasActiveFilter, dateRange.endDate]);

  // ── search filter ──
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return allRows;
    const q = searchQuery.toLowerCase();
    return allRows.filter(
      (r) =>
        r.treatmentName.toLowerCase().includes(q) ||
        (r.month && r.month !== '-' && fmtMonth(r.month).toLowerCase().includes(q)) ||
        r.category.toLowerCase().includes(q),
    );
  }, [allRows, searchQuery]);

  // ── category filter ──
  const categoryFilteredRows = useMemo(() => {
    if (!appliedFilter?.categories?.length) return filteredRows;
    const selected = appliedFilter.categories.map((c) => c.toLowerCase());
    return filteredRows.filter((r) => selected.includes(r.category.toLowerCase()));
  }, [filteredRows, appliedFilter]);

  // ── sorting ──
  const handleSort = useCallback((key: ColumnKey) => {
    if (sortColumn === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(key);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  }, [sortColumn]);

  const sortedRows = useMemo(() => {
    if (!sortColumn) return categoryFilteredRows;
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...categoryFilteredRows].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortColumn) {
        case 'category':
          aVal = a.category;
          bVal = b.category;
          break;
        case 'treatmentName':
          aVal = a.treatmentName;
          bVal = b.treatmentName;
          break;
        default:
          aVal = a[sortColumn as keyof ProfitabilityRow] as number;
          bVal = b[sortColumn as keyof ProfitabilityRow] as number;
          break;
      }
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * dir;
      }
      return ((aVal as number) - (bVal as number)) * dir;
    });
  }, [categoryFilteredRows, sortColumn, sortDirection]);

  // ── pagination ──
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const paginatedRows = sortedRows.slice(
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

    // Sum of per-unit column values across all rows
    const sumAvgInc = src.reduce((s, r) => s + r.avgIncome, 0);
    const sumMat = src.reduce((s, r) => s + r.materialCost, 0);
    const sumLab = src.reduce((s, r) => s + r.labBill, 0);
    const sumThr = src.reduce((s, r) => s + r.therapistPayRate, 0);
    const sumOp = src.reduce((s, r) => s + r.opCostPerTreatment, 0);
    const sumAP = src.reduce((s, r) => s + r.associatePay, 0);
    const sumFF = src.reduce((s, r) => s + r.financeFee, 0);
    const sumEU = src.reduce((s, r) => s + r.expensePerUnit, 0);
    const sumPL = src.reduce((s, r) => s + r.profitLossPerUnit, 0);

    return {
      avgIncome: sumAvgInc,
      materialCost: sumMat,
      labBill: sumLab,
      therapistPayRate: sumThr,
      opCostPerTreatment: sumOp,
      associatePay: sumAP,
      financeFee: sumFF,
      expensePerUnit: sumEU,
      profitLossPerUnit: sumPL,
      noItems: n,
      totalIncome: ti,
      totalExpense: te,
      totalPL: tp,
      principalProfit: pp,
      plPercent: ti !== 0 ? (tp / ti) * 100 : 0,
      principalProfitPercent: ti !== 0 ? (pp / ti) * 100 : 0,
    };
  }, [categoryFilteredRows]);

  // Bubble the current dataset up to a parent (e.g. the page) so it can expose
  // it to the AI chatbot via aiContext. We pass the full filtered set rather
  // than the paginated slice — the bot should be able to answer "which
  // treatments are loss-making?" across the whole table, not just page 1.
  // Parents are responsible for shrinking the payload before sending to the
  // chatbot (the chatbot caps prompt size).
  useEffect(() => {
    if (!onDataChange) return;
    onDataChange({
      rows: categoryFilteredRows,
      totals: {
        noItems: totals.noItems,
        totalIncome: totals.totalIncome,
        totalExpense: totals.totalExpense,
        totalProfit: totals.totalPL,
      },
      period: {
        from: dateRange.startDate ? toDateStr(dateRange.startDate) : null,
        to: dateRange.endDate ? toDateStr(dateRange.endDate) : null,
      },
    });
  }, [categoryFilteredRows, totals.noItems, totals.totalIncome, totals.totalExpense, totals.totalPL, dateRange.startDate, dateRange.endDate, onDataChange]);

  // ── Dentally API verification (console) ──
  // Compares Supabase TPI data with live Dentally API data for the current date range.
  // ── Export to CSV ──
  const exportToCSV = useCallback(() => {
    const visibleColumns = ALL_COLUMNS.filter((c) => visibleCols.has(c.key));
    const rows = sortedRows;
    if (rows.length === 0) return;

    const getRawValue = (row: ProfitabilityRow, key: ColumnKey): string => {
      switch (key) {
        case 'category': return row.category;
        case 'treatmentName': return row.treatmentName;
        case 'noItems': return String(row.noItems);
        case 'plPercent': return isFinite(row.plPercent) ? `${row.plPercent.toFixed(2)}` : '0';
        case 'principalProfitPercent': return isFinite(row.principalProfitPercent) ? `${row.principalProfitPercent.toFixed(2)}` : '0';
        default: {
          const val = row[key as keyof ProfitabilityRow];
          return typeof val === 'number' ? val.toFixed(2) : String(val ?? '');
        }
      }
    };

    const header = visibleColumns.map((c) => `"${c.label}"`).join(',');
    const csvRows = rows.map((row) =>
      visibleColumns.map((c) => {
        const val = getRawValue(row, c.key);
        return `"${val.replace(/"/g, '""')}"`;
      }).join(','),
    );

    // Add totals row
    const totalsRow = visibleColumns.map((c) => {
      if (c.key === 'treatmentName') return '"Total"';
      if (c.key === 'category') return '""';
      if (c.key === 'noItems') return `"${totals.noItems}"`;
      if (c.key === 'plPercent') return `"${isFinite(totals.plPercent) ? totals.plPercent.toFixed(2) : '0'}"`;
      if (c.key === 'principalProfitPercent') return `"${isFinite(totals.principalProfitPercent) ? totals.principalProfitPercent.toFixed(2) : '0'}"`;
      const val = totals[c.key as keyof typeof totals];
      return `"${typeof val === 'number' ? val.toFixed(2) : ''}"`;
    }).join(',');

    const csv = [header, ...csvRows, totalsRow].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `profitability-treatments-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [sortedRows, visibleCols, totals]);


  // ── column visibility helpers ──
  const toggleCol = (key: ColumnKey) =>
    setVisibleCols((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });

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
  const fmt = standalone ? fmtCurrency2 : fmtCurrency;

  const renderPL = (value: number, isTotal = false) => {
    if (!standalone) return fmt(value);
    const isNeg = value < 0;
    const color = isNeg ? 'text-red-500' : 'text-teal-600';
    const display = isNeg ? `(${fmtCurrency2(Math.abs(value))})` : fmtCurrency2(value);
    return (
      <span className={`inline-flex items-center gap-1 ${color} font-medium`}>
        {!isTotal && <span className="text-xs">{isNeg ? '↘' : '↗'}</span>}
        {display}
      </span>
    );
  };

  const renderAssocPay = (value: number) => {
    if (!standalone) return fmt(value);
    const isNeg = value < 0;
    const color = isNeg ? 'text-red-500' : '';
    const display = isNeg ? `(${fmtCurrency2(Math.abs(value))})` : fmtCurrency2(value);
    return <span className={color}>{display}</span>;
  };

  const cellValue = (
    row: ProfitabilityRow | typeof totals,
    key: ColumnKey,
    isTotal = false,
  ) => {
    switch (key) {
      case 'category':
        return isTotal ? '' : (row as ProfitabilityRow).category;
      case 'treatmentName':
        return isTotal ? 'Total' : (row as ProfitabilityRow).treatmentName;
      case 'avgIncome':
        return fmt(row.avgIncome);
      case 'materialCost':
        return fmt(row.materialCost);
      case 'labBill':
        return fmt(row.labBill);
      case 'therapistPayRate':
        return fmt(row.therapistPayRate);
      case 'opCostPerTreatment':
        return fmt(row.opCostPerTreatment);
      case 'associatePay':
        return renderAssocPay(row.associatePay);
      case 'financeFee':
        return fmt(row.financeFee);
      case 'expensePerUnit':
        return fmt(row.expensePerUnit);
      case 'profitLossPerUnit':
        return renderPL(row.profitLossPerUnit, isTotal);
      case 'noItems':
        return row.noItems;
      case 'totalIncome':
        return fmt(row.totalIncome);
      case 'totalExpense':
        return fmt(row.totalExpense);
      case 'totalPL':
        return renderPL(row.totalPL, isTotal);
      case 'principalProfit':
        return fmt(row.principalProfit);
      case 'plPercent':
        return fmtPercent(row.plPercent);
      case 'principalProfitPercent':
        return fmtPercent(row.principalProfitPercent);
      default:
        return '';
    }
  };

  const isRightAlign = (key: ColumnKey) =>
    key !== 'category' && key !== 'treatmentName';

  // ── filter handlers ──
  // Date range always comes from the global top bar filter.
  // The Filter dialog only applies category filtering.
  const handleApplyFilter = () => {
    setAppliedFilter({
      from: '',
      to: '',
      categories: filterCategory,
    });
    setCurrentPage(1);
    handleFilterClose(false);
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

  const isLoading = isLoadingTreatments || isLoadingTpiData;

  const Wrapper = standalone ? 'div' : Card;
  const ContentWrapper = standalone ? 'div' : CardContent;

  return (
    <Wrapper className={standalone ? '' : undefined}>
      {!standalone && (
        <CardHeader>
          <CardTitle>Profitability By Treatments</CardTitle>
        </CardHeader>
      )}
      <ContentWrapper className="space-y-4">
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Date Range Badge */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-full">
            <CalendarDays className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium text-foreground/70">
              {dateRange.startDate
                ? dayjs(dateRange.startDate).format('DD MMM YYYY')
                : '—'}
              {' — '}
              {dateRange.endDate
                ? dayjs(dateRange.endDate).format('DD MMM YYYY')
                : '—'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={standalone ? 'Search treatments...' : 'Search here...'}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9"
              />
            </div>

            {/* Page Size */}
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

            {standalone ? (
              <Button variant="outline" className="gap-2" onClick={exportToCSV} disabled={categoryFilteredRows.length === 0}>
                <Download className="h-4 w-4" />
                Export
              </Button>
            ) : (
              <Button
                onClick={() => setIsFilterOpen(true)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                Filters
              </Button>
            )}
          </div>
        </div>

        {/* ── Filter Dialog ── */}
        <Dialog open={isFilterOpen} onOpenChange={handleFilterClose}>
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
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary/60" />
            <p className="text-xs text-muted-foreground/70">
              Loading profitability data…
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <TableHeader>
                  {/* Group header pills */}
                  <TableRow className="hover:bg-transparent border-0">
                    {/* Sticky placeholder for Treatment Name in pills row */}
                    {visibleCols.has('treatmentName') && (
                      <TableHead className="!bg-white h-auto p-0 pb-1 border-0" style={{ position: 'sticky', left: 0, zIndex: 20, minWidth: 120 }} />
                    )}
                    {/* remaining ungrouped cols (category etc) */}
                    {(visibleNone - (visibleCols.has('treatmentName') ? 1 : 0)) > 0 && (
                      <TableHead colSpan={visibleNone - (visibleCols.has('treatmentName') ? 1 : 0)} className="bg-transparent h-auto p-0 pb-1 border-0" />
                    )}
                    {visiblePerUnit > 0 && (
                      <TableHead colSpan={visiblePerUnit} className="h-auto p-0 px-0.5 pb-1 bg-transparent">
                        <div className="bg-gradient-to-r from-primary/15 via-primary/25 to-primary/15 text-primary font-semibold text-[10px] tracking-widest text-center py-1.5 px-3 rounded-t-full uppercase">
                          Per Unit Profit/Loss
                        </div>
                      </TableHead>
                    )}
                    {visibleNoItems > 0 && (
                      <TableHead className="bg-transparent h-auto p-0 pb-1 border-0" />
                    )}
                    {visibleTotal > 0 && (
                      <TableHead colSpan={visibleTotal} className="h-auto p-0 px-0.5 pb-1 bg-transparent">
                        <div className="bg-primary/90 text-white font-semibold text-[10px] tracking-widest text-center py-1.5 px-3 rounded-t-full uppercase">
                          Total Profit/Loss
                        </div>
                      </TableHead>
                    )}
                  </TableRow>

                  {/* Column headers */}
                  <TableRow className="bg-[hsl(var(--muted)/0.3)] hover:bg-[hsl(var(--muted)/0.3)]">
                    {ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map(
                      (col) => {
                        let bg = '';
                        if (col.group === 'perUnit') bg = 'bg-primary/[0.02]';
                        if (col.group === 'total') bg = 'bg-primary/[0.04]';
                        const isSorted = sortColumn === col.key;
                        const isSticky = col.key === 'treatmentName';
                        const stickyStyle: React.CSSProperties = isSticky
                          ? { position: 'sticky', left: 0, zIndex: 20 }
                          : {};
                        return (
                          <TableHead
                            key={col.key}
                            className={`px-2.5 py-2 text-[11px] font-medium text-muted-foreground/70 text-center border-r border-b border-black ${bg} cursor-pointer select-none hover:text-muted-foreground transition-colors h-auto ${isSticky ? '!bg-gray-50' : ''}`}
                            style={{ maxWidth: 85, minWidth: col.key === 'treatmentName' ? 120 : col.key === 'category' ? 140 : 65, ...stickyStyle }}
                            onClick={() => handleSort(col.key)}
                          >
                            <div className="flex items-center gap-0.5 justify-center text-center leading-snug">
                              <span className="break-words">{col.label}</span>
                              {isSorted ? (
                                sortDirection === 'asc'
                                  ? <ChevronUp className="h-3 w-3 text-primary shrink-0" />
                                  : <ChevronDown className="h-3 w-3 text-primary shrink-0" />
                              ) : (
                                <ArrowUpDown className="h-2.5 w-2.5 text-muted-foreground/20 shrink-0" />
                              )}
                            </div>
                          </TableHead>
                        );
                      },
                    )}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {paginatedRows.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={totalVisibleCols}
                        className="text-center text-muted-foreground/50 py-12 text-xs border-b border-black"
                      >
                        No Data
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedRows.map((row, idx) => (
                      <TableRow
                        key={row.key}
                        className="hover:bg-primary/[0.02] transition-colors"
                      >
                        {ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map(
                          (col) => {
                            const isSticky = col.key === 'treatmentName';
                            const stickyStyle: React.CSSProperties = isSticky
                              ? { position: 'sticky', left: 0, zIndex: 10 }
                              : {};
                            return (
                              <TableCell
                                key={col.key}
                                className={`py-2 px-2.5 text-[12px] text-foreground/80 border-r border-b border-black ${col.key === 'treatmentName' ? 'min-w-[140px] break-words !bg-white' : col.key === 'category' ? 'min-w-[140px] break-words' : 'whitespace-nowrap'} ${isRightAlign(col.key) ? 'text-right tabular-nums' : ''}`}
                                style={stickyStyle}
                              >
                                {cellValue(row, col.key)}
                              </TableCell>
                            );
                          },
                        )}
                      </TableRow>
                    ))
                  )}

                  {/* Totals row */}
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    {ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map(
                      (col) => {
                        const isSticky = col.key === 'treatmentName';
                        const stickyStyle: React.CSSProperties = isSticky
                          ? { position: 'sticky', left: 0, zIndex: 10 }
                          : {};
                        return (
                          <TableCell
                            key={col.key}
                            className={`whitespace-nowrap py-2 px-2.5 text-[12px] font-semibold text-foreground/90 border-r border-b border-black ${isSticky ? '!bg-gray-50' : ''} ${isRightAlign(col.key) ? 'text-right tabular-nums' : ''}`}
                            style={stickyStyle}
                          >
                            {cellValue(totals, col.key, true)}
                          </TableCell>);
                      },
                    )}
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <Pagination className="mt-3">
                <PaginationContent className="gap-0.5">
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((p) => Math.max(1, p - 1))
                      }
                      disabled={currentPage === 1}
                      className="gap-1 pl-2 text-xs h-8"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
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
                          className={`h-8 w-8 text-xs ${currentPage === page ? 'border-primary/30 text-primary' : ''}`}
                        >
                          {page}
                        </Button>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((p) =>
                          Math.min(totalPages, p + 1),
                        )
                      }
                      disabled={currentPage === totalPages}
                      className="gap-1 pr-2 text-xs h-8"
                    >
                      <span>Next</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </ContentWrapper>
    </Wrapper>
  );
}
