/**
 * Xero Integration Service
 * Handles Xero OAuth and organization management
 */

import { supabase } from '@/integrations/supabase/client';
import { refreshXeroToken } from './xeroTokenService';

// ============================================
// XERO API CONFIGURATION
// ============================================

const XERO_API_BASE_URL = 'https://api.xero.com/api.xro/2.0';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

// ============================================
// INTERFACES
// ============================================

export interface XeroCredentials {
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

export interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface XeroTenant {
  id: string;
  authEventId: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
  createdDateUtc: string;
  updatedDateUtc: string;
}

export interface XeroApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  BankAccountNumber?: string;
  Status: string;
  Description?: string;
  BankAccountType?: string;
  CurrencyCode?: string;
  TaxType?: string;
  EnablePaymentsToAccount?: boolean;
  ShowInExpenseClaims?: boolean;
  Class: string;
  SystemAccount?: string;
  ReportingCode?: string;
  ReportingCodeName?: string;
  HasAttachments?: boolean;
  UpdatedDateUTC?: string;
  AddToWatchlist?: boolean;
}

export interface XeroReportRow {
  RowType: string;
  Title?: string;
  Cells?: Array<{
    Value: string;
    Attributes?: Array<{ Value: string; Id: string }>;
  }>;
  Rows?: XeroReportRow[];
}

export interface XeroReport {
  ReportID: string;
  ReportName: string;
  ReportType: string;
  ReportTitles: string[];
  ReportDate: string;
  UpdatedDateUTC: string;
  Rows: XeroReportRow[];
}

export interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber: string;
  Type: string;
  Contact: {
    ContactID: string;
    Name: string;
  };
  Date: string;
  DueDate: string;
  Status: string;
  LineAmountTypes: string;
  SubTotal: number;
  TotalTax: number;
  Total: number;
  AmountDue: number;
  AmountPaid: number;
  CurrencyCode: string;
  LineItems?: Array<{
    LineItemID: string;
    Description: string;
    Quantity: number;
    UnitAmount: number;
    AccountCode: string;
    TaxType: string;
    LineAmount: number;
  }>;
}

export interface PlatformIntegrationOrganization {
  id: string;
  organization_id: string;
  platform_integration_id: string;
  user_id: string;
  platform_name: string;
  platform_org_id: string;
  platform_org_name: string | null;
  platform_org_code: string | null;
  email: string | null;
  country: string | null;
  currency: string | null;
  timezone: string | null;
  status: 'active' | 'inactive' | 'suspended' | 'pending';
  is_selected: boolean;
  raw_data: any;
  meta_data: any;
  created_at: string;
  updated_at: string;
}

// ============================================
// XERO SERVICE CLASS
// ============================================

export class XeroService {
  private credentials: XeroCredentials;
  private tenantId: string | null = null;

  constructor(credentials: XeroCredentials) {
    this.credentials = credentials;
  }

  /**
   * Check if the access token is expired
   */
  isTokenExpired(): boolean {
    if (!this.credentials.token_expires_at) return true;
    const expiresAt = new Date(this.credentials.token_expires_at);
    return new Date() >= new Date(expiresAt.getTime() - 5 * 60 * 1000);
  }

  /**
   * Refresh the access token. Delegates to the `xero-refresh-token` edge
   * function, which is the single source of truth — it holds a row-level
   * mutex (`platform_integrations.refresh_lock_at`) so concurrent callers
   * can't each burn the rotating refresh_token and invalidate the chain.
   * Earlier this method called Xero directly from the browser, which
   * caused daily forced reconnects when the dashboard, cost-impact page,
   * and sync triggers all raced to refresh at once.
   */
  async refreshAccessToken(): Promise<XeroApiResponse<XeroTokenResponse>> {
    if (!this.credentials.id) {
      return { success: false, error: 'No integration id available' };
    }

    try {
      const result = await refreshXeroToken(this.credentials.id);
      if (!result.success || !result.access_token) {
        return { success: false, error: result.error || 'Failed to refresh token' };
      }

      // Mirror the freshly-saved values into our in-memory credentials so
      // subsequent calls on this instance use them. We don't get the new
      // refresh_token back (the edge function keeps it server-side) — that's
      // fine, refresh always re-reads from the DB via the edge function.
      this.credentials.access_token = result.access_token;
      if (result.expires_at) {
        this.credentials.token_expires_at = result.expires_at;
      }

      return {
        success: true,
        data: {
          access_token: result.access_token,
          refresh_token: this.credentials.refresh_token || '',
          expires_in: result.expires_in_seconds ?? 0,
          token_type: 'Bearer',
          scope: '',
        },
      };
    } catch (error: any) {
      console.error('Token refresh error:', error);
      return { success: false, error: error.message || 'Token refresh failed' };
    }
  }

  /**
   * Ensure we have a valid access token (refresh if needed). The edge
   * function fast-paths when the token is still valid, so it's safe to
   * call this on every API operation.
   */
  async ensureValidToken(): Promise<XeroApiResponse> {
    if (!this.credentials.id) {
      return { success: false, error: 'No integration id available. Please reconnect to Xero.' };
    }

    if (!this.isTokenExpired() && this.credentials.access_token) {
      return { success: true };
    }

    const refreshResult = await this.refreshAccessToken();
    if (!refreshResult.success) {
      return refreshResult;
    }
    return { success: true };
  }

