import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { fetchStoredInvoices, syncInvoicesForPlatform, OperatingLeaseData } from '@/services/integrations/xeroService';
import { useConnectedIntegration } from '@/hooks/useConnectedIntegration';

export interface SyncResult {
  invoicesSaved: number;
  lineItemsSaved: number;
  errors: string[];
}

export interface UseOperatingLeasesXeroReturn {
  data: OperatingLeaseData | null;
  parsedData: {
    expenses: Array<{ name: string; amount: number; accountCode?: string; section?: string }>;
    totalExpenses: number;
    leaseExpenses: Array<{ name: string; amount: number; accountCode?: string }>;
    totalLeaseExpenses: number;
    allSections: string[];
  } | null;
  isLoading: boolean;
  isSyncing: boolean;
  isReady: boolean;
  error: string | null;
  syncResult: SyncResult | null;
  rawResponse: any;
  lastSyncedAt: string | null;
  connectedPlatform: 'xero' | 'iplicit' | 'quickbooks' | 'sage' | null;
  loadFromDatabase: (fromDate?: string, toDate?: string, invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL', accountCodes?: string[], accountUuids?: string[], selectedLocationId?: string | null) => Promise<void>;
  syncFromPlatform: (fromDate?: string, toDate?: string, invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL', accountCodes?: string[], accountUuids?: string[], selectedLocationId?: string | null) => Promise<void>;
  syncFromXero: (fromDate?: string, toDate?: string, invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL', accountCodes?: string[], accountUuids?: string[], selectedLocationId?: string | null) => Promise<void>;
  // Keep old names for backward compatibility
  fetchData: (fromDate?: string, toDate?: string) => Promise<void>;
  refetch: () => Promise<void>;
  syncInvoices: (invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL') => Promise<void>;
}

// Match DB's lowercase platform_type convention (the sync writes 'xero').
// CostImpact dashboard uses lowercase directly; keeping these consistent
// so the subpage queries actually match rows.
const PLATFORM_TYPE_MAP: Record<string, string> = { xero: 'xero', iplicit: 'iplicit', quickbooks: 'quickbooks', sage: 'sage' };

export function useOperatingLeasesXero(): UseOperatingLeasesXeroReturn {
  const { profile } = useAuth();
  const { connectedPlatform, connectionId, isLoading: isLoadingIntegration } = useConnectedIntegration();
  const [data, setData] = useState<OperatingLeaseData | null>(null);
  const [parsedData, setParsedData] = useState<UseOperatingLeasesXeroReturn['parsedData']>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [rawResponse, setRawResponse] = useState<any>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastFetchParams, setLastFetchParams] = useState<{ fromDate?: string; toDate?: string; invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL'; accountCodes?: string[]; accountUuids?: string[]; selectedLocationId?: string | null }>({});

  const platformType = connectedPlatform ? PLATFORM_TYPE_MAP[connectedPlatform] : 'Xero';

  // Check if profile is ready and integration info has loaded
  const isReady = !!profile?.current_organization_id && !isLoadingIntegration;

  /**
   * Load invoices from database (no Xero API call)
   * This is the default way to load data when visiting the page
   */
  const loadFromDatabase = useCallback(async (fromDate?: string, toDate?: string, invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL', accountCodes?: string[], accountUuids?: string[], selectedLocationId?: string | null) => {
    if (!profile?.current_organization_id) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setLastFetchParams({ fromDate, toDate, invoiceType, accountCodes, accountUuids, selectedLocationId });

    try {
      console.log('[useOperatingLeasesXero] Loading from database for org:', profile.current_organization_id,
        'accountCodes:', accountCodes, 'accountUuids:', accountUuids, 'selectedLocationId:', selectedLocationId);

      const result = await fetchStoredInvoices(
        profile.current_organization_id,
        { fromDate, toDate, invoiceType, platformType, accountCodes, accountUuids, selectedLocationId }
      );

      console.log('[useOperatingLeasesXero] Database result:', result);

      if (!result.success) {
        console.error('[useOperatingLeasesXero] Error:', result.error);
        setError(result.error || 'Failed to load data from database');
        setRawResponse(null);
        return;
      }

      // Set the data in Xero API format for compatibility with existing UI
      const invoicesData = {
        Invoices: result.data?.invoices || [],
      };

      setRawResponse({ invoices: invoicesData });
      setLastSyncedAt(result.data?.lastSyncedAt || null);

      console.log('[useOperatingLeasesXero] Loaded', result.data?.invoices?.length || 0, 'invoices from database');

    } catch (err: any) {
      console.error('[useOperatingLeasesXero] Exception:', err);
      setError(err.message || 'An unexpected error occurred');
      setRawResponse(null);
    } finally {
      setIsLoading(false);
    }
  }, [profile?.current_organization_id, platformType]);

  /**
   * Sync invoices from connected platform and save to database
   * Then ALWAYS reload from database to display the latest data
   */
  const syncFromPlatform = useCallback(async (fromDate?: string, toDate?: string, invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL', accountCodes?: string[], accountUuids?: string[]) => {
    if (!profile?.current_organization_id) {
      return;
    }

    setIsSyncing(true);
    setError(null);
    setSyncResult(null);

    const syncFromDate = fromDate || lastFetchParams.fromDate;
    const syncToDate = toDate || lastFetchParams.toDate;
    const syncInvoiceType = invoiceType || lastFetchParams.invoiceType;
    const syncAccountCodes = accountCodes || lastFetchParams.accountCodes;
    const syncAccountUuids = accountUuids || lastFetchParams.accountUuids;

    try {
      console.log('[useOperatingLeasesXero] Syncing from', connectedPlatform || 'xero', 'for org:', profile.current_organization_id);

      const result = await syncInvoicesForPlatform(
        profile.current_organization_id,
        connectedPlatform || 'xero',
        { fromDate: syncFromDate, toDate: syncToDate, invoiceType: syncInvoiceType, connectionId: connectionId || undefined, accountCodes: syncAccountCodes, accountUuids: syncAccountUuids }
      );

      console.log('[useOperatingLeasesXero] Sync result:', result);

      if (result.success) {
        setSyncResult(result.data?.syncResult || null);
      } else {
        console.warn('[useOperatingLeasesXero] Sync API returned error:', result.error);
        // Don't set error yet — we'll still try to reload from DB below
      }

    } catch (err: any) {
      console.warn('[useOperatingLeasesXero] Sync exception (will still reload from DB):', err.message);
    }

    // ALWAYS reload from database after sync attempt, whether it succeeded or failed.
    // The edge function may have saved data even if the response timed out.
    try {
      console.log('[useOperatingLeasesXero] Reloading data from database after sync...');

      const dbResult = await fetchStoredInvoices(
        profile.current_organization_id,
        { fromDate: syncFromDate, toDate: syncToDate, invoiceType: syncInvoiceType, platformType, accountCodes: syncAccountCodes, accountUuids: syncAccountUuids }
      );

      if (dbResult.success) {
        const invoicesData = {
          Invoices: dbResult.data?.invoices || [],
        };
        setRawResponse({ invoices: invoicesData });
        setLastSyncedAt(dbResult.data?.lastSyncedAt || new Date().toISOString());
        console.log('[useOperatingLeasesXero] Loaded', dbResult.data?.invoices?.length || 0, 'invoices from DB after sync');
      } else {
        console.error('[useOperatingLeasesXero] DB reload error:', dbResult.error);
        setError(dbResult.error || 'Failed to load data after sync');
      }
    } catch (err: any) {
      console.error('[useOperatingLeasesXero] DB reload exception:', err);
      setError(err.message || 'Failed to load data after sync');
    } finally {
      setIsSyncing(false);
    }
  }, [profile?.current_organization_id, connectedPlatform, connectionId, lastFetchParams, platformType]);

  // Backward-compatible alias
  const syncFromXero = syncFromPlatform;

  // Legacy function - now loads from database
  const fetchData = useCallback(async (fromDate?: string, toDate?: string) => {
    await loadFromDatabase(fromDate, toDate);
  }, [loadFromDatabase]);

  // Legacy function - refetch from database
  const refetch = useCallback(async () => {
    await loadFromDatabase(lastFetchParams.fromDate, lastFetchParams.toDate, lastFetchParams.invoiceType, lastFetchParams.accountCodes, lastFetchParams.accountUuids);
  }, [loadFromDatabase, lastFetchParams]);

  // Legacy function - now syncs from connected platform
  const syncInvoices = useCallback(async (invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL') => {
    await syncFromPlatform(lastFetchParams.fromDate, lastFetchParams.toDate, invoiceType, lastFetchParams.accountCodes, lastFetchParams.accountUuids);
  }, [syncFromPlatform, lastFetchParams]);

  return {
    data,
    parsedData,
    isLoading,
    isSyncing,
    isReady,
    error,
    syncResult,
    rawResponse,
    lastSyncedAt,
    connectedPlatform,
    loadFromDatabase,
    syncFromPlatform,
    syncFromXero,
    fetchData,
    refetch,
    syncInvoices,
  };
}
