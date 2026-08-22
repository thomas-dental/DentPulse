/**
 * Cashflow Service
 * Uses in-project Supabase Edge Functions for all cashflow data.
 * Edge functions: cashflow-statement-report, cashflow-report, cashflow-archive-report
 *
 * If you see "Failed to send a request to the Edge Function":
 * 1. Deploy the functions: supabase functions deploy cashflow-statement-report cashflow-report cashflow-archive-report
 * 2. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY point to your Supabase project.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { TransactionToReview, CashflowReportVM } from '@/data/preparingCashflowStatementData';
import type { AccountingPlatform } from '@/utils/accountingTransactionLinks';

const EDGE_FUNCTION_REQUEST_FAILED =
  'Failed to send a request to the Edge Function';

function isEdgeFunctionRequestFailed(msg: string): boolean {
  return msg?.includes('Edge Function') && msg?.toLowerCase().includes('failed to send');
}

/** Supabase FunctionsFetchError: browser could not complete HTTP to /functions/v1/… (not a 4xx/5xx from your handler). */
function supabaseFunctionsEndpoint(functionName: string): string | null {
  try {
    const base = import.meta.env.VITE_SUPABASE_URL?.trim();
    if (!base) return null;
    const host = new URL(base).host;
    return `${host}/functions/v1/${functionName}`;
  } catch {
    return null;
  }
}

function assertSupabaseEnvForEdgeFunctions(): void {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Set both in .env (same Supabase project you deploy functions to), restart the dev server, then retry.'
    );
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid VITE_SUPABASE_URL: "${url}"`);
  }
}

function wrapEdgeFunctionError(error: Error, functionName: string): Error {
  const message = error?.message ?? '';
  if (isEdgeFunctionRequestFailed(message)) {
    const target = supabaseFunctionsEndpoint(functionName);
    const where = target ? `Could not reach https://${target}. ` : '';
    return new Error(
      `${message} ${where}` +
        `Deploy functions to this same project (e.g. supabase link && supabase functions deploy ${functionName}). ` +
        `If already deployed: confirm Dashboard → Edge Functions lists "${functionName}", match VITE_SUPABASE_URL to that project, restart Vite after .env changes, and inspect Network for blocked/failed calls to /functions/v1/.`
    );
  }
  return error;
}

/** When the Edge Function returns 5xx, Supabase throws FunctionsHttpError and does not populate `data`; read JSON body from the response. */
async function messageFromFunctionsHttpError(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  const res = error.context as Response | undefined;
  if (!res?.clone) return null;
  try {
    const body = (await res.clone().json()) as { error?: string; resultMsg?: string };
    const parts = [body?.resultMsg, body?.error].filter((s) => typeof s === 'string' && s.trim() !== '');
    return parts.length > 0 ? parts.join(' — ') : null;
  } catch {
    return null;
  }
}

async function throwInvokeError(error: unknown, functionName: string): Promise<never> {
  if (error instanceof Error && isEdgeFunctionRequestFailed(error.message)) {
    throw wrapEdgeFunctionError(error, functionName);
  }
  const fromBody = await messageFromFunctionsHttpError(error);
  if (fromBody) {
    throw new Error(`${functionName}: ${fromBody}`);
  }
  if (error instanceof Error) {
    throw wrapEdgeFunctionError(error, functionName);
  }
  throw new Error(`${functionName}: ${String(error)}`);
}

// ============================================
// TYPES
// ============================================

export interface StatementReportRequest {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  onlyTransactionWithIssue?: boolean;
  isOriginData?: boolean;
  categoryIds?: string;
  transactionTypes?: string;
  name?: string;
  memoOrDescription?: string;
  /** Comma-separated "Who Paid" (location) values for multi-select filter */
  whoPaid?: string | null;
  /** Comma-separated "For What" (split) values for multi-select filter */
  forWhat?: string | null;
  debitMin?: number | null;
  debitMax?: number | null;
  creditMin?: number | null;
  creditMax?: number | null;
  balanceMin?: number | null;
  balanceMax?: number | null;
  locationId?: string | null;
}

export interface CashflowReportRequest {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  locationId?: string | null;
  /** monthly (default) or weekly columns on the cash flow statement */
  periodGranularity?: 'monthly' | 'weekly';
}

