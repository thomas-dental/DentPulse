import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AccountMapping {
  account_type: string;
  selected_account: string[];
}

interface OrganizationSettingsRequest {
  organizationId: string;
  privateIncome?: AccountMapping;
  membershipIncome?: AccountMapping;
  nhsIncome?: AccountMapping;
  labFees?: AccountMapping;
  staffCosts?: AccountMapping;
  operatingLease?: AccountMapping;
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

    const body: OrganizationSettingsRequest = await req.json();
    const {
      organizationId,
      privateIncome,
      membershipIncome,
      nhsIncome,
      labFees,
      staffCosts,
      operatingLease
    } = body;

    console.log(`Processing organization settings save for org: ${organizationId}`);

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing organization ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user has access to this organization
    const { data: userRole, error: roleError } = await supabase
      .from("user_roles")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();

    if (roleError || !userRole) {
      console.error("User role check failed:", roleError);
      return new Response(
        JSON.stringify({ error: "Unauthorized access to this organization" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate account mappings
    const validateMapping = (mapping: AccountMapping | undefined, fieldName: string): string | null => {
      if (!mapping) return null;

      if (!mapping.account_type || !['PMS App', 'Accounting App'].includes(mapping.account_type)) {
        return `Invalid account_type for ${fieldName}. Must be 'PMS App' or 'Accounting App'`;
      }

      if (!Array.isArray(mapping.selected_account)) {
        return `Invalid selected_account for ${fieldName}. Must be an array`;
      }

      return null;
    };

    // Validate all mappings
    const validationErrors = [
      validateMapping(privateIncome, 'privateIncome'),
      validateMapping(membershipIncome, 'membershipIncome'),
      validateMapping(nhsIncome, 'nhsIncome'),
      validateMapping(labFees, 'labFees'),
      validateMapping(staffCosts, 'staffCosts'),
      validateMapping(operatingLease, 'operatingLease'),
    ].filter(Boolean);

    if (validationErrors.length > 0) {
      return new Response(
        JSON.stringify({ error: "Validation failed", details: validationErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build update object
    const updateData: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };

    if (privateIncome) {
      updateData.private_income = JSON.stringify(privateIncome);
    }
    if (membershipIncome) {
      updateData.membership_income = JSON.stringify(membershipIncome);
    }
    if (nhsIncome) {
      updateData.nhs_income = JSON.stringify(nhsIncome);
    }
    if (labFees) {
      updateData.lab_fees = JSON.stringify(labFees);
    }
    if (staffCosts) {
      updateData.staff_costs = JSON.stringify(staffCosts);
    }
    if (operatingLease) {
      updateData.operating_lease = JSON.stringify(operatingLease);
    }

    console.log("Updating organization with data:", updateData);

    // Update organization settings
    const { data: updatedOrg, error: updateError } = await supabase
      .from("organizations")
      .update(updateData)
      .eq("id", organizationId)
      .select()
      .single();

    if (updateError) {
      console.error("Failed to update organization:", updateError);
      return new Response(
        JSON.stringify({
          error: "Failed to save organization settings",
          details: updateError.message
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully updated organization settings for ${organizationId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Organization settings saved successfully",
        data: {
          id: updatedOrg.id,
          private_income: updatedOrg.private_income,
          membership_income: updatedOrg.membership_income,
          nhs_income: updatedOrg.nhs_income,
          lab_fees: updatedOrg.lab_fees,
          staff_costs: updatedOrg.staff_costs,
          operating_lease: updatedOrg.operating_lease,
          updated_at: updatedOrg.updated_at,
        },
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
