// Canonical Profit & Loss / Balance Sheet layout used by Financial Statements.
// Mirrors Xero's "How account types affect your reports" structure:
//
//   P&L: Income → Less Cost of Sales → GROSS PROFIT → Plus Other Income
//        → Less Expenses → NET PROFIT
//   BS:  Current Assets → Plus Bank → Plus Fixed Assets → Plus Non-current Assets
//        → TOTAL ASSETS → Less Current Liabilities → Less Non-current Liabilities
//        → NET ASSETS → Equity → Plus Net Profit → TOTAL EQUITY

import { isCostOfSalesSection } from "@/lib/financialSummary";

export type ReportOperator = "plus" | "less";

export type PlLayoutRole =
  | "income"
  | "cost_of_sales"
  | "other_income"
  | "expenses"
  | "summary"
  | "other";

export type BsLayoutRole =
  | "current_assets"
  | "bank"
  | "fixed_assets"
  | "non_current_assets"
  | "current_liabilities"
  | "non_current_liabilities"
  | "equity"
  | "net_profit"
  | "other";

function norm(name: string): string {
  return name.trim().toLowerCase();
}

export function classifyPlSection(name: string): PlLayoutRole {
  const n = norm(name);
  if (
    /^(gross\s+profit|net\s+profit|net\s+income|net\s+loss|net\s+operating)/.test(n)
  ) {
    return "summary";
  }
  if (
    /\bother\s+income\b/.test(n) ||
    /\bother\s+revenue\b/.test(n) ||
    /\bother\s+operating\s+income\b/.test(n)
  ) {
    return "other_income";
  }
  if (isCostOfSalesSection(name)) return "cost_of_sales";
  if (
    /\bdepreciat/.test(n) ||
    /\boverheads?\b/.test(n) ||
    /\boperating\s+expens/.test(n) ||
    /\boperating\s+costs/.test(n) ||
    /\badministrative/.test(n) ||
    /\bother\s+expens/.test(n) ||
    /\bexpens/.test(n)
  ) {
    return "expenses";
  }
  if (/\bincome\b|\brevenue\b|\bsales\b|\bturnover\b/.test(n)) return "income";
  return "other";
}

export function classifyBsSection(name: string): BsLayoutRole {
  const n = norm(name);

  if (isCurrentYearEarningsName(name)) return "net_profit";

  if (
    /^bank$/.test(n) ||
    /\bbank\s+accounts?\b/.test(n) ||
    /\bcash\s+at\s+bank/.test(n) ||
    /\bcash\s+and\s+cash/.test(n) ||
    /\bcash\s+at\s+hand/.test(n) ||
    /\bcash\s+equivalents?\b/.test(n)
  ) {
    return "bank";
  }

  if (
    /\bnon[-\s]?current\s+assets?\b/.test(n) ||
    /\bother\s+assets?\b/.test(n) ||
    /\bintangible/.test(n)
  ) {
    return "non_current_assets";
  }

  if (/\binventory\b|\bstock\b|\bprepayment/.test(n)) return "current_assets";
  if (/\bcurrent\s+assets?\b|\bdebtors?\b|\breceivable/.test(n)) {
    return "current_assets";
  }

  if (
    /\bfixed\s+assets?\b/.test(n) ||
    /\btangible/.test(n) ||
    /\bproperty/.test(n) ||
    /\bplant\b/.test(n) ||
    /\bequipment\b/.test(n) ||
    /\bppe\b/.test(n)
  ) {
    return "fixed_assets";
  }

  if (
    /\bnon[-\s]?current\s+liabilit/.test(n) ||
    /\blong[-\s]?term/.test(n) ||
    /\bafter\s+more\s+than/.test(n) ||
    /\bfalling\s+due\s+after/.test(n) ||
    /\bterm\s+liabilit/.test(n)
  ) {
    return "non_current_liabilities";
  }

  if (
    /\bcurrent\s+liabilit/.test(n) ||
    /\bshort[-\s]?term/.test(n) ||
    /\bwithin\s+one\s+year/.test(n) ||
    /\bfalling\s+due\s+within/.test(n)
  ) {
    return "current_liabilities";
  }

  // Xero's generic "Liabilities" account type sits with non-current liabilities.
  if (/\bliabilit|\bcreditor|\bpayable/.test(n)) {
    return "non_current_liabilities";
  }

  if (
    /\bequity\b/.test(n) ||
    /\bcapital\b/.test(n) ||
    /\breserve/.test(n) ||
    /\bretained\s+earning/.test(n) ||
    /\bshareholders/.test(n) ||
    /\bstockholders/.test(n)
  ) {
    return "equity";
  }

  return "other";
}

