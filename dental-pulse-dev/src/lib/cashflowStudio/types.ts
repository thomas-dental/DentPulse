/**
 * Cash Flow Scenario Studio — shared types.
 *
 * Implements the data contract shared by two skills:
 *   1. cash-flow-model-builder  → produces a Week-0 13-week forecast model.
 *   2. cash-flow-scenario-dashboard → consumes the model for scenario analysis.
 *
 * The model is deliberately simple: one entity, one bank account, one currency,
 * 13 weekly buckets. No multi-entity / multi-currency / covenant modelling.
 */

export const WEEKS = 13;

/** Receipt (inflow) categories — fixed order, drives the forecast rows. */
export const RECEIPT_KEYS = [
  'retailCard',
  'onlineMarketplace',
  'arCollections',
  'otherReceipts',
] as const;
export type ReceiptKey = (typeof RECEIPT_KEYS)[number];

/** Disbursement (outflow) categories — fixed order. */
export const DISBURSEMENT_KEYS = [
  'payrollBenefits',
  'inventoryVendorPayments',
  'operatingAP',
  'recurringPayments',
  'rentFacilities',
  'marketingDiscretionary',
  'tax',
  'debtService',
  'purchaseCommitments',
  'otherDisbursements',
] as const;
export type DisbursementKey = (typeof DISBURSEMENT_KEYS)[number];

export const RECEIPT_LABELS: Record<ReceiptKey, string> = {
  retailCard: 'Retail / card settlements',
  onlineMarketplace: 'Online / marketplace payouts',
  arCollections: 'AR collections',
  otherReceipts: 'Other receipts',
};

export const DISBURSEMENT_LABELS: Record<DisbursementKey, string> = {
  payrollBenefits: 'Payroll and benefits',
  inventoryVendorPayments: 'Inventory / vendor payments',
  operatingAP: 'Operating AP',
  recurringPayments: 'Recurring payments',
  rentFacilities: 'Rent and facilities',
  marketingDiscretionary: 'Marketing / discretionary spend',
  tax: 'Tax',
  debtService: 'Debt service',
  purchaseCommitments: 'Purchase commitments',
  otherDisbursements: 'Other disbursements',
};

/** Display labels for each category — overridable so a DentPulse-sourced model
 *  can show dental line names (e.g. "Patient takings") instead of the retail
 *  defaults, while the sample/upload models keep the skill's labels. */
export interface ModelLabels {
  receipts: Record<ReceiptKey, string>;
  disbursements: Record<DisbursementKey, string>;
}

/** A length-13 array of weekly amounts. */
export type WeekArray = number[];

export interface WeekMeta {
  index: number; // 0-based
  label: string; // "Week 1"
  startDate: string; // ISO yyyy-mm-dd
  endDate: string; // ISO yyyy-mm-dd
}

export interface InputInventoryRow {
  fileName: string;
  fileType: string;
  rowCount: number;
  dateRange: string;
  mainColumns: string;
  forecastUse: string;
  usage: 'Used' | 'Partially used' | 'Not used';
  issues: string;
}

export type ExceptionCategory = 'cfo' | 'informational' | 'warning';

export interface ExceptionRow {
  issueType: string;
  sourceFile: string;
  sourceRef?: string;
  amount?: number;
  treatment: string;
  cfoReview: boolean;
  category: ExceptionCategory;
}

export type CheckStatus = 'PASS' | 'WARNING' | 'FAIL';

export interface SelfCheckRow {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface CFOSummary {
  asOfDate: string;
  openingCash: number;
  endingCash: number;
  minCashWeek: number; // 1-based
  minCashAmount: number;
  weeksBelowThreshold: number;
  threshold: number;
  inflowRisks: string[];
  outflowRisks: string[];
  topExceptions: string[];
  readyForReview: boolean;
  summaryText: string;
}

/** The complete Week-0 model — the single source of truth for the dashboard. */
export interface CashFlowModel {
  title: string;
  currencySymbol: string; // "$" default
  asOfDate: string; // ISO
  threshold: number;
  openingCash: number; // Week 1 opening cash
  weeks: WeekMeta[];
  receipts: Record<ReceiptKey, WeekArray>;
  disbursements: Record<DisbursementKey, WeekArray>;
  labels: ModelLabels;
  assumptions: string[];
  excludedItems: string[];
  inventory: InputInventoryRow[];
  exceptions: ExceptionRow[];
  selfChecks: SelfCheckRow[];
  cfoSummary: CFOSummary;
  /** true when the builder could not reconcile something material. */
  isDraft: boolean;
}

/** Scenario lever values applied on top of the base model. */
export interface ScenarioLevers {
  arTimingDays: -7 | 0 | 7 | 14 | 21;
  receiptChangePct: number; // -20..20
  marketingReductionPct: number; // 0..30
  apStretchDays: 0 | 7 | 14;
  poDelayDays: 0 | 7 | 14;
  threshold: number;
}

export type PresetName = 'base' | 'downside' | 'management' | 'upside' | 'custom';

/** Derived weekly cash lines for a given set of category arrays. */
export interface ComputedForecast {
  totalReceipts: WeekArray;
  totalDisbursements: WeekArray;
  netCashFlow: WeekArray;
  openingByWeek: WeekArray;
  endingCash: WeekArray;
  minCashWeek: number; // 1-based
  minCashAmount: number;
  weeksBelowThreshold: number;
  belowThreshold: boolean[];
  /** receipts/disbursements shifted beyond the 13-week horizon by scenario levers. */
  delayedBeyondHorizon: number;
}
