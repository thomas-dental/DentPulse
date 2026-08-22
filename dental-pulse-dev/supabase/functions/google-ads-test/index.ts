/**
 * Google Ads Configuration Test Endpoint
 *
 * Use this to verify your Google Ads API configuration is correct.
 *
 * Test with:
 * curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/google-ads-test \
 *   -H "Content-Type: application/json" \
 *   -d '{"accessToken": "YOUR_ACCESS_TOKEN"}'
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const GOOGLE_ADS_API_VERSION = "v23";
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Read environment variables
    const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
    const mccCustomerId = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    const clientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET");

    // Configuration check results
    const config = {
      GOOGLE_ADS_DEVELOPER_TOKEN: {
        set: !!developerToken,
        length: developerToken?.length || 0,
        preview: developerToken ? `${developerToken.substring(0, 4)}...${developerToken.substring(developerToken.length - 4)}` : null,
      },
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: {
        set: !!mccCustomerId,
        value: mccCustomerId || null,
      },
      GOOGLE_ADS_CLIENT_ID: {
        set: !!clientId,
        preview: clientId ? `${clientId.substring(0, 20)}...` : null,
      },
      GOOGLE_ADS_CLIENT_SECRET: {
        set: !!clientSecret,
        length: clientSecret?.length || 0,
      },
    };

    // Parse request body for optional access token test
    let accessToken: string | null = null;
    let clientCustomerId: string | null = null;

    try {
      const body = await req.json();
      accessToken = body.accessToken || null;
      clientCustomerId = body.clientCustomerId || null;
    } catch {
      // No body or invalid JSON - that's OK for config check
    }

    // If no access token provided, just return config check
    if (!accessToken) {
      const issues: string[] = [];
      if (!developerToken) issues.push("GOOGLE_ADS_DEVELOPER_TOKEN is not set");
      if (!mccCustomerId) issues.push("GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC ID) is not set");
      if (!clientId) issues.push("GOOGLE_ADS_CLIENT_ID is not set");
      if (!clientSecret) issues.push("GOOGLE_ADS_CLIENT_SECRET is not set");

      return new Response(
        JSON.stringify({
          success: issues.length === 0,
          message: issues.length === 0
            ? "All required environment variables are configured!"
            : "Missing configuration - see issues below",
          config,
          issues,
          hint: "To test the API connection, include 'accessToken' and 'clientCustomerId' in the request body",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Test API connection with provided access token
    if (!developerToken || !mccCustomerId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Cannot test API - missing developer token or MCC ID",
          config,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use provided client ID or default to MCC ID for basic test
    const testCustomerId = (clientCustomerId || mccCustomerId).replace(/-/g, "");
    const cleanMccId = mccCustomerId.replace(/-/g, "");

    // Simple query to test API access
    const testQuery = `SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1`;
    const url = `${GOOGLE_ADS_BASE_URL}/customers/${testCustomerId}/googleAds:search`;

    console.log("=== API Test Request ===");
    console.log("URL:", url);
    console.log("Client ID:", testCustomerId);
    console.log("MCC ID (login-customer-id):", cleanMccId);
    console.log("Developer Token:", `${developerToken.substring(0, 4)}...`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "login-customer-id": cleanMccId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: testQuery }),
    });

    const responseText = await response.text();
    const contentType = response.headers.get("content-type") || "";

    console.log("Response status:", response.status);
    console.log("Response content-type:", contentType);
    console.log("Response (first 500 chars):", responseText.substring(0, 500));

    // Check for HTML response
    if (responseText.includes("<!DOCTYPE") || responseText.includes("<html") || responseText.startsWith("<!")) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Received HTML response instead of JSON",
          diagnosis: {
            httpStatus: response.status,
            contentType,
            possibleCauses: [
              "Developer token is invalid or in 'Test Account' mode",
              "Developer token needs to be approved by Google",
              "MCC ID doesn't have access to the client account",
              "Access token has expired",
            ],
            recommendations: [
              "Check Google Ads API Center: https://ads.google.com/aw/apicenter",
              "Ensure developer token is in 'Production' mode (not 'Test Account')",
              `Verify MCC account (${cleanMccId}) has access to client account (${testCustomerId})`,
              "Try reconnecting Google Ads to get a fresh access token",
            ],
          },
          responsePreview: responseText.substring(0, 300),
          config,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to parse JSON response
    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Could not parse response as JSON",
          httpStatus: response.status,
          responsePreview: responseText.substring(0, 500),
          config,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for API errors
    if (!response.ok || responseData.error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Google Ads API returned an error",
          httpStatus: response.status,
          apiError: responseData.error || responseData,
          config,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Success!
    return new Response(
      JSON.stringify({
        success: true,
        message: "Google Ads API connection successful!",
        testResult: {
          customerId: testCustomerId,
          results: responseData.results || [],
        },
        config,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Test error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Test failed with exception",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