export interface CashflowCategoryDrilldownRequest {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  /** cashflow-report range_group */
  rangeGroup: string;
  /** cashflow-report range_sub_group (Income | Payment) */
  rangeSubGroup: string;
  /** cashflow-report category_range_master.name */
  categoryName: string;
  /** cashflow-report row.id (acct_id or acct_code) */
  locationId: string;
  /** cashflow-report columns key: YYYY-MM (monthly) or week-start YYYY-MM-DD (weekly) */
  monthKey: string;
  /** Practice location from top-bar filter (for per-location maps / Xero tenant). */
  practiceLocationId?: string | null;
}

export interface CashflowCategoryDrilldownTransaction {
  date: string;
  docId: string;
  docClass: string;
  description: string;
  accountId?: string;
  accountCode?: string;
  accountName?: string;
  amountRaw: number;
  amountDisplay: number;
  isInternalTransfer: boolean;
  /** Pro-parity columns */
  transactionType?: string;
  transactionLink?: string;
  name?: string;
  memoOrDescription?: string;
  whoPaid?: string;
  forWhat?: string;
  moneyIn?: number;
  moneyOut?: number;
}

export interface ApiResponse<T> {
  returnObject: T | null;
  transactionStatus: number; // 8 = Success, 0 = NoData
  resultMsg: string;
}

export interface StatementReportResponse {
  transactions: TransactionToReview[];
  totalMoneyIn: number;
  totalMoneyOut: number;
  closingBalance: number;
  /** Distinct Who Paid (location) options from backend for multi-select dropdown */
  whoPaidOptions?: string[];
  /** Distinct For What (split) options from backend for multi-select dropdown */
  forWhatOptions?: string[];
  /** Distinct transaction types for filter multi-select */
  transactionTypeOptions?: string[];
  /** Accounting platform used for the statement rows (drives deep link styling) */
  accountingPlatform?: AccountingPlatform | null;
}

// ============================================
// API CALLS (Supabase Edge Functions)
// ============================================

/**
 * Get transactions to review (Statement Report)
 * Edge function: cashflow-statement-report
 * Returns transactions plus totals for footer (totalMoneyIn, totalMoneyOut, closingBalance)
 */
