/**
 * Google Ads Data Fetch Edge Function
 *
 * ARCHITECTURE: MCC (Manager) → Client Account
 * =============================================
 *
 * Google Ads has a hierarchical structure:
 * - MCC (Manager Account): Controls access, owns the developer token
 * - Client Accounts: Where actual campaigns and data live
 *
 * KEY RULES:
 * 1. MCC accounts CANNOT return campaign/metrics data directly
 * 2. Campaign data MUST be queried from the CLIENT account
 * 3. When accessing a client under an MCC, EVERY request must include:
 *    - Header: `login-customer-id: {MCC_ID}` (the manager account ID)
 *    - URL: `/customers/{CLIENT_ID}/googleAds:search` (the client account ID)
 *
 * Example:
 *   MCC ID: 9859949182 (goes in login-customer-id header)
 *   Client ID: 5642011237 (goes in URL path)
 *
 * The developer token is tied to the MCC account.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API_VERSION = "v23";
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

// ============================================
// TYPES
// ============================================

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GoogleAdsApiError {
  error: {
    code: number;
    message: string;
    status: string;
    details?: any[];
  };
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  campaignType: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  costPerConversion: number;
  ctr: string;
  avgCpc: number;
}

interface AccountMetrics {
  totalSpend: number;
  totalConversions: number;
  totalClicks: number;
  totalImpressions: number;
  averageCpc: number;
  costPerConversion: number;
}

interface AccountInfo {
  accountName: string;
  currency: string;
  timezone: string;
}

// ============================================
// TOKEN MANAGEMENT
// ============================================

/**
 * Refresh the OAuth access token using the refresh token
 */
async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResponse | null> {
  try {
    console.log("Refreshing OAuth access token...");

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Token refresh failed:", response.status, responseText);
      return null;
    }

    const tokenData = JSON.parse(responseText);
    console.log("Token refreshed successfully");
    return tokenData;
  } catch (error) {
    console.error("Token refresh error:", error);
    return null;
  }
}

// ============================================
// GOOGLE ADS API EXECUTION
// ============================================

/**
 * Execute a GAQL query against the Google Ads API
 *
 * @param accessToken - OAuth access token for authentication
 * @param developerToken - Google Ads API developer token (tied to MCC)
 * @param clientCustomerId - The CLIENT account ID to query (where campaigns live)
 * @param mccCustomerId - The MCC/Manager account ID (owns the developer token)
 * @param query - GAQL query string
 *
 * IMPORTANT:
 * - clientCustomerId goes in the URL path (this is where we fetch data FROM)
 * - mccCustomerId goes in the login-customer-id header (this authorizes access)
 */
