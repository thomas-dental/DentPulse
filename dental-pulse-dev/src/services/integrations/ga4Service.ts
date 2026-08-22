/**
 * GA4 (Google Analytics 4) Service
 * Handles GA4 API interactions including OAuth, data fetching, and token refresh
 */

import { supabase } from '@/integrations/supabase/client';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface GA4Credentials {
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

export interface GA4TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface GA4Property {
  id: string;
  organization_id: string;
  platform_integration_id: string;
  user_id: string;
  platform_name: string;
  platform_org_id: string; // Property ID number
  platform_org_name: string;
  platform_org_code: string; // Full property path (properties/123456789)
  timezone: string | null;
  currency: string | null;
  status: string;
  is_selected: boolean;
  raw_data: any;
  meta_data: any;
  created_at: string;
  updated_at: string;
}

export interface GA4ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

// GA4 Data API Response Types
export interface GA4Campaign {
  name: string;
  sessions: number;
  conversions: number;
  revenue: number;
  roi: number;
}

export interface GA4GeographicROI {
  country: string;
  city: string;
  sessions: number;
  conversions: number;
  revenue: number;
  roi: number;
}

export interface GA4ChannelMix {
  channel: string;
  sessions: number;
  conversions: number;
  percentage: number;
}

export interface GA4LeadTrend {
  date: string;
  conversions: number;
  sessions: number;
}

export interface GA4SessionSource {
  source: string;
  medium: string;
  sessions: number;
  conversions: number;
  bounceRate: number;
  engagementRate: number;
}

// ============================================
// GA4 API CONSTANTS
// ============================================

const GA4_DATA_API_URL = 'https://analyticsdata.googleapis.com/v1beta';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ============================================
// GA4 SERVICE CLASS
// ============================================

export class GA4Service {
  private credentials: GA4Credentials;
  private propertyId: string | null = null;

  constructor(credentials: GA4Credentials) {
    this.credentials = credentials;
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
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<GA4ApiResponse<GA4TokenResponse>> {
    if (!this.credentials.refresh_token) {
      return { success: false, error: 'No refresh token available' };
    }

    try {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.credentials.refresh_token,
          client_id: this.credentials.client_id,
          client_secret: this.credentials.client_secret,
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Detect permanently revoked/expired tokens — handle silently
        if (errorText.includes('invalid_grant')) {
          await (supabase as any)
            .from('platform_integrations')
            .update({ is_connected: false, updated_at: new Date().toISOString() })
            .eq('id', this.credentials.id);
          return { success: false, error: 'GA4_TOKEN_REVOKED', status: response.status };
        }

        console.error('Token refresh failed:', response.status);
        return { success: false, error: `Token refresh failed: ${response.status}`, status: response.status };
      }

      const tokenData: GA4TokenResponse = await response.json();
      const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      // Update credentials in database
      const { error: updateError } = await (supabase as any)
        .from('platform_integrations')
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || this.credentials.refresh_token,
          token_expires_at: tokenExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', this.credentials.id);

      if (updateError) {
        console.error('Failed to save refreshed tokens:', updateError);
        return { success: false, error: 'Failed to save refreshed tokens' };
      }

      // Update local credentials
      this.credentials.access_token = tokenData.access_token;
      if (tokenData.refresh_token) {
        this.credentials.refresh_token = tokenData.refresh_token;
      }
      this.credentials.token_expires_at = tokenExpiresAt;

      return { success: true, data: tokenData };
    } catch (error: any) {
      console.error('Token refresh error:', error);
      return { success: false, error: error.message || 'Token refresh failed' };
    }
  }

  /**
   * Ensure we have a valid access token (refresh if needed)
   */
  async ensureValidToken(): Promise<GA4ApiResponse> {
    if (!this.credentials.access_token) {
      return { success: false, error: 'No access token available. Please reconnect to GA4.' };
    }

    if (this.isTokenExpired()) {
      const refreshResult = await this.refreshAccessToken();
      if (!refreshResult.success) {
        return refreshResult;
      }
    }

    return { success: true };
  }

  /**
   * Set the active GA4 property ID
   */
  setPropertyId(propertyId: string): void {
    this.propertyId = propertyId;
  }

  /**
   * Get the full property path for API calls
   */
  private getPropertyPath(): string {
    if (!this.propertyId) {
      throw new Error('No property ID set. Call setPropertyId() first.');
    }
    // Handle both formats: "123456789" and "properties/123456789"
    return this.propertyId.startsWith('properties/')
      ? this.propertyId
      : `properties/${this.propertyId}`;
  }

  /**
   * Make a request to the GA4 Data API
   */
  private async makeDataApiRequest(endpoint: string, body: any): Promise<GA4ApiResponse> {
    const tokenResult = await this.ensureValidToken();
    if (!tokenResult.success) {
      return tokenResult;
    }

    try {
      const propertyPath = this.getPropertyPath();
      const url = `${GA4_DATA_API_URL}/${propertyPath}:${endpoint}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.credentials.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `API error: ${response.status}`;
        console.error('GA4 API error:', errorMessage);
        return { success: false, error: errorMessage, status: response.status };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error: any) {
      console.error('GA4 API request failed:', error);
      return { success: false, error: error.message || 'Request failed' };
    }
  }

  /**
   * Get active Google Ads campaigns with performance metrics
   */
  async getActiveCampaigns(): Promise<GA4ApiResponse<GA4Campaign[]>> {
    const requestBody = {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'sessionCampaignName' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'purchaseRevenue' },
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'sessionMedium',
          stringFilter: {
            matchType: 'EXACT',
            value: 'cpc',
          },
        },
      },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    };

    const result = await this.makeDataApiRequest('runReport', requestBody);

    if (!result.success || !result.data) {
      return result;
    }

    // Transform response to campaign objects
    const campaigns: GA4Campaign[] = (result.data.rows || []).map((row: any) => {
      const name = row.dimensionValues?.[0]?.value || 'Unknown Campaign';
      const sessions = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const conversions = parseInt(row.metricValues?.[1]?.value || '0', 10);
      const revenue = parseFloat(row.metricValues?.[2]?.value || '0');

      // Calculate ROI (assuming some cost estimation based on sessions)
      // In real implementation, you'd get actual cost data from Google Ads API
      const estimatedCost = sessions * 2; // Placeholder
      const roi = estimatedCost > 0 ? Math.round(((revenue - estimatedCost) / estimatedCost) * 100) : 0;

      return {
        name,
        sessions,
        conversions,
        revenue,
        roi,
      };
    });

    return { success: true, data: campaigns };
  }

  /**
   * Get geographic ROI data
   */
  async getGeographicROI(): Promise<GA4ApiResponse<GA4GeographicROI[]>> {
    const requestBody = {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [
        { name: 'country' },
        { name: 'city' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'purchaseRevenue' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    };

    const result = await this.makeDataApiRequest('runReport', requestBody);

    if (!result.success || !result.data) {
      return result;
    }

    // Transform response to geographic ROI objects
    const geographicData: GA4GeographicROI[] = (result.data.rows || []).map((row: any) => {
      const country = row.dimensionValues?.[0]?.value || 'Unknown';
      const city = row.dimensionValues?.[1]?.value || 'Unknown';
      const sessions = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const conversions = parseInt(row.metricValues?.[1]?.value || '0', 10);
      const revenue = parseFloat(row.metricValues?.[2]?.value || '0');

      // Calculate ROI (placeholder calculation)
      const estimatedCost = sessions * 1.5;
      const roi = estimatedCost > 0 ? Math.round(((revenue - estimatedCost) / estimatedCost) * 100) : 0;

      return {
        country,
        city,
        sessions,
        conversions,
        revenue,
        roi,
      };
    });

    return { success: true, data: geographicData };
  }

  /**
   * Get channel mix data (Organic vs Paid split)
   */
  async getChannelMix(): Promise<GA4ApiResponse<GA4ChannelMix[]>> {
    const requestBody = {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    };

    const result = await this.makeDataApiRequest('runReport', requestBody);

    if (!result.success || !result.data) {
      return result;
    }

    // Calculate total sessions for percentage
    const totalSessions = (result.data.rows || []).reduce((sum: number, row: any) => {
      return sum + parseInt(row.metricValues?.[0]?.value || '0', 10);
    }, 0);

    // Transform response to channel mix objects
    const channelMix: GA4ChannelMix[] = (result.data.rows || []).map((row: any) => {
      const channel = row.dimensionValues?.[0]?.value || 'Unknown';
      const sessions = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const conversions = parseInt(row.metricValues?.[1]?.value || '0', 10);
      const percentage = totalSessions > 0 ? Math.round((sessions / totalSessions) * 100) : 0;

      return {
        channel,
        sessions,
        conversions,
        percentage,
      };
    });

    return { success: true, data: channelMix };
  }

  /**
   * Get lead generation trend over time
   */
  async getLeadTrend(): Promise<GA4ApiResponse<GA4LeadTrend[]>> {
    const requestBody = {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'conversions' },
        { name: 'sessions' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    };

    const result = await this.makeDataApiRequest('runReport', requestBody);

    if (!result.success || !result.data) {
      return result;
    }

    // Transform response to lead trend objects
    const leadTrend: GA4LeadTrend[] = (result.data.rows || []).map((row: any) => {
      const dateStr = row.dimensionValues?.[0]?.value || '';
      // Format date from YYYYMMDD to YYYY-MM-DD
      const formattedDate = dateStr.length === 8
        ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
        : dateStr;

      const conversions = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const sessions = parseInt(row.metricValues?.[1]?.value || '0', 10);

      return {
        date: formattedDate,
        conversions,
        sessions,
      };
    });

    return { success: true, data: leadTrend };
  }

  /**
   * Get session sources (Traffic acquisition: Session source)
   */
  async getSessionSources(): Promise<GA4ApiResponse<GA4SessionSource[]>> {
    const requestBody = {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'bounceRate' },
        { name: 'engagementRate' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 50,
    };

    const result = await this.makeDataApiRequest('runReport', requestBody);

    if (!result.success || !result.data) {
      return result;
    }

    // Transform response to session source objects
    const sessionSources: GA4SessionSource[] = (result.data.rows || []).map((row: any) => {
      const source = row.dimensionValues?.[0]?.value || '(direct)';
      const medium = row.dimensionValues?.[1]?.value || '(none)';
      const sessions = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const conversions = parseInt(row.metricValues?.[1]?.value || '0', 10);
      const bounceRate = parseFloat(row.metricValues?.[2]?.value || '0') * 100;
      const engagementRate = parseFloat(row.metricValues?.[3]?.value || '0') * 100;

      return {
        source,
        medium,
        sessions,
        conversions,
        bounceRate,
        engagementRate,
      };
    });

    return { success: true, data: sessionSources };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get GA4 credentials for an organization
 */
export async function getGA4Credentials(organizationId: string): Promise<GA4Credentials | null> {
  const { data, error } = await (supabase as any)
    .from('platform_integrations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'ga4')
    .maybeSingle();

  if (error) {
    console.error('Failed to get GA4 credentials:', error);
    return null;
  }

  return data as GA4Credentials | null;
}

/**
 * Create a GA4 service instance for an organization
 */
export async function createGA4Service(organizationId: string): Promise<GA4Service | null> {
  const credentials = await getGA4Credentials(organizationId);
  if (!credentials) {
    return null;
  }

  if (!credentials.is_connected) {
    console.error('GA4 is not connected for this organization');
    return null;
  }

  return new GA4Service(credentials);
}

/**
 * Get GA4 properties for an organization
 */
export async function getGA4Properties(
  organizationId: string
): Promise<GA4ApiResponse<GA4Property[]>> {
  const { data, error } = await (supabase as any)
    .from('platform_integration_organizations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'ga4')
    .order('platform_org_name', { ascending: true });

  if (error) {
    console.error('Failed to get GA4 properties:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data: data || [] };
}

/**
 * Get the selected GA4 property for an organization
 */
export async function getSelectedGA4Property(
  organizationId: string
): Promise<GA4ApiResponse<GA4Property | null>> {
  const { data, error } = await (supabase as any)
    .from('platform_integration_organizations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'ga4')
    .eq('is_selected', true)
    .maybeSingle();

  if (error) {
    console.error('Failed to get selected GA4 property:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Select a GA4 property for an organization
 */
export async function selectGA4Property(
  organizationId: string,
  platformOrgId: string
): Promise<GA4ApiResponse<GA4Property>> {
  // First, deselect all properties for this organization
  const { error: deselectError } = await (supabase as any)
    .from('platform_integration_organizations')
    .update({ is_selected: false, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('platform_name', 'ga4');

  if (deselectError) {
    console.error('Failed to deselect properties:', deselectError);
    return { success: false, error: deselectError.message };
  }

  // Then select the specified property
  const { data, error } = await (supabase as any)
    .from('platform_integration_organizations')
    .update({ is_selected: true, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('platform_name', 'ga4')
    .eq('platform_org_id', platformOrgId)
    .select()
    .single();

  if (error) {
    console.error('Failed to select GA4 property:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Disconnect GA4 integration for an organization
 */
export async function disconnectGA4(
  organizationId: string
): Promise<GA4ApiResponse<void>> {
  const credentials = await getGA4Credentials(organizationId);
  if (!credentials) {
    return { success: false, error: 'GA4 integration not found' };
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
    console.error('Failed to disconnect GA4:', updateError);
    return { success: false, error: updateError.message };
  }

  // Delete associated properties
  const { error: deleteError } = await (supabase as any)
    .from('platform_integration_organizations')
    .delete()
    .eq('platform_integration_id', credentials.id);

  if (deleteError) {
    console.error('Failed to delete GA4 properties:', deleteError);
    // Don't fail the disconnect if property deletion fails
  }

  return { success: true };
}
