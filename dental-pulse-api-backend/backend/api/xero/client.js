/**
 * Xero API client for the sync backend.
 * Handles token refresh, raw API calls, and rate limiting.
 *
 * Xero rate limits:
 *   - 60 calls/minute per app (returns X-Rate-Limit-Remaining, X-Rate-Limit-Reset)
 *   - 429 with Retry-After header when exceeded
 *
 * Requires env vars:
 *   XERO_CLIENT_ID
 *   XERO_CLIENT_SECRET
 */

const { supabaseAdmin } = require('../../config/supabase');
const { sleep } = require('../../utils/helpers');

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_BASE  = 'https://api.xero.com/api.xro/2.0';

const MAX_RETRIES         = 6;
const RATE_LIMIT_WAIT_MS  = 15000; // 15s default wait on rate limit
const PAGE_SIZE           = 100;   // Xero invoice page size

// Global rate limit state (shared across all concurrent workers)
let rateLimitCooldownUntil  = 0;
let rateLimitRemaining       = Infinity;
let lastRateLimitLogTime     = 0;

/**
 * Read Xero rate limit headers from a response.
 */
function readRateLimitHeaders(response) {
  const remaining = response.headers.get('x-rate-limit-remaining')
    || response.headers.get('X-Rate-Limit-Remaining');
  const reset = response.headers.get('x-rate-limit-reset')
    || response.headers.get('X-Rate-Limit-Reset');

  if (remaining !== null && remaining !== undefined) {
    rateLimitRemaining = parseInt(remaining, 10);
  }

  if (reset !== null && reset !== undefined) {
    const resetVal = parseInt(reset, 10);
    if (resetVal > 1_700_000_000) {
      // Unix timestamp in seconds
      rateLimitCooldownUntil = Math.max(rateLimitCooldownUntil, resetVal * 1000);
    } else {
      // Seconds until reset
      rateLimitCooldownUntil = Math.max(rateLimitCooldownUntil, Date.now() + resetVal * 1000);
    }
  }
}

/**
 * Proactively wait if rate limit is critically low.
 */
async function waitIfRateLimitLow() {
  if (rateLimitRemaining <= 3 && rateLimitCooldownUntil > Date.now()) {
    const waitMs = rateLimitCooldownUntil - Date.now() + 1000;
    const now = Date.now();
    if (now - lastRateLimitLogTime > 5000) {
      console.log(`[XeroClient] Rate limit low (${rateLimitRemaining} remaining). Pausing ${Math.round(waitMs / 1000)}s...`);
      lastRateLimitLogTime = now;
    }
    await sleep(Math.min(waitMs, 120000));
  } else if (rateLimitRemaining <= 10) {
    await sleep(300);
  }
}

/**
 * Keep the in-memory integration row in sync with freshly-refreshed tokens.
 * Long multi-page jobs hold ONE integration object across many requests, so
 * mutating it in place means their next request picks up the new token instead
 * of re-using the stale one captured at job start.
 */
function applyTokens(integration, row) {
  if (!integration || !row) return;
  if (row.access_token)     integration.access_token     = row.access_token;
  if (row.refresh_token)    integration.refresh_token    = row.refresh_token;
  if (row.token_expires_at) integration.token_expires_at = row.token_expires_at;
}

/**
 * Atomically acquire the refresh lock for an integration. Returns true if this
 * caller won the lock (it was free, or a stale lock older than `staleBefore`
 * was stolen).
 *
 * IMPORTANT: this deliberately does NOT use a single
 *   .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${staleBefore}`)
 * filter. PostgREST mis-parses a timestamp value inside .or() and returns
 * "column refresh_lock_at does not exist"; supabase-js surfaces that as an
 * error which, if ignored (as the old code did), makes acquisition SILENTLY
 * always fail — the lock is never won and every refresh degrades to polling /
 * timeout. Two standalone filters (each a valid, atomic conditional UPDATE)
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
  if (res.error) console.error('[XeroClient] lock acquire (free) error:', res.error.message);
  if (Array.isArray(res.data) && res.data.length > 0) return true;

  // 2. Otherwise steal a stale lock (previous holder presumed dead).
  res = await supabaseAdmin
    .from('platform_integrations')
    .update({ refresh_lock_at: nowIso })
    .eq('id', id)
    .lt('refresh_lock_at', staleBefore)
    .select('id');
  if (res.error) console.error('[XeroClient] lock acquire (stale) error:', res.error.message);
  return Array.isArray(res.data) && res.data.length > 0;
}

/**
 * Refresh Xero access token using the stored refresh_token.
 * Updates the new tokens in platform_integrations.
 */
