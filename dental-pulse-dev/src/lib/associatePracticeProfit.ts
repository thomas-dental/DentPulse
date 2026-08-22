import {
  resolveProviderCost,
  isProductionScaledBasis,
} from "@/lib/providerCostResolution";
import type { ProviderCostInputsResult } from "@/lib/providerCostInputs";
import type { ProviderCostSourceMethod } from "@/types/provider";
import { getEffectivePerHourRate } from "@/lib/payslipCalculations";

export interface AssociateProfitGoalProvider {
  id: string;
  name: string;
  external_id?: string | number | null;
  location_id?: string | null;
  split_source_method?: string | null;
  associate_split_percentage?: number | null;
  lab_split_percentage?: number | null;
  lab_split_percentage_sliding?: number | null;
  associate_split_per_hour_rate?: number | null;
  associate_split_per_case_rate?: number | null;
  employment_type?: string | null;
  lab_cost_source_method?: ProviderCostSourceMethod | null;
  lab_cost_percentage?: number | null;
  material_cost_source_method?: ProviderCostSourceMethod | null;
  material_cost_percentage?: number | null;
}

export interface AssociateProductionMatch {
  externalIds: number[];
  providerName: string;
  total: number;
}

export interface AssociateHoursMatch {
  externalIds: number[];
  providerName: string;
  total: number;
  totalExact?: number;
}

export interface AssociateProfitGoalRow<
  T extends AssociateProfitGoalProvider = AssociateProfitGoalProvider,
> {
  provider: T;
  avgDailyProduction: number;
  totalProduction: number;
  workingDays: number;
  associateSplitPercent: number;
  associateLabSplitPercent: number;
  associateNetPay: number;
  costOfLabs: number;
  avgLabCostPerMonth: number;
  materialsCosts: number;
  ocpspaContribution: number;
  practicePL: number;
  plPercentOnOCPSPD: number;
  plOnRoomPerDay: number;
  plannedAvgDaily: number;
  plannedTotalProduction: number;
  plannedAssociateNetPay: number;
  plannedCostOfLabs: number;
  plannedMaterials: number;
  plannedPracticePL: number;
}

function matchByExternalIdOrName<T extends AssociateProductionMatch | AssociateHoursMatch>(
  rows: T[],
  provider: AssociateProfitGoalProvider,
): T | undefined {
  const providerExtId = provider.external_id ? Number(provider.external_id) : null;
  return (
    rows.find(
      (p) => providerExtId !== null && p.externalIds.includes(providerExtId),
    ) ??
    rows.find(
      (p) => p.providerName.toLowerCase() === provider.name.toLowerCase(),
    )
  );
}

/**
 * Gross pay before lab deduction. Associates typically use flat %;
 * Hygienist / Therapist / Other often use per-hour (employee rate includes the 15% uplift).
 * Per-case falls back to % here because this pipeline has no case count.
 */
export function computeProviderGrossShare(
  provider: AssociateProfitGoalProvider,
  totalProduction: number,
  totalWorkingHours: number,
): number {
  const method = provider.split_source_method || "flat-percentage";
  if (method === "per-hour") {
    const rate = getEffectivePerHourRate(
      provider.associate_split_per_hour_rate ?? 0,
      provider.employment_type,
    );
    return rate * totalWorkingHours;
  }
  const splitPercent = provider.associate_split_percentage || 30;
  return totalProduction * (splitPercent / 100);
}

export function resolveProviderLabSplitPercent(
  provider: AssociateProfitGoalProvider,
): number {
  if (provider.split_source_method === "sliding-scale") {
    return (
      provider.lab_split_percentage_sliding ||
      provider.lab_split_percentage ||
      50
    );
  }
  return provider.lab_split_percentage || 50;
}

/**
 * Practice P/L for every provider type (Associate, Hygienist, Therapist, Other).
 *   Net Pay           = Gross Share − (Labs × Lab Split %)
 *   Gross Share       = Production × Split %  (or Hours × £/hr for per-hour contracts)
 *   OCPSPA            = OCPSPD × Working Days
 *   Practice P/L      = Production − (Net Pay + Labs + Materials + OCPSPA)
 *   P/L on Room / Day = Practice P/L ÷ Working Days
 */
export function buildAssociateProfitGoalRows<
  T extends AssociateProfitGoalProvider,
