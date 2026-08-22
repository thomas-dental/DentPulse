import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IplicitConnectionRequest {
  organizationId: string;
  connectionId?: string; // Target a specific connection (for edit/connect/disconnect)
  action?: 'save_credentials' | 'connect';
  connectionName?: string;
  entityName?: string;
  iplicitDomain?: string;
  iplicitUsername?: string;
  iplicitApiKey?: string;
}

interface IplicitSessionResponse {
  tokenDue: string;
  sessionToken: string;
  domain: string;
  apiVer: string;
}

// Get session token from iplicit API
async function getIplicitSessionToken(
  domain: string,
  username: string,
  apiKey: string
): Promise<{ sessionToken: string; tokenExpiry: string } | null> {
  try {
    const response = await fetch("https://api.iplicit.com/api/session/create/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Domain": domain,
      },
      body: JSON.stringify({
        username: username,
        userApiKey: apiKey,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`iplicit session creation failed: ${errorText}`);
      return null;
    }

    const sessionData: IplicitSessionResponse = await response.json();
    console.log("Session token obtained successfully");

    return {
      sessionToken: sessionData.sessionToken,
      tokenExpiry: sessionData.tokenDue,
    };
  } catch (error) {
    console.error("Error getting session token:", error);
    return null;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const body: IplicitConnectionRequest = await req.json();
    const { organizationId, connectionId, action = 'connect', iplicitDomain, iplicitUsername, iplicitApiKey } = body;

    console.log(`Processing iplicit ${action} for org: ${organizationId}, connectionId: ${connectionId || 'new'}`);

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing organization ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: save_credentials - Save credentials without connecting
    if (action === 'save_credentials') {
      if (!iplicitDomain || !iplicitUsername || !iplicitApiKey) {
        return new Response(
          JSON.stringify({ error: "Missing required fields for save_credentials" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("Saving iplicit credentials (without connecting)...");

      let connection;
      let connectionError;

      if (connectionId) {
        // Update a specific existing connection (edit credentials)
        const { data, error } = await supabase
          .from("platform_integrations")
          .update({
            client_id: iplicitDomain,
            username: iplicitUsername,
            client_secret: iplicitApiKey,
            is_connected: false, // Reset connection — must re-connect after credential edit
            updated_at: new Date().toISOString(),
          })
          .eq("id", connectionId)
          .eq("organization_id", organizationId)
          .select()
          .single();

        connection = data;
        connectionError = error;
      } else {
        // Check for duplicate: same org + platform + domain + username
        const { data: existing } = await supabase
          .from("platform_integrations")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("platform_name", "iplicit")
          .eq("client_id", iplicitDomain)
          .eq("username", iplicitUsername)
          .maybeSingle();

        if (existing) {
          return new Response(
            JSON.stringify({ error: `An iplicit account with domain "${iplicitDomain}" and username "${iplicitUsername}" already exists.` }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Create a new connection (multi-account support)
        const { data, error } = await supabase
          .from("platform_integrations")
          .insert({
            organization_id: organizationId,
            user_id: user.id,
            platform_name: "iplicit",
            is_connected: false,
            client_id: iplicitDomain,
            username: iplicitUsername,
            client_secret: iplicitApiKey,
          })
          .select()
          .single();

        connection = data;
        connectionError = error;
      }

      if (connectionError) {
        console.error("Database error:", connectionError);
        return new Response(
          JSON.stringify({ error: "Failed to save credentials", details: connectionError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Credentials saved successfully: ${connection.id}`);

      return new Response(
        JSON.stringify({
          success: true,
          connectionId: connection.id,
          message: "Credentials saved. Click Connect to activate.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: connect - Validate credentials and set is_connected = true
    // connectionId is required for multi-account — identifies WHICH iplicit account to connect
    if (!connectionId) {
      return new Response(
        JSON.stringify({ error: "connectionId is required for connect action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: existingIntegration, error: fetchError } = await supabase
      .from("platform_integrations")
      .select("*")
      .eq("id", connectionId)
      .eq("organization_id", organizationId)
      .eq("platform_name", "iplicit")
      .single();

    if (fetchError || !existingIntegration) {
      console.error("Error fetching integration:", fetchError);
      return new Response(
        JSON.stringify({ error: "No iplicit credentials found for this connection. Please save credentials first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse credentials from DB
    const domain = existingIntegration.client_id;
    const username = existingIntegration.username;
    const apiKey = existingIntegration.client_secret;

    if (!domain || !username || !apiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid stored credentials. Please update your credentials." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Validating iplicit credentials for domain: ${domain}...`);

    // Validate credentials by getting session token from iplicit API
    const sessionResult = await getIplicitSessionToken(domain, username, apiKey);

    if (!sessionResult) {
      return new Response(
        JSON.stringify({ error: "Invalid iplicit credentials. Please check your domain, username, and API key." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { sessionToken, tokenExpiry } = sessionResult;
    console.log(`Token obtained, expires at: ${tokenExpiry}`);

    // Update integration with session token and set connected
    const { data: connection, error: connectionError } = await supabase
      .from("platform_integrations")
      .update({
        is_connected: true,
        access_token: sessionToken,
        token_expires_at: tokenExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingIntegration.id)
      .select()
      .single();

    if (connectionError) {
      console.error("Database error:", connectionError);
      return new Response(
        JSON.stringify({ error: "Failed to save connection", details: connectionError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Connection activated successfully: ${connection.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        connectionId: connection.id,
        message: "Successfully connected to iplicit",
        tokenExpiresAt: tokenExpiry,
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
