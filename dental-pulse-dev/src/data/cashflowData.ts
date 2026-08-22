/**
 * Cash Flow feature mock data – aligned with Version 2.0 API shapes
 * (CashflowController, TransactionsController, DashboardRepository).
 * Ready to swap for Supabase/API when backend is available.
 */

/** Monthly Income/Payment series for Total Cash Received and Paid chart */
export interface TotalCashFlowData {
  data: {
    xAxis: string[];
    dataSet: { name: string; data: number[] }[];
  };
}

/** Category/range item with amount (Cash Collected / Cash Paid by category) */
export interface CashCollectionPaymentItem {
  rangeGroup: string;
  amount: number;
}

/** Closing balance trend (month name, value) */
export interface LineChartDataItem {
  name: string;
  value: number;
}

/** Top cash generating category */
export interface TopCashGeneratingItem {
  category: string;
  amount: number;
}

/** Outlier metric (name, amount, % of receipts) */
export interface OutlierMetricItem {
  name: string;
  amount: number;
  per: number;
}

/** Cashflow-wise margins: cash receipt, outliers, money left */
export interface OutliersCashflowWiseVM {
  cashReceipt: OutlierMetricItem;
  outliersTopMetrics: OutlierMetricItem[];
  moneyLeft: OutlierMetricItem;
}

/** Stability: when/if run out of money (month, amount, overdraft limit) */
export interface StabilityReportVM {
  mon: string | null;
  amount: number;
  overdraftLimit: number;
}

/** One-off or tax record */
export interface SustainabilityRecord {
  location: string;
  mon: string;
  amount: number;
}

/** Sustainability: one-off expenses and tax records */
export interface SustainabilityReportVM {
  oneOffExpenseRecords: SustainabilityRecord[];
  taxRecords: SustainabilityRecord[];
}

/** Scaling / Free cash flow line item */
export interface ScalingItem {
  name: string;
  amount: number;
}

// —— Mock data: Total Monthly Cash Received and Paid (GR_TotalCashFlow)
export const totalCashFlowData: TotalCashFlowData = {
  data: {
    xAxis: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    dataSet: [
      { name: 'Income', data: [365000, 380000, 398000, 385000, 412000, 425000, 418000, 405000, 438000, 452000, 445000, 458000] },
      { name: 'Payment', data: [318000, 332000, 348000, 355000, 342000, 358000, 368000, 352000, 365000, 378000, 372000, 385000] },
    ],
  },
};

// —— Cash Collected by category (GR_TotalCashCollection)
export const cashCollectionByCategory: CashCollectionPaymentItem[] = [
  { rangeGroup: 'NHS', amount: 185000 },
  { rangeGroup: 'Private', amount: 212000 },
  { rangeGroup: 'Membership', amount: 48000 },
  { rangeGroup: 'Other', amount: 13000 },
];

// —— Cash Paid by category (GR_TotalCashPayment) – amounts as positive for display, backend may use negative
export const cashPaidByCategory: CashCollectionPaymentItem[] = [
  { rangeGroup: 'Staff & Payroll', amount: 165000 },
  { rangeGroup: 'Supplies & Lab', amount: 72000 },
  { rangeGroup: 'Premises & Utilities', amount: 45000 },
  { rangeGroup: 'Equipment & CapEx', amount: 38000 },
  { rangeGroup: 'Tax & Compliance', amount: 28000 },
  { rangeGroup: 'Other', amount: 17000 },
];

// —— Closing Cash Balance Trend (GR_CurrentClosingBankBalance)
export const closingBalanceTrend: LineChartDataItem[] = [
  { name: 'Jan', value: 285000 },
  { name: 'Feb', value: 318000 },
  { name: 'Mar', value: 368000 },
  { name: 'Apr', value: 398000 },
  { name: 'May', value: 468000 },
  { name: 'Jun', value: 535000 },
  { name: 'Jul', value: 585000 },
  { name: 'Aug', value: 638000 },
  { name: 'Sep', value: 711000 },
  { name: 'Oct', value: 785000 },
  { name: 'Nov', value: 858000 },
  { name: 'Dec', value: 931000 },
];

// —— Top 3 Cash Generating Products/Services (GR_TopCashGeneratingCategory)
export const topThreeCashGenerating: TopCashGeneratingItem[] = [
  { category: 'Private – Implants & Cosmetic', amount: 198000 },
  { category: 'NHS – Band 2 & 3', amount: 125000 },
  { category: 'Membership Plans', amount: 62000 },
];

// —— Outliers Top 5 Metrics (GR_OutliersTopMetrics)
export const outliersTopMetrics: OutlierMetricItem[] = [
  { name: 'Staff & Payroll', amount: -165000, per: 42 },
  { name: 'Supplies & Lab', amount: -72000, per: 18 },
  { name: 'Premises', amount: -45000, per: 11.5 },
  { name: 'Equipment', amount: -38000, per: 9.7 },
  { name: 'Tax & Compliance', amount: -28000, per: 7.2 },
];

// —— Outliers Cashflow Wise / Your Cash Flow Margins (GR_OutliersTopMetricsCashflowWise)
export const outliersCashflowWise: OutliersCashflowWiseVM = {
  cashReceipt: { name: 'Cash Receipts', amount: 458000, per: 100 },
  outliersTopMetrics: [
    { name: 'Staff & Payroll', amount: -165000, per: 36 },
    { name: 'Supplies & Lab', amount: -72000, per: 15.7 },
    { name: 'Premises', amount: -45000, per: 9.8 },
    { name: 'Equipment', amount: -38000, per: 8.3 },
  ],
  moneyLeft: { name: 'Money Left', amount: 139000, per: 30.3 },
};

// —— Stability – When/If run out of money (GR_Stability)
export const stabilityReport: StabilityReportVM | null = null; // null = positive cash flow

// If run out of money scenario (optional for demo):
// export const stabilityReport: StabilityReportVM = {
//   mon: 'Mar 2025',
//   amount: -25000,
//   overdraftLimit: 50000,
// };

// —— Sustainability – One-off and tax (GR_Sustainability)
export const sustainabilityReport: SustainabilityReportVM = {
  oneOffExpenseRecords: [
    { location: 'HQ', mon: 'Mar 2025', amount: -45000 },
    { location: 'Branch A', mon: 'Jun 2025', amount: -28000 },
  ],
  taxRecords: [
    { location: 'HQ', mon: 'Jan 2025', amount: -62000 },
    { location: 'HQ', mon: 'Jul 2025', amount: -58000 },
  ],
};

// —— Scaling / Free Cash Flow (GR_Scaling)
export const scalingReport: ScalingItem[] = [
  { name: 'Operating Cash Flow', amount: 202000 },
  { name: 'Less: CapEx', amount: -48000 },
  { name: 'Less: Debt Repayment', amount: -35000 },
  { name: 'Less: Lease', amount: -18000 },
];
export const freeCashFlowTotal = (): number =>
  scalingReport.reduce((sum, row) => sum + row.amount, 0);
