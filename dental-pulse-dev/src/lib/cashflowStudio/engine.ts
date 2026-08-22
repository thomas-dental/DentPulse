/**
 * Cash Flow Scenario Studio — calculation engine.
 *
 * Two responsibilities:
 *   1. Roll a set of receipt/disbursement arrays forward into ending-cash lines.
 *   2. Apply scenario levers (AR timing, receipt %, marketing cut, AP/PO stretch)
 *      to the *base* model and recompute — never mutating the base.
 *
 * Rule from the dashboard skill: scenario values must be recomputed from the
 * weekly cash lines, NOT read off a hard-coded ending-cash array.
 */

import {
  WEEKS,
  RECEIPT_KEYS,
  DISBURSEMENT_KEYS,
  type CashFlowModel,
  type ComputedForecast,
  type ScenarioLevers,
  type PresetName,
  type WeekArray,
  type ReceiptKey,
  type DisbursementKey,
} from './types';

const zeros = (): WeekArray => Array(WEEKS).fill(0);

const sumArrays = (arrays: WeekArray[]): WeekArray => {
  const out = zeros();
  for (const a of arrays) for (let i = 0; i < WEEKS; i++) out[i] += a[i] ?? 0;
  return out;
};

/**
 * Shift a weekly array by N weeks.
 *   weeks < 0 → earlier (clamped to Week 1, nothing leaves the horizon).
 *   weeks > 0 → later (anything pushed past Week 13 leaves the horizon).
 */
export function shiftWeeks(arr: WeekArray, weeks: number): { shifted: WeekArray; beyond: number } {
  if (weeks === 0) return { shifted: [...arr], beyond: 0 };
  const shifted = zeros();
  let beyond = 0;
  for (let i = 0; i < WEEKS; i++) {
    const amt = arr[i] ?? 0;
    if (amt === 0) continue;
    let target = i + weeks;
    if (target < 0) target = 0; // pulled earlier than the horizon → land in Week 1
    if (target > WEEKS - 1) {
      beyond += amt; // pushed past Week 13 → outside the forecast
      continue;
    }
    shifted[target] += amt;
  }
  return { shifted, beyond };
}

/** Convert a lever "days" value into whole-week shifts. */
const daysToWeeks = (days: number) => Math.round(days / 7);

/**
 * Roll receipt/disbursement arrays forward from an opening balance.
 * `delayedBeyondHorizon` is threaded through from scenario shifting.
 */
export function computeForecast(
  openingCash: number,
  receipts: WeekArray[],
  disbursements: WeekArray[],
  threshold: number,
  delayedBeyondHorizon = 0,
): ComputedForecast {
  const totalReceipts = sumArrays(receipts);
  const totalDisbursements = sumArrays(disbursements);
  const netCashFlow = zeros();
  const openingByWeek = zeros();
  const endingCash = zeros();

  let prevEnding = openingCash;
  for (let i = 0; i < WEEKS; i++) {
    openingByWeek[i] = i === 0 ? openingCash : prevEnding;
    netCashFlow[i] = totalReceipts[i] - totalDisbursements[i];
    endingCash[i] = openingByWeek[i] + netCashFlow[i];
    prevEnding = endingCash[i];
  }

  let minCashAmount = Infinity;
  let minCashWeek = 1;
  const belowThreshold: boolean[] = [];
  let weeksBelowThreshold = 0;
  for (let i = 0; i < WEEKS; i++) {
    if (endingCash[i] < minCashAmount) {
      minCashAmount = endingCash[i];
      minCashWeek = i + 1;
    }
    const below = endingCash[i] < threshold;
    belowThreshold.push(below);
    if (below) weeksBelowThreshold++;
  }

  return {
    totalReceipts,
    totalDisbursements,
    netCashFlow,
    openingByWeek,
    endingCash,
    minCashWeek,
    minCashAmount,
    weeksBelowThreshold,
    belowThreshold,
    delayedBeyondHorizon,
  };
}

/** Base forecast — the arrays exactly as the model builder produced them. */
export function computeBase(model: CashFlowModel): ComputedForecast {
  return computeForecast(
    model.openingCash,
    RECEIPT_KEYS.map((k) => model.receipts[k]),
    DISBURSEMENT_KEYS.map((k) => model.disbursements[k]),
    model.threshold,
  );
}

