/**
 * QuickBooks Online (QBO) API client for the sync backend.
 *
 * Credential model — APP-LEVEL (env), like Xero:
 *   process.env.QUICKBOOKS_CLIENT_ID     = Intuit app Client ID
 *   process.env.QUICKBOOKS_CLIENT_SECRET = Intuit app Client Secret
 *   platform_integrations.access_token  = QBO access token  (~1h)
 *   platform_integrations.refresh_token = QBO refresh token  (~100d, ROTATES)
 *   platform_integrations.token_expires_at = access-token expiry
 * The QBO company id (realmId) lives on
 *   platform_integration_organizations.platform_org_id
 * and is mandatory on every API call.
 *
 * Intuit rotates the refresh token on every refresh — the new one MUST be
 * persisted or the connection dies.
 *
 * QBO rate limits: 500 req/min per realmId (throttle = HTTP 429 with
 * Retry-After). We mirror the Xero client's retry/backoff shape.
 *
 * Env:
 *   QUICKBOOKS_API_BASE — defaults to prod; set
 *     https://sandbox-quickbooks.api.intuit.com for sandbox apps.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { sleep } = require('../../utils/helpers');

const QBO_TOKEN_URL  = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_MINORVERSION = '70';
const PAGE_SIZE        = 1000; // QBO query MAXRESULTS hard cap
const MAX_RETRIES      = 6;
const RATE_LIMIT_WAIT_MS = 15000;

function getApiBase() {
  return (process.env.QUICKBOOKS_API_BASE || 'https://quickbooks.api.intuit.com').replace(/\/+$/, '');
}

// Global rate-limit cooldown shared across workers.
let rateLimitCooldownUntil = 0;
let lastRateLimitLogTime   = 0;

/**
 * Refresh the QBO access token using the stored refresh_token.
 * Intuit ROTATES the refresh token — we persist whatever it returns.
 * Basic-auth uses the app-level env client_id/client_secret (mirrors Xero).
 */
async function refreshAccessToken(integration) {
  const { id, refresh_token: refreshToken } = integration;
  const clientId     = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing QUICKBOOKS_CLIENT_ID/QUICKBOOKS_CLIENT_SECRET env vars. QuickBooks integration is not configured.');
  }
  if (!refreshToken) {
    throw new Error('No QuickBooks refresh_token found. Please reconnect QuickBooks.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QuickBooks token refresh failed (${response.status}): ${text.substring(0, 300)}`);
  }

  const tokenData  = await response.json();
  const expiresAt  = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
  const newRefresh = tokenData.refresh_token || refreshToken; // Intuit rotates — persist the new one

  await supabaseAdmin
    .from('platform_integrations')
    .update({
      access_token:     tokenData.access_token,
      refresh_token:    newRefresh,
      token_expires_at: expiresAt,
      updated_at:       new Date().toISOString(),
    })
    .eq('id', id);

  console.log('[QuickBooksClient] Token refreshed, expires:', expiresAt);
  return { accessToken: tokenData.access_token, refreshToken: newRefresh, expiresAt };
}

/**
 * Atomically acquire the refresh lock. Returns true if the lock was free or a
 * stale lock (>staleBefore) was stolen.
 *
 * Deliberately NOT a single .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${staleBefore}`):
 * PostgREST mis-parses a timestamp value inside .or() ("column does not exist"),
 * and that error — when ignored — makes acquisition SILENTLY always fail (the
 * lock is never won, refresh never happens). Two standalone conditional UPDATEs
 * express the same "free OR stale" gate without tripping the .or parser.
 */
async function acquireRefreshLock(id, staleBefore) {
  const nowIso = new Date().toISOString();

  // 1. Acquire if currently free.
  let res = await supabaseAdmin
    .from('platform_integrations')
    .update({ refresh_lock_at: nowIso })
    .eq('id', id)
    .is('refresh_lock_at', null)
    .select('id');
  if (res.error) console.error('[QuickBooksClient] lock acquire (free) error:', res.error.message);
  if (Array.isArray(res.data) && res.data.length > 0) return true;

  // 2. Otherwise steal a stale lock (previous holder presumed dead).
  res = await supabaseAdmin
    .from('platform_integrations')
    .update({ refresh_lock_at: nowIso })
    .eq('id', id)
    .lt('refresh_lock_at', staleBefore)
    .select('id');
  if (res.error) console.error('[QuickBooksClient] lock acquire (stale) error:', res.error.message);
  return Array.isArray(res.data) && res.data.length > 0;
}

