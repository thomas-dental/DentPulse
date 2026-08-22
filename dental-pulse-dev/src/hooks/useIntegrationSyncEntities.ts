/**
 * Hook for managing integration sync entities
 * Replaces data_sync_json JSONB approach with proper relational table
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IntegrationSyncEntityService } from '@/services/integrations/integrationSyncEntityService';
import { toast } from 'sonner';

export function useIntegrationSyncEntities(integrationId?: string) {
  const queryClient = useQueryClient();

  // Fetch sync entities for an integration
  const { data: syncEntities = [], isLoading, error, refetch } = useQuery({
    queryKey: ['integration_sync_entities', integrationId],
    queryFn: async () => {
      if (!integrationId) return [];
      return await IntegrationSyncEntityService.getEntitiesForIntegration(integrationId);
    },
    enabled: !!integrationId,
  });

  // Toggle sync mutation
  const toggleSyncMutation = useMutation({
    mutationFn: async ({ entityId, isSync }: { entityId: string; isSync: boolean }) => {
      const success = await IntegrationSyncEntityService.toggleSync(entityId, isSync);
      if (!success) throw new Error('Failed to toggle sync');
      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integration_sync_entities', integrationId] });
      toast.success('Sync settings updated');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update sync settings');
    },
  });

  // Update entity mutation
  const updateEntityMutation = useMutation({
    mutationFn: async ({
      entityId,
      updates,
    }: {
      entityId: string;
      updates: { entity_label?: string; entity_description?: string };
    }) => {
      const success = await IntegrationSyncEntityService.updateEntity(entityId, updates);
      if (!success) throw new Error('Failed to update entity');
      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integration_sync_entities', integrationId] });
      toast.success('Entity updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update entity');
    },
  });

  // Delete entity mutation
  const deleteEntityMutation = useMutation({
    mutationFn: async (entityId: string) => {
      const success = await IntegrationSyncEntityService.deleteEntity(entityId);
      if (!success) throw new Error('Failed to delete entity');
      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integration_sync_entities', integrationId] });
      toast.success('Entity removed successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to remove entity');
    },
  });

  // Add entity mutation
  const addEntityMutation = useMutation({
    mutationFn: async (entity: {
      integration_id: string;
      entity_alias: string;
      entity_label: string;
      entity_description?: string;
      is_sync?: boolean;
      is_available?: boolean;
    }) => {
      const result = await IntegrationSyncEntityService.addEntity(entity);
      if (!result) throw new Error('Failed to add entity');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integration_sync_entities', integrationId] });
      toast.success('Entity added successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to add entity');
    },
  });

  // Helper: Get enabled entity aliases
  const getEnabledEntityAliases = (): string[] => {
    return syncEntities
      .filter(e => e.is_sync && e.is_available)
      .map(e => e.entity_alias);
  };

  // Helper: Get entity count
  const getEntityCount = () => {
    return {
      total: syncEntities.length,
      enabled: syncEntities.filter(e => e.is_sync).length,
      available: syncEntities.filter(e => e.is_available).length,
    };
  };

  // Helper: Check if entity is enabled
  const isEntityEnabled = (entityAlias: string): boolean => {
    const entity = syncEntities.find(e => e.entity_alias === entityAlias);
    return entity ? entity.is_sync && entity.is_available : false;
  };

  return {
    syncEntities,
    isLoading,
    error,
    refetch,
    toggleSync: toggleSyncMutation.mutate,
    updateEntity: updateEntityMutation.mutate,
    deleteEntity: deleteEntityMutation.mutate,
    addEntity: addEntityMutation.mutate,
    getEnabledEntityAliases,
    getEntityCount,
    isEntityEnabled,
  };
}
