/**
 * Default folders helper service
 * This file contains reusable functions for managing invoice folders
 *
 * Folder structure:
 * - Cost
 *   - Costs inbox
 *   - Expense claims
 *   - Supplier claims
 *   - Mileage
 *   - Supplier
 * - Sales
 *   - Sales inbox
 *   - Customers
 *   - Product and services
 * - Bank
 * - Vault
 */

import { supabase } from '@/integrations/supabase/client';

export interface FolderTemplate {
  name: string;
  type: string;
  children?: FolderTemplate[];
}

export interface InvoiceFolder {
  id: string;
  organization_id: string;
  location_id: string | null;
  user_id: string | null;
  parent_id: string | null;
  name: string;
  type: string;
  created_at: string;
  updated_at: string;
}

/**
 * Default folder structure template
 */
export const DEFAULT_FOLDERS: FolderTemplate[] = [
  {
    name: 'Cost',
    type: 'default',
    children: [
      { name: 'Costs inbox', type: 'default' },
      { name: 'Expense claims', type: 'default' },
      { name: 'Supplier claims', type: 'default' },
      { name: 'Mileage', type: 'default' },
      { name: 'Supplier', type: 'default' },
    ],
  },
  {
    name: 'Sales',
    type: 'default',
    children: [
      { name: 'Sales inbox', type: 'default' },
      { name: 'Customers', type: 'default' },
      { name: 'Product and services', type: 'default' },
    ],
  },
  {
    name: 'Bank',
    type: 'default',
  },
  {
    name: 'Vault',
    type: 'default',
  },
];

/**
 * Get list of default folder names (top-level only)
 */
export function getDefaultFolderNames(): string[] {
  return DEFAULT_FOLDERS.map(f => f.name);
}

/**
 * Folder Helper Service - Reusable functions for folder management
 */