/**
 * Get a valid access token for the integration row.
 * Refreshes if expired or expiring within 2 minutes (QBO tokens are short).
 *
 * Uses the same platform_integrations.refresh_lock_at mutex as the
 * quickbooks-refresh-token edge function, so the backend and the edge function
 * can never race to consume the same rotating refresh_token simultaneously
 * (Intuit rotates the refresh token on every refresh → a race causes
 * invalid_grant → daily disconnect). Mirrors the Xero client.
 */
async function getOrRefreshToken(integration) {
  const { id, access_token, refresh_token, token_expires_at } = integration;

  if (!access_token) throw new Error('No QuickBooks access_token found. Please reconnect QuickBooks.');
  if (!refresh_token) throw new Error('No QuickBooks refresh_token found. Please reconnect QuickBooks.');

  if (token_expires_at) {
    const msLeft = new Date(token_expires_at).getTime() - Date.now();
    if (msLeft > 120_000) return access_token;
  }

  console.log('[QuickBooksClient] Token expired or expiring soon — acquiring refresh lock...');

  // Atomic lock acquisition. The edge function uses the same column, so only
  // ONE caller (backend or edge function) refreshes at a time. A lock older
  // than 60s is treated as abandoned and can be stolen.
  const staleBefore = new Date(Date.now() - 60_000).toISOString();
  const didAcquire = await acquireRefreshLock(id, staleBefore);

  if (!didAcquire) {
    // Another caller is refreshing right now — wait, then re-fetch the token.
    console.log('[QuickBooksClient] Refresh lock held by another caller — waiting 3s then re-fetching...');
    await sleep(3_000);

    const { data: freshRow } = await supabaseAdmin
      .from('platform_integrations')
      .select('access_token, refresh_token, token_expires_at')
      .eq('id', id)
      .single();

    if (freshRow?.access_token) {
      console.log('[QuickBooksClient] Using token refreshed by concurrent caller.');
      integration.access_token     = freshRow.access_token;
      integration.refresh_token    = freshRow.refresh_token;
      integration.token_expires_at = freshRow.token_expires_at;
      return freshRow.access_token;
    }
    throw new Error('QuickBooks token refresh lock timeout — no valid token available after wait');
  }

  // We hold the lock — re-read the latest refresh_token, refresh, release.
  try {
    const { data: locked } = await supabaseAdmin
      .from('platform_integrations')
      .select('id, refresh_token, access_token, token_expires_at')
      .eq('id', id)
      .single();

    // Another caller may have refreshed between our fast-path read and lock.
    if (locked?.token_expires_at) {
      const msLeft = new Date(locked.token_expires_at).getTime() - Date.now();
      if (msLeft > 120_000 && locked.access_token) {
        integration.access_token     = locked.access_token;
        integration.refresh_token    = locked.refresh_token;
        integration.token_expires_at = locked.token_expires_at;
        return locked.access_token;
      }
    }

    const refreshed = await refreshAccessToken({ ...integration, refresh_token: locked?.refresh_token || refresh_token });
    // Keep the in-memory integration object current so subsequent calls in this
    // job reuse the fresh token instead of refreshing on every entity.
    integration.access_token     = refreshed.accessToken;
    integration.refresh_token    = refreshed.refreshToken;
    integration.token_expires_at = refreshed.expiresAt;
    return refreshed.accessToken;
  } finally {
    await supabaseAdmin
      .from('platform_integrations')
      .update({ refresh_lock_at: null })
      .eq('id', id);
  }
}

/**
 * GET a QBO URL with retry + rate-limit (429) handling.
 */
