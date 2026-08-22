/**
 * useCashflowStatement Hook
 * Fetches transactions to review and cashflow report data
 */

import { useQuery } from '@tanstack/react-query';
import { useOrganization } from './useOrganization';
import {
  getStatementReport,
  getCashflowReport,
  getArchiveCashflowReport,
  StatementReportRequest,
  CashflowReportRequest,
  StatementReportResponse,
} from '@/services/cashflowService';
import { CashflowReportVM } from '@/data/preparingCashflowStatementData';

// ============================================
// HOOK
// ============================================

export function useCashflowStatement(
  fromDate?: string,
  toDate?: string,
  statementReportFilters?: Partial<StatementReportRequest>,
  locationId?: string | null,
  periodGranularity: 'monthly' | 'weekly' = 'monthly',
) {
  const { organizationId } = useOrganization();

  // Default date range: current year
  const currentYear = new Date().getFullYear();
  const defaultFromDate = fromDate || `${currentYear}-01-01`;
  const defaultToDate = toDate || new Date().toISOString().split('T')[0];
  const granularity = periodGranularity === 'weekly' ? 'weekly' : 'monthly';

  // ============================================
  // QUERIES
  // ============================================

  // Fetch transactions to review (with totals for footer)
  const {
    data: statementData,
    isLoading: isLoadingTransactions,
    error: transactionsError,
    refetch: refetchTransactions,
  } = useQuery({
    queryKey: ['cashflow-statement-report', organizationId, defaultFromDate, defaultToDate, statementReportFilters, locationId],
    queryFn: async (): Promise<StatementReportResponse> => {
      if (!organizationId) {
        return { transactions: [], totalMoneyIn: 0, totalMoneyOut: 0, closingBalance: 0 };
      }

      const request: StatementReportRequest = {
        fromDate: defaultFromDate,
        toDate: defaultToDate,
        onlyTransactionWithIssue: false,
        isOriginData: false,
        categoryIds: '',
        transactionTypes: '',
        name: '',
        memoOrDescription: '',
        debitMin: null,
        debitMax: null,
        creditMin: null,
        creditMax: null,
        balanceMin: null,
        balanceMax: null,
        ...statementReportFilters,
        locationId: locationId ?? undefined,
      };

      return getStatementReport(organizationId, request);
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const transactions = statementData?.transactions ?? [];
  const totals = statementData
    ? {
        totalMoneyIn: statementData.totalMoneyIn,
        totalMoneyOut: statementData.totalMoneyOut,
        closingBalance: statementData.closingBalance,
      }
    : { totalMoneyIn: 0, totalMoneyOut: 0, closingBalance: 0 };
  /** Who Paid / For What dropdown options from backend (full dataset), not from filtered result */
  const whoPaidOptions = statementData?.whoPaidOptions ?? [];
  const forWhatOptions = statementData?.forWhatOptions ?? [];
  const transactionTypeOptions = statementData?.transactionTypeOptions ?? [];
  const accountingPlatform = statementData?.accountingPlatform ?? null;

  // Fetch cashflow report
  const {
    data: cashflowReport,
    isLoading: isLoadingReport,
    error: reportError,
    refetch: refetchReport,
  } = useQuery({
    queryKey: ['cashflow-report', organizationId, defaultFromDate, defaultToDate, locationId, granularity],
    queryFn: async (): Promise<CashflowReportVM | null> => {
      if (!organizationId) return null;

      const request: CashflowReportRequest = {
        fromDate: defaultFromDate,
        toDate: defaultToDate,
        locationId: locationId ?? undefined,
        periodGranularity: granularity,
      };

      return getCashflowReport(organizationId, request);
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch archive reports
  const {
    data: archiveReports,
    isLoading: isLoadingArchive,
    error: archiveError,
    refetch: refetchArchive,
  } = useQuery({
    queryKey: ['cashflow-archive-report', organizationId, defaultFromDate, defaultToDate],
    queryFn: async () => {
      if (!organizationId) return [];

      const request: CashflowReportRequest = {
        fromDate: defaultFromDate,
        toDate: defaultToDate,
      };

      return getArchiveCashflowReport(organizationId, request);
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 10, // 10 minutes
  });

  // ============================================
  // RETURN
  // ============================================

  return {
    // Transactions
    transactions: transactions || [],
    totals,
    isLoadingTransactions,
    transactionsError,
    refetchTransactions,
    whoPaidOptions,
    forWhatOptions,
    transactionTypeOptions,
    accountingPlatform,

    // Cashflow Report
    cashflowReport,
    isLoadingReport,
    reportError,
    refetchReport,

    // Archive
    archiveReports: archiveReports || [],
    isLoadingArchive,
    archiveError,
    refetchArchive,

    // Combined loading state
    isLoading: isLoadingTransactions || isLoadingReport || isLoadingArchive,

    // Date range
    fromDate: defaultFromDate,
    toDate: defaultToDate,
  };
}
