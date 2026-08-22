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
    const { invoiceId, approverId } = await req.json();

    if (!invoiceId || !approverId) {
      return new Response(
        JSON.stringify({ error: "Invoice ID and Approver ID are required" }),
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

    // Fetch invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from("accounts_payable_invoice")
      .select("id, invoice_number, vendor_name, invoice_date, due_date, currency, total_amount")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      console.error("Invoice error:", invoiceError);
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch line items assigned to this specific approver
    const { data: lineItems, error: itemsError } = await supabase
      .from("accounts_payable_invoice_line_item")
      .select("id, description, line_total, approval_status, approver_id, approver_amount, approver_percentage, approved_at, approval_notes")
      .eq("accounts_payable_invoice_id", invoiceId)
      .eq("approver_id", approverId)
      .order("created_at", { ascending: true });

    if (itemsError) {
      console.error("Line items error:", itemsError);
    }

    return new Response(
      JSON.stringify({
        invoice,
        lineItems: lineItems || [],
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
