import { useState, useMemo, useEffect, Fragment } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Helmet } from "react-helmet-async";
import { useOrganization } from "@/hooks/useOrganization";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { usePlanAccess } from "@/hooks/usePlanAccess";
import { useFilters } from "@/contexts/FilterContext";
import { useAllProvidersNetProduction } from "@/hooks/useAllProvidersNetProduction";
import { useAllProvidersWorkingHours } from "@/hooks/useAllProvidersWorkingHours";
import { useLocations } from "@/hooks/useLocations";
import { getOperationalExpense } from "@/services/integrations/plCostService";
import { resolveBusinessInfoLocationId } from "@/lib/businessInfoLocation";
import { loadProviderCostInputs, type ProviderCostInputRow, type ProviderCostInputsResult } from "@/lib/providerCostInputs";
import { resolveProviderCost, isProductionScaledBasis } from "@/lib/providerCostResolution";

const r2 = (n: number) => Math.round((n ?? 0) * 100) / 100;
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { DatePicker, ConfigProvider } from "antd";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, X } from "lucide-react";

const fmtCurrencyBase = (v: number, showDecimals: boolean): string => {
  const formatted = Math.abs(v).toLocaleString("en-GB", {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });
  return v < 0 ? `-£${formatted}` : `£${formatted}`;
};
const fmtPctBase = (v: number, showDecimals: boolean) =>
  `${v.toFixed(showDecimals ? 2 : 0)}%`;

const antdTheme = {
  token: {
    colorPrimary: "hsl(244, 48%, 25%)",
    colorPrimaryBg: "#e6f4ff",
    colorPrimaryBgHover: "#bae0ff",
  },
};

