/**
 * useCashflowRealtimeRefresh
 *
 * Live-refreshes the 13-week cash flow forecast when sync finishes.
 * Polls backend active sync status; when jobs go from active → idle, invalidates
 * cashflow queries so new actuals are picked up (no direct Supabase sync_jobs).
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrganization } from './useOrganization';
import { SyncJobService } from '@/services/integrations/syncJobService';

const POLL_MS = 5000;

export function useCashflowRealtimeRefresh() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;

    const refresh = () =>
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === 'string' && (k.startsWith('cashflow-') || k.startsWith('bills-to-pay'));
        },
      });

    const tick = async () => {
      try {
        const jobs = await SyncJobService.getActiveSyncJobs(organizationId);
        if (cancelled) return;
        const active = jobs.length > 0;
        if (wasActiveRef.current && !active) {
          refresh();
        }
        wasActiveRef.current = active;
      } catch (err) {
        console.warn('[useCashflowRealtimeRefresh] active sync poll failed:', err);
      }
    };

    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [organizationId, queryClient]);
}
