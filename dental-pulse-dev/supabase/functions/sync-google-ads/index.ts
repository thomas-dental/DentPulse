/**
 * Sync Google Ads Campaigns Edge Function
 *
 * Fetches daily campaign snapshots from Google Ads API v23 and upserts
 * them into the `google_ads_campaigns` table for historical date-range queries.
 *
 * - First sync: pulls last 365 days
 * - Subsequent syncs: pulls from last_sync_at
 * - Chunks requests into 90-day windows
 * - Batch upserts rows (100 per batch)
 * - Updates last_sync_at on completion
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API_VERSION = "v23";
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const BATCH_SIZE = 100;

// ============================================
// HELPERS
// ============================================

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

/** Generate 90-day date chunks between fromDate and toDate */
function dateChunks(
  fromDate: Date,
  toDate: Date
): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = [];
  const current = new Date(fromDate);

  while (current <= toDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + 89);
    if (chunkEnd > toDate) {
      chunkEnd.setTime(toDate.getTime());
    }
    chunks.push({ from: formatDate(current), to: formatDate(chunkEnd) });
    current.setDate(current.getDate() + 90);
  }

  return chunks;
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
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

    if (!response.ok) {
      console.error("Token refresh failed:", response.status, await response.text());
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Token refresh error:", error);
    return null;
  }
}

// ============================================
// GOOGLE ADS QUERY
// ============================================

async function executeGaql(
  accessToken: string,
  developerToken: string,
  clientCustomerId: string,
  mccCustomerId: string,
  query: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const cleanClientId = clientCustomerId.replace(/-/g, "");
  const cleanMccId = mccCustomerId.replace(/-/g, "");
  const url = `${GOOGLE_ADS_BASE_URL}/customers/${cleanClientId}/googleAds:search`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "login-customer-id": cleanMccId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: query.trim(), pageSize: 10000 }),
  });

  const text = await response.text();

  if (!response.ok) {
    console.error(`GAQL error ${response.status}:`, text.substring(0, 500));
    return { success: false, error: `HTTP ${response.status}: ${text.substring(0, 300)}` };
  }

  return { success: true, data: JSON.parse(text) };
}

// ============================================
// CHANNEL TYPE MAPPING
// ============================================

