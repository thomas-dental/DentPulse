/**
 * useSyncStatus Hook
 * Subscribes to sync_jobs changes via Supabase Realtime
 * Provides real-time sync job status updates
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { SyncJob } from '@/types/syncJob';

export function useSyncStatus() {
  const { organizationId } = useOrganization();
  const [activeSyncJobs, setActiveSyncJobs] = useState<SyncJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) {
      setActiveSyncJobs([]);
      setIsLoading(false);
      return;
    }

    // Fetch initial active sync jobs
    const fetchActiveSyncJobs = async () => {
      try {
        const { data, error } = await supabase
          .from('sync_jobs')
          .select('*')
          .eq('organization_id', organizationId)
          .in('status', ['queued', 'running'])
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Failed to fetch active sync jobs:', error);
          setActiveSyncJobs([]);
        } else {
          setActiveSyncJobs(data as SyncJob[]);
        }
      } catch (error) {
        console.error('Error fetching active sync jobs:', error);
        setActiveSyncJobs([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchActiveSyncJobs();

    // Poll every 5 seconds to ensure status stays in sync (fallback for realtime)
    const pollInterval = setInterval(() => {
      fetchActiveSyncJobs();
    }, 5000);

    // Subscribe to sync_jobs changes via Realtime
    const channel = supabase
      .channel('sync_jobs_changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'sync_jobs',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          console.log('Sync job change:', payload);

          if (payload.eventType === 'INSERT') {
            const newJob = payload.new as SyncJob;
            if (newJob.status === 'queued' || newJob.status === 'running') {
              setActiveSyncJobs((prev) => [newJob, ...prev]);
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedJob = payload.new as SyncJob;

            setActiveSyncJobs((prev) => {
              // If job is completed, failed, or cancelled, remove it from active jobs
              if (
                updatedJob.status === 'completed' ||
                updatedJob.status === 'failed' ||
                updatedJob.status === 'cancelled'
              ) {
                return prev.filter((job) => job.id !== updatedJob.id);
              }

              // Update existing job
              const jobIndex = prev.findIndex((job) => job.id === updatedJob.id);
              if (jobIndex !== -1) {
                const updated = [...prev];
                updated[jobIndex] = updatedJob;
                return updated;
              }

              // Add new active job
              if (updatedJob.status === 'queued' || updatedJob.status === 'running') {
                return [updatedJob, ...prev];
              }

              return prev;
            });
          } else if (payload.eventType === 'DELETE') {
            const deletedJob = payload.old as SyncJob;
            setActiveSyncJobs((prev) => prev.filter((job) => job.id !== deletedJob.id));
          }
        }
      )
      .subscribe();

    // Cleanup subscription and polling on unmount
    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [organizationId]);

  // Compute derived values
  const isAnySyncRunning = activeSyncJobs.some((job) => job.status === 'running');
  const hasQueuedJobs = activeSyncJobs.some((job) => job.status === 'queued');

  // Get overall progress (average of all running jobs)
  const overallProgress = activeSyncJobs.length > 0
    ? Math.round(
        activeSyncJobs.reduce((sum, job) => sum + job.progress_percentage, 0) /
          activeSyncJobs.length
      )
    : 0;

  return {
    activeSyncJobs,
    isAnySyncRunning,
    hasQueuedJobs,
    overallProgress,
    isLoading,
  };
}
