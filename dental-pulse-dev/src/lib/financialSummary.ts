// Shared P&L / Balance Sheet summary classification, used by every
// accounting-platform hook (Iplicit, Xero, QuickBooks) that builds
// FinancialSection[] trees and needs headline summary numbers from them.

import type { LineItem, FinancialSection } from '@/data/financialReportsData';

const REVENUE_KEYWORDS = ['income', 'revenue', 'sales', 'turnover'];
const COGS_KEYWORDS = ['cost of sales', 'direct costs', 'cost of goods', 'cogs'];
const OPEX_KEYWORDS = ['overheads', 'operating expenses', 'operating costs', 'administrative', 'admin'];
const GROSS_PROFIT_KEYWORDS = ['gross profit'];
const ASSET_KEYWORDS = ['asset', 'fixed asset', 'current asset', 'bank'];
const LIABILITY_KEYWORDS = ['liability', 'liabilities', 'current liabilit', 'long-term liabilit', 'creditor'];
const EQUITY_KEYWORDS = ['equity', 'capital', 'reserves', 'retained earnings', 'shareholders'];

export function matchesAny(description: string, keywords: string[]): boolean {
  const lower = description.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/** Which period column to read off each LineItem/section total when computing a summary. */
export type PeriodField = 'currentPeriod' | 'priorPeriod';

export function computePLSummary(sections: FinancialSection[], field: PeriodField = 'currentPeriod') {
  let revenueTotal = 0;
  let cogsTotal = 0;
  let opexTotal = 0;
  let grossProfitDirect = 0;
  let hasGrossProfitSection = false;

  for (const s of sections) {
    const name = s.name;
    if (matchesAny(name, GROSS_PROFIT_KEYWORDS)) {
      // "Gross Profit" section — try to extract revenue/COGS from children
      hasGrossProfitSection = true;
      let childRevenue = 0;
      let childCogs = 0;
      let childClassified = false;

      for (const item of s.items) {
        if (matchesAny(item.name, REVENUE_KEYWORDS)) {
          childRevenue += item[field];
          childClassified = true;
        } else if (matchesAny(item.name, COGS_KEYWORDS)) {
          childCogs += item[field];
          childClassified = true;
        }
      }

      if (childClassified) {
        revenueTotal += childRevenue;
        cogsTotal += childCogs;
      } else {
        // No classifiable children — use section total as gross profit directly
        grossProfitDirect += s.total[field];
      }
    } else if (matchesAny(name, REVENUE_KEYWORDS)) {
      revenueTotal += s.total[field];
    } else if (matchesAny(name, COGS_KEYWORDS)) {
      cogsTotal += s.total[field];
    } else if (matchesAny(name, OPEX_KEYWORDS)) {
      opexTotal += s.total[field];
    } else {
      // Unclassified — treat as opex
      opexTotal += s.total[field];
    }
  }

  // If we found revenue/COGS inside Gross Profit children, compute normally
  // Otherwise use the direct gross profit total from the section
  const grossProfit = hasGrossProfitSection && revenueTotal === 0
    ? grossProfitDirect
    : revenueTotal - Math.abs(cogsTotal);

  // For revenue display: if no separate revenue found, use gross profit + COGS as estimate
  const displayRevenue = revenueTotal > 0 ? revenueTotal : (hasGrossProfitSection ? grossProfitDirect + Math.abs(cogsTotal) : 0);

  const grossMargin = displayRevenue !== 0 ? (grossProfit / displayRevenue) * 100 : 0;
  const ebitda = grossProfit - Math.abs(opexTotal);
  const ebitdaMargin = displayRevenue !== 0 ? (ebitda / displayRevenue) * 100 : 0;

  return {
    revenue: displayRevenue,
    grossProfit,
    grossMargin,
    ebitda,
    ebitdaMargin,
  };
}

function findAmount(items: LineItem[], keyword: string, field: PeriodField): number {
  for (const item of items) {
    if (item.name.toLowerCase().includes(keyword)) {
      return item[field];
    }
    if (item.children) {
      const found = findAmount(item.children, keyword, field);
      if (found !== 0) return found;
    }
  }
  return 0;
}

export function computeBSSummary(sections: FinancialSection[], field: PeriodField = 'currentPeriod') {
  let totalAssets = 0;
  let totalLiabilities = 0;
  let equity = 0;
  let currentAssets = 0;
  let currentLiabilities = 0;

  for (const s of sections) {
    const name = s.name;
    if (matchesAny(name, EQUITY_KEYWORDS)) {
      equity += s.total[field];
    } else if (matchesAny(name, LIABILITY_KEYWORDS)) {
      totalLiabilities += s.total[field];
      if (name.toLowerCase().includes('current')) {
        currentLiabilities += s.total[field];
      } else {
        // Check children for "Current Liabilities"
        currentLiabilities += findAmount(s.items, 'current', field);
      }
    } else if (matchesAny(name, ASSET_KEYWORDS)) {
      totalAssets += s.total[field];
      if (name.toLowerCase().includes('current')) {
        currentAssets += s.total[field];
      } else {
        // Check children for "Current Assets"
        currentAssets += findAmount(s.items, 'current', field);
      }
    } else {
      // Unclassified — treat as asset
      totalAssets += s.total[field];
    }
  }

  const workingCapital = currentAssets - Math.abs(currentLiabilities);
  const currentRatio = currentLiabilities !== 0 ? currentAssets / Math.abs(currentLiabilities) : 0;

  return {
    totalAssets,
    totalLiabilities,
    equity,
    workingCapital,
    currentRatio,
  };
}

export function isCostOfSalesSection(name: string): boolean {
  return matchesAny(name, COGS_KEYWORDS);
}
