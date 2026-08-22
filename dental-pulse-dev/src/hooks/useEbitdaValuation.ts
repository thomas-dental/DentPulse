import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FilterContext';
import { useOrganization } from './useOrganization';
import { useAuth } from './useAuth';
import { useCostImpactData } from './useCostImpactData';
import { useTreatmentInsights } from './useTreatmentInsights';
import { useTreatmentProfitPlanning } from './useTreatmentProfitPlanning';
import { useChairMetrics } from './useChairMetrics';
import { useAllProvidersNetProduction } from './useAllProvidersNetProduction';
import { useNHSContractPerformance } from './useNHSContractPerformance';
import { useEbitdaAdjustments } from './useEbitdaAdjustments';
import { useEbitdaSettings } from './useEbitdaSettings';
import { useLocations } from './useLocations';
import { useProfitBenchmark } from './useProfitBenchmark';
import { useLocationIncomeAccountingTotals } from './useLocationIncomeAccountingTotals';
import { useEbitdaBridge } from './useEbitdaBridge';
import {
  composeIncomeBreakdown,
  deriveActualProfit,
  splitProfitBenchmarkCostExpense,
} from '@/utils/profitBenchmarkActual';
import {
  calculateQualityScore,
  calculateMultiple,
  calculateSustainabilityHaircuts,
  calculateKeyDrivers,
  calculateValueProgression,
  type QualityScoreResult,
  type MultipleResult,
  type SustainabilityResult,
  type KeyDriverResult,
  type ValueProgressionResult,
  type QualityScoreInputs,
  type MultipleInputs,
} from '@/utils/ebitda';

// ─── Types ───

export interface EbitdaValuationData {
  // Source financials — Profitability (Profit Benchmark) Production Income
  totalRevenue: number;
  /** Profitability → Total Costs Of Treatment Delivery. */
  treatmentCost: number;
  /** Profitability → Total Expenses To Run Your Business. */
  operatingExpense: number;
  /** Production Income − Cost − Expense (Profitability Actual Profit). */
  netProfit: number;
  /** Setup Categories → EBITDA add-backs (D / A / I / T). */
  ebitdaImpact: {
    depreciation: number;
    amortisation: number;
    interest: number;
    tax: number;
    total: number;
  };
  /** @deprecated Cost Impact breakdown — kept for PDF / legacy consumers. */
  staffCosts: number;
  labFees: number;
  overheads: number;
  clinicianCosts: number;
  overheadCosts: number;
  materialCosts: number;
  totalCosts: number;

  // EBITDA Stack
  /** Net Profit + EBITDA Impact add-backs (matches Profitability → EBITDA Impact). */
  reportedEBITDA: number;
  normalisationItems: Array<{ label: string; value: number }>;
  netAdjustments: number;
  adjustedEBITDA: number;
  sustainability: SustainabilityResult;
  sustainableEBITDA: number;

  // Quality Score
  quality: QualityScoreResult;
  qualityInputs: QualityScoreInputs;

  // Multiple
  multiple: MultipleResult;

  // Enterprise Value
  enterpriseValue: number;
  netDebt: number;
  equityValue: number;

  // Key Drivers
  keyDrivers: KeyDriverResult[];

  // Value Progression
  valueProgression: ValueProgressionResult;

  // Data source flags
  hasGLData: boolean;
  dataSource: string;
}

// ─── Helper ───

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Hook ───

