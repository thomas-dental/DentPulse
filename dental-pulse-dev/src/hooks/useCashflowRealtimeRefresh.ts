/**
 * useCashflowRealtimeRefresh
 *
 * Live-refreshes the 13-week cash flow forecast when fresh actuals land.
 *
 * Incoming Xero / Dentally / Denplan actuals are written to Supabase by the Node
 * sync backend, which records every run in `sync_jobs`. When a job flips to
 * `completed`, the new actuals are in the DB — so we invalidate every cashflow
 * query. The forecast table, the Variance view and the graph all read the SAME
 * `useCashflowForecast` queries, so a single invalidation re-renders all three
 * with the updated numbers (and the variance £/% recompute automatically).
 *
 * Uses its own uniquely-named Realtime channel (so it never collides with the
 * global `sync_jobs_changes` channel in useSyncStatus). React Query's staleTime +
 * refetch-on-focus remain the fallback if a realtime event is ever dropped.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

export function useCashflowRealtimeRefresh() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  useEffect(() => {
    if (!organizationId) return;

    const refresh = () =>
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === 'string' && (k.startsWith('cashflow-') || k.startsWith('bills-to-pay'));
        },
      });

    const channel = supabase
      .channel(`cashflow-actuals-refresh-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_jobs',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          // A sync finishing means new Xero/Dentally/Denplan actuals just landed.
          const status = (payload.new as { status?: string } | null)?.status;
          if (status === 'completed') refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient]);
}