async function refreshAccessToken(integrationId, refreshToken) {
  const clientId     = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('XERO_CLIENT_ID and XERO_CLIENT_SECRET must be set in environment variables');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Xero token refresh failed (${response.status}): ${text.substring(0, 300)}`);
  }

  const tokenData = await response.json();
  const expiresAt  = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  const newRefresh = tokenData.refresh_token || refreshToken;

  // Persist refreshed tokens
  await supabaseAdmin
    .from('platform_integrations')
    .update({
      access_token:     tokenData.access_token,
      refresh_token:    newRefresh,
      token_expires_at: expiresAt,
      updated_at:       new Date().toISOString(),
    })
    .eq('id', integrationId);

  console.log('[XeroClient] Token refreshed, expires:', expiresAt);
  return { accessToken: tokenData.access_token, refreshToken: newRefresh, expiresAt };
}

/**
 * Get a valid access token for the given integration row.
 * Refreshes automatically if expired or expiring within 60 seconds.
 *
 * Uses the same refresh_lock_at mutex as the xero-refresh-token edge function
 * so the backend and the edge function can never race to consume the same
 * rotating refresh_token simultaneously (which causes invalid_grant → daily
 * disconnect).
 */
async function getOrRefreshToken(integration, { force = false } = {}) {
  const { id, access_token, refresh_token, token_expires_at } = integration;

  if (!access_token) {
    throw new Error('No Xero access_token found. Please reconnect Xero.');
  }
  if (!refresh_token) {
    throw new Error('No Xero refresh_token found. Please reconnect Xero.');
  }

  // Reuse the existing token while it still has comfortable headroom. 120 s
  // (was 60 s) so a single rate-limit cooldown landing mid-request can't push
  // the token past expiry before it is used. `force` skips reuse and refreshes
  // unconditionally — used by the 401 recovery path when Xero has already
  // rejected the current token.
  if (!force && token_expires_at) {
    const msLeft = new Date(token_expires_at).getTime() - Date.now();
    if (msLeft > 120_000) {
      return access_token;
    }
  }

  // Delegate the actual refresh to the `xero-refresh-token` Supabase edge
  // function — the SINGLE authorised Xero refresher.
  //
  // Why: Xero binds a refresh_token to the client_id (Xero app) that issued it.
  // Refreshing here used to call Xero directly with the BACKEND's own
  // XERO_CLIENT_ID. When that differs from the app the OAuth callback minted the
  // token with (the edge function's XERO_CLIENT_ID), Xero rejects every refresh
  // with "invalid_grant: Refresh token was issued to a different client" — the
  // integration got marked disconnected and the user had to reconnect daily.
  // Routing through the edge function guarantees mint and refresh use the SAME
  // app, and the edge function already owns the refresh_lock_at mutex so there
  // is still no rotating-token race.
  console.log(`[XeroClient] Token ${force ? 'force-refresh requested' : 'expired or expiring soon'} — delegating to xero-refresh-token edge function...`);
  const refreshed = await refreshViaEdgeFunction(id, force);
  applyTokens(integration, {
    access_token:     refreshed.accessToken,
    token_expires_at: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

/**
 * Refresh the Xero token by invoking the `xero-refresh-token` Supabase edge
 * function. The edge function refreshes with the deployed XERO_CLIENT_ID/SECRET
 * (the same app the OAuth callback used), persists the rotated tokens, and
 * serialises concurrent callers via the refresh_lock_at mutex.
 *
 * Error messages intentionally include both the HTTP status and the upstream
 * body so the queue's dead-token detector (matches /invalid_grant/i and
 * /Xero token refresh failed \(400\)/i) still classifies a revoked refresh
 * token as "reconnect required" rather than retrying forever.
 *
 * @param {string} integrationId
 * @param {boolean} force — skip the edge function's still-valid fast path
 * @returns {Promise<{ accessToken: string, expiresAt: string }>}
 */
async function refreshViaEdgeFunction(integrationId, force = false) {
  const baseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to refresh Xero tokens via the edge function');
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/functions/v1/xero-refresh-token`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey':        serviceKey,
      },
      body: JSON.stringify({ integrationId, force }),
    });
  } catch (netErr) {
    throw new Error(`Xero token refresh: could not reach xero-refresh-token edge function: ${netErr.message}`);
  }

  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* non-JSON body — keep raw text */ }

  if (!response.ok || data.success === false || !data.access_token) {
    const detail = [data.error, data.details].filter(Boolean).join(' — ') || text || 'no response body';
    // Format keeps "failed (<status>)" adjacent so the dead-token regex matches.
    throw new Error(`Xero token refresh failed (${response.status}) via edge function: ${detail}`);
  }

  return { accessToken: data.access_token, expiresAt: data.expires_at };
}

