import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTabPermissions } from '@/hooks/useTabPermissions';
import { usePermissions } from '@/hooks/usePermissions';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
// Budget categories are now dynamic - no mock data needed
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { useTreatmentProfitPlanning } from '@/hooks/useTreatmentProfitPlanning';
import { useAssociateProfitPlanning } from '@/hooks/useAssociateProfitPlanning';
import { useTreatments } from '@/hooks/useTreatments';
import { useTreatmentInsights } from '@/hooks/useTreatmentInsights';
import { useCostImpactData } from '@/hooks/useCostImpactData';
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calculator, TrendingUp, Target, ChevronsUpDown, Check, Settings, Save, RotateCcw } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuth } from '@/hooks/useAuth';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

// Whole-number variant, used only for the Budget vs Actual summary cards.
const formatCurrencyRound = (value: number): string => {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

// Associate Profit Planning data is now loaded dynamically via useAssociateProfitPlanning hook

// Note: Treatment Profit Planning data is now loaded dynamically via useTreatmentProfitPlanning hook

export default function Budget() {
  const { canViewTab, defaultTab } = useTabPermissions('budget');
  const { can } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');

  const BUDGET_MENU_TABS = ['budget-actual', 'budget-settings'] as const;

  const resolveInitialTab = () => {
    if (tabFromUrl && canViewTab(tabFromUrl)) return tabFromUrl;
    // Bare /budget → Budget menu (vs Actual), not Planning tabs.
    if (!tabFromUrl) {
      if (canViewTab('budget-actual')) return 'budget-actual';
      if (canViewTab('budget-settings')) return 'budget-settings';
    }
    return defaultTab || 'budget-actual';
  };

  const [activeTab, setActiveTab] = useState(resolveInitialTab);

  const isBudgetMenuSection = (BUDGET_MENU_TABS as readonly string[]).includes(activeTab);

  // Keep tab in sync with URL (sidebar links, back/forward).
  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab && canViewTab(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  // Update active tab when permissions load and current tab isn't visible
  useEffect(() => {
    if (defaultTab && !canViewTab(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };
  
  // Search, pagination, and sort state for treatment planning table
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const perPageOptions = [10, 25, 50, 100];

  // Generic sort state per table: { [tableKey]: { column: string, direction: 'asc' | 'desc' } | null }
  const [sortState, setSortState] = useState<Record<string, { column: string; direction: 'asc' | 'desc' } | null>>({});

  // Profit Planning Calculator state
  const [selectedCaseType, setSelectedCaseType] = useState<string>('');
  const [caseTypeOpen, setCaseTypeOpen] = useState(false);
  const [calcOverrides, setCalcOverrides] = useState({
    treatmentValue: '', materials: '', labBill: '', labBillDiscount: '',
    associatePercent: '', therapistPayPerHour: '', operatingCostPerHour: '',
    financeCostPercent: '', associateCost: '',
  });
  const [timeOverrides, setTimeOverrides] = useState({
    dentistOverride: '', dentistOverrun: '',
    therapistOverride: '', therapistOverrun: '',
  });

  const handleSort = (tableKey: string, column: string) => {
    setSortState(prev => {
      const current = prev[tableKey];
      if (!current || current.column !== column) {
        return { ...prev, [tableKey]: { column, direction: 'desc' } };
      }
      if (current.direction === 'desc') {
        return { ...prev, [tableKey]: { column, direction: 'asc' } };
      }
      return { ...prev, [tableKey]: null };
    });
  };

  const getSortIcon = (tableKey: string, column: string) => {
    const current = sortState[tableKey];
    if (!current || current.column !== column) return <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />;
    if (current.direction === 'desc') return <ArrowDown className="w-3.5 h-3.5" />;
    return <ArrowUp className="w-3.5 h-3.5" />;
  };

  const applySortToArray = <T,>(tableKey: string, data: T[], accessor: (item: T, col: string) => number | string): T[] => {
    const current = sortState[tableKey];
    if (!current) return data;
    const sorted = [...data].sort((a, b) => {
      const aVal = accessor(a, current.column);
      const bVal = accessor(b, current.column);
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return current.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return current.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
    return sorted;
  };

  
  // Fetch treatment profit planning data
  const { planningData, isLoading: isLoadingPlanning, saveBudgetPlans } = useTreatmentProfitPlanning();

  // Fetch associate profit planning data (dynamic)
  const { associateData: associatePlanningData, monthlyTrends: associateMonthlyTrends, isLoading: isLoadingAssociates } = useAssociateProfitPlanning();

  // Fetch treatments from Treatment Setup (for Profit Planning calculator)
  const { treatments: setupTreatments, isLoading: isLoadingSetupTreatments } = useTreatments();

  // Fetch treatment insights (same TPI-based data as Treatment Insights page)
  const { summary: insightsSummary } = useTreatmentInsights();

  // Fetch actual costs from connected accounting accounts (Iplicit/Xero)
  const { data: costImpactData, isLoading: isLoadingCostImpact } = useCostImpactData();

  // ── Budget Settings tab state & data ──
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const { selectedLocationId, dateRange } = useFilters();
  const queryClient = useQueryClient();

  const BUDGET_CATEGORIES = ['Revenue', 'Clinician Costs', 'Staff Costs', 'Lab & Materials', 'Overhead', 'Operating Lease', 'EBITDA'] as const;

  // Period Configuration state (same pattern as Profit Goals)
  type BudgetPeriodType = 'month' | 'quarter' | 'year';
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const budgetCurrentFY = () => {
    const now = new Date();
    return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  };

  const buildBudgetPeriodOptions = (pt: BudgetPeriodType) => {
    const fy = budgetCurrentFY();
    const startFY = fy - 2;
    const endFY = fy + 3;
    if (pt === 'year') {
      return Array.from({ length: endFY - startFY + 1 }, (_, i) => ({
        value: `year-${startFY + i}`,
        label: String(startFY + i),
      }));
    }
    if (pt === 'month') {
      const opts: { value: string; label: string }[] = [];
      for (let fyYear = startFY; fyYear <= endFY; fyYear++) {
        for (let i = 0; i < 12; i++) {
          const mi = (3 + i) % 12;
          const cy = mi < 3 ? fyYear + 1 : fyYear;
          opts.push({ value: `month-${cy}-${mi}`, label: `${MONTH_NAMES[mi]} ${cy}` });
        }
      }
      return opts;
    }
    const opts: { value: string; label: string }[] = [];
    for (let fyYear = startFY; fyYear <= endFY; fyYear++) {
      opts.push(
        { value: `quarter-${fyYear}-Q1`, label: `Q1 ${fyYear} (Apr–Jun)` },
        { value: `quarter-${fyYear}-Q2`, label: `Q2 ${fyYear} (Jul–Sep)` },
        { value: `quarter-${fyYear}-Q3`, label: `Q3 ${fyYear} (Oct–Dec)` },
        { value: `quarter-${fyYear + 1}-Q4`, label: `Q4 ${fyYear + 1} (Jan–Mar)` },
      );
    }
    return opts;
  };

  const getDefaultBudgetActual = (pt: BudgetPeriodType) => {
    const fy = budgetCurrentFY();
    const now = new Date();
    if (pt === 'year') return `year-${fy}`;
    if (pt === 'month') return `month-${now.getFullYear()}-${now.getMonth()}`;
    const m = now.getMonth();
    if (m >= 3 && m <= 5) return `quarter-${fy}-Q1`;
    if (m >= 6 && m <= 8) return `quarter-${fy}-Q2`;
    if (m >= 9 && m <= 11) return `quarter-${fy}-Q3`;
    return `quarter-${now.getFullYear()}-Q4`;
  };

  const getDefaultBudgetPlanning = (pt: BudgetPeriodType) => {
    const fy = budgetCurrentFY();
    const now = new Date();
    if (pt === 'year') return `year-${fy + 1}`;
    if (pt === 'month') return `month-${now.getFullYear()}-${now.getMonth()}`;
    const m = now.getMonth();
    if (m >= 3 && m <= 5) return `quarter-${fy}-Q2`;
    if (m >= 6 && m <= 8) return `quarter-${fy}-Q3`;
    if (m >= 9 && m <= 11) return `quarter-${now.getFullYear() + 1}-Q4`;
    return `quarter-${fy}-Q1`;
  };

  const [bsPeriodType, setBsPeriodType] = useState<BudgetPeriodType>('month');
  const [bsActualValue, setBsActualValue] = useState(() => getDefaultBudgetActual('month'));
  const [bsPlanningValue, setBsPlanningValue] = useState(() => getDefaultBudgetPlanning('month'));

  const bsPeriodOptions = useMemo(() => buildBudgetPeriodOptions(bsPeriodType), [bsPeriodType]);

  const handleBsPeriodTypeChange = (v: BudgetPeriodType) => {
    setBsPeriodType(v);
    setBsActualValue(getDefaultBudgetActual(v));
    setBsPlanningValue(getDefaultBudgetPlanning(v));
  };

  const bsActualFYLabel = bsActualValue.startsWith('year-') ? `${bsActualValue.split('-')[1]}-04-01 To ${Number(bsActualValue.split('-')[1]) + 1}-03-31` : null;
  const bsPlanningFYLabel = bsPlanningValue.startsWith('year-') ? `${bsPlanningValue.split('-')[1]}-04-01 To ${Number(bsPlanningValue.split('-')[1]) + 1}-03-31` : null;

  // Convert period value to start/end date range
  const bsActualDateRange = useMemo(() => {
    const parts = bsActualValue.split('-');
    const type = parts[0];
    if (type === 'year') {
      const y = Number(parts[1]);
      return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
    }
    if (type === 'month') {
      const y = Number(parts[1]);
      const m = Number(parts[2]); // 0-indexed
      const startDate = new Date(y, m, 1);
      const endDate = new Date(y, m + 1, 0);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { start: fmt(startDate), end: fmt(endDate) };
    }
    // quarter
    const y = Number(parts[1]);
    const qMap: Record<string, [number, number]> = { Q1: [3, 5], Q2: [6, 8], Q3: [9, 11], Q4: [0, 2] };
    const [sm, em] = qMap[parts[2]] || [0, 2];
    const sy = parts[2] === 'Q4' ? y : y;
    const startDate = new Date(sy, sm, 1);
    const endDate = new Date(sy, em + 1, 0);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: fmt(startDate), end: fmt(endDate) };
  }, [bsActualValue]);

  // Fetch period-specific actuals for Budget Settings "Current Actual" column
  const { data: bsActualData } = useQuery({
    queryKey: ['budget-settings-actuals', organizationId, bsActualDateRange.start, bsActualDateRange.end, selectedLocationId],
    queryFn: async () => {
      if (!organizationId) return null;

      // Fetch revenue + cost breakdown via profitability RPC
      const { data: rpcData } = await (supabase as any).rpc('get_profitability_invoice_items', {
        p_organization_id: organizationId,
        p_from_date: bsActualDateRange.start,
        p_to_date: bsActualDateRange.end,
        p_location_id: selectedLocationId || null,
      });

      let revenue = 0, clinicianCosts = 0, staffCosts = 0, labMaterials = 0, overhead = 0, operatingLease = 0;

      for (const row of (rpcData ?? []) as any[]) {
        const count = Number(row.no_of_treatments) || 0;
        const totalRev = Number(row.total_revenue) || 0;
        const avg = count > 0 ? totalRev / count : 0;
        revenue += totalRev;
        const mat = Number(row.material_cost) || 0;
        const lab = Number(row.lab_bill) || 0;
        const thr = Number(row.therapist_pay_rate) || 0;
        const hr = Number(row.hourly_rate) || 0;
        const dur = Number(row.duration_minutes) || 0;
        const pctFees = Number(row.percent_fees) || 0;
        const finFee = Number(row.finance_fee) || 0;

        clinicianCosts += avg * (pctFees / 100) * count;
        staffCosts += thr * count;
        labMaterials += (mat + lab) * count;
        overhead += (hr * (dur / 60)) * count;
        operatingLease += avg * (finFee / 100) * count;
      }

      const totalCosts = clinicianCosts + staffCosts + labMaterials + overhead + operatingLease;
      const ebitda = revenue - totalCosts;

      return {
        Revenue: Math.round(revenue * 100) / 100,
        'Clinician Costs': Math.round(clinicianCosts * 100) / 100,
        'Staff Costs': Math.round(staffCosts * 100) / 100,
        'Lab & Materials': Math.round(labMaterials * 100) / 100,
        Overhead: Math.round(overhead * 100) / 100,
        'Operating Lease': Math.round(operatingLease * 100) / 100,
        EBITDA: Math.round(ebitda * 100) / 100,
      } as Record<string, number>;
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
  });

  // Derive storage period key from planningValue
  const budgetSettingsPeriod = useMemo(() => {
    const parts = bsPlanningValue.split('-');
    if (parts[0] === 'month') return `${parts[1]}-${String(Number(parts[2]) + 1).padStart(2, '0')}`;
    if (parts[0] === 'year') return `${parts[1]}-FY`;
    return `${parts[1]}-${parts[2]}`;
  }, [bsPlanningValue]);

  const [budgetEdits, setBudgetEdits] = useState<Record<string, number | null>>({});

  // Fetch saved budget settings for the selected period
  const { data: savedBudgetSettings, isLoading: isLoadingBudgetSettings } = useQuery({
    queryKey: ['budget-category-settings', organizationId, budgetSettingsPeriod],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await (supabase as any)
        .from('budget_category_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('period', budgetSettingsPeriod);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; category: string; budget_amount: number; period: string }>;
    },
    enabled: !!organizationId,
  });

  // Populate edits from saved settings on load
  useEffect(() => {
    if (!savedBudgetSettings) return;
    const edits: Record<string, number | null> = {};
    for (const cat of BUDGET_CATEGORIES) {
      const saved = savedBudgetSettings.find(s => s.category === cat);
      edits[cat] = saved ? saved.budget_amount : null;
    }
    setBudgetEdits(edits);
  }, [savedBudgetSettings]);

  // Save mutation
  const saveBudgetSettingsMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId || !user?.id) throw new Error('Missing org or user');
      const upserts = BUDGET_CATEGORIES.map(cat => ({
        organization_id: organizationId,
        category: cat,
        period: budgetSettingsPeriod,
        budget_amount: budgetEdits[cat] ?? 0,
        created_by: user.id,
      }));

      await (supabase as any)
        .from('budget_category_settings')
        .delete()
        .eq('organization_id', organizationId)
        .eq('period', budgetSettingsPeriod);

      const { error } = await (supabase as any)
        .from('budget_category_settings')
        .insert(upserts);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget-category-settings'] });
      toast.success('Budget settings saved successfully');
    },
    onError: (err: any) => {
      toast.error(`Error saving budget settings: ${err.message}`);
    },
  });

  // Fetch saved budget settings for the current filter period (for Budget vs Actual tab)
  const currentBudgetPeriod = useMemo(() => {
    const d = dateRange.startDate;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [dateRange.startDate]);

  const { data: currentBudgetSettings } = useQuery({
    queryKey: ['budget-category-settings-current', organizationId, currentBudgetPeriod],
    queryFn: async () => {
      if (!organizationId) return {};
      const { data, error } = await (supabase as any)
        .from('budget_category_settings')
        .select('category, budget_amount')
        .eq('organization_id', organizationId)
        .eq('period', currentBudgetPeriod);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as any[]) {
        map[row.category] = Number(row.budget_amount) || 0;
      }
      return map;
    },
    enabled: !!organizationId,
  });

  // Calculate dynamic Budget vs Actual using saved budget settings + actuals
  const dynamicBudgetVsActual = useMemo(() => {
    const ci = costImpactData;
    const bs = currentBudgetSettings || {};

    // Actuals
    const actualRevenue = insightsSummary.totalRevenue;
    const actualLabMaterials = (ci?.labFeesCost ?? 0) + (ci?.treatmentMaterialCosts ?? 0);
    const actualStaffCosts = ci?.staffCostsCost ?? 0;
    const actualOperatingLease = ci?.operatingLeasesCost ?? 0;

    // Clinician & overhead from treatment-derived
    let actualClinicianCosts = 0;
    let actualOverhead = 0;
    for (const t of (planningData || [])) {
      actualClinicianCosts += t.associatePay * t.currentVolume;
      actualOverhead += t.opCostPerTreatment * t.currentVolume;
    }

    // Budget from saved budget_category_settings
    const budgetRevenue = bs['Revenue'] ?? 0;
    const budgetClinicianCosts = bs['Clinician Costs'] ?? 0;
    const budgetStaffCosts = bs['Staff Costs'] ?? 0;
    const budgetLabMaterials = bs['Lab & Materials'] ?? 0;
    const budgetOverhead = bs['Overhead'] ?? 0;
    const budgetOperatingLease = bs['Operating Lease'] ?? 0;
    const budgetEbitda = bs['EBITDA'] ?? 0;

    const actualTotalCosts = actualClinicianCosts + actualStaffCosts + actualLabMaterials + actualOverhead + actualOperatingLease;
    const actualEbitda = actualRevenue - actualTotalCosts;

    const row = (category: string, budget: number, actual: number) => {
      const variance = actual - budget;
      const variancePercent = budget !== 0 ? +((actual / budget - 1) * 100).toFixed(1) : 0;
      return { category, budget: Math.round(budget * 100) / 100, actual: Math.round(actual * 100) / 100, variance: Math.round(variance * 100) / 100, variancePercent };
    };

    return [
      row('Revenue', budgetRevenue, actualRevenue),
      row('Clinician Costs', budgetClinicianCosts, actualClinicianCosts),
      row('Staff Costs', budgetStaffCosts, actualStaffCosts),
      row('Lab & Materials', budgetLabMaterials, actualLabMaterials),
      row('Overhead', budgetOverhead, actualOverhead),
      row('Operating Lease', budgetOperatingLease, actualOperatingLease),
      row('EBITDA', budgetEbitda, actualEbitda),
    ];
  }, [planningData, insightsSummary.totalRevenue, costImpactData, currentBudgetSettings]);

  // Calculate totals for Budget vs Actual
  const totalBudget = dynamicBudgetVsActual.find(b => b.category === 'Revenue')?.budget || 0;
  const totalActual = dynamicBudgetVsActual.find(b => b.category === 'Revenue')?.actual || 0;
  const totalVariance = totalActual - totalBudget;
  const totalVariancePercent = totalBudget !== 0 ? ((totalActual / totalBudget - 1) * 100).toFixed(1) : '0.0';

  const chartData = dynamicBudgetVsActual.map(item => ({
    category: item.category,
    budget: item.budget,
    actual: item.actual,
  }));

  // Calculate associate totals (now dynamic)
  const { totalCurrentProfit, totalPlannedProfit, profitGrowth } = useMemo(() => {
    const tcp = associatePlanningData.reduce((sum, a) => sum + a.currentProfit, 0);
    const tpp = associatePlanningData.reduce((sum, a) => sum + a.plannedProfit, 0);
    const growth = tcp !== 0 ? ((tpp / tcp - 1) * 100).toFixed(1) : '0.0';
    return { totalCurrentProfit: tcp, totalPlannedProfit: tpp, profitGrowth: growth };
  }, [associatePlanningData]);

  // Treatment summary metrics
  const treatmentSummary = useMemo(() => {
    const activeTreatments = planningData.filter(t => t.currentVolume > 0).length;
    const totalRevenue = planningData.reduce((sum, t) => sum + t.currentRevenue, 0);
    const totalProfitLoss = planningData.reduce((sum, t) => sum + t.totalProfitLoss, 0);
    const avgPlMargin = totalRevenue !== 0 ? (totalProfitLoss / totalRevenue) * 100 : 0;
    return { activeTreatments, totalRevenue, totalProfitLoss, avgPlMargin };
  }, [planningData]);

  // Revenue vs Profit by category (for chart 1)
  const categoryProfitData = useMemo(() => {
    const categoryTotals = new Map<string, { revenue: number; profit: number }>();
    planningData.forEach(treatment => {
      const category = treatment.categoryName || 'Uncategorized';
      const existing = categoryTotals.get(category) || { revenue: 0, profit: 0 };
      existing.revenue += treatment.currentRevenue;
      existing.profit += treatment.totalProfitLoss;
      categoryTotals.set(category, existing);
    });
    return Array.from(categoryTotals.entries())
      .map(([category, totals]) => ({ category, revenue: totals.revenue, profit: totals.profit }))
      .filter(d => d.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [planningData]);

  // Top 5 treatments by profit (for chart 2)
  const topTreatmentsByProfit = useMemo(() => {
    return [...planningData]
      .filter(t => t.currentVolume > 0)
      .sort((a, b) => b.totalProfitLoss - a.totalProfitLoss)
      .slice(0, 5)
      .map(t => ({
        treatment: t.treatmentName.length > 20 ? t.treatmentName.substring(0, 20) + '...' : t.treatmentName,
        profit: t.totalProfitLoss,
      }));
  }, [planningData]);

  // P/L % lookup for top treatments tooltip (kept outside chart data to avoid gray bar)
  const topTreatmentPlPercent = useMemo(() => {
    const m = new Map<string, { fullName: string; plPercent: number }>();
    planningData
      .filter(t => t.currentVolume > 0)
      .sort((a, b) => b.totalProfitLoss - a.totalProfitLoss)
      .slice(0, 5)
      .forEach(t => {
        const key = t.treatmentName.length > 20 ? t.treatmentName.substring(0, 20) + '...' : t.treatmentName;
        m.set(key, { fullName: t.treatmentName, plPercent: t.plPercent });
      });
    return m;
  }, [planningData]);

  // Handle save plan (kept for future use when inline editing is implemented)
  const _handleSavePlan = async () => {
    try {
      const plansToSave = planningData.map(treatment => ({
        treatmentId: treatment.treatmentId,
        plannedVolume: treatment.plannedVolume,
        plannedRevenue: treatment.plannedRevenue,
        targetMargin: treatment.targetMargin,
      }));

      await saveBudgetPlans(plansToSave);
      toast.success('Treatment plan saved successfully');
    } catch (error: any) {
      toast.error(`Failed to save plan: ${error.message}`);
    }
  };

  // Filter and sort treatment planning data
  const filteredPlanningData = useMemo(() => {
    let data = planningData;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      data = data.filter(treatment =>
        treatment.treatmentName.toLowerCase().includes(query) ||
        (treatment.categoryName || '').toLowerCase().includes(query)
      );
    }
    const treatmentSort = sortState['treatment'];
    if (treatmentSort) {
      data = [...data].sort((a, b) => {
        const col = treatmentSort.column;
        const aVal = (a as any)[col];
        const bVal = (b as any)[col];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return treatmentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return treatmentSort.direction === 'asc'
          ? String(aVal || '').localeCompare(String(bVal || ''))
          : String(bVal || '').localeCompare(String(aVal || ''));
      });
    }
    return data;
  }, [planningData, searchQuery, sortState]);

  const paginatedPlanningData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredPlanningData.slice(startIndex, endIndex);
  }, [filteredPlanningData, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredPlanningData.length / itemsPerPage);

  // Reset to page 1 when search or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortState, itemsPerPage]);

  // Calculate totals from filtered data (weighted averages for per-unit, sums for totals)
  const filteredTotals = useMemo(() => {
    const n = filteredPlanningData.reduce((sum, t) => sum + t.currentVolume, 0);
    const totalRevenue = filteredPlanningData.reduce((sum, t) => sum + t.currentRevenue, 0);
    const totalExpense = filteredPlanningData.reduce((sum, t) => sum + t.totalExpense, 0);
    const totalPL = totalRevenue - totalExpense;
    const totalPrincipalProfit = filteredPlanningData.reduce((sum, t) => sum + t.principalProfit, 0);

    // Sum of per-unit column values across all rows
    const avgIncome = filteredPlanningData.reduce((s, t) => s + t.avgIncome, 0);
    const expensePerUnit = filteredPlanningData.reduce((s, t) => s + t.expensePerUnit, 0);
    const plPerUnit = filteredPlanningData.reduce((s, t) => s + t.profitLossPerUnit, 0);

    const overallPlPercent = totalRevenue !== 0 ? (totalPL / totalRevenue) * 100 : 0;
    const principalProfitPercent = totalRevenue !== 0 ? (totalPrincipalProfit / totalRevenue) * 100 : 0;

    return {
      totalVolume: n, avgIncome, expensePerUnit, plPerUnit,
      totalRevenue, totalExpense, totalPL,
      totalPrincipalProfit, overallPlPercent, principalProfitPercent,
    };
  }, [filteredPlanningData]);

  // Profit Planning Calculator - available treatments from Treatment Setup
  const caseTypes = useMemo(() => {
    return setupTreatments
      .map(t => {
        const catName = t.category && !('deleted_at' in t.category && t.category.deleted_at)
          ? t.category.name : null;
        return { id: t.id, name: t.treatment_name, category: catName };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [setupTreatments]);

  // Profit Planning Calculator - defaults from Treatment Setup values
  const categoryDefaults = useMemo(() => {
    if (!selectedCaseType) return null;
    const t = setupTreatments.find(t => t.id === selectedCaseType);
    if (!t) return null;
    return {
      treatmentValue: t.price ?? 0,
      materials: t.material_cost ?? 0,
      labBill: t.lab_bill ?? 0,
      labBillDiscount: t.lab_bill_discount ?? 0,
      associatePercent: t.percent_fees ?? 0,
      therapistPayPerHour: t.therapist_pay_rate ?? 0,
      operatingCostPerHour: t.hourly_rate ?? 0,
      financeCostPercent: t.finance_fee ?? 0,
      dentistMinutes: t.duration_minutes ?? 0,
      therapistMinutes: t.therapist_time_mins ?? 0,
    };
  }, [setupTreatments, selectedCaseType]);

  // Reset overrides when case type changes; pre-fill Treatment Value with default
  useEffect(() => {
    const t = setupTreatments.find(t => t.id === selectedCaseType);
    setCalcOverrides({
      treatmentValue: t ? String(t.price ?? 0) : '',
      materials: '', labBill: '', labBillDiscount: '',
      associatePercent: '', therapistPayPerHour: '', operatingCostPerHour: '',
      financeCostPercent: '', associateCost: '',
    });
    setTimeOverrides({
      dentistOverride: '', dentistOverrun: '',
      therapistOverride: '', therapistOverrun: '',
    });
  }, [selectedCaseType, setupTreatments]);

  // Helper: get effective value (override if typed, else default)
  const getEff = (override: string, defaultVal: number) =>
    override !== '' ? parseFloat(override) || 0 : defaultVal;

  // Profit Planning Calculator - results
  const calcResults = useMemo(() => {
    if (!categoryDefaults) return null;
    const d = categoryDefaults;
    const tv = getEff(calcOverrides.treatmentValue, d.treatmentValue);
    const mat = getEff(calcOverrides.materials, d.materials);
    const lab = getEff(calcOverrides.labBill, d.labBill);
    const labDisc = getEff(calcOverrides.labBillDiscount, d.labBillDiscount);
    const assocPct = getEff(calcOverrides.associatePercent, d.associatePercent);
    const thPay = getEff(calcOverrides.therapistPayPerHour, d.therapistPayPerHour);
    const opCostHr = getEff(calcOverrides.operatingCostPerHour, d.operatingCostPerHour);
    const finPct = getEff(calcOverrides.financeCostPercent, d.financeCostPercent);
    const assocCostDirect = calcOverrides.associateCost !== '' ? parseFloat(calcOverrides.associateCost) || 0 : null;

    const effectiveLabBill = lab * (1 - labDisc / 100);
    const assocCost = assocCostDirect !== null ? assocCostDirect : (tv - lab) * assocPct / 100;
    const financeCost = tv * finPct / 100;

    // Effective values for variance display
    const effectiveAssocCost = assocCost;

    // Time
    const dentistPlanned = getEff(timeOverrides.dentistOverride, d.dentistMinutes);
    const therapistPlanned = getEff(timeOverrides.therapistOverride, d.therapistMinutes);
    const dentistOverrun = timeOverrides.dentistOverrun !== '' ? parseFloat(timeOverrides.dentistOverrun) || 0 : 0;
    const therapistOverrun = timeOverrides.therapistOverrun !== '' ? parseFloat(timeOverrides.therapistOverrun) || 0 : 0;
    const dentistTotal = dentistPlanned + dentistOverrun;
    const therapistTotal = therapistPlanned + therapistOverrun;
    const totalPlannedMin = dentistPlanned + therapistPlanned;
    const totalMinWithOverrun = dentistTotal + therapistTotal;

    // Time-based costs
    const therapistCostPlanned = thPay * (therapistPlanned / 60);
    const therapistCostOverrun = thPay * (therapistTotal / 60);
    const opCostPlanned = opCostHr * (dentistPlanned / 60);
    const opCostOverrun = opCostHr * (dentistTotal / 60);

    // -- Associate completes work --
    const assocPlannedProfit = tv - mat - effectiveLabBill - assocCost - therapistCostPlanned - opCostPlanned - financeCost;
    const assocOverrunProfit = tv - mat - effectiveLabBill - assocCost - therapistCostOverrun - opCostOverrun - financeCost;
    const assocReduction = assocPlannedProfit - assocOverrunProfit;

    // -- Principal completes work (no associate cost) --
    const princPlannedProfit = tv - mat - effectiveLabBill - therapistCostPlanned - opCostPlanned - financeCost;
    const princOverrunProfit = tv - mat - effectiveLabBill - therapistCostOverrun - opCostOverrun - financeCost;
    const princReduction = princPlannedProfit - princOverrunProfit;

    const pct = (profit: number) => tv !== 0 ? (profit / tv) * 100 : 0;
    const perHr = (profit: number, mins: number) => mins > 0 ? profit / (mins / 60) : 0;

    return {
      effective: {
        treatmentValue: tv, materials: mat, labBill: lab, effectiveLabBill, labBillDiscount: labDisc,
        associatePercent: assocPct, associateCost: effectiveAssocCost, therapistPayPerHour: thPay,
        operatingCostPerHour: opCostHr, financeCostPercent: finPct, financeCost,
      },
      variances: {
        treatmentValue: tv - d.treatmentValue,
        materials: mat - d.materials,
        labBill: lab - d.labBill,
        labBillDiscount: labDisc - d.labBillDiscount,
        associatePercent: assocPct - d.associatePercent,
        therapistPayPerHour: thPay - d.therapistPayPerHour,
        operatingCostPerHour: opCostHr - d.operatingCostPerHour,
        financeCostPercent: finPct - d.financeCostPercent,
        associateCost: effectiveAssocCost - (d.treatmentValue * d.associatePercent / 100),
      },
      time: {
        dentistDefault: d.dentistMinutes, therapistDefault: d.therapistMinutes,
        dentistPlanned, therapistPlanned, dentistOverrun, therapistOverrun,
        dentistTotal, therapistTotal, totalPlannedMin, totalMinWithOverrun,
      },
      associate: {
        plannedProfit: assocPlannedProfit, plannedPct: pct(assocPlannedProfit), plannedPerHr: perHr(assocPlannedProfit, totalPlannedMin),
        overrunProfit: assocOverrunProfit, overrunPct: pct(assocOverrunProfit), overrunPerHr: perHr(assocOverrunProfit, totalMinWithOverrun),
        reduction: assocReduction, reductionPct: pct(assocReduction), reductionPerHr: perHr(assocPlannedProfit, totalPlannedMin) - perHr(assocOverrunProfit, totalMinWithOverrun),
      },
      principal: {
        plannedProfit: princPlannedProfit, plannedPct: pct(princPlannedProfit), plannedPerHr: perHr(princPlannedProfit, totalPlannedMin),
        overrunProfit: princOverrunProfit, overrunPct: pct(princOverrunProfit), overrunPerHr: perHr(princOverrunProfit, totalMinWithOverrun),
        reduction: princReduction, reductionPct: pct(princReduction), reductionPerHr: perHr(princPlannedProfit, totalPlannedMin) - perHr(princOverrunProfit, totalMinWithOverrun),
      },
    };
  }, [categoryDefaults, calcOverrides, timeOverrides]);

  // Sorted budget vs actual data
  const sortedBudgetData = useMemo(() => {
    return applySortToArray('budget', [...dynamicBudgetVsActual], (item, col) => {
      if (col === 'category') return (item as any).category;
      return (item as any)[col] ?? 0;
    });
  }, [sortState, dynamicBudgetVsActual]);

  // Sorted associate data
  const sortedAssociateData = useMemo(() => {
    const filtered = associatePlanningData.filter(a => a.currentRevenue > 0);
    return applySortToArray('associate', filtered, (item, col) => {
      if (col === 'name' || col === 'role') return (item as any)[col] || '';
      if (col === 'growth') {
        return item.currentProfit !== 0 ? ((item.plannedProfit / item.currentProfit - 1) * 100) : 0;
      }
      return (item as any)[col] ?? 0;
    });
  }, [associatePlanningData, sortState]);

  // Sortable table header helper
  const SortableTh = ({ tableKey, column, children, className = '' }: { tableKey: string; column: string; children: React.ReactNode; className?: string }) => (
    <th
      className={cn('cursor-pointer select-none hover:text-primary transition-colors', className)}
      onClick={() => handleSort(tableKey, column)}
    >
      <span className={cn('inline-flex items-center gap-1 justify-center')}>
        {children}
        {getSortIcon(tableKey, column)}
      </span>
    </th>
  );

  // AI context data
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const budgetLineRows = dynamicBudgetVsActual.map((r) => ({
    category: r.category,
    budget: round2(r.budget),
    actual: round2(r.actual),
    variance: round2(r.variance),
    variancePct: round2(r.variancePercent),
  })).slice(0, 50);

  const treatmentRows = planningData
    .filter((t) => t.currentVolume > 0)
    .slice(0, 50)
    .map((t) => ({
      treatment: t.treatmentName,
      category: t.categoryName || 'Uncategorized',
      volume: t.currentVolume,
      revenue: round2(t.currentRevenue),
      profitLoss: round2(t.totalProfitLoss),
      plPercent: round2(t.plPercent),
    }));

  const associateRows = associatePlanningData.slice(0, 50).map((a: any) => ({
    name: a.name,
    role: a.role ?? null,
    currentProfit: round2(a.currentProfit ?? 0),
    plannedProfit: round2(a.plannedProfit ?? 0),
    growthPct: a.currentProfit ? round2(((a.plannedProfit / a.currentProfit) - 1) * 100) : 0,
  }));

  const budgetData = {
    currency: 'GBP',
    currencySymbol: '£',
    totalBudget,
    totalActual,
    variance: totalVariance,
    variancePercent: totalVariancePercent,
    currentProfit: totalCurrentProfit,
    plannedProfit: totalPlannedProfit,
    profitGrowthTarget: profitGrowth,
    treatmentTotalRevenue: treatmentSummary.totalRevenue,
    treatmentTotalProfitLoss: treatmentSummary.totalProfitLoss,
    treatmentAvgMargin: treatmentSummary.avgPlMargin.toFixed(1),
    period: {
      from: dateRange.startDate.toISOString().slice(0, 10),
      to: dateRange.endDate.toISOString().slice(0, 10),
    },
    rows: {
      budgetVsActual: budgetLineRows,
      topTreatments: treatmentRows,
      associates: associateRows,
    },
    rankings: {
      largestNegativeVariance: [...budgetLineRows].filter((r) => r.variance < 0).sort((a, b) => a.variance - b.variance).slice(0, 10),
      largestPositiveVariance: [...budgetLineRows].filter((r) => r.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, 10),
      lossMakingTreatments: [...treatmentRows].filter((t) => t.profitLoss < 0).sort((a, b) => a.profitLoss - b.profitLoss).slice(0, 10),
      topProfitTreatments: [...treatmentRows].sort((a, b) => b.profitLoss - a.profitLoss).slice(0, 10),
    },
  };

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'budget', data: budgetData }}>
      <Helmet>
        <title>{isBudgetMenuSection ? 'Budget' : 'Budget Planning & Analysis'}</title>
        <meta
          name="description"
          content={
            isBudgetMenuSection
              ? 'Track budget vs actual performance and configure budget category targets.'
              : 'Plan and analyze budgets with revenue forecasting, cost projections, and associate profit planning tools.'
          }
        />
      </Helmet>
      <div className="space-y-6 animate-fade-in">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {isBudgetMenuSection ? 'Budget' : 'Budget & Planning'}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isBudgetMenuSection
              ? 'Track budget vs actual performance and configure budget targets'
              : 'Financial planning, forecasting, and growth strategy'}
          </p>
        </div>

        {/* AI Summary */}
        <AISummaryCard page="budget" data={budgetData} />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="bg-muted/50 p-1">
            {isBudgetMenuSection ? (
              <>
                {canViewTab('budget-actual') && (
                <TabsTrigger value="budget-actual" className="gap-2">
                  <Target className="w-4 h-4" />
                  Budget vs Actual
                </TabsTrigger>
                )}
                {canViewTab('budget-settings') && (
                <TabsTrigger value="budget-settings" className="gap-2">
                  <Settings className="w-4 h-4" />
                  Budget Settings
                </TabsTrigger>
                )}
              </>
            ) : (
              <>
                {canViewTab('profit-planning-treatment') && (
                <TabsTrigger value="profit-planning-treatment" className="gap-2">
                  <Calculator className="w-4 h-4" />
                  Profit Planning by Treatment
                </TabsTrigger>
                )}
              </>
            )}
          </TabsList>

          {/* Budget vs Actual Tab */}
          <TabsContent value="budget-actual" className="space-y-6">
            {(isLoadingPlanning || isLoadingCostImpact) ? (<>
              {/* Summary Cards skeleton */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-card rounded-xl border border-border p-5">
                    <Skeleton className="h-4 w-24 mb-2" />
                    <Skeleton className="h-8 w-32" />
                  </div>
                ))}
              </div>
              {/* Chart skeleton */}
              <div className="bg-card rounded-xl border border-border p-5">
                <Skeleton className="h-4 w-48 mb-4" />
                <Skeleton className="h-96 w-full rounded-lg" />
              </div>
              {/* Table skeleton */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="p-5 border-b border-border">
                  <Skeleton className="h-4 w-44" />
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex gap-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-5 flex-1" />
                    ))}
                  </div>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="flex gap-4">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <Skeleton key={j} className="h-5 flex-1" />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </>) : (<>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Budget (MTD)</p>
                <p className="text-2xl font-semibold">{formatCurrencyRound(totalBudget)}</p>
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Actual (MTD)</p>
                <p className="text-2xl font-semibold">{formatCurrencyRound(totalActual)}</p>
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Variance</p>
                <p className={cn(
                  'text-2xl font-semibold',
                  totalVariance < 0 ? 'text-danger' : 'text-success'
                )}>{formatCurrencyRound(totalVariance)}</p>
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Variance %</p>
                <p className={cn(
                  'text-2xl font-semibold',
                  parseFloat(totalVariancePercent) < 0 ? 'text-danger' : 'text-success'
                )}>{parseFloat(totalVariancePercent) > 0 ? '+' : ''}{Math.round(parseFloat(totalVariancePercent))}%</p>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-medium mb-4">Budget vs Actual by Category</h3>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatCurrency(v)} />
                    <YAxis dataKey="category" type="category" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" width={120} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number, name: string) => [<span style={{ color: value < 0 ? 'hsl(var(--destructive))' : undefined }}>{formatCurrency(value)}</span>, name]}
                    />
                    <Legend />
                    <Bar dataKey="budget" name="Budget" fill="hsl(var(--muted-foreground) / 0.3)" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="actual" name="Actual" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Detailed Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="text-sm font-medium">Detailed Variance Analysis</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '18.75%' }} />
                    <col style={{ width: '18.75%' }} />
                    <col style={{ width: '18.75%' }} />
                    <col style={{ width: '18.75%' }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-muted/50">
                      <SortableTh tableKey="budget" column="category">Category</SortableTh>
                      <SortableTh tableKey="budget" column="budget">Budget</SortableTh>
                      <SortableTh tableKey="budget" column="actual">Actual</SortableTh>
                      <SortableTh tableKey="budget" column="variance">Variance (£)</SortableTh>
                      <SortableTh tableKey="budget" column="variancePercent">Variance (%)</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBudgetData.map((item) => (
                      <tr key={item.category}>
                        <td className="font-medium">{item.category}</td>
                        <td>{formatCurrency(item.budget)}</td>
                        <td>{formatCurrency(item.actual)}</td>
                        <td className={cn(
                          'font-medium',
                          item.variance < 0 ? 'text-danger' : 'text-success'
                        )}>
                          {formatCurrency(item.variance)}
                        </td>
                        <td>
                          <TrendIndicator
                            value={item.variancePercent}
                            reverse={item.category !== 'Revenue' && item.category !== 'EBITDA' && item.category !== 'Operating Lease'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </>)}
          </TabsContent>

          {/* Profit Planning by Treatment Tab - Calculator */}
          <TabsContent value="profit-planning-treatment" className="space-y-6">
            {isLoadingSetupTreatments ? (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left: Financials skeleton */}
                <div className="lg:col-span-3 space-y-6">
                  <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="flex items-center gap-2 p-4 border-b border-border">
                      <Skeleton className="w-4 h-4 rounded" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <div className="p-4 space-y-3">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <Skeleton className="h-5 w-32" />
                          <Skeleton className="h-8 w-24" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="flex items-center gap-2 p-4 border-b border-border">
                      <Skeleton className="w-4 h-4 rounded" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                    <div className="p-4 space-y-3">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <Skeleton className="h-5 w-36" />
                          <Skeleton className="h-8 w-24" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Right: Summary skeleton */}
                <div className="lg:col-span-2">
                  <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="flex items-center gap-2 p-4 border-b border-border">
                      <Skeleton className="w-4 h-4 rounded" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <div className="p-4 space-y-3">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <Skeleton className="h-5 w-28" />
                          <Skeleton className="h-5 w-20" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left: Financials */}
              <div className="lg:col-span-3 space-y-6">
                {/* Financials Section */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center gap-2 p-4 border-b border-border">
                    <Calculator className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">Financials</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-primary text-primary-foreground">
                        <th className="text-left py-2.5 px-4 font-medium w-[35%]">Associate</th>
                        <th className="text-center py-2.5 px-4 font-medium w-[20%]">Defaults</th>
                        <th className="text-center py-2.5 px-4 font-medium w-[25%]">Override</th>
                        <th className="text-right py-2.5 px-4 font-medium w-[20%]">Variance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {/* Case Type */}
                      <tr>
                        <td className="py-3 px-4 text-muted-foreground">Case type</td>
                        <td className="py-3 px-4" colSpan={3}>
                          <Popover open={caseTypeOpen} onOpenChange={setCaseTypeOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={caseTypeOpen}
                                className="w-full justify-between h-9 font-normal"
                              >
                                {selectedCaseType
                                  ? (() => {
                                      const ct = caseTypes.find(c => c.id === selectedCaseType);
                                      return ct ? `${ct.name}${ct.category ? ` (${ct.category})` : ''}` : 'Select Case Type';
                                    })()
                                  : 'Select Case Type'}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search treatments..." />
                                <CommandList>
                                  <CommandEmpty>No treatment found.</CommandEmpty>
                                  <CommandGroup className="max-h-64 overflow-y-auto">
                                    {caseTypes.map(ct => (
                                      <CommandItem
                                        key={ct.id}
                                        value={`${ct.name} ${ct.category || ''}`}
                                        onSelect={() => {
                                          setSelectedCaseType(ct.id === selectedCaseType ? '' : ct.id);
                                          setCaseTypeOpen(false);
                                        }}
                                      >
                                        <Check className={cn('mr-2 h-4 w-4', selectedCaseType === ct.id ? 'opacity-100' : 'opacity-0')} />
                                        <span>{ct.name}</span>
                                        {ct.category && <span className="ml-1 text-muted-foreground">({ct.category})</span>}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </td>
                      </tr>
                      {/* Treatment Value */}
                      <tr>
                        <td className="py-3 px-4">Treatment Value</td>
                        <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.treatmentValue ?? 0)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                            <input type="number" min={0} step={1} value={calcOverrides.treatmentValue} placeholder="0"
                              onChange={(e) => setCalcOverrides(p => ({ ...p, treatmentValue: e.target.value }))}
                              className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                              disabled={!selectedCaseType} />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {calcOverrides.treatmentValue !== '' ? formatCurrency(calcResults?.variances.treatmentValue ?? 0) : formatCurrency(0)}
                        </td>
                      </tr>
                      {/* Materials */}
                      <tr>
                        <td className="py-3 px-4">Materials</td>
                        <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.materials ?? 0)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                            <input type="number" min={0} step={0.01} value={calcOverrides.materials} placeholder="0"
                              onChange={(e) => setCalcOverrides(p => ({ ...p, materials: e.target.value }))}
                              className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                              disabled={!selectedCaseType} />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {calcOverrides.materials !== '' ? formatCurrency(calcResults?.variances.materials ?? 0) : formatCurrency(0)}
                        </td>
                      </tr>
                      {/* Lab bill */}
                      <tr>
                        <td className="py-3 px-4">Lab bill</td>
                        <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.labBill ?? 0)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                            <input type="number" min={0} step={0.01} value={calcOverrides.labBill} placeholder="0"
                              onChange={(e) => setCalcOverrides(p => ({ ...p, labBill: e.target.value }))}
                              className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                              disabled={!selectedCaseType} />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {calcOverrides.labBill !== '' ? formatCurrency(calcResults?.variances.labBill ?? 0) : formatCurrency(0)}
                        </td>
                      </tr>
                      {/* Lab bill discount */}
                      <tr>
                        <td className="py-3 px-4">Lab bill discount (%)</td>
                        <td className="py-3 px-4 text-center">{(categoryDefaults?.labBillDiscount ?? 0).toFixed(0)}%</td>
                        <td className="py-3 px-4">
                          <input type="number" min={0} max={100} step={1} value={calcOverrides.labBillDiscount} placeholder="0"
                            onChange={(e) => setCalcOverrides(p => ({ ...p, labBillDiscount: e.target.value }))}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                            disabled={!selectedCaseType} />
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {calcOverrides.labBillDiscount !== '' ? `${(calcResults?.variances.labBillDiscount ?? 0).toFixed(0)}%` : '0%'}
                        </td>
                      </tr>
                      {/* Associate % */}
                      <tr>
                        <td className="py-3 px-4">Associate %</td>
                        <td className="py-3 px-4 text-center">{(categoryDefaults?.associatePercent ?? 0).toFixed(1)}%</td>
                        <td className="py-3 px-4">
                          <input type="number" min={0} max={100} step={1} value={calcOverrides.associatePercent} placeholder="0"
                            onChange={(e) => {
                              const pct = e.target.value;
                              const tv = getEff(calcOverrides.treatmentValue, categoryDefaults?.treatmentValue ?? 0);
                              const lb = getEff(calcOverrides.labBill, categoryDefaults?.labBill ?? 0);
                              const computedCost = pct !== '' ? ((tv - lb) * (parseFloat(pct) || 0) / 100) : '';
                              setCalcOverrides(p => ({ ...p, associatePercent: pct, associateCost: computedCost !== '' ? String(Math.round(computedCost * 100) / 100) : '' }));
                            }}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                            disabled={!selectedCaseType} />
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {calcOverrides.associatePercent !== '' ? `${(calcResults?.variances.associatePercent ?? 0).toFixed(1)}%` : '0%'}
                        </td>
                      </tr>
                      {/* Therapist/hygienist pay per hour */}
                      <tr>
                        <td className="py-3 px-4">Therapist/hygienist pay per hour</td>
                        <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.therapistPayPerHour ?? 0)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                            <input type="number" min={0} step={0.01} value={calcOverrides.therapistPayPerHour} placeholder="0"
                              onChange={(e) => setCalcOverrides(p => ({ ...p, therapistPayPerHour: e.target.value }))}
                              className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                              disabled={!selectedCaseType} />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {calcOverrides.therapistPayPerHour !== '' ? formatCurrency(calcResults?.variances.therapistPayPerHour ?? 0) : formatCurrency(0)}
                        </td>
                      </tr>
                      {/* Operating cost per surgery per hour */}
                      <tr>
                        <td className="py-3 px-4">Operating cost per surgery per hour</td>
                        <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.operatingCostPerHour ?? 0)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                            <input type="number" min={0} step={0.01} value={calcOverrides.operatingCostPerHour} placeholder="0"
                              onChange={(e) => setCalcOverrides(p => ({ ...p, operatingCostPerHour: e.target.value }))}
                              className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                              disabled={!selectedCaseType} />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {calcOverrides.operatingCostPerHour !== '' ? formatCurrency(calcResults?.variances.operatingCostPerHour ?? 0) : formatCurrency(0)}
                        </td>
                      </tr>
                      {/* Finance cost % */}
                      <tr>
                        <td className="py-3 px-4">Finance cost %</td>
                        <td className="py-3 px-4 text-center">{(categoryDefaults?.financeCostPercent ?? 0).toFixed(1)}%</td>
                        <td className="py-3 px-4">
                          <input type="number" min={0} max={100} step={0.1} value={calcOverrides.financeCostPercent} placeholder="0"
                            onChange={(e) => setCalcOverrides(p => ({ ...p, financeCostPercent: e.target.value }))}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                            disabled={!selectedCaseType} />
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {calcOverrides.financeCostPercent !== '' ? `${(calcResults?.variances.financeCostPercent ?? 0).toFixed(1)}%` : '0%'}
                        </td>
                      </tr>
                      {/* Associate cost */}
                      <tr>
                        <td className="py-3 px-4">Associate cost</td>
                        <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults ? categoryDefaults.treatmentValue * categoryDefaults.associatePercent / 100 : 0)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                            <input type="number" min={0} step={0.01} value={calcOverrides.associateCost} placeholder="0"
                              onChange={(e) => setCalcOverrides(p => ({ ...p, associateCost: e.target.value }))}
                              className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                              disabled={!selectedCaseType} />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {calcOverrides.associateCost !== '' || calcOverrides.associatePercent !== '' || calcOverrides.treatmentValue !== ''
                            ? formatCurrency(calcResults?.variances.associateCost ?? 0) : formatCurrency(0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Time Taken Section */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center gap-2 p-4 border-b border-border">
                    <Target className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">Time taken</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-primary text-primary-foreground">
                        <th className="text-left py-2.5 px-4 font-medium w-[25%]">Associate</th>
                        <th className="text-center py-2.5 px-4 font-medium w-[15%]">Defaults</th>
                        <th className="text-center py-2.5 px-4 font-medium w-[15%]">Override</th>
                        <th className="text-center py-2.5 px-4 font-medium w-[15%]">Planned</th>
                        <th className="text-center py-2.5 px-4 font-medium w-[15%]">Overrun</th>
                        <th className="text-center py-2.5 px-4 font-medium w-[15%]">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="py-2 px-4 text-muted-foreground text-xs" colSpan={6}>Time taken in minutes</td>
                      </tr>
                      {/* Dentist */}
                      <tr>
                        <td className="py-3 px-4">Dentist</td>
                        <td className="py-3 px-4 text-center">{categoryDefaults?.dentistMinutes ?? 0}</td>
                        <td className="py-3 px-4">
                          <input type="number" min={0} step={1} value={timeOverrides.dentistOverride} placeholder="0"
                            onChange={(e) => setTimeOverrides(p => ({ ...p, dentistOverride: e.target.value }))}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                            disabled={!selectedCaseType} />
                        </td>
                        <td className="py-3 px-4 text-center font-medium">{calcResults?.time.dentistPlanned ?? 0}</td>
                        <td className="py-3 px-4">
                          <input type="number" min={0} step={1} value={timeOverrides.dentistOverrun} placeholder="0"
                            onChange={(e) => setTimeOverrides(p => ({ ...p, dentistOverrun: e.target.value }))}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                            disabled={!selectedCaseType} />
                        </td>
                        <td className="py-3 px-4 text-center font-semibold">{calcResults?.time.dentistTotal ?? 0}</td>
                      </tr>
                      {/* Therapist/hygienist */}
                      <tr>
                        <td className="py-3 px-4">Therapist/hygienist</td>
                        <td className="py-3 px-4 text-center">{categoryDefaults?.therapistMinutes ?? 0}</td>
                        <td className="py-3 px-4">
                          <input type="number" min={0} step={1} value={timeOverrides.therapistOverride} placeholder="0"
                            onChange={(e) => setTimeOverrides(p => ({ ...p, therapistOverride: e.target.value }))}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                            disabled={!selectedCaseType} />
                        </td>
                        <td className="py-3 px-4 text-center font-medium">{calcResults?.time.therapistPlanned ?? 0}</td>
                        <td className="py-3 px-4">
                          <input type="number" min={0} step={1} value={timeOverrides.therapistOverrun} placeholder="0"
                            onChange={(e) => setTimeOverrides(p => ({ ...p, therapistOverrun: e.target.value }))}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                            disabled={!selectedCaseType} />
                        </td>
                        <td className="py-3 px-4 text-center font-semibold">{calcResults?.time.therapistTotal ?? 0}</td>
                      </tr>
                      {/* Total */}
                      <tr className="bg-muted/30 font-semibold">
                        <td className="py-3 px-4">Total time taken</td>
                        <td className="py-3 px-4 text-center">{(categoryDefaults?.dentistMinutes ?? 0) + (categoryDefaults?.therapistMinutes ?? 0)}</td>
                        <td className="py-3 px-4 text-center">
                          {(timeOverrides.dentistOverride ? parseFloat(timeOverrides.dentistOverride) || 0 : (categoryDefaults?.dentistMinutes ?? 0)) +
                           (timeOverrides.therapistOverride ? parseFloat(timeOverrides.therapistOverride) || 0 : (categoryDefaults?.therapistMinutes ?? 0))}
                        </td>
                        <td className="py-3 px-4 text-center">{calcResults?.time.totalPlannedMin ?? 0}</td>
                        <td className="py-3 px-4 text-center">{(calcResults?.time.dentistOverrun ?? 0) + (calcResults?.time.therapistOverrun ?? 0)}</td>
                        <td className="py-3 px-4 text-center text-primary">{calcResults?.time.totalMinWithOverrun ?? 0}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right: Results */}
              <div className="lg:col-span-2">
                <div className="bg-card rounded-xl border border-border overflow-hidden sticky top-4">
                  <div className="flex items-center gap-2 p-4 border-b border-border">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">Results</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-primary text-primary-foreground">
                        <th className="text-left py-2.5 px-4 font-medium w-[40%]"></th>
                        <th className="text-right py-2.5 px-4 font-medium w-[25%]">Total £</th>
                        <th className="text-right py-2.5 px-4 font-medium w-[18%]">Profit %</th>
                        <th className="text-right py-2.5 px-4 font-medium w-[17%]">Per hour £</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {/* Associate completes work */}
                      <tr>
                        <td className="py-3 px-4 font-semibold" colSpan={4}>Associate completes work</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 text-muted-foreground pl-6">Total profit of planned patient journey</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.associate.plannedProfit ?? 0)}</td>
                        <td className="py-2.5 px-4 text-right">{(calcResults?.associate.plannedPct ?? 0).toFixed(2)} %</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.associate.plannedPerHr ?? 0)}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 text-muted-foreground pl-6">Total profit after overruns</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.associate.overrunProfit ?? 0)}</td>
                        <td className="py-2.5 px-4 text-right">{(calcResults?.associate.overrunPct ?? 0).toFixed(2)} %</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.associate.overrunPerHr ?? 0)}</td>
                      </tr>
                      <tr className="bg-muted/20">
                        <td className="py-2.5 px-4 font-semibold pl-6">Reduction in profit for overruns</td>
                        <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.associate.reduction ?? 0) > 0 ? 'text-destructive' : '')}>
                          {formatCurrency(calcResults?.associate.reduction ?? 0)}
                        </td>
                        <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.associate.reductionPct ?? 0) > 0 ? 'text-destructive' : '')}>
                          {(calcResults?.associate.reductionPct ?? 0).toFixed(2)}%
                        </td>
                        <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.associate.reductionPerHr ?? 0) > 0 ? 'text-destructive' : '')}>
                          {formatCurrency(calcResults?.associate.reductionPerHr ?? 0)}
                        </td>
                      </tr>

                      {/* Principal completes work */}
                      <tr>
                        <td className="py-3 px-4 font-semibold" colSpan={4}>Principal completes work</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 text-muted-foreground pl-6">Total profit of planned patient journey</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.principal.plannedProfit ?? 0)}</td>
                        <td className="py-2.5 px-4 text-right">{(calcResults?.principal.plannedPct ?? 0).toFixed(2)} %</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.principal.plannedPerHr ?? 0)}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 text-muted-foreground pl-6">Total profit after overruns</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.principal.overrunProfit ?? 0)}</td>
                        <td className="py-2.5 px-4 text-right">{(calcResults?.principal.overrunPct ?? 0).toFixed(2)} %</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.principal.overrunPerHr ?? 0)}</td>
                      </tr>
                      <tr className="bg-muted/20">
                        <td className="py-2.5 px-4 font-semibold pl-6">Reduction in profit for overruns</td>
                        <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.principal.reduction ?? 0) > 0 ? 'text-destructive' : '')}>
                          {formatCurrency(calcResults?.principal.reduction ?? 0)}
                        </td>
                        <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.principal.reductionPct ?? 0) > 0 ? 'text-destructive' : '')}>
                          {(calcResults?.principal.reductionPct ?? 0).toFixed(2)}%
                        </td>
                        <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.principal.reductionPerHr ?? 0) > 0 ? 'text-destructive' : '')}>
                          {formatCurrency(calcResults?.principal.reductionPerHr ?? 0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {!selectedCaseType && (
                    <div className="p-6 text-center text-muted-foreground text-sm">
                      Select a Case Type to see profit calculations
                    </div>
                  )}
                </div>
              </div>
            </div>
            )}
          </TabsContent>

          <TabsContent value="budget-settings" className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">Budget Settings</h2>
                <p className="text-sm text-muted-foreground">Set monthly budget targets for each category</p>
              </div>
              {can('budget', 'update', 'budget_settings_tab') && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    const edits: Record<string, number | null> = {};
                    for (const cat of BUDGET_CATEGORIES) edits[cat] = null;
                    setBudgetEdits(edits);
                  }}
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </Button>
                <Button
                  className="gap-2"
                  onClick={() => saveBudgetSettingsMutation.mutate()}
                  disabled={saveBudgetSettingsMutation.isPending}
                >
                  {saveBudgetSettingsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Budget
                </Button>
              </div>
              )}
            </div>

            {/* Period Configuration */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Period Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Period Type */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground">Period Type</label>
                    <Select value={bsPeriodType} onValueChange={(v) => handleBsPeriodTypeChange(v as BudgetPeriodType)} disabled={!can('budget', 'update', 'budget_settings_tab')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="month">Month</SelectItem>

                        <SelectItem value="year">Year</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Actual FY */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground">Actual FY</label>
                    <Select value={bsActualValue} onValueChange={setBsActualValue} disabled={!can('budget', 'update', 'budget_settings_tab')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {bsPeriodOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {bsActualFYLabel && <span className="text-xs text-muted-foreground">{bsActualFYLabel}</span>}
                  </div>

                  {/* Planning FY */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground">Planning FY</label>
                    <Select value={bsPlanningValue} onValueChange={setBsPlanningValue} disabled={!can('budget', 'update', 'budget_settings_tab')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {bsPeriodOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {bsPlanningFYLabel && <span className="text-xs text-muted-foreground">{bsPlanningFYLabel}</span>}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Budget Categories Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="text-sm font-medium">Category Budget Targets</h3>
              </div>
              {isLoadingBudgetSettings ? (
                <div className="p-4 space-y-3">
                  <div className="flex gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-5 flex-1" />
                    ))}
                  </div>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="flex gap-4">
                      {Array.from({ length: 3 }).map((_, j) => (
                        <Skeleton key={j} className="h-8 flex-1" />
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: '35%' }} />
                      <col style={{ width: '30%' }} />
                      <col style={{ width: '35%' }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400">Category</th>
                        <th className="uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400">Budget Amount</th>
                        <th className="uppercase text-xs tracking-wider font-semibold text-teal-700 dark:text-teal-400">Current Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {BUDGET_CATEGORIES.map((cat) => {
                        let currentActual = bsActualData?.[cat] ?? 0;
                        // Revenue: use Treatment Insights if Actual FY matches global filter, else use RPC
                        if (cat === 'Revenue') {
                          const globalPeriod = `${dateRange.startDate.getFullYear()}-${String(dateRange.startDate.getMonth() + 1).padStart(2, '0')}`;
                          const actualPeriod = bsActualDateRange.start.slice(0, 7);
                          currentActual = globalPeriod === actualPeriod ? insightsSummary.totalRevenue : (bsActualData?.['Revenue'] ?? 0);
                        }
                        // EBITDA = Revenue - all costs
                        if (cat === 'EBITDA') {
                          const globalPeriod = `${dateRange.startDate.getFullYear()}-${String(dateRange.startDate.getMonth() + 1).padStart(2, '0')}`;
                          const actualPeriod = bsActualDateRange.start.slice(0, 7);
                          const rev = globalPeriod === actualPeriod ? insightsSummary.totalRevenue : (bsActualData?.['Revenue'] ?? 0);
                          const costs = ['Clinician Costs', 'Staff Costs', 'Lab & Materials', 'Overhead', 'Operating Lease']
                            .reduce((s, c) => s + (bsActualData?.[c] ?? 0), 0);
                          currentActual = rev - costs;
                        }

                        return (
                          <tr key={cat}>
                            <td className="font-medium">{cat}</td>
                            <td>
                              <div className="flex items-center gap-1">
                                <span className="text-muted-foreground text-sm">£</span>
                                <Input
                                  type="number"
                                  value={budgetEdits[cat] !== null && budgetEdits[cat] !== undefined ? budgetEdits[cat] : ''}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    const num = v === '' ? null : parseFloat(v);
                                    setBudgetEdits(prev => ({ ...prev, [cat]: num }));
                                  }}
                                  className="w-32"
                                  min="0"
                                  step="0.01"
                                  placeholder="0.00"
                                  disabled={!can('budget', 'update', 'budget_settings_tab')}
                                />
                              </div>
                            </td>
                            <td className={cn(
                              'font-medium',
                              currentActual < 0 ? 'text-danger' : 'text-success'
                            )}>
                              {formatCurrency(currentActual)}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Totals Row */}
                      <tr className="font-semibold border-t-2 bg-muted/30">
                        <td>Total</td>
                        <td>
                          {formatCurrency(BUDGET_CATEGORIES.reduce((s, cat) => s + (budgetEdits[cat] ?? 0), 0))}
                        </td>
                        <td>
                          {(() => {
                            const gp = `${dateRange.startDate.getFullYear()}-${String(dateRange.startDate.getMonth() + 1).padStart(2, '0')}`;
                            const ap = bsActualDateRange.start.slice(0, 7);
                            const rev = gp === ap ? insightsSummary.totalRevenue : (bsActualData?.['Revenue'] ?? 0);
                            const costs = ['Clinician Costs', 'Staff Costs', 'Lab & Materials', 'Overhead', 'Operating Lease']
                              .reduce((sum, c) => sum + (bsActualData?.[c] ?? 0), 0);
                            const ebitda = rev - costs;
                            return formatCurrency(
                              BUDGET_CATEGORIES.reduce((s, cat) => {
                                if (cat === 'Revenue') return s + rev;
                                if (cat === 'EBITDA') return s + ebitda;
                                return s + (bsActualData?.[cat] ?? 0);
                              }, 0)
                            );
                          })()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