async function executeGoogleAdsQuery(
  accessToken: string,
  developerToken: string,
  clientCustomerId: string,
  mccCustomerId: string,
  query: string
): Promise<{ success: boolean; data?: any; error?: string; statusCode?: number }> {
  // Clean customer IDs (remove any dashes)
  const cleanClientId = clientCustomerId.replace(/-/g, "");
  const cleanMccId = mccCustomerId.replace(/-/g, "");

  // URL uses the CLIENT account ID - this is where campaign data lives
  const url = `${GOOGLE_ADS_BASE_URL}/customers/${cleanClientId}/googleAds:search`;

  console.log("=== Google Ads API Request ===");
  console.log("URL:", url);
  console.log("Client ID (in URL):", cleanClientId);
  console.log("MCC ID (login-customer-id header):", cleanMccId);
  console.log("Developer Token present:", !!developerToken, "length:", developerToken?.length || 0);
  console.log("Access Token present:", !!accessToken, "length:", accessToken?.length || 0);

  // Validate inputs before making request
  if (!developerToken) {
    console.error("ERROR: Developer token is missing or empty!");
    return {
      success: false,
      error: "Developer token is not configured. Please set GOOGLE_ADS_DEVELOPER_TOKEN in environment variables.",
    };
  }

  if (!accessToken) {
    console.error("ERROR: Access token is missing or empty!");
    return {
      success: false,
      error: "Access token is missing. Please reconnect Google Ads.",
    };
  }

  // Build headers
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
    // ALWAYS include login-customer-id header with MCC ID
    // This is required when accessing client accounts under an MCC
    "login-customer-id": cleanMccId,
  };

  console.log("Request headers (sanitized):", {
    "Authorization": "Bearer [REDACTED]",
    "developer-token": `[${developerToken.substring(0, 4)}...${developerToken.substring(developerToken.length - 4)}]`,
    "Content-Type": "application/json",
    "login-customer-id": cleanMccId,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: query.trim() }),
    });

    const responseText = await response.text();

    console.log("Response status:", response.status);
    console.log("Response content-type:", response.headers.get("content-type"));
    console.log("Response preview (first 500 chars):", responseText.substring(0, 500));

    // Check if response is HTML (indicates malformed request or wrong endpoint)
    if (responseText.trim().startsWith("<!") || responseText.trim().startsWith("<html") || responseText.includes("<!DOCTYPE")) {
      console.error("ERROR: Received HTML response - request is malformed");
      console.error("This usually means:");
      console.error("1. Developer token is invalid or not approved");
      console.error("2. The API endpoint URL is incorrect");
      console.error("3. There's a redirect happening (check if token is expired)");
      return {
        success: false,
        error: `Received HTML response (HTTP ${response.status}). Check: 1) Developer token is valid and approved, 2) MCC ID (${cleanMccId}) has access to client (${cleanClientId}), 3) Access token is valid.`,
        statusCode: response.status,
      };
    }

    if (!response.ok) {
      console.error("Google Ads API error:", response.status);

      // Parse error response
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorJson: GoogleAdsApiError = JSON.parse(responseText);
        if (errorJson.error) {
          errorMessage = errorJson.error.message || errorJson.error.status || `Error code: ${errorJson.error.code}`;

          // Log detailed error info for debugging
          console.error("API Error Details:", JSON.stringify(errorJson.error, null, 2));
        }
      } catch {
        // If we can't parse JSON, use truncated response text
        errorMessage = responseText.substring(0, 300);
      }

      return { success: false, error: errorMessage, statusCode: response.status };
    }

    const data = JSON.parse(responseText);
    console.log("API call successful, results count:", data.results?.length || 0);
    return { success: true, data };

  } catch (error) {
    console.error("Google Ads API fetch error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// ============================================
// DATA FETCHING FUNCTIONS
// ============================================

/**
 * Fetch campaigns with metrics from the CLIENT account
 *
 * Note: MCC accounts cannot return campaign data - must query client account
 */
async function fetchCampaigns(
  accessToken: string,
  developerToken: string,
  clientCustomerId: string,
  mccCustomerId: string
): Promise<{ campaigns: Campaign[]; error?: string }> {
  // GAQL query to fetch campaigns with metrics for last 30 days
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.cost_per_conversion,
      metrics.average_cpc,
      metrics.ctr
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `;

  const result = await executeGoogleAdsQuery(
    accessToken,
    developerToken,
    clientCustomerId,  // Query FROM the client account
    mccCustomerId,     // Authorize WITH the MCC account
    query
  );

  if (!result.success) {
    return { campaigns: [], error: result.error };
  }

  // Map channel types to human-readable names
  const channelTypeMap: Record<string, string> = {
    "SEARCH": "Search",
    "DISPLAY": "Display",
    "SHOPPING": "Shopping",
    "VIDEO": "Video",
    "MULTI_CHANNEL": "Multi-Channel",
    "LOCAL": "Local",
    "SMART": "Smart",
    "PERFORMANCE_MAX": "Performance Max",
    "LOCAL_SERVICES": "Local Services",
    "DISCOVERY": "Discovery",
    "TRAVEL": "Travel",
  };

  const campaigns: Campaign[] = [];
  const results = result.data?.results || [];

  for (const row of results) {
    const campaign = row.campaign || {};
    const metrics = row.metrics || {};

    campaigns.push({
      id: String(campaign.id || ""),
      name: campaign.name || "Unknown Campaign",
      status: campaign.status === "ENABLED" ? "Enabled"
            : campaign.status === "PAUSED" ? "Paused"
            : campaign.status || "Unknown",
      campaignType: channelTypeMap[campaign.advertisingChannelType] || campaign.advertisingChannelType || "Unknown",
      // Google Ads API returns monetary values in micros (1/1,000,000 of currency unit)
      spend: (metrics.costMicros || 0) / 1_000_000,
      clicks: parseInt(metrics.clicks) || 0,
      impressions: parseInt(metrics.impressions) || 0,
      conversions: parseFloat(metrics.conversions) || 0,
      costPerConversion: (metrics.costPerConversion || 0) / 1_000_000,
      ctr: metrics.ctr ? `${(parseFloat(metrics.ctr) * 100).toFixed(2)}%` : "0%",
      avgCpc: (metrics.averageCpc || 0) / 1_000_000,
    });
  }

  return { campaigns };
}

/**
 * Fetch account-level aggregated metrics from the CLIENT account
 */
async function fetchAccountMetrics(
  accessToken: string,
  developerToken: string,
  clientCustomerId: string,
  mccCustomerId: string
): Promise<{ metrics: AccountMetrics; error?: string }> {
  const query = `
    SELECT
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.average_cpc,
      metrics.cost_per_conversion
    FROM customer
    WHERE segments.date DURING LAST_30_DAYS
  `;

  const result = await executeGoogleAdsQuery(
    accessToken,
    developerToken,
    clientCustomerId,
    mccCustomerId,
    query
  );

  const defaultMetrics: AccountMetrics = {
    totalSpend: 0,
    totalConversions: 0,
    totalClicks: 0,
    totalImpressions: 0,
    averageCpc: 0,
    costPerConversion: 0,
  };

  if (!result.success) {
    return { metrics: defaultMetrics, error: result.error };
  }

  // Aggregate metrics from results (may have multiple rows for date segments)
  let totalSpend = 0;
  let totalClicks = 0;
  let totalImpressions = 0;
  let totalConversions = 0;
  let totalCpcSum = 0;
  let cpcCount = 0;

  const results = result.data?.results || [];
  for (const row of results) {
    const metrics = row.metrics || {};
    totalSpend += (metrics.costMicros || 0) / 1_000_000;
    totalClicks += parseInt(metrics.clicks) || 0;
    totalImpressions += parseInt(metrics.impressions) || 0;
    totalConversions += parseFloat(metrics.conversions) || 0;
    if (metrics.averageCpc) {
      totalCpcSum += (metrics.averageCpc || 0) / 1_000_000;
      cpcCount++;
    }
  }

  return {
    metrics: {
      totalSpend,
      totalConversions: Math.round(totalConversions),
      totalClicks,
      totalImpressions,
      averageCpc: cpcCount > 0 ? totalCpcSum / cpcCount : 0,
      costPerConversion: totalConversions > 0 ? totalSpend / totalConversions : 0,
    },
  };
}

/**
 * Fetch account info (name, currency, timezone) from the CLIENT account
 */
async function fetchAccountInfo(
  accessToken: string,
  developerToken: string,
  clientCustomerId: string,
  mccCustomerId: string
): Promise<{ info: AccountInfo; error?: string }> {
  const query = `
    SELECT
      customer.descriptive_name,
      customer.currency_code,
      customer.time_zone
    FROM customer
    LIMIT 1
  `;

  const result = await executeGoogleAdsQuery(
    accessToken,
    developerToken,
    clientCustomerId,
    mccCustomerId,
    query
  );

  const defaultInfo: AccountInfo = {
    accountName: "Google Ads Account",
    currency: "GBP",
    timezone: "Europe/London",
  };

  if (!result.success) {
    return { info: defaultInfo, error: result.error };
  }

  const results = result.data?.results || [];
  if (results.length > 0) {
    const customer = results[0].customer || {};
    return {
      info: {
        accountName: customer.descriptiveName || defaultInfo.accountName,
        currency: customer.currencyCode || defaultInfo.currency,
        timezone: customer.timeZone || defaultInfo.timezone,
      },
    };
  }

  return { info: defaultInfo };
}

/**
 * Fetch all Google Ads data (campaigns, metrics, account info) in parallel
 */
async function fetchAllGoogleAdsData(
  accessToken: string,
  developerToken: string,
  clientCustomerId: string,
  mccCustomerId: string
): Promise<{
  success: boolean;
  data?: { campaigns: Campaign[]; accountMetrics: AccountMetrics; accountInfo: AccountInfo };
  error?: string
}> {
  console.log("=== Fetching Google Ads Data ===");
  console.log("Client Account ID (data source):", clientCustomerId);
  console.log("MCC Account ID (authorization):", mccCustomerId);

  try {
    // Fetch all data in parallel for better performance
    const [campaignsResult, metricsResult, accountInfoResult] = await Promise.all([
      fetchCampaigns(accessToken, developerToken, clientCustomerId, mccCustomerId),
      fetchAccountMetrics(accessToken, developerToken, clientCustomerId, mccCustomerId),
      fetchAccountInfo(accessToken, developerToken, clientCustomerId, mccCustomerId),
    ]);

    // Collect any errors
    const errors: string[] = [];
    if (campaignsResult.error) errors.push(`Campaigns: ${campaignsResult.error}`);
    if (metricsResult.error) errors.push(`Metrics: ${metricsResult.error}`);
    if (accountInfoResult.error) errors.push(`Account Info: ${accountInfoResult.error}`);

    // If ALL queries failed, return error
    if (errors.length === 3) {
      return {
        success: false,
        error: errors.join("; "),
      };
    }

    // Log any partial errors but continue with available data
    if (errors.length > 0) {
      console.warn("Partial errors:", errors.join("; "));
    }

    return {
      success: true,
      data: {
        campaigns: campaignsResult.campaigns,
        accountMetrics: metricsResult.metrics,
        accountInfo: accountInfoResult.info,
      },
    };
  } catch (error) {
    console.error("Error fetching Google Ads data:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================
// MAIN REQUEST HANDLER
// ============================================

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Validate authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user's JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body = await req.json();
    const { integrationId, forceRefresh = false } = body;

    if (!integrationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing integration ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get environment variables
    const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
    const mccCustomerId = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID"); // MCC ID for login-customer-id header
    const clientIdEnv = Deno.env.get("GOOGLE_ADS_CLIENT_ID");
    const clientSecretEnv = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET");

    // Log environment variable status for debugging
    console.log("=== Environment Variables Check ===");
    console.log("GOOGLE_ADS_DEVELOPER_TOKEN:", developerToken ? `SET (${developerToken.length} chars)` : "NOT SET");
    console.log("GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC):", mccCustomerId || "NOT SET");
    console.log("GOOGLE_ADS_CLIENT_ID:", clientIdEnv ? "SET" : "NOT SET");
    console.log("GOOGLE_ADS_CLIENT_SECRET:", clientSecretEnv ? "SET" : "NOT SET");

    // Validate required environment variables
    if (!developerToken) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration error: Missing GOOGLE_ADS_DEVELOPER_TOKEN",
          hint: "The developer token must be set in Supabase Edge Function secrets. Get it from Google Ads API Center.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!mccCustomerId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration error: Missing GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC ID)",
          hint: "Set your MCC/Manager account ID (e.g., 9859949182) in Supabase Edge Function secrets",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Environment validation passed. MCC ID:", mccCustomerId);

    // Fetch integration record from database
    const { data: integration, error: fetchError } = await supabase
      .from("platform_integrations")
      .select("*")
      .eq("id", integrationId)
      .eq("platform_name", "google_ads")
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching integration:", fetchError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch integration", details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!integration) {
      return new Response(
        JSON.stringify({ success: false, error: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch Google Ads data record (contains the CLIENT customer ID)
    const { data: googleAdsData } = await supabase
      .from("platform_integration_google_ads_data")
      .select("*")
      .eq("platform_integration_id", integrationId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fallback: try by organization_id
    let adsDataRecord = googleAdsData;
    if (!adsDataRecord) {
      const { data: fallbackData } = await supabase
        .from("platform_integration_google_ads_data")
        .select("*")
        .eq("organization_id", integration.organization_id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      adsDataRecord = fallbackData;
    }

    if (!adsDataRecord) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Google Ads account not configured. Please connect your Google Ads account first.",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The CLIENT customer ID - this is where we fetch data FROM
    const clientCustomerId = adsDataRecord.customer_id;
    if (!clientCustomerId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing client customer ID in configuration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use login_customer_id from DB (set during OAuth callback), fallback to env var, then to client ID itself
    const effectiveMccId = adsDataRecord.login_customer_id || mccCustomerId || clientCustomerId;
    console.log("=== Customer ID Resolution ===");
    console.log("Client Customer ID (URL):", clientCustomerId);
    console.log("DB login_customer_id:", adsDataRecord.login_customer_id || "NOT SET");
    console.log("ENV GOOGLE_ADS_LOGIN_CUSTOMER_ID:", mccCustomerId || "NOT SET");
    console.log("Effective MCC ID (header):", effectiveMccId);

    // Check cache (1 hour duration)
    const CACHE_DURATION_MS = 60 * 60 * 1000;
    const lastSyncAt = adsDataRecord.last_sync_at ? new Date(adsDataRecord.last_sync_at) : null;
    const now = new Date();
    const isCacheFresh = lastSyncAt && (now.getTime() - lastSyncAt.getTime()) < CACHE_DURATION_MS;

    // Return cached data if fresh and not forcing refresh
    if (!forceRefresh && isCacheFresh && adsDataRecord.raw_campaigns?.length > 0) {
      console.log("Returning cached data from:", lastSyncAt?.toISOString());

      return new Response(
        JSON.stringify({
          success: true,
          cached: true,
          data: {
            campaigns: adsDataRecord.raw_campaigns || [],
            accountMetrics: {
              totalSpend: adsDataRecord.total_spend || 0,
              totalConversions: adsDataRecord.total_conversions || 0,
              totalClicks: adsDataRecord.total_clicks || 0,
              totalImpressions: adsDataRecord.total_impressions || 0,
              averageCpc: adsDataRecord.average_cpc || 0,
              costPerConversion: adsDataRecord.cost_per_conversion || 0,
            },
            accountInfo: {
              accountName: adsDataRecord.account_name || "Google Ads Account",
              currency: adsDataRecord.currency || "GBP",
              timezone: adsDataRecord.timezone || "Europe/London",
            },
            lastSyncAt: adsDataRecord.last_sync_at,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Fetching fresh data from Google Ads API...");

    // Get OAuth credentials
    const oauthClientId = integration.client_id || clientIdEnv;
    const oauthClientSecret = integration.client_secret || clientSecretEnv;

    // Refresh access token if needed
    let accessToken = integration.access_token;
    const tokenExpiresAt = integration.token_expires_at ? new Date(integration.token_expires_at) : null;

    if (!accessToken || !tokenExpiresAt || now >= new Date(tokenExpiresAt.getTime() - 5 * 60 * 1000)) {
      console.log("Access token expired or expiring soon, refreshing...");

      if (!integration.refresh_token) {
        return new Response(
          JSON.stringify({ success: false, error: "No refresh token available. Please reconnect Google Ads." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!oauthClientId || !oauthClientSecret) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing OAuth credentials. Please reconnect Google Ads." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newTokens = await refreshAccessToken(integration.refresh_token, oauthClientId, oauthClientSecret);

      if (!newTokens) {
        return new Response(
          JSON.stringify({ success: false, error: "Failed to refresh access token. Please reconnect Google Ads." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      accessToken = newTokens.access_token;
      const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();

      // Update tokens in database
      await supabase
        .from("platform_integrations")
        .update({
          access_token: accessToken,
          token_expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", integrationId);
    }

    // Fetch data from Google Ads API
    // clientCustomerId: The client account where campaigns live (in URL)
    // effectiveMccId: The MCC/login account for authorization (in header)
    let result = await fetchAllGoogleAdsData(
      accessToken,
      developerToken,
      clientCustomerId,  // Client account ID - goes in URL
      effectiveMccId     // MCC account ID - goes in login-customer-id header
    );

    // If permission denied and MCC differs from client, retry with client ID as login-customer-id
    // (handles accounts that are directly accessible without MCC)
    if (!result.success && result.error?.includes("permission") && effectiveMccId !== clientCustomerId) {
      console.log("Permission denied with MCC header, retrying with client ID as login-customer-id...");
      result = await fetchAllGoogleAdsData(
        accessToken,
        developerToken,
        clientCustomerId,
        clientCustomerId  // Use client's own ID as login-customer-id
      );
    }

    if (!result.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to fetch data from Google Ads API",
          details: result.error,
          debug: {
            clientCustomerId,
            effectiveMccId,
            dbLoginCustomerId: adsDataRecord.login_customer_id || null,
            envMccId: mccCustomerId || null,
          },
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { campaigns, accountMetrics, accountInfo } = result.data!;

    console.log(`Fetched ${campaigns.length} campaigns`);
    console.log(`Total spend: ${accountMetrics.totalSpend}`);

    // Update cache in database
    const { error: updateError } = await supabase
      .from("platform_integration_google_ads_data")
      .update({
        account_name: accountInfo.accountName,
        currency: accountInfo.currency,
        timezone: accountInfo.timezone,
        total_spend: accountMetrics.totalSpend,
        total_conversions: accountMetrics.totalConversions,
        total_clicks: accountMetrics.totalClicks,
        total_impressions: accountMetrics.totalImpressions,
        average_cpc: accountMetrics.averageCpc,
        cost_per_conversion: accountMetrics.costPerConversion,
        raw_campaigns: campaigns,
        raw_metrics: accountMetrics,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", adsDataRecord.id);

    if (updateError) {
      console.error("Error updating cache:", updateError);
      // Don't fail the request, just log the error
    }

    // Return fresh data
    return new Response(
      JSON.stringify({
        success: true,
        cached: false,
        data: {
          campaigns,
          accountMetrics,
          accountInfo,
          lastSyncAt: new Date().toISOString(),
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
