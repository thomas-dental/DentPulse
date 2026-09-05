/**
 * useSyncStatus Hook
 * Polls Node backend for active sync_jobs (queued | running).
 * Sync work stays on the backend; this only notifies the UI of status changes.
 */

import { useState, useEffect, useRef } from 'react';
import { useOrganization } from './useOrganization';
import { SyncJobService, type SyncJob } from '@/services/integrations/syncJobService';

const POLL_MS = 5000;

export function useSyncStatus() {
  const { organizationId } = useOrganization();
  const [activeSyncJobs, setActiveSyncJobs] = useState<SyncJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hadActiveRef = useRef(false);

  useEffect(() => {
    if (!organizationId) {
      setActiveSyncJobs([]);
      setIsLoading(false);
      hadActiveRef.current = false;
      return;
    }

    let cancelled = false;

    const fetchActiveSyncJobs = async () => {
      try {
        const jobs = await SyncJobService.getActiveSyncJobs(organizationId);
        if (cancelled) return;
        setActiveSyncJobs(jobs);
        hadActiveRef.current = jobs.length > 0;
      } catch (error) {
        console.error('Error fetching active sync jobs:', error);
        if (!cancelled) setActiveSyncJobs([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    setIsLoading(true);
    fetchActiveSyncJobs();
    const pollInterval = setInterval(fetchActiveSyncJobs, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
    };
  }, [organizationId]);

  const isAnySyncRunning = activeSyncJobs.some((job) => job.status === 'running');
  const hasQueuedJobs = activeSyncJobs.some((job) => job.status === 'queued');

  const overallProgress =
    activeSyncJobs.length > 0
      ? Math.round(
          activeSyncJobs.reduce((sum, job) => sum + (job.progress_percentage || 0), 0) /
            activeSyncJobs.length,
        )
      : 0;

  return {
    activeSyncJobs,
    isLoading,
    isAnySyncRunning,
    hasQueuedJobs,
    overallProgress,
    /** True if this session previously saw active jobs (for “just finished” UI). */
    hadActiveJobs: hadActiveRef.current,
  };
}
