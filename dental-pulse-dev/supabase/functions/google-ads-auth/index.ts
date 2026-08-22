const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

interface GoogleAdsAuthRequest {
  organizationId: string;
  userId: string;
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
    const body: GoogleAdsAuthRequest = await req.json();
    const { organizationId, userId } = body;

    console.log(`Processing Google Ads OAuth initiation for org: ${organizationId}, user: ${userId}`);

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
    const clientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID");
    if (!clientId) {
      console.error("GOOGLE_ADS_CLIENT_ID not configured in environment");
      return new Response(
        JSON.stringify({ success: false, error: "Google OAuth not configured. Please contact support." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the Google OAuth authorization URL
    const googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";

    // Redirect URI for Google Ads callback - use environment variable with fallback
    const redirectUri = Deno.env.get("GOOGLE_ADS_REDIRECT_URI") || "https://dev-enterprise.dentpulse.com/auth/google-ads/callback";

    // Google OAuth scopes for Google Ads API
    const scopes = [
      "https://www.googleapis.com/auth/adwords",
    ].join(" ");

    // Encode state with organization ID and user ID only
    const stateData = {
      organizationId,
      userId,
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

    console.log(`Generated Google Ads authorization URL for org ${organizationId}`);

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
