import type { ProviderCostSourceMethod } from '@/types/provider';

export type ProviderCostBasis = 'location_percent' | 'flat_percentage' | 'account' | 'monthly' | 'banded_bill';

export interface CostSlidingScaleBand {
  start: number;
  end: number;
  percentage: number;
}

export interface ResolveProviderCostInput {
  sourceMethod: ProviderCostSourceMethod | null;
  flatPercentage: number | null;
  production: number;
  accountAmount: number | null;
  monthlyValues: number[];
  monthlyBillByMonth: number[];
  bands: CostSlidingScaleBand[];
  fallbackLocationPercent: number;
}

export interface ResolvedProviderCost {
  amount: number;
  basis: ProviderCostBasis;
}

// Progressive/marginal banding against a monthly bill, matching the sibling
// app's stored procedure: AmountInBand = 0 below the band, (bill - start)
// inside it, or the full band width above it. The highest band is treated as
// open-ended (mirrors the SP's ISNULL(End, 999999999)) even though
// provider_sliding_scales.end_amount is NOT NULL in this schema.
function bandedCostForBill(bill: number, bands: CostSlidingScaleBand[]): number {
  if (bands.length === 0 || bill <= 0) return 0;
  const sorted = [...bands].sort((a, b) => a.start - b.start);
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const band = sorted[i];
    const end = i === sorted.length - 1 ? Infinity : band.end;
    let amountInBand: number;
    if (bill <= band.start) {
      amountInBand = 0;
    } else if (bill <= end) {
      amountInBand = bill - band.start;
    } else {
      amountInBand = end - band.start;
    }
    total += amountInBand * (band.percentage / 100);
  }
  return total;
}

function sumBandedCost(monthlyBillByMonth: number[], bands: CostSlidingScaleBand[]): number {
  return monthlyBillByMonth.reduce((sum, bill) => sum + bandedCostForBill(bill, bands), 0);
}

// sourceMethod is null when the provider hasn't been configured for
// per-provider sourcing (even if their location is Associate Wise) — falls
// through to today's location-flat-percentage behaviour, unchanged.
export function resolveProviderCost(input: ResolveProviderCostInput): ResolvedProviderCost {
  const {
    sourceMethod,
    flatPercentage,
    production,
    accountAmount,
    monthlyValues,
    monthlyBillByMonth,
    bands,
    fallbackLocationPercent,
  } = input;

  if (!sourceMethod) {
    return { amount: production * (fallbackLocationPercent / 100), basis: 'location_percent' };
  }

  switch (sourceMethod) {
    case 'flat_percentage':
      return { amount: production * ((flatPercentage ?? 0) / 100), basis: 'flat_percentage' };
    case 'accounting_application':
      return { amount: accountAmount ?? 0, basis: 'account' };
    case 'monthly':
      return { amount: monthlyValues.reduce((sum, v) => sum + (v || 0), 0), basis: 'monthly' };
    case 'sliding_scale':
      return { amount: sumBandedCost(monthlyBillByMonth, bands), basis: 'banded_bill' };
    default:
      return { amount: production * (fallbackLocationPercent / 100), basis: 'location_percent' };
  }
}

// Absolute-£ methods (account/monthly/sliding_scale) have no defined
// "planned" variant that scales with planned production — the actual
// resolved figure is the honest number to show as the plan too. Only
// flat_percentage (and the no-override location-flat case) scales.
export function isProductionScaledBasis(basis: ProviderCostBasis): boolean {
  return basis === 'location_percent' || basis === 'flat_percentage';
}