  /**
   * Get connected Xero tenants/organizations
   */
  async getTenants(): Promise<XeroApiResponse<XeroTenant[]>> {
    const tokenResult = await this.ensureValidToken();
    if (!tokenResult.success) {
      return tokenResult;
    }

    try {
      const response = await fetch(XERO_CONNECTIONS_URL, {
        headers: {
          'Authorization': `Bearer ${this.credentials.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return { success: false, error: `Failed to get tenants: ${response.status}`, status: response.status };
      }

      const tenants: XeroTenant[] = await response.json();

      if (tenants.length > 0 && !this.tenantId) {
        this.tenantId = tenants[0].tenantId;
      }

      return { success: true, data: tenants };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to get tenants' };
    }
  }

  /**
   * Set the active tenant ID
   */
  setTenantId(tenantId: string): void {
    this.tenantId = tenantId;
  }

  /**
   * Get organisation details from Xero
   */
  async getOrganisation(): Promise<XeroApiResponse<{ Organisations: any[] }>> {
    const tokenResult = await this.ensureValidToken();
    if (!tokenResult.success) {
      return tokenResult;
    }

    if (!this.tenantId) {
      return { success: false, error: 'No tenant ID set. Call getTenants() first.' };
    }

    try {
      const response = await fetch(`${XERO_API_BASE_URL}/Organisation`, {
        headers: {
          'Authorization': `Bearer ${this.credentials.access_token}`,
          'Xero-tenant-id': this.tenantId,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `Xero API error: ${response.status}`, status: response.status };
      }

      const data = await response.json();
      return { success: true, data, status: response.status };
    } catch (error: any) {
      return { success: false, error: error.message || 'Request failed' };
    }
  }

  /**
   * Get Chart of Accounts from Xero for the current tenant
   */
  async getChartOfAccounts(): Promise<XeroApiResponse<{ Accounts: XeroAccount[] }>> {
    const tokenResult = await this.ensureValidToken();
    if (!tokenResult.success) {
      return tokenResult;
    }

    if (!this.tenantId) {
      return { success: false, error: 'No tenant ID set. Call getTenants() first.' };
    }

    try {
      const response = await fetch(`${XERO_API_BASE_URL}/Accounts`, {
        headers: {
          'Authorization': `Bearer ${this.credentials.access_token}`,
          'Xero-tenant-id': this.tenantId,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Xero Chart of Accounts API error:', errorText);
        return { success: false, error: `Xero API error: ${response.status}`, status: response.status };
      }

      const data = await response.json();
      return { success: true, data, status: response.status };
    } catch (error: any) {
      console.error('Error fetching Chart of Accounts:', error);
      return { success: false, error: error.message || 'Failed to fetch Chart of Accounts' };
    }
  }

  /**
   * Get Profit and Loss Report from Xero
   * @param fromDate - Start date (YYYY-MM-DD)
   * @param toDate - End date (YYYY-MM-DD)
   */
  async getProfitAndLossReport(fromDate?: string, toDate?: string): Promise<XeroApiResponse<{ Reports: XeroReport[] }>> {
    const tokenResult = await this.ensureValidToken();
    if (!tokenResult.success) {
      return tokenResult;
    }

    if (!this.tenantId) {
      return { success: false, error: 'No tenant ID set. Call getTenants() first.' };
    }

    try {
      let url = `${XERO_API_BASE_URL}/Reports/ProfitAndLoss`;
      const params = new URLSearchParams();
      if (fromDate) params.append('fromDate', fromDate);
      if (toDate) params.append('toDate', toDate);
      if (params.toString()) url += `?${params.toString()}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.credentials.access_token}`,
          'Xero-tenant-id': this.tenantId,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Xero Profit & Loss API error:', errorText);
        return { success: false, error: `Xero API error: ${response.status}`, status: response.status };
      }

      const data = await response.json();
      return { success: true, data, status: response.status };
    } catch (error: any) {
      console.error('Error fetching Profit & Loss report:', error);
      return { success: false, error: error.message || 'Failed to fetch Profit & Loss report' };
    }
  }

  /**
   * Get Balance Sheet Report from Xero
   * @param date - Report date (YYYY-MM-DD)
   */
  async getBalanceSheetReport(date?: string): Promise<XeroApiResponse<{ Reports: XeroReport[] }>> {
    const tokenResult = await this.ensureValidToken();
    if (!tokenResult.success) {
      return tokenResult;
    }

    if (!this.tenantId) {
      return { success: false, error: 'No tenant ID set. Call getTenants() first.' };
    }

    try {
      let url = `${XERO_API_BASE_URL}/Reports/BalanceSheet`;
      if (date) url += `?date=${date}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.credentials.access_token}`,
          'Xero-tenant-id': this.tenantId,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Xero Balance Sheet API error:', errorText);
        return { success: false, error: `Xero API error: ${response.status}`, status: response.status };
      }

      const data = await response.json();
      return { success: true, data, status: response.status };
    } catch (error: any) {
      console.error('Error fetching Balance Sheet report:', error);
      return { success: false, error: error.message || 'Failed to fetch Balance Sheet report' };
    }
  }

  /**
   * Get Invoices from Xero
   * @param options - Filter options for invoices
   */
  async getInvoices(options?: {
    where?: string;
    page?: number;
    modifiedAfter?: string;
  }): Promise<XeroApiResponse<{ Invoices: XeroInvoice[] }>> {
    const tokenResult = await this.ensureValidToken();
    if (!tokenResult.success) {
      return tokenResult;
    }

    if (!this.tenantId) {
      return { success: false, error: 'No tenant ID set. Call getTenants() first.' };
    }

    try {
      let url = `${XERO_API_BASE_URL}/Invoices`;
      const params = new URLSearchParams();
      if (options?.where) params.append('where', options.where);
      if (options?.page) params.append('page', options.page.toString());
      if (params.toString()) url += `?${params.toString()}`;

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.credentials.access_token}`,
        'Xero-tenant-id': this.tenantId,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      if (options?.modifiedAfter) {
        headers['If-Modified-Since'] = options.modifiedAfter;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Xero Invoices API error:', errorText);
        return { success: false, error: `Xero API error: ${response.status}`, status: response.status };
      }

      const data = await response.json();
      return { success: true, data, status: response.status };
    } catch (error: any) {
      console.error('Error fetching Invoices:', error);
      return { success: false, error: error.message || 'Failed to fetch Invoices' };
    }
  }

  /**
   * Get a specific Invoice with line items from Xero
   * @param invoiceId - The Invoice ID
   */
  async getInvoice(invoiceId: string): Promise<XeroApiResponse<{ Invoices: XeroInvoice[] }>> {
    const tokenResult = await this.ensureValidToken();
    if (!tokenResult.success) {
      return tokenResult;
    }

    if (!this.tenantId) {
      return { success: false, error: 'No tenant ID set. Call getTenants() first.' };
    }

    try {
      const response = await fetch(`${XERO_API_BASE_URL}/Invoices/${invoiceId}`, {
        headers: {
          'Authorization': `Bearer ${this.credentials.access_token}`,
          'Xero-tenant-id': this.tenantId,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Xero Invoice API error:', errorText);
        return { success: false, error: `Xero API error: ${response.status}`, status: response.status };
      }

      const data = await response.json();
      return { success: true, data, status: response.status };
    } catch (error: any) {
      console.error('Error fetching Invoice:', error);
      return { success: false, error: error.message || 'Failed to fetch Invoice' };
    }
  }

  /**
   * Get Journal entries from Xero (useful for lease accounting entries)
   * @param options - Filter options
   */
  async getJournals(options?: {
    offset?: number;
    modifiedAfter?: string;
  }): Promise<XeroApiResponse<{ Journals: any[] }>> {
    const tokenResult = await this.ensureValidToken();
    if (!tokenResult.success) {
      return tokenResult;
    }

    if (!this.tenantId) {
      return { success: false, error: 'No tenant ID set. Call getTenants() first.' };
    }

    try {
      let url = `${XERO_API_BASE_URL}/Journals`;
      if (options?.offset) url += `?offset=${options.offset}`;

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.credentials.access_token}`,
        'Xero-tenant-id': this.tenantId,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      if (options?.modifiedAfter) {
        headers['If-Modified-Since'] = options.modifiedAfter;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Xero Journals API error:', errorText);
        return { success: false, error: `Xero API error: ${response.status}`, status: response.status };
      }

      const data = await response.json();
      return { success: true, data, status: response.status };
    } catch (error: any) {
      console.error('Error fetching Journals:', error);
      return { success: false, error: error.message || 'Failed to fetch Journals' };
    }
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Make authenticated API call to Xero with automatic token refresh
 */
export async function makeXeroApiCall<T = any>(
  integrationId: string,
  tenantId: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: string | null }> {
  try {
    // Get valid access token (automatically refreshes if expired)
    const accessToken = await getValidXeroToken(integrationId);

    // Make API call to Xero
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'xero-tenant-id': tenantId,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Xero API call failed: ${response.status} - ${errorText}`);
      return {
        data: null,
        error: `Xero API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.error('Error making Xero API call:', error);
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get Xero credentials for an organization
 */
export async function getXeroCredentials(organizationId: string, integrationId?: string): Promise<XeroCredentials | null> {
  let query = (supabase as any)
    .from('platform_integrations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'xero');

  if (integrationId) {
    query = query.eq('id', integrationId);
  } else {
    // Backward compatibility: get first connected one, or first available
    query = query.order('is_connected', { ascending: false });
  }

  const { data, error } = await query.limit(1).maybeSingle();

  if (error || !data) {
    if (error?.code !== 'PGRST116') {
      console.error('Failed to get Xero credentials:', error);
    }
    return null;
  }

  return data as XeroCredentials;
}

/**
 * Create a XeroService instance for an organization
 */
export async function createXeroService(organizationId: string, integrationId?: string): Promise<XeroService | null> {
  const credentials = await getXeroCredentials(organizationId, integrationId);
  if (!credentials) {
    return null;
  }

  if (!credentials.is_connected) {
    console.error('Xero is not connected for this organization');
    return null;
  }

  return new XeroService(credentials);
}

// ============================================
// PLATFORM INTEGRATION ORGANIZATIONS
// ============================================

/**
 * Get all Xero organizations for a platform integration
 */
export async function getXeroOrganizations(
  organizationId: string
): Promise<XeroApiResponse<PlatformIntegrationOrganization[]>> {
  const { data, error } = await (supabase as any)
    .from('platform_integration_organizations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'xero')
    .order('platform_org_name', { ascending: true });

  if (error) {
    console.error('Failed to get Xero organizations:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data: data || [] };
}

/**
 * Get selected/mapped Xero organization for a platform integration
 * This uses the platform_integration_organization_mapping table to find mapped organizations
 */
export async function getSelectedXeroOrganization(
  organizationId: string
): Promise<XeroApiResponse<PlatformIntegrationOrganization | null>> {
  try {
    // First, try to get from the mapping table
    const { data: mappingData, error: mappingError } = await (supabase as any)
      .from('platform_integration_organization_mapping')
      .select('platform_integration_organizations_id')
      .eq('organization_id', organizationId)
      .limit(1);

    if (mappingError) {
      console.error('Failed to get Xero organization mapping:', mappingError);
    }

    // If we found a mapping, fetch the platform organization details
    if (mappingData && mappingData.length > 0) {
      const platformOrgId = mappingData[0].platform_integration_organizations_id;

      const { data: platformOrg, error: platformOrgError } = await (supabase as any)
        .from('platform_integration_organizations')
        .select('*')
        .eq('id', platformOrgId)
        .eq('platform_name', 'xero')
        .maybeSingle();

      if (platformOrgError) {
        console.error('Failed to get platform organization:', platformOrgError);
      }

      if (platformOrg) {
        return { success: true, data: platformOrg };
      }
    }

    // Fallback: try to get any Xero organization with is_selected = true
    const { data, error } = await (supabase as any)
      .from('platform_integration_organizations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('platform_name', 'xero')
      .eq('is_selected', true)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Failed to get selected Xero organization:', error);
    }

    if (data) {
      return { success: true, data };
    }

    // Final fallback: just get the first available Xero organization
    const { data: firstOrg, error: firstOrgError } = await (supabase as any)
      .from('platform_integration_organizations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('platform_name', 'xero')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (firstOrgError && firstOrgError.code !== 'PGRST116') {
      console.error('Failed to get first Xero organization:', firstOrgError);
      return { success: false, error: firstOrgError.message };
    }

    return { success: true, data: firstOrg || null };
  } catch (err: any) {
    console.error('Error in getSelectedXeroOrganization:', err);
    return { success: false, error: err.message || 'Failed to get Xero organization' };
  }
}

/**
 * Select a Xero organization (sets is_selected = true, others = false)
 */
export async function selectXeroOrganization(
  organizationId: string,
  platformOrgId: string
): Promise<XeroApiResponse<PlatformIntegrationOrganization>> {
  // First, deselect all organizations for this integration
  const { error: deselectError } = await (supabase as any)
    .from('platform_integration_organizations')
    .update({ is_selected: false, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('platform_name', 'xero');

  if (deselectError) {
    console.error('Failed to deselect organizations:', deselectError);
    return { success: false, error: deselectError.message };
  }

  // Then select the specified organization
  const { data, error } = await (supabase as any)
    .from('platform_integration_organizations')
    .update({ is_selected: true, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('platform_name', 'xero')
    .eq('platform_org_id', platformOrgId)
    .select()
    .single();

  if (error) {
    console.error('Failed to select Xero organization:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Refresh Xero organizations from API and update database
 */
export async function refreshXeroOrganizations(
  organizationId: string,
  integrationId?: string
): Promise<XeroApiResponse<{ syncedCount: number }>> {
  const xero = await createXeroService(organizationId, integrationId);
  if (!xero) {
    return { success: false, error: 'Failed to create Xero service' };
  }

  const credentials = await getXeroCredentials(organizationId, integrationId);
  if (!credentials) {
    return { success: false, error: 'Failed to get Xero credentials' };
  }

  // Get tenants from Xero API
  const tenantsResult = await xero.getTenants();
  if (!tenantsResult.success || !tenantsResult.data) {
    return { success: false, error: tenantsResult.error || 'No tenants found' };
  }

  const tenants = tenantsResult.data;
  let syncedCount = 0;

  for (const tenant of tenants) {
    // Fetch organization details
    xero.setTenantId(tenant.tenantId);
    const orgResult = await xero.getOrganisation();
    const orgDetails = orgResult.data?.Organisations?.[0] || null;

    // Upsert to database
    const { error: upsertError } = await (supabase as any)
      .from('platform_integration_organizations')
      .upsert(
        {
          organization_id: organizationId,
          platform_integration_id: credentials.id,
          user_id: credentials.user_id,
          platform_name: 'xero',
          platform_org_id: tenant.tenantId,
          platform_org_name: tenant.tenantName,
          platform_org_code: orgDetails?.ShortCode || null,
          email: orgDetails?.Addresses?.find((a: any) => a.AddressType === 'POBOX')?.Email || null,
          country: orgDetails?.CountryCode || null,
          currency: orgDetails?.BaseCurrency || null,
          timezone: orgDetails?.Timezone || null,
          status: 'active',
          raw_data: { tenant, organisation: orgDetails },
          meta_data: {
            tenantType: tenant.tenantType,
            authEventId: tenant.authEventId,
            organisationType: orgDetails?.OrganisationType || null,
            legalName: orgDetails?.LegalName || null,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'platform_integration_id,platform_org_id' }
      );

    if (!upsertError) {
      syncedCount++;
    }
  }

  return { success: true, data: { syncedCount } };
}

/**
 * Refresh Chart of Accounts from Xero API for a specific organization
 * @param organizationId - The internal organization ID
 * @param platformOrgId - The Xero tenant ID (optional, if not provided will fetch for all connected orgs)
 */
export async function refreshChartOfAccounts(
  organizationId: string,
  platformOrgId?: string,
  integrationId?: string
): Promise<XeroApiResponse<{ syncedCount: number; accounts: XeroAccount[] }>> {
  const xero = await createXeroService(organizationId, integrationId);
  if (!xero) {
    return { success: false, error: 'Failed to create Xero service. Please ensure Xero is connected.' };
  }

  const credentials = await getXeroCredentials(organizationId, integrationId);
  if (!credentials) {
    return { success: false, error: 'Failed to get Xero credentials' };
  }

  try {
    // If platformOrgId is provided, fetch for that specific org
    // Otherwise, get all connected orgs and fetch for the selected one
    let targetTenantId = platformOrgId;

    if (!targetTenantId) {
      // Get selected Xero organization
      const selectedOrgResult = await getSelectedXeroOrganization(organizationId);
      if (!selectedOrgResult.success || !selectedOrgResult.data) {
        return { success: false, error: 'No Xero organization selected. Please select an organization first.' };
      }
      targetTenantId = selectedOrgResult.data.platform_org_id;
    }

    // Get platform_integration_organization record
    const { data: platformOrgData, error: platformOrgError } = await (supabase as any)
      .from('platform_integration_organizations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform_name', 'xero')
      .eq('platform_org_id', targetTenantId)
      .single();

    if (platformOrgError || !platformOrgData) {
      console.error('Error fetching platform organization:', platformOrgError);
      return { success: false, error: 'Failed to find platform organization record' };
    }

    // Get user_id from organization mapping table
    let userId = credentials.user_id;
    if (!userId) {
      const { data: mappingData } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .select('user_id')
        .eq('platform_integration_organizations_id', platformOrgData.id)
        .limit(1)
        .maybeSingle();

      userId = mappingData?.user_id || null;
      console.log('[refreshChartOfAccounts] Got user_id from mapping table:', userId);
    }

    // Set tenant and fetch Chart of Accounts
    xero.setTenantId(targetTenantId);
    const accountsResult = await xero.getChartOfAccounts();

    if (!accountsResult.success || !accountsResult.data?.Accounts) {
      return { success: false, error: accountsResult.error || 'Failed to fetch Chart of Accounts from Xero' };
    }

    const accounts = accountsResult.data.Accounts;
    let syncedCount = 0;

    // Build rows mirroring the Node backend COA processor (same columns + same
    // conflict key). CRITICAL: this must UPSERT, not delete+insert. The location
    // expense / P&L mappings in practice_locations.*_accounts reference these
    // rows by their UUID `id`. A delete+insert regenerates every id, so a
    // disconnect→reconnect (which re-runs this sync) used to orphan every saved
    // mapping → "Removed account". An upsert on the stable natural key keeps the
    // existing row id (ON CONFLICT DO UPDATE), so reconnecting the SAME Xero
    // account leaves all mappings intact.
    const rows = accounts.map((account: any) => ({
      organization_id: organizationId,
      platform_integration_id: credentials.id,
      xero_tenant_id: platformOrgData.id, // tenant row UUID (matches backend; makes rows immediately resolvable)
      user_id: userId, // Use userId from session if credentials.user_id was null
      xero_account_id: account.AccountID,
      account_code: account.Code || null,
      account_name: account.Name || null,
      account_type: account.Type || null,
      account_sub_type: account.SystemAccount || null,
      classification: account.Class || null,
      description: account.Description || null,
      tax_type: account.TaxType || null,
      bank_account_type: account.BankAccountType || null,
      reporting_code: account.ReportingCode || null,
      reporting_name: account.ReportingCodeName || null,
      is_active: account.Status === 'ACTIVE',
    }));

    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error: upsertError } = await (supabase as any)
        .from('xero_chart_of_accounts')
        .upsert(chunk, {
          onConflict: 'organization_id,platform_integration_id,xero_account_id',
          ignoreDuplicates: false,
        });
      if (upsertError) {
        console.error('Error upserting Chart of Accounts:', upsertError);
      } else {
        syncedCount += chunk.length;
      }
    }

    // Remove rows whose Xero AccountID is no longer returned by Xero (the
    // account was archived/deleted upstream). Done AFTER the upsert so a
    // still-valid mapping is never orphaned. These genuinely-removed accounts
    // then read as blank in the location settings (the badge skips unresolved
    // accounts) — per requirement: removed Xero account ⇒ blank mapping.
    const currentAccountIds = rows.map((r: any) => r.xero_account_id).filter(Boolean);
    if (currentAccountIds.length > 0) {
      const inList = `(${currentAccountIds.map((id: string) => `"${id}"`).join(',')})`;
      const { error: staleErr } = await (supabase as any)
        .from('xero_chart_of_accounts')
        .delete()
        .eq('organization_id', organizationId)
        .eq('platform_integration_id', credentials.id)
        .eq('xero_tenant_id', platformOrgData.id)
        .not('xero_account_id', 'in', inList);
      if (staleErr) {
        console.warn('Error removing stale Chart of Accounts:', staleErr.message);
      }
    }

    return {
      success: true,
      data: {
        syncedCount,
        accounts
      }
    };
  } catch (error: any) {
    console.error('Error refreshing Chart of Accounts:', error);
    return { success: false, error: error.message || 'Failed to refresh Chart of Accounts' };
  }
}

/**
 * Refresh Chart of Accounts from Xero API for ALL connected tenants
 * This syncs COA for every Xero organization connected to this account
 * @param organizationId - The internal organization ID
 */
export async function refreshChartOfAccountsForAllTenants(
  organizationId: string,
  integrationId?: string
): Promise<XeroApiResponse<{
  totalSyncedCount: number;
  results: Array<{ tenantId: string; tenantName: string; syncedCount: number; error?: string }>
}>> {
  console.log('[refreshChartOfAccountsForAllTenants] Starting COA sync for all tenants, org:', organizationId, 'integrationId:', integrationId || 'all');

  try {
    // Get all connected Xero organizations for this account
    let orgsQuery = (supabase as any)
      .from('platform_integration_organizations')
      .select('id, platform_org_id, platform_org_name, platform_integration_id')
      .eq('organization_id', organizationId)
      .eq('platform_name', 'xero')
      .eq('status', 'active');

    // Scope to specific integration if provided
    if (integrationId) {
      orgsQuery = orgsQuery.eq('platform_integration_id', integrationId);
    }

    const { data: allOrgs, error: orgsError } = await orgsQuery;

    if (orgsError) {
      console.error('[refreshChartOfAccountsForAllTenants] Error fetching organizations:', orgsError);
      return { success: false, error: 'Failed to fetch connected Xero organizations' };
    }

    if (!allOrgs || allOrgs.length === 0) {
      return { success: false, error: 'No Xero organizations connected' };
    }

    console.log('[refreshChartOfAccountsForAllTenants] Found', allOrgs.length, 'tenants to sync');

    const results: Array<{ tenantId: string; tenantName: string; syncedCount: number; error?: string }> = [];
    let totalSyncedCount = 0;

    // Loop through ALL tenants and sync COA for each
    for (const org of allOrgs) {
      console.log('[refreshChartOfAccountsForAllTenants] Syncing COA for tenant:', org.platform_org_name);

      const result = await refreshChartOfAccounts(organizationId, org.platform_org_id, integrationId || org.platform_integration_id);

      if (result.success && result.data) {
        totalSyncedCount += result.data.syncedCount;
        results.push({
          tenantId: org.platform_org_id,
          tenantName: org.platform_org_name,
          syncedCount: result.data.syncedCount,
        });
        console.log('[refreshChartOfAccountsForAllTenants] Synced', result.data.syncedCount, 'accounts for', org.platform_org_name);
      } else {
        results.push({
          tenantId: org.platform_org_id,
          tenantName: org.platform_org_name,
          syncedCount: 0,
          error: result.error || 'Unknown error',
        });
        console.error('[refreshChartOfAccountsForAllTenants] Failed to sync COA for', org.platform_org_name, ':', result.error);
      }
    }

    console.log('[refreshChartOfAccountsForAllTenants] Total synced:', totalSyncedCount, 'accounts across', allOrgs.length, 'tenants');

    return {
      success: true,
      data: {
        totalSyncedCount,
        results,
      }
    };
  } catch (error: any) {
    console.error('[refreshChartOfAccountsForAllTenants] Error:', error);
    return { success: false, error: error.message || 'Failed to refresh Chart of Accounts for all tenants' };
  }
}

/**
 * Get Chart of Accounts from database for an organization
 */
export async function getStoredChartOfAccounts(
  organizationId: string,
  platformOrgId?: string
): Promise<XeroApiResponse<any[]>> {
  try {
    let query = (supabase as any)
      .from('xero_chart_of_accounts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('platform_name', 'xero')
      .order('account_type', { ascending: true })
      .order('account_code', { ascending: true });

    if (platformOrgId) {
      query = query.eq('platform_integration_organization_id', platformOrgId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching stored Chart of Accounts:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Error fetching stored Chart of Accounts:', error);
    return { success: false, error: error.message || 'Failed to fetch Chart of Accounts' };
  }
}

// ============================================
// OPERATING LEASES SPECIFIC FUNCTIONS
// ============================================

export interface OperatingLeaseData {
  profitAndLoss: any;
  balanceSheet: any;
  leaseAccounts: XeroAccount[];
  invoices: XeroInvoice[];
  rawResponses: {
    profitAndLoss: any;
    balanceSheet: any;
    accounts: any;
    invoices: any;
  };
}

/**
 * Fetch all operating lease related data from Xero via Edge Function
 * This includes P&L report, Balance Sheet, and filtered accounts for leases
 */
export async function fetchOperatingLeasesData(
  organizationId: string,
  options?: {
    fromDate?: string;
    toDate?: string;
    integrationId?: string;
  }
): Promise<XeroApiResponse<OperatingLeaseData>> {
  console.log('[fetchOperatingLeasesData] Starting fetch for org:', organizationId);

  // Set default date range (last 12 months if not specified)
  const toDate = options?.toDate || new Date().toISOString().split('T')[0];
  const fromDate = options?.fromDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0];
  console.log('[fetchOperatingLeasesData] Date range:', fromDate, 'to', toDate);

  try {
    // Call the Supabase Edge Function to fetch Xero data (avoids CORS issues)
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fpqesehkowpvxraommsc.supabase.co';

    console.log('[fetchOperatingLeasesData] Calling xero-data Edge Function...');

    const response = await fetch(`${supabaseUrl}/functions/v1/xero-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        endpoint: 'all',
        from_date: fromDate,
        to_date: toDate,
        integration_id: options?.integrationId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[fetchOperatingLeasesData] Edge Function error:', errorData);
      return { success: false, error: errorData.error || `Request failed: ${response.status}` };
    }

    const result = await response.json();
    console.log('[fetchOperatingLeasesData] Edge Function result:', result);

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to fetch data' };
    }

    const { profitAndLoss, balanceSheet, accounts, invoices } = result.data;

    console.log('[fetchOperatingLeasesData] P&L result:', profitAndLoss?.success, profitAndLoss?.error || '');
    console.log('[fetchOperatingLeasesData] Balance Sheet result:', balanceSheet?.success, balanceSheet?.error || '');
    console.log('[fetchOperatingLeasesData] Accounts result:', accounts?.success, accounts?.error || '', 'Count:', accounts?.data?.Accounts?.length || 0);
    console.log('[fetchOperatingLeasesData] Invoices result:', invoices?.success, invoices?.error || '', 'Count:', invoices?.data?.Invoices?.length || 0);

    // Filter accounts that might be lease-related
    const leaseKeywords = ['lease', 'rent', 'occupancy', 'property', 'premises', 'equipment hire', 'vehicle'];
    const allAccounts = accounts?.data?.Accounts || [];
    const leaseAccounts = allAccounts.filter((account: XeroAccount) => {
      const nameMatch = leaseKeywords.some(keyword =>
        account.Name?.toLowerCase().includes(keyword)
      );
      const descMatch = leaseKeywords.some(keyword =>
        account.Description?.toLowerCase().includes(keyword)
      );
      return (nameMatch || descMatch) && account.Status === 'ACTIVE';
    });

    return {
      success: true,
      data: {
        profitAndLoss: profitAndLoss?.data?.Reports?.[0] || null,
        balanceSheet: balanceSheet?.data?.Reports?.[0] || null,
        leaseAccounts,
        invoices: invoices?.data?.Invoices || [],
        rawResponses: {
          profitAndLoss: profitAndLoss?.data || null,
          balanceSheet: balanceSheet?.data || null,
          accounts: accounts?.data || null,
          invoices: invoices?.data || null,
        },
      },
    };
  } catch (error: any) {
    console.error('[fetchOperatingLeasesData] Error:', error);
    return { success: false, error: error.message || 'Failed to fetch operating leases data' };
  }
}

/**
 * Sync Xero invoices to the database
 * This calls the Edge Function with save_to_db=true to store invoices
 */
export async function syncXeroInvoicesToDatabase(
  organizationId: string,
  options?: {
    fromDate?: string;
    toDate?: string;
    invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL'; // ACCPAY = bills, ACCREC = sales invoices, PL = P/L entries
    integrationId?: string;
  }
): Promise<XeroApiResponse<{
  invoicesSaved: number;
  lineItemsSaved: number;
  errors: string[];
}>> {
  console.log('[syncXeroInvoicesToDatabase] Starting sync for org:', organizationId);

  const toDate = options?.toDate || new Date().toISOString().split('T')[0];
  const fromDate = options?.fromDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0];

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fpqesehkowpvxraommsc.supabase.co';

