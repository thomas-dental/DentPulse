/**
 * Operational Efficiency break-even sales.
 *
 * Aligns with Profitability (Profit Benchmark):
 *   Gross Profit   = Total Revenue − Total Cost
 *   Gross Profit % = Gross Profit / Revenue × 100
 *   Break-even     = Total Expense / (Gross Profit % / 100)
 *                  = Total Expense × Revenue / Gross Profit
 *
 * Total Revenue / Cost / Expense come from the Profitability page
 * (Production Income, Costs of Treatment Delivery, Expenses to Run Business).
 */

export interface BreakEvenResult {
  /** Revenue needed to cover operating expenses at the current GP%; null when undefined. */
  breakEvenSales: number | null;
  /** max(0, breakEvenSales − revenue); null when break-even unknown. */
  breakEvenGap: number | null;
  grossProfit: number;
  /** Gross profit as a percent of revenue (0–100 scale); null when revenue ≤ 0. */
  grossProfitPct: number | null;
  /** Decimal ratio Gross Profit / Revenue; null when revenue ≤ 0. */
  grossProfitRatio: number | null;
  totalCost: number;
  totalExpense: number;
}

export function computeBreakEvenSales(
  revenue: number,
  totalCost: number,
  totalExpense: number,
): BreakEvenResult {
  const rev = Number(revenue) || 0;
  const cost = Math.max(0, Number(totalCost) || 0);
  const expense = Math.max(0, Number(totalExpense) || 0);
  const grossProfit = rev - cost;
  const grossProfitRatio = rev > 0 ? grossProfit / rev : null;
  const grossProfitPct =
    grossProfitRatio != null ? grossProfitRatio * 100 : null;

  const empty: BreakEvenResult = {
    breakEvenSales: null,
    breakEvenGap: null,
    grossProfit,
    grossProfitPct,
    grossProfitRatio,
    totalCost: cost,
    totalExpense: expense,
  };

  // Need positive gross margin to convert expenses into a sales cover point.
  if (rev <= 0 || grossProfitRatio == null || grossProfitRatio <= 0) {
    return empty;
  }

  // Break Even = Total Expense / Gross Profit %  (GP% as a ratio, not ×100)
  const breakEvenSales = expense / grossProfitRatio;
  return {
    breakEvenSales,
    breakEvenGap: Math.max(0, breakEvenSales - rev),
    grossProfit,
    grossProfitPct,
    grossProfitRatio,
    totalCost: cost,
    totalExpense: expense,
  };
}
