import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';
import { useAllProvidersNetProduction } from './useAllProvidersNetProduction';
import { useAllProvidersWorkingHours } from './useAllProvidersWorkingHours';
import { getOperationalExpense } from '@/services/integrations/plCostService';
import { resolveBusinessInfoLocationId } from '@/lib/businessInfoLocation';
import { loadProviderCostInputs, type ProviderCostInputRow } from '@/lib/providerCostInputs';
import { resolveProviderCost } from '@/lib/providerCostResolution';
import type { ProviderCostSourceMethod, ProviderCostAccountPlatform } from '@/types/provider';

export interface AssociateProfitRow {
  id: string;
  name: string;
  role: string;
  currentRevenue: number;
  currentCost: number;
  currentProfit: number;
  plannedRevenue: number;
  plannedCost: number;
  plannedProfit: number;
}

export interface AssociateMonthlyTrend {
  month: string;
  /** YYYY-MM, so a consumer can line a bucket up with the current filter's month. */
  period: string;
  actual: number;
  planned: number;
}

/** Convert Date to YYYY-MM-DD (local, no timezone shift). */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function round2(n: number): number {
  return Math.round((n ?? 0) * 100) / 100;
}

/** Count Mon–Fri weekdays in [from, to] inclusive (same as Profit Goals Settings). */
function countWorkingCalendarDays(from: Date, to: Date): number {
  let count = 0;
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Associate Profit Planning (Actual vs Target).
 *
 * Current Revenue / Cost / Profit use the same formulas as Profit Goals Settings:
 *   Current Revenue = Total Production (Actual)
 *   Associate Net Pay = (Production × Assoc Split %) − (Production × Labs % × Lab Split %)
 *   Cost of Labs     = Production × Labs %
 *   Materials Costs  = Production × Materials %
 *   OCPSPA           = OCPSPD × Working Days  (Working Days = Hours ÷ Open Hours/Day)
 *   Current Cost     = Net Pay + Labs + Materials + OCPSPA
 *   Current Profit   = Current Revenue − Current Cost
 */
export function useAssociateProfitPlanning() {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();
  const { allAvailableLocations } = useLocations();

  const startDateStr = toDateStr(dateRange.startDate);
  const endDateStr = toDateStr(dateRange.endDate);

  const targetLocationIds = useMemo(() => {
    if (selectedLocationId) return [selectedLocationId];
    if (selectedRegionId) {
      return allAvailableLocations
        .filter((l: any) => l.region_id === selectedRegionId)
        .map((l: any) => l.id);
    }
    return null;
  }, [selectedLocationId, selectedRegionId, allAvailableLocations]);

  const regionLocationIds = useMemo(() => {
    if (selectedLocationId) return null;
    if (selectedRegionId && targetLocationIds && targetLocationIds.length > 0) {
      return targetLocationIds;
    }
    return null;
  }, [selectedLocationId, selectedRegionId, targetLocationIds]);

  // ── Providers (with split % used by Profit Goals formulas) ──
  // Include inactive so historical production from leavers is still counted.
  const { data: providers = [], isLoading: isLoadingProviders } = useQuery({
    queryKey: ['associate-profit-providers', organizationId, selectedLocationId, selectedRegionId],
    queryFn: async () => {
      if (!organizationId) return [];
      let q = (supabase as any)
        .from('providers')
        .select(
          'id, name, email, external_id, location_id, provider_role, associate_split_percentage, lab_split_percentage, split_source_method, lab_split_percentage_sliding, ' +
          'lab_cost_source_method, lab_cost_percentage, lab_cost_account_id, lab_cost_account_platform, ' +
          'material_cost_source_method, material_cost_percentage, material_cost_account_id, material_cost_account_platform, material_split_percentage',
        )
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .not('external_id', 'is', null);

      if (selectedLocationId) {
        q = q.eq('location_id', selectedLocationId);
      } else if (targetLocationIds && targetLocationIds.length > 0) {
        q = q.in('location_id', targetLocationIds);
      }

      const { data, error } = await q.order('name', { ascending: true });
      if (error) {
        console.error('[AssociateProfit] Error fetching providers:', error);
        return [];
      }
      return (data ?? []) as Array<{
        id: string;
        name: string;
        email: string | null;
        external_id: number;
        location_id: string;
        provider_role: string | null;
        associate_split_percentage: number | null;
        lab_split_percentage: number | null;
        split_source_method: string | null;
        lab_split_percentage_sliding: number | null;
        lab_cost_source_method: ProviderCostSourceMethod | null;
        lab_cost_percentage: number | null;
        lab_cost_account_id: string | null;
        lab_cost_account_platform: ProviderCostAccountPlatform | null;
        material_cost_source_method: ProviderCostSourceMethod | null;
        material_cost_percentage: number | null;
        material_cost_account_id: string | null;
        material_cost_account_platform: ProviderCostAccountPlatform | null;
        material_split_percentage: number | null;
      }>;
    },
    enabled: !!organizationId,
  });

  // Per-provider lab/material cost sourcing — batched once for every
  // provider currently in scope, resolved per-provider in associateData below.
  const providerIdsKey = useMemo(() => providers.map((p) => p.id).sort().join(','), [providers]);
  const { data: providerCostInputsData = null } = useQuery({
    queryKey: ['associate-profit-cost-inputs', organizationId, providerIdsKey, startDateStr, endDateStr],
    queryFn: async () => {
      if (!organizationId || providers.length === 0) return null;
      const rows: ProviderCostInputRow[] = providers.map((p) => ({
        id: p.id,
        location_id: p.location_id ?? null,
        lab_cost_source_method: p.lab_cost_source_method ?? null,
        lab_cost_percentage: p.lab_cost_percentage ?? null,
        lab_cost_account_id: p.lab_cost_account_id ?? null,
        lab_cost_account_platform: p.lab_cost_account_platform ?? null,
        material_cost_source_method: p.material_cost_source_method ?? null,
        material_cost_percentage: p.material_cost_percentage ?? null,
        material_cost_account_id: p.material_cost_account_id ?? null,
        material_cost_account_platform: p.material_cost_account_platform ?? null,
      }));
      return loadProviderCostInputs({
        organizationId,
        providers: rows,
        dateFrom: new Date(startDateStr + 'T12:00:00'),
        dateTo: new Date(endDateStr + 'T12:00:00'),
      });
    },
    enabled: !!organizationId && providers.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  // ── Total Production (Actual) — same source as Profit Goals Settings ──
  const { data: productionData, isLoading: isLoadingProduction } = useAllProvidersNetProduction(
    null,
    dateRange.startDate,
    dateRange.endDate,
    selectedLocationId,
    regionLocationIds,
  );

  // ── Working hours — drives Working Days for OCPSPA ──
  const { data: hoursData, isLoading: isLoadingHours } = useAllProvidersWorkingHours(
    null,
    dateRange.startDate,
    dateRange.endDate,
    selectedLocationId,
  );

  // ── Org settings + Op Costs → OCPSPD (same as Profit Goals Settings) ──
  const { data: profitGoalsMetrics, isLoading: isLoadingMetrics } = useQuery({
    queryKey: [
      'associate-profit-goals-metrics',
      organizationId,
      startDateStr,
      endDateStr,
      selectedLocationId ?? 'all',
    ],
    queryFn: async () => {
      if (!organizationId) return null;

      // Business Settings live per-location — scope by the top-bar location
      // filter, falling back to the org's primary location for "All Locations".
      const businessInfoLocationId = await resolveBusinessInfoLocationId(organizationId, selectedLocationId);
      if (!businessInfoLocationId) return null;

      const { data: orgData, error } = await (supabase as any)
        .from('practice_locations')
        .select(
          `target_profit_percent, week_open_per_year, days_open_per_week,
           open_hours_per_day, number_of_surgeries, associate_weeks_per_year,
           associate_days_per_week, practice_cost_materials_percent, associate_cost_labs_percent`,
        )
        .eq('id', businessInfoLocationId)
        .single();

      if (error || !orgData) {
        console.error('[AssociateProfit] Error fetching location business settings:', error);
        return null;
      }

      const workingDays = countWorkingCalendarDays(dateRange.startDate, dateRange.endDate);
      const numSurgeries = orgData.number_of_surgeries || 0;
      const surgeryDaysPerYear = workingDays * numSurgeries;

      let opCosts = 0;
      try {
        const { amount } = await getOperationalExpense(
          organizationId,
          startDateStr,
          endDateStr,
          selectedLocationId,
        );
        if (amount != null) opCosts = amount;
      } catch (e) {
        console.error('[AssociateProfit] op cost error:', e);
      }

      const ocpspd = surgeryDaysPerYear > 0 ? opCosts / surgeryDaysPerYear : 0;

        return {
          ocpspd,
          openHoursPerDay: orgData.open_hours_per_day || 8,
          practiceCostMaterialsPercent: orgData.practice_cost_materials_percent || 0,
          associateCostLabsPercent: orgData.associate_cost_labs_percent || 0,
        };
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
  });

  // ── Planned values from planned_daily_production ──
  const { data: plannedByProvider = new Map<string, { revenue: number; cost: number; profit: number }>(), isLoading: isLoadingPlanned } = useQuery({
    queryKey: [
      'associate-profit-planned',
      organizationId,
      startDateStr,
      endDateStr,
      providers.map((p) => p.id).join(','),
    ],
    queryFn: async () => {
      const map = new Map<string, { revenue: number; cost: number; profit: number }>();
      if (!organizationId || providers.length === 0) return map;

      const planningMonthStart = `${startDateStr.slice(0, 7)}-01`;
      const planningMonthEnd = `${endDateStr.slice(0, 7)}-01`;
      const providerUuids = providers.map((p) => p.id);

      const { data: plannedRecords } = await (supabase as any)
        .from('planned_daily_production')
        .select(
          'provider_id, planned_total_production, planned_associate_net_pay, planned_cost_of_labs, planned_materials, planned_practice_pl, planning_month',
        )
        .eq('organization_id', organizationId)
        .in('provider_id', providerUuids)
        .gte('planning_month', planningMonthStart)
        .lte('planning_month', planningMonthEnd)
        .order('created_at', { ascending: false });

      const seenProviderMonth = new Set<string>();
      for (const rec of (plannedRecords ?? []) as Array<{
        provider_id: string;
        planned_total_production: number | null;
        planned_associate_net_pay: number | null;
        planned_cost_of_labs: number | null;
        planned_materials: number | null;
        planned_practice_pl: number | null;
        planning_month: string;
      }>) {
        const key = `${rec.provider_id}-${rec.planning_month}`;
        if (seenProviderMonth.has(key)) continue;
        seenProviderMonth.add(key);

        const existing = map.get(rec.provider_id) || { revenue: 0, cost: 0, profit: 0 };
        existing.revenue += Number(rec.planned_total_production) || 0;
        existing.cost +=
          (Number(rec.planned_associate_net_pay) || 0) +
          (Number(rec.planned_cost_of_labs) || 0) +
          (Number(rec.planned_materials) || 0);
        existing.profit += Number(rec.planned_practice_pl) || 0;
        map.set(rec.provider_id, existing);
      }
      return map;
    },
    enabled: !!organizationId && providers.length > 0,
  });

  // ── Build Actual vs Target rows (Profit Goals formulas) ──
  const associateData = useMemo((): AssociateProfitRow[] => {
    if (
      !providers.length ||
      !productionData?.providers ||
      !hoursData?.providers ||
      !profitGoalsMetrics
    ) {
      return [];
    }

    const labPct = profitGoalsMetrics.associateCostLabsPercent;
    const materialsPct = profitGoalsMetrics.practiceCostMaterialsPercent;
    const hoursPerDay = profitGoalsMetrics.openHoursPerDay || 8;
    const ocpspd = profitGoalsMetrics.ocpspd;

    // Deduplicate by email (same person across locations) — matches Profit Goals / production hooks.
    const emailGroupMap = new Map<
      string,
      { provider: (typeof providers)[0]; externalIds: number[] }
    >();
    for (const p of providers) {
      const key = (p.email?.trim() || p.name || '').toLowerCase();
      if (!emailGroupMap.has(key)) {
        emailGroupMap.set(key, { provider: p, externalIds: [] });
      }
      const extId = Number(p.external_id);
      if (!isNaN(extId) && !emailGroupMap.get(key)!.externalIds.includes(extId)) {
        emailGroupMap.get(key)!.externalIds.push(extId);
      }
    }

    const rows: AssociateProfitRow[] = Array.from(emailGroupMap.values()).map(
      ({ provider, externalIds }) => {
        const production =
          productionData.providers.find(
            (p) =>
              externalIds.length > 0 &&
              externalIds.some((id) => p.externalIds.includes(id)),
          ) ??
          productionData.providers.find(
            (p) => p.providerName.toLowerCase() === provider.name.toLowerCase(),
          );

        const hours =
          hoursData.providers.find(
            (p) =>
              externalIds.length > 0 &&
              externalIds.some((id) => p.externalIds.includes(id)),
          ) ??
          hoursData.providers.find(
            (p) => p.providerName.toLowerCase() === provider.name.toLowerCase(),
          );

        const totalProduction = production?.total ?? 0;
        const totalWorkingHours = hours?.totalExact ?? hours?.total ?? 0;
        const workingDays = hoursPerDay > 0 ? totalWorkingHours / hoursPerDay : 0;

        // Same defaults as Profit Goals Settings (ProvidersManagement)
        const associateSplitPercent = provider.associate_split_percentage || 30;
        const associateLabSplitPercent = provider.lab_split_percentage || 50;
        const associateMaterialSplitPercent = provider.material_split_percentage || 50;

        // Resolve this provider's own lab/material cost — location flat
        // percentage unless their location is Associate Wise and they've
        // been configured with their own cost source.
        const gate = provider.location_id
          ? providerCostInputsData?.locationGateByLocationId.get(provider.location_id)
          : undefined;
        const labGateActive = gate?.associate_cost_lab_source === 'associate_wise';
        const materialGateActive = gate?.material_cost_source === 'associate_wise';
        const labResolved = resolveProviderCost({
          sourceMethod: labGateActive ? provider.lab_cost_source_method : null,
          flatPercentage: provider.lab_cost_percentage,
          production: totalProduction,
          accountAmount: providerCostInputsData?.accountAmountByProviderId.get(provider.id)?.lab ?? null,
          monthlyValues: providerCostInputsData?.monthlyValuesByProviderId.get(provider.id)?.lab ?? [],
          monthlyBillByMonth: provider.location_id ? (providerCostInputsData?.monthlyBillByLocationId.get(provider.location_id)?.lab ?? []) : [],
          bands: providerCostInputsData?.bandsByProviderId.get(provider.id)?.lab ?? [],
          fallbackLocationPercent: gate?.associate_cost_labs_percent ?? labPct,
        });
        const materialResolved = resolveProviderCost({
          sourceMethod: materialGateActive ? provider.material_cost_source_method : null,
          flatPercentage: provider.material_cost_percentage,
          production: totalProduction,
          accountAmount: providerCostInputsData?.accountAmountByProviderId.get(provider.id)?.material ?? null,
          monthlyValues: providerCostInputsData?.monthlyValuesByProviderId.get(provider.id)?.material ?? [],
          monthlyBillByMonth: provider.location_id ? (providerCostInputsData?.monthlyBillByLocationId.get(provider.location_id)?.material ?? []) : [],
          bands: providerCostInputsData?.bandsByProviderId.get(provider.id)?.material ?? [],
          fallbackLocationPercent: gate?.practice_cost_materials_percent ?? materialsPct,
        });
        const costOfLabs = labResolved.amount;
        const materialsCosts = materialResolved.amount;

        // "Is Associate Pay Including Lab/Material Cost" (Business Settings) gates
        // whether the associate's own split of each cost is deducted from their net
        // pay. Lab defaults to true (this deduction was previously unconditional),
        // material defaults to false (it was never deducted before these flags
        // existed) — so untouched locations keep behaving exactly as before.
        const includesLabCost = gate?.is_associate_pay_including_lab_cost ?? true;
        const includesMaterialCost = gate?.is_associate_pay_including_material_cost ?? false;

        const associateGrossShare = totalProduction * (associateSplitPercent / 100);
        const labCostDeduction = includesLabCost ? costOfLabs * (associateLabSplitPercent / 100) : 0;
        const materialCostDeduction = includesMaterialCost ? materialsCosts * (associateMaterialSplitPercent / 100) : 0;
        const associateNetPay = associateGrossShare - labCostDeduction - materialCostDeduction;
        const ocpspaContribution = ocpspd * workingDays;

        const currentRevenue = totalProduction;
        const currentCost =
          associateNetPay + costOfLabs + materialsCosts + ocpspaContribution;
        const currentProfit = currentRevenue - currentCost;

        const planned = plannedByProvider.get(provider.id) || {
          revenue: 0,
          cost: 0,
          profit: 0,
        };

        return {
          id: provider.id,
          name: provider.name,
          role: provider.provider_role || 'Provider',
          currentRevenue: round2(currentRevenue),
          currentCost: round2(currentCost),
          currentProfit: round2(currentProfit),
          plannedRevenue: round2(planned.revenue),
          plannedCost: round2(planned.cost),
          plannedProfit: round2(planned.profit),
        };
      },
    );

    const withActivity = rows.filter((r) => r.currentRevenue > 0);
    const withoutActivity = rows.filter((r) => r.currentRevenue === 0);
    withActivity.sort((a, b) => a.name.localeCompare(b.name));
    withoutActivity.sort((a, b) => a.name.localeCompare(b.name));
    return [...withActivity, ...withoutActivity];
  }, [providers, productionData, hoursData, profitGoalsMetrics, plannedByProvider, providerCostInputsData]);

  // ── Monthly trends: last 6 months actual profit (same Profit Goals formula) ──
  const monthBuckets = useMemo(() => {
    const buckets: { label: string; startDate: string; endDate: string; period: string }[] = [];
    const now = dateRange.endDate;
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const label = d.toLocaleString('default', { month: 'short' });
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.push({ label, startDate: toDateStr(d), endDate: toDateStr(lastDay), period });
    }
    return buckets;
  }, [dateRange.endDate]);

  const trendStart = useMemo(
    () => new Date(monthBuckets[0].startDate + 'T12:00:00'),
    [monthBuckets],
  );
  const trendEnd = useMemo(
    () => new Date(monthBuckets[monthBuckets.length - 1].endDate + 'T12:00:00'),
    [monthBuckets],
  );

  const { data: trendProduction, isLoading: isLoadingTrendProd } = useAllProvidersNetProduction(
    null,
    trendStart,
    trendEnd,
    selectedLocationId,
    regionLocationIds,
  );

  const { data: trendHours, isLoading: isLoadingTrendHours } = useAllProvidersWorkingHours(
    null,
    trendStart,
    trendEnd,
    selectedLocationId,
  );

  // Per-provider lab/material cost sourcing over the 6-month trend window —
  // same resolution as `providerCostInputsData` above (account/monthly/sliding
  // scale/flat %), just scoped to the trend range instead of the filter range.
  // Without this the monthly trend fell back to a flat location percentage,
  // which diverges from the Associate Profit Planning Details table below it
  // whenever a provider has a per-provider cost override configured.
  const { data: trendProviderCostInputsData = null, isLoading: isLoadingTrendCostInputs } = useQuery({
    queryKey: [
      'associate-profit-trend-cost-inputs',
      organizationId,
      providerIdsKey,
      monthBuckets[0]?.startDate,
      monthBuckets[monthBuckets.length - 1]?.endDate,
    ],
    queryFn: async () => {
      if (!organizationId || providers.length === 0) return null;
      const rows: ProviderCostInputRow[] = providers.map((p) => ({
        id: p.id,
        location_id: p.location_id ?? null,
        lab_cost_source_method: p.lab_cost_source_method ?? null,
        lab_cost_percentage: p.lab_cost_percentage ?? null,
        lab_cost_account_id: p.lab_cost_account_id ?? null,
        lab_cost_account_platform: p.lab_cost_account_platform ?? null,
        material_cost_source_method: p.material_cost_source_method ?? null,
        material_cost_percentage: p.material_cost_percentage ?? null,
        material_cost_account_id: p.material_cost_account_id ?? null,
        material_cost_account_platform: p.material_cost_account_platform ?? null,
      }));
      return loadProviderCostInputs({
        organizationId,
        providers: rows,
        dateFrom: trendStart,
        dateTo: trendEnd,
      });
    },
    enabled: !!organizationId && providers.length > 0 && monthBuckets.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  // OCPSPD over the 6-month trend window (same method as Profit Goals)
  const { data: trendOcpspd = 0, isLoading: isLoadingTrendOcpspd } = useQuery({
    queryKey: [
      'associate-profit-trend-ocpspd',
      organizationId,
      monthBuckets[0]?.startDate,
      monthBuckets[monthBuckets.length - 1]?.endDate,
      selectedLocationId ?? 'all',
      profitGoalsMetrics?.openHoursPerDay,
    ],
    queryFn: async () => {
      if (!organizationId || !profitGoalsMetrics) return 0;
      const businessInfoLocationId = await resolveBusinessInfoLocationId(organizationId, selectedLocationId);
      const { data: orgData } = businessInfoLocationId
        ? await (supabase as any)
            .from('practice_locations')
            .select('number_of_surgeries')
            .eq('id', businessInfoLocationId)
            .single()
        : { data: null };

      const from = new Date(monthBuckets[0].startDate + 'T12:00:00');
      const to = new Date(monthBuckets[monthBuckets.length - 1].endDate + 'T12:00:00');
      const workingDays = countWorkingCalendarDays(from, to);
      const surgeryDays = workingDays * (orgData?.number_of_surgeries || 0);

      let opCosts = 0;
      try {
        const { amount } = await getOperationalExpense(
          organizationId,
          monthBuckets[0].startDate,
          monthBuckets[monthBuckets.length - 1].endDate,
          selectedLocationId,
        );
        if (amount != null) opCosts = amount;
      } catch {
        /* ignore */
      }
      return surgeryDays > 0 ? opCosts / surgeryDays : 0;
    },
    enabled: !!organizationId && !!profitGoalsMetrics && monthBuckets.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  const { data: monthlyTrends = [] as AssociateMonthlyTrend[], isLoading: isLoadingTrendsPlanned } =
    useQuery({
      queryKey: [
        'associate-profit-monthly-v2',
        organizationId,
        monthBuckets.map((b) => b.period).join(','),
        selectedLocationId,
        selectedRegionId,
        providers.map((p) => p.id).join(','),
        trendProduction?.providers?.length,
        trendHours?.providers?.length,
        !!trendProviderCostInputsData,
        trendOcpspd,
        profitGoalsMetrics?.associateCostLabsPercent,
        profitGoalsMetrics?.practiceCostMaterialsPercent,
        profitGoalsMetrics?.openHoursPerDay,
      ],
      queryFn: async (): Promise<AssociateMonthlyTrend[]> => {
        if (!organizationId || providers.length === 0 || !profitGoalsMetrics) {
          return monthBuckets.map((b) => ({ month: b.label, period: b.period, actual: 0, planned: 0 }));
        }

        const labPct = profitGoalsMetrics.associateCostLabsPercent;
        const materialsPct = profitGoalsMetrics.practiceCostMaterialsPercent;
        const hoursPerDay = profitGoalsMetrics.openHoursPerDay || 8;

        // Planned profit per month
        const providerUuids = providers.map((p) => p.id);
        const planningMonths = monthBuckets.map((b) => `${b.period}-01`);
        const { data: plannedRecords } = await (supabase as any)
          .from('planned_daily_production')
          .select('provider_id, planned_practice_pl, planning_month')
          .eq('organization_id', organizationId)
          .in('provider_id', providerUuids)
          .in('planning_month', planningMonths)
          .order('created_at', { ascending: false });

        const plannedByMonth = new Map<string, number>();
        const seenProviderMonth = new Set<string>();
        for (const rec of (plannedRecords ?? []) as Array<{
          provider_id: string;
          planned_practice_pl: number | null;
          planning_month: string;
        }>) {
          const dedupKey = `${rec.provider_id}-${rec.planning_month}`;
          if (seenProviderMonth.has(dedupKey)) continue;
          seenProviderMonth.add(dedupKey);
          const period = (rec.planning_month as string).slice(0, 7);
          plannedByMonth.set(
            period,
            (plannedByMonth.get(period) || 0) + (Number(rec.planned_practice_pl) || 0),
          );
        }

        // Deduplicate providers by email
        const emailGroupMap = new Map<
          string,
          { provider: (typeof providers)[0]; externalIds: number[] }
        >();
        for (const p of providers) {
          const key = (p.email?.trim() || p.name || '').toLowerCase();
          if (!emailGroupMap.has(key)) {
            emailGroupMap.set(key, { provider: p, externalIds: [] });
          }
          const extId = Number(p.external_id);
          if (!isNaN(extId) && !emailGroupMap.get(key)!.externalIds.includes(extId)) {
            emailGroupMap.get(key)!.externalIds.push(extId);
          }
        }

        // Production/hours hooks key months as date-fns `MMM-yy` (e.g. "Oct-24")
        const monthLabelToPeriod = new Map<string, string>();
        for (const b of monthBuckets) {
          const d = new Date(b.startDate + 'T12:00:00');
          monthLabelToPeriod.set(format(d, 'MMM-yy'), b.period);
        }

        const actualByMonth = new Map<string, number>();
        for (const b of monthBuckets) actualByMonth.set(b.period, 0);

        for (const { provider, externalIds } of emailGroupMap.values()) {
          const prod =
            trendProduction?.providers.find(
              (p) =>
                externalIds.length > 0 &&
                externalIds.some((id) => p.externalIds.includes(id)),
            ) ??
            trendProduction?.providers.find(
              (p) => p.providerName.toLowerCase() === provider.name.toLowerCase(),
            );

          const hrs =
            trendHours?.providers.find(
              (p) =>
                externalIds.length > 0 &&
                externalIds.some((id) => p.externalIds.includes(id)),
            ) ??
            trendHours?.providers.find(
              (p) => p.providerName.toLowerCase() === provider.name.toLowerCase(),
            );

          if (!prod) continue;

          const associateSplitPercent = provider.associate_split_percentage || 30;
          const associateLabSplitPercent = provider.lab_split_percentage || 50;
          const associateMaterialSplitPercent = provider.material_split_percentage || 50;

          // Same per-provider cost resolution + gating as the Associate Profit
          // Planning Details table (associateData below), resolved once over
          // the whole trend window, then apportioned across months by each
          // month's share of the window's total production. Percentage-based
          // cost bases come out exact per month this way; absolute-£ bases
          // (account / monthly / sliding-scale) only resolve to one total for
          // the range they're queried over, so pro-rata production share is
          // the closest monthly split without re-querying per month.
          const gate = provider.location_id
            ? trendProviderCostInputsData?.locationGateByLocationId.get(provider.location_id)
            : undefined;
          const labGateActive = gate?.associate_cost_lab_source === 'associate_wise';
          const materialGateActive = gate?.material_cost_source === 'associate_wise';
          const includesLabCost = gate?.is_associate_pay_including_lab_cost ?? true;
          const includesMaterialCost = gate?.is_associate_pay_including_material_cost ?? false;

          const trendTotalProduction = prod.total ?? 0;
          const labResolved = resolveProviderCost({
            sourceMethod: labGateActive ? provider.lab_cost_source_method : null,
            flatPercentage: provider.lab_cost_percentage,
            production: trendTotalProduction,
            accountAmount: trendProviderCostInputsData?.accountAmountByProviderId.get(provider.id)?.lab ?? null,
            monthlyValues: trendProviderCostInputsData?.monthlyValuesByProviderId.get(provider.id)?.lab ?? [],
            monthlyBillByMonth: provider.location_id ? (trendProviderCostInputsData?.monthlyBillByLocationId.get(provider.location_id)?.lab ?? []) : [],
            bands: trendProviderCostInputsData?.bandsByProviderId.get(provider.id)?.lab ?? [],
            fallbackLocationPercent: gate?.associate_cost_labs_percent ?? labPct,
          });
          const materialResolved = resolveProviderCost({
            sourceMethod: materialGateActive ? provider.material_cost_source_method : null,
            flatPercentage: provider.material_cost_percentage,
            production: trendTotalProduction,
            accountAmount: trendProviderCostInputsData?.accountAmountByProviderId.get(provider.id)?.material ?? null,
            monthlyValues: trendProviderCostInputsData?.monthlyValuesByProviderId.get(provider.id)?.material ?? [],
            monthlyBillByMonth: provider.location_id ? (trendProviderCostInputsData?.monthlyBillByLocationId.get(provider.location_id)?.material ?? []) : [],
            bands: trendProviderCostInputsData?.bandsByProviderId.get(provider.id)?.material ?? [],
            fallbackLocationPercent: gate?.practice_cost_materials_percent ?? materialsPct,
          });
          const trendTotalCostOfLabs = labResolved.amount;
          const trendTotalMaterialsCosts = materialResolved.amount;

          for (const [monthKey, cell] of Object.entries(prod.monthlyData)) {
            const period = monthLabelToPeriod.get(monthKey);
            if (!period) continue;

            const monthProduction =
              typeof cell === 'object' && cell !== null
                ? Number((cell as any).amount) || 0
                : Number(cell) || 0;
            const productionShare =
              trendTotalProduction > 0 ? monthProduction / trendTotalProduction : 0;

            const monthHours = hrs?.monthlyData?.[monthKey] ?? 0;
            const workingDays = hoursPerDay > 0 ? monthHours / hoursPerDay : 0;

            const costOfLabs = trendTotalCostOfLabs * productionShare;
            const materialsCosts = trendTotalMaterialsCosts * productionShare;
            const associateGrossShare = monthProduction * (associateSplitPercent / 100);
            const labCostDeduction = includesLabCost
              ? costOfLabs * (associateLabSplitPercent / 100)
              : 0;
            const materialCostDeduction = includesMaterialCost
              ? materialsCosts * (associateMaterialSplitPercent / 100)
              : 0;
            const associateNetPay = associateGrossShare - labCostDeduction - materialCostDeduction;
            const ocpspaContribution = trendOcpspd * workingDays;
            const profit =
              monthProduction -
              (associateNetPay + costOfLabs + materialsCosts + ocpspaContribution);

            actualByMonth.set(period, (actualByMonth.get(period) || 0) + profit);
          }
        }

        return monthBuckets.map((b) => ({
          month: b.label,
          period: b.period,
          actual: Math.round(actualByMonth.get(b.period) || 0),
          planned: Math.round(plannedByMonth.get(b.period) || 0),
        }));
      },
      enabled:
        !!organizationId &&
        providers.length > 0 &&
        !!profitGoalsMetrics &&
        !!trendProduction &&
        !!trendHours,
    });

  const isLoading =
    isLoadingProviders ||
    isLoadingProduction ||
    isLoadingHours ||
    isLoadingMetrics ||
    isLoadingPlanned ||
    isLoadingTrendProd ||
    isLoadingTrendHours ||
    isLoadingTrendCostInputs ||
    isLoadingTrendOcpspd ||
    isLoadingTrendsPlanned;

  // The trend's own month bucket for whichever month the top filter is
  // currently on is only ever an estimate (pro-rated absolute-£ costs, a
  // separately-queried OCPSPD rate — see the comment above trendOcpspd).
  // Force that one bucket to the exact totals the table/stat-tiles below
  // already show, so the graph point for "this month" always agrees with
  // the numbers directly under it. Only when the filter is a single
  // calendar month — a multi-month filter has no one bucket to stand in for.
  const currentFilterPeriod = useMemo(() => {
    const startPeriod = format(dateRange.startDate, 'yyyy-MM');
    const endPeriod = format(dateRange.endDate, 'yyyy-MM');
    return startPeriod === endPeriod ? startPeriod : null;
  }, [dateRange.startDate, dateRange.endDate]);

  const monthlyTrendsExact = useMemo(() => {
    if (!currentFilterPeriod || monthlyTrends.length === 0) return monthlyTrends;
    const totalCurrentProfit = associateData.reduce((sum, a) => sum + a.currentProfit, 0);
    const totalPlannedProfit = associateData.reduce((sum, a) => sum + a.plannedProfit, 0);
    return monthlyTrends.map((t) =>
      t.period === currentFilterPeriod
        ? { ...t, actual: Math.round(totalCurrentProfit), planned: Math.round(totalPlannedProfit) }
        : t,
    );
  }, [monthlyTrends, associateData, currentFilterPeriod]);

  return {
    associateData,
    monthlyTrends: monthlyTrendsExact,
    isLoading,
  };
}
