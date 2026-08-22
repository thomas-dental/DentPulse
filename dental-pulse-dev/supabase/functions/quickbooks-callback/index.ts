import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// QuickBooks (Intuit) OAuth callback — exchanges the auth code for tokens and
// persists them + the QBO company (realmId) onto the integration.
// Mirrors xero-callback:
//  - credentials are APP-LEVEL (env QUICKBOOKS_CLIENT_ID/QUICKBOOKS_CLIENT_SECRET),
//    NOT per-org. Users never enter credentials — same model as Xero.
//  - state is either an existing integration id (reconnect) OR
//    `new:<org>:<user>:<nonce>` for a fresh connect, in which case the row is
//    created HERE (deferred creation → no orphan rows from abandoned logins).
//  - Intuit returns `realmId` (the QBO company id, ≈ Xero tenantId) — mandatory
//    for every future QBO API call; stored as platform_org_id.
//  - redirect_uri MUST exactly match what quickbooks-auth used.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, origin",
};

interface QuickBooksTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}

interface QuickBooksCallbackRequest {
  code: string;
  state: string;   // = integration_id (reconnect) OR new:<org>:<user>:<nonce>
  realmId: string;  // QBO company id (Intuit redirect query param)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase environment variables");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error - missing environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // App-level Intuit credentials (env), mirroring Xero.
    const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
    const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      console.error("Missing QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET environment variables");
      return new Response(
        JSON.stringify({ error: "QuickBooks integration not configured. Please contact support." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: QuickBooksCallbackRequest;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { code, state, realmId } = body;
    console.log(`Processing QuickBooks OAuth callback for state: ${state?.startsWith("new:") ? "new:<...>" : state}, realmId: ${realmId}`);

    if (!code || !state) {
      return new Response(
        JSON.stringify({ error: "Missing code or state parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!realmId) {
      // realmId is mandatory for QBO — without it we cannot make any API call.
      return new Response(
        JSON.stringify({ error: "Missing realmId — QuickBooks did not return a company id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve org/user/existing-row from state. New connect defers row creation
    // (created below only after a successful token exchange).
    const isNew = typeof state === "string" && state.startsWith("new:");
    let organizationId: string;
    let ownerUserId: string;
    let existingIntegrationId: string | null = null;

    if (isNew) {
      const parts = state.split(":"); // new:org:user:nonce
      organizationId = parts[1];
      ownerUserId = parts[2];
      if (!organizationId || !ownerUserId) {
        return new Response(
          JSON.stringify({ error: "Invalid state parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      existingIntegrationId = state;
      const { data: integration, error: fetchError } = await supabase
        .from("platform_integrations")
        .select("id, organization_id, user_id")
        .eq("id", existingIntegrationId)
        .eq("platform_name", "quickbooks")
        .single();

      if (fetchError || !integration) {
        console.error("Failed to fetch integration:", fetchError);
        return new Response(
          JSON.stringify({ error: "Integration not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      organizationId = integration.organization_id;
      ownerUserId = integration.user_id;
    }

    // Must EXACTLY match the redirect_uri quickbooks-auth sent to Intuit.
    const redirectUri = Deno.env.get("QUICKBOOKS_REDIRECT_URI")
      || `${Deno.env.get("APP_URL") || "http://localhost:8080"}/auth/quickbooks/callback`;

    // Exchange code → tokens (Intuit token endpoint; Basic auth = app creds).
    const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
    const credentials = btoa(`${clientId}:${clientSecret}`);

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "Authorization": `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`QuickBooks token exchange failed: ${tokenResponse.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to exchange authorization code", details: `Status: ${tokenResponse.status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData: QuickBooksTokenResponse = await tokenResponse.json();
    console.log("Successfully obtained QuickBooks tokens");

    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const nowIso = new Date().toISOString();

    // ── Duplicate detection (mirror xero-callback): same Intuit company already
    // on ANOTHER integration in THIS org → transfer fresh tokens to the existing
    // integration instead of creating a duplicate. For reconnect we exclude the
    // row being reconnected so re-auth of the same company isn't a "dup".
    const { data: existingOrgs } = await supabase
      .from("platform_integration_organizations")
      .select("platform_integration_id, platform_org_id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "quickbooks")
      .eq("platform_org_id", realmId);

    const dupOrgs = (existingOrgs || []).filter(
      (o: any) => o.platform_integration_id !== existingIntegrationId
    );

    let effectiveIntegrationId: string;
    let reconnected = false;

    if (dupOrgs.length > 0) {
      // Same company already connected elsewhere — update that row's tokens.
      effectiveIntegrationId = dupOrgs[0].platform_integration_id;
      reconnected = true;
      console.log(`Same QuickBooks company detected: updating tokens on existing integration ${effectiveIntegrationId}`);
      await supabase
        .from("platform_integrations")
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: tokenExpiresAt,
          is_connected: true,
          updated_at: nowIso,
        })
        .eq("id", effectiveIntegrationId);
      // Drop the redundant reconnect row if it differs from the canonical one.
      if (existingIntegrationId && existingIntegrationId !== effectiveIntegrationId) {
        await supabase.from("platform_integrations").delete().eq("id", existingIntegrationId);
        console.log(`Cleaned up redundant integration ${existingIntegrationId}`);
      }
    } else if (isNew) {
      // Fresh connect — create the row now that OAuth succeeded.
      const { data: newRow, error: insertError } = await supabase
        .from("platform_integrations")
        .insert({
          organization_id: organizationId,
          user_id: ownerUserId,
          platform_name: "quickbooks",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: tokenExpiresAt,
          is_connected: true,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select("id")
        .single();
      if (insertError || !newRow) {
        console.error("Failed to create integration:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to save QuickBooks connection", details: insertError?.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      effectiveIntegrationId = newRow.id;
    } else {
      // Reconnect of the same row — update its tokens.
      effectiveIntegrationId = existingIntegrationId!;
      const { error: updateError } = await supabase
        .from("platform_integrations")
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: tokenExpiresAt,
          is_connected: true,
          updated_at: nowIso,
        })
        .eq("id", effectiveIntegrationId);
      if (updateError) {
        console.error("Failed to save tokens:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to save tokens", details: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    console.log(`QuickBooks tokens saved for integration ${effectiveIntegrationId}`);

    // Best-effort company name/currency from QBO CompanyInfo (non-fatal —
    // tokens are already saved). Base is prod by default; sandbox apps must
    // set QUICKBOOKS_API_BASE=https://sandbox-quickbooks.api.intuit.com.
    let companyName = `QuickBooks Company ${realmId}`;
    let country: string | null = null;
    let currency: string | null = null;
    try {
      const apiBase = Deno.env.get("QUICKBOOKS_API_BASE") || "https://quickbooks.api.intuit.com";
      const ciResp = await fetch(`${apiBase}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=70`, {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "Accept": "application/json",
        },
      });
      if (ciResp.ok) {
        const ci = await ciResp.json();
        const info = ci?.CompanyInfo;
        if (info?.CompanyName) companyName = info.CompanyName;
        country = info?.Country || null;
        currency = info?.Currency || null;
        console.log(`QBO CompanyInfo: ${companyName}`);
      } else {
        console.warn(`CompanyInfo fetch failed (${ciResp.status}) — using fallback name`);
      }
    } catch (ciErr) {
      console.error("CompanyInfo fetch error (non-fatal):", ciErr);
    }

    // Persist the QBO company (realmId) — analogous to a Xero tenant.
    const { error: upsertError } = await supabase
      .from("platform_integration_organizations")
      .upsert(
        {
          organization_id: organizationId,
          platform_integration_id: effectiveIntegrationId,
          user_id: ownerUserId,
          platform_name: "quickbooks",
          platform_org_id: realmId,
          platform_org_name: companyName,
          country: country,
          currency: currency,
          status: "active",
          is_selected: true, // one company per QuickBooks connect
          raw_data: { realmId },
          meta_data: { source: "quickbooks-callback" },
          updated_at: nowIso,
        },
        { onConflict: "platform_integration_id,platform_org_id" }
      );
    if (upsertError) {
      console.error("Failed to save QuickBooks company:", upsertError);
      return new Response(
        JSON.stringify({ error: "Failed to save QuickBooks company", details: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        reconnected,
        integrationId: effectiveIntegrationId,
        message: reconnected
          ? "QuickBooks tokens refreshed. Existing connection updated."
          : "Successfully connected to QuickBooks.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unexpected error in quickbooks-callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Internal server error", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
