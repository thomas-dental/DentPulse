import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Refresh a QuickBooks (Intuit) access token. Mirrors xero-refresh-token,
// including the platform_integrations.refresh_lock_at MUTEX.
//
// Why the mutex: Intuit ROTATES the refresh token on every refresh (exactly
// like Xero). If two callers refresh concurrently, the first rotates the
// refresh_token and the second's now-stale token is rejected (invalid_grant)
// → the connection dies and the user must reconnect ("daily reconnect" bug).
// The lock guarantees exactly ONE refresh at a time; everyone else waits and
// re-uses the freshly-written token. The Node sync backend and
// quickbooks-create-invoice use the SAME column, so all refreshers across
// processes coordinate through one DB row lock.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RefreshTokenRequest {
  integrationId: string;
}

interface QuickBooksTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// Reuse the access token while it has more than this left — covers in-flight
// retries and clock skew.
const TOKEN_VALID_BUFFER_MS = 5 * 60 * 1000;
// A lock older than this is presumed abandoned (holder crashed) and may be stolen.
const LOCK_STALE_AFTER_MS = 60 * 1000;
// Poll cadence/ceiling while another caller refreshes.
const POLL_INTERVAL_MS = 400;
const POLL_TIMEOUT_MS = 12 * 1000;
// Save retries — losing this write strands a valid access_token while the old
// refresh_token is already revoked at Intuit.
const SAVE_RETRY_ATTEMPTS = 4;
const SAVE_RETRY_BASE_MS = 200;

