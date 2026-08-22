import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

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

interface GA4CallbackRequest {
  code: string;
  state: string;
}

interface StateData {
  organizationId: string;
  userId: string;
  origin?: string;
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
  timezone: string | null;
  currency: string | null;
  industryCategory: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: GA4CallbackRequest = await req.json();
    const { code, state } = body;

    if (!code || !state) {
      return new Response(
        JSON.stringify({ error: "Missing code or state parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decode state
    let stateData: StateData;
    try {
      stateData = JSON.parse(atob(state));
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid state parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { organizationId, userId, origin } = stateData;

    if (!organizationId || !userId) {
      return new Response(
        JSON.stringify({ error: "Missing organizationId or userId in state" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing GA4 callback - Organization: ${organizationId}, User: ${userId}, Origin: ${origin}`);

    // Get Google OAuth credentials from environment
    const clientId = Deno.env.get("GA4_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GA4_CLIENT_SECRET")!;

    if (!clientId || !clientSecret) {
      console.error("GA4_CLIENT_ID or GA4_CLIENT_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Google Analytics OAuth not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Exchange code for tokens — redirect_uri must match what was used in ga4-auth
    const appOrigin = origin || "https://dev-enterprise.dentpulse.com";
    const redirectUri = `${appOrigin}/auth/ga4/callback`;

    console.log(`Using redirect_uri: ${redirectUri}`);

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`Token exchange failed: ${tokenResponse.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to exchange authorization code", details: errorText }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData: GoogleTokenResponse = await tokenResponse.json();
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    console.log("Token exchange successful, has refresh token:", !!tokenData.refresh_token);

    // Upsert integration record in platform_integrations (like Google Ads callback)
    const { data: existing } = await supabase
      .from("platform_integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "ga4")
      .maybeSingle();

    let integrationId: string;

    if (existing) {
      await supabase
        .from("platform_integrations")
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? null,
          token_expires_at: tokenExpiresAt,
          client_id: clientId,
          client_secret: clientSecret,
          is_connected: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      integrationId = existing.id;
    } else {
      const { data } = await supabase
        .from("platform_integrations")
        .insert({
          organization_id: organizationId,
          user_id: userId,
          platform_name: "ga4",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? null,
          token_expires_at: tokenExpiresAt,
          client_id: clientId,
          client_secret: clientSecret,
          is_connected: true,
        })
        .select("id")
        .single();

      integrationId = data!.id;
    }

    console.log(`Platform integration upserted: ${integrationId}`);

    // ============================================
    // FETCH ALL GA4 PROPERTIES
    // ============================================
    console.log("Fetching GA4 account summaries...");

    const accountSummariesResponse = await fetch(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    let rawAccountSummaries: any = null;
    const allProperties: PropertyInfo[] = [];

    if (!accountSummariesResponse.ok) {
      const errorText = await accountSummariesResponse.text();
      console.error(`Failed to fetch account summaries: ${errorText}`);
      rawAccountSummaries = { error: errorText, status: accountSummariesResponse.status };
    } else {
      rawAccountSummaries = await accountSummariesResponse.json();
      const accountSummaries: GA4AccountSummary[] = rawAccountSummaries.accountSummaries || [];

      console.log(`Found ${accountSummaries.length} account(s)`);

      // Fetch details for each property
      for (const account of accountSummaries) {
        if (!account.propertySummaries) continue;

        for (const property of account.propertySummaries) {
          console.log(`Processing property: ${property.displayName} (${property.property})`);

          let websiteUrl: string | null = null;
          let measurementId: string | null = null;
          let timezone: string | null = null;
          let currency: string | null = null;
          let industryCategory: string | null = null;

          // Fetch property details
          try {
            const propResponse = await fetch(
              `https://analyticsadmin.googleapis.com/v1beta/${property.property}`,
              {
                headers: {
                  "Authorization": `Bearer ${tokenData.access_token}`,
                  "Content-Type": "application/json",
                },
              }
            );

            if (propResponse.ok) {
              const propDetails = await propResponse.json();
              timezone = propDetails.timeZone || null;
              currency = propDetails.currencyCode || null;
              industryCategory = propDetails.industryCategory || null;
              console.log(`Property details: timezone=${timezone}, currency=${currency}`);
            }
          } catch (err) {
            console.error(`Failed to fetch property details:`, err);
          }

          // Fetch data streams to get website URL
          try {
            const streamsResponse = await fetch(
              `https://analyticsadmin.googleapis.com/v1beta/${property.property}/dataStreams`,
              {
                headers: {
                  "Authorization": `Bearer ${tokenData.access_token}`,
                  "Content-Type": "application/json",
                },
              }
            );

            if (streamsResponse.ok) {
              const streamsData = await streamsResponse.json();
              const streams: GA4DataStream[] = streamsData.dataStreams || [];

              console.log(`Found ${streams.length} data stream(s) for ${property.displayName}`);

              // Find web stream
              const webStream = streams.find(s => s.type === "WEB_DATA_STREAM" && s.webStreamData);
              if (webStream?.webStreamData) {
                websiteUrl = webStream.webStreamData.defaultUri || null;
                measurementId = webStream.webStreamData.measurementId || null;
                console.log(`Web stream found: URL=${websiteUrl}, MeasurementID=${measurementId}`);
              }
            }
          } catch (err) {
            console.error(`Failed to fetch data streams:`, err);
          }

          allProperties.push({
            accountId: account.account.replace("accounts/", ""),
            accountName: account.displayName,
            propertyId: property.property.replace("properties/", ""),
            propertyCode: property.property,
            propertyName: property.displayName,
            propertyType: property.propertyType,
            websiteUrl,
            measurementId,
            timezone,
            currency,
            industryCategory,
          });
        }
      }
    }

    console.log(`Total properties found: ${allProperties.length}`);

    // Select the first property by default (user can change later)
    const selectedProperty = allProperties.length > 0 ? allProperties[0] : null;

    // Derive domain from the selected property's website URL
    let domain = 'auto-detected';
    if (selectedProperty?.websiteUrl) {
      try {
        const url = new URL(selectedProperty.websiteUrl);
        domain = url.hostname.replace(/^www\./, '');
      } catch {
        domain = selectedProperty.websiteUrl;
      }
    }

    // ============================================
    // STORE IN platform_integration_google_analytics_data
    // ============================================

    // Delete existing records
    await supabase
      .from("platform_integration_google_analytics_data")
      .delete()
      .eq("organization_id", organizationId);

    const ga4DataRecord = {
      organization_id: organizationId,
      platform_integration_id: integrationId,
      user_id: userId,
      domain: domain,
      property_id: selectedProperty?.propertyId || null,
      property_name: selectedProperty?.propertyName || null,
      property_code: selectedProperty?.propertyCode || null,
      website_url: selectedProperty?.websiteUrl || null,
      measurement_id: selectedProperty?.measurementId || null,
      account_id: selectedProperty?.accountId || null,
      account_name: selectedProperty?.accountName || null,
      timezone: selectedProperty?.timezone || null,
      currency: selectedProperty?.currency || null,
      industry_category: selectedProperty?.industryCategory || null,
      property_type: selectedProperty?.propertyType || null,
      raw_account_summaries: rawAccountSummaries,
      raw_property_details: null,
      raw_data_streams: null,
      status: 'active',
      is_selected: true,
      updated_at: new Date().toISOString(),
    };

    const { error: insertError } = await supabase
      .from("platform_integration_google_analytics_data")
      .insert(ga4DataRecord);

    if (insertError) {
      console.error("Failed to save GA4 data:", insertError);
    } else {
      console.log("GA4 data saved successfully");
    }

    // ============================================
    // RETURN FULL RESPONSE
    // ============================================
    const responseData = {
      success: true,
      message: allProperties.length > 0
        ? `Found ${allProperties.length} GA4 property(ies). Selected: ${selectedProperty?.propertyName}`
        : "Connected but no GA4 properties found in your account.",
      domain,
      selectedProperty,
      allProperties,
      rawAccountSummaries,
    };

    console.log("GA4 callback completed successfully");

    return new Response(
      JSON.stringify(responseData),
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
