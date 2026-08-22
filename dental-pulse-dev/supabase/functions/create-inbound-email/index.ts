import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Inbound.dev configuration with defaults
const INBOUND_CONFIG = {
  apiKey: "KsKMXtfvdfqVwlDjVJqyZYVSUYnvQpFprBsRexMZpwdyFpKqijmSNyaSxnovzUBX",
  apiUrl: "https://inbound.new/api/e2",
  domain: "inbox.dentledger.denish-faldu.in",
  domainId: "indm_yvCvTEbfYSZQooxCZyGjH",
  endpointId: "2ZOlSg4EAZcfjsYV6_hKF",
};

// Email types to create
const EMAIL_TYPES = ["cost", "sales"];

// Generate random alphanumeric code (8-10 characters)
function generateRandomCode(length: number = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper function to log to database
async function logToDatabase(
  supabase: any,
  params: {
    organizationId?: string;
    userId?: string;
    action: string;
    status: string;
    requestPayload?: any;
    responsePayload?: any;
    errorMessage?: string;
    errorCode?: string;
    metadata?: any;
  }
) {
  try {
    await supabase.from("inbound_email_logs").insert({
      organization_id: params.organizationId || null,
      user_id: params.userId || null,
      action: params.action,
      status: params.status,
      request_payload: params.requestPayload || null,
      response_payload: params.responsePayload || null,
      error_message: params.errorMessage || null,
      error_code: params.errorCode || null,
      metadata: params.metadata || null,
    });
  } catch (error) {
    console.error("Failed to write log:", error);
  }
}

// Helper function to create a single inbound email
async function createSingleInboundEmail(
  supabase: any,
  params: {
    organizationId: string;
    userId?: string;
    locationId?: string;
    emailType: string;
    generatedEmail: string;
    inboundApiKey: string;
    inboundApiUrl: string;
    inboundDomainId: string;
  }
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { organizationId, userId, locationId, emailType, generatedEmail, inboundApiKey, inboundApiUrl, inboundDomainId } = params;

  try {
    // Register with Inbound.dev API
    const payload = {
      address: generatedEmail,
      domainId: inboundDomainId,
      isActive: true,
      endpointId: INBOUND_CONFIG.endpointId,
    };

    console.log(`Creating ${emailType} inbound email:`, generatedEmail);

    const response = await fetch(`${inboundApiUrl}/email-addresses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${inboundApiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log(`Inbound API response for ${emailType}:`, {
      status: response.status,
      body: responseText.substring(0, 500),
    });

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    // Handle success (200/201) or conflict (409 - already exists)
    if (response.ok || response.status === 409) {
      // 409 means email already exists in Inbound.dev - treat as success
      if (response.status === 409) {
        console.log(`${emailType} email already exists in Inbound.dev:`, generatedEmail);
      }

      // Insert into location_inbound_emails table
      const insertData: any = {
        organization_id: organizationId,
        user_id: userId || null,
        email_type: emailType,
        inbound_email_address: generatedEmail,
        inbound_provider_id: responseData.id || responseData.data?.id || null,
        inbound_meta: responseData,
        inbound_created: 1,
      };

      // Add location_id if provided (for location-specific emails)
      if (locationId) {
        insertData.location_id = locationId;
      }

      const { error: insertError } = await supabase
        .from("location_inbound_emails")
        .insert(insertData);

      if (insertError) {
        console.error(`Error inserting ${emailType} inbound email:`, insertError);
        return { success: false, error: insertError.message };
      }

      return { success: true, data: { email: generatedEmail, providerResponse: responseData } };
    } else {
      console.error(`Inbound API error for ${emailType}:`, responseData);
      return { success: false, error: `API error: ${response.status}` };
    }
  } catch (error) {
    console.error(`Exception creating ${emailType} email:`, error);
    return { success: false, error: error.message };
  }
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Create Supabase client
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { organizationId, organizationName, userId, locationId, locationName } = await req.json();

    if (!organizationId) {
      await logToDatabase(supabase, {
        action: "create_inbound_address",
        status: "failed",
        errorMessage: "Organization ID is required",
        errorCode: "MISSING_ORG_ID",
      });

      return new Response(
        JSON.stringify({ error: "Organization ID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Log the request
    await logToDatabase(supabase, {
      organizationId,
      userId,
      action: locationId ? "create_location_inbound_address" : "create_inbound_address",
      status: "pending",
      requestPayload: { organizationId, organizationName, userId, locationId, locationName },
      metadata: { step: "started", emailTypes: EMAIL_TYPES, locationId },
    });

    // Use config values (can override from env if needed)
    const inboundApiKey = Deno.env.get("INBOUND_API_KEY") || INBOUND_CONFIG.apiKey;
    const inboundApiUrl = INBOUND_CONFIG.apiUrl;
    const inboundDomain = Deno.env.get("INBOUND_DOMAIN") || INBOUND_CONFIG.domain;
    const inboundDomainId = Deno.env.get("INBOUND_DOMAIN_ID") || INBOUND_CONFIG.domainId;
    const inboundEndpointId = Deno.env.get("INBOUND_ENDPOINT_ID") || INBOUND_CONFIG.endpointId;

    console.log("Using Inbound config:", {
      apiUrl: inboundApiUrl,
      domain: inboundDomain,
      domainId: inboundDomainId,
      endpointId: inboundEndpointId,
    });

    // Check if organization exists
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", organizationId)
      .single();

    if (orgError) {
      console.error("Error fetching organization:", orgError);
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check existing inbound emails - for location or organization
    let existingEmailsQuery = supabase
      .from("location_inbound_emails")
      .select("id, email_type, inbound_email_address, inbound_created, location_id")
      .eq("organization_id", organizationId);

    // If locationId provided, filter for location-specific emails
    if (locationId) {
      existingEmailsQuery = existingEmailsQuery.eq("location_id", locationId);
    } else {
      existingEmailsQuery = existingEmailsQuery.is("location_id", null);
    }

    const { data: existingEmails } = await existingEmailsQuery;

    const existingEmailsMap = new Map();
    if (existingEmails) {
      for (const email of existingEmails) {
        existingEmailsMap.set(email.email_type, email);
      }
    }

    // Check if both emails already exist
    const allExist = EMAIL_TYPES.every(type => {
      const existing = existingEmailsMap.get(type);
      return existing && existing.inbound_created === 1 && existing.inbound_email_address;
    });

    if (allExist) {
      const result: Record<string, string> = {};
      EMAIL_TYPES.forEach(type => {
        result[`${type}_email`] = existingEmailsMap.get(type).inbound_email_address;
      });

      await logToDatabase(supabase, {
        organizationId,
        action: locationId ? "create_location_inbound_address" : "create_inbound_address",
        status: "success",
        responsePayload: result,
        metadata: { step: "already_exists", locationId },
      });

      return new Response(
        JSON.stringify({
          status: "exists",
          ...result,
          location_id: locationId || undefined,
          message: locationId ? "Location inbound emails already exist" : "Inbound emails already exist",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Generate base slug for email addresses (use location name if provided)
    const nameForSlug = locationId ? (locationName || "location") : (organizationName || org.name || "org");
    const baseSlug = nameForSlug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 20);

    // Create emails for each type that doesn't exist
    const results: Record<string, any> = {};
    const errors: string[] = [];

    for (const emailType of EMAIL_TYPES) {
      const existing = existingEmailsMap.get(emailType);

      if (existing && existing.inbound_created === 1 && existing.inbound_email_address) {
        // Already exists, use existing
        results[`${emailType}_email`] = existing.inbound_email_address;
        console.log(`${emailType} email already exists:`, existing.inbound_email_address);
      } else {
        // Create new email with random code
        const randomCode = generateRandomCode(8);
        const generatedEmail = `${baseSlug}_${emailType}_${randomCode}@${inboundDomain}`;

        const createResult = await createSingleInboundEmail(supabase, {
          organizationId,
          userId,
          locationId,
          emailType,
          generatedEmail,
          inboundApiKey,
          inboundApiUrl,
          inboundDomainId,
        });

        if (createResult.success) {
          results[`${emailType}_email`] = generatedEmail;
        } else {
          errors.push(`${emailType}: ${createResult.error}`);
        }
      }
    }

    // Log final result
    await logToDatabase(supabase, {
      organizationId,
      action: locationId ? "create_location_inbound_address" : "create_inbound_address",
      status: errors.length === 0 ? "success" : "partial",
      responsePayload: results,
      errorMessage: errors.length > 0 ? errors.join("; ") : null,
      metadata: { step: "completed", createdTypes: Object.keys(results), errors, locationId },
    });

    if (Object.keys(results).length === 0) {
      return new Response(
        JSON.stringify({
          status: "error",
          error: "Failed to create any inbound emails",
          details: errors,
          location_id: locationId || undefined,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        status: errors.length === 0 ? "created" : "partial",
        ...results,
        location_id: locationId || undefined,
        message: errors.length === 0
          ? (locationId ? "Location inbound emails created successfully" : "Inbound emails created successfully")
          : "Some emails created with errors",
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error:", error);

    await logToDatabase(supabase, {
      action: "create_inbound_address",
      status: "failed",
      errorMessage: error.message || "Internal server error",
      errorCode: "EXCEPTION",
      metadata: { step: "exception", error: String(error) },
    });

    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
