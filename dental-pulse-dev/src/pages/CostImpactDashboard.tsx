import { useState, useRef, useMemo } from 'react';
import { format } from 'date-fns';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { useExpenseAccountSettings } from '@/hooks/useExpenseAccountSettings';
import { useConnectedIntegration } from '@/hooks/useConnectedIntegration';
import { useFilters } from '@/contexts/FilterContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, TrendingDown, ArrowRight, Calculator, FileSpreadsheet, FileText, Layers, FlaskConical, UserCog, Building2, Target, Zap, BarChart3, Activity, Bookmark, GitCompare, Loader2, Megaphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCostImpactData } from '@/hooks/useCostImpactData';
import { useAllProvidersNetProduction } from '@/hooks/useAllProvidersNetProduction';
import { useLocationIncomeAccountingTotals } from '@/hooks/useLocationIncomeAccountingTotals';
import { composeProductionIncome } from '@/utils/profitBenchmarkActual';
import { useLocationCoaMappings } from '@/hooks/useLocationCoaMappings';
import { getPreviousDateRange } from '@/utils/dateRangeUtils';

import { EBITDAProjectionChart } from '@/components/costs/EBITDAProjectionChart';
import { SensitivityAnalysis } from '@/components/costs/SensitivityAnalysis';
import { SavedScenariosPanel } from '@/components/costs/SavedScenariosPanel';
import { ScenarioComparison } from '@/components/costs/ScenarioComparison';
import { GoalSeekCalculator } from '@/components/costs/GoalSeekCalculator';

// Scenario presets
const scenarioPresets = [
  {
    id: 'custom',
    name: 'Custom',
    description: 'Set your own percentages',
    labFees: 0, staffCosts: 0, operatingLeases: 0, clinicianCost: 0, overheadCost: 0, materialCost: 0, marketingCost: 0,
  },
  {
    id: 'conservative',
    name: 'Conservative Reduction',
    description: '5% reduction across all costs',
    labFees: -5, staffCosts: -5, operatingLeases: -5, clinicianCost: -5, overheadCost: -5, materialCost: -5, marketingCost: -5,
  },
  {
    id: 'moderate',
    name: 'Moderate Savings',
    description: '10% reduction with focus on staff',
    labFees: -8, staffCosts: -12, operatingLeases: -6, clinicianCost: -10, overheadCost: -8, materialCost: -8, marketingCost: -10,
  },
  {
    id: 'aggressive',
    name: 'Aggressive Savings',
    description: '15-20% reduction targeting major costs',
    labFees: -15, staffCosts: -20, operatingLeases: -10, clinicianCost: -18, overheadCost: -12, materialCost: -15, marketingCost: -18,
  },
  {
    id: 'growth',
    name: 'Growth Scenario',
    description: 'Projected cost increases with expansion',
    labFees: 10, staffCosts: 15, operatingLeases: 8, clinicianCost: 12, overheadCost: 10, materialCost: 8, marketingCost: 12,
  },
  {
    id: 'inflation',
    name: 'Inflation Impact',
    description: '5-8% increase due to inflation',
    labFees: 6, staffCosts: 8, operatingLeases: 5, clinicianCost: 7, overheadCost: 6, materialCost: 6, marketingCost: 6,
  },
];

