import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Map sync frequencies to milliseconds
const syncFrequencyMs: Record<string, number> = {
  "15min": 15 * 60 * 1000,
  "30min": 30 * 60 * 1000,
  "1hour": 60 * 60 * 1000,
  "4hours": 4 * 60 * 60 * 1000,
  "daily": 24 * 60 * 60 * 1000,
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log("Running scheduled sync check...");

    // Get all connected accounting connections that need syncing
    const { data: connections, error: fetchError } = await supabase
      .from("accounting_connections")
      .select("*")
      .eq("status", "connected")
      .eq("platform", "iplicit");

    if (fetchError) {
      console.error("Failed to fetch connections:", fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch connections" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!connections || connections.length === 0) {
      console.log("No active connections to sync");
      return new Response(
        JSON.stringify({ message: "No connections to sync", synced: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const syncResults: Array<{ connectionId: string; status: string; message: string }> = [];

    for (const connection of connections) {
      const { id: connectionId, sync_frequency, last_sync } = connection;
      const frequencyMs = syncFrequencyMs[sync_frequency] || syncFrequencyMs["1hour"];
      
      // Check if sync is due
      let shouldSync = false;
      if (!last_sync) {
        shouldSync = true;
      } else {
        const lastSyncDate = new Date(last_sync);
        const timeSinceLastSync = now.getTime() - lastSyncDate.getTime();
        shouldSync = timeSinceLastSync >= frequencyMs;
      }

      if (!shouldSync) {
        console.log(`Connection ${connectionId}: Sync not due yet`);
        syncResults.push({
          connectionId,
          status: "skipped",
          message: "Sync not due yet",
        });
        continue;
      }

      console.log(`Connection ${connectionId}: Triggering scheduled sync`);

      try {
        // Call the sync function
        const response = await fetch(`${supabaseUrl}/functions/v1/iplicit-sync-v2`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            connectionId,
            isScheduled: true,
          }),
        });

        const result = await response.json();

        if (response.ok && result.success) {
          console.log(`Connection ${connectionId}: Sync completed, ${result.totalRecords} records`);
          syncResults.push({
            connectionId,
            status: "success",
            message: `Synced ${result.totalRecords} records`,
          });
        } else {
          console.error(`Connection ${connectionId}: Sync failed -`, result.error);
          syncResults.push({
            connectionId,
            status: "failed",
            message: result.error || "Sync failed",
          });
        }
      } catch (syncError) {
        const errorMessage = syncError instanceof Error ? syncError.message : "Unknown error";
        console.error(`Connection ${connectionId}: Sync error -`, errorMessage);
        syncResults.push({
          connectionId,
          status: "error",
          message: errorMessage,
        });
      }
    }

    const successCount = syncResults.filter(r => r.status === "success").length;
    const failedCount = syncResults.filter(r => r.status === "failed" || r.status === "error").length;

    console.log(`Scheduled sync complete: ${successCount} succeeded, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${connections.length} connections`,
        results: syncResults,
        summary: {
          total: connections.length,
          synced: successCount,
          failed: failedCount,
          skipped: syncResults.filter(r => r.status === "skipped").length,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Scheduled sync error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Scheduled sync failed", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
