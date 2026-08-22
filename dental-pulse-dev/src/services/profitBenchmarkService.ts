/**
 * Profit Benchmark Service
 * Uses Supabase Edge Function: profit-benchmark
 * Persists benchmark % via profit_benchmark_settings (RLS).
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

function isEdgeFunctionRequestFailed(msg: string): boolean {
  return msg?.includes('Edge Function') && msg?.toLowerCase().includes('failed to send');
}

function wrapEdgeFunctionError(error: Error, functionName: string): Error {
  const message = error?.message ?? '';
  if (isEdgeFunctionRequestFailed(message)) {
    return new Error(
      `${message} Deploy the profit-benchmark Edge Function (supabase functions deploy profit-benchmark) and check VITE_SUPABASE_URL.`
    );
  }
  return error;
}

/** When the Edge Function returns 4xx/5xx, Supabase may not populate `data`; read JSON body. */
async function messageFromFunctionsHttpError(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  const res = error.context as Response | undefined;
  if (!res?.clone) return null;
  try {
    const body = (await res.clone().json()) as { error?: string; resultMsg?: string };
    const parts = [body?.resultMsg, body?.error].filter(
      (s) => typeof s === 'string' && s.trim() !== '',
    );
    return parts.length > 0 ? parts.join(' — ') : null;
  } catch {
    return null;
  }
}

function isAuthFailureMessage(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes('invalid authentication') ||
    m.includes('missing authorization') ||
    m.includes('jwt') ||
    m.includes('401') ||
    m.includes('unauthorized')
  );
}

/** Refresh the access token so edge functions that call auth.getUser(token) succeed after deploy/session drift. */
async function ensureFreshSession(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error(
      'Your session expired. Sign out and sign back in, then retry Profit Benchmark.',
    );
  }
  const expiresAt = sessionData.session.expires_at ?? 0;
  const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);
  // Refresh if missing, expired, or within 2 minutes of expiry.
  if (secondsLeft < 120) {
    const { error } = await supabase.auth.refreshSession();
    if (error) {
      throw new Error(
        'Your session expired. Sign out and sign back in, then retry Profit Benchmark.',
      );
    }
  }
}

async function throwInvokeError(error: unknown, functionName: string): Promise<never> {
  if (error instanceof Error && isEdgeFunctionRequestFailed(error.message)) {
    throw wrapEdgeFunctionError(error, functionName);
  }
  const fromBody = await messageFromFunctionsHttpError(error);
  if (fromBody && isAuthFailureMessage(fromBody)) {
    throw new Error(
      'Session expired or invalid. Sign out and sign back in, then click Retry.',
    );
  }
  if (fromBody) {
    throw new Error(`${functionName}: ${fromBody}`);
  }
  if (error instanceof Error) {
    if (isAuthFailureMessage(error.message) || error.message.includes('non-2xx')) {
      throw new Error(
        'Session expired or invalid. Sign out and sign back in, then click Retry.',
      );
    }
    throw wrapEdgeFunctionError(error, functionName);
  }
  throw new Error(`${functionName}: ${String(error)}`);
}

async function invokeProfitBenchmarkOnce(
  organizationId: string,
  request: ProfitBenchmarkRequest,
): Promise<{ data: ProfitBenchmarkResponse | null; error: unknown }> {
  const { data, error } = await supabase.functions.invoke('profit-benchmark', {
    body: { organizationId, ...request },
  });
  return { data: data as ProfitBenchmarkResponse | null, error };
}

// ============================================
// TYPES
// ============================================

export interface ProfitBenchmarkRow {
  metric: string;
  current: number;
  benchmark: number;
  group: number;
  /** Present for category-based rows; null for legacy KPI rows */
  groupAccountMasterId?: number | null;
  /** Pro: 2 = Costs, 3 = Expenses; null for profit/legacy rows */
  groupType?: number | null;
  isProfitRow?: boolean;
  /** Currency amount for the row when category-based (expense £ or profit £) */
  actualAmount?: number | null;
}

