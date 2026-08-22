/**
 * Utility to manually trigger/resume sync jobs via Node backend
 * Run this in browser console to resume stuck jobs
 */

import { SyncJobService } from '@/services/integrations/syncJobService';

export async function triggerSyncJob(organizationId: string) {
  try {
    console.log('Resuming sync jobs for org:', organizationId);

    const result = await SyncJobService.triggerQueuedJobs(organizationId);

    if (result.triggered > 0) {
      console.log(`Resumed ${result.triggered} sync jobs`);
    } else {
      console.log('No queued jobs to resume');
    }

    return { success: result.success, resumed: result.triggered };
  } catch (error) {
    console.error('Error triggering sync:', error);
    return { success: false, error: String(error) };
  }
}

// Make it available globally for console access
if (typeof window !== 'undefined') {
  (window as any).triggerSyncJob = triggerSyncJob;
}