/** Current Year Earnings / P&L result rows that flow into Balance Sheet equity. */
export function isCurrentYearEarningsName(name: string): boolean {
  const n = norm(name);
  return (
    /\bcurrent\s+year\s+earning/.test(n) ||
    /\bnet\s+profit\b/.test(n) ||
    /\bnet\s+income\b/.test(n) ||
    /\bprofit\s+for\s+the\b/.test(n) ||
    /\bprofit\s+and\s+loss\b/.test(n) ||
    /\bprofit\s+\/\s+loss\b/.test(n)
  );
}

export function plSectionOperator(role: PlLayoutRole): ReportOperator | null {
  if (role === "cost_of_sales" || role === "expenses" || role === "other") {
    return "less";
  }
  if (role === "other_income") return "plus";
  return null;
}

/**
 * Xero (and some chart-of-accounts setups) already bake "Plus" / "Less" into
 * the section title, e.g. "Plus Other Income" or "Less Operating Expenses".
 * Strip that leading word so the UI operator prefix is not duplicated.
 */
export function stripLeadingReportOperator(name: string): string {
  return name.replace(/^(plus|less)\s+/i, "").trim();
}

export function bsSectionOperator(role: BsLayoutRole): ReportOperator | null {
  if (
    role === "bank" ||
    role === "fixed_assets" ||
    role === "non_current_assets" ||
    role === "net_profit"
  ) {
    return "plus";
  }
  if (role === "current_liabilities" || role === "non_current_liabilities") {
    return "less";
  }
  return null;
}

/**
 * P&L section sequence from the Xero account-type layout.
 * Unknown titles sort after Expenses so they still appear before Net Profit.
 */
export function xeroProfitLossSectionRank(name: string): number {
  switch (classifyPlSection(name)) {
    case "income":
      return 10;
    case "cost_of_sales":
      return 20;
    case "other_income":
      return 30;
    case "expenses":
      return 40;
    case "other":
      return 50;
    default:
      return 90;
  }
}

/**
 * Balance Sheet section sequence from the Xero account-type layout:
 * Current Assets → Bank → Fixed Assets → Non-current Assets →
 * Current Liabilities → Non-current Liabilities → Equity → Net Profit.
 *
 * `group` only ranks titles the classifier doesn't recognise, so a leftover
 * asset/liability/equity section still lands in the right block.
 */
export function xeroBalanceSheetSectionRank(
  name: string,
  group?: "assets" | "liabilities" | "equity" | null,
): number {
  switch (classifyBsSection(name)) {
    case "current_assets":
      return 10;
    case "bank":
      return 20;
    case "fixed_assets":
      return 30;
    case "non_current_assets":
      return 40;
    case "current_liabilities":
      return 100;
    case "non_current_liabilities":
      return 110;
    case "equity":
      return 200;
    case "net_profit":
      return 230;
    default:
      if (group === "assets") return 45;
      if (group === "liabilities") return 115;
      if (group === "equity") return 205;
      return 500;
  }
}

export interface PlSectionBuckets<T> {
  income: T[];
  costOfSales: T[];
  otherIncome: T[];
  expenses: T[];
}

/** Groups P&L sections into the Xero account-type order, dropping native summary rows. */
export function partitionPlSections<T extends { name: string }>(
  sections: T[],
): PlSectionBuckets<T> {
  const buckets: PlSectionBuckets<T> = {
    income: [],
    costOfSales: [],
    otherIncome: [],
    expenses: [],
  };
  for (const section of sections) {
    switch (classifyPlSection(section.name)) {
      case "income":
        buckets.income.push(section);
        break;
      case "cost_of_sales":
        buckets.costOfSales.push(section);
        break;
      case "other_income":
        buckets.otherIncome.push(section);
        break;
      case "summary":
        break;
      default:
        buckets.expenses.push(section);
    }
  }
  return buckets;
}

