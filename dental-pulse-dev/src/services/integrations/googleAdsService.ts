/**
 * Google Ads Service
 * Handles Google Ads API interactions including token management and data fetching
 * Note: Most API calls go through the Edge Function, but this service handles client-side
 * operations and credential management.
 */

import { supabase } from '@/integrations/supabase/client';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface GoogleAdsCredentials {
  id: string;
  organization_id: string;
  user_id: string;
  platform_name: string;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  is_connected: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoogleAdsData {
  id: string;
  organization_id: string;
  platform_integration_id: string;
  user_id: string;
  developer_token: string | null;
  customer_id: string | null;
  login_customer_id: string | null;
  account_name: string | null;
  currency: string | null;
  timezone: string | null;
  total_spend: number;
  total_conversions: number;
  total_clicks: number;
  total_impressions: number;
  average_cpc: number;
  cost_per_conversion: number;
  last_sync_at: string | null;
  raw_account_info: any;
  raw_campaigns: GoogleAdsCampaign[] | null;
  raw_metrics: any;
  status: string;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoogleAdsCampaign {
  id: string;
  name: string;
  status: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  costPerConversion: number;
}

export interface GoogleAdsAccountMetrics {
  totalSpend: number;
  totalConversions: number;
  totalClicks: number;
  totalImpressions: number;
  averageCpc: number;
  costPerConversion: number;
}

export interface GoogleAdsApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

// ============================================
// GOOGLE ADS SERVICE CLASS
// ============================================

export class GoogleAdsService {
  private credentials: GoogleAdsCredentials;
  private adsData: GoogleAdsData | null = null;

  constructor(credentials: GoogleAdsCredentials, adsData?: GoogleAdsData) {
    this.credentials = credentials;
    this.adsData = adsData || null;
  }

  /**
   * Check if the access token is expired (with 5-minute buffer)
   */
  isTokenExpired(): boolean {
    if (!this.credentials.token_expires_at) return true;
    const expiresAt = new Date(this.credentials.token_expires_at);
    return new Date() >= new Date(expiresAt.getTime() - 5 * 60 * 1000);
  }

  /**
   * Get cached campaigns from the database
   */
  getCachedCampaigns(): GoogleAdsCampaign[] {
    return this.adsData?.raw_campaigns || [];
  }

  /**
   * Get cached account metrics from the database
   */
  getCachedMetrics(): GoogleAdsAccountMetrics {
    if (!this.adsData) {
      return {
        totalSpend: 0,
        totalConversions: 0,
        totalClicks: 0,
        totalImpressions: 0,
        averageCpc: 0,
        costPerConversion: 0,
      };
    }

    return {
      totalSpend: this.adsData.total_spend || 0,
      totalConversions: this.adsData.total_conversions || 0,
      totalClicks: this.adsData.total_clicks || 0,
      totalImpressions: this.adsData.total_impressions || 0,
      averageCpc: this.adsData.average_cpc || 0,
      costPerConversion: this.adsData.cost_per_conversion || 0,
    };
  }

  /**
   * Get account info
   */
  getAccountInfo(): { accountName: string; currency: string; timezone: string } {
    return {
      accountName: this.adsData?.account_name || 'Google Ads Account',
      currency: this.adsData?.currency || 'USD',
      timezone: this.adsData?.timezone || 'UTC',
    };
  }

  /**
   * Get last sync timestamp
   */
  getLastSyncAt(): string | null {
    return this.adsData?.last_sync_at || null;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get Google Ads credentials for an organization
 */
export async function getGoogleAdsCredentials(organizationId: string): Promise<GoogleAdsCredentials | null> {
  const { data, error } = await (supabase as any)
    .from('platform_integrations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'google_ads')
    .maybeSingle();

  if (error) {
    console.error('Failed to get Google Ads credentials:', error);
    return null;
  }

  return data as GoogleAdsCredentials | null;
}

/**
 * Get Google Ads data for an organization
 * Fetches the most recent record regardless of status to display cached data
 */
export async function getGoogleAdsData(organizationId: string): Promise<GoogleAdsData | null> {
  const { data, error } = await (supabase as any)
    .from('platform_integration_google_ads_data')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Failed to get Google Ads data:', error);
    return null;
  }

  return data as GoogleAdsData | null;
}

/**
 * Create a Google Ads service instance for an organization
 */
export async function createGoogleAdsService(organizationId: string): Promise<GoogleAdsService | null> {
  const credentials = await getGoogleAdsCredentials(organizationId);
  if (!credentials) {
    return null;
  }

  if (!credentials.is_connected) {
    console.error('Google Ads is not connected for this organization');
    return null;
  }

  const adsData = await getGoogleAdsData(organizationId);
  return new GoogleAdsService(credentials, adsData || undefined);
}

/**
 * Initiate Google Ads OAuth flow
 * Calls the edge function which returns the OAuth authorization URL
 */
export async function initiateGoogleAdsOAuth(
  organizationId: string,
  userId: string
): Promise<GoogleAdsApiResponse<{ authorizationUrl: string }>> {
  try {
    const response = await supabase.functions.invoke('google-ads-auth', {
      body: { organizationId, userId, origin: window.location.origin },
    });

    if (response.error) {
      throw new Error(response.error.message || 'Failed to initiate OAuth');
    }

    if (!response.data?.success) {
      throw new Error(response.data?.error || 'Failed to get authorization URL');
    }

    return {
      success: true,
      data: { authorizationUrl: response.data.authorizationUrl },
    };
  } catch (error: any) {
    console.error('Error initiating Google Ads OAuth:', error);
    return { success: false, error: error.message || 'Failed to initiate OAuth' };
  }
}

/**
 * Select a Google Ads account after OAuth
 * Saves the selected account to platform_integration_google_ads_data
 */
export async function selectGoogleAdsAccount(
  organizationId: string,
  userId: string,
  integrationId: string,
  customerId: string,
  accountName: string,
  currency: string,
  timezone: string
): Promise<GoogleAdsApiResponse<{ dataId: string }>> {
  try {
    // Check if Google Ads data record exists for this org
    const { data: existingData } = await (supabase as any)
      .from('platform_integration_google_ads_data')
      .select('id')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const dataRecord = {
      organization_id: organizationId,
      platform_integration_id: integrationId,
      user_id: userId,
      customer_id: customerId,
      login_customer_id: customerId,
      account_name: accountName,
      currency: currency,
      timezone: timezone,
      status: 'active',
      is_selected: true,
      updated_at: new Date().toISOString(),
    };

    let dataId: string;

    if (existingData) {
      // Update existing record
      const { error: updateError } = await (supabase as any)
        .from('platform_integration_google_ads_data')
        .update(dataRecord)
        .eq('id', existingData.id);

      if (updateError) throw updateError;
      dataId = existingData.id;
    } else {
      // Insert new record
      const { data: newData, error: insertError } = await (supabase as any)
        .from('platform_integration_google_ads_data')
        .insert(dataRecord)
        .select('id')
        .single();

      if (insertError) throw insertError;
      dataId = newData.id;
    }

    return { success: true, data: { dataId } };
  } catch (error: any) {
    console.error('Error selecting Google Ads account:', error);
    return { success: false, error: error.message || 'Failed to select account' };
  }
}

/**
 * Disconnect Google Ads integration
 */
export async function disconnectGoogleAds(organizationId: string): Promise<GoogleAdsApiResponse<void>> {
  try {
    const credentials = await getGoogleAdsCredentials(organizationId);
    if (!credentials) {
      return { success: false, error: 'Google Ads integration not found' };
    }

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
      console.error('Failed to disconnect Google Ads:', updateError);
      return { success: false, error: updateError.message };
    }

    // Update Google Ads data status
    const { error: dataUpdateError } = await (supabase as any)
      .from('platform_integration_google_ads_data')
      .update({
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('platform_integration_id', credentials.id);

    if (dataUpdateError) {
      console.error('Failed to update Google Ads data status:', dataUpdateError);
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error disconnecting Google Ads:', error);
    return { success: false, error: error.message || 'Failed to disconnect' };
  }
}
