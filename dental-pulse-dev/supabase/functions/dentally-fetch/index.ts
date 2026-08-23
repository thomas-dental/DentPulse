import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { organization_id, start_date, end_date } = await req.json();

    if (!organization_id || !start_date || !end_date) {
      return new Response(
        JSON.stringify({ error: "organization_id, start_date, end_date are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: integration, error: intErr } = await supabase
      .from("integrations")
      .select("api_key, api_endpoints")
      .eq("organization_id", organization_id)
      .eq("integration_name", "Dentally")
      .eq("is_connected", true)
      .maybeSingle();

    if (intErr || !integration) {
      return new Response(
        JSON.stringify({ error: "Dentally integration not found or not connected" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = integration.api_key;
    const apiEndpoint = (integration.api_endpoints || "https://api.dentally.co").replace(/\/$/, "");

    const allItems: Record<string, unknown>[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: "100",
        completed_after: start_date,
        completed_before: end_date,
        sort_by: "completed_at",
      });

      const url = `${apiEndpoint}/v1/treatment_plan_items?${params}`;
      console.log(`[dentally-fetch] GET ${url}`);

      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "DentPulse/1.0",
          "Content-Type": "application/json",
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return new Response(
          JSON.stringify({ error: `Dentally API error (${resp.status}): ${errText}` }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const json = await resp.json();
      const items: Record<string, unknown>[] = Array.isArray(json)
        ? json
        : (json.treatment_plan_items ?? []);

      allItems.push(...items);
      console.log(`[dentally-fetch] Page ${page}: ${items.length} items`);

      hasMore = items.length === 100;
      page++;
    }

    const completedItems = allItems.filter(
      (it) => it.completed === true && parseFloat(String(it.price ?? "0")) > 0,
    );

    const totalRevenue = completedItems.reduce(
      (sum, it) => sum + parseFloat(String(it.price ?? "0")),
      0,
    );

    return new Response(
      JSON.stringify({
      totalFetched: allItems.length,
      completedWithPrice: completedItems.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
        items: allItems,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dentally-fetch] Error:", err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
