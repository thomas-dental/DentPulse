import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useConnectedIntegration } from '@/hooks/useConnectedIntegration';
import { fetchGLEntries, GLEntry } from '@/services/integrations/glEntriesService';
import { syncInvoicesForPlatform } from '@/services/integrations/xeroService';

export interface UseGLEntriesReturn {
  entries: GLEntry[];
  totalAmount: number;
  isLoading: boolean;
  isSyncing: boolean;
  isReady: boolean;
  error: string | null;
  syncMessage: string | null;
  lastSyncedAt: string | null;
  loadFromDatabase: (fromDate?: string, toDate?: string, accountCodes?: string[], accountUuids?: string[]) => Promise<void>;
  syncFromPlatform: (fromDate?: string, toDate?: string, accountCodes?: string[], accountUuids?: string[]) => Promise<void>;
}

export function useGLEntries(): UseGLEntriesReturn {
  const { profile } = useAuth();
  const { connectedPlatform, connectionId, isLoading: isLoadingIntegration } = useConnectedIntegration();
  const [entries, setEntries] = useState<GLEntry[]>([]);
  const [totalAmount, setTotalAmount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastFetchParams, setLastFetchParams] = useState<{
    fromDate?: string;
    toDate?: string;
    accountCodes?: string[];
    accountUuids?: string[];
  }>({});

  const isReady = !!profile?.current_organization_id && !isLoadingIntegration;

  const loadFromDatabase = useCallback(async (
    fromDate?: string,
    toDate?: string,
    accountCodes?: string[],
    accountUuids?: string[]
  ) => {
    if (!profile?.current_organization_id) return;

    setIsLoading(true);
    setError(null);
    setLastFetchParams({ fromDate, toDate, accountCodes, accountUuids });

    try {
      console.log('[useGLEntries] Loading GL entries for org:', profile.current_organization_id);

      const result = await fetchGLEntries(profile.current_organization_id, {
        fromDate,
        toDate,
        accountCodes,
        accountUuids,
      });

      if (!result.success) {
        setError(result.error || 'Failed to load GL entries');
        setEntries([]);
        setTotalAmount(0);
        return;
      }

      setEntries(result.entries);
      setTotalAmount(result.totalAmount);
      setLastSyncedAt(result.lastSyncedAt);

      console.log('[useGLEntries] Loaded', result.entries.length, 'entries, total:', result.totalAmount);
    } catch (err: any) {
      console.error('[useGLEntries] Exception:', err);
      setError(err.message || 'An unexpected error occurred');
      setEntries([]);
      setTotalAmount(0);
    } finally {
      setIsLoading(false);
    }
  }, [profile?.current_organization_id]);

  const syncFromPlatform = useCallback(async (
    fromDate?: string,
    toDate?: string,
    accountCodes?: string[],
    accountUuids?: string[]
  ) => {
    if (!profile?.current_organization_id) return;

    setIsSyncing(true);
    setError(null);
    setSyncMessage(null);

    const syncFromDate = fromDate || lastFetchParams.fromDate;
    const syncToDate = toDate || lastFetchParams.toDate;
    const syncAccountCodes = accountCodes || lastFetchParams.accountCodes;
    const syncAccountUuids = accountUuids || lastFetchParams.accountUuids;

    try {
      console.log('[useGLEntries] Syncing from', connectedPlatform || 'iplicit');

      // Call the iplicit-sync edge function via syncInvoicesForPlatform
      const result = await syncInvoicesForPlatform(
        profile.current_organization_id,
        connectedPlatform || 'iplicit',
        {
          fromDate: syncFromDate,
          toDate: syncToDate,
          connectionId: connectionId || undefined,
          accountCodes: syncAccountCodes,
          accountUuids: syncAccountUuids,
        }
      );

      if (!result.success) {
        console.warn('[useGLEntries] Sync returned error:', result.error);
      }
    } catch (err: any) {
      console.warn('[useGLEntries] Sync exception (will still reload from DB):', err.message);
    }

    // Always reload from DB after sync attempt
    try {
      console.log('[useGLEntries] Reloading GL entries from DB after sync...');

      const dbResult = await fetchGLEntries(profile.current_organization_id, {
        fromDate: syncFromDate,
        toDate: syncToDate,
        accountCodes: syncAccountCodes,
        accountUuids: syncAccountUuids,
      });

      if (dbResult.success) {
        setEntries(dbResult.entries);
        setTotalAmount(dbResult.totalAmount);
        setLastSyncedAt(dbResult.lastSyncedAt || new Date().toISOString());
        setSyncMessage(`Sync completed: ${dbResult.entries.length} GL entries loaded`);
        console.log('[useGLEntries] Loaded', dbResult.entries.length, 'entries after sync');
      } else {
        setError(dbResult.error || 'Failed to load data after sync');
      }
    } catch (err: any) {
      console.error('[useGLEntries] DB reload exception:', err);
      setError(err.message || 'Failed to load data after sync');
    } finally {
      setIsSyncing(false);
    }
  }, [profile?.current_organization_id, connectedPlatform, connectionId, lastFetchParams]);

  return {
    entries,
    totalAmount,
    isLoading,
    isSyncing,
    isReady,
    error,
    syncMessage,
    lastSyncedAt,
    loadFromDatabase,
    syncFromPlatform,
  };
}