/**
 * Apply scenario levers to the base model and recompute.
 * Levers, per the dashboard skill:
 *   - AR timing shifts only `arCollections`.
 *   - Receipt % change applies to `retailCard` + `onlineMarketplace` only.
 *   - Marketing reduction reduces `marketingDiscretionary`.
 *   - AP stretch shifts `operatingAP` (never payroll/tax/rent/debt).
 *   - PO delay shifts `purchaseCommitments`.
 */
export function computeScenario(model: CashFlowModel, levers: ScenarioLevers): ComputedForecast {
  let beyond = 0;

  const receipts: Record<ReceiptKey, WeekArray> = {
    retailCard: model.receipts.retailCard.map((v) => v * (1 + levers.receiptChangePct / 100)),
    onlineMarketplace: model.receipts.onlineMarketplace.map(
      (v) => v * (1 + levers.receiptChangePct / 100),
    ),
    arCollections: model.receipts.arCollections,
    otherReceipts: model.receipts.otherReceipts,
  };

  // AR timing
  const arShift = shiftWeeks(receipts.arCollections, daysToWeeks(levers.arTimingDays));
  receipts.arCollections = arShift.shifted;
  beyond += arShift.beyond;

  const disbursements: Record<DisbursementKey, WeekArray> = {
    payrollBenefits: model.disbursements.payrollBenefits,
    inventoryVendorPayments: model.disbursements.inventoryVendorPayments,
    operatingAP: model.disbursements.operatingAP,
    recurringPayments: model.disbursements.recurringPayments,
    rentFacilities: model.disbursements.rentFacilities,
    marketingDiscretionary: model.disbursements.marketingDiscretionary.map(
      (v) => v * (1 - levers.marketingReductionPct / 100),
    ),
    tax: model.disbursements.tax,
    debtService: model.disbursements.debtService,
    purchaseCommitments: model.disbursements.purchaseCommitments,
    otherDisbursements: model.disbursements.otherDisbursements,
  };

  // Operating AP stretch (delaying a payment keeps cash IN the horizon longer;
  // amounts pushed past Week 13 are simply not paid within the window).
  const apShift = shiftWeeks(disbursements.operatingAP, daysToWeeks(levers.apStretchDays));
  disbursements.operatingAP = apShift.shifted;

  // Purchase commitment delay
  const poShift = shiftWeeks(disbursements.purchaseCommitments, daysToWeeks(levers.poDelayDays));
  disbursements.purchaseCommitments = poShift.shifted;

  return computeForecast(
    model.openingCash,
    RECEIPT_KEYS.map((k) => receipts[k]),
    DISBURSEMENT_KEYS.map((k) => disbursements[k]),
    levers.threshold,
    beyond,
  );
}

/** Preset lever definitions from the dashboard skill. */
export function presetLevers(preset: PresetName, threshold: number): ScenarioLevers {
  const base: ScenarioLevers = {
    arTimingDays: 0,
    receiptChangePct: 0,
    marketingReductionPct: 0,
    apStretchDays: 0,
    poDelayDays: 0,
    threshold,
  };
  switch (preset) {
    case 'downside':
      return { ...base, arTimingDays: 14, receiptChangePct: -15 };
    case 'management':
      return {
        ...base,
        arTimingDays: 7,
        receiptChangePct: -10,
        marketingReductionPct: 20,
        apStretchDays: 7,
        poDelayDays: 14,
      };
    case 'upside':
      return { ...base, arTimingDays: -7, receiptChangePct: 10 };
    case 'base':
    case 'custom':
    default:
      return base;
  }
}

/** Which lever moves minimum cash the most (single-lever sensitivity sweep). */
export function sensitivity(model: CashFlowModel, threshold: number) {
  const baseMin = computeBase(model).minCashAmount;
  const probes: { lever: string; levers: Partial<ScenarioLevers>; label: string }[] = [
    { lever: 'ar', levers: { arTimingDays: 14 }, label: 'AR collections +14 days' },
    { lever: 'receipts', levers: { receiptChangePct: -15 }, label: 'Receipts −15%' },
    { lever: 'marketing', levers: { marketingReductionPct: 20 }, label: 'Marketing −20%' },
    { lever: 'ap', levers: { apStretchDays: 14 }, label: 'AP stretch +14 days' },
    { lever: 'po', levers: { poDelayDays: 14 }, label: 'PO delay +14 days' },
  ];
  return probes
    .map((p) => {
      const levers = { ...presetLevers('base', threshold), ...p.levers } as ScenarioLevers;
      const min = computeScenario(model, levers).minCashAmount;
      return { ...p, delta: min - baseMin, absDelta: Math.abs(min - baseMin) };
    })
    .sort((a, b) => b.absDelta - a.absDelta);
}
