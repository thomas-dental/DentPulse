import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { SyncJobService } from '@/services/integrations/syncJobService';

// Helper function to get fresh access token with refresh capability
async function getFreshAccessToken(): Promise<string | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();

    if (sessionData?.session?.access_token) {
      const expiresAt = sessionData.session.expires_at;
      const now = Math.floor(Date.now() / 1000);

      if (expiresAt && expiresAt > now + 60) {
        return sessionData.session.access_token;
      }
    }

    console.log('[Auth] Access token expired or about to expire, refreshing...');
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError) {
      console.error('[Auth] Failed to refresh session:', refreshError);
      return null;
    }

    if (refreshData?.session?.access_token) {
      console.log('[Auth] Session refreshed successfully');
      return refreshData.session.access_token;
    }

    return null;
  } catch (error) {
    console.error('[Auth] Error getting fresh access token:', error);
    return null;
  }
}

export type AccountingPlatform = 'iplicit' | 'xero' | 'quickbooks';
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'pending_auth';

export interface AccountingConnection {
  id: string;
  organization_id: string;
  name: string;
  platform: AccountingPlatform;
  status: ConnectionStatus;
  entity_name: string;
  last_sync: string | null;
  sync_frequency: string;
  enabled_features: string[];
  iplicit_domain?: string;
  iplicit_username?: string;
  created_at: string;
  updated_at: string;
}

