/**
 * useGA4Analytics Hook
 * React hook for GA4 analytics data with connection management
 *
 * FLOW (same as Google Ads):
 * 1. User clicks "Connect Google Analytics"
 * 2. Direct OAuth redirect (credentials from env vars on edge function)
 * 3. Callback creates integration record + fetches properties
 * 4. Data stored in platform_integration_google_analytics_data table
 */

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { useToast } from './use-toast';
import {
  createGA4Service,
  getGA4Credentials,
  GA4Campaign,
  GA4GeographicROI,
  GA4ChannelMix,
  GA4LeadTrend,
  GA4SessionSource,
  GA4Credentials,
} from '@/services/integrations/ga4Service';

// ============================================
// TYPES
// ============================================

export type GA4ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface GA4AnalyticsData {
  campaigns: GA4Campaign[];
  geographicROI: GA4GeographicROI[];
  channelMix: GA4ChannelMix[];
  leadTrend: GA4LeadTrend[];
  sessionSources: GA4SessionSource[];
}

export interface GA4Data {
  id: string;
  organization_id: string;
  platform_integration_id: string;
  domain: string;
  property_id: string | null;
  property_name: string | null;
  property_code: string | null;
  website_url: string | null;
  measurement_id: string | null;
  account_id: string | null;
  account_name: string | null;
  timezone: string | null;
  currency: string | null;
  industry_category: string | null;
  property_type: string | null;
  raw_account_summaries: any;
  raw_property_details: any;
  raw_data_streams: any;
  status: string;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
}

export interface UseGA4AnalyticsReturn {
  // Connection state
  connectionStatus: GA4ConnectionStatus;
  isConnected: boolean;
  credentials: GA4Credentials | null;

  // GA4 Data from new table
  ga4Data: GA4Data | null;
  isLoadingGA4Data: boolean;

  // Analytics data
  analyticsData: GA4AnalyticsData | null;
  isLoadingAnalytics: boolean;
  isRefreshingAnalytics: boolean;
  analyticsError: string | null;

  // Actions
  initiateOAuth: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshAnalytics: () => void;

