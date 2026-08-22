/**
 * useGoogleAdsData Hook
 * React hook for Google Ads data with connection management
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { useToast } from './use-toast';
import {
  getGoogleAdsCredentials,
  getGoogleAdsData,
  initiateGoogleAdsOAuth,
  disconnectGoogleAds,
  GoogleAdsCredentials,
  GoogleAdsData,
  GoogleAdsCampaign,
  GoogleAdsAccountMetrics,
} from '@/services/integrations/googleAdsService';

// ============================================
// TYPES
// ============================================

export type GoogleAdsConnectionStatus = 'disconnected' | 'connecting' | 'syncing' | 'connected' | 'error';

export interface GoogleAdsAnalyticsData {
  campaigns: GoogleAdsCampaign[];
  accountMetrics: GoogleAdsAccountMetrics;
  accountInfo: {
    accountName: string;
    currency: string;
    timezone: string;
  };
  lastSyncAt: string | null;
}

export interface UseGoogleAdsDataReturn {
  // Connection state
  connectionStatus: GoogleAdsConnectionStatus;
  isConnected: boolean;
  credentials: GoogleAdsCredentials | null;

  // Google Ads data
  googleAdsData: GoogleAdsData | null;
  isLoadingData: boolean;

  // Analytics data
  analyticsData: GoogleAdsAnalyticsData | null;
  isLoadingAnalytics: boolean;
  isRefreshingAnalytics: boolean;
  analyticsError: string | null;

  // Actions
  initiateOAuth: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshData: () => Promise<void>;
  syncCampaigns: () => Promise<void>;

  // State
  isInitiatingOAuth: boolean;
  isDisconnecting: boolean;
  isSyncing: boolean;
}

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useGoogleAdsData(): UseGoogleAdsDataReturn {
  const { session } = useAuth();
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isInitiatingOAuth, setIsInitiatingOAuth] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isInitialSync, setIsInitialSync] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // ============================================
  // QUERIES
  // ============================================

  // Fetch Google Ads credentials
  const {
    data: credentials,
    isLoading: isLoadingCredentials,
  } = useQuery({
    queryKey: ['google-ads-credentials', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      return getGoogleAdsCredentials(organizationId);
    },
    enabled: !!organizationId,
  });

  // Fetch Google Ads data from database
  // Always fetch if organization exists - this allows displaying cached data even when API isn't working
  const {
    data: googleAdsData,
    isLoading: isLoadingData,
    isFetching: isFetchingData,
  } = useQuery({
    queryKey: ['google-ads-data', organizationId],
    queryFn: async (): Promise<GoogleAdsData | null> => {
      if (!organizationId) return null;
      return getGoogleAdsData(organizationId);
    },
    enabled: !!organizationId,
  });

  // Fetch analytics data from Edge Function (uses cache by default)
  const {
    data: analyticsData,
    isLoading: isLoadingAnalytics,
    isFetching: isFetchingAnalytics,
    error: analyticsQueryError,
    refetch: refetchAnalytics,
  } = useQuery({
    queryKey: ['google-ads-analytics', organizationId, googleAdsData?.id],
    queryFn: async (): Promise<GoogleAdsAnalyticsData | null> => {
      if (!organizationId || !googleAdsData?.id || !credentials?.id || !session?.access_token) {
        return null;
      }

      // Call edge function - uses cached data by default
      const response = await supabase.functions.invoke('google-ads-data', {
        body: { integrationId: credentials.id, forceRefresh: false },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch Google Ads data');
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to fetch Google Ads data');
      }

      return {
        campaigns: response.data.data.campaigns || [],
        accountMetrics: response.data.data.accountMetrics || {
          totalSpend: 0,
          totalConversions: 0,
          totalClicks: 0,
          totalImpressions: 0,
          averageCpc: 0,
          costPerConversion: 0,
        },
        accountInfo: response.data.data.accountInfo || {
          accountName: 'Google Ads Account',
          currency: 'USD',
          timezone: 'UTC',
        },
        lastSyncAt: response.data.data.lastSyncAt || null,
      };
    },
    enabled: !!organizationId && !!googleAdsData?.id && !!credentials?.is_connected && !!session?.access_token,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1, // Only retry once on failure (prevents 502 spam)
    refetchOnWindowFocus: false,
  });

  /**
   * Force refresh data from Google Ads API (bypasses cache)
   */
  const refreshData = useCallback(async () => {
    if (!organizationId || !googleAdsData?.id || !credentials?.id || !session?.access_token) {
      return;
    }

    setIsRefreshing(true);

    try {
      const response = await supabase.functions.invoke('google-ads-data', {
        body: { integrationId: credentials.id, forceRefresh: true },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to refresh data');
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to refresh data');
      }

      // Invalidate queries to update UI with fresh data
      queryClient.invalidateQueries({ queryKey: ['google-ads-analytics', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['google-ads-data', organizationId] });

      toast({
        title: 'Data Refreshed',
        description: 'Google Ads data has been updated.',
      });
    } catch (error: any) {
      console.error('Error refreshing data:', error);
      toast({
        title: 'Refresh Error',
        description: error.message || 'Failed to refresh data',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [organizationId, googleAdsData?.id, credentials?.id, session?.access_token, queryClient, toast]);

  /**
   * Sync daily campaign snapshots into google_ads_campaigns table
   */
  const syncCampaigns = useCallback(async () => {
    if (!organizationId || !session?.access_token) return;

    setIsSyncing(true);

    try {
      const response = await supabase.functions.invoke('sync-google-ads', {
        body: { organizationId },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to sync campaigns');
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to sync campaigns');
      }

      // Invalidate RPC queries so charts/tables refresh
      queryClient.invalidateQueries({ queryKey: ['google-ads-summary'] });
      queryClient.invalidateQueries({ queryKey: ['google-ads-campaign-totals'] });
      queryClient.invalidateQueries({ queryKey: ['google-ads-chart-data'] });

      toast({
        title: 'Campaigns Synced',
        description: `${response.data.rowsSynced || 0} daily snapshots synced.`,
      });
    } catch (error: any) {
      console.error('Error syncing campaigns:', error);
      toast({
        title: 'Sync Error',
        description: error.message || 'Failed to sync campaigns',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [organizationId, session?.access_token, queryClient, toast]);

  const analyticsError = analyticsQueryError ? (analyticsQueryError as Error).message : null;

  // ============================================
  // COMPUTED STATE
  // ============================================

  const isConnected = credentials?.is_connected === true && !!googleAdsData;

  const connectionStatus: GoogleAdsConnectionStatus = (() => {
    // Show connecting while initiating OAuth
    if (isInitiatingOAuth) return 'connecting';

    // Show connecting while loading initial credentials
    if (isLoadingCredentials) return 'connecting';

    // Not connected states
    if (!credentials) return 'disconnected';
    if (!credentials.is_connected) return 'disconnected';

    // Credentials are connected but data is loading/syncing
    if (isLoadingData || isFetchingData || isInitialSync) return 'syncing';

    // If credentials are connected but no google ads data record exists (user didn't select account),
    // show as disconnected so they can try again
    if (!googleAdsData) return 'disconnected';

    // Data is loaded, now check analytics
    if (isLoadingAnalytics && !analyticsData) return 'syncing';

    // Only show error if we have data but analytics failed (not during initial sync)
    if (analyticsError && analyticsData === null && !isLoadingAnalytics) return 'error';

    return 'connected';
  })();

  // ============================================
  // AUTO-SYNC ON PAGE LOAD
  // ============================================

  const hasSyncedRef = useRef(false);

  useEffect(() => {
    if (hasSyncedRef.current) return;
    if (!isConnected || !googleAdsData || isSyncing) return;

    const lastSync = (googleAdsData as any).last_sync_at
      ? new Date((googleAdsData as any).last_sync_at).getTime()
      : 0;
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    if (lastSync < oneHourAgo) {
      hasSyncedRef.current = true;
      syncCampaigns();
    }
  }, [isConnected, googleAdsData, isSyncing, syncCampaigns]);

  // ============================================
  // ACTIONS
  // ============================================

  /**
   * Initiate Google Ads OAuth flow
   */
  const handleInitiateOAuth = useCallback(async (): Promise<void> => {
    if (!organizationId || !session?.user?.id) {
      toast({
        title: 'Error',
        description: 'Unable to initiate OAuth. Please try again.',
        variant: 'destructive',
      });
      return;
    }

    setIsInitiatingOAuth(true);

    try {
      const result = await initiateGoogleAdsOAuth(
        organizationId,
        session.user.id
      );

      if (!result.success || !result.data?.authorizationUrl) {
        throw new Error(result.error || 'Failed to get authorization URL');
      }

      // Redirect to Google OAuth
      window.location.href = result.data.authorizationUrl;
    } catch (error: any) {
      console.error('Error initiating OAuth:', error);
      toast({
        title: 'Connection Error',
        description: error.message || 'Failed to initiate Google Ads connection',
        variant: 'destructive',
      });
      setIsInitiatingOAuth(false);
    }
    // Note: Don't set isInitiatingOAuth to false on success since we're redirecting
  }, [organizationId, session, toast]);

  /**
   * Disconnect Google Ads integration
   */
  const handleDisconnect = useCallback(async () => {
    if (!organizationId) return;

    setIsDisconnecting(true);

    try {
      const result = await disconnectGoogleAds(organizationId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to disconnect');
      }

      // Invalidate all Google Ads queries
      queryClient.invalidateQueries({ queryKey: ['google-ads-credentials', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['google-ads-data', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['google-ads-analytics', organizationId] });

      toast({
        title: 'Disconnected',
        description: 'Google Ads has been disconnected.',
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
  }, [organizationId, queryClient, toast]);

  // ============================================
  // RETURN
  // ============================================

  return {
    // Connection state
    connectionStatus,
    isConnected,
    credentials: credentials || null,

    // Google Ads data
    googleAdsData: googleAdsData || null,
    isLoadingData,

    // Analytics data
    analyticsData: analyticsData || null,
    isLoadingAnalytics,
    isRefreshingAnalytics: isRefreshing || (isFetchingAnalytics && !isLoadingAnalytics),
    analyticsError,

    // Actions
    initiateOAuth: handleInitiateOAuth,
    disconnect: handleDisconnect,
    refreshData,
    syncCampaigns,

    // State
    isInitiatingOAuth,
    isDisconnecting,
    isSyncing,
  };
}
