import { useState, useMemo, useEffect } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  RotateCcw,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTreatmentGoalStats } from '@/hooks/useTreatmentGoalStats';
import { useTreatmentGoalTargets } from '@/hooks/useTreatmentGoalTargets';
import { useTreatments } from '@/hooks/useTreatments';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { startOfMonth, startOfQuarter, startOfYear } from 'date-fns';

const r2 = (n: number) => Math.round((n ?? 0) * 100) / 100;

// ─── Types ────────────────────────────────────────────────────────────────────

type PeriodType = 'month' | 'quarter' | 'year';

interface PeriodOption {
  value: string;
  label: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** UK financial year: 1 April → 31 March */
function fyLabel(year: number) {
  return `${year}-04-01 To ${year + 1}-03-31`;
}

/** Current UK FY. FY runs Apr–Mar, so Jan–Mar belongs to previous year's FY. */
function currentFY(): number {
  const now = new Date();
  return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Build options that go into the Actual / Planning selects depending on periodType.
 *  We cover ~3 FYs around the current one so users have enough range. */
function buildPeriodOptions(periodType: PeriodType): PeriodOption[] {
  const fy = currentFY();
  const startFY = fy - 2;
  const endFY = fy + 3;

  if (periodType === 'year') {
    // Simple year list
    return Array.from({ length: endFY - startFY + 1 }, (_, i) => {
      const y = startFY + i;
      return { value: `year-${y}`, label: String(y) };
    });
  }

  if (periodType === 'month') {
    // All months across FYs: Apr startFY → Mar (endFY+1)
    const options: PeriodOption[] = [];
    for (let fyYear = startFY; fyYear <= endFY; fyYear++) {
      // FY months: Apr(3)..Dec(11) of fyYear, then Jan(0)..Mar(2) of fyYear+1
      for (let i = 0; i < 12; i++) {
        const monthIndex = (3 + i) % 12;
        const calYear = monthIndex < 3 ? fyYear + 1 : fyYear;
        options.push({
          value: `month-${calYear}-${monthIndex}`,
          label: `${MONTH_NAMES[monthIndex]} ${calYear}`,
        });
      }
    }
    return options;
  }

  // quarter
  const options: PeriodOption[] = [];
  for (let fyYear = startFY; fyYear <= endFY; fyYear++) {
    options.push(
      { value: `quarter-${fyYear}-Q1`, label: `Q1 ${fyYear} (Apr–Jun)` },
      { value: `quarter-${fyYear}-Q2`, label: `Q2 ${fyYear} (Jul–Sep)` },
      { value: `quarter-${fyYear}-Q3`, label: `Q3 ${fyYear} (Oct–Dec)` },
      { value: `quarter-${fyYear + 1}-Q4`, label: `Q4 ${fyYear + 1} (Jan–Mar)` },
    );
  }
  return options;
}

/** Convert a period option value string into a Date for the hooks */
function periodValueToDate(value: string): Date {
  const parts = value.split('-');
  const type = parts[0];
  if (type === 'year') {
    return startOfYear(new Date(Number(parts[1]), 0, 1));
  }
  if (type === 'month') {
    return startOfMonth(new Date(Number(parts[1]), Number(parts[2]), 1));
  }
  // quarter-YYYY-QN
  const year = Number(parts[1]);
  const qMap: Record<string, number> = { Q1: 3, Q2: 6, Q3: 9, Q4: 0 };
  return startOfQuarter(new Date(year, qMap[parts[2]], 1));
}

/** Extract the hook-compatible periodType from a value string */
function periodValueToType(value: string): 'month' | 'quarter' | 'year' {
  if (value.startsWith('month-')) return 'month';
  if (value.startsWith('quarter-')) return 'quarter';
  return 'year';
}

/** Get a sensible FY label from a period value (only shown for year mode) */
function periodValueToFYLabel(value: string): string | null {
  if (!value.startsWith('year-')) return null;
  const y = Number(value.split('-')[1]);
  return fyLabel(y);
}

/** Pick a smart default for actual (current period) */
function getDefaultActual(periodType: PeriodType): string {
  const fy = currentFY();
  const now = new Date();
  if (periodType === 'year') return `year-${fy}`;
  if (periodType === 'month') {
    return `month-${now.getFullYear()}-${now.getMonth()}`;
  }
  // quarter — current quarter
  const m = now.getMonth();
  if (m >= 3 && m <= 5) return `quarter-${fy}-Q1`;
  if (m >= 6 && m <= 8) return `quarter-${fy}-Q2`;
  if (m >= 9 && m <= 11) return `quarter-${fy}-Q3`;
  return `quarter-${now.getFullYear()}-Q4`;
}

/** Pick a smart default for planning (next period) */
function getDefaultPlanning(periodType: PeriodType): string {
  const fy = currentFY();
  const now = new Date();
  if (periodType === 'year') return `year-${fy + 1}`;
  if (periodType === 'month') {
    return `month-${now.getFullYear()}-${now.getMonth()}`;
  }
  // quarter — next quarter
  const m = now.getMonth();
  if (m >= 3 && m <= 5) return `quarter-${fy}-Q2`;
  if (m >= 6 && m <= 8) return `quarter-${fy}-Q3`;
  if (m >= 9 && m <= 11) return `quarter-${now.getFullYear() + (now.getMonth() >= 9 ? 1 : 0)}-Q4`;
  return `quarter-${fy}-Q1`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'bg-teal-500' : pct >= 80 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-sm text-muted-foreground w-10">{pct}%</span>
    </div>
  );
}

function StatusBadge({ pct }: { pct: number }) {
  if (pct >= 90) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        On Track
      </span>
    );
  }
  if (pct >= 80) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
        <AlertTriangle className="w-3.5 h-3.5" />
        At Risk
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400">
      <XCircle className="w-3.5 h-3.5" />
      Behind
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TreatmentProfitGoals() {
  const { can } = usePermissions();
  const canUpdate = can('treatments', 'update', 'profit_goals_tab');
  const { selectedLocationId, selectedRegionId } = useFilters();
  const { treatments, isLoading: isLoadingTreatments } = useTreatments();
  const { allAvailableLocations } = useLocations();
  const selectedLocationName = selectedLocationId
    ? (allAvailableLocations?.find(l => l.id === selectedLocationId)?.location_name ?? 'Selected location')
    : 'All locations';

  // Period state — 3 fields: Period Type, Actual, Planning
  const [periodType, setPeriodType] = useState<PeriodType>('month');
  const [actualValue, setActualValue] = useState(() => getDefaultActual('month'));
  const [planningValue, setPlanningValue] = useState(() => getDefaultPlanning('month'));

  // Build options based on periodType
  const periodOptions = useMemo(() => buildPeriodOptions(periodType), [periodType]);

  // When periodType changes, reset actual/planning to sensible defaults
  const handlePeriodTypeChange = (value: PeriodType) => {
    setPeriodType(value);
    setActualValue(getDefaultActual(value));
    setPlanningValue(getDefaultPlanning(value));
  };

  // Derived Date objects for the hooks
  const actualPeriod = useMemo(() => periodValueToDate(actualValue), [actualValue]);
  const planningPeriod = useMemo(() => periodValueToDate(planningValue), [planningValue]);
  const hookPeriodType = periodValueToType(actualValue);

  // Goal targets local state — keyed by treatment name
  const [goalTargets, setGoalTargets] = useState<Record<string, { unitTarget: number | null; avgAmountTarget: number | null }>>({});

  // Hooks
  const { data: actualPeriodStats = [], isLoading: isLoadingActualStats, isError: isErrorActualStats, error: errorActualStats } = useTreatmentGoalStats({
    period: actualPeriod,
    periodType: hookPeriodType,
    locationId: selectedLocationId ?? undefined,
  });

  const { targets: loadedTargets, isLoading: isLoadingTargets, saveTargets, isSaving } = useTreatmentGoalTargets({
    period: planningPeriod,
    periodType: hookPeriodType,
    locationId: selectedLocationId,
    regionId: selectedRegionId,
  });

  // Populate local state from loaded targets (only when no local edits exist yet)
  useEffect(() => {
    if (loadedTargets.size > 0) {
      setGoalTargets((prev) => {
        // Only populate if local state is empty (no user edits in progress)
        if (Object.keys(prev).length > 0) return prev;
        const targets: Record<string, { unitTarget: number | null; avgAmountTarget: number | null }> = {};
        loadedTargets.forEach((t, key) => {
          targets[key] = { unitTarget: t.unitTarget, avgAmountTarget: t.avgAmountTarget };
        });
        return targets;
      });
    }
  }, [loadedTargets]);

  // Build treatment stats map (stats come per treatment from the profitability RPC)
  const treatmentStatsMap = useMemo(() => {
    const map: Record<string, { unitActual: number; totalRevenue: number; avgAmountActual: number }> = {};
    actualPeriodStats.forEach((s) => {
      map[s.treatmentName] = { unitActual: s.unitActual, totalRevenue: s.totalRevenue, avgAmountActual: s.avgAmountActual };
    });
    return map;
  }, [actualPeriodStats]);

  // Build all treatment names — every treatment from useTreatments + any with actuals
  const treatmentNames = useMemo(() => {
    const names = new Set<string>();
    treatments.forEach((t) => names.add(t.treatment_name));
    loadedTargets.forEach((_, key) => names.add(key));
    actualPeriodStats.forEach((s) => names.add(s.treatmentName));
    return Array.from(names).sort();
  }, [treatments, loadedTargets, actualPeriodStats]);

  // Combined row data — one row per treatment
  const combinedData = useMemo(() => {
    return treatmentNames.map((name) => {
      const stats = treatmentStatsMap[name] || null;
      const unitActual = stats?.unitActual ?? 0;
      const avgActual = stats?.avgAmountActual ?? 0;

      const target = goalTargets[name] || loadedTargets.get(name) || null;
      const unitTarget = target?.unitTarget || 0;
      const avgTarget = target?.avgAmountTarget || 0;

      const unitPct = unitTarget > 0 ? Math.min(100, Math.round((unitActual / unitTarget) * 100)) : (unitActual > 0 ? 100 : 0);
      const avgPct = avgTarget > 0 ? Math.min(100, Math.round((avgActual / avgTarget) * 100)) : (avgActual > 0 ? 100 : 0);

      // Use the worst of both metrics — if either is lagging, status reflects it
      const hasUnitTarget = unitTarget > 0;
      const hasAvgTarget = avgTarget > 0;
      const pct = hasUnitTarget && hasAvgTarget
        ? Math.min(unitPct, avgPct)
        : hasUnitTarget ? unitPct
          : hasAvgTarget ? avgPct
            : (unitActual > 0 ? 100 : 0);

      return { name, unitActual, unitTarget, avgActual, avgTarget, pct };
    });
  }, [treatmentNames, treatmentStatsMap, goalTargets, loadedTargets]);

  // Totals
  const totals = useMemo(() => {
    const unitActual = combinedData.reduce((s, d) => s + d.unitActual, 0);
    const unitTarget = combinedData.reduce((s, d) => s + d.unitTarget, 0);
    const totalRevenue = combinedData.reduce((s, d) => s + d.avgActual * d.unitActual, 0);
    const totalTargetRevenue = combinedData.reduce((s, d) => s + d.avgTarget * d.unitTarget, 0);
    const avgActual = unitActual > 0 ? Math.round(totalRevenue / unitActual) : 0;
    const avgTarget = unitTarget > 0 ? Math.round(totalTargetRevenue / unitTarget) : 0;
    return { unitActual, unitTarget, avgActual, avgTarget };
  }, [combinedData]);

  // ── Table state: search, sort, pagination ──
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<'name' | 'pct' | 'unitActual' | 'unitTarget' | 'avgActual' | 'avgTarget'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Search → Sort → Paginate
  const filteredData = useMemo(() => {
    let data = combinedData;
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter((r) => r.name.toLowerCase().includes(q));
    }
    // Sort
    data = [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return data;
  }, [combinedData, searchQuery, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);

  // Reset to page 1 when search or pageSize changes
  useEffect(() => { setCurrentPage(1); }, [searchQuery, pageSize]);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: typeof sortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  // Save handler
  const handleSaveTargets = () => {
    const record: Record<string, { unitTarget: number; avgAmountTarget: number }> = {};
    Object.entries(goalTargets).forEach(([treatmentName, v]) => {
      if (v.unitTarget !== null || v.avgAmountTarget !== null) {
        record[treatmentName] = {
          unitTarget: v.unitTarget ?? 0,
          avgAmountTarget: v.avgAmountTarget ?? 0,
        };
      }
    });
    saveTargets(record);
  };

  // Reset handler
  const handleReset = () => {
    setGoalTargets({});
  };

  // FY label for display (only for year mode)
  const actualFYLabel = periodValueToFYLabel(actualValue);
  const planningFYLabel = periodValueToFYLabel(planningValue);

  const isLoading = isLoadingActualStats || isLoadingTargets || isLoadingTreatments;

  if (isLoading) {
    return (
      <MainLayout userRole="admin">
        <Helmet><title>Profit Goals | DentPulse</title></Helmet>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  const allRowsForAI = combinedData.slice(0, 60).map(r => ({
    name: r.name,
    unitActual: r.unitActual,
    unitTarget: r.unitTarget,
    avgActual: r2(r.avgActual),
    avgTarget: r2(r.avgTarget),
    progressPct: r.pct,
    status: r.pct >= 90 ? 'On Track' : r.pct >= 80 ? 'At Risk' : 'Behind',
  }));
  const sortedByPct = [...allRowsForAI].sort((a, b) => b.progressPct - a.progressPct);
  const aiContextData = {
    page: 'treatment-profit-goals',
    selectedLocationName,
    period: {
      periodType,
      actual: actualValue,
      planning: planningValue,
    },
    totals: {
      unitActual: totals.unitActual,
      unitTarget: totals.unitTarget,
      avgActual: r2(totals.avgActual),
      avgTarget: r2(totals.avgTarget),
    },
    rows: allRowsForAI,
    topPerformers: sortedByPct.slice(0, 10),
    bottomPerformers: sortedByPct.slice(-10).reverse(),
  };

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet><title>Profit Goals & Planning | DentPulse</title></Helmet>

      <div className="space-y-6 pt-6">
        {/* Breadcrumb + Header */}
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <Link to="/treatments/insights" className="hover:text-foreground">Treatment</Link>
            <span>/</span>
            <span className="text-foreground font-medium">Profit Goals</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">Profit Goals & Planning</h1>
              <p className="text-muted-foreground">Set and track revenue targets by treatment group</p>
            </div>
            {canUpdate && (
              <div className="flex items-center gap-2">
                <Button variant="outline" className="gap-2" onClick={handleReset}>
                  <RotateCcw className="w-4 h-4" />
                  Reset to Defaults
                </Button>
                <Button className="gap-2" onClick={handleSaveTargets} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Goals
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Period Configuration — 3 fields: Period Type, Actual, Planning */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Period Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Period Type */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Period Type</label>
                <Select value={periodType} onValueChange={(v) => handlePeriodTypeChange(v as PeriodType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Month</SelectItem>
                    <SelectItem value="quarter">Quarter</SelectItem>
                    <SelectItem value="year">Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Actual */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Actual FY</label>
                <Select value={actualValue} onValueChange={setActualValue}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {periodOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {actualFYLabel && (
                  <span className="text-xs text-muted-foreground">{actualFYLabel}</span>
                )}
              </div>

              {/* Planning */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Planning FY</label>
                <Select value={planningValue} onValueChange={setPlanningValue}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {periodOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {planningFYLabel && (
                  <span className="text-xs text-muted-foreground">{planningFYLabel}</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Treatment Group Targets */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Treatment Group Targets</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {isErrorActualStats ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 px-6">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <p className="text-sm font-medium">Error loading treatment data</p>
                <p className="text-xs text-muted-foreground">
                  {errorActualStats instanceof Error ? errorActualStats.message : 'Please try refreshing the page.'}
                </p>
              </div>
            ) : treatmentNames.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm px-6">
                No treatments found
              </div>
            ) : (
              <>
                {/* Toolbar: Search + Page Size */}
                <div className="flex items-center justify-between gap-4 px-6 pb-4">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search treatments..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                      <SelectTrigger className="w-[70px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Table className="w-full" style={{ borderCollapse: 'collapse' }}>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="pl-6 uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400 cursor-pointer select-none border-r border-b border-black"
                        onClick={() => handleSort('name')}
                      >
                        <span className="inline-flex items-center">Treatment Grouping<SortIcon col="name" /></span>
                      </TableHead>
                      <TableHead
                        className="uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400 cursor-pointer select-none border-r border-b border-black"
                        onClick={() => handleSort('pct')}
                      >
                        <span className="inline-flex items-center">Progress<SortIcon col="pct" /></span>
                      </TableHead>
                      <TableHead
                        className="text-center uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400 cursor-pointer select-none border-r border-b border-black"
                        onClick={() => handleSort('unitActual')}
                      >
                        <span className="inline-flex items-center justify-center">Unit Actual<SortIcon col="unitActual" /></span>
                      </TableHead>
                      <TableHead
                        className="text-center uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400 cursor-pointer select-none border-r border-b border-black"
                        onClick={() => handleSort('unitTarget')}
                      >
                        <span className="inline-flex items-center justify-center">Unit Target<SortIcon col="unitTarget" /></span>
                      </TableHead>
                      <TableHead
                        className="text-center uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400 cursor-pointer select-none border-r border-b border-black"
                        onClick={() => handleSort('avgActual')}
                      >
                        <span className="inline-flex items-center justify-center">Avg Amount Actual<SortIcon col="avgActual" /></span>
                      </TableHead>
                      <TableHead
                        className="text-center uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400 cursor-pointer select-none border-r border-b border-black"
                        onClick={() => handleSort('avgTarget')}
                      >
                        <span className="inline-flex items-center justify-center">Avg Amount Target<SortIcon col="avgTarget" /></span>
                      </TableHead>
                      <TableHead className="text-right pr-6 uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400 border-r border-b border-black">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedData.map((row) => {
                      const loadedTarget = loadedTargets.get(row.name);
                      const currentTarget = goalTargets[row.name];
                      const targets = currentTarget || loadedTarget || null;

                      return (
                        <TableRow key={row.name} className="h-14">
                          <TableCell className="pl-6 font-medium border-r border-b border-black">{row.name}</TableCell>
                          <TableCell className="border-r border-b border-black">
                            <ProgressBar pct={row.pct} />
                          </TableCell>
                          <TableCell className="text-center border-r border-b border-black">{row.unitActual.toLocaleString()}</TableCell>
                          <TableCell className="text-center border-r border-b border-black">
                            <Input
                              type="number"
                              value={targets?.unitTarget !== undefined && targets.unitTarget !== null ? targets.unitTarget : ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                const num = v === '' ? null : parseFloat(v);
                                if (v === '' || !isNaN(num as number)) {
                                  setGoalTargets((prev) => ({
                                    ...prev,
                                    [row.name]: {
                                      unitTarget: num,
                                      avgAmountTarget: prev[row.name]?.avgAmountTarget ?? loadedTarget?.avgAmountTarget ?? null,
                                    },
                                  }));
                                }
                              }}
                              className="w-20 text-center mx-auto"
                              min="0"
                              step="1"
                              placeholder=""
                              disabled={!canUpdate}
                            />
                          </TableCell>
                          <TableCell className="text-center border-r border-b border-black">{formatCurrency(row.avgActual)}</TableCell>
                          <TableCell className="text-center border-r border-b border-black">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-muted-foreground text-sm">£</span>
                              <Input
                                type="number"
                                value={targets?.avgAmountTarget !== undefined && targets.avgAmountTarget !== null ? targets.avgAmountTarget : ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const num = v === '' ? null : parseFloat(v);
                                  if (v === '' || !isNaN(num as number)) {
                                    setGoalTargets((prev) => ({
                                      ...prev,
                                      [row.name]: {
                                        unitTarget: prev[row.name]?.unitTarget ?? loadedTarget?.unitTarget ?? null,
                                        avgAmountTarget: num,
                                      },
                                    }));
                                  }
                                }}
                                className="w-20 text-center"
                                min="0"
                                step="0.01"
                                placeholder=""
                                disabled={!canUpdate}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6 border-r border-b border-black">
                            <StatusBadge pct={row.pct} />
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {/* Totals row */}
                    <TableRow className="font-semibold border-t-2 bg-muted/30">
                      <TableCell className="pl-6 border-r border-b border-black">Total</TableCell>
                      <TableCell className="border-r border-b border-black" />
                      <TableCell className="text-center border-r border-b border-black">{totals.unitActual.toLocaleString()}</TableCell>
                      <TableCell className="text-center border-r border-b border-black">{totals.unitTarget.toLocaleString()}</TableCell>
                      <TableCell className="text-center border-r border-b border-black">{formatCurrency(totals.avgActual)}</TableCell>
                      <TableCell className="text-center border-r border-b border-black">{formatCurrency(totals.avgTarget)}</TableCell>
                      <TableCell className="border-r border-b border-black" />
                    </TableRow>
                  </TableBody>
                </Table>

                {/* Pagination */}
                <div className="flex items-center justify-between px-6 pt-4">
                  <span className="text-sm text-muted-foreground">
                    Showing {Math.min((currentPage - 1) * pageSize + 1, filteredData.length)}–{Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length} treatments
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                      .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                        if (idx > 0 && p - (arr[idx - 1]) > 1) acc.push('...');
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((p, idx) =>
                        p === '...' ? (
                          <span key={`dots-${idx}`} className="px-1 text-muted-foreground text-sm">...</span>
                        ) : (
                          <Button
                            key={p}
                            variant={currentPage === p ? 'default' : 'outline'}
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(p)}
                          >
                            {p}
                          </Button>
                        ),
                      )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => p + 1)}
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
