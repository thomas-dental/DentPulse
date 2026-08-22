import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const GOOGLE_ADS_API_VERSION = "v23";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface StateData {
  organizationId: string;
  userId: string;
}

interface GoogleAdsAccountInfo {
  customerId: string;
  accountName: string;
  currency: string;
  timezone: string;
}

/**
 * Fetch account details (name, currency, timezone) for a given customer ID
 * using a GAQL query via the Google Ads REST API.
 */
async function fetchAccountInfo(
  accessToken: string,
  developerToken: string,
  loginCustomerId: string,
  customerId: string
): Promise<GoogleAdsAccountInfo> {
  const query = `SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1`;

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    console.warn(`Failed to fetch account info for ${customerId}: ${errorText}`);
    // Return defaults if we can't fetch details
    return {
      customerId,
      accountName: `Google Ads Account (${customerId})`,
      currency: "GBP",
      timezone: "Europe/London",
    };
  }

  const data = await res.json();
  // searchStream returns an array of result batches
  const customer = data?.[0]?.results?.[0]?.customer;

  return {
    customerId,
    accountName: customer?.descriptiveName || `Google Ads Account (${customerId})`,
    currency: customer?.currencyCode || "GBP",
    timezone: customer?.timeZone || "Europe/London",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { code, state } = await req.json();

    if (!code || !state) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing code or state" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decode and validate state
    let stateData: StateData;
    try {
      stateData = JSON.parse(atob(state));
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid state parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { organizationId, userId } = stateData;

    if (!organizationId || !userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing organizationId or userId in state" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET")!;
    const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")!;
    const loginCustomerId = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || "";

    // Static customer IDs from env (comma-separated) — fallback when listAccessibleCustomers fails
    const staticCustomerIds = Deno.env.get("GOOGLE_ADS_CUSTOMER_IDS") || "";

    const redirectUri = Deno.env.get("GOOGLE_ADS_REDIRECT_URI") || "https://dev-enterprise.dentpulse.com/auth/google-ads/callback";

    console.log(`Processing Google Ads OAuth for org: ${organizationId}`);
    console.log(`Using redirect_uri: ${redirectUri}`);
    console.log(`Client ID starts with: ${clientId?.substring(0, 20)}...`);

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("Token exchange failed:", errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Token exchange failed", details: errorText }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData: GoogleTokenResponse = await tokenRes.json();
    const tokenExpiresAt = new Date(
      Date.now() + tokenData.expires_in * 1000
    ).toISOString();

    console.log("Token exchange successful, has refresh token:", !!tokenData.refresh_token);

    // ── Discover Google Ads accounts ──
    // Try API first, fall back to static env var
    const mccId = loginCustomerId.replace(/-/g, "");
    let customerIds: string[] = [];

    // Attempt listAccessibleCustomers via API
    try {
      const listRes = await fetch(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
        {
          headers: {
            "Authorization": `Bearer ${tokenData.access_token}`,
            "developer-token": developerToken,
          },
        }
      );

      if (listRes.ok) {
        const listData = await listRes.json();
        const resourceNames: string[] = listData.resourceNames || [];
        console.log("Accessible customers from API:", resourceNames);

        customerIds = resourceNames
          .map((rn: string) => rn.replace("customers/", ""))
          .filter((id: string) => id !== mccId);
      } else {
        const errorText = await listRes.text();
        console.warn(`listAccessibleCustomers failed (${listRes.status}), will use static IDs. Error:`, errorText.substring(0, 200));
      }
    } catch (listErr) {
      console.warn("listAccessibleCustomers threw error, will use static IDs:", listErr);
    }

    // Fallback: use static customer IDs from environment
    if (customerIds.length === 0 && staticCustomerIds) {
      customerIds = staticCustomerIds
        .split(",")
        .map((id: string) => id.trim().replace(/-/g, ""))
        .filter((id: string) => id.length > 0 && id !== mccId);
      console.log("Using static customer IDs from env:", customerIds);
    }

    if (customerIds.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No Google Ads accounts found. Set GOOGLE_ADS_CUSTOMER_IDS env var with comma-separated client account IDs." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upsert integration record in platform_integrations
    const { data: existing } = await supabase
      .from("platform_integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "google_ads")
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
          platform_name: "google_ads",
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

    // Fetch account details for all discovered customer IDs
    const accounts: GoogleAdsAccountInfo[] = await Promise.all(
      customerIds.map((cid: string) =>
        fetchAccountInfo(tokenData.access_token, developerToken, mccId || cid, cid)
      )
    );

    // ── Single account → auto-select ──
    if (accounts.length === 1) {
      const account = accounts[0];

      const googleAdsDataRecord = {
        organization_id: organizationId,
        platform_integration_id: integrationId,
        user_id: userId,
        customer_id: account.customerId,
        login_customer_id: mccId || account.customerId,
        account_name: account.accountName,
        currency: account.currency,
        timezone: account.timezone,
        status: "active",
        is_selected: true,
        updated_at: new Date().toISOString(),
      };

      const { data: existingData } = await supabase
        .from("platform_integration_google_ads_data")
        .select("id")
        .eq("organization_id", organizationId)
        .maybeSingle();

      let dataRecordId: string;

      if (existingData) {
        await supabase
          .from("platform_integration_google_ads_data")
          .update(googleAdsDataRecord)
          .eq("id", existingData.id);
        dataRecordId = existingData.id;
      } else {
        const { data: newData } = await supabase
          .from("platform_integration_google_ads_data")
          .insert(googleAdsDataRecord)
          .select("id")
          .single();
        dataRecordId = newData!.id;
      }

      console.log(`Google Ads connected successfully for customer ${account.customerId}`);

      // Fire-and-forget: trigger initial campaign sync
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        fetch(`${supabaseUrl}/functions/v1/sync-google-ads`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ organizationId }),
        }).catch((err) => console.warn("Auto-sync trigger failed (non-blocking):", err));
        console.log("Triggered initial campaign sync for org:", organizationId);
      } catch (triggerErr) {
        console.warn("Failed to trigger auto-sync (non-blocking):", triggerErr);
      }

      return new Response(
        JSON.stringify({
          success: true,
          integrationId,
          dataRecordId,
          organizationId,
          userId,
          customerId: account.customerId,
          hasRefreshToken: !!tokenData.refresh_token,
          message: "Google Ads connected successfully!",
          account,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Multiple accounts → return list for frontend selection ──
    console.log(`Found ${accounts.length} Google Ads accounts, returning list for selection`);

    return new Response(
      JSON.stringify({
        success: true,
        multipleAccounts: true,
        integrationId,
        organizationId,
        userId,
        hasRefreshToken: !!tokenData.refresh_token,
        accounts,
        message: "Multiple Google Ads accounts found. Please select one.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Google Ads callback error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
