import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, origin",
};

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

interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface XeroTenant {
  id: string;
  authEventId: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
  createdDateUtc: string;
  updatedDateUtc: string;
}

interface XeroCallbackRequest {
  code: string;
  state: string; // This is the integration_id
  currentOrigin?: string; // Frontend passes its current origin
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
        JSON.stringify({ success: false, error: "Xero integration not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client with service role key (no auth needed for callback)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log("Supabase URL exists:", !!supabaseUrl);
    console.log("Service key exists:", !!supabaseServiceKey);

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase environment variables");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration error - missing environment variables"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: XeroCallbackRequest;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { code, state, currentOrigin } = body;

    console.log(`Processing Xero OAuth callback, state: ${state?.startsWith("new:") ? "new:<org>:<user>:<nonce>" : state}, origin: ${currentOrigin}`);

    // Set redirect URI based on frontend origin
    const xeroRedirectUri = getRedirectUri(currentOrigin);

    if (!code || !state) {
      return new Response(
        JSON.stringify({ error: "Missing code or state parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve state. Two shapes:
    //  - Reconnect: state = integration row UUID (existing row to update)
    //  - New connect: state = "new:<organization_id>:<user_id>:<nonce>"
    //    (defer row creation until OAuth completes; mirrors quickbooks-callback)
    let integrationId: string | null = null;
    let integration: any = null;
    let newConnectOrgId: string | null = null;
    let newConnectUserId: string | null = null;

    if (state.startsWith("new:")) {
      const parts = state.split(":");
      if (parts.length < 4) {
        return new Response(
          JSON.stringify({ error: "Malformed state parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      newConnectOrgId = parts[1];
      newConnectUserId = parts[2];
      // Build a synthetic `integration` shape for the rest of the flow. Row
      // not yet created — we'll insert or pick an existing one after tenants
      // come back from Xero.
      integration = {
        organization_id: newConnectOrgId,
        user_id: newConnectUserId,
      };
      console.log(`New Xero connect — will create or reuse row after tenant lookup for org ${newConnectOrgId}`);
    } else {
      // Reconnect path: state is the integration id
      integrationId = state;
      const { data: existing, error: fetchError } = await supabase
        .from("platform_integrations")
        .select("*")
        .eq("id", integrationId)
        .eq("platform_name", "xero")
        .single();

      if (fetchError || !existing) {
        console.error("Failed to fetch integration:", fetchError);
        return new Response(
          JSON.stringify({ error: "Integration not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      integration = existing;
    }

    // Exchange authorization code for tokens using env credentials
    const tokenUrl = "https://identity.xero.com/connect/token";

    // Create Basic auth header with env credentials
    const credentials = btoa(`${xeroClientId}:${xeroClientSecret}`);

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: xeroRedirectUri,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`Xero token exchange failed: ${tokenResponse.status} - ${errorText}`);
      return new Response(
        JSON.stringify({
          error: "Failed to exchange authorization code",
          details: `Status: ${tokenResponse.status}`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData: XeroTokenResponse = await tokenResponse.json();
    console.log("Successfully obtained Xero tokens");

    // Calculate token expiry time
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // ============================================
    // FETCH XERO TENANTS/ORGANIZATIONS
    // ============================================
    // Mirrors quickbooks-callback: fetch tenants FIRST, then decide which row
    // gets the fresh tokens. On a new connect we have no row yet — we create
    // it here only if needed. On a reconnect we use the row from `state`.
    console.log("Fetching Xero tenants...");

    const tenantsResponse = await fetch("https://api.xero.com/connections", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
    });

    let tenants: XeroTenant[] = [];
    if (tenantsResponse.ok) {
      tenants = await tenantsResponse.json();
      console.log(`Found ${tenants.length} Xero tenant(s)`);
    } else {
      const errorText = await tenantsResponse.text();
      console.error(`Failed to fetch Xero tenants: ${tenantsResponse.status} - ${errorText}`);
    }

    // ── Resolve effective integration id ──
    // 1. If ANY returned tenant already exists on an integration in this org →
    //    reuse that integration (mirrors xero/qb dedupe so the same Xero user
    //    coming back doesn't spawn a new row).
    // 2. Else if state was a reconnect (integrationId set) → use that row.
    // 3. Else (new connect, no tenant match) → INSERT a fresh integration row.
    let effectiveIntegrationId: string | null = null;
    let reconnected = false;

    if (tenants.length > 0) {
      const tenantIds = tenants.map(t => t.tenantId);
      let dedupeQuery = supabase
        .from("platform_integration_organizations")
        .select("platform_integration_id, platform_org_id")
        .eq("organization_id", integration.organization_id)
        .eq("platform_name", "xero")
        .in("platform_org_id", tenantIds);
      if (integrationId) {
        // On reconnect, we only care about OTHER integrations carrying the
        // same tenant — that means someone else already owns this Xero user.
        dedupeQuery = dedupeQuery.neq("platform_integration_id", integrationId);
      }
      const { data: existingOrgs } = await dedupeQuery;
      if (existingOrgs && existingOrgs.length > 0) {
        effectiveIntegrationId = existingOrgs[0].platform_integration_id;
        reconnected = true;
        console.log(`Same Xero user detected: updating tokens on existing integration ${effectiveIntegrationId}`);
      }
    }

    if (!effectiveIntegrationId) {
      if (integrationId) {
        // Reconnect path with no tenant collision — use the row from state.
        effectiveIntegrationId = integrationId;
      } else {
        // New connect, no existing match → create the integration row NOW.
        // (Deferred creation; nothing exists if OAuth aborts.)
        const { data: newIntegration, error: insertError } = await supabase
          .from("platform_integrations")
          .insert({
            organization_id: integration.organization_id,
            user_id: integration.user_id,
            platform_name: "xero",
            is_connected: false, // flipped to true below once tokens are saved
          })
          .select("id")
          .single();
        if (insertError || !newIntegration) {
          console.error("Failed to create integration row:", insertError);
          return new Response(
            JSON.stringify({ error: "Failed to create integration record", details: insertError?.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        effectiveIntegrationId = newIntegration.id;
        console.log(`Created new Xero integration ${effectiveIntegrationId} for org ${integration.organization_id}`);
      }
    }

    // Save tokens onto the resolved integration row.
    const { error: updateError } = await supabase
      .from("platform_integrations")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: tokenExpiresAt,
        is_connected: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", effectiveIntegrationId);

    if (updateError) {
      console.error("Failed to save tokens:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to save tokens", details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If we transferred to an existing integration during a reconnect (state
    // was a UUID but a different row already owned this tenant), the row at
    // `integrationId` is now a leftover from the reconnect flow — delete it.
    if (integrationId && integrationId !== effectiveIntegrationId) {
      await supabase
        .from("platform_integrations")
        .delete()
        .eq("id", integrationId);
      console.log(`Cleaned up redundant integration ${integrationId}`);
    }

    console.log(`Xero tokens saved successfully for integration ${effectiveIntegrationId}`);

    // From here, the rest of the function works against `effectiveIntegrationId`.
    if (tenants.length > 0) {

      // Save each tenant to platform_integration_organizations
      for (const tenant of tenants) {
        console.log(`Saving tenant: ${tenant.tenantName} (${tenant.tenantId})`);

        // Fetch organization details from Xero for additional info
        let orgDetails: any = null;
        try {
          const orgResponse = await fetch("https://api.xero.com/api.xro/2.0/Organisation", {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${tokenData.access_token}`,
              "Xero-tenant-id": tenant.tenantId,
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
          });

          if (orgResponse.ok) {
            const orgData = await orgResponse.json();
            orgDetails = orgData.Organisations?.[0] || null;
            console.log(`Got org details for ${tenant.tenantName}:`, orgDetails?.Name);
          }
        } catch (orgError) {
          console.error(`Failed to fetch org details for ${tenant.tenantId}:`, orgError);
        }

        // Upsert tenant to platform_integration_organizations
        const { error: upsertError } = await supabase
          .from("platform_integration_organizations")
          .upsert(
            {
              organization_id: integration.organization_id,
              platform_integration_id: effectiveIntegrationId,
              user_id: integration.user_id,
              platform_name: "xero",
              platform_org_id: tenant.tenantId,
              platform_org_name: tenant.tenantName,
              platform_org_code: orgDetails?.ShortCode || null,
              email: orgDetails?.Addresses?.find((a: any) => a.AddressType === "POBOX")?.Email || null,
              country: orgDetails?.CountryCode || null,
              currency: orgDetails?.BaseCurrency || null,
              timezone: orgDetails?.Timezone || null,
              status: "active",
              is_selected: tenants.length === 1, // Auto-select if only one tenant
              raw_data: {
                tenant: tenant,
                organisation: orgDetails,
              },
              meta_data: {
                tenantType: tenant.tenantType,
                authEventId: tenant.authEventId,
                createdDateUtc: tenant.createdDateUtc,
                updatedDateUtc: tenant.updatedDateUtc,
                organisationType: orgDetails?.OrganisationType || null,
                organisationStatus: orgDetails?.OrganisationStatus || null,
                legalName: orgDetails?.LegalName || null,
                taxNumber: orgDetails?.TaxNumber || null,
                financialYearEndDay: orgDetails?.FinancialYearEndDay || null,
                financialYearEndMonth: orgDetails?.FinancialYearEndMonth || null,
              },
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "platform_integration_id,platform_org_id",
            }
          );

        if (upsertError) {
          console.error(`Failed to save tenant ${tenant.tenantId}:`, upsertError);
        } else {
          console.log(`Saved tenant: ${tenant.tenantName}`);
        }
      }

      // Clean up stale tenants: mark as inactive any tenants on this integration
      // that are NOT in the current OAuth's tenant list
      const currentTenantIds = tenants.map(t => t.tenantId);
      const { data: staleOrgs } = await supabase
        .from("platform_integration_organizations")
        .select("id, platform_org_id, platform_org_name")
        .eq("platform_integration_id", effectiveIntegrationId)
        .eq("platform_name", "xero")
        .eq("status", "active");

      if (staleOrgs && staleOrgs.length > 0) {
        const toDeactivate = staleOrgs.filter((o: any) => !currentTenantIds.includes(o.platform_org_id));
        for (const stale of toDeactivate) {
          console.log(`Deactivating stale tenant: ${stale.platform_org_name} (${stale.platform_org_id})`);
          await supabase
            .from("platform_integration_organizations")
            .update({ status: "inactive", updated_at: new Date().toISOString() })
            .eq("id", stale.id);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        reconnected,
        integrationId: effectiveIntegrationId,
        organizationId: integration.organization_id,
        message: reconnected
          ? "Xero tokens refreshed. Existing connection updated."
          : "Successfully connected to Xero.",
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
