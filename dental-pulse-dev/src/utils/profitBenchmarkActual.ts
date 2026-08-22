/**
 * Shared Profit Benchmark Actual Profit / Production Income helpers.
 *
 * Mirrors the Profit Benchmark page formula:
 *   Production Income = Private + Membership + NHS
 *     (Accounting App ledger totals when mapped; else Provider Net Production)
 *   Actual Profit     = Production Income − Σ |expense category actuals|
 */

export type ProfitBenchExpenseRow = {
  isProfitRow?: boolean | null;
  metric?: string | null;
  actualAmount?: number | null;
  groupType?: number | null;
  groupAccountMasterId?: number | null;
};

export type AccountingIncomeSlice = {
  private: number | null;
  membership: number | null;
  nhs: number | null;
} | null | undefined;

export type ProviderIncomeTotals = {
  totalPrivate?: number;
  totalMembership?: number;
  totalNhs?: number;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function isProfitBenchmarkRow(r: ProfitBenchExpenseRow): boolean {
  if (r.isProfitRow === true) return true;
  const metric = String(r.metric ?? '')
    .replace(/\s*%$/, '')
    .trim()
    .toUpperCase();
  return metric === 'PROFIT';
}

/** Private / Membership / NHS — same composition as ProfitBenchmark.tsx. */
export function composeIncomeBreakdown(
  providers: ProviderIncomeTotals[] | null | undefined,
  accountingIncome: AccountingIncomeSlice,
): { private: number; membership: number; nhs: number; total: number } {
  const list = providers ?? [];
  const pmsPrivate = round2(
    list.reduce((s, p) => s + (Number(p.totalPrivate) || 0), 0),
  );
  const pmsMembership = round2(
    list.reduce((s, p) => s + (Number(p.totalMembership) || 0), 0),
  );
  const pmsNhs = round2(list.reduce((s, p) => s + (Number(p.totalNhs) || 0), 0));

  const privateIncome = round2(
    accountingIncome?.private != null ? accountingIncome.private : pmsPrivate,
  );
  // Membership: the accounting path returns 0 (not null) whenever the
  // source defaults to Accounting App but no membership ledger revenue is
  // mapped/posted — that zero must not shadow the real statement-upload
  // revenue carried by provider net production (client 2026-08-20
  // "implement membership revenue" on Profit Benchmark). A NON-ZERO
  // accounting figure still wins — same gate as provider production's own
  // per-month membership fallback.
  const membershipIncome = round2(
    accountingIncome?.membership != null && accountingIncome.membership !== 0
      ? accountingIncome.membership
      : pmsMembership,
  );
  const nhsIncome = round2(
    accountingIncome?.nhs != null ? accountingIncome.nhs : pmsNhs,
  );

  return {
    private: privateIncome,
    membership: membershipIncome,
    nhs: nhsIncome,
    total: round2(privateIncome + membershipIncome + nhsIncome),
  };
}

/** Compose Production Income the same way as ProfitBenchmark.tsx. */
export function composeProductionIncome(
  providers: ProviderIncomeTotals[] | null | undefined,
  accountingIncome: AccountingIncomeSlice,
): number {
  return composeIncomeBreakdown(providers, accountingIncome).total;
}

/**
 * Resolve Cost (2) vs Expense (3) the same way as ProfitBenchmark.tsx.
 * Fallback when API omits groupType: Costs = Materials…Therapist, Expenses = Staff…
 */
export function resolveProfitBenchmarkGroupType(
  row: ProfitBenchExpenseRow,
): number | null {
  if (isProfitBenchmarkRow(row)) return null;
  if (row.groupType === 2 || row.groupType === 3) return row.groupType;
  const id = row.groupAccountMasterId;
  if (id != null && id >= 100 && id <= 104) return 2;
  if (id != null && id >= 105 && id <= 108) return 3;
  const name = String(row.metric ?? '')
    .replace(/\s*%$/, '')
    .trim()
    .toLowerCase();
  if (
    ['materials', 'lab fees', 'hygienist', 'dentist', 'therapist'].includes(name)
  ) {
    return 2;
  }
  if (
    ['staff', 'marketing', 'operating lease', 'other fixed costs'].includes(name)
  ) {
    return 3;
  }
  // Default non-profit rows to Costs of Treatment Delivery (group_type 2).
  return 2;
}

/**
 * Split Profitability rows into:
 *   totalCost     = Σ |actual| for Costs of Treatment Delivery (group_type 2)
 *   totalExpense  = Σ |actual| for Expenses to Run Your Business (group_type 3)
 */
export function splitProfitBenchmarkCostExpense(
  rows: ProfitBenchExpenseRow[] | null | undefined,
): { totalCost: number; totalExpense: number } {
  let totalCost = 0;
  let totalExpense = 0;
  for (const row of rows ?? []) {
    if (isProfitBenchmarkRow(row)) continue;
    const amount = Math.abs(Number(row.actualAmount) || 0);
    const groupType = resolveProfitBenchmarkGroupType(row);
    if (groupType === 3) totalExpense += amount;
    else totalCost += amount;
  }
  return {
    totalCost: round2(totalCost),
    totalExpense: round2(totalExpense),
  };
}

/**
 * Actual Profit = Production Income − mapped cost/expense actuals
 * (same derive step as the Profit Benchmark table PROFIT row).
 */
export function deriveActualProfit(
  productionIncome: number,
  rows: ProfitBenchExpenseRow[] | null | undefined,
): { actualProfit: number; totalExpenses: number; marginPct: number | null } {
  const income = Math.abs(Number(productionIncome) || 0);
  const totalExpenses = round2(
    (rows ?? [])
      .filter((r) => !isProfitBenchmarkRow(r))
      .reduce((sum, r) => sum + Math.abs(Number(r.actualAmount) || 0), 0),
  );
  const actualProfit = round2(income - totalExpenses);
  const marginPct =
    income > 0 ? Math.round((actualProfit / income) * 1000) / 10 : null;
  return { actualProfit, totalExpenses, marginPct };
}