    console.log('[syncXeroInvoicesToDatabase] Calling xero-data Edge Function with save_to_db=true...');

    const response = await fetch(`${supabaseUrl}/functions/v1/xero-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        endpoint: 'invoices',
        from_date: fromDate,
        to_date: toDate,
        save_to_db: true,
        filters: options?.invoiceType ? { where: `Type=="${options.invoiceType}"` } : undefined,
        integration_id: options?.integrationId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[syncXeroInvoicesToDatabase] Edge Function error:', errorData);
      return { success: false, error: errorData.error || `Request failed: ${response.status}` };
    }

    const result = await response.json();
    console.log('[syncXeroInvoicesToDatabase] Edge Function result:', result);

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to sync invoices' };
    }

    return {
      success: true,
      data: result.sync || { invoicesSaved: 0, lineItemsSaved: 0, errors: [] },
    };
  } catch (error: any) {
    console.error('[syncXeroInvoicesToDatabase] Error:', error);
    return { success: false, error: error.message || 'Failed to sync invoices' };
  }
}

/**
 * Fetch invoices from the database (not from Xero API)
 * This is used to display data without making API calls
 */
export async function fetchStoredInvoices(
  organizationId: string,
  options?: {
    fromDate?: string;
    toDate?: string;
    invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL';
    platformType?: string;
    accountCodes?: string[];
    accountUuids?: string[];
    /**
     * When provided, restricts Xero invoices to the tenant(s) mapped to this
     * location via platform_integration_organization_mapping. Matches the
     * parity with useCostImpactData so subpages and the dashboard report the
     * same totals when a specific location is selected.
     */
    selectedLocationId?: string | null;
  }
): Promise<XeroApiResponse<{
  invoices: any[];
  lineItems: any[];
  lastSyncedAt: string | null;
}>> {
  console.log('[fetchStoredInvoices] Fetching from database for org:', organizationId, 'options:', {
    platformType: options?.platformType || 'xero',
    invoiceType: options?.invoiceType,
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    accountCodes: options?.accountCodes,
    accountUuids: options?.accountUuids,
    selectedLocationId: options?.selectedLocationId,
  });

  try {
    // For iplicit, resolve the mapped legal entity to filter invoices by site_id.
    // platform_type is lowercase in DB — normalize incoming value for safety.
    let siteIdFilter: string | null = null;
    const platformType = (options?.platformType || 'xero').toLowerCase();

    // For Xero (and other invoice-per-tenant platforms), resolve the selected
    // location's Xero tenant(s) to filter by platform_integration_organization_id.
    // If no location selected, aggregate across all tenants mapped to this org.
    let tenantIdFilter: string[] | null = null;
    if (platformType !== 'iplicit') {
      try {
        let mappingQuery = (supabase as any)
          .from('platform_integration_organization_mapping')
          .select('platform_integration_organizations_id')
          .eq('organization_id', organizationId);
        if (options?.selectedLocationId) {
          mappingQuery = mappingQuery.eq('location_id', options.selectedLocationId);
        }
        const { data: mappingRows } = await mappingQuery;
        if (mappingRows && mappingRows.length > 0) {
          const pioIds = (mappingRows as Array<{ platform_integration_organizations_id: string }>)
            .map(m => m.platform_integration_organizations_id);
          const { data: pioRows } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('platform_org_id')
            .in('id', pioIds);
          const ids = ((pioRows ?? []) as Array<{ platform_org_id: string | null }>)
            .map(p => p.platform_org_id).filter((v): v is string => !!v);
          if (ids.length > 0) tenantIdFilter = ids;
        }
        console.log('[fetchStoredInvoices] tenantIdFilter for', platformType, ':', tenantIdFilter ?? '(no mapping — all tenants)');
      } catch (e) {
        console.warn('[fetchStoredInvoices] Error resolving tenant filter:', e);
      }
    }

    if (platformType === 'iplicit') {
      try {
        // Look up the organization mapping to find which iplicit entity is selected
        const { data: mappingData } = await (supabase as any)
          .from('platform_integration_organization_mapping')
          .select('platform_integration_organizations_id')
          .eq('organization_id', organizationId)
          .limit(1);

        if (mappingData && mappingData.length > 0) {
          const { data: platformOrg } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('platform_org_id')
            .eq('id', mappingData[0].platform_integration_organizations_id)
            .eq('platform_name', 'iplicit')
            .maybeSingle();

          if (platformOrg?.platform_org_id) {
            siteIdFilter = platformOrg.platform_org_id;
            console.log('[fetchStoredInvoices] Resolved iplicit site_id filter:', siteIdFilter);
          }
        }

        if (!siteIdFilter) {
          console.log('[fetchStoredInvoices] No iplicit organization mapping found — invoices from all entities will be included');
        }
      } catch (mappingErr) {
        console.warn('[fetchStoredInvoices] Error resolving iplicit entity mapping:', mappingErr);
      }
    }

    // Branch by platform — Xero data lives in dedicated xero_* tables since
    // the 2026-04-23 separation. Sage moved to its own dedicated sage_*
    // tables on 2026-05-28. Iplicit / QuickBooks still use the shared
    // platform_integration_invoices table.
    const isXero = platformType === 'xero';
    const isSage = platformType === 'sage';
    const usesDedicatedTable = isXero || isSage;
    const invoicesTable = isXero
      ? 'xero_invoices'
      : isSage
        ? 'sage_invoices'
        : 'platform_integration_invoices';

    let invoicesQuery = (supabase as any)
      .from(invoicesTable)
      .select('*')
      .eq('organization_id', organizationId)
      .order('invoice_date', { ascending: false });

    // xero_invoices / sage_invoices are provider-specific (no platform_type
    // column); the shared table still needs the filter for iplicit / quickbooks.
    if (!usesDedicatedTable) {
      invoicesQuery = invoicesQuery.eq('platform_type', platformType);
    }

    // For Xero with account filters: force invoice_type='PL_SYNTHETIC'.
    // The P&L roll-up is authoritative — it already includes bills (ACCPAY),
    // bank transactions, manual journals, and credit notes. Summing BOTH
    // PL_SYNTHETIC AND raw invoices double-counts the invoice portion.
    // Sage has only real ACCPAY invoices (no synthetic table), so we use the
    // raw invoices directly — no PL_SYNTHETIC filter applied.
    const hasAccountFilters = (options?.accountCodes && options.accountCodes.length > 0)
      || (options?.accountUuids && options.accountUuids.length > 0);
    if (isXero && hasAccountFilters) {
      invoicesQuery = invoicesQuery.eq('invoice_type', 'PL_SYNTHETIC');
    } else if (options?.invoiceType && !isSage) {
      invoicesQuery = invoicesQuery.eq('invoice_type', options.invoiceType);
    }

    if (options?.fromDate) {
      invoicesQuery = invoicesQuery.gte('invoice_date', options.fromDate);
    }
    if (options?.toDate) {
      invoicesQuery = invoicesQuery.lte('invoice_date', options.toDate);
    }

    // Filter by mapped iplicit legal entity (site_id on platform_integration_invoices).
    if (siteIdFilter && !isXero && !isSage) {
      invoicesQuery = invoicesQuery.eq('site_id', siteIdFilter);
    }

    // Filter by mapped tenant(s) for the selected location.
    // xero_invoices → xero_tenant_id (TEXT, the Xero tenant GUID).
    // sage_invoices → platform_integration_id (UUID — the OAuth integration row).
    //   Sage is single-tenant per OAuth so the mapping's platform_org_id has
    //   to be resolved back to platform_integration_id via PIO before we can
    //   filter sage_invoices.
    // platform_integration_invoices → platform_integration_organization_id (TEXT).
    let sageIntegrationIdFilter: string[] | null = null;
    if (isSage && tenantIdFilter && tenantIdFilter.length > 0) {
      const { data: piiRows } = await (supabase as any)
        .from('platform_integration_organizations')
        .select('platform_integration_id')
        .eq('organization_id', organizationId)
        .eq('platform_name', 'sage')
        .in('platform_org_id', tenantIdFilter);
      const ids = ((piiRows ?? []) as Array<{ platform_integration_id: string | null }>)
        .map(r => r.platform_integration_id)
        .filter((v): v is string => !!v);
      if (ids.length > 0) sageIntegrationIdFilter = ids;
      console.log('[fetchStoredInvoices] Sage platform_integration_id filter:', sageIntegrationIdFilter);
    }

    const tenantColumn = isXero
      ? 'xero_tenant_id'
      : isSage
        ? 'platform_integration_id'
        : 'platform_integration_organization_id';
    const effectiveTenantFilter = isSage ? sageIntegrationIdFilter : tenantIdFilter;
    if (effectiveTenantFilter && effectiveTenantFilter.length === 1) {
      invoicesQuery = invoicesQuery.eq(tenantColumn, effectiveTenantFilter[0]);
    } else if (effectiveTenantFilter && effectiveTenantFilter.length > 1) {
      invoicesQuery = invoicesQuery.in(tenantColumn, effectiveTenantFilter);
    }

    // Exclude only voided invoices. useCostImpactData (the dashboard tile
    // source of truth) does not filter by status at all, and in practice
    // many Xero lab/material line items are attached to ACCPAY bills still
    // in 'draft' status — dropping them here produces zero subtotals while
    // the dashboard reports real figures. Keeping draft included keeps the
    // subpages in lockstep with the dashboard.
    invoicesQuery = invoicesQuery.not('status', 'eq', 'voided');

    const { data: invoices, error: invoicesError } = await invoicesQuery;

    if (invoicesError) {
      console.error('[fetchStoredInvoices] Error fetching invoices:', invoicesError);
      return { success: false, error: invoicesError.message };
    }

    // Log invoice status distribution (voided/draft should be excluded)
    if (invoices && invoices.length > 0) {
      const statusCounts: Record<string, number> = {};
      invoices.forEach((inv: any) => {
        statusCounts[inv.status || 'unknown'] = (statusCounts[inv.status || 'unknown'] || 0) + 1;
      });
      console.log('[fetchStoredInvoices] Invoice status distribution (after excluding voided/draft):', statusCounts);
    }

    // Fetch line items for these invoices.
    // Both Xero (Node backend, processor.js:404/737) and Iplicit store the
    // parent invoice's DB UUID (platform_integration_invoices.id) in
    // line_items.invoice_id. Using platform_invoice_id here returns 0 rows.
    const useDbUuid = true;
    const invoiceIds = invoices?.map((inv: any) => inv.id) || [];

    console.log(`[fetchStoredInvoices] Using ${useDbUuid ? 'DB UUID (inv.id)' : 'platform_invoice_id'} for line items query, ${invoiceIds.length} invoice IDs`);
    if (invoiceIds.length > 0) {
      console.log('[fetchStoredInvoices] Sample invoice IDs:', invoiceIds.slice(0, 3));
    }

    let lineItems: any[] = [];
    if (invoiceIds.length > 0) {
      // Xero line items live in xero_invoice_line_items since the 2026-04-23
      // separation. Sage line items live in sage_invoice_line_items since the
      // 2026-05-28 dedicated-tables migration (PART A.5). Iplicit / QuickBooks
      // still use the shared line_items table.
      const lineItemsTable = isXero
        ? 'xero_invoice_line_items'
        : isSage
          ? 'sage_invoice_line_items'
          : 'platform_integration_invoice_line_items';
      const { data: allItems, error: lineItemsError } = await (supabase as any)
        .from(lineItemsTable)
        .select('*')
        .eq('organization_id', organizationId)
        .in('invoice_id', invoiceIds);

      if (lineItemsError) {
        console.error('[fetchStoredInvoices] Error fetching line items:', lineItemsError);
      }

      // Deduplicate line items (in case DB has duplicates from previous syncs)
      const rawItems = allItems || [];
      const seenKeys = new Set<string>();
      const allLineItems = rawItems.filter((li: any) => {
        const key = li.platform_line_id
          ? `${li.invoice_id}|${li.platform_line_id}`
          : `${li.invoice_id}|${li.account_code}|${li.description}|${li.line_amount}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

      if (rawItems.length !== allLineItems.length) {
        console.warn('[fetchStoredInvoices] Deduplicated line items:', rawItems.length, '→', allLineItems.length);
      }

      console.log('[fetchStoredInvoices] Total line items in DB for these invoices:', allLineItems.length, '(raw before dedup:', rawItems.length, ')');
      if (allLineItems.length > 0) {
        console.log('[fetchStoredInvoices] Unique account_ids BEFORE filter (all items):',
          [...new Set(allLineItems.map((li: any) => li.account_id))]);
        console.log('[fetchStoredInvoices] Unique account_codes BEFORE filter (all items):',
          [...new Set(allLineItems.map((li: any) => li.account_code))]);

        // Per-account breakdown to diagnose totals
        const accountBreakdown: Record<string, { count: number; sum: number }> = {};
        allLineItems.forEach((li: any) => {
          const key = `${li.account_code || '?'}|${li.account_id || '?'}|${li.account_name || '?'}`;
          if (!accountBreakdown[key]) accountBreakdown[key] = { count: 0, sum: 0 };
          accountBreakdown[key].count++;
          accountBreakdown[key].sum += li.line_amount || 0;
        });
        console.log('[fetchStoredInvoices] Per-account breakdown (ALL items):', accountBreakdown);

        // Check for potential duplicates by platform_line_id
        const lineIdCounts: Record<string, number> = {};
        allLineItems.forEach((li: any) => {
          const plid = li.platform_line_id || 'null';
          lineIdCounts[plid] = (lineIdCounts[plid] || 0) + 1;
        });
        const duplicates = Object.entries(lineIdCounts).filter(([, count]) => count > 1);
        if (duplicates.length > 0) {
          console.warn('[fetchStoredInvoices] DUPLICATE platform_line_ids found:', duplicates.slice(0, 10));
        }
      }

      // Client-side filtering by account codes/UUIDs when configured
      const hasAccountCodes = options?.accountCodes && options.accountCodes.length > 0;
      const hasAccountUuids = options?.accountUuids && options.accountUuids.length > 0;

      console.log('[fetchStoredInvoices] Filter check - hasAccountCodes:', hasAccountCodes,
        'hasAccountUuids:', hasAccountUuids,
        'accountCodes:', options?.accountCodes,
        'accountUuids:', options?.accountUuids);

      if ((hasAccountCodes || hasAccountUuids) && allLineItems.length > 0) {
        let accountCodesSet = new Set<string>();
        let resolvedAccountIds = new Set<string>();
        let accountNamesSet = new Set<string>();

        // Detect accounting platform for correct CoA table
        const isIplicitPlatform = platformType === 'iplicit';
        const isSagePlatform = platformType === 'sage';

        // Primary path: resolve from CoA row UUIDs (most reliable)
        if (hasAccountUuids) {
          if (isIplicitPlatform) {
            // Iplicit: accounts stored in iplicit_chart_of_accounts
            const { data: coaRows, error: coaError } = await (supabase as any)
              .from('iplicit_chart_of_accounts')
              .select('account_id, code, name')
              .eq('organization_id', organizationId)
              .in('id', options!.accountUuids);

            if (coaError) {
              console.error('[fetchStoredInvoices] Iplicit CoA UUID lookup error:', coaError);
            }

            (coaRows || []).forEach((r: any) => {
              if (r.code) accountCodesSet.add(String(r.code).trim());
              if (r.account_id) resolvedAccountIds.add(String(r.account_id).trim());
              if (r.name) accountNamesSet.add(String(r.name).trim().toLowerCase());
            });
          } else if (isSagePlatform) {
            // Sage: accounts stored in sage_chart_of_accounts
            const { data: coaRows, error: coaError } = await (supabase as any)
              .from('sage_chart_of_accounts')
              .select('sage_account_id, account_code, account_name')
              .eq('organization_id', organizationId)
              .in('id', options!.accountUuids);

            if (coaError) {
              console.error('[fetchStoredInvoices] Sage CoA UUID lookup error:', coaError);
            }

            (coaRows || []).forEach((r: any) => {
              if (r.account_code) accountCodesSet.add(String(r.account_code).trim());
              if (r.sage_account_id) resolvedAccountIds.add(String(r.sage_account_id).trim());
              if (r.account_name) accountNamesSet.add(String(r.account_name).trim().toLowerCase());
            });
          } else {
            // Xero/QuickBooks: accounts stored in xero_chart_of_accounts
            const { data: coaRows, error: coaError } = await (supabase as any)
              .from('xero_chart_of_accounts')
              .select('xero_account_id, account_code, account_name')
              .eq('organization_id', organizationId)
              .in('id', options!.accountUuids);

            if (coaError) {
              console.error('[fetchStoredInvoices] CoA UUID lookup error:', coaError);
            }

            (coaRows || []).forEach((r: any) => {
              if (r.account_code) accountCodesSet.add(String(r.account_code).trim());
              if (r.xero_account_id) resolvedAccountIds.add(String(r.xero_account_id).trim());
              if (r.account_name) accountNamesSet.add(String(r.account_name).trim().toLowerCase());
            });
          }

          console.log('[fetchStoredInvoices] UUID resolution - from', options!.accountUuids.length, 'UUIDs →',
            'codes:', [...accountCodesSet], 'platform IDs:', [...resolvedAccountIds], 'names:', [...accountNamesSet]);
        }

        // Fallback/supplement: use account codes directly (for Xero or if UUIDs not provided)
        if (hasAccountCodes) {
          options!.accountCodes!.forEach(code => accountCodesSet.add(String(code).trim()));

          if (isIplicitPlatform) {
            const { data: coaRows } = await (supabase as any)
              .from('iplicit_chart_of_accounts')
              .select('account_id, code, name')
              .eq('organization_id', organizationId)
              .in('code', options!.accountCodes);

            (coaRows || []).forEach((r: any) => {
              if (r.account_id) resolvedAccountIds.add(String(r.account_id).trim());
              if (r.name) accountNamesSet.add(String(r.name).trim().toLowerCase());
            });
          } else if (isSagePlatform) {
            const { data: coaRows } = await (supabase as any)
              .from('sage_chart_of_accounts')
              .select('sage_account_id, account_code, account_name')
              .eq('organization_id', organizationId)
              .in('account_code', options!.accountCodes);

            (coaRows || []).forEach((r: any) => {
              if (r.sage_account_id) resolvedAccountIds.add(String(r.sage_account_id).trim());
              if (r.account_name) accountNamesSet.add(String(r.account_name).trim().toLowerCase());
            });
          } else {
            const { data: coaRows } = await (supabase as any)
              .from('xero_chart_of_accounts')
              .select('xero_account_id, account_code, account_name')
              .eq('organization_id', organizationId)
              .in('account_code', options!.accountCodes);

            (coaRows || []).forEach((r: any) => {
              if (r.xero_account_id) resolvedAccountIds.add(String(r.xero_account_id).trim());
              if (r.account_name) accountNamesSet.add(String(r.account_name).trim().toLowerCase());
            });
          }
        }

        console.log('[fetchStoredInvoices] Final filter sets - codes:', [...accountCodesSet],
          'platform IDs:', [...resolvedAccountIds], 'names:', [...accountNamesSet]);

        // Filter: match by account_code OR account_id OR account_name (normalize to strings)
        lineItems = allLineItems.filter((li: any) => {
          const liCode = li.account_code ? String(li.account_code).trim() : '';
          const liId = li.account_id ? String(li.account_id).trim() : '';
          const liName = li.account_name ? String(li.account_name).trim().toLowerCase() : '';
          const matchByCode = liCode && accountCodesSet.has(liCode);
          const matchById = liId && resolvedAccountIds.has(liId);
          const matchByName = liName && accountNamesSet.size > 0 && accountNamesSet.has(liName);
          return matchByCode || matchById || matchByName;
        });

        console.log('[fetchStoredInvoices] After account filter:', lineItems.length, 'of', allLineItems.length, 'line items matched');

        // Log matched items details for debugging totals
        if (lineItems.length > 0) {
          const matchedTotal = lineItems.reduce((sum: number, li: any) => sum + (li.line_amount || 0), 0);
          const matchedInvoiceIds = [...new Set(lineItems.map((li: any) => li.invoice_id))];
          // Map invoice IDs to invoice numbers
          const matchedInvoiceNumbers = matchedInvoiceIds.map((invId: string) => {
            const inv = invoices?.find((i: any) => (useDbUuid ? i.id : i.platform_invoice_id) === invId);
            return inv ? inv.invoice_number || invId : invId;
          });
          // Get invoice dates for matched items
          const matchedInvoiceDates = matchedInvoiceIds.map((invId: string) => {
            const inv = invoices?.find((i: any) => (useDbUuid ? i.id : i.platform_invoice_id) === invId);
            return inv ? `${inv.invoice_number || invId}: ${inv.invoice_date}` : invId;
          });
          console.log('[fetchStoredInvoices] Matched items sum:', matchedTotal, 'from', matchedInvoiceIds.length, 'invoices');
          console.log('[fetchStoredInvoices] Matched invoice numbers:', matchedInvoiceNumbers.slice(0, 10));
          console.log('[fetchStoredInvoices] Matched invoice dates:', matchedInvoiceDates.slice(0, 10));
          console.log('[fetchStoredInvoices] Date range filter applied:', options?.fromDate || 'NONE', 'to', options?.toDate || 'NONE');
          if (!options?.fromDate && !options?.toDate) {
            console.warn('[fetchStoredInvoices] WARNING: No date range filter — total includes ALL historical data. Consider passing fromDate/toDate.');
          }
          // Log first 5 matched items for amount verification, including invoice_number
          console.log('[fetchStoredInvoices] Sample matched items (first 5):',
            lineItems.slice(0, 5).map((li: any) => {
              const inv = invoices?.find((i: any) => (useDbUuid ? i.id : i.platform_invoice_id) === li.invoice_id);
              return {
                account_code: li.account_code,
                line_amount: li.line_amount,
                description: li.description?.substring(0, 50),
                invoice_id: li.invoice_id,
                invoice_number: inv?.invoice_number || li.invoice_id,
              };
            }));
        }

        // If no items matched but we have line items, log details for debugging
        if (lineItems.length === 0 && allLineItems.length > 0) {
          console.warn('[fetchStoredInvoices] NO line items matched the account filter!');
          console.warn('[fetchStoredInvoices] Sample line items (first 5):',
            allLineItems.slice(0, 5).map((li: any) => ({ account_code: li.account_code, account_id: li.account_id, account_name: li.account_name, line_amount: li.line_amount })));
          console.warn('[fetchStoredInvoices] Filter was looking for codes:', [...accountCodesSet], 'or platform IDs:', [...resolvedAccountIds], 'or names:', [...accountNamesSet]);
        }
      } else {
        // No filter configured — return all line items
        console.warn('[fetchStoredInvoices] NO account filter applied — returning all', allLineItems.length, 'line items unfiltered');
        lineItems = allLineItems;
      }
    }

