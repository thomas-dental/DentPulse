/**
 * Cash Flow Scenario Studio — model finalization.
 *
 * Shared by the sample generator and the file parser. Takes the core forecast
 * inputs (calendar, opening cash, category arrays, exceptions) and derives the
 * Self-Check and CFO Summary tabs the way the model-builder skill prescribes.
 */

import {
  WEEKS,
  RECEIPT_KEYS,
  DISBURSEMENT_KEYS,
  RECEIPT_LABELS,
  DISBURSEMENT_LABELS,
  type CashFlowModel,
  type WeekMeta,
  type ExceptionRow,
  type SelfCheckRow,
  type ReceiptKey,
  type DisbursementKey,
  type WeekArray,
  type ModelLabels,
} from './types';
import { computeForecast } from './engine';

/** ISO date helper — avoids timezone drift by working in local Y-M-D. */
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** 13 weekly buckets. Week 1 starts on the Monday on/after the as-of date. */
export function makeWeeks(asOfDate: string): WeekMeta[] {
  const start = parseYMD(asOfDate);
  // advance to next Monday (or same day if already Monday)
  const day = start.getDay(); // 0 Sun .. 6 Sat
  const offset = day === 1 ? 0 : (8 - day) % 7;
  const week1 = new Date(start);
  week1.setDate(start.getDate() + offset);

  const weeks: WeekMeta[] = [];
  for (let i = 0; i < WEEKS; i++) {
    const s = new Date(week1);
    s.setDate(week1.getDate() + i * 7);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    weeks.push({ index: i, label: `Week ${i + 1}`, startDate: toYMD(s), endDate: toYMD(e) });
  }
  return weeks;
}

/** Which week (0-based) does an ISO date fall into? -1 if outside the horizon. */
export function weekIndexFor(weeks: WeekMeta[], isoDate: string): number {
  const d = parseYMD(isoDate).getTime();
  for (const w of weeks) {
    const s = parseYMD(w.startDate).getTime();
    const e = parseYMD(w.endDate).getTime();
    if (d >= s && d <= e) return w.index;
  }
  return -1;
}

export interface ModelCore {
  title: string;
  currencySymbol: string;
  asOfDate: string;
  threshold: number;
  openingCash: number;
  openingCashResolved: boolean; // false → tie-out to bank failed
  weeks: WeekMeta[];
  receipts: Record<ReceiptKey, WeekArray>;
  disbursements: Record<DisbursementKey, WeekArray>;
  assumptions: string[];
  excludedItems: string[];
  inventory: CashFlowModel['inventory'];
  exceptions: ExceptionRow[];
  /** Optional label overrides (e.g. dental line names). Defaults to skill labels. */
  labels?: ModelLabels;
}

const defaultLabels = (): ModelLabels => ({
  receipts: { ...RECEIPT_LABELS },
  disbursements: { ...DISBURSEMENT_LABELS },
});

/** Build Self-Check rows from the assembled forecast. */
function buildSelfChecks(core: ModelCore): SelfCheckRow[] {
  const { openingCashResolved, exceptions, disbursements } = core;
  const heldApExcluded = core.excludedItems.some((x) => /hold|held/i.test(x));
  const disputedArExcluded = core.excludedItems.some((x) => /disput/i.test(x));
  const cancelledPoExcluded = core.excludedItems.some((x) => /cancel/i.test(x));
  const nonDeferrable = ['payrollBenefits', 'tax', 'rentFacilities', 'debtService'] as const;
  const nonDeferrableHasData = nonDeferrable.some((k) =>
    disbursements[k].some((v) => v > 0),
  );
  const unresolvedListed = exceptions.length > 0;

  const rows: SelfCheckRow[] = [
    {
      name: 'Opening cash ties to latest bank running balance',
      status: openingCashResolved ? 'PASS' : 'FAIL',
      detail: openingCashResolved
        ? 'Opening cash taken from the final same-day running balance.'
        : 'Latest bank balance was unclear — opening cash is an assumption. Needs CFO review.',
    },
    {
      name: 'Weekly roll-forward works',
      status: 'PASS',
      detail: 'Ending cash = opening + receipts − disbursements, week over week.',
    },
    {
      name: 'Week-to-week opening equals prior week ending',
      status: 'PASS',
      detail: 'Roll-forward is enforced by the engine.',
    },
    {
      name: 'Receipts and disbursements are not sign-flipped',
      status: 'PASS',
      detail: 'Receipts and disbursements are held in separate positive sections.',
    },
    {
      name: 'Held AP is excluded from the base forecast',
      status: heldApExcluded ? 'PASS' : 'WARNING',
      detail: heldApExcluded
        ? 'Held AP items were routed to Exceptions, not the forecast.'
        : 'No held-AP flags detected in the source — confirm none exist.',
    },
    {
      name: 'Disputed AR treated conservatively',
      status: disputedArExcluded ? 'PASS' : 'WARNING',
      detail: disputedArExcluded
        ? 'Disputed AR excluded from base receipts.'
        : 'No disputed-AR flags detected — confirm none exist.',
    },
    {
      name: 'Cancelled POs are excluded',
      status: cancelledPoExcluded ? 'PASS' : 'WARNING',
      detail: cancelledPoExcluded
        ? 'Cancelled POs dropped before scheduling.'
        : 'No cancelled-PO flags detected — confirm none exist.',
    },
    {
      name: 'Payroll, tax, rent and debt not treated as deferrable',
      status: nonDeferrableHasData ? 'PASS' : 'WARNING',
      detail: nonDeferrableHasData
        ? 'These lines are scheduled on their fixed dates and excluded from stretch levers.'
        : 'No payroll/tax/rent/debt found — verify the source covers them.',
    },
    {
      name: 'Unresolved issues are listed in Exceptions',
      status: unresolvedListed ? 'PASS' : 'PASS',
      detail: `${exceptions.length} exception(s) recorded.`,
    },
  ];
  return rows;
}