export interface ProfitBenchmarkRequest {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  /** Practice location UUID from global filter; omit or null for all locations (same as cashflow-report). */
  locationId?: string | null;
  /** Xero Practice tracking option ID when the location is split within a shared tenant. */
  trackingOptionId?: string | null;
  comparisonType?: string | null;
  entityId?: string | null;
  revenueMin?: number | null;
  revenueMax?: number | null;
  ebitdaMarginMin?: number | null;
  ebitdaMarginMax?: number | null;
  /** When 'month', edge returns monthly[] from one journal scan (Group Dashboard trend). */
  granularity?: 'month';
}

export interface ProfitIncomeBreakdown {
  privateIncome: number;
  membershipIncome: number;
  nhsIncome: number;
  productionIncome: number;
  /** True when Private/Membership/NHS came from Setup Categories Revenue mappings */
  fromRevenueMappings?: boolean;
  /** True when income came from Provider Net Production (all provider types) */
  fromProviderProduction?: boolean;
}

export interface ProfitBenchmarkResponse {
  rows: ProfitBenchmarkRow[];
  productionIncome: number;
  incomeBreakdown?: ProfitIncomeBreakdown | null;
  /** Scope for saving benchmark % rows (matches group_account / finance source) */
  platformIntegrationId: string | null;
  resultMsg: string;
  status: number; // 8 = Success
}

function withoutLegacyClinicianCost(rows: ProfitBenchmarkRow[] | null | undefined): ProfitBenchmarkRow[] {
  return (rows ?? []).filter(
    (row) =>
      row.groupAccountMasterId !== 109 &&
      String(row.metric || '').replace(/\s+/g, '').toLowerCase() !== 'cliniciancost',
  );
}

export interface SaveProfitBenchmarkItem {
  groupAccountMasterId: number | null;
  isProfitRow: boolean;
  benchmarkPercent: number;
}

function benchRowKey(r: ProfitBenchmarkRow): string {
  if (r.isProfitRow === true) return 'profit';
  if (r.groupAccountMasterId != null && Number.isFinite(r.groupAccountMasterId)) {
    return `g:${r.groupAccountMasterId}`;
  }
  return `m:${r.metric}`;
}

/**
 * Replace saved benchmark targets for the given org + integration scope.
 */
export async function saveProfitBenchmarkSettings(
  organizationId: string,
  platformIntegrationId: string | null,
  items: SaveProfitBenchmarkItem[]
): Promise<void> {
  for (const item of items) {
    let del = supabase.from('profit_benchmark_settings' as any).delete().eq('organization_id', organizationId);
    if (platformIntegrationId) {
      del = del.eq('platform_integration_id', platformIntegrationId);
    } else {
      del = del.is('platform_integration_id', null);
    }
    del = del.eq('is_profit_row', item.isProfitRow);
    if (item.isProfitRow) {
      del = del.is('group_account_master_id', null);
    } else if (item.groupAccountMasterId != null) {
      del = del.eq('group_account_master_id', item.groupAccountMasterId);
    } else {
      continue;
    }
    const { error: delErr } = await del;
    if (delErr) throw delErr;

    const insertRow: Record<string, unknown> = {
      organization_id: organizationId,
      platform_integration_id: platformIntegrationId,
      is_profit_row: item.isProfitRow,
      benchmark_percent: item.benchmarkPercent,
    };
    if (!item.isProfitRow) {
      insertRow.group_account_master_id = item.groupAccountMasterId;
    }

    const { error: insErr } = await supabase.from('profit_benchmark_settings' as any).insert(insertRow);
    if (insErr) throw insErr;
  }
}

export function profitBenchmarkRowKey(r: ProfitBenchmarkRow): string {
  return benchRowKey(r);
}

// ============================================
// API CALL
// ============================================

/**
 * Get profit benchmark rows
 * Edge function: profit-benchmark
 */