  // State
  isInitiatingOAuth: boolean;
  isDisconnecting: boolean;
}

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useGA4Analytics(): UseGA4AnalyticsReturn {
  const { session } = useAuth();
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isInitiatingOAuth, setIsInitiatingOAuth] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // ============================================
  // QUERIES
  // ============================================

  // Fetch GA4 credentials
  const {
    data: credentials,
    isLoading: isLoadingCredentials,
  } = useQuery({
    queryKey: ['ga4-credentials', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      return getGA4Credentials(organizationId);
    },
    enabled: !!organizationId,
  });

  // Fetch GA4 Data from new table
  const {
    data: ga4Data,
    isLoading: isLoadingGA4Data,
  } = useQuery({
    queryKey: ['ga4-data', organizationId],
    queryFn: async (): Promise<GA4Data | null> => {
      if (!organizationId) return null;

      const { data, error } = await (supabase as any)
        .from('platform_integration_google_analytics_data')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Failed to fetch GA4 data:', error);
        return null;
      }

      return data as GA4Data;
    },
    enabled: !!organizationId && credentials?.is_connected === true,
  });

  // Check if we have a valid property ID for analytics
  const hasValidPropertyId = ga4Data?.property_id &&
    /^\d+$/.test(ga4Data.property_id);

  // Fetch analytics data
  const {
    data: analyticsData,
    isLoading: isLoadingAnalytics,
    isFetching: isFetchingAnalytics,
    error: analyticsQueryError,
    refetch: refreshAnalytics,
  } = useQuery({
    queryKey: ['ga4-analytics', organizationId, ga4Data?.property_id],
    queryFn: async (): Promise<GA4AnalyticsData | null> => {
      if (!organizationId || !ga4Data?.property_id || !hasValidPropertyId) return null;

      const service = await createGA4Service(organizationId);
      if (!service) {
        // Service is null when is_connected=false or no credentials — not an error, just disconnected
        return null;
      }

      // Set the property ID
      service.setPropertyId(ga4Data.property_id);

      // First check token validity before making 5 parallel calls
      const tokenCheck = await service.ensureValidToken();
      if (!tokenCheck.success) {
        if (tokenCheck.error === 'GA4_TOKEN_REVOKED') {
          // Token permanently revoked — invalidate credentials query so UI shows disconnected
          queryClient.invalidateQueries({ queryKey: ['ga4-credentials', organizationId] });
          return null;
        }
        throw new Error(tokenCheck.error || 'Token validation failed');
      }

      // Fetch all analytics data in parallel
      const [campaignsResult, geoResult, channelResult, trendResult, sessionSourcesResult] = await Promise.all([
        service.getActiveCampaigns(),
        service.getGeographicROI(),
        service.getChannelMix(),
        service.getLeadTrend(),
        service.getSessionSources(),
      ]);

      // Check for token revocation in any result
      const allResults = [campaignsResult, geoResult, channelResult, trendResult, sessionSourcesResult];
      const revoked = allResults.find(r => r.error === 'GA4_TOKEN_REVOKED');
      if (revoked) {
        queryClient.invalidateQueries({ queryKey: ['ga4-credentials', organizationId] });
        return null;
      }

      return {
        campaigns: campaignsResult.data || [],
        geographicROI: geoResult.data || [],
        channelMix: channelResult.data || [],
        leadTrend: trendResult.data || [],
        sessionSources: sessionSourcesResult.data || [],
      };
    },
    enabled: !!organizationId && !!ga4Data?.property_id && hasValidPropertyId && credentials?.is_connected === true,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
    refetchOnWindowFocus: false,
  });

  const analyticsError = analyticsQueryError ? (analyticsQueryError as Error).message : null;

  // ============================================
  // COMPUTED STATE
  // ============================================

  const isConnected = credentials?.is_connected === true;

  const connectionStatus: GA4ConnectionStatus = (() => {
    if (isInitiatingOAuth) return 'connecting';
    if (isLoadingCredentials || isLoadingGA4Data) return 'connecting';
    if (!credentials) return 'disconnected';
    if (!credentials.is_connected) return 'disconnected';
    if (analyticsError) return 'error';
    return 'connected';
  })();

  // ============================================
  // ACTIONS
  // ============================================

  /**
   * Initiate OAuth flow directly (like Google Ads)
   * No need for pre-configured credentials or domain input
   */
  const initiateOAuth = useCallback(async () => {
    if (!organizationId || !session?.user?.id) {
      toast({
        title: 'Error',
        description: 'Unable to initiate connection. Please try again.',
        variant: 'destructive',
      });
      return;
    }

    setIsInitiatingOAuth(true);

    try {
      // Call the edge function directly (like Google Ads)
      // Pass origin so redirect_uri works for both local dev and production
      const response = await supabase.functions.invoke('ga4-auth', {
        body: {
          organizationId,
          userId: session.user.id,
          origin: window.location.origin,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to initiate OAuth');
      }

      if (!response.data?.success || !response.data?.authorizationUrl) {
        throw new Error(response.data?.error || 'Failed to get authorization URL');
      }

      // Redirect to Google OAuth
      window.location.href = response.data.authorizationUrl;
    } catch (error: any) {
      console.error('OAuth initiation error:', error);
      toast({
        title: 'Connection Error',
        description: error.message || 'Failed to start Google Analytics connection',
        variant: 'destructive',
      });
      setIsInitiatingOAuth(false);
    }
    // Note: Don't set isInitiatingOAuth to false on success since we're redirecting
  }, [organizationId, session, toast]);

  /**
   * Disconnect GA4 integration
   */
  const handleDisconnect = useCallback(async () => {
    if (!organizationId || !credentials?.id) return;

    setIsDisconnecting(true);

    try {
      // Update the platform_integrations record
      const { error: updateError } = await (supabase as any)
        .from('platform_integrations')
        .update({
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          is_connected: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', credentials.id);

      if (updateError) {
        throw new Error(updateError.message || 'Failed to disconnect');
      }

      // Delete GA4 data from new table
      const { error: deleteError } = await (supabase as any)
        .from('platform_integration_google_analytics_data')
        .delete()
        .eq('organization_id', organizationId);

      if (deleteError) {
        console.error('Failed to delete GA4 data:', deleteError);
        // Don't fail the disconnect if data deletion fails
      }

      // Invalidate all GA4 queries
      queryClient.invalidateQueries({ queryKey: ['ga4-credentials', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['ga4-data', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['ga4-analytics', organizationId] });

      toast({
        title: 'Disconnected',
        description: 'Google Analytics 4 has been disconnected',
      });
    } catch (error: any) {
      console.error('Disconnect error:', error);
      toast({
        title: 'Disconnect Error',
        description: error.message || 'Failed to disconnect',
        variant: 'destructive',
      });
    } finally {
      setIsDisconnecting(false);
    }
  }, [organizationId, credentials, queryClient, toast]);

  // ============================================
  // RETURN
  // ============================================

  return {
    // Connection state
    connectionStatus,
    isConnected,
    credentials: credentials || null,

    // GA4 Data
    ga4Data: ga4Data || null,
    isLoadingGA4Data,

    // Analytics data
    analyticsData: analyticsData || null,
    isLoadingAnalytics,
    isRefreshingAnalytics: isFetchingAnalytics && !isLoadingAnalytics,
    analyticsError,

    // Actions
    initiateOAuth,
    disconnect: handleDisconnect,
    refreshAnalytics: () => refreshAnalytics(),

    // State
    isInitiatingOAuth,
    isDisconnecting,
  };
}