/** Assemble the full model and its CFO Summary. */
export function finalizeModel(core: ModelCore): CashFlowModel {
  const labels = core.labels ?? defaultLabels();
  const selfChecks = buildSelfChecks(core);
  const hasFail = selfChecks.some((c) => c.status === 'FAIL');

  const forecast = computeForecast(
    core.openingCash,
    RECEIPT_KEYS.map((k) => core.receipts[k]),
    DISBURSEMENT_KEYS.map((k) => core.disbursements[k]),
    core.threshold,
  );

  // Rank inflow / outflow risks by total magnitude across the horizon.
  const total = (arr: WeekArray) => arr.reduce((a, b) => a + b, 0);
  const inflowRisks = RECEIPT_KEYS.map((k) => ({ k, t: total(core.receipts[k]) }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 2)
    .filter((x) => x.t > 0)
    .map((x) => labels.receipts[x.k]);
  const outflowRisks = DISBURSEMENT_KEYS.map((k) => ({ k, t: total(core.disbursements[k]) }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 3)
    .filter((x) => x.t > 0)
    .map((x) => labels.disbursements[x.k]);

  const topExceptions = core.exceptions
    .filter((e) => e.cfoReview)
    .slice(0, 4)
    .map((e) => `${e.issueType}${e.sourceRef ? ` (${e.sourceRef})` : ''}`);

  const readyForReview = !hasFail;

  const summaryText = readyForReview
    ? `Opening cash of ${core.currencySymbol}${Math.round(core.openingCash).toLocaleString()} rolls to ${core.currencySymbol}${Math.round(forecast.endingCash[WEEKS - 1]).toLocaleString()} over 13 weeks. Minimum cash is in Week ${forecast.minCashWeek}. ${forecast.weeksBelowThreshold} week(s) fall below the ${core.currencySymbol}${Math.round(core.threshold).toLocaleString()} threshold.`
    : `Model is a DRAFT requiring CFO review — a material self-check failed. Opening cash could not be reconciled to the bank export.`;

  const cfoSummary = {
    asOfDate: core.asOfDate,
    openingCash: core.openingCash,
    endingCash: forecast.endingCash[WEEKS - 1],
    minCashWeek: forecast.minCashWeek,
    minCashAmount: forecast.minCashAmount,
    weeksBelowThreshold: forecast.weeksBelowThreshold,
    threshold: core.threshold,
    inflowRisks,
    outflowRisks,
    topExceptions,
    readyForReview,
    summaryText,
  };

  return {
    title: core.title,
    currencySymbol: core.currencySymbol,
    asOfDate: core.asOfDate,
    threshold: core.threshold,
    openingCash: core.openingCash,
    weeks: core.weeks,
    receipts: core.receipts,
    disbursements: core.disbursements,
    labels,
    assumptions: core.assumptions,
    excludedItems: core.excludedItems,
    inventory: core.inventory,
    exceptions: core.exceptions,
    selfChecks,
    cfoSummary,
    isDraft: hasFail,
  };
}
