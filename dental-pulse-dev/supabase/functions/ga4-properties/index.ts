import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

interface GA4DataStream {
  name: string;
  type: string;
  displayName: string;
  webStreamData?: {
    measurementId: string;
    defaultUri: string;
  };
}

interface GA4AccountSummary {
  name: string;
  account: string;
  displayName: string;
  propertySummaries?: Array<{
    property: string;
    displayName: string;
    propertyType: string;
  }>;
}

interface PropertyInfo {
  accountId: string;
  accountName: string;
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  propertyType: string;
  websiteUrl: string | null;
  measurementId: string | null;
}

/**
 * Refresh the access token using refresh token
 */
async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
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
      console.error("Token refresh failed:", await response.text());
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Token refresh error:", error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user's JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get integration ID from request body
    const body = await req.json();
    const { integrationId } = body;

    if (!integrationId) {
      return new Response(
        JSON.stringify({ error: "Missing integration ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch integration
    const { data: integration, error: fetchError } = await supabase
      .from("platform_integrations")
      .select("*")
      .eq("id", integrationId)
      .eq("platform_name", "ga4")
      .single();

    if (fetchError || !integration) {
      return new Response(
        JSON.stringify({ error: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use env vars for client credentials, fall back to DB values
    const clientId = Deno.env.get("GA4_CLIENT_ID") || integration.client_id;
    const clientSecret = Deno.env.get("GA4_CLIENT_SECRET") || integration.client_secret;

    // Check if token needs refresh
    let accessToken = integration.access_token;
    const tokenExpiresAt = integration.token_expires_at ? new Date(integration.token_expires_at) : null;
    const now = new Date();

    if (!accessToken || !tokenExpiresAt || now >= new Date(tokenExpiresAt.getTime() - 5 * 60 * 1000)) {
      console.log("Token expired or expiring soon, refreshing...");

      if (!integration.refresh_token) {
        return new Response(
          JSON.stringify({ error: "No refresh token available. Please reconnect to Google Analytics." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newTokens = await refreshAccessToken(
        integration.refresh_token,
        clientId,
        clientSecret
      );

      if (!newTokens) {
        return new Response(
          JSON.stringify({ error: "Failed to refresh access token. Please reconnect to Google Analytics." }),
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

      console.log("Token refreshed successfully");
    }

    // Fetch account summaries
    console.log("Fetching GA4 account summaries...");
    const accountSummariesResponse = await fetch(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!accountSummariesResponse.ok) {
      const errorText = await accountSummariesResponse.text();
      console.error("Failed to fetch account summaries:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to fetch GA4 properties", details: errorText }),
        { status: accountSummariesResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accountSummariesData = await accountSummariesResponse.json();
    const properties: PropertyInfo[] = [];

    // Extract all properties
    for (const account of accountSummariesData.accountSummaries || []) {
      for (const property of account.propertySummaries || []) {
        let websiteUrl: string | null = null;
        let measurementId: string | null = null;

        // Fetch data streams
        try {
          const streamsResponse = await fetch(
            `https://analyticsadmin.googleapis.com/v1beta/${property.property}/dataStreams`,
            {
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            }
          );

          if (streamsResponse.ok) {
            const streamsData = await streamsResponse.json();
            const webStream = (streamsData.dataStreams || []).find(
              (s: GA4DataStream) => s.type === "WEB_DATA_STREAM" && s.webStreamData
            );
            if (webStream?.webStreamData) {
              websiteUrl = webStream.webStreamData.defaultUri;
              measurementId = webStream.webStreamData.measurementId;
            }
          }
        } catch (err) {
          console.error("Failed to fetch data streams:", err);
        }

        properties.push({
          accountId: account.account.replace("accounts/", ""),
          accountName: account.displayName,
          propertyId: property.property.replace("properties/", ""),
          propertyCode: property.property,
          propertyName: property.displayName,
          propertyType: property.propertyType,
          websiteUrl,
          measurementId,
        });
      }
    }

    console.log(`Found ${properties.length} GA4 properties`);

    return new Response(
      JSON.stringify({ success: true, properties }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
