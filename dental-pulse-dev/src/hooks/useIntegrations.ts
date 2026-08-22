import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';
import { testIntegrationConnection } from '@/services/integrationService';
import { DentallyService } from '@/services/integrations';

export interface Integration {
  id: string;
  organization_id: string;
  integration_name: string;
  integration_description: string | null;
  is_connected: boolean;
  api_endpoints: string | null;
  api_key: string | null;
  secret_key_id_available: string | null;
  sync_frequency: string | null;
  sync_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  synced_site_ids: string[] | null;
}

export interface IntegrationUpdate {
  integration_name?: string;
  integration_description?: string;
  is_connected?: boolean;
  api_endpoints?: string;
  api_key?: string;
  secret_key_id_available?: string;
  sync_frequency?: string;
  sync_at?: string;
}

export function useIntegrations() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [connectingId, setConnectingId] = useState<string | null>(null);

  // Fetch all integrations for the organization
  const { data: integrations = [], isLoading, error, refetch } = useQuery({
    queryKey: ['integrations', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.log('No organizationId available');
        return [];
      }
      
      console.log('Fetching integrations for organization:', organizationId);
      
      const { data, error } = await (supabase as any)
        .from('integrations')
        .select('*')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('integration_name', { ascending: true });

      if (error) {
        console.error('Error fetching integrations:', error);
        throw error;
      }
      
      console.log('Fetched integrations:', data);
      return (data || []) as Integration[];
    },
    enabled: !!organizationId,
    retry: 2,
    refetchOnWindowFocus: true,
    refetchInterval: 15000, // poll every 15s so Last Sync updates after a job completes
  });

  // Get integration by name (for easy access)
  const getIntegrationByName = (name: string): Integration | undefined => {
    return integrations.find((int) => int.integration_name.toLowerCase() === name.toLowerCase());
  };

  // Update integration
  const updateIntegrationMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: IntegrationUpdate }) => {
      const { data, error } = await (supabase as any)
        .from('integrations')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Integration;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['integrations', organizationId] });
      toast.success('Integration updated successfully');
      console.log('Integration updated:', data);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update integration');
    },
  });

  // Update sync status
  const updateSyncStatusMutation = useMutation({
    mutationFn: async ({ id, syncAt }: { id: string; syncAt: string }) => {
      const { data, error } = await (supabase as any)
        .from('integrations')
        .update({
          sync_at: syncAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Integration;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', organizationId] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update sync status');
    },
  });

  // Connect integration
  const connectIntegrationMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      // Fetch integration data from database first
      const { data: integration, error: fetchError } = await (supabase as any)
        .from('integrations')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) throw new Error('Integration not found');
      if (!integration) throw new Error('Integration not found');

      // Get API key and endpoint from database
      const apiKey = integration.api_key;
      const apiEndpoint = integration.api_endpoints;

      // Validate that API key and endpoint are set
      if (!apiKey || !apiEndpoint) {
        throw new Error('API Key and API Endpoint must be set before connecting. Please configure them first.');
      }

      // Determine which service to use based on integration name
      if (integration.integration_name === 'Dentally') {
        // For Dentally, call /v1/user endpoint using API endpoint from database
        const userResult = await DentallyService.getUser(apiKey, apiEndpoint);
        
        // Check if we got user data in response
        if (userResult.success && userResult.data?.user) {
          console.log('Dentally user data received:', userResult.data.user);
          // Connection successful - user data exists, proceed to connect
        } else {
          // Check if it's an error response
          if (userResult.data?.error) {
            const errorMsg = userResult.data.error.message || userResult.data.error.type || 'Invalid API token';
            throw new Error(errorMsg);
          }
          throw new Error(userResult.error || 'Connection test failed - no user data received');
        }
      } else {
        // Generic connection test
        const testResult = await testIntegrationConnection(apiEndpoint, apiKey);
        if (!testResult.success) {
          throw new Error(testResult.error || 'Connection test failed');
        }
      }

      // Update integration status in database (keep existing API key and endpoint)
      const { data, error } = await (supabase as any)
        .from('integrations')
        .update({
          is_connected: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Integration;
    },
    onMutate: async ({ id }) => {
      setConnectingId(id);
    },
    onSuccess: () => {
      setConnectingId(null);
      queryClient.invalidateQueries({ queryKey: ['integrations', organizationId] });
      toast.success('Integration connected successfully');
    },
    onError: (error: any) => {
      setConnectingId(null);
      toast.error(error.message || 'Failed to connect integration');
    },
  });

  // Disconnect integration
  const disconnectIntegrationMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await (supabase as any)
        .from('integrations')
        .update({
          is_connected: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Integration;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', organizationId] });
      toast.success('Integration disconnected');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to disconnect integration');
    },
  });

  return {
    integrations,
    isLoading,
    error,
    refetch,
    getIntegrationByName,
    updateIntegration: updateIntegrationMutation.mutate,
    updateSyncStatus: updateSyncStatusMutation.mutate,
    connectIntegration: connectIntegrationMutation.mutate,
    disconnectIntegration: disconnectIntegrationMutation.mutate,
    isUpdating: updateIntegrationMutation.isPending,
    isSyncing: updateSyncStatusMutation.isPending,
    isConnecting: connectingId, // Return the connecting ID instead of boolean
  };
}