    // Get last synced timestamp (latest updated_at from invoices)
    const lastSyncedAt = invoices?.length > 0
      ? invoices.reduce((latest: string | null, inv: any) => {
          if (!latest || new Date(inv.updated_at) > new Date(latest)) {
            return inv.updated_at;
          }
          return latest;
        }, null)
      : null;

    console.log('[fetchStoredInvoices] Found', invoices?.length || 0, 'invoices,', lineItems.length, 'line items');

    // Resolve site_id → location name from platform_integration_organizations.
    // Xero-synced rows don't populate `site_id` (that column was originally the
    // Dentally site_id) — the Xero tenant GUID lives in
    // `platform_integration_organization_id` instead. Falling back to it here
    // means Xero invoices resolve to their tenant/location name without needing
    // a schema migration or resync.
    let siteIdToNameMap: Record<string, string> = {};
    if (invoices && invoices.length > 0) {
      if (isSage) {
        // Sage rows expose platform_integration_id (not platform_org_id). Build
        // the name map by looking up PIO rows by platform_integration_id and
        // keying the result by that same id so the downstream transform finds it.
        const uniquePiis = [...new Set(
          invoices.map((inv: any) => inv.platform_integration_id).filter(Boolean),
        )] as string[];
        if (uniquePiis.length > 0) {
          const { data: orgRows } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('platform_integration_id, platform_org_name')
            .eq('organization_id', organizationId)
            .eq('platform_name', 'sage')
            .in('platform_integration_id', uniquePiis);
          (orgRows || []).forEach((row: any) => {
            if (row.platform_integration_id && row.platform_org_name) {
              siteIdToNameMap[row.platform_integration_id] = row.platform_org_name;
            }
          });
          console.log('[fetchStoredInvoices] Resolved Sage platform_integration_ids to business names:', siteIdToNameMap);
        }
      } else {
        const uniqueSiteIds = [...new Set(
          invoices.map((inv: any) => inv.site_id || inv.xero_tenant_id || inv.platform_integration_organization_id).filter(Boolean),
        )] as string[];
        if (uniqueSiteIds.length > 0) {
          const { data: orgRows } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('platform_org_id, platform_org_name')
            .eq('organization_id', organizationId)
            .in('platform_org_id', uniqueSiteIds);

          (orgRows || []).forEach((row: any) => {
            if (row.platform_org_id && row.platform_org_name) {
              siteIdToNameMap[row.platform_org_id] = row.platform_org_name;
            }
          });
          console.log('[fetchStoredInvoices] Resolved site_ids to location names:', siteIdToNameMap);
        }
      }
    }

