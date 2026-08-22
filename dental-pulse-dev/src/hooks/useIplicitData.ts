import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface IplicitInvoice {
  id: string;
  connection_id: string;
  external_id: string;
  invoice_number: string | null;
  customer_name: string | null;
  amount: number;
  currency: string;
  status: string | null;
  issue_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  synced_at: string;
}

export interface IplicitTransaction {
  id: string;
  connection_id: string;
  external_id: string;
  transaction_type: string | null;
  description: string | null;
  amount: number;
  currency: string;
  account_code: string | null;
  account_name: string | null;
  transaction_date: string | null;
  reference: string | null;
  synced_at: string;
}

export interface IplicitAccountBalance {
  id: string;
  connection_id: string;
  account_code: string;
  account_name: string | null;
  account_type: string | null;
  balance: number;
  currency: string;
  as_of_date: string | null;
  synced_at: string;
}

export interface IplicitSyncLog {
  id: string;
  connection_id: string;
  sync_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  records_synced: number;
  error_message: string | null;
  retry_count: number;
}

export interface IplicitDataSummary {
  totalInvoices: number;
  totalInvoiceValue: number;
  unpaidInvoices: number;
  unpaidValue: number;
  overdueInvoices: number;
  totalTransactions: number;
  totalAccounts: number;
  totalAssets: number;
  totalLiabilities: number;
  lastSync: string | null;
}

export function useIplicitData(organizationId?: string) {
  const [invoices, setInvoices] = useState<IplicitInvoice[]>([]);
  const [transactions, setTransactions] = useState<IplicitTransaction[]>([]);
  const [accountBalances, setAccountBalances] = useState<IplicitAccountBalance[]>([]);
  const [syncLogs, setSyncLogs] = useState<IplicitSyncLog[]>([]);
  const [summary, setSummary] = useState<IplicitDataSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { session } = useAuth();

  const fetchData = useCallback(async () => {
    if (!organizationId || !session) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch all data in parallel
      const [invoicesRes, transactionsRes, accountsRes, logsRes] = await Promise.all([
        supabase
          .from('iplicit_sales_invoices')
          .select('*, issue_date:invoice_date')
          .eq('organization_id', organizationId)
          .order('invoice_date', { ascending: false })
          .limit(100),
        supabase
          .from('iplicit_transactions')
          .select('*')
          .eq('organization_id', organizationId)
          .order('transaction_date', { ascending: false })
          .limit(100),
        supabase
          .from('iplicit_account_balances')
          .select('*')
          .eq('organization_id', organizationId)
          .order('account_name', { ascending: true }),
        supabase
          .from('iplicit_sync_logs')
          .select('*')
          .eq('organization_id', organizationId)
          .order('started_at', { ascending: false })
          .limit(20),
      ]);

      if (invoicesRes.error) throw invoicesRes.error;
      if (transactionsRes.error) throw transactionsRes.error;
      if (accountsRes.error) throw accountsRes.error;
      if (logsRes.error) throw logsRes.error;

      const invoiceData = (invoicesRes.data || []) as unknown as IplicitInvoice[];
      const transactionData = (transactionsRes.data || []) as unknown as IplicitTransaction[];
      const accountData = (accountsRes.data || []) as unknown as IplicitAccountBalance[];
      const logData = (logsRes.data || []) as unknown as IplicitSyncLog[];

      setInvoices(invoiceData);
      setTransactions(transactionData);
      setAccountBalances(accountData);
      setSyncLogs(logData);

      // Calculate summary
      const today = new Date();
      const unpaidInvoices = invoiceData.filter(inv => 
        inv.status !== 'paid' && inv.status !== 'Paid'
      );
      const overdueInvoices = invoiceData.filter(inv => {
        if (!inv.due_date || inv.status === 'paid' || inv.status === 'Paid') return false;
        return new Date(inv.due_date) < today;
      });

      const totalAssets = accountData
        .filter(acc => acc.account_type?.toLowerCase().includes('asset'))
        .reduce((sum, acc) => sum + Number(acc.balance), 0);
      
      const totalLiabilities = accountData
        .filter(acc => acc.account_type?.toLowerCase().includes('liability'))
        .reduce((sum, acc) => sum + Math.abs(Number(acc.balance)), 0);

      const lastLog = logData.find(log => log.status === 'completed');

      setSummary({
        totalInvoices: invoiceData.length,
        totalInvoiceValue: invoiceData.reduce((sum, inv) => sum + Number(inv.amount), 0),
        unpaidInvoices: unpaidInvoices.length,
        unpaidValue: unpaidInvoices.reduce((sum, inv) => sum + Number(inv.amount), 0),
        overdueInvoices: overdueInvoices.length,
        totalTransactions: transactionData.length,
        totalAccounts: accountData.length,
        totalAssets,
        totalLiabilities,
        lastSync: lastLog?.completed_at || null,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch iplicit data';
      setError(message);
      console.error('Error fetching iplicit data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, session]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    invoices,
    transactions,
    accountBalances,
    syncLogs,
    summary,
    isLoading,
    error,
    refetch: fetchData,
  };
}
