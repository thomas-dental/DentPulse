import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RefreshTokenRequest {
  integrationId: string;
  // When true, skip the "token still valid" fast paths and always refresh.
  // Used by the backend's 401-recovery path when Xero has already rejected the
  // current access token even though it hasn't reached its expiry timestamp.
  force?: boolean;
}

interface XeroTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token: string;
  scope: string;
}

// Reuse the same access token for the last 5 minutes of its life — covers
// in-flight retries and clock skew. Matches the buffer in the browser-side
// xeroService.isTokenExpired() check.
const TOKEN_VALID_BUFFER_MS = 5 * 60 * 1000;

// Stale-lock recovery: another instance is presumed dead if it has held the
// lock for longer than this. 60s is comfortably longer than a normal Xero
// token exchange (~1s) plus DB update (~50ms).
const LOCK_STALE_AFTER_MS = 60 * 1000;

// Waiting-on-another-refresher: poll the row until either (a) tokens become
// valid (the other refresher succeeded — we re-use what they wrote) or (b)
// the lock clears and we can attempt the refresh ourselves. Each tick is
// short; the overall ceiling keeps the function from holding a HTTP request
// open indefinitely.
const POLL_INTERVAL_MS = 400;
const POLL_TIMEOUT_MS = 12 * 1000;

// Save retries. If Xero returned new tokens but the DB UPDATE fails, we have
// a valid token that nothing knows about — and the *old* refresh_token is now
// revoked. Retry aggressively before bailing.
const SAVE_RETRY_ATTEMPTS = 4;
const SAVE_RETRY_BASE_MS = 200;