    // Transform to match the Xero API format for compatibility
    let transformedInvoices = invoices?.map((inv: any) => {
      // Sage stores the tenant identity on platform_integration_id (single
      // tenant per OAuth), so prefer it for Sage rows. Other providers keep
      // their existing fallback chain.
      const effectiveSiteId = isSage
        ? inv.platform_integration_id
        : (inv.site_id || inv.xero_tenant_id || inv.platform_integration_organization_id);
      return {
      InvoiceID: inv.platform_invoice_id,
      InvoiceNumber: inv.invoice_number,
      Type: inv.invoice_type,
      Contact: {
        ContactID: inv.contact_id,
        Name: inv.contact_name,
      },
      Date: inv.invoice_date,
      DueDate: inv.due_date,
      Status: inv.status?.toUpperCase() || 'AUTHORISED',
      SubTotal: inv.subtotal,
      TotalTax: inv.tax_amount,
      Total: inv.total_amount,
      AmountDue: inv.amount_outstanding,
      AmountPaid: inv.amount_paid,
      CurrencyCode: inv.currency,
      SiteId: effectiveSiteId || null,
      LocationName: (effectiveSiteId && siteIdToNameMap[effectiveSiteId]) || null,
      LineItems: lineItems
        .filter((li: any) => li.invoice_id === (useDbUuid ? inv.id : inv.platform_invoice_id))
        .map((li: any) => ({
          LineItemID: li.platform_line_id,
          Description: li.description,
          Quantity: li.quantity,
          UnitAmount: li.unit_amount,
          AccountCode: li.account_code,
          ItemCode: li.item_code,
          TaxType: li.tax_type,
          TaxAmount: li.tax_amount,
          LineAmount: li.line_amount,
        })),
      };
    }) || [];

