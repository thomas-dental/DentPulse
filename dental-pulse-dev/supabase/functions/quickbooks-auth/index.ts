import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// QuickBooks (Intuit) OAuth initiation.
//
// Credential model — APP-LEVEL (env), mirroring Xero. The Intuit app's
// Client ID/Secret live in env (QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET),
// NOT per-org on the integration row. Users never enter credentials — they
// just authorise their company. This replaces the old per-org credential model
// (the "Add Credentials" screen) so connecting QuickBooks works exactly like
// connecting Xero.
//
// Like xero-auth:
//  - Reconnect: state = existing integration row id (UUID).
//  - New connect: do NOT pre-create a row. The row is created in
//    quickbooks-callback only if/when OAuth actually completes. state encodes
//    `new:<organization_id>:<user_id>:<nonce>` so the callback can resolve
//    org/user without touching the database first. This eliminates orphan
//    "QuickBooks Account N" rows from abandoned logins.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, origin",
};

interface QuickBooksAuthRequest {
  organizationId: string;
  currentOrigin?: string; // reserved for future origin-aware redirect; currently unused
  connectionId?: string;  // reconnect this specific integration; omit for a new connect
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // App-level Intuit Client ID from env (mirrors Xero). No per-org creds.
    const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
    if (!clientId) {
      console.error("Missing QUICKBOOKS_CLIENT_ID environment variable");
      return new Response(
        JSON.stringify({ error: "QuickBooks integration not configured. Please contact support." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    const body: QuickBooksAuthRequest = await req.json();
    const { organizationId, connectionId } = body;

    console.log(`Processing QuickBooks OAuth initiation for organization: ${organizationId}, connectionId: ${connectionId || 'new'}`);

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing organization ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // OAuth `state`:
    //  - Reconnect: state = existing integration row id (verified org-scoped).
    //  - New connect: deferred row creation, state = new:<org>:<user>:<nonce>.
    let state: string;

    if (connectionId) {
      const { data: existingIntegration, error: fetchError } = await supabase
        .from("platform_integrations")
        .select("id")
        .eq("id", connectionId)
        .eq("organization_id", organizationId)
        .eq("platform_name", "quickbooks")
        .single();

      if (fetchError || !existingIntegration) {
        console.error("Integration not found:", fetchError);
        return new Response(
          JSON.stringify({ error: "Integration not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      state = existingIntegration.id;
      console.log(`Reconnecting existing QuickBooks integration: ${state}`);
    } else {
      const nonce = crypto.randomUUID().replace(/-/g, "");
      state = `new:${organizationId}:${user.id}:${nonce}`;
      console.log(`New QuickBooks connect — deferred row creation, state: new:${organizationId}:${user.id}:<nonce>`);
    }

    // Build the QuickBooks OAuth authorization URL (Intuit OAuth 2.0).
    const quickbooksAuthUrl = "https://appcenter.intuit.com/connect/oauth2";

    // Redirect URI must EXACTLY match what quickbooks-callback uses AND what is
    // registered in the Intuit app.
    const redirectUri = Deno.env.get("QUICKBOOKS_REDIRECT_URI") || `${Deno.env.get("APP_URL") || "http://localhost:8080"}/auth/quickbooks/callback`;

    const scopes = [
      "com.intuit.quickbooks.accounting",
      "com.intuit.quickbooks.payment",
    ].join(" ");

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state: state,
    });

    const authorizationUrl = `${quickbooksAuthUrl}?${params.toString()}`;

    console.log(`Generated QuickBooks authorization URL with state: ${state.startsWith("new:") ? "new:<org>:<user>:<nonce>" : state}`);

    return new Response(
      JSON.stringify({
        success: true,
        authorizationUrl: authorizationUrl,
        // Reconnect returns the row id we'll reuse; new connect has no row yet.
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