export default function ProfitPlanningByAssociates() {
  const { organizationId } = useOrganization();
  const { isModuleAllowedByPlan } = usePlanAccess();
  const lockedForPlan = !isModuleAllowedByPlan("budget");
  const { showDecimals } = useOrganizationSettings();
  // Shadow the module-level helpers so every call site below picks up the
  // org's "Show Decimals" setting without threading it through each call.
  const fmtCurrency = (v: number) => fmtCurrencyBase(v, showDecimals);
  const fmtPct = (v: number) => fmtPctBase(v, showDecimals);
  const { selectedLocationId, dateRange: globalDateRange } = useFilters();
  const { allAvailableLocations } = useLocations();
  const selectedLocationName = selectedLocationId
    ? (allAvailableLocations?.find((l) => l.id === selectedLocationId)
        ?.location_name ?? "Selected location")
    : "All locations";

  const [profitGoalsDateRange, setProfitGoalsDateRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>({ from: null, to: null });
  const [planningMonth, setPlanningMonth] = useState<Date | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [providersPlannedProduction, setProvidersPlannedProduction] = useState<
    Record<string, number>
  >({});
  const [providersPlannedInput, setProvidersPlannedInput] = useState<
    Record<string, string>
  >({});

  const [profitGoalsMetrics, setProfitGoalsMetrics] = useState({
    opCosts: 0,
    targetProfitPercent: 0,
    ocpspd: 0,
    weeksOpenPerYear: 0,
    daysOpenPerWeek: 0,
    openHoursPerDay: 8,
    numSurgeries: 0,
    workingDays: 0,
    surgeryDaysPerYear: 0,
    assocWeeksPerYear: 0,
    assocDaysPerWeek: 0,
    assocDaysPerYear: 0,
    practiceCostMaterialsPercent: 0,
    associateCostLabsPercent: 0,
  });

  // Business Settings — now per-location. Scope by the top-bar location
  // filter, falling back to the org's primary location for "All Locations".
  const { data: organizationData } = useQuery({
    queryKey: ["org-settings-planning-associates", organizationId, selectedLocationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const locationId = await resolveBusinessInfoLocationId(organizationId, selectedLocationId);
      if (!locationId) return null;
      const { data, error } = await (supabase as any)
        .from("practice_locations")
        .select(
          `target_profit_percent, week_open_per_year, days_open_per_week,
          open_hours_per_day, number_of_surgeries, associate_weeks_per_year,
          associate_days_per_week, practice_cost_materials_percent, associate_cost_labs_percent`,
        )
        .eq("id", locationId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // Providers with split percentages — filter by location when one is selected,
  // matching the same logic used in the Dentist/Therapist/etc management pages.
  const { data: providers = [], isLoading: isLoadingProviders } = useQuery({
    queryKey: [
      "providers-planning-associates",
      organizationId,
      selectedLocationId,
    ],
    queryFn: async () => {
      if (!organizationId) return [];
      let query = (supabase as any)
        .from("providers")
        .select(
          "id, name, email, external_id, location_id, provider_role, associate_split_percentage, lab_split_percentage, split_source_method, lab_split_percentage_sliding, " +
          "lab_cost_source_method, lab_cost_percentage, lab_cost_account_id, lab_cost_account_platform, " +
          "material_cost_source_method, material_cost_percentage, material_cost_account_id, material_cost_account_platform",
        )
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name");
      if (selectedLocationId && selectedLocationId !== "all") {
        query = query.eq("location_id", selectedLocationId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  // Load previously saved planned production so it persists across visits —
  // same source of truth (planned_daily_production, most recent row per
  // provider) that Profit Goals Settings uses.
  useEffect(() => {
    const fetchPlannedRecords = async () => {
      if (!organizationId || providers.length === 0) return;
      const providerIds = (providers as any[]).map((p) => p.id);

      // Providers with no saved record are left out of these maps entirely —
      // the table falls back to the actual avg daily production as the
      // starting value, rather than a misleading £0.
      const plannedByProvider: Record<string, number> = {};
      const plannedInputByProvider: Record<string, string> = {};

      const { data, error } = await (supabase as any)
        .from("planned_daily_production")
        .select("provider_id, average_daily_production, created_at")
        .eq("organization_id", organizationId)
        .in("provider_id", providerIds)
        .order("created_at", { ascending: false });

      if (error) {
        console.error(
          "[ProfitPlanningByAssociates] Error fetching planned production records:",
          error,
        );
        return;
      }

      const seen = new Set<string>();
      (data ?? []).forEach((record: any) => {
        if (!seen.has(record.provider_id)) {
          const savedValue = Number(record.average_daily_production) || 0;
          plannedByProvider[record.provider_id] = savedValue;
          plannedInputByProvider[record.provider_id] = String(savedValue);
          seen.add(record.provider_id);
        }
      });

      setProvidersPlannedProduction(plannedByProvider);
      setProvidersPlannedInput(plannedInputByProvider);
    };
    fetchPlannedRecords();
  }, [organizationId, providers]);

  // Per-provider lab/material cost sourcing — batched once for every
  // provider currently in scope, resolved per-provider in providersMetrics.
  const providerIdsKey = (providers as any[]).map((p) => p.id).sort().join(",");
  const { data: providerCostInputsData = null } = useQuery({
    queryKey: ["profit-planning-cost-inputs", organizationId, providerIdsKey, profitGoalsDateRange.from, profitGoalsDateRange.to],
    queryFn: async (): Promise<ProviderCostInputsResult | null> => {
      if (!organizationId || providers.length === 0 || !profitGoalsDateRange.from || !profitGoalsDateRange.to) return null;
      const rows: ProviderCostInputRow[] = (providers as any[]).map((p) => ({
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
        dateFrom: profitGoalsDateRange.from,
        dateTo: profitGoalsDateRange.to,
      });
    },
    enabled: !!organizationId && providers.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  // Production & hours data
  const { data: productionData, isLoading: isLoadingProduction } =
    useAllProvidersNetProduction(
      null,
      profitGoalsDateRange.from,
      profitGoalsDateRange.to,
      selectedLocationId,
    );
  const { data: hoursData, isLoading: isLoadingHours } =
    useAllProvidersWorkingHours(
      null,
      profitGoalsDateRange.from,
      profitGoalsDateRange.to,
      selectedLocationId,
    );

  const isLoadingTable =
    isLoadingProviders || isLoadingProduction || isLoadingHours;

  // Sync "Date Selection for Operations" with the navbar's global date
  // filter — same pattern as Profit Goals Settings (ProvidersManagement).
  // The user can still narrow/change it locally afterward.
  useEffect(() => {
    setProfitGoalsDateRange({
      from: globalDateRange.startDate,
      to: globalDateRange.endDate,
    });
  }, [globalDateRange.startDate.getTime(), globalDateRange.endDate.getTime()]);

  // Planning Month still defaults to the current month on first load.
  useEffect(() => {
    const now = new Date();
    setPlanningMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  // Recalculate metrics when org data or date range changes
  useEffect(() => {
    const calc = async () => {
      if (
        !organizationData ||
        !profitGoalsDateRange.from ||
        !profitGoalsDateRange.to ||
        !organizationId
      )
        return;

      const startDate = profitGoalsDateRange.from;
      const endDate = profitGoalsDateRange.to;

      let workingDays = 0;
      const cur = new Date(startDate);
      while (cur <= endDate) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) workingDays++;
        cur.setDate(cur.getDate() + 1);
      }

      const numSurgeries = organizationData.number_of_surgeries || 0;
      const surgeryDaysPerYear = workingDays * numSurgeries;
      const assocDaysPerYear =
        (organizationData.associate_weeks_per_year || 0) *
        (organizationData.associate_days_per_week || 0);

      const toLocalStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      let opCosts = 0;
      try {
        const { amount } = await getOperationalExpense(
          organizationId,
          toLocalStr(startDate),
          toLocalStr(endDate),
          selectedLocationId,
        );
        if (amount != null) opCosts = amount;
      } catch (e) {
        console.error("[ProfitPlanningByAssociates] op cost error:", e);
      }

      const ocpspd = surgeryDaysPerYear > 0 ? opCosts / surgeryDaysPerYear : 0;

      setProfitGoalsMetrics({
        opCosts,
        targetProfitPercent: organizationData.target_profit_percent || 0,
        ocpspd,
        weeksOpenPerYear: organizationData.week_open_per_year || 0,
        daysOpenPerWeek: organizationData.days_open_per_week || 0,
        openHoursPerDay: organizationData.open_hours_per_day || 8,
        numSurgeries,
        workingDays,
        surgeryDaysPerYear,
        assocWeeksPerYear: organizationData.associate_weeks_per_year || 0,
        assocDaysPerWeek: organizationData.associate_days_per_week || 0,
        assocDaysPerYear,
        practiceCostMaterialsPercent:
          organizationData.practice_cost_materials_percent || 0,
        associateCostLabsPercent:
          organizationData.associate_cost_labs_percent || 0,
      });
    };
    calc();
  }, [
    organizationData,
    profitGoalsDateRange,
    organizationId,
    selectedLocationId,
  ]);

  // Planned-only metrics per provider
  const providersMetrics = useMemo(() => {
    if (!productionData?.providers || !hoursData?.providers) return [];

    const startDate = profitGoalsDateRange.from;
    const endDate = profitGoalsDateRange.to;
    const numberOfMonths =
      startDate && endDate
        ? (endDate.getFullYear() - startDate.getFullYear()) * 12 +
          (endDate.getMonth() - startDate.getMonth()) +
          1
        : 12;
    const labPct = profitGoalsMetrics.associateCostLabsPercent;
    const materialsPct = profitGoalsMetrics.practiceCostMaterialsPercent;
    const hoursPerDay = profitGoalsMetrics.openHoursPerDay || 8;

    // Deduplicate providers by email (or name) — same logic as the production/hours hooks.
    // Each person may have one providers row per location; we pick the first as representative
    // and collect all external_ids across duplicates.
    const emailGroupMap = new Map<
      string,
      { provider: any; externalIds: number[] }
    >();
    for (const p of providers as any[]) {
      const key = (p.email?.trim() || "" || p.name || "").toLowerCase();
      if (!emailGroupMap.has(key)) {
        emailGroupMap.set(key, { provider: p, externalIds: [] });
      }
      if (p.external_id) {
        const extId = Number(p.external_id);
        if (
          !isNaN(extId) &&
          !emailGroupMap.get(key)!.externalIds.includes(extId)
        ) {
          emailGroupMap.get(key)!.externalIds.push(extId);
        }
      }
    }

    return (
      Array.from(emailGroupMap.values())
        .map(({ provider, externalIds }) => {
          const hrs =
            hoursData.providers.find(
              (p) =>
                externalIds.length > 0 &&
                externalIds.some((id) => p.externalIds.includes(id)),
            ) ??
            hoursData.providers.find(
              (p) =>
                p.providerName.toLowerCase() === provider.name.toLowerCase(),
            );

          const prod =
            productionData.providers.find(
              (p) =>
                externalIds.length > 0 &&
                externalIds.some((id) => p.externalIds.includes(id)),
            ) ??
            productionData.providers.find(
              (p) =>
                p.providerName.toLowerCase() === provider.name.toLowerCase(),
            );

          const totalWorkingHours = hrs?.totalExact ?? hrs?.total ?? 0;
          const workingDays =
            hoursPerDay > 0 ? totalWorkingHours / hoursPerDay : 0;
          const actualTotalProduction = prod?.total ?? 0;
          const actualAvgDaily =
            workingDays > 0 ? actualTotalProduction / workingDays : 0;

          const assocSplitPct = provider.associate_split_percentage || 30;
          const labSplitPct =
            provider.split_source_method === "sliding-scale"
              ? provider.lab_split_percentage_sliding || 50
              : provider.lab_split_percentage || 50;

          // Resolve this provider's own lab/material cost — location flat
          // percentage unless their location is Associate Wise and they've
          // been configured with their own cost source.
          const gate = provider.location_id
            ? providerCostInputsData?.locationGateByLocationId.get(provider.location_id)
            : undefined;
          const labGateActive = gate?.associate_cost_lab_source === "associate_wise";
          const materialGateActive = gate?.material_cost_source === "associate_wise";
          const labResolved = resolveProviderCost({
            sourceMethod: labGateActive ? provider.lab_cost_source_method : null,
            flatPercentage: provider.lab_cost_percentage,
            production: actualTotalProduction,
            accountAmount: providerCostInputsData?.accountAmountByProviderId.get(provider.id)?.lab ?? null,
            monthlyValues: providerCostInputsData?.monthlyValuesByProviderId.get(provider.id)?.lab ?? [],
            monthlyBillByMonth: provider.location_id ? (providerCostInputsData?.monthlyBillByLocationId.get(provider.location_id)?.lab ?? []) : [],
            bands: providerCostInputsData?.bandsByProviderId.get(provider.id)?.lab ?? [],
            fallbackLocationPercent: gate?.associate_cost_labs_percent ?? labPct,
          });
          const materialResolved = resolveProviderCost({
            sourceMethod: materialGateActive ? provider.material_cost_source_method : null,
            flatPercentage: provider.material_cost_percentage,
            production: actualTotalProduction,
            accountAmount: providerCostInputsData?.accountAmountByProviderId.get(provider.id)?.material ?? null,
            monthlyValues: providerCostInputsData?.monthlyValuesByProviderId.get(provider.id)?.material ?? [],
            monthlyBillByMonth: provider.location_id ? (providerCostInputsData?.monthlyBillByLocationId.get(provider.location_id)?.material ?? []) : [],
            bands: providerCostInputsData?.bandsByProviderId.get(provider.id)?.material ?? [],
            fallbackLocationPercent: gate?.practice_cost_materials_percent ?? materialsPct,
          });
          const actualCostOfLabs = labResolved.amount;
          const actualMaterials = materialResolved.amount;

          // Falls back to the actual avg daily production — same default
          // shown in the input — until the associate has their own saved plan.
          const plannedAvgDaily =
            providersPlannedProduction[provider.id] ?? actualAvgDaily;
          const plannedTotalProduction = plannedAvgDaily * workingDays;
          const plannedAssocGross =
            plannedTotalProduction * (assocSplitPct / 100);
          // Absolute-£ sources (accounting application / sliding scale /
          // monthly) have no defined "planned" variant that scales with
          // planned production — the actual resolved figure is the honest
          // number to use as the plan too.
          const plannedCostOfLabs = isProductionScaledBasis(labResolved.basis)
            ? plannedTotalProduction * (actualTotalProduction > 0 ? actualCostOfLabs / actualTotalProduction : 0)
            : actualCostOfLabs;
          const plannedMaterials = isProductionScaledBasis(materialResolved.basis)
            ? plannedTotalProduction * (actualTotalProduction > 0 ? actualMaterials / actualTotalProduction : 0)
            : actualMaterials;
          const plannedLabDeduction = plannedCostOfLabs * (labSplitPct / 100);
          const plannedAssocNetPay = plannedAssocGross - plannedLabDeduction;
          // Avg lab cost uses actual production (same as Profit Goals Settings), not planned
          const avgLabCostPerMonth = numberOfMonths > 0 ? actualCostOfLabs / numberOfMonths : 0;
          const ocpspaContribution = profitGoalsMetrics.ocpspd * workingDays;
          const plannedPracticePL =
            plannedTotalProduction -
            (plannedAssocNetPay +
              plannedCostOfLabs +
              plannedMaterials +
              ocpspaContribution);
          const plannedPLPct =
            plannedTotalProduction > 0
              ? (plannedPracticePL / plannedTotalProduction) * 100
              : 0;

          // P/L on Room per day & P/L % on OCPSPD use actual production (same as Profit Goals Settings)
          const actualAssocNetPay =
            actualTotalProduction * (assocSplitPct / 100) -
            actualCostOfLabs * (labSplitPct / 100);
          const actualPracticePL =
            actualTotalProduction -
            (actualAssocNetPay +
              actualCostOfLabs +
              actualMaterials +
              ocpspaContribution);
          const actualPLPct =
            actualTotalProduction > 0
              ? (actualPracticePL / actualTotalProduction) * 100
              : 0;
          const plOnRoomPerDay =
            workingDays > 0 ? actualPracticePL / workingDays : 0;
          const plPctOnOCPSPD =
            ocpspaContribution > 0
              ? (actualPracticePL / ocpspaContribution) * 100
              : 0;

          return {
            provider,
            workingDays,
            assocSplitPct,
            labSplitPct,
            actualAvgDaily,
            plannedAvgDaily,
            plannedTotalProduction,
            plannedAssocNetPay,
            plannedCostOfLabs,
            avgLabCostPerMonth,
            plannedMaterials,
            ocpspaContribution,
            plannedPracticePL,
            plannedPLPct,
            actualTotalProduction,
            actualAssocNetPay,
            actualCostOfLabs,
            actualMaterials,
            actualPracticePL,
            actualPLPct,
            plOnRoomPerDay,
            plPctOnOCPSPD,
          };
        })
        // Only show providers who have actual working hours in the selected date range
        .filter((pm) => pm.workingDays > 0)
    );
  }, [
    providers,
    hoursData,
    profitGoalsMetrics,
    profitGoalsDateRange,
    providersPlannedProduction,
    productionData,
    providerCostInputsData,
  ]);

  const rowsForAI = providersMetrics.slice(0, 60).map((pm) => ({
    name: pm.provider.name,
    workingDays: r2(pm.workingDays),
    assocSplitPct: pm.assocSplitPct,
    labSplitPct: pm.labSplitPct,
    plannedAvgDaily: r2(pm.plannedAvgDaily),
    plannedTotalProduction: r2(pm.plannedTotalProduction),
    plannedAssocNetPay: r2(pm.plannedAssocNetPay),
    plannedCostOfLabs: r2(pm.plannedCostOfLabs),
    plannedMaterials: r2(pm.plannedMaterials),
    ocpspaContribution: r2(pm.ocpspaContribution),
    plannedPracticePL: r2(pm.plannedPracticePL),
    plannedPLPct: r2(pm.plannedPLPct),
    actualPracticePL: r2(pm.actualPracticePL),
    plOnRoomPerDay: r2(pm.plOnRoomPerDay),
    plPctOnOCPSPD: r2(pm.plPctOnOCPSPD),
  }));
  const sortedByPL = [...rowsForAI].sort(
    (a, b) => b.plannedPracticePL - a.plannedPracticePL,
  );
  const aiContextData = {
    page: "profit-planning-by-associates",
    selectedLocationName,
    period: {
      startDate: profitGoalsDateRange.from?.toISOString().slice(0, 10) ?? null,
      endDate: profitGoalsDateRange.to?.toISOString().slice(0, 10) ?? null,
      planningMonth: planningMonth?.toISOString().slice(0, 7) ?? null,
    },
    metrics: {
      opCosts: r2(profitGoalsMetrics.opCosts),
      targetProfitPercent: profitGoalsMetrics.targetProfitPercent,
      ocpspd: r2(profitGoalsMetrics.ocpspd),
      weeksOpenPerYear: profitGoalsMetrics.weeksOpenPerYear,
      daysOpenPerWeek: profitGoalsMetrics.daysOpenPerWeek,
      openHoursPerDay: profitGoalsMetrics.openHoursPerDay,
      numSurgeries: profitGoalsMetrics.numSurgeries,
      workingDays: profitGoalsMetrics.workingDays,
      surgeryDaysPerYear: profitGoalsMetrics.surgeryDaysPerYear,
      assocWeeksPerYear: profitGoalsMetrics.assocWeeksPerYear,
      assocDaysPerWeek: profitGoalsMetrics.assocDaysPerWeek,
      assocDaysPerYear: profitGoalsMetrics.assocDaysPerYear,
      practiceCostMaterialsPercent:
        profitGoalsMetrics.practiceCostMaterialsPercent,
      associateCostLabsPercent: profitGoalsMetrics.associateCostLabsPercent,
    },
    rows: rowsForAI,
    topByPL: sortedByPL
      .slice(0, 10)
      .map((r) => ({
        name: r.name,
        plannedPracticePL: r.plannedPracticePL,
        plannedPLPct: r.plannedPLPct,
      })),
    bottomByPL: sortedByPL
      .slice(-10)
      .reverse()
      .map((r) => ({
        name: r.name,
        plannedPracticePL: r.plannedPracticePL,
        plannedPLPct: r.plannedPLPct,
      })),
  };

  return (
    <MainLayout userRole="admin" aiContext={aiContextData} locked={lockedForPlan}>
      <Helmet>
        <title>Profit Planning by Associates</title>
        <meta
          name="description"
          content="Plan and forecast associate profit targets."
        />
      </Helmet>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Profit Planning by New Associates
          </h1>
        </div>

        {/* Date pickers */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-8 flex-wrap">
              <div>
                <Label className="block mb-2">
                  Date Selection for Operations
                </Label>
                <ConfigProvider theme={antdTheme}>
                  <DatePicker.RangePicker
                    value={[
                      profitGoalsDateRange.from
                        ? dayjs(profitGoalsDateRange.from)
                        : null,
                      profitGoalsDateRange.to
                        ? dayjs(profitGoalsDateRange.to)
                        : null,
                    ]}
                    onChange={(dates) => {
                      if (dates?.[0] && dates?.[1]) {
                        setProfitGoalsDateRange({
                          from: dates[0].toDate(),
                          to: dates[1].toDate(),
                        });
                      }
                    }}
                    format="DD-MM-YYYY"
                    placeholder={["Start date", "End date"]}
                  />
                </ConfigProvider>
              </div>
              <div>
                <Label className="block mb-2">Planning Month</Label>
                <ConfigProvider theme={antdTheme}>
                  <DatePicker
                    value={planningMonth ? dayjs(planningMonth) : null}
                    onChange={(date) =>
                      setPlanningMonth(date ? date.toDate() : null)
                    }
                    picker="month"
                    format="YYYY-MM"
                    placeholder="Select month"
                  />
                </ConfigProvider>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4 info cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Operational Costs & Profit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Op costs:</span>
                <span className="font-semibold">
                  {fmtCurrency(profitGoalsMetrics.opCosts)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Target % Profit:</span>
                <span className="font-semibold">
                  {profitGoalsMetrics.targetProfitPercent}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">OCPSPD:</span>
                <span className="font-semibold">
                  {fmtCurrency(profitGoalsMetrics.ocpspd)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Operational Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Weeks open/year:</span>
                <span className="font-semibold">
                  {profitGoalsMetrics.weeksOpenPerYear}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Days open/week:</span>
                <span className="font-semibold">
                  {profitGoalsMetrics.daysOpenPerWeek}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground"># Surgeries:</span>
                <span className="font-semibold">
                  {profitGoalsMetrics.numSurgeries}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Working days:</span>
                <span className="font-semibold">
                  {profitGoalsMetrics.workingDays}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Surgery days/year:</span>
                <span className="font-semibold">
                  {profitGoalsMetrics.surgeryDaysPerYear}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Associate Available Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Assoc weeks/year:</span>
                <span className="font-semibold">
                  {profitGoalsMetrics.assocWeeksPerYear}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Days/week:</span>
                <span className="font-semibold">
                  {profitGoalsMetrics.assocDaysPerWeek}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Assoc days/year:</span>
                <span className="font-semibold">
                  {profitGoalsMetrics.assocDaysPerYear}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Practice & Associate Expenses
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-start text-sm">
                <div>
                  <div className="font-semibold">Practice Costs</div>
                  <div className="text-xs text-muted-foreground">
                    (Materials %):
                  </div>
                </div>
                <span className="font-semibold">
                  {profitGoalsMetrics.practiceCostMaterialsPercent}%
                </span>
              </div>
              <div className="flex justify-between items-start text-sm">
                <div>
                  <div className="font-semibold">Practice/Associate Costs</div>
                  <div className="text-xs text-muted-foreground">
                    Lab Cost %:
                  </div>
                </div>
                <span className="font-semibold">
                  {profitGoalsMetrics.associateCostLabsPercent}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Associate table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-sidebar text-white">
                    <th className="text-left p-3 font-medium text-sm w-40">
                      Associate
                    </th>
                    <th className="text-right p-3 font-medium text-sm">
                      Avg Daily
                      <br />
                      Production
                    </th>
                    <th className="text-right p-3 font-medium text-sm">
                      Total
                      <br />
                      Production
                    </th>
                    <th className="text-right p-3 font-medium text-sm">
                      Associate
                      <br />
                      Fees
                    </th>
                    <th className="text-right p-3 font-medium text-sm">
                      Cost
                      <br />
                      of Labs
                    </th>
                    <th className="text-right p-3 font-medium text-sm">
                      Materials
                      <br />
                      Costs
                    </th>
                    <th className="text-right p-3 font-medium text-sm">
                      OCPSPA
                      <br />
                      Contribution
                    </th>
                    <th className="text-right p-3 font-medium text-sm">
                      Practice
                      <br />
                      P/L
                    </th>
                    <th className="text-right p-3 font-medium text-sm">
                      P/L %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {providersMetrics.map((pm) => {
                    const isExpanded = expandedProvider === pm.provider.id;
                    // The input pre-fills with the actual avg daily production
                    // until the user overrides it with their own planned figure.
                    const plannedInputValue =
                      providersPlannedInput[pm.provider.id] ??
                      (pm.actualAvgDaily > 0
                        ? pm.actualAvgDaily.toFixed(2)
                        : "");
                    return (
                      <Fragment key={pm.provider.id}>
                        <tr
                          className="border-b border-border hover:bg-muted/50 cursor-pointer"
                          onClick={() =>
                            setExpandedProvider(
                              isExpanded ? null : pm.provider.id,
                            )
                          }
                        >
                          <td className="p-3 align-middle">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                                {isExpanded ? (
                                  <X className="w-3.5 h-3.5" />
                                ) : (
                                  <Plus className="w-3.5 h-3.5" />
                                )}
                              </div>
                              <span className="text-sm font-medium break-words">
                                {pm.provider.name}
                              </span>
                            </div>
                          </td>
                          <td
                            className="p-3 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-muted-foreground text-sm">
                                £
                              </span>
                              <Input
                                type="number"
                                value={plannedInputValue}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setProvidersPlannedInput((prev) => ({
                                    ...prev,
                                    [pm.provider.id]: raw,
                                  }));
                                  // Recalculate Total Production / Practice P&L /
                                  // P/L % live as the value is typed.
                                  setProvidersPlannedProduction((prev) => ({
                                    ...prev,
                                    [pm.provider.id]: Number(raw) || 0,
                                  }));
                                }}
                                onBlur={(e) => {
                                  const v = Number(e.target.value) || 0;
                                  setProvidersPlannedProduction((prev) => ({
                                    ...prev,
                                    [pm.provider.id]: v,
                                  }));
                                  setProvidersPlannedInput((prev) => ({
                                    ...prev,
                                    [pm.provider.id]: String(v),
                                  }));
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    const v =
                                      Number(
                                        providersPlannedInput[pm.provider.id],
                                      ) || 0;
                                    setProvidersPlannedProduction((prev) => ({
                                      ...prev,
                                      [pm.provider.id]: v,
                                    }));
                                    setProvidersPlannedInput((prev) => ({
                                      ...prev,
                                      [pm.provider.id]: String(v),
                                    }));
                                    e.currentTarget.blur();
                                  }
                                }}
                                className="w-24 h-8 text-right text-sm hover:border-sidebar focus-visible:ring-sidebar"
                              />
                            </div>
                          </td>
                          <td className="p-3 text-right text-sm">
                            {fmtCurrency(pm.plannedTotalProduction)}
                          </td>
                          <td className="p-3 text-right text-sm">
                            {fmtCurrency(pm.plannedAssocNetPay)}
                          </td>
                          <td className="p-3 text-right text-sm">
                            {fmtCurrency(pm.plannedCostOfLabs)}
                          </td>
                          <td className="p-3 text-right text-sm">
                            {fmtCurrency(pm.plannedMaterials)}
                          </td>
                          <td className="p-3 text-right text-sm">
                            {fmtCurrency(pm.ocpspaContribution)}
                          </td>
                          <td
                            className={`p-3 text-right text-sm font-medium ${pm.plannedPracticePL < 0 ? "text-red-600" : "text-green-600"}`}
                          >
                            {fmtCurrency(pm.plannedPracticePL)}
                          </td>
                          <td
                            className={`p-3 text-right text-sm font-medium ${pm.plannedPLPct < 0 ? "text-red-600" : "text-green-600"}`}
                          >
                            {fmtPct(pm.plannedPLPct)}
                          </td>
                        </tr>

                        {/* Expandable detail row */}
                        {isExpanded && (
                          <tr className="border-b border-border bg-muted/30">
                            <td colSpan={9} className="p-4 pl-10">
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3 text-xs text-foreground">
                                <div>
                                  <div className="text-muted-foreground mb-0.5">
                                    Average Lab Cost /month
                                  </div>
                                  <div className="font-medium">
                                    {fmtCurrency(pm.avgLabCostPerMonth)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-0.5">
                                    Associate Split (%)
                                  </div>
                                  <div className="font-medium">
                                    {pm.assocSplitPct}%
                                  </div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-0.5">
                                    Associate Lab Split (%)
                                  </div>
                                  <div className="font-medium">
                                    {pm.labSplitPct}%
                                  </div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-0.5">
                                    Profit/Loss on Room per day
                                  </div>
                                  <div className="font-medium">
                                    {fmtCurrency(pm.plOnRoomPerDay)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-0.5">
                                    Profit/Loss % on OCPSPD
                                  </div>
                                  <div className="font-medium">{fmtPct(pm.plPctOnOCPSPD)}</div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {isLoadingTable && (
                    <tr>
                      <td colSpan={9} className="py-12 text-center">
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span className="text-sm">Loading...</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!isLoadingTable && providersMetrics.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="p-8 text-center text-muted-foreground text-sm"
                      >
                        No providers found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
