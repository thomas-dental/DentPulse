const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

interface GA4AuthRequest {
  organizationId: string;
  userId: string;
  origin?: string; // Frontend origin (e.g. http://localhost:8080 or https://dev-enterprise.dentpulse.com)
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    const body: GA4AuthRequest = await req.json();
    const { organizationId, userId, origin } = body;

    console.log(`Processing GA4 OAuth initiation for org: ${organizationId}, user: ${userId}`);

    // Validate required fields
    if (!organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing organization ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing user ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Google OAuth credentials from environment
    const clientId = Deno.env.get("GA4_CLIENT_ID");
    if (!clientId) {
      console.error("GA4_CLIENT_ID not configured in environment");
      return new Response(
        JSON.stringify({ success: false, error: "Google Analytics OAuth not configured. Please contact support." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the Google OAuth authorization URL
    const googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";

    // Use the origin from the frontend request so it works for both local and production
    const appOrigin = origin || "https://dev-enterprise.dentpulse.com";
    const redirectUri = `${appOrigin}/auth/ga4/callback`;

    // Google OAuth scopes for GA4
    const scopes = [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/analytics.readonly",
    ].join(" ");

    // Encode state with organization ID, user ID, and origin (so callback uses matching redirect_uri)
    const stateData = {
      organizationId,
      userId,
      origin: appOrigin,
    };
    const state = btoa(JSON.stringify(stateData));

    // Build authorization URL
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state: state,
      access_type: "offline", // Request refresh token
      prompt: "consent", // Force consent to get refresh token
    });

    const authorizationUrl = `${googleAuthUrl}?${params.toString()}`;

    console.log(`Generated GA4 authorization URL for org ${organizationId}`);

    return new Response(
      JSON.stringify({
        success: true,
        authorizationUrl: authorizationUrl,
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
