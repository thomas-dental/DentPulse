import { SlidingScaleBand } from '@/hooks/useSlidingScales';

/** The subset of Provider contract fields the payslip calculation needs. */
export interface ProviderSplitConfig {
  split_source_method: string | null;
  associate_split_percentage: number | null;
  lab_split_percentage: number | null;
  associate_split_per_case_rate: number | null;
  associate_split_per_hour_rate: number | null;
  employment_type?: string | null;
}

/** Uplift applied to the per-hour rate when the provider's employment type is "employee". */
export const PER_HOUR_EMPLOYEE_UPLIFT_PERCENT = 15;

/** Applies the employee uplift to a per-hour rate, when applicable. */
export function getEffectivePerHourRate(
  baseRate: number,
  employmentType: string | null | undefined,
): number {
  return employmentType === 'employee'
    ? round2(baseRate * (1 + PER_HOUR_EMPLOYEE_UPLIFT_PERCENT / 100))
    : round2(baseRate);
}

export interface PayBandLineResult {
  band_order: number;
  band_name: string;
  start_value: number;
  end_value: number | null;
  associate_percentage: number;
  gross_band_amount: number;
  associate_amount: number;
}

export interface PayBandResult {
  percentage: number | null;
  amount: number;
  bandLines: PayBandLineResult[];
  /** Rate actually used for a per-hour calculation, after the employee uplift (if any). */
  effectiveRatePerHour?: number;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Bands `base` (a production/gross-fees total) against a provider's sliding-scale
 * config, computing the in-band gross amount and the associate's share of it.
 * Port of live's (fe-dentpulse-live) addpayslip.component.ts getBandAmount()/getAssociateAmount().
 */
export function computeBandAmounts(bands: SlidingScaleBand[], base: number): PayBandLineResult[] {
  const sorted = [...bands].sort((a, b) => a.start - b.start);
  return sorted.map((band, index) => {
    const end = band.end || Infinity;
    const overlap = Math.max(0, Math.min(base, end) - band.start);
    const grossBandAmount = round2(overlap);
    const associateAmount = round2(overlap * (band.percentage / 100));
    return {
      band_order: index,
      band_name: band.band,
      start_value: band.start,
      end_value: band.end || null,
      associate_percentage: band.percentage,
      gross_band_amount: grossBandAmount,
      associate_amount: associateAmount,
    };
  });
}

/**
 * Computes the associate's pay-band share for a payslip period, dispatching on
 * the provider's split_source_method (all 4 methods supported: flat-percentage,
 * sliding-scale, per-case, per-hour).
 */
export function computePayBand(
  provider: ProviderSplitConfig,
  base: number,
  opts: { slidingBands?: SlidingScaleBand[]; monthHours?: number; caseCount?: number } = {},
): PayBandResult {
  const method = provider.split_source_method || 'flat-percentage';

  if (method === 'sliding-scale') {
    const bandLines = computeBandAmounts(opts.slidingBands ?? [], base);
    const amount = round2(bandLines.reduce((sum, b) => sum + b.associate_amount, 0));
    return { percentage: null, amount, bandLines };
  }

  if (method === 'per-case') {
    const rate = provider.associate_split_per_case_rate ?? 0;
    const amount = round2(rate * (opts.caseCount ?? 0));
    return { percentage: null, amount, bandLines: [] };
  }

  if (method === 'per-hour') {
    const rate = getEffectivePerHourRate(provider.associate_split_per_hour_rate ?? 0, provider.employment_type);
    const amount = round2(rate * (opts.monthHours ?? 0));
    return { percentage: null, amount, bandLines: [], effectiveRatePerHour: rate };
  }

  // flat-percentage (default)
  const percentage = provider.associate_split_percentage ?? 0;
  const amount = round2(base * (percentage / 100));
  return { percentage, amount, bandLines: [] };
}

/**
 * Computes the associate's lab-cost share. dental-pulse-dev only supports flat
 * or sliding-scale lab methods (there's no independent "lab cost source" like
 * live's account-based option), reusing whichever the provider's
 * split_source_method already is: sliding-scale => banded, everything else => flat.
 */
export function computeLabBand(
  provider: ProviderSplitConfig,
  base: number,
  opts: { slidingBands?: SlidingScaleBand[] } = {},
): PayBandResult {
  const method = provider.split_source_method || 'flat-percentage';

  if (method === 'sliding-scale') {
    const bandLines = computeBandAmounts(opts.slidingBands ?? [], base);
    const amount = round2(bandLines.reduce((sum, b) => sum + b.associate_amount, 0));
    return { percentage: null, amount, bandLines };
  }

  const percentage = provider.lab_split_percentage ?? 0;
  const amount = round2(base * (percentage / 100));
  return { percentage, amount, bandLines: [] };
}

/** Port of PaySlipService.SavePaySlipAsync's net pay formula (be-dentpulse). */
export function computeNetPay(
  payBandAssociateShareTotal: number,
  associateLabShareTotal: number,
  additionsTotal: number,
  deductionsTotal: number,
): number {
  return round2(payBandAssociateShareTotal - associateLabShareTotal + additionsTotal - deductionsTotal);
}

export { round2 };