export interface BsSectionBuckets<T> {
  currentAssets: T[];
  bank: T[];
  fixedAssets: T[];
  nonCurrentAssets: T[];
  currentLiabilities: T[];
  nonCurrentLiabilities: T[];
  equity: T[];
  netProfit: T[];
}

export function partitionBsSections<T extends { name: string; group?: "assets" | "liabilities" | "equity" | null }>(
  sections: T[],
  fallbackGroup: (section: T) => "assets" | "liabilities" | "equity",
): BsSectionBuckets<T> {
  const buckets: BsSectionBuckets<T> = {
    currentAssets: [],
    bank: [],
    fixedAssets: [],
    nonCurrentAssets: [],
    currentLiabilities: [],
    nonCurrentLiabilities: [],
    equity: [],
    netProfit: [],
  };
  for (const section of sections) {
    switch (classifyBsSection(section.name)) {
      case "current_assets":
        buckets.currentAssets.push(section);
        break;
      case "bank":
        buckets.bank.push(section);
        break;
      case "fixed_assets":
        buckets.fixedAssets.push(section);
        break;
      case "non_current_assets":
        buckets.nonCurrentAssets.push(section);
        break;
      case "current_liabilities":
        buckets.currentLiabilities.push(section);
        break;
      case "non_current_liabilities":
        buckets.nonCurrentLiabilities.push(section);
        break;
      case "equity":
        buckets.equity.push(section);
        break;
      case "net_profit":
        buckets.netProfit.push(section);
        break;
      default: {
        const group = section.group ?? fallbackGroup(section);
        if (group === "liabilities") buckets.nonCurrentLiabilities.push(section);
        else if (group === "equity") buckets.equity.push(section);
        else buckets.nonCurrentAssets.push(section);
      }
    }
  }
  return buckets;
}

function sumAmountColumns(
  items: { amounts: number[] }[],
  columnCount: number,
): number[] {
  const totals = new Array(columnCount).fill(0);
  for (const item of items) {
    item.amounts.forEach((amount, i) => {
      totals[i] += amount ?? 0;
    });
  }
  return totals;
}

/**
 * Moves Current Year Earnings / Net Profit line items out of Equity so the
 * Balance Sheet can show them as the separate "Plus Net Profit" row.
 */
export function splitEquityNetProfit<
  T extends {
    name: string;
    items: { name: string; amounts: number[] }[];
    totalAmounts: number[];
  },
>(
  equitySections: T[],
  netProfitSections: T[],
): { equitySections: T[]; netProfitAmounts: number[] } {
  const columnCount = Math.max(
    0,
    ...equitySections.map((s) => s.totalAmounts.length),
    ...netProfitSections.map((s) => s.totalAmounts.length),
    ...equitySections.flatMap((s) => s.items.map((i) => i.amounts.length)),
  );
  const netProfitAmounts = new Array(columnCount).fill(0);

  for (const section of netProfitSections) {
    section.totalAmounts.forEach((amount, i) => {
      netProfitAmounts[i] += amount ?? 0;
    });
  }

  const nextEquity: T[] = [];
  for (const section of equitySections) {
    const kept = section.items.filter((item) => !isCurrentYearEarningsName(item.name));
    const stripped = section.items.filter((item) => isCurrentYearEarningsName(item.name));
    stripped.forEach((item) => {
      item.amounts.forEach((amount, i) => {
        netProfitAmounts[i] += amount ?? 0;
      });
    });
    if (kept.length === 0 && stripped.length > 0) continue;
    if (stripped.length === 0) {
      nextEquity.push(section);
      continue;
    }
    nextEquity.push({
      ...section,
      items: kept,
      totalAmounts: sumAmountColumns(kept, section.totalAmounts.length),
    });
  }

  return { equitySections: nextEquity, netProfitAmounts };
}
