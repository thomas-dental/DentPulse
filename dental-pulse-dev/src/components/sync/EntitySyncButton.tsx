/**
 * Entity Sync Button Component
 * Shows last sync time and allows manual sync for a specific entity
 */

import { useState, useEffect } from 'react';
import { RefreshCw, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuth } from '@/hooks/useAuth';
import { SyncJobService } from '@/services/integrations/syncJobService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatDistanceToNow, startOfMonth, endOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

interface EntitySyncButtonProps {
  entityAlias: string;
  entityLabel: string;
  className?: string;
  additionalEntities?: Array<{ alias: string; label: string }>; // Optional: sync additional entities together
}

export function EntitySyncButton({ entityAlias, entityLabel, className, additionalEntities = [] }: EntitySyncButtonProps) {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [lastSyncJob, setLastSyncJob] = useState<any>(null);

  // Fetch last sync time for this entity
  const fetchLastSyncTime = async () => {
    if (!organizationId) return;

    try {
      const { data, error } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('entity_alias', entityAlias)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setLastSyncTime(data.completed_at);
        setLastSyncJob(data);
      }
    } catch (error) {
      console.error('Error fetching last sync time:', error);
    }
  };

  useEffect(() => {
    fetchLastSyncTime();

    // Poll every 10 seconds to update last sync time
    const interval = setInterval(fetchLastSyncTime, 10000);
    return () => clearInterval(interval);
  }, [organizationId, entityAlias]);

  // Helper function to get last sync job for an entity
  const getLastSyncJob = async (alias: string) => {
    try {
      const { data, error } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('entity_alias', alias)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        return data;
      }
    } catch (error) {
      console.error(`Error fetching last sync time for ${alias}:`, error);
    }
    return null;
  };

  // Handle manual sync
  const handleSync = async () => {
    if (!organizationId || !user) {
      toast.error('Unable to sync', {
        description: 'Organization or user not found',
      });
      return;
    }

    setIsSyncing(true);

    try {
      // Get ALL connected Dentally integrations
      const { data: integrationRows, error: integrationError } = await supabase
        .from('integrations')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('integration_name', 'Dentally')
        .eq('is_connected', true)
        .is('deleted_at', null);

      if (integrationError || !integrationRows || integrationRows.length === 0) {
        throw new Error('Dentally integration not found');
      }

      // Build list of all entities to sync (main + additional)
      const entitiesToSync = [
        { alias: entityAlias, label: entityLabel },
        ...additionalEntities,
      ];

      const endDate = new Date().toISOString();
      const results: string[] = [];
      const errors: string[] = [];

      // Sync each entity for ALL integrations
      for (const integrationData of integrationRows) {
        for (const entity of entitiesToSync) {
          // Get last sync job for this entity
          const lastSync = await getLastSyncJob(entity.alias);

          // Calculate date range
          // For practitioners, sync all records (use very old date)
          let startDate: string;
          if (entity.alias === 'practitioners') {
            // Sync all practitioners from the beginning
            startDate = new Date('2000-01-01').toISOString();
            console.log(`[EntitySync] ${entity.label}: Syncing all practitioners from beginning (integration ${integrationData.id.slice(0, 8)})`);
          } else if (lastSync && lastSync.completed_at) {
            // Start from when the last sync actually completed (incremental sync)
            startDate = lastSync.completed_at;
            console.log(`[EntitySync] ${entity.label}: Incremental sync from last sync completed_at: ${startDate}`);
          } else {
            // Fallback to last 15 days if no previous sync found
            const startDateObj = new Date();
            startDateObj.setDate(startDateObj.getDate() - 15);
            startDate = startDateObj.toISOString();
            console.log(`[EntitySync] ${entity.label}: No previous sync found, syncing last 15 days from: ${startDate}`);
          }

          // Trigger sync for this entity — force=true bypasses deduplication so
          // already-completed non-date entities (e.g. practitioners) are re-synced.
          const result = await SyncJobService.syncEntity(
            organizationId,
            integrationData.id,
            entity.alias,
            startDate,
            endDate,
            user.id,
            undefined, // startPage
            true       // force
          );

          if (result.success) {
            results.push(entity.label);
          } else {
            errors.push(`${entity.label}: ${result.error || 'Unknown error'}`);
          }

          // For appointments: also do a full current-month sync using start_time filter.
          if (entity.alias === 'appointments') {
            const today = new Date();
            const currentMonthStart = startOfMonth(today).toISOString();
            const currentMonthEnd = endOfMonth(today).toISOString();
            const currentMonthResult = await SyncJobService.syncEntity(
              organizationId,
              integrationData.id,
              'appointments_current_month',
              currentMonthStart,
              currentMonthEnd,
              user.id,
              undefined,
              true
            );
            if (!currentMonthResult.success) {
              errors.push(`Appointments (current month): ${currentMonthResult.error || 'Unknown error'}`);
            }
          }
        }
      }

      // Show results
      if (errors.length > 0) {
        toast.error('Some syncs failed', {
          description: errors.join(', '),
        });
      } else {
        const entityNames = results.join(' & ');
        toast.success(`${entityNames} sync started!`, {
          description: 'Syncing updated records in the background',
        });

        // Poll every 3s until ALL synced entities have a completed job newer than triggeredAt (max 90s)
        // We watch appointments (not practitioners) because appointments/treatment_plan_items
        // drive Net Production and Working Hours — practitioners finishes first and is not enough.
        const triggeredAt = new Date().toISOString();
        const allAliases = [
          entityAlias,
          ...additionalEntities.map(e => e.alias),
        ].filter(a => a !== 'practitioners'); // practitioners finishes near-instantly; skip it
        // If only practitioners was synced (no additionalEntities), fall back to watching it
        const aliasesToWatch = allAliases.length > 0 ? allAliases : [entityAlias];

        const maxAttempts = 30;
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            // Check each alias — all must have a completed_at >= triggeredAt
            const checks = await Promise.all(
              aliasesToWatch.map(alias =>
                supabase
                  .from('sync_jobs')
                  .select('completed_at')
                  .eq('organization_id', organizationId)
                  .in('entity_alias', [alias, `${alias}_current_month`])
                  .eq('status', 'completed')
                  .gte('completed_at', triggeredAt)
                  .limit(1)
                  .maybeSingle()
              )
            );

            const allDone = checks.every(r => r.data?.completed_at);
            if (allDone) {
              setLastSyncTime(new Date().toISOString());
              clearInterval(poll);
              // Invalidate all provider data queries so tables refresh with fresh synced data
              queryClient.invalidateQueries({ queryKey: ['all-providers-working-hours'] });
              queryClient.invalidateQueries({ queryKey: ['provider-working-hours'] });
              queryClient.invalidateQueries({ queryKey: ['all-providers-net-production'] });
              return;
            }
          } catch { /* ignore */ }

          if (attempts >= maxAttempts) clearInterval(poll);
        }, 3000);
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      toast.error('Sync failed', {
        description: error.message || 'Unable to start sync',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      {lastSyncTime && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>Last updated: {formatDistanceToNow(new Date(lastSyncTime), { addSuffix: true })}</span>
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={isSyncing}
        className="gap-2"
      >
        <RefreshCw className={cn('h-4 w-4', isSyncing && 'animate-spin')} />
        <span>{isSyncing ? 'Refreshing data...' : 'Refresh data'}</span>
      </Button>
    </div>
  );
}
