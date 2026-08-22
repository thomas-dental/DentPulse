/**
 * Integration Sync Entity Service
 * Manages sync entities for integrations using the integration_sync_entities table
 * Replaces the old data_sync_json JSONB approach
 */

import { supabase } from '@/integrations/supabase/client';
import { DENTALLY_SYNC_ENTITIES } from './dentallyConfig';

export interface IntegrationSyncEntity {
  id: string;
  integration_id: string;
  entity_alias: string;
  entity_label: string;
  entity_description: string | null;
  is_sync: boolean;
  is_available: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export const IntegrationSyncEntityService = {
  /**
   * Get all sync entities for an integration
   */
  async getEntitiesForIntegration(integrationId: string): Promise<IntegrationSyncEntity[]> {
    try {
      const { data, error } = await supabase
        .from('integration_sync_entities')
        .select('*')
        .eq('integration_id', integrationId)
        .order('entity_label', { ascending: true });

      if (error) {
        console.error('Failed to fetch sync entities:', error);
        return [];
      }

      return data as IntegrationSyncEntity[];
    } catch (error) {
      console.error('Error fetching sync entities:', error);
      return [];
    }
  },

  /**
   * Get enabled sync entities for an integration
   */
  async getEnabledEntities(integrationId: string): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('integration_sync_entities')
        .select('entity_alias')
        .eq('integration_id', integrationId)
        .eq('is_sync', true)
        .eq('is_available', true);

      if (error) {
        console.error('Failed to fetch enabled entities:', error);
        return [];
      }

      return data.map(e => e.entity_alias);
    } catch (error) {
      console.error('Error fetching enabled entities:', error);
      return [];
    }
  },

  /**
   * Initialize default sync entities for a new integration
   */
  async initializeDefaultEntities(
    integrationId: string,
    integrationName: string
  ): Promise<boolean> {
    try {
      // Only initialize for Dentally integrations
      if (integrationName !== 'Dentally') {
        return true;
      }

      // Check if entities already exist
      const existing = await this.getEntitiesForIntegration(integrationId);
      const existingAliases = new Set(existing.map(e => e.entity_alias));

      if (existing.length > 0) {
        // Add any missing entities from config (e.g. newly added entity types)
        const missingEntities = DENTALLY_SYNC_ENTITIES
          .filter(entity => !existingAliases.has(entity.alias))
          .map(entity => ({
            integration_id: integrationId,
            entity_alias: entity.alias,
            entity_label: entity.label,
            entity_description: entity.description,
            is_sync: entity.is_sync === 1,
            is_available: entity.isAvailable || false,
            last_synced_at: null,
          }));

        if (missingEntities.length > 0) {
          const { error } = await supabase
            .from('integration_sync_entities')
            .insert(missingEntities);
          if (error) {
            console.error('Failed to add missing sync entities:', error);
          } else {
            console.log(`Added ${missingEntities.length} new sync entities:`, missingEntities.map(e => e.entity_alias));
          }
        }

        // Update is_available flag on existing entities whose availability changed in config
        const configMap = new Map(DENTALLY_SYNC_ENTITIES.map(e => [e.alias, e]));
        for (const existingEntity of existing) {
          const configEntity = configMap.get(existingEntity.entity_alias);
          if (configEntity && (configEntity.isAvailable || false) !== existingEntity.is_available) {
            await supabase
              .from('integration_sync_entities')
              .update({ is_available: configEntity.isAvailable || false })
              .eq('id', existingEntity.id);
            console.log(`Updated is_available for ${existingEntity.entity_alias}: ${existingEntity.is_available} → ${configEntity.isAvailable}`);
          }
        }

        return true;
      }

      // Insert all default entities from config
      const entities = DENTALLY_SYNC_ENTITIES.map(entity => ({
        integration_id: integrationId,
        entity_alias: entity.alias,
        entity_label: entity.label,
        entity_description: entity.description,
        is_sync: entity.is_sync === 1,
        is_available: entity.isAvailable || false,
        last_synced_at: null,
      }));

      const { error } = await supabase
        .from('integration_sync_entities')
        .insert(entities);

      if (error) {
        console.error('Failed to initialize sync entities:', error);
        return false;
      }

      console.log(`Initialized ${entities.length} sync entities for integration:`, integrationId);
      return true;
    } catch (error) {
      console.error('Error initializing sync entities:', error);
      return false;
    }
  },

  /**
   * Toggle sync status for an entity
   */
  async toggleSync(entityId: string, isSync: boolean): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('integration_sync_entities')
        .update({ is_sync: isSync })
        .eq('id', entityId);

      if (error) {
        console.error('Failed to toggle sync:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error toggling sync:', error);
      return false;
    }
  },

  /**
   * Toggle sync status by entity alias (for backward compatibility)
   */
  async toggleSyncByAlias(
    integrationId: string,
    entityAlias: string,
    isSync: boolean
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('integration_sync_entities')
        .update({ is_sync: isSync })
        .eq('integration_id', integrationId)
        .eq('entity_alias', entityAlias);

      if (error) {
        console.error('Failed to toggle sync by alias:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error toggling sync by alias:', error);
      return false;
    }
  },

  /**
   * Update entity details (label and description)
   */
  async updateEntity(
    entityId: string,
    updates: {
      entity_label?: string;
      entity_description?: string;
    }
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('integration_sync_entities')
        .update(updates)
        .eq('id', entityId);

      if (error) {
        console.error('Failed to update entity:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating entity:', error);
      return false;
    }
  },

  /**
   * Update last_synced_at timestamp for an entity
   */
  async updateLastSyncedAt(
    integrationId: string,
    entityAlias: string,
    timestamp: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('integration_sync_entities')
        .update({ last_synced_at: timestamp })
        .eq('integration_id', integrationId)
        .eq('entity_alias', entityAlias);

      if (error) {
        console.error('Failed to update last_synced_at:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating last_synced_at:', error);
      return false;
    }
  },

  /**
   * Update last_synced_at for multiple entities at once
   */
  async updateMultipleLastSyncedAt(
    integrationId: string,
    entityAliases: string[],
    timestamp: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('integration_sync_entities')
        .update({ last_synced_at: timestamp })
        .eq('integration_id', integrationId)
        .in('entity_alias', entityAliases);

      if (error) {
        console.error('Failed to update multiple last_synced_at:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating multiple last_synced_at:', error);
      return false;
    }
  },

  /**
   * Delete an entity (for admin/customization)
   */
  async deleteEntity(entityId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('integration_sync_entities')
        .delete()
        .eq('id', entityId);

      if (error) {
        console.error('Failed to delete entity:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error deleting entity:', error);
      return false;
    }
  },

  /**
   * Add a new custom entity
   */
  async addEntity(entity: {
    integration_id: string;
    entity_alias: string;
    entity_label: string;
    entity_description?: string;
    is_sync?: boolean;
    is_available?: boolean;
  }): Promise<IntegrationSyncEntity | null> {
    try {
      const { data, error } = await supabase
        .from('integration_sync_entities')
        .insert({
          ...entity,
          is_sync: entity.is_sync ?? false,
          is_available: entity.is_available ?? false,
          last_synced_at: null,
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to add entity:', error);
        return null;
      }

      return data as IntegrationSyncEntity;
    } catch (error) {
      console.error('Error adding entity:', error);
      return null;
    }
  },
};