export const FolderService = {
  /**
   * Get list of default folder names (top-level only)
   */
  getDefaultFolderNames(): string[] {
    return DEFAULT_FOLDERS.map(f => f.name);
  },

  /**
   * Check which default folders are missing for a specific organization/location/user
   * This checks by folder NAME to ensure the specific default folders exist
   */
  async checkMissingDefaultFolders(
    organizationId: string,
    locationId: string,
    userId: string
  ): Promise<{ missingFolders: string[]; existingFolders: string[]; allExist: boolean }> {
    try {
      const defaultFolderNames = this.getDefaultFolderNames();

      console.log('[FolderService] Checking default folders for:', {
        organizationId,
        locationId,
        userId,
        defaultFolderNames
      });

      // Query existing folders by name for this user + location combination
      // Using user_id + location_id as unique key (matches onboarding flow)
      const { data: existingFolders, error } = await (supabase as any)
        .from('invoice_folders')
        .select('name')
        .eq('user_id', userId)
        .eq('location_id', locationId)
        .is('parent_id', null) // Only check top-level folders
        .in('name', defaultFolderNames);

      if (error) {
        console.error('[FolderService] Error checking missing default folders:', error);
        return { missingFolders: defaultFolderNames, existingFolders: [], allExist: false };
      }

      const existingNames = (existingFolders || []).map((f: any) => f.name);
      const missingFolders = defaultFolderNames.filter(name => !existingNames.includes(name));

      console.log('[FolderService] Default folders check result:', {
        existingFolders: existingNames,
        missingFolders,
        allExist: missingFolders.length === 0
      });

      return {
        missingFolders,
        existingFolders: existingNames,
        allExist: missingFolders.length === 0
      };
    } catch (error) {
      console.error('[FolderService] Exception checking missing default folders:', error);
      return { missingFolders: this.getDefaultFolderNames(), existingFolders: [], allExist: false };
    }
  },

  /**
   * Check if folders exist for an organization
   */
  async checkFoldersExist(organizationId: string, userId?: string): Promise<{ exists: boolean; count: number }> {
    try {
      let query = (supabase as any)
        .from('invoice_folders')
        .select('id', { count: 'exact', head: false })
        .eq('organization_id', organizationId)
        .eq('type', 'default');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('[FolderService] Error checking folders:', error);
        return { exists: false, count: 0 };
      }

      const folderCount = count || data?.length || 0;
      return { exists: folderCount > 0, count: folderCount };
    } catch (error) {
      console.error('[FolderService] Exception checking folders:', error);
      return { exists: false, count: 0 };
    }
  },

  /**
   * Check if folders exist for a specific user + location combination
   */
  async checkFoldersExistForLocation(organizationId: string, locationId: string | null, userId?: string): Promise<{ exists: boolean; count: number }> {
    try {
      // Primary check by user_id + location_id (matches onboarding flow)
      if (!userId || !locationId) {
        console.warn('[FolderService] checkFoldersExistForLocation requires both userId and locationId');
        return { exists: false, count: 0 };
      }

      const query = (supabase as any)
        .from('invoice_folders')
        .select('id', { count: 'exact', head: false })
        .eq('user_id', userId)
        .eq('location_id', locationId);

      const { data, error, count } = await query;

      if (error) {
        console.error('[FolderService] Error checking folders for location:', error);
        return { exists: false, count: 0 };
      }

      const folderCount = count || data?.length || 0;
      return { exists: folderCount > 0, count: folderCount };
    } catch (error) {
      console.error('[FolderService] Exception checking folders for location:', error);
      return { exists: false, count: 0 };
    }
  },

  /**
   * Get all folders for an organization
   */
  async getFolders(organizationId: string): Promise<InvoiceFolder[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('invoice_folders')
        .select('*')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true });

      if (error) {
        console.error('[FolderService] Error fetching folders:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[FolderService] Exception fetching folders:', error);
      return [];
    }
  },

  /**
   * Create a single folder with duplicate check
   * Checks if folder with same name/user/org/location/parent already exists
   */
  async createFolder(
    organizationId: string,
    userId: string,
    name: string,
    type: string = 'default',
    parentId: string | null = null,
    locationId: string | null = null
  ): Promise<InvoiceFolder | null> {
    // VALIDATION: location_id is required
    if (!locationId) {
      console.error(`[FolderService] ERROR: Cannot create folder "${name}" - location_id is required`);
      return null;
    }

    try {
      // CHECK FOR EXISTING FOLDER - prevent duplicates by user_id + location_id + name + parent_id
      // This matches the onboarding flow logic
      let existingQuery = (supabase as any)
        .from('invoice_folders')
        .select('*')
        .eq('user_id', userId)
        .eq('location_id', locationId)
        .eq('name', name);

      if (parentId) {
        existingQuery = existingQuery.eq('parent_id', parentId);
      } else {
        existingQuery = existingQuery.is('parent_id', null);
      }

      const { data: existingFolder, error: checkError } = await existingQuery.maybeSingle();

      if (checkError) {
        console.error(`[FolderService] Error checking existing folder "${name}":`, checkError);
      }

      // If folder already exists, return it instead of creating duplicate
      if (existingFolder) {
        console.log(`[FolderService] Folder "${name}" already exists, skipping creation`);
        return existingFolder;
      }

      // Create new folder
      const { data, error } = await (supabase as any)
        .from('invoice_folders')
        .insert({
          organization_id: organizationId,
          user_id: userId,
          parent_id: parentId,
          name,
          type,
          location_id: locationId,
        })
        .select()
        .single();

      if (error) {
        console.error(`[FolderService] Error creating folder "${name}":`, error);
        return null;
      }

      console.log(`[FolderService] Created new folder: "${name}" (id: ${data.id})`);
      return data;
    } catch (error) {
      console.error(`[FolderService] Exception creating folder "${name}":`, error);
      return null;
    }
  },

  /**
   * Create default folders for an organization/location (only creates missing ones)
   * Checks each default folder by NAME and only creates missing ones
   */
  async ensureDefaultFolders(
    organizationId: string,
    userId: string,
    locationId: string | null = null
  ): Promise<{ success: boolean; foldersCreated: number; alreadyExisted: boolean; error?: string }> {
    console.log('[FolderService] Ensuring default folders:', { organizationId, userId, locationId });

    // VALIDATION: location_id is required
    if (!locationId) {
      console.error('[FolderService] ERROR: location_id is required');
      return {
        success: false,
        foldersCreated: 0,
        alreadyExisted: false,
        error: 'location_id is required'
      };
    }

    try {
      // Check which specific default folders are missing (by name)
      const { missingFolders, allExist } = await this.checkMissingDefaultFolders(
        organizationId,
        locationId,
        userId
      );

      if (allExist) {
        console.log(`[FolderService] All default folders already exist for location ${locationId}`);
        return { success: true, foldersCreated: 0, alreadyExisted: true };
      }

      console.log(`[FolderService] Missing default folders:`, missingFolders);

      // Create only the missing default folders
      let foldersCreated = 0;

      for (const folder of DEFAULT_FOLDERS) {
        if (missingFolders.includes(folder.name)) {
          console.log(`[FolderService] Creating missing folder: ${folder.name}`);
          const createdCount = await this.createFolderWithChildren(
            folder,
            organizationId,
            userId,
            null,
            locationId
          );
          foldersCreated += createdCount;
        }
      }

      console.log(`[FolderService] Successfully created ${foldersCreated} folders`);
      return { success: true, foldersCreated, alreadyExisted: foldersCreated === 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[FolderService] Error ensuring folders:', error);
      return { success: false, foldersCreated: 0, alreadyExisted: false, error: message };
    }
  },

  /**
   * Recursively creates a folder and its children
   */
  async createFolderWithChildren(
    folder: FolderTemplate,
    organizationId: string,
    userId: string,
    parentId: string | null,
    locationId: string | null = null
  ): Promise<number> {
    let count = 0;

    const createdFolder = await this.createFolder(
      organizationId,
      userId,
      folder.name,
      folder.type,
      parentId,
      locationId
    );

    if (!createdFolder) {
      return count;
    }

    count = 1;

    // Create children if any
    if (folder.children && folder.children.length > 0) {
      for (const child of folder.children) {
        const childCount = await this.createFolderWithChildren(
          child,
          organizationId,
          userId,
          createdFolder.id,
          locationId
        );
        count += childCount;
      }
    }

    return count;
  },
};

