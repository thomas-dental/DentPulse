import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import { FolderService } from '@/utils/defaultFolders';

// Module-level lock to prevent concurrent folder initialization across all hook instances
let globalInitializingLock = false;
const initializedLocations = new Set<string>(); // Track which locations are already initialized

export interface InvoiceFolder {
  id: string;
  user_id: string | null;
  organization_id: string;
  location_id: string | null;
  parent_id: string | null;
  name: string;
  type: string;
  created_at: string;
  updated_at: string;
  invoice_count?: number;
  location_name?: string | null;
}

export interface FolderTreeNode extends InvoiceFolder {
  children: FolderTreeNode[];
}

export interface CreateFolderInput {
  name: string;
  parent_id?: string | null;
  type?: string;
  location_id?: string | null;
}

export interface UpdateFolderInput {
  name?: string;
  parent_id?: string | null;
  type?: string;
  location_id?: string | null;
}

export interface UseInvoiceFoldersOptions {
  selectedLocationId?: string | null;
}

export function useInvoiceFolders(options: UseInvoiceFoldersOptions = {}) {
  const { selectedLocationId } = options;
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [lastCheckedLocationCount, setLastCheckedLocationCount] = useState(0);
  const initializingRef = useRef(false);

  // Get organization ID
  useEffect(() => {
    const getOrganizationId = async () => {
      if (profile?.current_organization_id) {
        setOrganizationId(profile.current_organization_id);
        return;
      }

      if (user?.id) {
        const { data } = await supabase
          .from('user_roles')
          .select('organization_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (data?.organization_id) {
          setOrganizationId(data.organization_id);
        }
      }
    };

    if (user?.id) {
      getOrganizationId();
    }
  }, [user?.id, profile?.current_organization_id]);

  // Ensure default folders exist for all locations when organization is loaded
  useEffect(() => {
    const ensureFolders = async () => {
      // Use GLOBAL lock to prevent concurrent calls across all hook instances
      if (!user?.id || globalInitializingLock || initializingRef.current) {
        return;
      }

      // Acquire both locks
      globalInitializingLock = true;
      initializingRef.current = true;

      try {
        console.log('[useInvoiceFolders] Checking default folders for user:', user.id);

        // Fetch all locations for this user
        const { data: locations, error: locationsError } = await supabase
          .from('practice_locations')
          .select('id, location_name, organization_id')
          .eq('user_id', user.id)
          .is('deleted_at', null);

        if (locationsError) {
          console.error('[useInvoiceFolders] Error fetching locations:', locationsError);
          return;
        }

        const locationCount = locations?.length || 0;
        console.log('[useInvoiceFolders] Found locations:', locationCount);

        // Skip if we've already checked this many locations
        if (locationCount <= lastCheckedLocationCount && lastCheckedLocationCount > 0) {
          console.log('[useInvoiceFolders] Already checked, skipping');
          return;
        }

        let totalCreated = 0;

        // Create default folders for each location
        if (locations && locations.length > 0) {
          for (const location of locations) {
            // Skip if this location was already initialized in this session
            const locationKey = `${user.id}_${location.id}`;
            if (initializedLocations.has(locationKey)) {
              console.log(`[useInvoiceFolders] Location ${location.location_name} already initialized, skipping`);
              continue;
            }

            const locOrgId = location.organization_id;
            if (!locOrgId) {
              console.warn(`[useInvoiceFolders] Skipping location ${location.location_name} - no organization_id`);
              continue;
            }

            console.log(`[useInvoiceFolders] Checking folders for location: ${location.location_name} (${location.id})`);
            const result = await FolderService.ensureDefaultFolders(locOrgId, user.id, location.id);

            // Mark location as initialized regardless of result
            initializedLocations.add(locationKey);

            if (result.success && !result.alreadyExisted && result.foldersCreated > 0) {
              console.log(`[useInvoiceFolders] Created ${result.foldersCreated} folders for location: ${location.location_name}`);
              totalCreated += result.foldersCreated;
            }
          }
        }

        // Update the checked location count
        setLastCheckedLocationCount(locationCount);

        if (totalCreated > 0) {
          console.log(`[useInvoiceFolders] Total folders created: ${totalCreated}`);
          queryClient.invalidateQueries({ queryKey: ['invoice-folders'] });
        }
      } catch (error) {
        console.error('[useInvoiceFolders] Error ensuring folders:', error);
      } finally {
        // Release both locks
        initializingRef.current = false;
        globalInitializingLock = false;
      }
    };

    ensureFolders();
  }, [user?.id, lastCheckedLocationCount, queryClient]);

  // Normalize selectedLocationId
  const normalizedLocationId = selectedLocationId || null;

  // Fetch folders with invoice counts and location names
  const {
    data: folders = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['invoice-folders', organizationId, user?.id, normalizedLocationId],
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      if (!user?.id) return [];

      console.log('[useInvoiceFolders] Fetching folders:', {
        organizationId,
        userId: user.id,
        selectedLocationId: normalizedLocationId
      });

      // Build query based on location selection
      let query = supabase
        .from('invoice_folders')
        .select(`
          *,
          location:practice_locations(location_name)
        `)
        .eq('user_id', user.id);

      // Filter by location if specific location is selected
      if (normalizedLocationId) {
        query = query.eq('location_id', normalizedLocationId);
      }

      const { data: foldersData, error: foldersError } = await query.order('name', { ascending: true });

      if (foldersError) {
        console.error('[useInvoiceFolders] Error fetching folders:', foldersError);
        throw foldersError;
      }

      // Fetch invoice counts per folder
      let countsQuery = supabase
        .from('accounts_payable_invoice')
        .select('folder_id')
        .eq('user_id', user.id);

      if (normalizedLocationId) {
        countsQuery = countsQuery.eq('location_id', normalizedLocationId);
      }

      const { data: countsData } = await countsQuery;

      // Calculate counts
      const countMap: Record<string, number> = {};
      (countsData || []).forEach((inv: any) => {
        if (inv.folder_id) {
          countMap[inv.folder_id] = (countMap[inv.folder_id] || 0) + 1;
        }
      });

      // Add counts and location names to folders
      const foldersWithCounts = (foldersData || []).map((folder: any) => ({
        ...folder,
        invoice_count: countMap[folder.id] || 0,
        location_name: folder.location?.location_name || null,
      }));

      console.log('[useInvoiceFolders] Fetched folders:', foldersWithCounts.length);
      return foldersWithCounts as InvoiceFolder[];
    },
    enabled: !!user?.id,
  });

  // Build folder tree with total counts (including children)
  const folderTree = useMemo(() => {
    const calculateTotalCount = (node: FolderTreeNode): number => {
      const childrenCount = node.children.reduce(
        (sum, child) => sum + calculateTotalCount(child),
        0
      );
      return (node.invoice_count || 0) + childrenCount;
    };

    const buildTree = (parentId: string | null): FolderTreeNode[] => {
      return folders
        .filter(f => f.parent_id === parentId)
        .map(folder => {
          const children = buildTree(folder.id);
          const node: FolderTreeNode = {
            ...folder,
            children,
          };
          node.invoice_count = calculateTotalCount(node);
          return node;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    };

    return buildTree(null);
  }, [folders]);

  // Get total invoice count
  const totalInvoiceCount = useMemo(() => {
    return folders.reduce((sum, f) => sum + (f.invoice_count || 0), 0);
  }, [folders]);

  // Create folder mutation
  const createMutation = useMutation({
    mutationFn: async (input: CreateFolderInput) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('No user logged in');

      const { data, error } = await supabase
        .from('invoice_folders')
        .insert({
          organization_id: organizationId,
          user_id: user.id,
          name: input.name,
          parent_id: input.parent_id || null,
          type: input.type || 'admin',
          location_id: input.location_id || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-folders'] });
      toast.success('Folder created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create folder: ${error.message}`);
    },
  });

  // Update folder mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateFolderInput }) => {
      const { data, error } = await supabase
        .from('invoice_folders')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-folders'] });
      toast.success('Folder updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update folder: ${error.message}`);
    },
  });

  // Delete folder mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase
        .from('accounts_payable_invoice')
        .update({ folder_id: null })
        .eq('folder_id', id);

      const { error } = await supabase
        .from('invoice_folders')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-folders'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-payable-invoices'] });
      toast.success('Folder deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete folder: ${error.message}`);
    },
  });

  // Move invoice to folder
  const moveInvoiceToFolder = async (invoiceId: string, folderId: string | null) => {
    const { error } = await supabase
      .from('accounts_payable_invoice')
      .update({ folder_id: folderId })
      .eq('id', invoiceId);

    if (error) {
      toast.error('Failed to move invoice');
      throw error;
    }

    queryClient.invalidateQueries({ queryKey: ['invoice-folders'] });
    queryClient.invalidateQueries({ queryKey: ['accounts-payable-invoices'] });
    toast.success('Invoice moved successfully');
  };

  return {
    folders,
    folderTree,
    totalInvoiceCount,
    isLoading,
    error,
    refetch,
    createFolder: createMutation.mutate,
    updateFolder: updateMutation.mutate,
    deleteFolder: deleteMutation.mutate,
    moveInvoiceToFolder,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    organizationId,
  };
}