    // When filtering by account codes/UUIDs, remove invoices with no matching line items
    const isFiltering = (options?.accountCodes && options.accountCodes.length > 0)
      || (options?.accountUuids && options.accountUuids.length > 0);
    if (isFiltering) {
      transformedInvoices = transformedInvoices.filter((inv: any) => inv.LineItems.length > 0);
    }

    return {
      success: true,
      data: {
        invoices: transformedInvoices,
        lineItems,
        lastSyncedAt,
      },
    };
  } catch (error: any) {
    console.error('[fetchStoredInvoices] Error:', error);
    return { success: false, error: error.message || 'Failed to fetch stored invoices' };
  }
}

/**
 * Sync invoices from Xero to database and return the updated data
 * This fetches fresh data from Xero, saves to DB, and returns the data
 */
export async function syncAndFetchInvoices(
  organizationId: string,
  options?: {
    fromDate?: string;
    toDate?: string;
    invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL';
    accountCodes?: string[];
    integrationId?: string;
  }
): Promise<XeroApiResponse<{
  invoices: any[];
  lineItems: any[];
  syncResult: { invoicesSaved: number; lineItemsSaved: number; errors: string[] };
}>> {
  console.log('[syncAndFetchInvoices] Syncing from Xero for org:', organizationId);

  const toDate = options?.toDate || new Date().toISOString().split('T')[0];
  const fromDate = options?.fromDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0];

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fpqesehkowpvxraommsc.supabase.co';

    console.log('[syncAndFetchInvoices] Calling xero-data Edge Function with save_to_db=true...');

    const response = await fetch(`${supabaseUrl}/functions/v1/xero-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        endpoint: 'invoices',
        from_date: fromDate,
        to_date: toDate,
        save_to_db: true,
        filters: options?.invoiceType ? { where: `Type=="${options.invoiceType}"` } : undefined,
        integration_id: options?.integrationId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[syncAndFetchInvoices] Edge Function error:', errorData);
      return { success: false, error: errorData.error || `Request failed: ${response.status}` };
    }

    const result = await response.json();
    console.log('[syncAndFetchInvoices] Edge Function result:', result);

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to sync invoices' };
    }

    // Get the fresh data from DB after sync
    const storedData = await fetchStoredInvoices(organizationId, { ...options, platformType: 'Xero' });

    if (!storedData.success) {
      return { success: false, error: storedData.error || 'Failed to fetch synced data' };
    }

    return {
      success: true,
      data: {
        invoices: storedData.data?.invoices || [],
        lineItems: storedData.data?.lineItems || [],
        syncResult: result.sync || { invoicesSaved: 0, lineItemsSaved: 0, errors: [] },
      },
    };
  } catch (error: any) {
    console.error('[syncAndFetchInvoices] Error:', error);
    return { success: false, error: error.message || 'Failed to sync invoices' };
  }
}

/**
 * Platform-aware sync dispatcher.
 * Routes to the correct edge function based on connected platform,
 * then fetches the fresh data from the unified DB tables.
 */
export async function syncInvoicesForPlatform(
  organizationId: string,
  platform: 'xero' | 'iplicit' | 'quickbooks',
  options?: {
    fromDate?: string;
    toDate?: string;
    invoiceType?: 'ACCPAY' | 'ACCREC' | 'PL';
    connectionId?: string;
    accountCodes?: string[];
    accountUuids?: string[];
  }
): Promise<XeroApiResponse<{
  invoices: any[];
  lineItems: any[];
  syncResult: { invoicesSaved: number; lineItemsSaved: number; errors: string[] };
}>> {
  console.log('[syncInvoicesForPlatform] Platform:', platform, 'Org:', organizationId);

  if (platform === 'xero') {
    return syncAndFetchInvoices(organizationId, { ...options, integrationId: options?.connectionId });
  }

  if (platform === 'quickbooks') {
    return { success: false, error: 'QuickBooks sync is not yet available.' };
  }

  // iplicit sync
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fpqesehkowpvxraommsc.supabase.co';

    console.log('[syncInvoicesForPlatform] Calling iplicit-sync Edge Function...');

    const response = await fetch(`${supabaseUrl}/functions/v1/iplicit-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        connectionId: options?.connectionId,
        organizationId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[syncInvoicesForPlatform] iplicit-sync error:', errorData);
      return { success: false, error: errorData.error || `Request failed: ${response.status}` };
    }

    const result = await response.json();
    console.log('[syncInvoicesForPlatform] iplicit-sync result:', result);

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to sync from iplicit' };
    }

    // Fetch fresh data from DB after sync
    const storedData = await fetchStoredInvoices(organizationId, { ...options, platformType: 'iplicit' });

    if (!storedData.success) {
      return { success: false, error: storedData.error || 'Failed to fetch synced data' };
    }

    return {
      success: true,
      data: {
        invoices: storedData.data?.invoices || [],
        lineItems: storedData.data?.lineItems || [],
        syncResult: {
          invoicesSaved: result.purchaseInvoicesSaved || result.sync?.invoicesSaved || 0,
          lineItemsSaved: result.lineItemsSaved || result.sync?.lineItemsSaved || 0,
          errors: result.errors || [],
        },
      },
    };
  } catch (error: any) {
    console.error('[syncInvoicesForPlatform] Error:', error);
    return { success: false, error: error.message || 'Failed to sync invoices' };
  }
}

