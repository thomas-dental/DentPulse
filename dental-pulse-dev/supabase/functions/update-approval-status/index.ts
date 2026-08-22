import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    const { itemIds, approverId, status, reason } = await req.json();

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "Item IDs are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!approverId) {
      return new Response(
        JSON.stringify({ error: "Approver ID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!status || !['approved', 'rejected'].includes(status)) {
      return new Response(
        JSON.stringify({ error: "Valid status (approved/rejected) is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (status === 'rejected' && !reason) {
      return new Response(
        JSON.stringify({ error: "Rejection reason is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create Supabase client with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify items belong to this approver before updating
    const { data: existingItems, error: verifyError } = await supabase
      .from("accounts_payable_invoice_line_item")
      .select("id")
      .in("id", itemIds)
      .eq("approver_id", approverId);

    if (verifyError) {
      console.error("Verify error:", verifyError);
      return new Response(
        JSON.stringify({ error: "Failed to verify items" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!existingItems || existingItems.length === 0) {
      return new Response(
        JSON.stringify({ error: "No items found for this approver" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Only update items that belong to this approver
    const validItemIds = existingItems.map(item => item.id);

    // Build update object
    const updateData: Record<string, any> = {
      approval_status: status,
      approved_at: new Date().toISOString(),
    };

    if (status === 'rejected' && reason) {
      updateData.approval_notes = reason;
    }

    // Update the items
    const { data: updatedItems, error: updateError } = await supabase
      .from("accounts_payable_invoice_line_item")
      .update(updateData)
      .in("id", validItemIds)
      .select();

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update items" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        updatedCount: updatedItems?.length || 0,
        items: updatedItems,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