export async function getProfitBenchmark(
  organizationId: string,
  request: ProfitBenchmarkRequest
): Promise<ProfitBenchmarkResponse> {
  await ensureFreshSession();

  let { data, error } = await invokeProfitBenchmarkOnce(organizationId, request);

  // One retry after forced refresh — common after deploy when the access token is stale.
  if (error) {
    const bodyMsg = await messageFromFunctionsHttpError(error);
    const shouldRetryAuth =
      isAuthFailureMessage(bodyMsg) ||
      (error instanceof Error &&
        (isAuthFailureMessage(error.message) || error.message.includes('non-2xx')));
    if (shouldRetryAuth) {
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr) {
        ({ data, error } = await invokeProfitBenchmarkOnce(organizationId, request));
      }
    }
  }

  if (error) {
    await throwInvokeError(error, 'profit-benchmark');
  }

  if (data?.status === 8) {
    return {
      // Clinician Cost is derived as Hygienist + Dentist + Therapist only on
      // Cost Impact. Profitability already presents those three constituent
      // rows, so the legacy aggregate row would duplicate costs.
      rows: withoutLegacyClinicianCost(data.rows),
      productionIncome: Number(data.productionIncome ?? 0) || 0,
      incomeBreakdown: data.incomeBreakdown ?? null,
      platformIntegrationId: data.platformIntegrationId ?? null,
      resultMsg: data.resultMsg ?? 'Success',
      status: data.status,
    };
  }

  throw new Error(data?.resultMsg || 'Failed to fetch profit benchmark');
}

export interface ProfitBenchmarkMonthlyPoint {
  monthKey: string; // 'MMM-yy'
  rows: ProfitBenchmarkRow[];
  productionIncome: number;
  incomeBreakdown?: ProfitIncomeBreakdown | null;
}

/**
 * One edge call: profit-benchmark with granularity=month.
 * Journals are scanned once and bucketed by calendar month (same formulas as period mode).
 */
export async function getProfitBenchmarkMonthlySeries(
  organizationId: string,
  request: Omit<ProfitBenchmarkRequest, 'granularity'>,
): Promise<ProfitBenchmarkMonthlyPoint[]> {
  await ensureFreshSession();

  const payload = { ...request, granularity: 'month' as const };
  let { data, error } = await invokeProfitBenchmarkOnce(organizationId, payload);

  if (error) {
    const bodyMsg = await messageFromFunctionsHttpError(error);
    const shouldRetryAuth =
      isAuthFailureMessage(bodyMsg) ||
      (error instanceof Error &&
        (isAuthFailureMessage(error.message) || error.message.includes('non-2xx')));
    if (shouldRetryAuth) {
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr) {
        ({ data, error } = await invokeProfitBenchmarkOnce(organizationId, payload));
      }
    }
  }

  if (error) {
    await throwInvokeError(error, 'profit-benchmark');
  }

  if (data?.status === 8 && Array.isArray(data.monthly)) {
    return (data.monthly as ProfitBenchmarkMonthlyPoint[]).map((m) => ({
      monthKey: m.monthKey,
      rows: withoutLegacyClinicianCost(m.rows),
      productionIncome: Number(m.productionIncome ?? 0) || 0,
      incomeBreakdown: m.incomeBreakdown ?? null,
    }));
  }

  throw new Error(data?.resultMsg || 'Failed to fetch monthly profit benchmark');
}

// ============================================
// CATEGORY DRILL-DOWN + PERIODIC CHART
// ============================================

export type ProfitPeriodGranularity = 'weekly' | 'monthly' | 'yearly';

export interface ProfitCategoryDetailRequest {
  fromDate: string;
  toDate: string;
  groupAccountMasterId: number;
  locationId?: string | null;
  /** Xero Practice tracking option ID when the location is split within a shared tenant. */
  trackingOptionId?: string | null;
  mode: 'transactions' | 'periodic';
  periodGranularity?: ProfitPeriodGranularity;
  benchmarkPercent?: number;
  productionIncome?: number;
  categoryName?: string;
  search?: string;
}

export interface ProfitCategoryDrilldownTransaction {
  date: string;
  docId: string;
  docClass?: string;
  description?: string;
  accountId?: string;
  accountCode?: string;
  accountName?: string;
  amountRaw?: number;
  amountDisplay?: number;
  transactionType: string;
  transactionLink: string;
  name: string;
  memoOrDescription: string;
  whoPaid: string;
  forWhat: string;
  moneyIn: number;
  moneyOut: number;
}

export interface ProfitCategoryDetailSummary {
  expected: number;
  actual: number;
  actualPct?: number;
  benchmarkPercent: number;
  variance: number;
  productionIncome?: number;
  moneyIn?: number;
  moneyOut?: number;
}