>(args: {
  providers: T[];
  productionProviders: AssociateProductionMatch[];
  hoursProviders: AssociateHoursMatch[];
  hoursPerDay: number;
  ocpspd: number;
  dateFrom: Date | null;
  dateTo: Date | null;
  plannedByProvider?: Record<string, number>;
  costInputs: ProviderCostInputsResult | null;
  fallbackLabPercent: number;
  fallbackMaterialsPercent: number;
}): AssociateProfitGoalRow<T>[] {
  const {
    providers,
    productionProviders,
    hoursProviders,
    hoursPerDay,
    ocpspd,
    dateFrom,
    dateTo,
    plannedByProvider = {},
    costInputs,
    fallbackLabPercent,
    fallbackMaterialsPercent,
  } = args;

  const safeHoursPerDay = hoursPerDay || 8;

  return providers.map((provider) => {
    const productionData = matchByExternalIdOrName(
      productionProviders,
      provider,
    );
    const hoursData = matchByExternalIdOrName(hoursProviders, provider);

    const totalProduction = productionData?.total || 0;
    const totalWorkingHours = hoursData?.totalExact ?? hoursData?.total ?? 0;
    const workingDays =
      safeHoursPerDay > 0 ? totalWorkingHours / safeHoursPerDay : 0;
    const avgDailyProduction =
      workingDays > 0 ? totalProduction / workingDays : 0;

    const associateSplitPercent = provider.associate_split_percentage || 30;
    const associateLabSplitPercent = resolveProviderLabSplitPercent(provider);

    const providerLocationId = provider.location_id ?? null;
    const gate = providerLocationId
      ? costInputs?.locationGateByLocationId.get(providerLocationId)
      : undefined;
    const labGateActive = gate?.associate_cost_lab_source === "associate_wise";
    const materialGateActive = gate?.material_cost_source === "associate_wise";

    const labResolved = resolveProviderCost({
      sourceMethod: labGateActive
        ? (provider.lab_cost_source_method ?? null)
        : null,
      flatPercentage: provider.lab_cost_percentage ?? null,
      production: totalProduction,
      accountAmount:
        costInputs?.accountAmountByProviderId.get(provider.id)?.lab ?? null,
      monthlyValues:
        costInputs?.monthlyValuesByProviderId.get(provider.id)?.lab ?? [],
      monthlyBillByMonth: providerLocationId
        ? (costInputs?.monthlyBillByLocationId.get(providerLocationId)?.lab ??
          [])
        : [],
      bands: costInputs?.bandsByProviderId.get(provider.id)?.lab ?? [],
      fallbackLocationPercent:
        gate?.associate_cost_labs_percent ?? fallbackLabPercent,
    });
    const materialResolved = resolveProviderCost({
      sourceMethod: materialGateActive
        ? (provider.material_cost_source_method ?? null)
        : null,
      flatPercentage: provider.material_cost_percentage ?? null,
      production: totalProduction,
      accountAmount:
        costInputs?.accountAmountByProviderId.get(provider.id)?.material ??
        null,
      monthlyValues:
        costInputs?.monthlyValuesByProviderId.get(provider.id)?.material ?? [],
      monthlyBillByMonth: providerLocationId
        ? (costInputs?.monthlyBillByLocationId.get(providerLocationId)
            ?.material ?? [])
        : [],
      bands: costInputs?.bandsByProviderId.get(provider.id)?.material ?? [],
      fallbackLocationPercent:
        gate?.practice_cost_materials_percent ?? fallbackMaterialsPercent,
    });

    const costOfLabs = labResolved.amount;
    const materialsCosts = materialResolved.amount;
    const associateGrossShare = computeProviderGrossShare(
      provider,
      totalProduction,
      totalWorkingHours,
    );
    const labCostDeduction = costOfLabs * (associateLabSplitPercent / 100);
    const associateNetPay = associateGrossShare - labCostDeduction;

    const numberOfMonths =
      dateFrom && dateTo
        ? (dateTo.getFullYear() - dateFrom.getFullYear()) * 12 +
          (dateTo.getMonth() - dateFrom.getMonth()) +
          1
        : 12;
    const avgLabCostPerMonth =
      numberOfMonths > 0 ? costOfLabs / numberOfMonths : 0;

    const ocpspaContribution = ocpspd * workingDays;
    const practicePL =
      totalProduction -
      (associateNetPay + costOfLabs + materialsCosts + ocpspaContribution);
    const plPercentOnOCPSPD =
      ocpspaContribution > 0 ? (practicePL / ocpspaContribution) * 100 : 0;
    const plOnRoomPerDay = workingDays > 0 ? practicePL / workingDays : 0;

    const plannedAvgDaily = plannedByProvider[provider.id] || 0;
    const plannedTotalProduction = plannedAvgDaily * workingDays;
    const plannedCostOfLabs = isProductionScaledBasis(labResolved.basis)
      ? plannedTotalProduction *
        (totalProduction > 0 ? costOfLabs / totalProduction : 0)
      : costOfLabs;
    const plannedMaterials = isProductionScaledBasis(materialResolved.basis)
      ? plannedTotalProduction *
        (totalProduction > 0 ? materialsCosts / totalProduction : 0)
      : materialsCosts;
    const plannedAssociateGrossShare =
      provider.split_source_method === "per-hour"
        ? associateGrossShare
        : plannedTotalProduction * (associateSplitPercent / 100);
    const plannedLabCostDeduction =
      plannedCostOfLabs * (associateLabSplitPercent / 100);
    const plannedAssociateNetPay =
      plannedAssociateGrossShare - plannedLabCostDeduction;
    const plannedPracticePL =
      plannedTotalProduction -
      (associateNetPay + costOfLabs + plannedMaterials + ocpspaContribution);

    return {
      provider,
      avgDailyProduction,
      totalProduction,
      workingDays,
      associateSplitPercent,
      associateLabSplitPercent,
      associateNetPay,
      costOfLabs,
      avgLabCostPerMonth,
      materialsCosts,
      ocpspaContribution,
      practicePL,
      plPercentOnOCPSPD,
      plOnRoomPerDay,
      plannedAvgDaily,
      plannedTotalProduction,
      plannedAssociateNetPay,
      plannedCostOfLabs,
      plannedMaterials,
      plannedPracticePL,
    };
  });
}

export function rankAssociatePeriodicProfit(
  rows: AssociateProfitGoalRow[],
): Array<{
  provider_id: string;
  provider_name: string;
  periodic_profit: number;
  pl_per_day: number;
  profit_percent: number;
  rank: number;
}> {
  return rows
    .filter((row) => row.totalProduction > 0 || row.workingDays > 0)
    .map((row) => ({
      provider_id: row.provider.id,
      provider_name: row.provider.name,
      periodic_profit: row.practicePL,
      pl_per_day: row.plOnRoomPerDay,
      profit_percent:
        row.totalProduction > 0
          ? (row.practicePL / row.totalProduction) * 100
          : 0,
    }))
    .sort((a, b) => b.pl_per_day - a.pl_per_day)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