/**
 * Fetch a Xero API URL with retry, rate limit, and token-expiry handling.
 *
 * Takes the integration row (not a raw token) so it can derive a valid access
 * token once per request and, if Xero rejects it with a 401/403, force a single
 * refresh and retry. A long, rate-limited job can easily outlive the ~30 min
 * access token captured at job start; this makes every request self-healing
 * instead of failing the whole job.
 *
 * The token is derived ONCE before the retry loop (not per attempt): deriving
 * per attempt meant that when a refresh was failing, every page of every
 * concurrent job hammered the refresh lock — a thundering herd that monopolised
 * the lock and produced cascading "lock timeout" errors. Per request + 401
 * recovery gives the same resilience with a fraction of the lock pressure.
 *
 * @param {string} url
 * @param {object} integration — platform_integrations row (id, access_token, refresh_token, token_expires_at)
 * @param {string} tenantId
 * @param {object} [extraHeaders] — optional additional request headers (e.g. If-Modified-Since)
 * @returns {Response}
 */
async function fetchWithRetry(url, integration, tenantId, extraHeaders = null) {
  let lastError;
  let authRetried = false;

  // Derive a valid token once for this request. getOrRefreshToken reuses the
  // cached token until it nears expiry (cheap, no lock), and only contends for
  // the refresh lock when an actual refresh is due. A token that expires later
  // during a long cooldown is caught by the 401 recovery path below.
  let accessToken = await getOrRefreshToken(integration);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Wait for global cooldown if active
    const now = Date.now();
    if (rateLimitCooldownUntil > now) {
      const waitMs = rateLimitCooldownUntil - now;
      if (now - lastRateLimitLogTime > 5000) {
        console.log(`[XeroClient] Global cooldown active. Waiting ${Math.round(waitMs / 1000)}s...`);
        lastRateLimitLogTime = now;
      }
      await sleep(Math.min(waitMs, 120000));
    }

    // Proactively throttle if limit is low
    await waitIfRateLimitLow();

    try {
      const headers = {
        'Authorization':  `Bearer ${accessToken}`,
        'Xero-tenant-id': tenantId,
        'Accept':         'application/json',
      };
      if (extraHeaders && typeof extraHeaders === 'object') {
        Object.assign(headers, extraHeaders);
      }
      const response = await fetch(url, {
        method:  'GET',
        headers,
      });

      // Track rate limit headers from every response
      readRateLimitHeaders(response);

      if (response.ok) return response;

      // Rate limit hit
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') || response.headers.get('Retry-After');
        let retryDelay;
        if (retryAfter) {
          retryDelay = Math.min(parseInt(retryAfter, 10) * 1000 + 1000, 120000);
        } else {
          retryDelay = Math.min(RATE_LIMIT_WAIT_MS * Math.pow(2, Math.min(attempt, 3)), 120000);
        }

        const currentTime = Date.now();
        if (currentTime - lastRateLimitLogTime > 5000) {
          console.log(`[XeroClient] Rate limit hit (429). Waiting ${Math.round(retryDelay / 1000)}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
          lastRateLimitLogTime = currentTime;
        }

        rateLimitCooldownUntil = currentTime + retryDelay;
        rateLimitRemaining = 0;
        lastError = new Error(`HTTP 429: Rate limit exceeded`);

        if (attempt < MAX_RETRIES - 1) {
          await sleep(retryDelay);
          continue;
        }

        // Exhausted retries — throw special error for queue-level pause
        const err = new Error('RATE_LIMIT_EXHAUSTED');
        err.isRateLimit = true;
        throw err;
      }

      // Auth error — Xero rejected the token (e.g. it expired mid-job). Force a
      // single refresh and retry with the new token. Only retry once so a
      // genuinely revoked integration surfaces a clear error instead of looping.
      if (response.status === 401 || response.status === 403) {
        if (!authRetried) {
          authRetried = true;
          console.log(`[XeroClient] ${response.status} on ${url} — forcing token refresh and retrying...`);
          try {
            accessToken = await getOrRefreshToken(integration, { force: true });
          } catch (refreshErr) {
            // The refresh itself failed (e.g. invalid_grant — refresh_token
            // revoked). Surface that as the job error so the cause is obvious
            // ("reconnect Xero"), instead of an opaque 401 TokenExpired.
            throw new Error(`Xero auth failed and token refresh did not recover (reconnect Xero required): ${refreshErr.message}`);
          }
          continue; // retry with the refreshed token
        }
        return response;
      }

      const text = await response.text();
      lastError = new Error(`Xero API ${response.status} [${url}]: ${text.substring(0, 300)}`);

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.isRateLimit || lastError.message === 'RATE_LIMIT_EXHAUSTED') {
        throw lastError;
      }
    }

    if (attempt < MAX_RETRIES - 1) {
      await sleep(2000 * (attempt + 1));
    }
  }

  throw lastError || new Error(`Xero API request failed after ${MAX_RETRIES} retries`);
}

/**
 * Make an authenticated GET request to the Xero API.
 *
 * @param {object} integration — platform_integrations row
 * @param {string} tenantId  — Xero-tenant-id (platform_org_id)
 * @param {string} path      — e.g. '/Accounts'
 */
async function xeroGet(integration, tenantId, path) {
  const url      = `${XERO_API_BASE}${path}`;
  const response = await fetchWithRetry(url, integration, tenantId);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Xero API ${response.status} [${path}]: ${text.substring(0, 300)}`);
  }

  return response.json();
}

/**
 * Paginated GET — fetches one page of invoices.
 *
 * @param {object} integration — platform_integrations row
 * @param {string} tenantId
 * @param {string} path        — e.g. '/Invoices'
 * @param {number} page        — 1-based page number
 * @param {string} [startDate] — YYYY-MM-DD
 * @param {string} [endDate]   — YYYY-MM-DD
 * @returns {{ data: object, hasMore: boolean }}
 */
async function xeroGetPaged(integration, tenantId, path, page, startDate, endDate) {
  let url = `${XERO_API_BASE}${path}?page=${page}&pageSize=${PAGE_SIZE}`;

  // Normalize to YYYY-MM-DD — sync_jobs stores start_date/end_date as full
  // ISO timestamps (e.g. "2026-01-01T00:00:00+00:00"), so splitting on '-'
  // without trimming the time portion would make the day component NaN.
  const ymd = (d) => (d ? String(d).slice(0, 10) : null);
  const start = ymd(startDate);
  const end   = ymd(endDate);

  // Append date filter if provided using Xero's where clause syntax
  if (start && end) {
    const [sy, sm, sd] = start.split('-').map(Number);
    const [ey, em, ed] = end.split('-').map(Number);
    const where = `Date>=DateTime(${sy},${sm},${sd})AND Date<=DateTime(${ey},${em},${ed})`;
    url += `&where=${encodeURIComponent(where)}`;
  } else if (start) {
    const [sy, sm, sd] = start.split('-').map(Number);
    url += `&where=${encodeURIComponent(`Date>=DateTime(${sy},${sm},${sd})`)}`;
  } else if (end) {
    const [ey, em, ed] = end.split('-').map(Number);
    url += `&where=${encodeURIComponent(`Date<=DateTime(${ey},${em},${ed})`)}`;
  }

  const response = await fetchWithRetry(url, integration, tenantId);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Xero API ${response.status} [${path} page ${page}]: ${text.substring(0, 300)}`);
  }

  const data = await response.json();

  // Xero pagination: page is the last page when fewer than PAGE_SIZE items are returned
  // or when the pagination object says so (if present)
  let items = [];
  let hasMore = false;

  if (path.includes('Invoices')) {
    items = data.Invoices || [];
    hasMore = items.length === PAGE_SIZE;
  } else {
    // Generic fallback
    const keys = Object.keys(data).filter(k => Array.isArray(data[k]));
    items = keys.length > 0 ? data[keys[0]] : [];
    hasMore = items.length === PAGE_SIZE;
  }

  return { items, hasMore };
}

/**
 * Paginated GET using If-Modified-Since header instead of a Date where clause.
 * Catches backdated edits and voided records — Xero bumps UpdatedDateUTC on
 * any mutation so a cutoff on modified-time sees everything that changed.
 *
 * Works for /Invoices, /BankTransactions, /CreditNotes, /Overpayments —
 * all use page=N&pageSize=100 pagination.
 *
 * @param {object} integration — platform_integrations row
 * @param {string} tenantId
 * @param {string} path               — e.g. '/BankTransactions'
 * @param {number} page               — 1-based page number
 * @param {string|null} modifiedSince — ISO-8601 cutoff (e.g. '2025-04-01T00:00:00Z'); null = no filter
 * @returns {{ items: any[], hasMore: boolean }}
 */
async function xeroGetPagedIfModified(integration, tenantId, path, page, modifiedSince) {
  const url = `${XERO_API_BASE}${path}?page=${page}&pageSize=${PAGE_SIZE}`;

  const headers = {};
  if (modifiedSince) {
    // Xero expects RFC 1123 or ISO-8601; ISO is accepted.
    headers['If-Modified-Since'] = modifiedSince;
  }

  const response = await fetchWithRetry(url, integration, tenantId, headers);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Xero API ${response.status} [${path} page ${page}]: ${text.substring(0, 300)}`);
  }

  // 304 Not Modified — nothing changed since cutoff
  if (response.status === 304) {
    return { items: [], hasMore: false };
  }

  const data = await response.json();

  // Match the array key to the endpoint. Falls back to first array property.
  const PATH_TO_KEY = {
    '/Invoices':         'Invoices',
    '/BankTransactions': 'BankTransactions',
    '/CreditNotes':      'CreditNotes',
    '/Overpayments':     'Overpayments',
  };
  const key = PATH_TO_KEY[path]
    || Object.keys(data).find(k => Array.isArray(data[k]));
  const items = (key && Array.isArray(data[key])) ? data[key] : [];
  const hasMore = items.length === PAGE_SIZE;

  return { items, hasMore };
}

