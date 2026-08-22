/**
 * Iplicit Integration Service
 * Handles all Iplicit-specific API calls and sync operations
 * Uses `platform_integrations` table for storing connection credentials
 * Uses `platform_integration_chart_of_accounts` table for storing synced Chart of Accounts
 */

import { supabase } from '@/integrations/supabase/client';
import { IntegrationApiResponse } from '../integrationService';

// ============================================
// IPLICIT API INTERFACES
// ============================================

export interface IplicitSessionResponse {
  tokenDue: string;
  sessionToken: string;
  domain: string;
  apiVer: string;
}

export interface IplicitCredentials {
  domain: string;
  username: string;
  apiKey: string;
}

export interface IplicitAccount {
  id: string;
  code: string;
  description: string;
  isActive: boolean;
}

// ============================================
// IPLICIT API SERVICE
// ============================================

const IPLICIT_API_BASE = 'https://api.iplicit.com';

export const IplicitService = {
  /**
   * Build full endpoint URL
   * @param path - API path (e.g., '/api/session/create/api')
   * @returns Full endpoint URL
   */
  buildEndpoint(path: string): string {
    const apiPath = path.startsWith('/') ? path : `/${path}`;
    return `${IPLICIT_API_BASE}${apiPath}`;
  },

  /**
   * Parse credentials from integration record
   * Domain is stored in api_endpoints, username:apiKey in api_key (format: username|apiKey)
   */
  parseCredentials(integration: any): IplicitCredentials | null {
    if (!integration.api_endpoints || !integration.api_key) {
      return null;
    }

    // api_key stores "username|apiKey" format
    const parts = integration.api_key.split('|');
    if (parts.length !== 2) {
      return null;
    }

    return {
      domain: integration.api_endpoints,
      username: parts[0],
      apiKey: parts[1],
    };
  },

  /**
   * Format credentials for storage
   * @param domain - Iplicit domain
   * @param username - Iplicit username
   * @param apiKey - Iplicit API key
   */
  formatCredentialsForStorage(domain: string, username: string, apiKey: string): {
    api_endpoints: string;
    api_key: string;
  } {
    return {
      api_endpoints: domain,
      api_key: `${username}|${apiKey}`,
    };
  },

  /**
   * Create a session token by authenticating with Iplicit API
   * @param domain - Iplicit domain
   * @param username - Iplicit username
   * @param apiKey - Iplicit API key
   * @returns Session response with token
   */
  async createSession(
    domain: string,
    username: string,
    apiKey: string
  ): Promise<{ success: boolean; data?: IplicitSessionResponse; error?: string }> {
    try {
      const response = await fetch(this.buildEndpoint('/api/session/create/api'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Domain': domain,
        },
        body: JSON.stringify({
          username: username,
          userApiKey: apiKey,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Authentication failed: ${response.status} - ${errorText}`,
        };
      }

      const data: IplicitSessionResponse = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to authenticate with Iplicit',
      };
    }
  },

  /**
   * Test connection to Iplicit API
   * Validates credentials by attempting to create a session
   * @param domain - Iplicit domain
   * @param username - Iplicit username
   * @param apiKey - Iplicit API key
   */
  async testConnection(
    domain: string,
    username: string,
    apiKey: string
  ): Promise<{ success: boolean; sessionToken?: string; tokenExpiry?: string; error?: string }> {
    const result = await this.createSession(domain, username, apiKey);
    if (result.success && result.data) {
      return {
        success: true,
        sessionToken: result.data.sessionToken,
        tokenExpiry: result.data.tokenDue,
      };
    }
    return {
      success: false,
      error: result.error,
    };
  },

  /**
   * Get Chart of Accounts from Iplicit Catalog API
   * Endpoint: GET /api/Catalog/Account
   * Response: [{ id, code, description, isActive }]
   * @param domain - Iplicit domain
   * @param sessionToken - Session token
   */
  async getAccounts(
    domain: string,
    sessionToken: string
  ): Promise<IntegrationApiResponse<IplicitAccount[]>> {
    try {
      const response = await fetch(this.buildEndpoint('/api/Catalog/Account'), {
        method: 'GET',
        headers: {
          'Domain': domain,
          'Authorization': `Bearer ${sessionToken}`,
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to fetch Chart of Accounts: ${response.status}`,
          status: response.status,
        };
      }

      const data = await response.json();
      const accounts: IplicitAccount[] = Array.isArray(data) ? data : [];

      return {
        success: true,
        data: accounts,
        status: response.status,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to fetch Chart of Accounts',
      };
    }
  },

  /**
   * Get existing Iplicit integration for an organization
   * @param organizationId - The organization ID
   * @param integrationId - Optional specific integration ID to filter by (for multi-account support)
   */
  async getIntegration(organizationId: string, integrationId?: string): Promise<{
    success: boolean;
    integration?: any;
    error?: string;
  }> {
    try {
      let query = supabase
        .from('integrations')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('integration_name', 'Iplicit');

      if (integrationId) {
        query = query.eq('id', integrationId);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        return {
          success: false,
          error: error.message,
        };
      }

      return {
        success: true,
        integration: data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get integration',
      };
    }
  },

  /**
   * Connect to Iplicit - validates credentials and saves to integrations table
   * @param organizationId - Organization ID
   * @param userId - User ID
   * @param domain - Iplicit domain
   * @param username - Iplicit username
   * @param apiKey - Iplicit API key
   */
  async connect(
    organizationId: string,
    userId: string,
    domain: string,
    username: string,
    apiKey: string
  ): Promise<{ success: boolean; integrationId?: string; error?: string }> {
    // First test the connection
    const testResult = await this.testConnection(domain, username, apiKey);
    if (!testResult.success) {
      return {
        success: false,
        error: testResult.error || 'Failed to authenticate with Iplicit',
      };
    }

    // Format credentials for storage
    const credentials = this.formatCredentialsForStorage(domain, username, apiKey);

    try {
      // Check if integration already exists
      const { integration: existing } = await this.getIntegration(organizationId);

      if (existing) {
        // Update existing integration
        const { error: updateError } = await supabase
          .from('integrations')
          .update({
            ...credentials,
            is_connected: true,
            user_id: userId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (updateError) {
          return {
            success: false,
            error: updateError.message,
          };
        }

        return {
          success: true,
          integrationId: existing.id,
        };
      } else {
        // Create new integration
        const { data: newIntegration, error: insertError } = await supabase
          .from('integrations')
          .insert({
            organization_id: organizationId,
            user_id: userId,
            created_by: userId,
            integration_name: 'Iplicit',
            integration_description: 'Cloud-based accounting software for dental practices',
            is_connected: true,
            ...credentials,
            sync_frequency: '15min',
          })
          .select()
          .single();

        if (insertError) {
          return {
            success: false,
            error: insertError.message,
          };
        }

        return {
          success: true,
          integrationId: newIntegration.id,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to save integration',
      };
    }
  },

  /**
   * Disconnect from Iplicit (mark as disconnected, don't delete)
   * @param integrationId - The integration ID
   */
  async disconnect(integrationId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('integrations')
        .update({
          is_connected: false,
          api_key: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', integrationId);

      if (error) {
        return {
          success: false,
          error: error.message,
        };
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to disconnect from Iplicit',
      };
    }
  },

  /**
   * Sync data via Edge Function
   * Flow: 1) Fetch Legal Entities → save to platform_integration_organizations
   *       2) Fetch Chart of Accounts → save to platform_integration_chart_of_accounts
   * @param connectionId - The platform_integrations record ID
   * @param accessToken - User's auth token
   */
  async syncData(
    connectionId: string,
    accessToken: string
  ): Promise<{
    success: boolean;
    legalEntities?: number;
    legalEntitiesSaved?: number;
    chartOfAccounts?: number;
    chartOfAccountsSaved?: number;
    error?: string;
  }> {
    try {
      const response = await supabase.functions.invoke('iplicit-sync-v2', {
        body: { connectionId },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.error) {
        return {
          success: false,
          error: response.error.message,
        };
      }

      if (!response.data?.success) {
        return {
          success: false,
          error: response.data?.error || 'Sync failed',
        };
      }

      return {
        success: true,
        legalEntities: response.data.legalEntities || 0,
        legalEntitiesSaved: response.data.legalEntitiesSaved || 0,
        chartOfAccounts: response.data.chartOfAccounts || 0,
        chartOfAccountsSaved: response.data.chartOfAccountsSaved || 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to sync iplicit data',
      };
    }
  },

  /**
   * Get stored Chart of Accounts from database for an organization
   * @param organizationId - The organization ID
   * @param platformIntegrationId - Optional platform integration ID to filter by
   */
  async getStoredChartOfAccounts(
    organizationId: string,
    platformIntegrationId?: string
  ): Promise<IntegrationApiResponse<IplicitAccount[]>> {
    try {
      let query = (supabase as any)
        .from('platform_integration_chart_of_accounts')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('platform_name', 'iplicit')
        .eq('coa_is_active', true)
        .order('coa_account_code', { ascending: true });

      if (platformIntegrationId) {
        query = query.eq('platform_integration_id', platformIntegrationId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching stored Chart of Accounts:', error);
        return { success: false, error: error.message };
      }

      // Transform to IplicitAccount format
      const accounts: IplicitAccount[] = (data || []).map((row: any) => ({
        id: row.coa_account_id || row.id,
        code: row.coa_account_code || '',
        description: row.coa_account_name || row.coa_description || '',
        isActive: row.coa_is_active ?? true,
      }));

      return { success: true, data: accounts };
    } catch (error: any) {
      console.error('Error fetching stored Chart of Accounts:', error);
      return { success: false, error: error.message || 'Failed to fetch Chart of Accounts' };
    }
  },

  /**
   * Get iplicit connection from platform_integrations table
   * @param organizationId - The organization ID
   * @param connectionId - Optional specific connection ID to filter by (for multi-account support)
   */
  async getPlatformIntegration(organizationId: string, connectionId?: string): Promise<{
    success: boolean;
    integration?: any;
    error?: string;
  }> {
    try {
      let query = (supabase as any)
        .from('platform_integrations')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('platform_name', 'iplicit');

      if (connectionId) {
        query = query.eq('id', connectionId);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        return {
          success: false,
          error: error.message,
        };
      }

      return {
        success: true,
        integration: data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get platform integration',
      };
    }
  },
};

export default IplicitService;