interface UseAccountingConnectionsReturn {
  connections: AccountingConnection[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createConnection: (data: CreateConnectionData) => Promise<AccountingConnection | null>;
  updateConnection: (id: string, data: Partial<UpdateConnectionData>) => Promise<boolean>;
  deleteConnection: (id: string) => Promise<boolean>;
  saveIplicitCredentials: (data: IplicitConnectionData, connectionId?: string) => Promise<boolean>;
  connectToIplicit: (connectionId: string) => Promise<boolean>;
  disconnectIplicit: (connectionId: string) => Promise<boolean>;
  connectToXero: (connectionId?: string) => Promise<boolean>;
  disconnectXero: (connectionId: string) => Promise<boolean>;
  disconnectQuickbooks: (connectionId: string) => Promise<boolean>;
  syncConnection: (id: string) => Promise<boolean>;
}

interface CreateConnectionData {
  name: string;
  platform: AccountingPlatform;
  entity_name: string;
  sync_frequency?: string;
  enabled_features?: string[];
}

interface UpdateConnectionData {
  name: string;
  entity_name: string;
  sync_frequency: string;
  enabled_features: string[];
  status: ConnectionStatus;
}

interface IplicitConnectionData {
  connectionName: string;
  entityName: string;
  iplicitDomain: string;
  iplicitUsername: string;
  iplicitApiKey: string;
}

export function useAccountingConnections(organizationId?: string): UseAccountingConnectionsReturn {
  const [connections, setConnections] = useState<AccountingConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { session } = useAuth();

  const fetchConnections = useCallback(async () => {
    if (!organizationId) {
      setConnections([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch from platform_integrations table for ALL platform connections
      const { data, error: fetchError } = await (supabase as any)
        .from('platform_integrations')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('Error fetching platform_integrations:', fetchError);
        throw fetchError;
      }

      console.log('platform_integrations query returned:', data?.length || 0, 'rows');

      // Transform platform_integrations to AccountingConnection format
      const transformed: AccountingConnection[] = (data || []).map((conn: Record<string, unknown>) => {
        const platformName = (conn.platform_name as string) || 'iplicit';
        const username = (conn.username as string) || undefined;

        const displayNames: Record<string, string> = { xero: 'Xero', quickbooks: 'QuickBooks', iplicit: 'iplicit' };
        const displayName = displayNames[platformName] || platformName;

        return {
          id: conn.id as string,
          organization_id: conn.organization_id as string,
          name: `${displayName}${conn.client_id ? `-${conn.client_id}` : ''}`,
          platform: platformName as AccountingPlatform,
          status: (conn.is_connected ? 'connected' : 'disconnected') as ConnectionStatus,
          entity_name: (conn.client_id as string) || displayName,
          last_sync: null,
          sync_frequency: '1hour',
          enabled_features: ['Chart of Accounts'],
          iplicit_domain: platformName === 'iplicit' ? (conn.client_id as string) : undefined,
          iplicit_username: username,
          created_at: conn.created_at as string,
          updated_at: conn.updated_at as string,
        };
      });

      if (transformed.length > 0) {
        setConnections(transformed);
      } else {
        setConnections(prev => prev.length > 0 ? prev : []);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch connections';
      setError(message);
      console.error('Error fetching accounting connections:', err);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const createConnection = async (data: CreateConnectionData): Promise<AccountingConnection | null> => {
    if (!organizationId || !session?.user?.id) {
      toast.error('Error', { description: 'Not authenticated' });
      return null;
    }

    try {
      const { data: newConnection, error: insertError } = await (supabase as any)
        .from('platform_integrations')
        .insert([{
          organization_id: organizationId,
          user_id: session.user.id,
          platform_name: data.platform,
          is_connected: false,
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      const transformed: AccountingConnection = {
        id: newConnection.id,
        organization_id: newConnection.organization_id,
        name: data.name,
        platform: data.platform,
        status: 'disconnected',
        entity_name: data.entity_name,
        last_sync: null,
        sync_frequency: data.sync_frequency || '1hour',
        enabled_features: data.enabled_features || [],
        created_at: newConnection.created_at,
        updated_at: newConnection.updated_at,
      };

      setConnections(prev => [transformed, ...prev]);
      toast.success('Success', { description: 'Connection created successfully' });
      return transformed;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create connection';
      toast.error('Error', { description: message });
      return null;
    }
  };

  const updateConnection = async (id: string, data: Partial<UpdateConnectionData>): Promise<boolean> => {
    try {
      const updateData: Record<string, unknown> = {};
      if (data.status) {
        updateData.is_connected = data.status === 'connected';
      }
      updateData.updated_at = new Date().toISOString();

      const { error: updateError } = await (supabase as any)
        .from('platform_integrations')
        .update(updateData)
        .eq('id', id);

      if (updateError) throw updateError;

      setConnections(prev =>
        prev.map(conn => (conn.id === id ? { ...conn, ...data } : conn))
      );

      toast.success('Success', { description: 'Connection updated' });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update connection';
      toast.error('Error', { description: message });
      return false;
    }
  };

  const deleteConnection = async (id: string): Promise<boolean> => {
    try {
      // finance_data_sources references platform_integrations with ON DELETE
      // SET NULL, and has a partial-unique index `(org, platform) WHERE
      // platform_integration_id IS NULL`. If an orphan row already exists,
      // the SET NULL cascade would create a duplicate and the delete fails
      // with constraint `finance_data_sources_org_platform_no_integration_unique`.
      // Detach by deleting the dependent row(s) first so the cascade never fires.
      const { error: fdsError } = await (supabase as any)
        .from('finance_data_sources')
        .delete()
        .eq('platform_integration_id', id);

      if (fdsError) throw fdsError;

      const { error: deleteError } = await (supabase as any)
        .from('platform_integrations')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      setConnections(prev => prev.filter(conn => conn.id !== id));
      toast.success('Success', { description: 'Connection removed' });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete connection';
      toast.error('Error', { description: message });
      return false;
    }
  };

  // Save iplicit credentials without connecting
  // connectionId: if provided, updates that specific connection; otherwise creates a new one
  const saveIplicitCredentials = async (data: IplicitConnectionData, connectionId?: string): Promise<boolean> => {
    if (!organizationId || !session?.user?.id) {
      toast.error('Error', { description: 'Not authenticated' });
      return false;
    }

    try {
      let returnedId: string;
      let wasUpsert = false;

      if (connectionId) {
        // ── Edit existing connection (UPDATE by ID) ──
        const { data: updated, error } = await (supabase as any)
          .from('platform_integrations')
          .update({
            client_id: data.iplicitDomain,
            username: data.iplicitUsername,
            client_secret: data.iplicitApiKey,
            is_connected: false, // must re-connect after credential edit
            updated_at: new Date().toISOString(),
          })
          .eq('id', connectionId)
          .eq('organization_id', organizationId)
          .select()
          .single();

        if (error) throw new Error(error.message);
        returnedId = updated.id;
      } else {
        // ── Check for duplicate (same org + domain + username) → upsert ──
        // Use .limit(1) instead of .maybeSingle() to handle case where multiple duplicates already exist
        const { data: existingRows } = await (supabase as any)
          .from('platform_integrations')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('platform_name', 'iplicit')
          .eq('client_id', data.iplicitDomain)
          .eq('username', data.iplicitUsername)
          .order('created_at', { ascending: false })
          .limit(1);

        const existing = existingRows?.[0] || null;

        if (existing) {
          wasUpsert = true;
          // Upsert: update the existing row's API key
          const { data: updated, error } = await (supabase as any)
            .from('platform_integrations')
            .update({
              client_secret: data.iplicitApiKey,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
            .select()
            .single();

          if (error) throw new Error(error.message);
          returnedId = updated.id;

          // Clean up any older duplicate rows with same domain+username
          if (existingRows && existingRows.length > 0) {
            const keepId = existing.id;
            const { data: allDupes } = await (supabase as any)
              .from('platform_integrations')
              .select('id')
              .eq('organization_id', organizationId)
              .eq('platform_name', 'iplicit')
              .eq('client_id', data.iplicitDomain)
              .eq('username', data.iplicitUsername)
              .neq('id', keepId);

            for (const dupe of (allDupes || [])) {
              await (supabase as any)
                .from('platform_integrations')
                .delete()
                .eq('id', dupe.id);
            }
          }
        } else {
          // INSERT new row
          const { data: inserted, error } = await (supabase as any)
            .from('platform_integrations')
            .insert({
              organization_id: organizationId,
              user_id: session.user.id,
              platform_name: 'iplicit',
              is_connected: false,
              client_id: data.iplicitDomain,
              username: data.iplicitUsername,
              client_secret: data.iplicitApiKey,
            })
            .select()
            .single();

          if (error) throw new Error(error.message);
          returnedId = inserted.id;
        }
      }

      console.log('iplicit credentials saved, id:', returnedId);

      const newConn: AccountingConnection = {
        id: returnedId,
        organization_id: organizationId,
        name: `iplicit-${data.iplicitDomain}`,
        platform: 'iplicit',
        status: 'disconnected',
        entity_name: data.iplicitDomain,
        last_sync: null,
        sync_frequency: '1hour',
        enabled_features: ['Chart of Accounts'],
        iplicit_domain: data.iplicitDomain,
        iplicit_username: data.iplicitUsername,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (connectionId) {
        // Edit flow: update the specific connection in place
        setConnections(prev => prev.map(c => c.id === connectionId ? newConn : c));
      } else {
        // New or upsert: check if this ID already exists in state (upsert case)
        const alreadyInState = connections.some(c => c.id === returnedId);
        if (alreadyInState) {
          // Upsert hit — update existing entry and remove any duplicates
          setConnections(prev => prev
            .map(c => c.id === returnedId ? newConn : c)
            .filter((c, i, arr) =>
              // Remove duplicate domain+username entries (keep the one with returnedId)
              c.id === returnedId ||
              !(c.platform === 'iplicit' && c.iplicit_domain === data.iplicitDomain && c.iplicit_username === data.iplicitUsername)
            )
          );
        } else {
          setConnections(prev => [newConn, ...prev]);
        }
      }

      // Refetch to get clean state from DB (removes any stale duplicates)
      await fetchConnections();

      toast.success('Credentials Saved!', {
        description: wasUpsert ? 'Existing account updated.' : 'Click Connect to activate the integration.',
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save credentials';
      toast.error('Error', { description: message });
      return false;
    }
  };

  // Connect a specific iplicit account by connectionId
  const connectToIplicit = async (connectionId: string): Promise<boolean> => {
    if (!organizationId) {
      toast.error('Error', { description: 'Organization not found' });
      return false;
    }

    try {
      const { error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError) {
        console.error('[iplicit] Session refresh failed:', refreshError);
        toast.error('Error', { description: 'Session expired. Please login again.' });
        return false;
      }

      const response = await supabase.functions.invoke('iplicit-auth', {
        body: {
          organizationId,
          connectionId,
          action: 'connect',
        },
      });

      if (response.error) {
        let errorMessage = response.error.message;
        try {
          const errorBody = await (response.error as any).context?.json();
          if (errorBody?.error) errorMessage = errorBody.error;
        } catch {
          // fall back to generic message
        }
        throw new Error(errorMessage);
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Connection failed');
      }

      const returnedId = response.data.connectionId;
      console.log('iplicit connection activated, id:', returnedId);

      // Safety: ensure ONLY the target connection is marked connected in DB.
      // The deployed edge function may have connected other rows too — fix that.
      // 1. Set all OTHER iplicit connections for this org back to their original state
      const { data: allIplicit } = await (supabase as any)
        .from('platform_integrations')
        .select('id, is_connected')
        .eq('organization_id', organizationId)
        .eq('platform_name', 'iplicit')
        .neq('id', returnedId);

      // Disconnect any that were wrongly connected by the edge function
      for (const other of (allIplicit || [])) {
        if (other.is_connected) {
          // Check if this connection was connected BEFORE we triggered connect
          const wasAlreadyConnected = connections.find(c => c.id === other.id)?.status === 'connected';
          if (!wasAlreadyConnected) {
            await (supabase as any)
              .from('platform_integrations')
              .update({ is_connected: false, access_token: null, token_expires_at: null })
              .eq('id', other.id);
          }
        }
      }

      // Update only this specific connection's status in UI
      setConnections(prev => prev.map(conn =>
        conn.id === connectionId
          ? { ...conn, id: returnedId, status: 'connected' }
          : conn
      ));

      toast.success('Connected!', {
        description: 'Successfully connected to iplicit',
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to iplicit';
      toast.error('Connection Error', { description: message });
      return false;
    }
  };

  // Disconnect a specific iplicit account by connectionId
  const disconnectIplicit = async (connectionId: string): Promise<boolean> => {
    if (!organizationId || !session?.access_token) {
      toast.error('Error', { description: 'Not authenticated' });
      return false;
    }

    try {
      const { error } = await (supabase as any)
        .from('platform_integrations')
        .update({
          is_connected: false,
          access_token: null,
          token_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', connectionId);

      if (error) throw error;

      // Update only this specific connection's status
      setConnections(prev => prev.map(conn =>
        conn.id === connectionId
          ? { ...conn, status: 'disconnected' }
          : conn
      ));

      toast.success('Disconnected', {
        description: 'iplicit disconnected. Credentials are preserved.',
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect';
      toast.error('Error', { description: message });
      return false;
    }
  };

  const syncConnection = async (id: string): Promise<boolean> => {
    console.log('[IPLICIT SYNC] Starting sync for connectionId:', id);

    if (!organizationId) {
      toast.error('Error', { description: 'Organization not found' });
      return false;
    }

    try {
      const result = await SyncJobService.triggerIplicitSync(organizationId, id);

      if (!result.success) {
        throw new Error(result.error || 'Sync failed');
      }

      console.log(`[IPLICIT SYNC] Triggered ${result.jobCount} jobs, ${result.skipped} skipped`);

      setConnections(prev =>
        prev.map(conn =>
          conn.id === id ? { ...conn, last_sync: new Date().toISOString(), status: 'connected' } : conn
        )
      );

      const description = result.jobCount > 0
        ? `${result.jobCount} sync job(s) started in the background`
        : 'All data is already up to date';
      toast.success('Sync Started', { description });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      console.error('[IPLICIT SYNC] Exception:', err);
      toast.error('Sync Error', { description: message });
      return false;
    }
  };

  const connectToXero = async (connectionId?: string): Promise<boolean> => {
    if (!organizationId) {
      toast.error('Error', { description: 'Organization not found' });
      return false;
    }

    try {
      const { error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError) {
        console.error('[Xero] Session refresh failed:', refreshError);
        toast.error('Error', { description: 'Session expired. Please login again.' });
        return false;
      }

      const response = await supabase.functions.invoke('xero-auth', {
        // Explicit: connect/reconnect of the CURRENT Xero account → silent SSO
        // (no forced login / MFA churn). Switching to a different Xero account
        // is done from the Settings hub's explicit "different account" action.
        body: { organizationId, connectionId, currentOrigin: window.location.origin, forceXeroLogin: false },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      if (!response.data?.success || !response.data?.authorizationUrl) {
        throw new Error(response.data?.error || 'Failed to get authorization URL');
      }

      window.location.href = response.data.authorizationUrl;
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to Xero';
      toast.error('Connection Error', { description: message });
      return false;
    }
  };

  // Disconnect a specific Xero connection by connectionId (preserves row for re-auth)
  const disconnectXero = async (connectionId: string): Promise<boolean> => {
    if (!organizationId || !session?.access_token) {
      toast.error('Error', { description: 'Not authenticated' });
      return false;
    }

    try {
      const { error } = await (supabase as any)
        .from('platform_integrations')
        .update({
          is_connected: false,
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', connectionId);

      if (error) throw error;

      // Update only this specific connection's status
      setConnections(prev => prev.map(conn =>
        conn.id === connectionId
          ? { ...conn, status: 'disconnected' }
          : conn
      ));

      toast.success('Disconnected', {
        description: 'Xero disconnected. You can reconnect anytime.',
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect';
      toast.error('Error', { description: message });
      return false;
    }
  };

  // Disconnect a specific QuickBooks connection by connectionId (preserves row for re-auth)
  const disconnectQuickbooks = async (connectionId: string): Promise<boolean> => {
    if (!organizationId || !session?.access_token) {
      toast.error('Error', { description: 'Not authenticated' });
      return false;
    }

    try {
      const { error } = await (supabase as any)
        .from('platform_integrations')
        .update({
          is_connected: false,
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', connectionId);

      if (error) throw error;

      setConnections(prev => prev.map(conn =>
        conn.id === connectionId
          ? { ...conn, status: 'disconnected' }
          : conn
      ));

      toast.success('Disconnected', {
        description: 'QuickBooks disconnected. You can reconnect anytime.',
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect';
      toast.error('Error', { description: message });
      return false;
    }
  };

  return {
    connections,
    isLoading,
    error,
    refetch: fetchConnections,
    createConnection,
    updateConnection,
    deleteConnection,
    saveIplicitCredentials,
    connectToIplicit,
    disconnectIplicit,
    connectToXero,
    disconnectXero,
    disconnectQuickbooks,
    syncConnection,
  };
}
