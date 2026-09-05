/**
 * Hook to automatically resume queued sync jobs via Node backend.
 * On mount:
 *   1. Tries to resume existing queued jobs
 *   2. If zero jobs were resumed AND the Dentally integration has an API key,
 *      automatically triggers a full sync (handles the case where onboarding
 *      failed to create jobs due to backend being unreachable)
 */

import { useEffect, useRef } from 'react';
import { useOrganization } from './useOrganization';
import { SyncJobService } from '@/services/integrations/syncJobService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useAutoTriggerSync() {
  const { organizationId, isLoading } = useOrganization();
  const hasResumedRef = useRef(false);
  const isResuming = useRef(false);

  useEffect(() => {
    if (isLoading || !organizationId) {
      return;
    }

    const resumeOrTriggerSync = async () => {
      if (isResuming.current) return;
      isResuming.current = true;

      try {
        // Step 1: Try resuming existing queued jobs
        console.log('[AutoTriggerSync] Resuming queued jobs via Node backend...');
        const result = await SyncJobService.triggerQueuedJobs(organizationId);

        if (!result.success) {
          console.warn('[AutoTriggerSync] Backend unavailable or returned error, sync will retry later');
          hasResumedRef.current = true;
          return;
        }

        if (result.triggered > 0) {
          console.log(`[AutoTriggerSync] Resumed ${result.triggered} sync jobs`);
          if (!hasResumedRef.current) {
            toast.success(
              `Started syncing ${result.triggered} data source${result.triggered > 1 ? 's' : ''} in the background.`,
              { duration: 3000 }
            );
          }
          hasResumedRef.current = true;
          return;
        }

        // Step 2: Zero jobs resumed — check if there are ANY existing sync jobs
        // If there are completed/cancelled/failed jobs, this is an existing account (don't auto-trigger)
        // If there are truly zero jobs AND integration has api_key, this is likely a fresh account
        // where onboarding failed to create jobs
        if (!hasResumedRef.current) {
          const existingJobs = await SyncJobService.getSyncJobs(organizationId, 1);

          if (existingJobs.length > 0) {
            // Jobs exist (completed/failed/etc.) — don't auto-trigger
            console.log('[AutoTriggerSync] Existing jobs found, skipping auto-trigger');
            hasResumedRef.current = true;
            return;
          }

          // Zero jobs at all — check if any Dentally integration has API key
          const { data: integrationRows } = await supabase
            .from('integrations')
            .select('id, pat_hint')
            .eq('organization_id', organizationId)
            .eq('integration_name', 'Dentally')
            .not('pat_hint', 'is', null);

          if (integrationRows && integrationRows.length > 0) {
            console.log(`[AutoTriggerSync] Fresh account with ${integrationRows.length} Dentally integration(s) — auto-triggering full sync`);
            let totalJobs = 0;
            for (const integration of integrationRows) {
              const syncResult = await SyncJobService.forceFullSync(organizationId, integration.id);
              if (syncResult.success) {
                totalJobs += syncResult.jobIds.length;
              } else {
                console.warn(`[AutoTriggerSync] Auto-trigger failed for integration ${integration.id}:`, syncResult.errors);
              }
            }
            if (totalJobs > 0) {
              toast.success(
                `Auto-started sync: ${totalJobs} jobs created.`,
                { duration: 4000 }
              );
            }
          }
        }

        hasResumedRef.current = true;
      } catch (error) {
        console.warn('[AutoTriggerSync] Error resuming jobs (will retry later):', error);
      } finally {
        isResuming.current = false;
      }
    };

    // Resume/trigger queued jobs after a short delay on mount
    const timeoutId = setTimeout(() => {
      resumeOrTriggerSync();
    }, 2000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [organizationId, isLoading]);
}