const CHANNEL_TYPE_MAP: Record<string, string> = {
  SEARCH: "Search",
  DISPLAY: "Display",
  SHOPPING: "Shopping",
  VIDEO: "Video",
  MULTI_CHANNEL: "Multi-Channel",
  LOCAL: "Local",
  SMART: "Smart",
  PERFORMANCE_MAX: "Performance Max",
  LOCAL_SERVICES: "Local Services",
  DISCOVERY: "Discovery",
  TRAVEL: "Travel",
};

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate: accept JWT or service-role calls
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      // If it's not the service role key, validate as JWT
      if (token !== supabaseServiceKey) {
        const { error: authError } = await supabase.auth.getUser(token);
        if (authError) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid authentication" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    const body = await req.json();
    const { organizationId } = body;

    if (!organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing organizationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Environment variables
    const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
    const mccCustomerId = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    const envClientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID");
    const envClientSecret = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET");

    if (!developerToken) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing GOOGLE_ADS_DEVELOPER_TOKEN" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch integration record
    const { data: integration, error: intError } = await supabase
      .from("platform_integrations")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("platform_name", "google_ads")
      .eq("is_connected", true)
      .maybeSingle();

    if (intError || !integration) {
      return new Response(
        JSON.stringify({ success: false, error: "Google Ads integration not found or not connected" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch Google Ads data record (contains client customer ID)
    const { data: adsDataRecord } = await supabase
      .from("platform_integration_google_ads_data")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!adsDataRecord?.customer_id) {
      return new Response(
        JSON.stringify({ success: false, error: "No Google Ads account configured" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientCustomerId = adsDataRecord.customer_id;

    // Use login_customer_id from DB (set during OAuth), fallback to env, then client ID itself
    const effectiveMccId = adsDataRecord.login_customer_id || mccCustomerId || clientCustomerId;
    console.log("Client ID:", clientCustomerId, "| Effective MCC:", effectiveMccId);

    // Refresh access token if needed
    let accessToken = integration.access_token;
    const tokenExpiresAt = integration.token_expires_at
      ? new Date(integration.token_expires_at)
      : null;
    const now = new Date();

    if (!accessToken || !tokenExpiresAt || now >= new Date(tokenExpiresAt.getTime() - 5 * 60 * 1000)) {
      console.log("Refreshing access token...");
      const oauthClientId = integration.client_id || envClientId;
      const oauthClientSecret = integration.client_secret || envClientSecret;

      if (!integration.refresh_token || !oauthClientId || !oauthClientSecret) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing OAuth credentials. Please reconnect Google Ads." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newTokens = await refreshAccessToken(integration.refresh_token, oauthClientId, oauthClientSecret);
      if (!newTokens) {
        return new Response(
          JSON.stringify({ success: false, error: "Failed to refresh access token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      accessToken = newTokens.access_token;
      await supabase
        .from("platform_integrations")
        .update({
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", integration.id);
    }

    // Determine date range
    const toDate = new Date();
    let fromDate: Date;

    if (adsDataRecord.last_sync_at) {
      // Subsequent sync: from last_sync_at (minus 2 day buffer for late data)
      fromDate = new Date(adsDataRecord.last_sync_at);
      fromDate.setDate(fromDate.getDate() - 2);
    } else {
      // First sync: last 365 days
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 365);
    }

    console.log(`Syncing campaigns from ${formatDate(fromDate)} to ${formatDate(toDate)}`);

    const chunks = dateChunks(fromDate, toDate);
    let totalRows = 0;
    let errors: string[] = [];

    for (const chunk of chunks) {
      console.log(`Fetching chunk: ${chunk.from} to ${chunk.to}`);

      const query = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          segments.date,
          metrics.cost_micros,
          metrics.clicks,
          metrics.impressions,
          metrics.conversions,
          metrics.average_cpc,
          metrics.ctr,
          metrics.cost_per_conversion
        FROM campaign
        WHERE segments.date BETWEEN '${chunk.from}' AND '${chunk.to}'
          AND campaign.status != 'REMOVED'
        ORDER BY segments.date DESC
      `;

      const result = await executeGaql(
        accessToken,
        developerToken,
        clientCustomerId,
        effectiveMccId,
        query
      );

      if (!result.success) {
        errors.push(`Chunk ${chunk.from}-${chunk.to}: ${result.error}`);
        continue;
      }

      const rows = result.data?.results || [];
      if (rows.length === 0) continue;

      // Transform rows for upsert
      const records = rows.map((row: any) => {
        const campaign = row.campaign || {};
        const metrics = row.metrics || {};
        const reportDate = row.segments?.date; // YYYY-MM-DD

        return {
          organization_id: organizationId,
          campaign_id: String(campaign.id || ""),
          campaign_name: campaign.name || "Unknown",
          campaign_status: campaign.status || "UNKNOWN",
          campaign_type: CHANNEL_TYPE_MAP[campaign.advertisingChannelType] || campaign.advertisingChannelType || "Unknown",
          report_date: reportDate,
          impressions: parseInt(metrics.impressions) || 0,
          clicks: parseInt(metrics.clicks) || 0,
          conversions: parseFloat(metrics.conversions) || 0,
          cost: (metrics.costMicros || 0) / 1_000_000,
          average_cpc: (metrics.averageCpc || 0) / 1_000_000,
          ctr: parseFloat(metrics.ctr) || 0,
          cost_per_conversion: (metrics.costPerConversion || 0) / 1_000_000,
          updated_at: now.toISOString(),
        };
      });

      // Batch upsert
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const { error: upsertError } = await supabase
          .from("google_ads_campaigns")
          .upsert(batch, {
            onConflict: "organization_id,campaign_id,report_date",
            ignoreDuplicates: false,
          });

        if (upsertError) {
          console.error("Upsert error:", upsertError);
          errors.push(`Upsert batch ${i}: ${upsertError.message}`);
        } else {
          totalRows += batch.length;
        }
      }
    }

    // Update last_sync_at
    await supabase
      .from("platform_integration_google_ads_data")
      .update({
        last_sync_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", adsDataRecord.id);

    console.log(`Sync complete: ${totalRows} rows upserted, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        rowsSynced: totalRows,
        errors: errors.length > 0 ? errors : undefined,
        dateRange: { from: formatDate(fromDate), to: formatDate(toDate) },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