const formatCurrency = (value: number) => {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Revenue is legitimately 0 whenever the period has no completed, paid
// treatments — a ratio against it is undefined rather than infinite, so show
// a dash instead of the Infinity%/NaN% that a raw division produces.
const formatPercentOfRevenue = (value: number, revenue: number) =>
  revenue > 0 ? `${((value / revenue) * 100).toFixed(1)}%` : '—';

interface CostCenterData {
  key: 'labFees' | 'staff' | 'operatingLease' | 'clinicianCost' | 'overheadCost' | 'materialCost' | 'marketingCost';
  name: string;
  icon: React.ElementType;
  currentCost: number;
  // Same cost bucket for the PREVIOUS period — used for the period-over-period
  // "% Change" / "Cost Change" columns in the Detailed Cost Breakdown.
  previousCost: number;
  percentOfRevenue: number;
  percentChange: number;
  colorClass: string;
}

export default function CostImpactDashboard() {
  const [selectedPreset, setSelectedPreset] = useState('custom');
  const [labFeesPercent, setLabFeesPercent] = useState('0');
  const [staffCostsPercent, setStaffCostsPercent] = useState('0');
  const [operatingLeasesPercent, setOperatingLeasesPercent] = useState('0');
  const [clinicianCostPercent, setClinicianCostPercent] = useState('0');
  const [overheadCostPercent, setOverheadCostPercent] = useState('0');
  const [materialCostPercent, setMaterialCostPercent] = useState('0');
  const [marketingCostPercent, setMarketingCostPercent] = useState('0');
  const reportRef = useRef<HTMLDivElement>(null);
  const { selectedLocationId, selectedDateRangeId, dateRange } = useFilters();
  const expenseSettings = useExpenseAccountSettings(selectedLocationId);
  const { displayName: integrationName } = useConnectedIntegration();
  const { data: costData, isLoading: isCostDataLoading } = useCostImpactData();
  // Previous period (e.g. "Last Month" → the month before) — drives the
  // period-over-period "% Change" / "Cost Change" columns in the breakdown.
  const previousDateRange = useMemo(
    () => getPreviousDateRange(selectedDateRangeId, dateRange),
    [selectedDateRangeId, dateRange],
  );
  const { data: prevCostData } = useCostImpactData({ dateRangeOverride: previousDateRange });
  const { mappings: locationCoaMappings } = useLocationCoaMappings();
  // planningData no longer used — costs come only from mapped expense accounts

  // Revenue = Profit Benchmark / Profitability Total Production
  // (Private + Membership + NHS; Accounting App when mapped, else Provider Net Production)
  const locationIdForIncome =
    selectedLocationId && String(selectedLocationId).toLowerCase() !== 'all'
      ? selectedLocationId
      : null;
  const fromDateStr = format(dateRange.startDate, 'yyyy-MM-dd');
  const toDateStr = format(dateRange.endDate, 'yyyy-MM-dd');
  const { data: providerProduction } = useAllProvidersNetProduction(
    null,
    dateRange.startDate,
    dateRange.endDate,
    locationIdForIncome,
  );
  const { data: accountingIncome } = useLocationIncomeAccountingTotals(
    fromDateStr,
    toDateStr,
    locationIdForIncome,
  );
  const totalRevenue = useMemo(
    () =>
      Math.abs(
        composeProductionIncome(
          providerProduction?.providers ?? [],
          accountingIncome,
        ),
      ),
    [providerProduction, accountingIncome],
  );

  // Percent state setters by key
  const percentSetters: Record<string, (v: string) => void> = {
    labFees: setLabFeesPercent,
    staff: setStaffCostsPercent,
    operatingLease: setOperatingLeasesPercent,
    clinicianCost: setClinicianCostPercent,
    overheadCost: setOverheadCostPercent,
    materialCost: setMaterialCostPercent,
    marketingCost: setMarketingCostPercent,
  };

  // Apply preset when selected
  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId);
    const preset = scenarioPresets.find(p => p.id === presetId);
    if (preset) {
      setLabFeesPercent(preset.labFees.toString());
      setStaffCostsPercent(preset.staffCosts.toString());
      setOperatingLeasesPercent(preset.operatingLeases.toString());
      setClinicianCostPercent(preset.clinicianCost.toString());
      setOverheadCostPercent(preset.overheadCost.toString());
      setMaterialCostPercent(preset.materialCost.toString());
      setMarketingCostPercent(preset.marketingCost.toString());
    }
  };

  // Parse percentages
  const labFeesPct = parseFloat(labFeesPercent) || 0;
  const staffCostsPct = parseFloat(staffCostsPercent) || 0;
  const operatingLeasesPct = parseFloat(operatingLeasesPercent) || 0;
  const clinicianCostPct = parseFloat(clinicianCostPercent) || 0;
  const overheadCostPct = parseFloat(overheadCostPercent) || 0;
  const materialCostPct = parseFloat(materialCostPercent) || 0;
  const marketingCostPct = parseFloat(marketingCostPercent) || 0;

  // Percent values by key
  const percentValues: Record<string, string> = {
    labFees: labFeesPercent,
    staff: staffCostsPercent,
    operatingLease: operatingLeasesPercent,
    clinicianCost: clinicianCostPercent,
    overheadCost: overheadCostPercent,
    materialCost: materialCostPercent,
    marketingCost: marketingCostPercent,
  };

  // Cost centers — only from mapped expense accounts (Iplicit P&L / GL)
  const labFeesCost = costData?.labFeesCost ?? 0;
  const staffCostsCost = costData?.staffCostsCost ?? 0;
  const operatingLeasesCost = costData?.operatingLeasesCost ?? 0;
  const clinicianCostCost = costData?.clinicianCostCost ?? 0;
  const overheadCostCost = costData?.overheadCostCost ?? 0;
  const materialCostCost = costData?.materialCostCost ?? 0;
  const marketingCostCost = costData?.marketingCostCost ?? 0;

  // Previous-period costs (drive the period-over-period breakdown columns).
  const prevLabFeesCost = prevCostData?.labFeesCost ?? 0;
  const prevStaffCostsCost = prevCostData?.staffCostsCost ?? 0;
  const prevOperatingLeasesCost = prevCostData?.operatingLeasesCost ?? 0;
  const prevClinicianCostCost = prevCostData?.clinicianCostCost ?? 0;
  const prevOverheadCostCost = prevCostData?.overheadCostCost ?? 0;
  const prevMaterialCostCost = prevCostData?.materialCostCost ?? 0;
  const prevMarketingCostCost = prevCostData?.marketingCostCost ?? 0;

  // EBITDA = Revenue - Total Costs (same as Budget vs Actual)
  const currentTotalCostsForEbitda = labFeesCost + staffCostsCost + operatingLeasesCost + clinicianCostCost + overheadCostCost + materialCostCost + marketingCostCost;
  const currentEBITDA = totalRevenue - currentTotalCostsForEbitda;

  const allCostCenters: CostCenterData[] = [
    {
      key: 'materialCost',
      name: 'Material Costs',
      icon: Target,
      currentCost: materialCostCost,
      previousCost: prevMaterialCostCost,
      percentOfRevenue: totalRevenue > 0 ? (materialCostCost / totalRevenue) * 100 : 0,
      percentChange: materialCostPct,
      colorClass: 'text-cyan-500',
    },
    {
      key: 'labFees',
      name: 'Lab fees',
      icon: FlaskConical,
      currentCost: labFeesCost,
      previousCost: prevLabFeesCost,
      percentOfRevenue: totalRevenue > 0 ? (labFeesCost / totalRevenue) * 100 : 0,
      percentChange: labFeesPct,
      colorClass: 'text-blue-500',
    },
    {
      key: 'clinicianCost',
      name: 'Clinician Costs',
      icon: Activity,
      currentCost: clinicianCostCost,
      previousCost: prevClinicianCostCost,
      percentOfRevenue: totalRevenue > 0 ? (clinicianCostCost / totalRevenue) * 100 : 0,
      percentChange: clinicianCostPct,
      colorClass: 'text-emerald-500',
    },
    {
      key: 'staff',
      name: 'Staff Costs',
      icon: UserCog,
      currentCost: staffCostsCost,
      previousCost: prevStaffCostsCost,
      percentOfRevenue: totalRevenue > 0 ? (staffCostsCost / totalRevenue) * 100 : 0,
      percentChange: staffCostsPct,
      colorClass: 'text-purple-500',
    },
    {
      key: 'operatingLease',
      name: 'Operating Leases',
      icon: Building2,
      currentCost: operatingLeasesCost,
      previousCost: prevOperatingLeasesCost,
      percentOfRevenue: totalRevenue > 0 ? (operatingLeasesCost / totalRevenue) * 100 : 0,
      percentChange: operatingLeasesPct,
      colorClass: 'text-orange-500',
    },
    {
      key: 'overheadCost',
      name: 'Overhead Costs',
      icon: Layers,
      currentCost: overheadCostCost,
      previousCost: prevOverheadCostCost,
      percentOfRevenue: totalRevenue > 0 ? (overheadCostCost / totalRevenue) * 100 : 0,
      percentChange: overheadCostPct,
      colorClass: 'text-rose-500',
    },
    {
      key: 'marketingCost',
      name: 'Marketing Costs',
      icon: Megaphone,
      currentCost: marketingCostCost,
      previousCost: prevMarketingCostCost,
      percentOfRevenue: totalRevenue > 0 ? (marketingCostCost / totalRevenue) * 100 : 0,
      percentChange: marketingCostPct,
      colorClass: 'text-pink-500',
    },
  ];

  // Filter cost centers based on expense account settings
  // If no accounts are configured anywhere, show all for backward compatibility
  const costCenters = useMemo(() => {
    if (!expenseSettings.hasAnyAccounts) return allCostCenters;
    return allCostCenters.filter((center) => {
      if (center.key === 'labFees') return expenseSettings.labFees.hasAccounts;
      if (center.key === 'staff') return expenseSettings.staffCosts.hasAccounts;
      if (center.key === 'operatingLease') return expenseSettings.operatingLease.hasAccounts;
      if (center.key === 'clinicianCost') return expenseSettings.clinicianCost.hasAccounts;
      if (center.key === 'overheadCost') return expenseSettings.overheadCost.hasAccounts;
      if (center.key === 'materialCost') return expenseSettings.materialCost.hasAccounts;
      if (center.key === 'marketingCost') return expenseSettings.marketingCost.hasAccounts;
      return false;
    });
  }, [expenseSettings, labFeesPct, staffCostsPct, operatingLeasesPct, clinicianCostPct, overheadCostPct, materialCostPct, marketingCostPct, costData, prevCostData]);

  // Derive totals from filtered cost centers
  const currentTotalCosts = costCenters.reduce((sum, c) => sum + c.currentCost, 0);
  const totalChange = costCenters.reduce((sum, c) => sum + c.currentCost * (c.percentChange / 100), 0);
  const newTotalCosts = currentTotalCosts + totalChange;

  // Period-over-period totals (selected filter period vs the previous one).
  const previousTotalCosts = costCenters.reduce((sum, c) => sum + c.previousCost, 0);
  const totalPeriodCostChange = currentTotalCosts - previousTotalCosts;
  const totalPeriodPctChange = previousTotalCosts !== 0
    ? (totalPeriodCostChange / previousTotalCosts) * 100
    : null;

  // EBITDA impact (cost increase = EBITDA decrease)
  const ebitdaImpact = -totalChange;
  const newEBITDA = currentEBITDA + ebitdaImpact;
  // null when revenue is unknown — every consumer renders "n/a" instead.
  const ebitdaMarginChange = totalRevenue > 0 ? (ebitdaImpact / totalRevenue) * 100 : null;
  const marginImpactLabel = ebitdaMarginChange === null
    ? 'n/a'
    : `${ebitdaMarginChange >= 0 ? '+' : ''}${ebitdaMarginChange.toFixed(2)}%`;

  // Handler for loading saved scenarios (dynamic)
  const handleLoadScenario = (percents: Record<string, number>) => {
    for (const center of costCenters) {
      const pct = percents[center.key];
      if (pct !== undefined && percentSetters[center.key]) {
        percentSetters[center.key](pct.toString());
      }
    }
    setSelectedPreset('custom');
  };

  // Handler for goal-seek solution (dynamic)
  const handleApplyGoalSeekSolution = (percentages: Record<string, number>) => {
    for (const center of costCenters) {
      const pct = percentages[center.key];
      if (pct !== undefined && percentSetters[center.key]) {
        percentSetters[center.key](pct.toString());
      }
    }
    setSelectedPreset('custom');
  };

  // Context for the chatbot — exposes the chart-of-account mappings, the
  // connected accounting platform, and current cost values so the bot can
  // answer "which CoA is mapped for lab fees" without scraping the DOM.
  const aiContextData = useMemo(() => {
    const buildCategory = (label: string, c: { accounts?: { code: string; name: string }[]; accountCodes?: string[]; hasAccounts?: boolean }, currentCost: number) => {
      const accounts = c?.accounts ?? [];
      const codes = c?.accountCodes ?? [];
      return {
        label,
        currentCost,
        mappedAccounts: accounts.length > 0
          ? accounts.map(a => ({ code: a.code, name: a.name }))
          : codes.map(code => ({ code, name: '' })),
        hasMapping: Boolean(c?.hasAccounts),
      };
    };
    const selectedLocation = selectedLocationId
      ? locationCoaMappings.find(l => l.id === selectedLocationId)
      : null;
    return {
      page: 'cost-impact',
      integration: integrationName,
      totalRevenue,
      currentEBITDA,
      currentTotalCosts: currentTotalCostsForEbitda,
      selectedLocationId: selectedLocationId || null,
      selectedLocationName: selectedLocation?.name || (selectedLocationId ? null : 'All Locations'),
      // Per-location chart-of-account mappings, one entry per active location.
      // Use this to answer "which CoA is mapped for X at <location>" and to
      // ask the user which location when they don't specify one.
      locations: locationCoaMappings.map(l => ({
        id: l.id,
        name: l.name,
        labFees: l.labFees,
        staffCosts: l.staffCosts,
        operatingLease: l.operatingLease,
        clinicianCost: l.clinicianCost,
        overheadCost: l.overheadCost,
        materialCost: l.materialCost,
        marketingCost: l.marketingCost,
      })),
      // Effective mappings for the currently-selected scope (single location
      // if one is selected, or unioned across all locations otherwise). Kept
      // for quick single-line answers without needing the per-location array.
      costMappings: {
        labFees: buildCategory('Lab fees', expenseSettings.labFees, labFeesCost),
        staffCosts: buildCategory('Staff Costs', expenseSettings.staffCosts, staffCostsCost),
        operatingLease: buildCategory('Operating Leases', expenseSettings.operatingLease, operatingLeasesCost),
        clinicianCost: buildCategory('Clinician Costs', expenseSettings.clinicianCost, clinicianCostCost),
        overheadCost: buildCategory('Overhead Costs', expenseSettings.overheadCost, overheadCostCost),
        materialCost: buildCategory('Material Costs', expenseSettings.materialCost, materialCostCost),
        marketingCost: buildCategory('Marketing Costs', expenseSettings.marketingCost, marketingCostCost),
      },
      mappingSource: 'Mappings configured per-location in Settings → Expense Accounts; location-level overrides organisation-level.',
    };
  }, [
    integrationName,
    totalRevenue,
    currentEBITDA,
    currentTotalCostsForEbitda,
    selectedLocationId,
    locationCoaMappings,
    expenseSettings.labFees,
    expenseSettings.staffCosts,
    expenseSettings.operatingLease,
    expenseSettings.clinicianCost,
    expenseSettings.overheadCost,
    expenseSettings.materialCost,
    expenseSettings.marketingCost,
    labFeesCost,
    staffCostsCost,
    operatingLeasesCost,
    clinicianCostCost,
    overheadCostCost,
    materialCostCost,
    marketingCostCost,
  ]);
  const exportToCSV = () => {
    const preset = scenarioPresets.find(p => p.id === selectedPreset);
    const rows: string[][] = [
      ['Cost Impact Simulation Report'],
      ['Generated:', new Date().toLocaleDateString()],
      ['Scenario:', preset?.name || 'Custom'],
      [''],
      ['Cost Center', 'Current Cost', '% Change', 'Cost Change', 'New Cost', '% of Revenue'],
    ];

    costCenters.forEach((center) => {
      const change = center.currentCost * (center.percentChange / 100);
      const newCost = center.currentCost + change;
      rows.push([
        center.name,
        formatCurrency(center.currentCost),
        `${center.percentChange}%`,
        formatCurrency(change),
        formatCurrency(newCost),
        formatPercentOfRevenue(newCost, totalRevenue),
      ]);
    });

    rows.push(
      [''],
      ['TOTALS'],
      ['Total Costs', formatCurrency(currentTotalCosts), '', formatCurrency(totalChange), formatCurrency(newTotalCosts), formatPercentOfRevenue(newTotalCosts, totalRevenue)],
      [''],
      ['EBITDA Impact'],
      ['Current EBITDA', formatCurrency(currentEBITDA)],
      ['EBITDA Change', formatCurrency(ebitdaImpact)],
      ['New EBITDA', formatCurrency(newEBITDA)],
      ['Margin Impact', marginImpactLabel],
    );

    const csvContent = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost-impact-simulation-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToPDF = () => {
    // Create a printable version
    const preset = scenarioPresets.find(p => p.id === selectedPreset);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cost Impact Simulation Report</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 900px; margin: 0 auto; }
          h1 { color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
          h2 { color: #374151; margin-top: 30px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid hsl(244 48% 88%); }
          th { background: hsl(244 48% 94%); font-weight: 600; }
          .positive { color: #16a34a; }
          .negative { color: #dc2626; }
          .summary-box { background: hsl(244 50% 97%); border: 1px solid hsl(244 48% 88%); border-radius: 8px; padding: 20px; margin: 20px 0; }
          .metric { display: inline-block; margin-right: 40px; }
          .metric-value { font-size: 24px; font-weight: bold; }
          .metric-label { color: hsl(244 48% 55%); font-size: 14px; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid hsl(244 48% 88%); color: hsl(244 48% 55%); font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>Cost Impact Simulation Report</h1>
        <p><strong>Scenario:</strong> ${preset?.name || 'Custom'} ${preset?.description ? `- ${preset.description}` : ''}</p>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
        
        <h2>Cost Center Analysis</h2>
        <table>
          <thead>
            <tr>
              <th>Cost Center</th>
              <th>Current Cost</th>
              <th>% Change</th>
              <th>Cost Change</th>
              <th>New Cost</th>
              <th>% of Revenue</th>
            </tr>
          </thead>
          <tbody>
            ${costCenters.map((center) => {
              const change = center.currentCost * (center.percentChange / 100);
              const newCost = center.currentCost + change;
              return `<tr>
              <td>${center.name}</td>
              <td>${formatCurrency(center.currentCost)}</td>
              <td class="${center.percentChange < 0 ? 'positive' : center.percentChange > 0 ? 'negative' : ''}">${center.percentChange > 0 ? '+' : ''}${center.percentChange}%</td>
              <td class="${change < 0 ? 'positive' : change > 0 ? 'negative' : ''}">${formatCurrency(change)}</td>
              <td>${formatCurrency(newCost)}</td>
              <td>${formatPercentOfRevenue(newCost, totalRevenue)}</td>
            </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="font-weight: bold; background: #f3f4f6;">
              <td>Total</td>
              <td>${formatCurrency(currentTotalCosts)}</td>
              <td></td>
              <td class="${totalChange < 0 ? 'positive' : totalChange > 0 ? 'negative' : ''}">${formatCurrency(totalChange)}</td>
              <td>${formatCurrency(newTotalCosts)}</td>
              <td>${formatPercentOfRevenue(newTotalCosts, totalRevenue)}</td>
            </tr>
          </tfoot>
        </table>

        <h2>EBITDA Impact Summary</h2>
        <div class="summary-box">
          <div class="metric">
            <div class="metric-value">${formatCurrency(currentEBITDA)}</div>
            <div class="metric-label">Current EBITDA</div>
          </div>
          <div class="metric">
            <div class="metric-value ${ebitdaImpact > 0 ? 'positive' : ebitdaImpact < 0 ? 'negative' : ''}">${ebitdaImpact > 0 ? '+' : ''}${formatCurrency(ebitdaImpact)}</div>
            <div class="metric-label">EBITDA Change</div>
          </div>
          <div class="metric">
            <div class="metric-value">${formatCurrency(newEBITDA)}</div>
            <div class="metric-label">Projected EBITDA</div>
          </div>
          <div class="metric">
            <div class="metric-value ${(ebitdaMarginChange ?? 0) > 0 ? 'positive' : (ebitdaMarginChange ?? 0) < 0 ? 'negative' : ''}">${marginImpactLabel}</div>
            <div class="metric-label">Margin Impact</div>
          </div>
        </div>

        <div class="footer">
          <p>This report was generated by DentPulse Cost Impact Simulator. The projections are based on the selected scenario parameters and current cost data.</p>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  const isReduction = totalChange < 0;
  const isIncrease = totalChange > 0;

  return (
    <MainLayout aiContext={aiContextData}>
      <Helmet>
        <title>Cost Impact Analysis</title>
        <meta
          name="description"
          content="Model cost scenarios with goal seek calculations, EBITDA projections, and cost sensitivity analysis tools."
        />
      </Helmet>
      <div className="space-y-6" ref={reportRef}>
        {isCostDataLoading ? (
          <>
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-foreground">Cost Impact Dashboard</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Simulate the aggregate effect of cost changes on EBITDA
                </p>
              </div>
            </div>

            {/* Scenario Presets — loading */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Scenario Presets</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </CardContent>
            </Card>

            {/* Cost Center Adjustments — loading */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Cost Center Adjustments</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </CardContent>
            </Card>

            {/* Current / Projected State — loading */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="bg-muted/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Current State</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </CardContent>
              </Card>
              <Card className="flex flex-col items-center justify-center bg-muted/30">
                <CardContent className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Projected State</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </CardContent>
              </Card>
            </div>

            {/* Detailed Breakdown — loading */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Detailed Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </CardContent>
            </Card>

            {/* Tabs — loading */}
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </CardContent>
            </Card>
          </>
        ) : (<>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Cost Impact Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Simulate the aggregate effect of cost changes on EBITDA
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportToCSV}>
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={exportToPDF}>
              <FileText className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </div>

        {/* Scenario Presets */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="w-5 h-5" />
              Scenario Presets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {scenarioPresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetChange(preset.id)}
                  className={cn(
                    "p-3 rounded-lg border-2 text-left transition-all",
                    selectedPreset === preset.id
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/30"
                  )}
                >
                  <p className="font-medium text-sm">{preset.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{preset.description}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Cost Center Controls */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              Cost Center Adjustments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5">
              {costCenters.map((center) => (
                <div key={center.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <center.icon className={cn("w-5 h-5", center.colorClass)} />
                    <Label className="font-medium">{center.name}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={percentValues[center.key]}
                      onChange={(e) => {
                        percentSetters[center.key](e.target.value);
                        setSelectedPreset('custom');
                      }}
                      className="flex-1"
                      placeholder="0"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Current: {formatCurrency(center.currentCost)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Impact Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Before */}
          <Card className="bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Current State
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {costCenters.map((center) => (
                <div key={center.name} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <center.icon className={cn("w-4 h-4", center.colorClass)} />
                    <span className="text-sm">{center.name}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(center.currentCost)}</span>
                </div>
              ))}
              <Separator />
              <div className="flex justify-between items-center font-bold">
                <span>Total Costs</span>
                <span>{formatCurrency(currentTotalCosts)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">EBITDA</span>
                <span className="font-semibold text-primary">{formatCurrency(currentEBITDA)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Change Arrow */}
          <Card className={cn(
            "flex flex-col items-center justify-center",
            isReduction ? "bg-success/5 border-success/30" : 
            isIncrease ? "bg-destructive/5 border-destructive/30" : 
            "bg-muted/30"
          )}>
            <CardContent className="flex flex-col items-center py-8">
              {isReduction ? (
                <TrendingDown className="w-12 h-12 text-success mb-4" />
              ) : isIncrease ? (
                <TrendingUp className="w-12 h-12 text-destructive mb-4" />
              ) : (
                <ArrowRight className="w-12 h-12 text-muted-foreground mb-4" />
              )}
              
              <div className="text-center space-y-2">
                <p className={cn(
                  "text-3xl font-bold",
                  isReduction ? "text-success" : isIncrease ? "text-destructive" : ""
                )}>
                  {totalChange > 0 ? '+' : ''}{formatCurrency(totalChange)}
                </p>
                <p className="text-sm text-muted-foreground">Total Cost Change</p>
                
                <Separator className="my-4" />
                
                <p className={cn(
                  "text-2xl font-bold",
                  isReduction ? "text-success" : isIncrease ? "text-destructive" : ""
                )}>
                  {ebitdaImpact > 0 ? '+' : ''}{formatCurrency(ebitdaImpact)}
                </p>
                <p className="text-sm text-muted-foreground">EBITDA Impact</p>
                
                <Badge variant={isReduction ? "default" : isIncrease ? "destructive" : "secondary"} className="mt-2">
                  {marginImpactLabel} margin
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* After */}
          <Card className={cn(
            isReduction ? "bg-success/5 border-success/30" : 
            isIncrease ? "bg-destructive/5 border-destructive/30" : 
            "bg-muted/30"
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Projected State
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {costCenters.map((center) => {
                const change = center.currentCost * (center.percentChange / 100);
                const newCost = center.currentCost + change;
                return (
                  <div key={center.key} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <center.icon className={cn("w-4 h-4", center.colorClass)} />
                      <span className="text-sm">{center.name}</span>
                    </div>
                    <span className={cn("font-medium", center.percentChange < 0 ? "text-success" : center.percentChange > 0 ? "text-destructive" : "")}>
                      {formatCurrency(newCost)}
                    </span>
                  </div>
                );
              })}
              <Separator />
              <div className="flex justify-between items-center font-bold">
                <span>Total Costs</span>
                <span className={cn(isReduction ? "text-success" : isIncrease ? "text-destructive" : "")}>
                  {formatCurrency(newTotalCosts)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">EBITDA</span>
                <span className={cn("font-semibold", isReduction ? "text-success" : isIncrease ? "text-destructive" : "text-primary")}>
                  {formatCurrency(newEBITDA)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="w-5 h-5" />
              Detailed Cost Breakdown
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              % Change and Cost Change compare the selected period against the previous period.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Cost Center</th>
                    <th className="text-right py-3 px-4 font-medium">Current Cost</th>
                    <th className="text-right py-3 px-4 font-medium">% Change</th>
                    <th className="text-right py-3 px-4 font-medium">Cost Change</th>
                    <th className="text-right py-3 px-4 font-medium">New Cost</th>
                    <th className="text-right py-3 px-4 font-medium">% of Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {costCenters.map((center) => {
                    const change = center.currentCost * (center.percentChange / 100);
                    const newCost = center.currentCost + change;
                    // Period-over-period: selected filter period vs the previous one.
                    const periodCostChange = center.currentCost - center.previousCost;
                    const periodPctChange = center.previousCost !== 0
                      ? (periodCostChange / center.previousCost) * 100
                      : null;
                    const periodToneClass = periodCostChange < 0
                      ? "text-success"
                      : periodCostChange > 0 ? "text-destructive" : "";
                    return (
                      <tr key={center.key} className="border-b">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <center.icon className={cn("w-4 h-4", center.colorClass)} />
                            {center.name}
                          </div>
                        </td>
                        <td className="text-right py-3 px-4">{formatCurrency(center.currentCost)}</td>
                        <td className={cn("text-right py-3 px-4", periodToneClass)}>
                          {!prevCostData
                            ? '—'
                            : periodPctChange === null
                              ? '—'
                              : `${periodPctChange > 0 ? '+' : ''}${periodPctChange.toFixed(1)}%`}
                        </td>
                        <td className={cn("text-right py-3 px-4", periodToneClass)}>
                          {!prevCostData
                            ? '—'
                            : `${periodCostChange > 0 ? '+' : ''}${formatCurrency(periodCostChange)}`}
                        </td>
                        <td className="text-right py-3 px-4 font-medium">{formatCurrency(newCost)}</td>
                        <td className="text-right py-3 px-4">{formatPercentOfRevenue(newCost, totalRevenue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-bold">
                    <td className="py-3 px-4">Total</td>
                    <td className="text-right py-3 px-4">{formatCurrency(currentTotalCosts)}</td>
                    <td className={cn("text-right py-3 px-4", totalPeriodCostChange < 0 ? "text-success" : totalPeriodCostChange > 0 ? "text-destructive" : "")}>
                      {!prevCostData
                        ? '—'
                        : totalPeriodPctChange === null
                          ? '—'
                          : `${totalPeriodPctChange > 0 ? '+' : ''}${totalPeriodPctChange.toFixed(1)}%`}
                    </td>
                    <td className={cn("text-right py-3 px-4", totalPeriodCostChange < 0 ? "text-success" : totalPeriodCostChange > 0 ? "text-destructive" : "")}>
                      {!prevCostData
                        ? '—'
                        : `${totalPeriodCostChange > 0 ? '+' : ''}${formatCurrency(totalPeriodCostChange)}`}
                    </td>
                    <td className="text-right py-3 px-4">{formatCurrency(newTotalCosts)}</td>
                    <td className="text-right py-3 px-4">{formatPercentOfRevenue(newTotalCosts, totalRevenue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Insight Summary */}
        {totalChange !== 0 && (
          <Card className={cn(
            "border-2",
            isReduction ? "bg-success/5 border-success/30" : "bg-destructive/5 border-destructive/30"
          )}>
            <CardContent className="py-6">
              <div className="flex items-start gap-4">
                <div className={cn(
                  "p-3 rounded-full",
                  isReduction ? "bg-success/20" : "bg-destructive/20"
                )}>
                  <Zap className={cn("w-6 h-6", isReduction ? "text-success" : "text-destructive")} />
                </div>
                <div>
                  <h3 className={cn("font-semibold text-lg", isReduction ? "text-success" : "text-destructive")}>
                    {isReduction ? 'Cost Savings Projection' : 'Cost Increase Projection'}
                  </h3>
                  <p className="text-muted-foreground mt-1">
                    The selected scenario would {isReduction ? 'reduce' : 'increase'} total operating costs by{' '}
                    <strong>{formatCurrency(Math.abs(totalChange))}</strong> annually, 
                    {isReduction ? ' improving' : ' reducing'} EBITDA by{' '}
                    <strong>{formatCurrency(Math.abs(ebitdaImpact))}</strong>.
                    {ebitdaMarginChange !== null && (
                      <> This represents a <strong>{Math.abs(ebitdaMarginChange).toFixed(2)}%</strong> {isReduction ? 'improvement' : 'reduction'} in EBITDA margin.</>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Advanced Analysis Tabs */}
        <Tabs defaultValue="projection" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="projection" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">12-Month</span> Projection
            </TabsTrigger>
            <TabsTrigger value="sensitivity" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              <span className="hidden sm:inline">Sensitivity</span>
            </TabsTrigger>
            <TabsTrigger value="scenarios" className="flex items-center gap-2">
              <Bookmark className="w-4 h-4" />
              <span className="hidden sm:inline">Saved</span>
            </TabsTrigger>
            <TabsTrigger value="compare" className="flex items-center gap-2">
              <GitCompare className="w-4 h-4" />
              <span className="hidden sm:inline">Compare</span>
            </TabsTrigger>
            <TabsTrigger value="goalseek" className="flex items-center gap-2">
              <Target className="w-4 h-4" />
              <span className="hidden sm:inline">Goal-Seek</span>
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="projection" className="mt-4">
            <EBITDAProjectionChart
              currentEBITDA={currentEBITDA}
              projectedEBITDA={newEBITDA}
              totalCostChange={totalChange}
              costCenters={costCenters.map(c => ({ name: c.name, currentCost: c.currentCost, percentChange: c.percentChange }))}
            />
          </TabsContent>
          
          <TabsContent value="sensitivity" className="mt-4">
            <SensitivityAnalysis
              totalRevenue={totalRevenue}
              currentEBITDA={currentEBITDA}
              currentTotalCosts={currentTotalCosts}
              costCenters={costCenters.map((c, i) => ({
                name: c.name,
                currentCost: c.currentCost,
                percentChange: c.percentChange,
                color: ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(262, 83%, 58%)', 'hsl(330, 81%, 60%)'][i % 7],
                fixedRatio: c.key === 'operatingLease' ? 0.8 : c.key === 'staff' ? 0.3 : 0.5,
              }))}
            />
          </TabsContent>
          
          <TabsContent value="scenarios" className="mt-4">
            <SavedScenariosPanel
              costCenters={costCenters.map(c => ({
                key: c.key,
                name: c.name,
                shortLabel: c.key === 'labFees' ? 'Lab'
                  : c.key === 'staff' ? 'Staff'
                  : c.key === 'operatingLease' ? 'Leases'
                  : c.key === 'clinicianCost' ? 'Clinician'
                  : c.key === 'overheadCost' ? 'Overhead'
                  : c.key === 'materialCost' ? 'Material'
                  : c.key === 'marketingCost' ? 'Marketing'
                  : c.name,
                currentPercent: c.percentChange,
                dbField: c.key === 'labFees' ? 'lab_fees_percent'
                  : c.key === 'staff' ? 'staff_costs_percent'
                  : c.key === 'operatingLease' ? 'operating_leases_percent'
                  : c.key === 'clinicianCost' ? 'clinician_cost_percent'
                  : c.key === 'overheadCost' ? 'overhead_cost_percent'
                  : c.key === 'materialCost' ? 'material_cost_percent'
                  : c.key === 'marketingCost' ? 'marketing_cost_percent'
                  : c.key + '_percent',
              }))}
              totalRevenue={totalRevenue}
              currentEBITDA={currentEBITDA}
              onLoadScenario={handleLoadScenario}
            />
          </TabsContent>

          <TabsContent value="compare" className="mt-4">
            <ScenarioComparison
              costCenters={costCenters.map(c => ({
                key: c.key,
                name: c.name,
                icon: c.icon,
                currentCost: c.currentCost,
                currentPercent: c.percentChange,
                colorClass: c.colorClass,
                scenarioField: c.key === 'labFees' ? 'lab_fees_percent'
                  : c.key === 'staff' ? 'staff_costs_percent'
                  : c.key === 'operatingLease' ? 'operating_leases_percent'
                  : c.key === 'clinicianCost' ? 'clinician_cost_percent'
                  : c.key === 'overheadCost' ? 'overhead_cost_percent'
                  : c.key === 'materialCost' ? 'material_cost_percent'
                  : c.key === 'marketingCost' ? 'marketing_cost_percent'
                  : c.key + '_percent',
              }))}
              totalRevenue={totalRevenue}
              currentEBITDA={currentEBITDA}
            />
          </TabsContent>

          <TabsContent value="goalseek" className="mt-4">
            <GoalSeekCalculator
              costCenters={costCenters.map(c => ({
                key: c.key,
                name: c.name,
                icon: c.icon,
                currentCost: c.currentCost,
                colorClass: c.colorClass,
              }))}
              totalRevenue={totalRevenue}
              currentEBITDA={currentEBITDA}
              onApplySolution={handleApplyGoalSeekSolution}
            />
          </TabsContent>
        </Tabs>
        </>)}
      </div>
    </MainLayout>
  );
}
