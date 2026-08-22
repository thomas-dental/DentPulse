import { supabase } from '@/integrations/supabase/client';

interface RefreshTokenResponse {
  success: boolean;
  message?: string;
  access_token?: string;
  expires_at?: string;
  expires_in_seconds?: number;
  minutes_until_expiry?: number;
  error?: string;
  details?: string;
}

/**
 * Refresh Xero access token using refresh token
 */
export async function refreshXeroToken(integrationId: string): Promise<RefreshTokenResponse> {
  try {
    console.log('[XeroTokenService] Refreshing token for integration:', integrationId);

    const { data, error } = await supabase.functions.invoke('xero-refresh-token', {
      body: { integrationId },
    });

    if (error) {
      console.error('[XeroTokenService] Error invoking refresh function:', error);
      throw error;
    }

    console.log('[XeroTokenService] Token refresh response:', data);
    return data;
  } catch (error) {
    console.error('[XeroTokenService] Failed to refresh token:', error);
    throw error;
  }
}

/**
 * Get valid Xero access token (refreshes if expired)
 */
export async function getValidXeroToken(integrationId: string): Promise<string> {
  try {
    // First, try to refresh the token (the function checks if it's needed)
    const refreshResult = await refreshXeroToken(integrationId);

    if (refreshResult.success && refreshResult.access_token) {
      return refreshResult.access_token;
    }

    throw new Error(refreshResult.error || 'Failed to get valid token');
  } catch (error) {
    console.error('[XeroTokenService] Failed to get valid token:', error);
    throw error;
  }
}

/**
 * Check if Xero token needs refresh (within 5 minutes of expiry)
 */
export async function checkXeroTokenExpiry(integrationId: string): Promise<{
  needsRefresh: boolean;
  expiresAt?: Date;
  minutesUntilExpiry?: number;
}> {
  try {
    const { data: integration, error } = await supabase
      .from('platform_integrations')
      .select('token_expires_at')
      .eq('id', integrationId)
      .single();

    if (error || !integration) {
      console.error('[XeroTokenService] Failed to check token expiry:', error);
      return { needsRefresh: true };
    }

    const expiresAt = new Date(integration.token_expires_at);
    const now = new Date();
    const minutesUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60);

    // Refresh if token expires in less than 5 minutes
    const needsRefresh = minutesUntilExpiry < 5;

    return {
      needsRefresh,
      expiresAt,
      minutesUntilExpiry,
    };
  } catch (error) {
    console.error('[XeroTokenService] Error checking token expiry:', error);
    return { needsRefresh: true };
  }
}