/**
 * Creates default folders for a new organization
 * @deprecated Use FolderService.ensureDefaultFolders() instead
 */
export async function createDefaultFolders(
  organizationId: string,
  userId: string,
  locationId: string | null = null
): Promise<{ success: boolean; foldersCreated: number; error?: string }> {
  if (!locationId) {
    return {
      success: false,
      foldersCreated: 0,
      error: 'locationId is required'
    };
  }
  const result = await FolderService.ensureDefaultFolders(organizationId, userId, locationId);
  return {
    success: result.success,
    foldersCreated: result.foldersCreated,
    error: result.error,
  };
}

/**
 * Creates default folders for a specific location
 */
export async function createDefaultFoldersForLocation(
  organizationId: string,
  locationId: string,
  userId: string
): Promise<{ success: boolean; foldersCreated: number; error?: string }> {
  if (!locationId) {
    return { success: false, foldersCreated: 0, error: 'locationId is required' };
  }
  const result = await FolderService.ensureDefaultFolders(organizationId, userId, locationId);
  return {
    success: result.success,
    foldersCreated: result.foldersCreated,
    error: result.error,
  };
}

/**
 * Creates default folders for multiple locations in batch
 */
export async function createDefaultFoldersForLocationsBatch(
  organizationId: string,
  locations: Array<{ id: string; name: string }>,
  userId: string
): Promise<{ success: boolean; created: number; existed: number; failed: number; errors: string[] }> {
  console.log('[createDefaultFoldersForLocationsBatch] Creating folders for', locations.length, 'locations');

  let created = 0;
  let existed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const location of locations) {
    try {
      const result = await FolderService.ensureDefaultFolders(organizationId, userId, location.id);

      if (result.success) {
        if (result.alreadyExisted) {
          existed++;
        } else {
          created++;
        }
      } else {
        failed++;
        errors.push(`${location.name}: ${result.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      failed++;
      errors.push(`${location.name}: ${error.message || 'Exception'}`);
    }
  }

  return {
    success: failed === 0,
    created,
    existed,
    failed,
    errors,
  };
}