export async function getStatementReport(
  organizationId: string,
  request: StatementReportRequest
): Promise<StatementReportResponse> {
  assertSupabaseEnvForEdgeFunctions();
  const traceId = `cfs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log('[cashflow][statement][request]', {
    traceId,
    organizationId,
    request,
  });

  const { data, error } = await supabase.functions.invoke('cashflow-statement-report', {
    body: { organizationId, ...request },
  });

  if (error) {
    await throwInvokeError(error, 'cashflow-statement-report');
  }

  if (data?.transactionStatus === 8) {
    console.log('[cashflow][statement][response]', {
      traceId,
      transactionStatus: data.transactionStatus,
      resultMsg: data.resultMsg,
      transactionsCount: Array.isArray(data.returnObject) ? data.returnObject.length : 0,
      totalMoneyIn: data.totalMoneyIn ?? 0,
      totalMoneyOut: data.totalMoneyOut ?? 0,
      closingBalance: data.closingBalance ?? 0,
    });

    const platform = data.accountingPlatform;
    const accountingPlatform =
      platform === 'xero' || platform === 'quickbooks' || platform === 'iplicit' ? platform : null;

    return {
      transactions: data.returnObject ?? [],
      totalMoneyIn: data.totalMoneyIn ?? 0,
      totalMoneyOut: data.totalMoneyOut ?? 0,
      closingBalance: data.closingBalance ?? 0,
      whoPaidOptions: Array.isArray(data.whoPaidOptions) ? data.whoPaidOptions : [],
      forWhatOptions: Array.isArray(data.forWhatOptions) ? data.forWhatOptions : [],
      transactionTypeOptions: Array.isArray(data.transactionTypeOptions) ? data.transactionTypeOptions : [],
      accountingPlatform,
    };
  }

  console.log('[cashflow][statement][non-success]', {
    traceId,
    transactionStatus: data?.transactionStatus,
    resultMsg: data?.resultMsg,
    error: (data as { error?: string })?.error,
  });

  const detail = [data?.resultMsg, (data as { error?: string })?.error]
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .join(' — ');
  throw new Error(detail || 'Failed to fetch transactions');
}

/**
 * Get cashflow report (statement by month)
 * Edge function: cashflow-report
 */
export async function getCashflowReport(
  organizationId: string,
  request: CashflowReportRequest
): Promise<CashflowReportVM | null> {
  assertSupabaseEnvForEdgeFunctions();
  const { data, error } = await supabase.functions.invoke('cashflow-report', {
    body: { organizationId, ...request },
  });

  if (error) {
    await throwInvokeError(error, 'cashflow-report');
  }

  if (data?.transactionStatus === 8 || data?.transactionStatus === 0) {
    return data?.returnObject ?? null;
  }

  throw new Error(data?.resultMsg || 'Failed to fetch cashflow report');
}

/**
 * Get archive cashflow reports
 * Edge function: cashflow-archive-report
 */
export async function getArchiveCashflowReport(
  organizationId: string,
  request: CashflowReportRequest
): Promise<any[]> {
  assertSupabaseEnvForEdgeFunctions();
  const { data, error } = await supabase.functions.invoke('cashflow-archive-report', {
    body: { organizationId, ...request },
  });

  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Archive is secondary for this page; if function is temporarily unreachable
    // (network / auth bootstrap race), keep page usable and show empty archive list.
    if (isEdgeFunctionRequestFailed(msg)) {
      console.warn('[cashflow][archive] edge function unreachable, returning empty archive list');
      return [];
    }
    await throwInvokeError(error, 'cashflow-archive-report');
  }

  return data?.returnObject ?? [];
}

/**
 * Archive cashflow report for the given date range.
 * Edge function: cashflow-archive-report (ArchiveCashflowReport backend endpoint)
 *
 * DownloadFormat matches Version 2.0 semantics:
 * 1 = Excel, 2 = PDF, etc. (we default to 1 for Excel-style archive).
 */
export async function archiveCashflowReport(
  organizationId: string,
  request: CashflowReportRequest,
  downloadFormat: number = 1
): Promise<number> {
  assertSupabaseEnvForEdgeFunctions();
  const { data, error } = await supabase.functions.invoke('cashflow-archive-report', {
    body: { organizationId, ...request, archive: true, downloadFormat },
  });

  if (error) {
    await throwInvokeError(error, 'cashflow-archive-report');
  }

  if (data?.transactionStatus === 8) {
    // Backend returns archive id as ReturnObject
    return data?.returnObject ?? 0;
  }

  throw new Error(data?.resultMsg || 'Failed to archive cashflow report');
}

/**
 * Get a single archived cashflow report by archive id.
 * Edge function: cashflow-archive-report (archiveId path)
 */
export async function getArchivedCashflowReportById(
  organizationId: string,
  archiveId: number
): Promise<CashflowReportVM | null> {
  assertSupabaseEnvForEdgeFunctions();
  const { data, error } = await supabase.functions.invoke('cashflow-archive-report', {
    body: { organizationId, archiveId },
  });

  if (error) {
    await throwInvokeError(error, 'cashflow-archive-report');
  }

  if (data?.transactionStatus === 8 || data?.transactionStatus === 0) {
    return data?.returnObject ?? null;
  }

  throw new Error(data?.resultMsg || 'Failed to fetch archived cashflow report');
}

/**
 * Drill-down for a clicked category/month cell.
 * Edge function: cashflow-category-drilldown-report
 */
export async function getCashflowCategoryDrilldown(
  organizationId: string,
  request: CashflowCategoryDrilldownRequest
): Promise<CashflowCategoryDrilldownTransaction[]> {
  assertSupabaseEnvForEdgeFunctions();
  const { data, error } = await supabase.functions.invoke("cashflow-category-drilldown-report", {
    body: { organizationId, ...request },
  });

  if (error) {
    await throwInvokeError(error, "cashflow-category-drilldown-report");
  }

  if (data?.transactionStatus === 8 || data?.transactionStatus === 0) {
    return data?.returnObject ?? [];
  }

  throw new Error(data?.resultMsg || "Failed to fetch category drilldown");
}
