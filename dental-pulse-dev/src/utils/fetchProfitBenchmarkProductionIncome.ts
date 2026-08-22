/**
 * Fetch Profit Benchmark Production Income for a scope:
 * Private + Membership + NHS (Accounting App when mapped; else Provider Net Production).
 */

import { fetchAllProvidersNetProduction } from '@/hooks/useAllProvidersNetProduction';
import { fetchLocationIncomeAccountingTotals } from '@/hooks/useLocationIncomeAccountingTotals';
import {
  composeIncomeBreakdown,
  type AccountingIncomeSlice,
  type ProviderIncomeTotals,
} from '@/utils/profitBenchmarkActual';

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toProviderTotals(
  providers: Array<{
    totalPrivate?: number;
    totalMembership?: number;
    totalNhs?: number;
  }>,
): ProviderIncomeTotals[] {
  return (providers ?? []).map((p) => ({
    totalPrivate: p.totalPrivate,
    totalMembership: p.totalMembership,
    totalNhs: p.totalNhs,
  }));
}

function pmsPayorSum(providers: ProviderIncomeTotals[]): number {
  return providers.reduce(
    (s, p) =>
      s +
      (Number(p.totalPrivate) || 0) +
      (Number(p.totalMembership) || 0) +
      (Number(p.totalNhs) || 0),
    0,
  );
}

async function loadProviders(
  organizationId: string,
  fromDate: string,
  toDate: string,
  locationId?: string | null,
): Promise<ProviderIncomeTotals[]> {
  const production = await fetchAllProvidersNetProduction(organizationId, {
    startDate: parseYmd(fromDate),
    endDate: parseYmd(toDate),
    locationId: locationId ?? null,
  });
  return toProviderTotals(production.providers ?? []);
}

export type ProductionIncomeResult = {
  private: number;
  membership: number;
  nhs: number;
  total: number;
};

/**
 * Same composition as ProfitBenchmark.tsx / composeIncomeBreakdown.
 * Retries provider production once when PMS totals come back empty (common under
 * parallel RPC load on the Locations leaderboard).
 */
export async function fetchProfitBenchmarkProductionIncome(
  organizationId: string,
  fromDate: string,
  toDate: string,
  locationId?: string | null,
): Promise<ProductionIncomeResult> {
  const accounting: AccountingIncomeSlice =
    await fetchLocationIncomeAccountingTotals(
      organizationId,
      fromDate,
      toDate,
      locationId ?? null,
    );

  // Provider Net Production RPCs can fail under parallel load (they now THROW
  // instead of silently returning £0 — see fetchAllProvidersNetProduction).
  // Retry once so Private / NHS (PMS path) are not dropped, leaving only
  // Membership; a second failure propagates so callers don't cache bad data.
  let providers: ProviderIncomeTotals[];
  try {
    providers = await loadProviders(organizationId, fromDate, toDate, locationId);
  } catch {
    await new Promise((r) => setTimeout(r, 400));
    providers = await loadProviders(organizationId, fromDate, toDate, locationId);
  }

  if (pmsPayorSum(providers) === 0) {
    await new Promise((r) => setTimeout(r, 400));
    providers = await loadProviders(
      organizationId,
      fromDate,
      toDate,
      locationId,
    );
  }

  const breakdown = composeIncomeBreakdown(providers, accounting);
  return {
    private: breakdown.private,
    membership: breakdown.membership,
    nhs: breakdown.nhs,
    total: breakdown.total,
  };
}