/**
 * Offset-paginated GET for /Journals. Xero's Journals API doesn't support
 * page=N — it uses an `offset` param that equals the highest JournalNumber
 * already seen. Returns up to 100 journals per call.
 *
 * @param {object} integration — platform_integrations row
 * @param {string} tenantId
 * @param {number|null} offset        — highest JournalNumber seen so far, or null for first page
 * @param {string|null} modifiedSince — If-Modified-Since cutoff (ISO)
 * @returns {{ items: any[], nextOffset: number|null, hasMore: boolean }}
 */
async function xeroGetJournalsOffset(integration, tenantId, offset, modifiedSince) {
  const url = offset != null
    ? `${XERO_API_BASE}/Journals?offset=${offset}`
    : `${XERO_API_BASE}/Journals`;

  const headers = {};
  if (modifiedSince) headers['If-Modified-Since'] = modifiedSince;

  const response = await fetchWithRetry(url, integration, tenantId, headers);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Xero API ${response.status} [/Journals offset=${offset}]: ${text.substring(0, 300)}`);
  }

  if (response.status === 304) {
    return { items: [], nextOffset: null, hasMore: false };
  }

  const data = await response.json();
  const items = Array.isArray(data.Journals) ? data.Journals : [];

  let nextOffset = null;
  for (const j of items) {
    const n = Number(j?.JournalNumber);
    if (Number.isFinite(n) && (nextOffset == null || n > nextOffset)) {
      nextOffset = n;
    }
  }
  // Xero returns up to 100 per call; stop when fewer arrive.
  const hasMore = items.length === PAGE_SIZE && nextOffset != null;

  return { items, nextOffset, hasMore };
}

module.exports = {
  getOrRefreshToken,
  refreshAccessToken,
  xeroGet,
  xeroGetPaged,
  xeroGetPagedIfModified,
  xeroGetJournalsOffset,
  PAGE_SIZE,
};