function isTokenStillValid(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  return new Date(tokenExpiresAt).getTime() - Date.now() > TOKEN_VALID_BUFFER_MS;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
    const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");

    if (!supabaseUrl || !supabaseServiceKey || !clientId || !clientSecret) {
      console.error("Missing required environment variables");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: RefreshTokenRequest;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { integrationId } = body;
    if (!integrationId) {
      return new Response(
        JSON.stringify({ error: "Missing integrationId parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log(`[quickbooks-refresh-token] Request for integration: ${integrationId}`);

    // ── 1. Fast path — token already valid, no refresh needed. ──
    const { data: pre, error: preErr } = await supabase
      .from("platform_integrations")
      .select("access_token, refresh_token, token_expires_at, refresh_lock_at")
      .eq("id", integrationId)
      .eq("platform_name", "quickbooks")
      .single();

    if (preErr || !pre) {
      console.error("Integration not found:", preErr);
      return new Response(
        JSON.stringify({ error: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (isTokenStillValid(pre.token_expires_at) && pre.access_token) {
      const minutes = Math.floor((new Date(pre.token_expires_at!).getTime() - Date.now()) / 60000);
      console.log(`[quickbooks-refresh-token] Token still valid (${minutes} min left). Returning cached.`);
      return new Response(
        JSON.stringify({
          success: true,
          message: "Token is still valid",
          access_token: pre.access_token,
          expires_at: pre.token_expires_at,
          minutes_until_expiry: minutes,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!pre.refresh_token) {
      return new Response(
        JSON.stringify({ error: "No refresh token available. Please reconnect QuickBooks." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Acquire the refresh lock (atomic; stale locks stealable). ──
    const lockAcquired = await tryAcquireLock(supabase, integrationId);

    if (!lockAcquired) {
      console.log(`[quickbooks-refresh-token] Another refresh in flight, polling…`);
      const polled = await waitForOtherRefresh(supabase, integrationId);
      if (polled.success && polled.access_token) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Token refreshed by concurrent caller",
            access_token: polled.access_token,
            expires_at: polled.expires_at,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (polled.error) {
        return new Response(
          JSON.stringify({ error: polled.error }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const secondTry = await tryAcquireLock(supabase, integrationId);
      if (!secondTry) {
        return new Response(
          JSON.stringify({ error: "Refresh in progress by another caller — please retry." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── 3. We hold the lock. Re-read for the LATEST refresh_token. ──
    try {
      const { data: locked, error: lockedErr } = await supabase
        .from("platform_integrations")
        .select("access_token, refresh_token, token_expires_at")
        .eq("id", integrationId)
        .single();

      if (lockedErr || !locked) {
        await releaseLock(supabase, integrationId);
        return new Response(
          JSON.stringify({ error: "Integration vanished during refresh" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (isTokenStillValid(locked.token_expires_at) && locked.access_token) {
        await releaseLock(supabase, integrationId);
        console.log(`[quickbooks-refresh-token] Token became valid while waiting — returning cached.`);
        return new Response(
          JSON.stringify({
            success: true,
            message: "Token already refreshed",
            access_token: locked.access_token,
            expires_at: locked.token_expires_at,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!locked.refresh_token) {
        await releaseLock(supabase, integrationId);
        return new Response(
          JSON.stringify({ error: "No refresh token available. Please reconnect QuickBooks." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ── 4. Call Intuit with the freshest refresh_token. ──
      console.log("[quickbooks-refresh-token] Calling Intuit token endpoint…");
      const credentials = btoa(`${clientId}:${clientSecret}`);
      const tokenResponse = await fetch(INTUIT_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "Authorization": `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: locked.refresh_token,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`[quickbooks-refresh-token] Intuit rejected refresh: ${tokenResponse.status} — ${errorText}`);
        // Release the lock so future attempts aren't stuck. Do NOT wipe the
        // refresh_token — it may still be valid if Intuit had a transient issue.
        await releaseLock(supabase, integrationId);
        return new Response(
          JSON.stringify({
            error: "Failed to refresh token. Please reconnect QuickBooks.",
            details: errorText,
          }),
          { status: tokenResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenData: QuickBooksTokenResponse = await tokenResponse.json();
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
      console.log(`[quickbooks-refresh-token] Intuit returned new tokens (expires ${expiresAt}).`);

      // ── 5. Persist new tokens AND clear the lock in one statement. ──
      const saved = await saveTokensAndReleaseLock(
        supabase,
        integrationId,
        tokenData.access_token,
        // Intuit rotates the refresh token on every refresh — persist the new one.
        tokenData.refresh_token,
        expiresAt
      );

      if (!saved.ok) {
        console.error(
          `[quickbooks-refresh-token] CRITICAL: Intuit returned new tokens but DB save failed ` +
          `after ${SAVE_RETRY_ATTEMPTS} attempts for integration ${integrationId}. ` +
          `Old refresh_token is now revoked. Error: ${saved.error}`
        );
        await releaseLock(supabase, integrationId);
        return new Response(
          JSON.stringify({
            error: "Token refreshed at QuickBooks but failed to save. Please reconnect QuickBooks.",
            details: saved.error,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[quickbooks-refresh-token] Saved successfully for integration ${integrationId}`);
      return new Response(
        JSON.stringify({
          success: true,
          message: "Token refreshed successfully",
          access_token: tokenData.access_token,
          expires_at: expiresAt,
          expires_in_seconds: tokenData.expires_in,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (innerError) {
      console.error("[quickbooks-refresh-token] Unhandled error during refresh:", innerError);
      await releaseLock(supabase, integrationId);
      throw innerError;
    }
  } catch (error) {
    console.error("[quickbooks-refresh-token] Unexpected error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Lock helpers (identical mechanism to xero-refresh-token) ──

/**
 * Atomic lock acquisition via UPDATE…RETURNING. PostgreSQL serialises the row
 * UPDATE, so exactly one caller sees the prior NULL/stale value and wins. A
 * lock older than LOCK_STALE_AFTER_MS may be stolen (previous holder crashed).
 */
async function tryAcquireLock(supabase: any, integrationId: string): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - LOCK_STALE_AFTER_MS).toISOString();
  const nowIso = new Date().toISOString();

  // NB: NOT a single .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${staleCutoff}`).
  // PostgREST mis-parses the timestamp value inside .or() and returns
  // "column refresh_lock_at does not exist", so this query ALWAYS errored and
  // returned false — the lock was never acquired and every caller fell through
  // to "Refresh in progress by another caller" even when the lock was free.
  // Two standalone conditional UPDATEs express the same "free OR stale" gate.

  // 1. Acquire if currently free.
  let { data, error } = await supabase
    .from("platform_integrations")
    .update({ refresh_lock_at: nowIso })
    .eq("id", integrationId)
    .is("refresh_lock_at", null)
    .select("id");
  if (error) console.error("[quickbooks-refresh-token] Lock acquire (free) error:", error);
  if (data && data.length > 0) return true;

  // 2. Otherwise steal a stale lock (previous holder presumed dead).
  ({ data, error } = await supabase
    .from("platform_integrations")
    .update({ refresh_lock_at: nowIso })
    .eq("id", integrationId)
    .lt("refresh_lock_at", staleCutoff)
    .select("id"));
  if (error) console.error("[quickbooks-refresh-token] Lock acquire (stale) error:", error);
  return !!(data && data.length > 0);
}

async function releaseLock(supabase: any, integrationId: string): Promise<void> {
  const { error } = await supabase
    .from("platform_integrations")
    .update({ refresh_lock_at: null })
    .eq("id", integrationId);
  if (error) {
    console.error("[quickbooks-refresh-token] Lock release error:", error);
  }
}

/**
 * Poll while another caller refreshes. Returns:
 *  - { success: true, access_token, expires_at } — their refresh landed; reuse it
 *  - { success: false } — their lock cleared without a fresh token (try ourselves)
 *  - { success: false, error } — timed out
 */
async function waitForOtherRefresh(
  supabase: any,
  integrationId: string
): Promise<{ success: boolean; access_token?: string; expires_at?: string; error?: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const { data: row } = await supabase
      .from("platform_integrations")
      .select("access_token, token_expires_at, refresh_lock_at")
      .eq("id", integrationId)
      .single();
    if (!row) continue;
    if (isTokenStillValid(row.token_expires_at) && row.access_token) {
      return { success: true, access_token: row.access_token, expires_at: row.token_expires_at };
    }
    if (!row.refresh_lock_at) {
      return { success: false };
    }
  }
  return { success: false, error: "Timed out waiting for concurrent refresh" };
}

/**
 * Save new tokens AND clear the lock in one UPDATE, with backoff retries —
 * losing this write strands a valid access_token (the old refresh_token is
 * already dead at Intuit, so the user would be locked out).
 */
async function saveTokensAndReleaseLock(
  supabase: any,
  integrationId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  let lastErr = "unknown";
  for (let attempt = 1; attempt <= SAVE_RETRY_ATTEMPTS; attempt++) {
    const { error } = await supabase
      .from("platform_integrations")
      .update({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: expiresAt,
        refresh_lock_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    if (!error) return { ok: true };
    lastErr = error.message || String(error);
    console.warn(`[quickbooks-refresh-token] Save attempt ${attempt}/${SAVE_RETRY_ATTEMPTS} failed: ${lastErr}`);
    if (attempt < SAVE_RETRY_ATTEMPTS) {
      await sleep(SAVE_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  return { ok: false, error: lastErr };
}