/**
 * Parse Xero Profit & Loss report to extract expense data by category
 */
export function parseXeroProfitAndLossReport(report: XeroReport | null): {
  expenses: Array<{ name: string; amount: number; accountCode?: string; section?: string }>;
  totalExpenses: number;
  leaseExpenses: Array<{ name: string; amount: number; accountCode?: string }>;
  totalLeaseExpenses: number;
  allSections: string[];
} {
  const result = {
    expenses: [] as Array<{ name: string; amount: number; accountCode?: string; section?: string }>,
    totalExpenses: 0,
    leaseExpenses: [] as Array<{ name: string; amount: number; accountCode?: string }>,
    totalLeaseExpenses: 0,
    allSections: [] as string[],
  };

  if (!report?.Rows) {
    console.log('[parseXeroProfitAndLossReport] No rows in report');
    return result;
  }

  console.log('[parseXeroProfitAndLossReport] Report has', report.Rows.length, 'top-level rows');

  const leaseKeywords = ['lease', 'rent', 'occupancy', 'property', 'premises', 'equipment hire', 'vehicle', 'motor', 'car'];

  const processRows = (rows: XeroReportRow[], sectionTitle?: string) => {
    for (const row of rows) {
      if (row.RowType === 'Row' && row.Cells && row.Cells.length >= 2) {
        const name = row.Cells[0]?.Value || '';
        const amountStr = row.Cells[1]?.Value || '0';
        const amount = parseFloat(amountStr.replace(/[^0-9.-]/g, '')) || 0;
        const accountCode = row.Cells[0]?.Attributes?.[0]?.Value;

        if (name && amount !== 0) {
          result.expenses.push({ name, amount, accountCode, section: sectionTitle });
          result.totalExpenses += Math.abs(amount);

          // Check if this is a lease-related expense
          if (leaseKeywords.some(keyword => name.toLowerCase().includes(keyword))) {
            result.leaseExpenses.push({ name, amount, accountCode });
            result.totalLeaseExpenses += Math.abs(amount);
          }
        }
      }

      // Process nested rows
      if (row.Rows) {
        processRows(row.Rows, sectionTitle);
      }
    }
  };

  // Process ALL sections to capture all data
  for (const section of report.Rows) {
    if (section.RowType === 'Section' && section.Title) {
      result.allSections.push(section.Title);
      console.log('[parseXeroProfitAndLossReport] Processing section:', section.Title);

      if (section.Rows) {
        processRows(section.Rows, section.Title);
      }
    }
  }

  console.log('[parseXeroProfitAndLossReport] Found', result.expenses.length, 'expenses,', result.leaseExpenses.length, 'lease expenses');
  console.log('[parseXeroProfitAndLossReport] Sections found:', result.allSections);

  return result;
}