function isTokenStillValid(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  const expiresAt = new Date(tokenExpiresAt).getTime();
  return expiresAt - Date.now() > TOKEN_VALID_BUFFER_MS;
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
    const xeroClientId = Deno.env.get("XERO_CLIENT_ID");
    const xeroClientSecret = Deno.env.get("XERO_CLIENT_SECRET");

    if (!supabaseUrl || !supabaseServiceKey || !xeroClientId || !xeroClientSecret) {
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

    const { integrationId, force } = body;
    if (!integrationId) {
      return new Response(
        JSON.stringify({ error: "Missing integrationId parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[xero-refresh-token] Request for integration: ${integrationId}`);

    // ============================================================
    // 1. Fast path — token is already valid, no refresh needed.
    // ============================================================
    const { data: pre, error: preErr } = await supabase
      .from("platform_integrations")
      .select("access_token, refresh_token, token_expires_at, refresh_lock_at")
      .eq("id", integrationId)
      .eq("platform_name", "xero")
      .single();

    if (preErr || !pre) {
      console.error("Integration not found:", preErr);
      return new Response(
        JSON.stringify({ error: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!force && isTokenStillValid(pre.token_expires_at) && pre.access_token) {
      const minutes = Math.floor((new Date(pre.token_expires_at!).getTime() - Date.now()) / 60000);
      console.log(`[xero-refresh-token] Token still valid (${minutes} min left). Returning cached.`);
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
        JSON.stringify({ error: "No refresh token available. Please reconnect Xero." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // 2. Acquire the refresh lock. Atomic UPDATE — only ONE caller
    //    can win at a time. The WHERE clause allows the lock to be
    //    stolen if a previous holder died (>60s old).
    // ============================================================
    const lockAcquired = await tryAcquireLock(supabase, integrationId);

    if (!lockAcquired) {
      // Another instance is refreshing right now. Poll the row until
      // either their refresh lands (we reuse it) or their lock clears
      // (we try ourselves). This prevents a thundering herd from each
      // burning the rotating refresh_token.
      console.log(`[xero-refresh-token] Another refresh in flight, polling…`);
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
      // Fall through and retry acquisition. Don't loop forever — one retry.
      const secondTry = await tryAcquireLock(supabase, integrationId);
      if (!secondTry) {
        return new Response(
          JSON.stringify({ error: "Refresh in progress by another caller — please retry." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ============================================================
    // 3. We hold the lock. Re-read the row to use the LATEST
    //    refresh_token (in case it was rotated between the fast-path
    //    read and lock acquisition). Re-check the valid-token shortcut.
    // ============================================================
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

      if (!force && isTokenStillValid(locked.token_expires_at) && locked.access_token) {
        await releaseLock(supabase, integrationId);
        console.log(`[xero-refresh-token] Token became valid while waiting — returning cached.`);
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
          JSON.stringify({ error: "No refresh token available. Please reconnect Xero." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================================
      // 4. Call Xero with the freshest refresh_token we just read.
      // ============================================================
      console.log("[xero-refresh-token] Calling Xero identity endpoint…");
      const credentials = btoa(`${xeroClientId}:${xeroClientSecret}`);
      const tokenResponse = await fetch("https://identity.xero.com/connect/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: locked.refresh_token,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`[xero-refresh-token] Xero rejected refresh: ${tokenResponse.status} — ${errorText}`);
        // Release the lock so future attempts aren't stuck behind a dead one.
        // Do NOT wipe the refresh_token — it may still be valid if Xero is
        // having transient issues; reconnect is the user's call.
        await releaseLock(supabase, integrationId);
        return new Response(
          JSON.stringify({
            error: "Failed to refresh token. Please reconnect Xero.",
            details: errorText,
          }),
          { status: tokenResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenData: XeroTokenResponse = await tokenResponse.json();
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
      console.log(`[xero-refresh-token] Xero returned new tokens (expires ${expiresAt}).`);

      // ============================================================
      // 5. Persist the new tokens AND clear the lock in one statement.
      //    Retry on transient DB failure — stranding a valid token here
      //    means the OLD refresh_token is dead and the user is locked out.
      // ============================================================
      const saved = await saveTokensAndReleaseLock(
        supabase,
        integrationId,
        tokenData.access_token,
        tokenData.refresh_token,
        expiresAt
      );

      if (!saved.ok) {
        console.error(
          `[xero-refresh-token] CRITICAL: Xero returned new tokens but DB save failed ` +
          `after ${SAVE_RETRY_ATTEMPTS} attempts for integration ${integrationId}. ` +
          `Old refresh_token is now revoked. Error: ${saved.error}`
        );
        // Best-effort clear so we don't pile up on top of an already-broken row.
        await releaseLock(supabase, integrationId);
        return new Response(
          JSON.stringify({
            error: "Token refreshed at Xero but failed to save. Please reconnect Xero.",
            details: saved.error,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[xero-refresh-token] Saved successfully for integration ${integrationId}`);
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
      // Anything thrown after we acquired the lock — make sure we clear it.
      console.error("[xero-refresh-token] Unhandled error during refresh:", innerError);
      await releaseLock(supabase, integrationId);
      throw innerError;
    }
  } catch (error) {
    console.error("[xero-refresh-token] Unexpected error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================
// Lock helpers
// ============================================================

/**
 * Atomic lock acquisition via UPDATE returning. PostgreSQL guarantees only
 * one concurrent UPDATE on a row sees the prior NULL/stale value, so exactly
 * one caller wins. Stale-lock recovery is built into the WHERE clause: if
 * the previous holder crashed and left refresh_lock_at set, after 60s anyone
 * may steal the lock.
 */
async function tryAcquireLock(supabase: any, integrationId: string): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - LOCK_STALE_AFTER_MS).toISOString();
  const nowIso = new Date().toISOString();

  // NB: do NOT use a single .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${staleCutoff}`)
  // filter. PostgREST mis-parses the timestamp value inside .or() and returns
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
  if (error) console.error("[xero-refresh-token] Lock acquire (free) error:", error);
  if (data && data.length > 0) return true;

  // 2. Otherwise steal a stale lock (previous holder presumed dead).
  ({ data, error } = await supabase
    .from("platform_integrations")
    .update({ refresh_lock_at: nowIso })
    .eq("id", integrationId)
    .lt("refresh_lock_at", staleCutoff)
    .select("id"));
  if (error) console.error("[xero-refresh-token] Lock acquire (stale) error:", error);
  return !!(data && data.length > 0);
}

async function releaseLock(supabase: any, integrationId: string): Promise<void> {
  const { error } = await supabase
    .from("platform_integrations")
    .update({ refresh_lock_at: null })
    .eq("id", integrationId);
  if (error) {
    console.error("[xero-refresh-token] Lock release error:", error);
  }
}

/**
 * Poll the row while another caller refreshes. Returns either:
 *  - { success: true, access_token, expires_at } — their refresh landed; reuse it
 *  - { success: false } — their lock cleared without producing a fresh token (try ourselves)
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
      // Lock cleared but token still expired — the other caller failed.
      // Let the outer flow try to acquire and refresh.
      return { success: false };
    }
  }
  return { success: false, error: "Timed out waiting for concurrent refresh" };
}

/**
 * Save the new tokens AND clear the lock in a single UPDATE. Retries with
 * backoff because losing this write strands a valid access_token (the old
 * refresh_token is already dead at Xero — the user has no way back without
 * full reconnect).
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
    console.warn(
      `[xero-refresh-token] Save attempt ${attempt}/${SAVE_RETRY_ATTEMPTS} failed: ${lastErr}`
    );
    if (attempt < SAVE_RETRY_ATTEMPTS) {
      await sleep(SAVE_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  return { ok: false, error: lastErr };
}