export interface ProfitPeriodicPoint {
  key: string;
  label: string;
  expected: number;
  actual: number;
}

export interface ProfitCategoryTransactionsResponse {
  mode: 'transactions';
  categoryName: string;
  groupAccountMasterId: number;
  accountingPlatform: 'xero' | 'iplicit' | null;
  summary: ProfitCategoryDetailSummary;
  transactions: ProfitCategoryDrilldownTransaction[];
}

export interface ProfitCategoryPeriodicResponse {
  mode: 'periodic';
  categoryName: string;
  groupAccountMasterId: number;
  periodGranularity: ProfitPeriodGranularity;
  benchmarkPercent: number;
  summary: ProfitCategoryDetailSummary;
  periods: ProfitPeriodicPoint[];
}

async function invokeProfitCategoryDetail(
  organizationId: string,
  request: ProfitCategoryDetailRequest
): Promise<Record<string, unknown>> {
  let trackingOptionId = request.trackingOptionId ?? null;
  const locationId =
    request.locationId && String(request.locationId).toLowerCase() !== 'all'
      ? String(request.locationId).trim()
      : '';
  if (!trackingOptionId && locationId) {
    const { data: mappingRows } = await (supabase as any)
      .from('platform_integration_organization_mapping')
      .select('xero_tracking_option_id')
      .eq('organization_id', organizationId)
      .eq('location_id', locationId);
    const option = (mappingRows ?? []).find(
      (m: { xero_tracking_option_id?: string | null }) => m.xero_tracking_option_id,
    )?.xero_tracking_option_id;
    if (option) trackingOptionId = String(option).trim();
  }

  const { data, error } = await supabase.functions.invoke('profit-benchmark-category-detail', {
    body: { organizationId, ...request, trackingOptionId },
  });

  if (error) {
    throw wrapEdgeFunctionError(
      new Error(error.message || 'Failed to fetch profit category detail'),
      'profit-benchmark-category-detail'
    );
  }

  if (data?.transactionStatus !== 8) {
    throw new Error(data?.resultMsg || data?.error || 'Failed to fetch profit category detail');
  }

  return data as Record<string, unknown>;
}

export async function getProfitCategoryDrilldown(
  organizationId: string,
  request: Omit<ProfitCategoryDetailRequest, 'mode'>
): Promise<ProfitCategoryTransactionsResponse> {
  const data = await invokeProfitCategoryDetail(organizationId, { ...request, mode: 'transactions' });
  return {
    mode: 'transactions',
    categoryName: String(data.categoryName || request.categoryName || ''),
    groupAccountMasterId: Number(data.groupAccountMasterId ?? request.groupAccountMasterId),
    accountingPlatform: (data.accountingPlatform as 'xero' | 'iplicit' | null) ?? null,
    summary: (data.summary as ProfitCategoryDetailSummary) ?? {
      expected: 0,
      actual: 0,
      benchmarkPercent: request.benchmarkPercent ?? 0,
      variance: 0,
    },
    transactions: (data.returnObject as ProfitCategoryDrilldownTransaction[]) ?? [],
  };
}

export async function getProfitCategoryPeriodicPerformance(
  organizationId: string,
  request: Omit<ProfitCategoryDetailRequest, 'mode'> & { periodGranularity: ProfitPeriodGranularity }
): Promise<ProfitCategoryPeriodicResponse> {
  const data = await invokeProfitCategoryDetail(organizationId, { ...request, mode: 'periodic' });
  return {
    mode: 'periodic',
    categoryName: String(data.categoryName || request.categoryName || ''),
    groupAccountMasterId: Number(data.groupAccountMasterId ?? request.groupAccountMasterId),
    periodGranularity: (data.periodGranularity as ProfitPeriodGranularity) || request.periodGranularity,
    benchmarkPercent: Number(data.benchmarkPercent ?? request.benchmarkPercent ?? 0),
    summary: (data.summary as ProfitCategoryDetailSummary) ?? {
      expected: 0,
      actual: 0,
      benchmarkPercent: request.benchmarkPercent ?? 0,
      variance: 0,
    },
    periods: (data.periods as ProfitPeriodicPoint[]) ?? [],
  };
}