export function useEbitdaValuation() {
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  // Locations list — used to scope chairs/providers by region when only a region is selected.
  const locationsHook = useLocations();
  const allLocations = locationsHook.allAvailableLocations;
  const regionLocationIds = useMemo(() => {
    if (!selectedRegionId || selectedLocationId) return null;
    return (allLocations ?? []).filter(l => l.region_id === selectedRegionId).map(l => l.id);
  }, [selectedRegionId, selectedLocationId, allLocations]);

  // ── Sub-hooks (all fire in parallel via React Query) ──

  const costImpact = useCostImpactData();
  const { summary: insightsSummary, isLoading: insightsLoading } = useTreatmentInsights();
  const { planningData, isLoading: planningLoading } = useTreatmentProfitPlanning();
  const chairMetrics = useChairMetrics({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });
  const providerProduction = useAllProvidersNetProduction(
    null,
    dateRange.startDate,
    dateRange.endDate,
    selectedLocationId,
    regionLocationIds,
  );
  const nhsPerformance = useNHSContractPerformance();
  const adjustmentsHook = useEbitdaAdjustments();
  const { adjustments, isLoading: adjLoading } = adjustmentsHook;
  const settingsHook = useEbitdaSettings();
  const { settings, isLoading: settingsLoading } = settingsHook;

  const fromDate = toDateStr(dateRange.startDate);
  const toDate = toDateStr(dateRange.endDate);
  const locationIdForPb =
    selectedLocationId && String(selectedLocationId).toLowerCase() !== 'all'
      ? selectedLocationId
      : null;

  // Profitability (Profit Benchmark) — same Revenue / Cost / Expense as /profitability
  const benchmark = useProfitBenchmark(
    fromDate,
    toDate,
    undefined,
    locationIdForPb,
  );
  const accountingIncome = useLocationIncomeAccountingTotals(
    fromDate,
    toDate,
    locationIdForPb,
    regionLocationIds,
  );

  const periodProfit = useMemo(() => {
    const providers = (providerProduction.data?.providers ?? []).map((p) => ({
      totalPrivate: p.totalPrivate,
      totalMembership: p.totalMembership,
      totalNhs: p.totalNhs,
    }));
    const breakdown = composeIncomeBreakdown(providers, accountingIncome.data);
    const productionIncome = breakdown.total;
    const { actualProfit } = deriveActualProfit(
      productionIncome,
      benchmark.rows ?? [],
    );
    const { totalCost, totalExpense } = splitProfitBenchmarkCostExpense(
      benchmark.rows ?? [],
    );
    return {
      breakdown,
      productionIncome,
      actualProfit,
      treatmentCost: totalCost,
      operatingExpense: totalExpense,
    };
  }, [
    providerProduction.data,
    accountingIncome.data,
    benchmark.rows,
  ]);

  const ebitdaBridge = useEbitdaBridge(
    fromDate,
    toDate,
    periodProfit.actualProfit,
    locationIdForPb,
  );

  // ── Additional small queries ──

  // NHS contract value from uda_settings
  const nhsContractQuery = useQuery({
    queryKey: ['ebitda-nhs-contract-value', organizationId],
    queryFn: async () => {
      if (!organizationId) return { nhsContractValue: 0, totalUdaObligation: 0 };
      const { data } = await (supabase as any)
        .from('uda_settings')
        .select('nhs_contract_value, total_uda_obligation')
        .eq('organization_id', organizationId)
        .maybeSingle();
      return {
        nhsContractValue: data?.nhs_contract_value ?? 0,
        totalUdaObligation: data?.total_uda_obligation ?? 0,
      };
    },
    enabled: !!organizationId && !!user?.id,
  });

  // Invoice stats derived from useCostImpactData (no duplicate fetch)
  const invoiceStatsFromCostImpact = useMemo(() => ({
    paidCount: costImpact.data?.paidInvoiceCount ?? 0,
    totalCount: costImpact.data?.totalInvoiceCount ?? 0,
    invoiceRevenue: costImpact.data?.invoiceRevenue ?? 0,
  }), [costImpact.data]);

  // Monthly revenue for predictability score (last 12 months) — single RPC call
  const monthlyRevenueQuery = useQuery({
    queryKey: ['ebitda-monthly-revenue', organizationId, toDateStr(dateRange.endDate), selectedLocationId || 'all', regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'no-region'],
    queryFn: async () => {
      if (!organizationId) return [];

      const endDate = dateRange.endDate;
      const startDate12m = new Date(endDate);
      startDate12m.setMonth(startDate12m.getMonth() - 12);

      const { data, error } = await (supabase as any).rpc('get_monthly_revenue', {
        _organization_id: organizationId,
        _start_date: toDateStr(startDate12m),
        _end_date: toDateStr(endDate),
        _location_id: selectedLocationId || null,
      });

      if (error) {
        console.error('[monthlyRevenueQuery] RPC error:', error);
        return [];
      }

      return ((data ?? []) as Array<{ month: string; revenue: number }>).map(r => r.revenue);
    },
    enabled: !!organizationId && !!user?.id,
  });

  // ── Computed valuation ──

  const isLoading = costImpact.isLoading || insightsLoading || planningLoading ||
    chairMetrics.isLoading || providerProduction.isLoading || nhsPerformance.isLoading ||
    adjLoading || settingsLoading || nhsContractQuery.isLoading ||
    monthlyRevenueQuery.isLoading ||
    benchmark.isLoading || accountingIncome.isLoading || ebitdaBridge.isLoading;

  const valuation = useMemo((): EbitdaValuationData | null => {
    if (!costImpact.data) return null;

    const ci = costImpact.data;
    // Filter chair metrics by selected location, or by all locations in the selected region.
    const allChairs = chairMetrics.data ?? [];
    const chairs = selectedLocationId
      ? allChairs.filter(c => c.location_id === selectedLocationId)
      : regionLocationIds
        ? allChairs.filter(c => regionLocationIds.includes(c.location_id))
        : allChairs;

    // Providers come from useAllProvidersNetProduction which accepts a single location id only.
    // When region is selected without a specific location, post-filter providers by location_id
    // belonging to the region. (Provider rows do not expose location_id directly here, so the
    // region scope is enforced via revenue inherited from useTreatmentInsights — which is
    // already region-aware.)
    const providers = providerProduction.data?.providers ?? [];
    const nhsContract = nhsContractQuery.data ?? { nhsContractValue: 0, totalUdaObligation: 0 };
    const invoiceStats = invoiceStatsFromCostImpact;
    const monthlyRevenues = monthlyRevenueQuery.data ?? [];

    // ── Provider dependency ──
    const totalProviderRevenue = providers.reduce((s, p) => s + p.total, 0);
    const topProvider = providers.length > 0
      ? providers.reduce((max, p) => p.total > max.total ? p : max, providers[0])
      : null;
    const topProviderPct = totalProviderRevenue > 0 && topProvider
      ? (topProvider.total / totalProviderRevenue) * 100 : 0;
    const topProviderRevenue = topProvider?.total ?? 0;

    // ── Chair metrics (aggregate) ──
    const avgUtilisation = chairs.length > 0
      ? chairs.reduce((s, c) => s + (c.utilisation_pct ?? 0), 0) / chairs.length : 70;
    const totalChairs = chairs.reduce((s, c) => s + (c.chairs_count ?? 0), 0);

    // ── NHS delivery ──
    const nhsSummary = nhsPerformance.summaryCards ?? [];
    // Try to extract UDA delivery % from summary cards
    let udaDeliveryPct: number | null = null;
    let totalUdaDelivered = 0;
    let totalUdaTarget = nhsContract.totalUdaObligation;

    // Sum UDA targets from provider performance
    const provPerf = nhsPerformance.providerPerformance ?? [];
    if (provPerf.length > 0) {
      totalUdaDelivered = provPerf.reduce((s, p) => s + (p.udasDelivered ?? 0), 0);
      const provTargetSum = provPerf.reduce((s, p) => s + (p.target ?? 0), 0);
      if (provTargetSum > 0) totalUdaTarget = provTargetSum;
    }

    if (totalUdaTarget > 0) {
      udaDeliveryPct = (totalUdaDelivered / totalUdaTarget) * 100;
    }

    // ── Cash conversion ──
    const paidInvoiceRate = invoiceStats.totalCount > 0
      ? invoiceStats.paidCount / invoiceStats.totalCount : 0.8;

    // ── EBITDA Stack — Profitability (Profit Benchmark) ──
    // Revenue = Production Income (Private + Membership + NHS)
    // Profit  = Revenue − Costs of Treatment Delivery − Expenses to Run Business
    // Reported EBITDA = Profit + EBITDA Impact (D/A/I/T add-backs)
    const totalRevenue = periodProfit.productionIncome;
    const treatmentCost = periodProfit.treatmentCost;
    const operatingExpense = periodProfit.operatingExpense;
    const netProfit = periodProfit.actualProfit;
    const bridge = ebitdaBridge.data;
    const ebitdaImpact = {
      depreciation: bridge?.depreciation ?? 0,
      amortisation: bridge?.amortisation ?? 0,
      interest: bridge?.interest ?? 0,
      tax: bridge?.tax ?? 0,
      total: bridge?.totalAddBacks ?? 0,
    };
    const reportedEBITDA =
      bridge?.ebitda ?? netProfit + ebitdaImpact.total;

    // Treatment mix for quality score — from Profitability payor split
    const privateRevenuePct =
      totalRevenue > 0
        ? ((periodProfit.breakdown.private + periodProfit.breakdown.membership) /
            totalRevenue) *
          100
        : 30;

    // Cost Impact buckets — retained for PDF / legacy consumers (not used for Reported EBITDA)
    const clinicianCosts = ci.clinicianCostCost;
    const staffCostsCost = ci.staffCostsCost;
    const labFeesCost = ci.labFeesCost + (ci.materialCostCost ?? 0);
    const overheadCosts = ci.overheadCostCost;
    const operatingLeasesCost = ci.operatingLeasesCost;
    const totalCosts = treatmentCost + operatingExpense;

    // Normalisation adjustments
    const normItems = adjustments.filter(a => a.category === 'normalisation');
    const normalisationItems = normItems.map(a => ({ label: a.label, value: a.amount }));
    const netAdjustments = normItems.reduce((s, a) => s + a.amount, 0);
    const adjustedEBITDA = reportedEBITDA + netAdjustments;

    // Sustainability haircuts
    const sustainManualItems = adjustments.filter(a => a.category === 'sustainability_manual');
    const sustainability = calculateSustainabilityHaircuts({
      avgUtilisationPct: avgUtilisation,
      totalRevenue,
      totalChairs,
      topProviderRevenue,
      departureRiskFactor: settings.departure_risk_factor / 100,
      udaDeliveryPct,
      nhsContractValue: nhsContract.nhsContractValue,
      manualItems: sustainManualItems.map(a => ({
        label: a.label,
        amount: a.amount,
        confidence_pct: a.confidence_pct,
      })),
      newAssociateRampUp: settings.new_associate_ramp_up,
      newAssociateRampConfidence: settings.new_associate_ramp_confidence,
      utilisationImprovement: settings.utilisation_improvement,
      utilisationImprovementConfidence: settings.utilisation_improvement_confidence,
    });

    const sustainableEBITDA = adjustedEBITDA + sustainability.totalImpact;

    // ── Quality Score ──
    const qualityInputs: QualityScoreInputs = {
      monthlyRevenues,
      topProviderRevenuePct: topProviderPct,
      avgUtilisationPct: avgUtilisation,
      privateRevenuePct,
      paidInvoiceRate,
      udaDeliveryPct,
      weights: settings.quality_weights,
    };
    const quality = calculateQualityScore(qualityInputs);

    // ── Multiple ──
    const netDebt = settings.net_debt;
    const netDebtToEbitdaRatio = sustainableEBITDA > 0 ? netDebt / sustainableEBITDA : 0;

    const multipleInputs: MultipleInputs = {
      baseMultiple: settings.base_multiple,
      totalRevenue,
      avgUtilisationPct: avgUtilisation,
      qualityScore: quality.finalScore,
      topProviderRevenuePct: topProviderPct,
      udaDeliveryPct,
      hasGLData: ci.hasGLData,
      netDebtToEbitdaRatio,
      mgmtDepthPenalty: settings.mgmt_depth_penalty,
      standardisationPenalty: settings.standardisation_penalty,
      leveragePenalty: settings.leverage_penalty,
      customPenalties: settings.custom_penalties,
    };
    const multiple = calculateMultiple(multipleInputs);

    // ── Enterprise Value ──
    const enterpriseValue = sustainableEBITDA * multiple.finalMultiple;
    const equityValue = enterpriseValue - netDebt;

    // ── Key Drivers ──
    const ebitdaMarginPct = totalRevenue > 0 ? (reportedEBITDA / totalRevenue) * 100 : 0;
    const keyDrivers = calculateKeyDrivers({
      ebitdaMarginPct,
      utilisationPct: avgUtilisation,
      topProviderPct,
      privateRevenuePct,
      udaDeliveryPct,
      totalRevenue,
    });

    // ── Value Progression ──
    const ebitdaImprovementPct = sustainableEBITDA > 0
      ? Math.max(20, Math.min(80, (Math.abs(sustainability.totalImpact) / sustainableEBITDA) * 100 + 20))
      : 40;

    const valueProgression = calculateValueProgression({
      sustainableEBITDA,
      currentMultiple: multiple.finalMultiple,
      currentEV: enterpriseValue,
      qualityInputs,
      multipleInputs,
      ebitdaImprovementPct,
    });

    // ── Verification Logging ──
    // This breakdown is ~40 console.* calls (with .map/.toLocaleString) and runs
    // on every valuation recompute. In multi-location mode the EBITDA hook is
    // instantiated once per practice section, so the logging cost is multiplied
    // by the location count and noticeably slows page load (especially with
    // devtools open). Gate it behind an opt-in flag so it stays available for
    // verification but is off by default:  localStorage.setItem('debug:ebitda','1')
    const ebitdaDebug = (() => {
      try { return typeof localStorage !== 'undefined' && localStorage.getItem('debug:ebitda') === '1'; }
      catch { return false; }
    })();
    if (ebitdaDebug) {
    console.group('[EBITDA-VALUATION] Full Calculation Breakdown');

    console.log('📊 SOURCE 1: Financial Data (Profitability)', {
      revenueSource: 'Profit Benchmark Production Income (Private + Membership + NHS)',
      costSource: 'Profit Benchmark — Costs of Treatment Delivery',
      expenseSource: 'Profit Benchmark — Expenses to Run Your Business',
      ebitdaImpactSource: 'Setup Categories → EBITDA COA mappings',
      totalRevenue: `£${totalRevenue.toLocaleString()}`,
      treatmentCost: `£${treatmentCost.toLocaleString()}`,
      operatingExpense: `£${operatingExpense.toLocaleString()}`,
      netProfit: `£${netProfit.toLocaleString()}`,
      ebitdaImpact: `£${ebitdaImpact.total.toLocaleString()}`,
      reportedEBITDA: `£${reportedEBITDA.toLocaleString()}`,
      formula: `Reported EBITDA = (Revenue − Cost − Expense) + EBITDA Impact`,
    });

    console.log('🪑 SOURCE 2: Chair Metrics (from useChairMetrics)', {
      locationsCount: chairs.length,
      avgUtilisation: `${avgUtilisation.toFixed(1)}%`,
      totalChairs,
      perLocation: chairs.map(c => ({
        name: c.location_name,
        utilisation: `${c.utilisation_pct?.toFixed(1)}%`,
        chairs: c.chairs_count,
        revenuePerChair: `£${(c.revenue_per_chair ?? 0).toLocaleString()}`,
      })),
      verify: '→ Compare with /chairs page',
    });

    console.log('👨‍⚕️ SOURCE 3: Provider Production (from useAllProvidersNetProduction)', {
      providerCount: providers.length,
      totalProviderRevenue: `£${totalProviderRevenue.toLocaleString()}`,
      topProvider: topProvider ? `${topProvider.providerName}: £${topProvider.total.toLocaleString()} (${topProviderPct.toFixed(1)}%)` : 'none',
      privateMembershipPct: `${privateRevenuePct.toFixed(1)}%`,
      top5: providers.slice().sort((a, b) => b.total - a.total).slice(0, 5).map(p => ({
        name: p.providerName,
        total: `£${p.total.toLocaleString()}`,
        pct: `${(totalProviderRevenue > 0 ? (p.total / totalProviderRevenue * 100) : 0).toFixed(1)}%`,
      })),
    });

    console.log('🏥 SOURCE 4: NHS Contract (from useNHSContractPerformance + uda_settings)', {
      udaDelivered: totalUdaDelivered,
      udaTarget: totalUdaTarget,
      udaDeliveryPct: udaDeliveryPct != null ? `${udaDeliveryPct.toFixed(1)}%` : 'no NHS contract',
      nhsContractValue: `£${nhsContract.nhsContractValue.toLocaleString()}`,
      providerCount: provPerf.length,
      verify: '→ Compare with /treatments/nhs page',
    });

    console.log('💳 SOURCE 5: Cash Conversion (from invoice stats)', {
      paidCount: invoiceStats.paidCount,
      totalCount: invoiceStats.totalCount,
      paidRate: `${(paidInvoiceRate * 100).toFixed(1)}%`,
    });

    console.log('📈 SOURCE 6: Revenue Predictability (monthly revenue)', {
      monthCount: monthlyRevenues.length,
      monthlyValues: monthlyRevenues.map(v => `£${v.toLocaleString()}`),
    });

    console.log('━'.repeat(60));

    console.log('🔢 EBITDA STACK', {
      reportedEBITDA: `£${reportedEBITDA.toLocaleString()}`,
      normalisationItems: normalisationItems.length > 0 ? normalisationItems : 'none (add via ebitda_adjustments table)',
      netAdjustments: `£${netAdjustments.toLocaleString()}`,
      adjustedEBITDA: `£${adjustedEBITDA.toLocaleString()}`,
      sustainabilityItems: sustainability.items,
      sustainabilityImpact: `£${sustainability.totalImpact.toLocaleString()}`,
      sustainableEBITDA: `£${sustainableEBITDA.toLocaleString()}`,
    });

    console.log('⭐ QUALITY SCORE', {
      finalScore: quality.finalScore,
      subScores: quality.scores.map(s => `${s.label}: ${s.value} (weight: ${s.weight})`),
    });

    console.log('✖️ MULTIPLE', {
      waterfall: multiple.waterfall.map(w => `${w.label}: ${w.value > 0 ? '+' : ''}${w.value}×`),
      finalMultiple: `${multiple.finalMultiple}×`,
    });

    console.log('💰 ENTERPRISE VALUE', {
      sustainableEBITDA: `£${sustainableEBITDA.toLocaleString()}`,
      multiple: `${multiple.finalMultiple}×`,
      enterpriseValue: `£${enterpriseValue.toLocaleString()}`,
      netDebt: `£${netDebt.toLocaleString()}`,
      equityValue: `£${equityValue.toLocaleString()}`,
    });

    console.log('📊 VALUE PROGRESSION', {
      baseline: `£${valueProgression.baseline.value.toLocaleString()} (${valueProgression.baseline.multiple}×)`,
      optimised: `£${valueProgression.optimised.value.toLocaleString()} (${valueProgression.optimised.multiple}×)`,
      opportunity: `+£${valueProgression.opportunity.toLocaleString()}`,
    });

    console.groupEnd();
    }

    return {
      totalRevenue,
      treatmentCost,
      operatingExpense,
      netProfit,
      ebitdaImpact,
      staffCosts: staffCostsCost,
      labFees: labFeesCost,
      overheads: operatingLeasesCost,
      clinicianCosts,
      overheadCosts,
      materialCosts: 0,
      totalCosts,
      reportedEBITDA,
      normalisationItems,
      netAdjustments,
      adjustedEBITDA,
      sustainability,
      sustainableEBITDA,
      quality,
      qualityInputs,
      multiple,
      enterpriseValue,
      netDebt,
      equityValue,
      keyDrivers,
      valueProgression,
      hasGLData: ci.hasGLData,
      dataSource: 'Profitability',
    };
  }, [
    costImpact.data, insightsSummary.totalRevenue, planningData,
    chairMetrics.data, providerProduction.data,
    nhsPerformance.summaryCards, nhsPerformance.providerPerformance,
    nhsContractQuery.data, invoiceStatsFromCostImpact, monthlyRevenueQuery.data,
    adjustments, settings, selectedLocationId, regionLocationIds,
    periodProfit, ebitdaBridge.data,
  ]);

  return {
    valuation,
    isLoading,
    // Expose CRUD for settings UI
    adjustmentsApi: {
      items: adjustmentsHook.adjustments,
      add: adjustmentsHook.addAdjustment,
      update: adjustmentsHook.updateAdjustment,
      remove: adjustmentsHook.deleteAdjustment,
    },
    settingsApi: {
      current: settingsHook.settings,
      update: settingsHook.updateSettings,
    },
  };
}
