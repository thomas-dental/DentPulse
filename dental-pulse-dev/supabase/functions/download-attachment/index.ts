import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const inboundApiKey = Deno.env.get("INBOUND_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { attachmentId } = await req.json();

    if (!attachmentId) {
      return new Response(
        JSON.stringify({ error: "attachmentId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch the attachment record with user_id from inbound_emails
    const { data: attachment, error: fetchError } = await supabase
      .from("inbound_email_attachments")
      .select("*, inbound_emails!inner(organization_id, user_id)")
      .eq("id", attachmentId)
      .single();

    if (fetchError || !attachment) {
      console.error("Failed to fetch attachment", fetchError);
      return new Response(
        JSON.stringify({ error: "Attachment not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If already stored, return the public URL
    if (attachment.stored_path) {
      // Use storage_bucket from DB, default to inbound-attechments
      const bucketName = attachment.storage_bucket || "inbound-attechments";
      const { data: urlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(attachment.stored_path);

      return new Response(
        JSON.stringify({
          success: true,
          publicUrl: urlData.publicUrl,
          alreadyStored: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if download_url exists
    if (!attachment.download_url) {
      return new Response(
        JSON.stringify({ error: "No download URL available for this attachment" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Download the file from the external URL
    const headers: Record<string, string> = {};
    if (inboundApiKey) {
      headers["Authorization"] = `Bearer ${inboundApiKey}`;
    }

    console.log("Downloading attachment from:", attachment.download_url);

    const response = await fetch(attachment.download_url, { headers });
    if (!response.ok) {
      console.error("Failed to download file", { status: response.status });
      return new Response(
        JSON.stringify({ error: `Failed to download file: ${response.status}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const fileBuffer = await response.arrayBuffer();

    // Generate storage path with timestamp to avoid conflicts
    const timestamp = Date.now();
    const filename = attachment.filename || `attachment_${attachmentId}`;
    const storagePath = `${timestamp}_${filename}`;

    // Upload to Supabase Storage (inbound-attechments bucket)
    const { error: uploadError } = await supabase.storage
      .from("inbound-attechments")
      .upload(storagePath, fileBuffer, {
        contentType: attachment.mime_type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.error("Failed to upload file to storage", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to store file" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update attachment record with stored path and bucket
    const { error: updateError } = await supabase
      .from("inbound_email_attachments")
      .update({
        stored_path: storagePath,
        storage_bucket: "inbound-attechments",
      })
      .eq("id", attachmentId);

    if (updateError) {
      console.error("Failed to update attachment record", updateError);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("inbound-attechments")
      .getPublicUrl(storagePath);

    console.log("File stored successfully at:", storagePath);

    return new Response(
      JSON.stringify({
        success: true,
        publicUrl: urlData.publicUrl,
        storagePath,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in download-attachment function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
