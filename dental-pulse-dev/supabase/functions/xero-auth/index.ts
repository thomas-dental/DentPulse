import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, origin",
};

interface XeroAuthRequest {
  organizationId: string;
  currentOrigin?: string; // Frontend passes its current origin
  connectionId?: string; // If provided, reconnect this specific integration; otherwise create new
  /** When true, adds OAuth `prompt=login` so Xero forces credential entry (e.g. switch Xero user). Omit for normal SSO: existing Xero browser session is reused. */
  forceXeroLogin?: boolean;
}

// Determine redirect URI based on request origin (both URLs from env)
function getRedirectUri(currentOrigin?: string): string {
  // Get both URLs from environment variables
  const localRedirectUri = Deno.env.get("XERO_LOCAL_REDIRECT_URI") || "http://localhost:8080/auth/xero/callback";
  const productionRedirectUri = Deno.env.get("XERO_PRODUCTION_REDIRECT_URI") || "https://dev-enterprise.dentpulse.com/auth/xero/callback";

  console.log(`Current origin from frontend: ${currentOrigin}`);

  // Check if request is from localhost
  if (currentOrigin && (currentOrigin.includes("localhost") || currentOrigin.includes("127.0.0.1"))) {
    console.log(`Using local redirect URI: ${localRedirectUri}`);
    return localRedirectUri;
  }

  console.log(`Using production redirect URI: ${productionRedirectUri}`);
  return productionRedirectUri;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get Xero credentials from environment variables
    const xeroClientId = Deno.env.get("XERO_CLIENT_ID");
    const xeroClientSecret = Deno.env.get("XERO_CLIENT_SECRET");

    if (!xeroClientId || !xeroClientSecret) {
      console.error("Missing Xero environment variables");
      return new Response(
        JSON.stringify({ error: "Xero integration not configured. Please contact support." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine redirect URI dynamically based on request origin
    // Note: currentOrigin is extracted from body later, so we call getRedirectUri after parsing body
    let xeroRedirectUri = "";

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("Missing authorization header");
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
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: XeroAuthRequest = await req.json();
    const { organizationId, currentOrigin, connectionId, forceXeroLogin } = body;

    console.log(`Processing Xero OAuth initiation for organization: ${organizationId}, origin: ${currentOrigin}, connectionId: ${connectionId || 'new'}`);

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing organization ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Set redirect URI based on frontend origin
    xeroRedirectUri = getRedirectUri(currentOrigin);

    // OAuth `state` value. Mirrors how quickbooks-auth treats state:
    //  - Reconnect: state = existing integration row id (UUID).
    //  - New connect: do NOT pre-create a row. The row is created in
    //    xero-callback only if/when OAuth actually completes. The state
    //    encodes `new:<organization_id>:<user_id>:<nonce>` so the callback
    //    can resolve org/user without touching the database first. This
    //    eliminates the "Xero Account N" orphan rows that piled up when a
    //    user closed the Xero login window mid-flow.
    let state: string;

    if (connectionId) {
      // Reconnect an existing specific integration
      const { data: existingIntegration, error: fetchError } = await supabase
        .from("platform_integrations")
        .select("id")
        .eq("id", connectionId)
        .eq("organization_id", organizationId)
        .eq("platform_name", "xero")
        .single();

      if (fetchError || !existingIntegration) {
        console.error("Integration not found:", fetchError);
        return new Response(
          JSON.stringify({ error: "Integration not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      state = existingIntegration.id;
      console.log(`Reconnecting existing Xero integration: ${state}`);
    } else {
      const nonce = crypto.randomUUID().replace(/-/g, "");
      state = `new:${organizationId}:${user.id}:${nonce}`;
      console.log(`New Xero connect — deferred row creation, state: new:${organizationId}:${user.id}:<nonce>`);
    }

    // Build the Xero OAuth authorization URL
    const xeroAuthUrl = "https://login.xero.com/identity/connect/authorize";

    // Same scope set as FinancialScalingSherpa (Version 2) XeroSettings.Scope — matches the
    // Xero app registration that already works for DentPulse. See:
    // https://developer.xero.com/documentation/guides/oauth2/scopes/
    //
    // Optional: set env `XERO_OAUTH_SCOPES` to a space-separated list (e.g. granular-only scopes)
    // if your Supabase Xero app is a different registration (e.g. created after Mar 2026) that
    // rejects broad accounting.transactions / accounting.reports.read.
    const defaultScopeList = [
      "openid",
      "profile",
      "email",
      "offline_access",
      "files",
      "accounting.transactions",
      "accounting.contacts",
      "accounting.settings",
      "accounting.journals.read",
      "accounting.reports.read",
      "accounting.attachments",
    ];
    const envScopeOverride = Deno.env.get("XERO_OAUTH_SCOPES")?.trim();
    const scopes = envScopeOverride && envScopeOverride.length > 0
      ? envScopeOverride.replace(/\s+/g, " ")
      : [...new Set(defaultScopeList)].join(" ");

    // Build authorization URL with env client ID
    const params = new URLSearchParams({
      response_type: "code",
      client_id: xeroClientId,
      redirect_uri: xeroRedirectUri,
      scope: scopes,
      state: state,
    });

    // Optional: force Xero login UI (ignores existing browser SSO session).
    // Default is no `prompt` — Xero reuses an active session so users are not sent to password entry unnecessarily.
    if (forceXeroLogin === true) {
      params.set("prompt", "login");
    }

    const authorizationUrl = `${xeroAuthUrl}?${params.toString()}`;

    console.log(`Generated Xero authorization URL with state: ${state.startsWith("new:") ? "new:<org>:<user>:<nonce>" : state}`);
    console.log(`Redirect URI used: ${xeroRedirectUri}`);

    return new Response(
      JSON.stringify({
        success: true,
        authorizationUrl: authorizationUrl,
        // For reconnect we return the integration id we'll reuse. For a new
        // connect there is no integration yet — the callback creates it.
        integrationId: state.startsWith("new:") ? null : state,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Internal server error", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