async function qboFetch(url, accessToken) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const now = Date.now();
    if (rateLimitCooldownUntil > now) {
      const waitMs = rateLimitCooldownUntil - now;
      if (now - lastRateLimitLogTime > 5000) {
        console.log(`[QuickBooksClient] Cooldown active. Waiting ${Math.round(waitMs / 1000)}s...`);
        lastRateLimitLogTime = now;
      }
      await sleep(Math.min(waitMs, 120000));
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept':        'application/json',
        },
      });

      if (response.ok) return response;

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') || response.headers.get('Retry-After');
        const retryDelay = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000 + 1000, 120000)
          : Math.min(RATE_LIMIT_WAIT_MS * Math.pow(2, Math.min(attempt, 3)), 120000);

        rateLimitCooldownUntil = Date.now() + retryDelay;
        const t = Date.now();
        if (t - lastRateLimitLogTime > 5000) {
          console.log(`[QuickBooksClient] Rate limit (429). Waiting ${Math.round(retryDelay / 1000)}s (retry ${attempt + 1}/${MAX_RETRIES})...`);
          lastRateLimitLogTime = t;
        }
        lastError = new Error('HTTP 429: Rate limit exceeded');

        if (attempt < MAX_RETRIES - 1) { await sleep(retryDelay); continue; }
        const err = new Error('RATE_LIMIT_EXHAUSTED');
        err.isRateLimit = true;
        throw err;
      }

      // Auth errors — surface immediately so the queue can flag a dead token.
      if (response.status === 401 || response.status === 403) return response;

      const text = await response.text();
      lastError = new Error(`QuickBooks API ${response.status} [${url}]: ${text.substring(0, 300)}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.isRateLimit || lastError.message === 'RATE_LIMIT_EXHAUSTED') throw lastError;
    }

    if (attempt < MAX_RETRIES - 1) await sleep(2000 * (attempt + 1));
  }

  throw lastError || new Error(`QuickBooks API request failed after ${MAX_RETRIES} retries`);
}

/**
 * Run a QBO SQL-ish query for one entity, fully paginated.
 * QBO query pagination = `STARTPOSITION n MAXRESULTS 1000` appended to the
 * query string; `n` is 1-based. We loop until a page returns < PAGE_SIZE.
 *
 * @param {string} accessToken
 * @param {string} realmId
 * @param {string} entity     — QBO entity name, e.g. 'Account', 'Invoice'
 * @param {string|null} whereClause — e.g. "TxnDate >= '2025-01-01' AND TxnDate <= '2025-12-31'"
 * @returns {Promise<Array>} all rows for the entity
 */
async function queryAll(accessToken, realmId, entity, whereClause = null) {
  const base = getApiBase();
  const all  = [];
  let startPosition = 1;
  let safety = 0;
  const MAX_ITER = 1000;

  while (safety++ < MAX_ITER) {
    const where = whereClause ? ` WHERE ${whereClause}` : '';
    const query = `SELECT * FROM ${entity}${where} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`;
    const url   = `${base}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=${QBO_MINORVERSION}`;

    const response = await qboFetch(url, accessToken);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QuickBooks query ${entity} ${response.status}: ${text.substring(0, 300)}`);
    }

    const data = await response.json();
    const qr   = data?.QueryResponse || {};
    const rows = Array.isArray(qr[entity]) ? qr[entity] : [];

    all.push(...rows);

    if (rows.length < PAGE_SIZE) break;
    startPosition += PAGE_SIZE;
    await sleep(200); // gentle pacing under the per-realm limit
  }

  return all;
}

/**
 * Fetch the QBO ProfitAndLoss report for a date window.
 * Returns the raw report JSON (Header + Columns + Rows tree).
 *
 * @param {string} accessToken
 * @param {string} realmId
 * @param {string} startDate  — YYYY-MM-DD
 * @param {string} endDate    — YYYY-MM-DD
 * @param {string} [summarizeColumnBy] — 'Month' (default) for per-month columns
 * @param {string} [accountingMethod]  — 'Accrual' (default) | 'Cash'
 */
async function getProfitAndLossReport(accessToken, realmId, startDate, endDate, summarizeColumnBy = 'Month', accountingMethod = 'Accrual') {
  const base = getApiBase();
  const params = new URLSearchParams({
    start_date:         String(startDate).slice(0, 10),
    end_date:           String(endDate).slice(0, 10),
    summarize_column_by: summarizeColumnBy,
    accounting_method:  accountingMethod,
    minorversion:       QBO_MINORVERSION,
  });
  const url = `${base}/v3/company/${realmId}/reports/ProfitAndLoss?${params.toString()}`;

  const response = await qboFetch(url, accessToken);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QuickBooks ProfitAndLoss ${response.status}: ${text.substring(0, 300)}`);
  }
  return response.json();
}

module.exports = {
  getOrRefreshToken,
  refreshAccessToken,
  queryAll,
  getProfitAndLossReport,
  PAGE_SIZE,
  getApiBase,
};
