/**
 * SyncStatusIndicator Component
 * Shows sync status in TopBar - click to view detailed sync summary
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function SyncStatusIndicator() {
  const navigate = useNavigate();
  const { activeSyncJobs, isAnySyncRunning } = useSyncStatus();
  const { isModuleEnabled } = useModuleAccess();
  const [showSuccess, setShowSuccess] = useState(false);
  const [wasRunning, setWasRunning] = useState(false);

  // Track when sync transitions from running to completed
  useEffect(() => {
    // If sync is currently running, remember it
    if (isAnySyncRunning) {
      setWasRunning(true);
    }

    // If sync was running but now stopped, show success
    if (wasRunning && !isAnySyncRunning && activeSyncJobs.length === 0) {
      setShowSuccess(true);
      setWasRunning(false); // Reset for next sync

      // Show success toast notification
      toast.success('Sync completed successfully!', {
        description: 'Click the sync indicator to view details.',
        duration: 5000,
      });
    }
  }, [isAnySyncRunning, activeSyncJobs.length, wasRunning]);

  // Auto-hide success message after 15 seconds (longer to give users time to notice)
  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => {
        setShowSuccess(false);
      }, 15000);

      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  // Get display state
  const getDisplayState = () => {
    if (activeSyncJobs.some((job) => job.status === 'failed')) {
      return 'error';
    }
    if (isAnySyncRunning) {
      return 'running';
    }
    if (showSuccess) {
      return 'success';
    }
    return 'idle';
  };

  const displayState = getDisplayState();

  // Navigate to sync summary page
  const handleClick = () => {
    navigate('/sync-summary');
  };

  // Hidden when the Sync Summary module is disabled for this org (SuperAdmin).
  if (!isModuleEnabled('sync_summary')) return null;

  // Always show button - different states
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      className={cn(
        'gap-2 h-9 px-3 transition-all',
        displayState === 'error' && 'text-destructive hover:text-destructive',
        displayState === 'success' && 'text-green-600 hover:text-green-600 animate-pulse',
        displayState === 'idle' && 'text-muted-foreground hover:text-foreground'
      )}
    >
      {displayState === 'running' && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Syncing...</span>
        </>
      )}
      {displayState === 'success' && (
        <>
          <CheckCircle className="h-4 w-4" />
          <span className="text-sm font-medium">Sync Complete - View Summary</span>
        </>
      )}
      {displayState === 'error' && (
        <>
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">Sync Error - View Details</span>
        </>
      )}
      {displayState === 'idle' && (
        <>
          <CheckCircle className="h-4 w-4" />
          <span className="text-sm">Sync Summary</span>
        </>
      )}
    </Button>
  );
}
