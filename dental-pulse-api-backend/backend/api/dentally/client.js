/**
 * Dentally API client with smart rate limiting.
 *
 * Features:
 * - Reads X-RateLimit-Remaining / X-RateLimit-Reset headers to proactively pause
 * - Auto-throttles when rate limit is low (< 10 remaining)
 * - PER-ACCOUNT cooldowns: Dentally's 3600/hr bucket is scoped to the
 *   connected account (API key), so all throttle state is keyed by API key —
 *   one exhausted account pauses only its own lane, never the ~100 other
 *   accounts syncing in parallel. (The old module-global counter let one
 *   account's `remaining: 0` freeze every org for the rest of the hour.)
 * - Process-wide storm brake: many DISTINCT accounts rate-limited within a
 *   short window means IP-level throttling, not one account's bucket — then
 *   everything backs off briefly together.
 * - Exponential backoff on rate limit hit
 * - Never permanently fails on rate limit — throws special error for queue-level pause
 */

const { sleep } = require('../../utils/helpers');
const { ENDPOINT_MAP, ENTITY_BY_ALIAS } = require('./config');

const MAX_RETRIES = 8;          // More retries for rate limits (was 5)
const RETRY_DELAY_MS = 2000;
const RATE_LIMIT_WAIT_MS = 15000; // 15s wait when rate limit hit (was 30s)
const PER_PAGE = 100;
// Bound every outbound Dentally call. Node's undici fetch has no default
// timeout, so a half-open socket freezes the whole per-integration worker
// forever (status stays "running", Sync Summary shows a phantom active sync).
const REQUEST_TIMEOUT_MS = 60_000;

// A 403 whose own headers still show this much hourly budget is a limiter
// blip (rollover lag, or an undocumented short-window burst limit), not real
// exhaustion — observed in production: 403 at 13:00:03 with remaining=3589,
// which the hour-boundary fallback turned into a needless 59-minute sleep.
const BURST_BLIP_MIN_REMAINING = Number(process.env.DENTALLY_BLIP_MIN_REMAINING || 50);
const BURST_BLIP_RETRY_MS = Number(process.env.DENTALLY_BLIP_RETRY_MS || 30000); // blip backoff: 30s, 60s, 90s…

// During a long cooldown, send one cheap probe every interval instead of
// sleeping blind — if the limiter has recovered early, resume immediately.
const COOLDOWN_PROBE_INTERVAL_MS = Number(process.env.DENTALLY_PROBE_INTERVAL_MS || 3 * 60 * 1000);

// Cooldown is persisted to public.dentally_rate_limit_state; the JSON file is
// kept as a warm fallback for when the DB is unreachable. See
// services/sync/rateLimitStore.js.
const rateLimitStore = require('../../services/sync/rateLimitStore');

// Synchronous seed at module load — the DB read is async, so start from the
// file and let the loadCooldown() call below correct it a moment later.
function loadPersistedCooldown() {
  return rateLimitStore.loadCooldownFromFile();
}

// Fire-and-forget: the in-memory cooldown is already authoritative for this
// process, so a slow/failed write must never block the caller.
//
// NOTE the persistence stays on the GLOBAL row (integration_id null): the
// client only knows API keys, not integration ids. The persisted value is a
// restart safety net — on boot it seeds every account's initial cooldown,
// which briefly re-imposes one account's window on all of them. That only
// happens after a restart during an active cooldown and is bounded by the
// hour; live (no-restart) behaviour is fully per-account.
function persistCooldown(cooldownUntil, state) {
  // remaining starts as Infinity, which is not a valid INTEGER column
  // value — send null until a real header has been seen.
  const remaining = state && Number.isFinite(state.remaining) ? state.remaining : null;
  rateLimitStore.persistCooldown(cooldownUntil, null, remaining).catch(() => {});
}

/**
 * Normalize any date string to YYYY-MM-DDT00:00:00 (no timezone).
 * Handles: "2026-01-01", "2026-01-01T00:00:00", "2026-01-01T00:00:00+00:00"
 */
function toIsoDatetime(dateStr) {
  return dateStr.slice(0, 10) + 'T00:00:00';
}

/**
 * For 'before' date filters: add 1 day so the end date is INCLUSIVE.
 * The Dentally API treats 'before' as exclusive (before=2026-01-31T00:00:00 excludes Jan 31).
 * By sending before=2026-02-01T00:00:00, we include all of Jan 31.
 */
function toIsoDatetimeNextDay(dateStr) {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) + 'T00:00:00';
}

// ── Per-account rate-limit state ────────────────────────────────────────────
// Dentally's hourly bucket is per connected account, so every piece of
// throttle state (remaining, reset, cooldown, probe bookkeeping) lives in a
// Map keyed by API key. The persisted cooldown (file + global DB row) seeds
// each account's INITIAL state so a restart doesn't immediately re-hit the API.
const accountStates = new Map(); // apiKey -> state
let seedCooldownUntil = loadPersistedCooldown();

function getAccountState(apiKey) {
  const key = apiKey || '__global__';
  let s = accountStates.get(key);
  if (!s) {
    s = {
      cooldownUntil: seedCooldownUntil,
      remaining: Infinity,   // remaining API calls, from response headers
      resetAt: 0,            // epoch ms when this account's limit resets
      lastLogTime: 0,
      probeInFlight: false,
      lastProbeAt: 0,
    };
    accountStates.set(key, s);
  }
  return s;
}

/** 'Bearer <key>' -> '<key>' — how fetchWithRetry scopes state to an account. */
function apiKeyFromOptions(options) {
  const auth = options?.headers?.Authorization || options?.headers?.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : (auth || '__global__');
}

/** Log-safe account label — never print the key itself. */
function keyTag(apiKey) {
  if (!apiKey || apiKey === '__global__') return 'global';
  return `…${apiKey.slice(-4)}`;
}

if (seedCooldownUntil > Date.now()) {
  console.log(`[Dentally] Loaded persisted rate-limit cooldown — ${Math.round((seedCooldownUntil - Date.now()) / 1000)}s remaining (seeds each account's initial state)`);
}

// The file seed above only reflects THIS host. Pull the shared cooldown from
// the DB so a second API instance (or a fresh redeploy) honours a cooldown it
// never wrote itself. Only ever moves cooldowns later, never earlier.
rateLimitStore.loadCooldown(null)
  .then((dbCooldown) => {
    if (dbCooldown > seedCooldownUntil) {
      seedCooldownUntil = dbCooldown;
      for (const s of accountStates.values()) {
        if (dbCooldown > s.cooldownUntil) s.cooldownUntil = dbCooldown;
      }
      const secs = Math.round((dbCooldown - Date.now()) / 1000);
      if (secs > 0) console.log(`[Dentally] Adopted shared rate-limit cooldown from DB — ${secs}s remaining`);
    }
  })
  .catch(() => {});

// ── Process-wide storm brake ────────────────────────────────────────────────
// Per-account isolation must not blind us to IP-level throttling: if many
// DISTINCT accounts hit real rate-limit responses within a short window, the
// gateway is throttling US, not one account's bucket — briefly pause all lanes.
const STORM_WINDOW_MS = 2 * 60 * 1000;
const STORM_MIN_ACCOUNTS = 5;
const STORM_PAUSE_MS = 60 * 1000;
let stormHits = [];        // [{ key, at }]
let stormPauseUntil = 0;

function noteRateLimitHit(apiKey) {
  const now = Date.now();
  stormHits = stormHits.filter((h) => now - h.at < STORM_WINDOW_MS);
  stormHits.push({ key: apiKey, at: now });
  const distinct = new Set(stormHits.map((h) => h.key)).size;
  if (distinct >= STORM_MIN_ACCOUNTS && stormPauseUntil < now) {
    stormPauseUntil = now + STORM_PAUSE_MS;
    console.warn(`[Dentally] ${distinct} distinct accounts rate-limited within ${STORM_WINDOW_MS / 60000} min — IP-level throttle suspected, pausing ALL lanes ${STORM_PAUSE_MS / 1000}s`);
  }
}

/**
 * Read rate limit headers from a Dentally API response into the state of the
 * ACCOUNT that made the request — headers describe that account's bucket only.
 */
function readRateLimitHeaders(response, state) {
  const remaining = response.headers.get('x-ratelimit-remaining')
    || response.headers.get('X-RateLimit-Remaining')
    || response.headers.get('ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset')
    || response.headers.get('X-RateLimit-Reset')
    || response.headers.get('ratelimit-reset');

  if (remaining !== null) {
    state.remaining = parseInt(remaining, 10);
  }

  if (reset !== null) {
    // Dentally returns Unix timestamp (seconds) for rate limit reset
    const resetVal = parseInt(reset, 10);
    state.resetAt = resetVal * 1000; // convert to ms
  }
}

/**
 * Proactively wait if THIS account's rate limit is low.
 * Called before each API request to prevent hitting the limit.
 */
async function waitIfRateLimitLow(state, tag) {
  // If remaining calls are critically low, pause until reset
  if (state.remaining <= 3) {
    let waitMs;
    if (state.resetAt > Date.now()) {
      waitMs = state.resetAt - Date.now() + 1000; // +1s buffer
    } else {
      // No reset time — wait until next hour boundary
      const msIntoHour = Date.now() % 3600000;
      waitMs = (3600000 - msIntoHour) + 1000;
    }
    const now = Date.now();
    if (now - state.lastLogTime > 5000) {
      const resetTime = new Date(now + waitMs).toLocaleTimeString();
      console.log(`[Dentally] Rate limit low for account ${tag} (${state.remaining} remaining). Pausing ${Math.round(waitMs / 1000)}s until reset at ~${resetTime}`);
      state.lastLogTime = now;
    }
    await sleep(waitMs);
    return;
  }

  // Light throttle only when very close to limit
  if (state.remaining <= 5 && state.remaining > 3) {
    await sleep(200);
  }
}

/**
 * Check if a 403 response is a rate limit error (Dentally returns 403, not 429).
 */
async function isRateLimitError(response) {
  try {
    const text = await response.clone().text();
    return text.includes('Rate limit exceeded') || text.includes('rate_limit');
  } catch {
    return false;
  }
}

/**
 * Get the dynamic detail-fetch concurrency based on rate limit state.
 * Reduces concurrency when the account's limit is low. Without an apiKey
 * (legacy call sites), uses the most conservative remaining across accounts.
 */
function getInvoiceBatchConcurrency(apiKey) {
  let remaining;
  if (apiKey) {
    remaining = getAccountState(apiKey).remaining;
  } else {
    remaining = Infinity;
    for (const s of accountStates.values()) remaining = Math.min(remaining, s.remaining);
  }
  if (remaining <= 3) return 1;
  if (remaining <= 10) return 3;
  if (remaining <= 20) return 5;
  return 15; // default — aggressive parallel fetching
}

/**
 * Wait out THIS account's cooldown (and any storm pause), probing for early
 * recovery.
 *
 * Instead of one blind sleep to the (worst-case) computed reset, sleep in
 * probe-interval steps and fire a single cheap request (/v1/sites?per_page=1,
 * same auth as the blocked request — so the probe tests this account's own
 * bucket). A 200 means the limiter has already recovered — clear this
 * account's cooldown and resume its lane immediately. A failed probe just
 * means we keep waiting; it costs one request per interval, only while a
 * cooldown is active. Probe bookkeeping lives on the account state, so each
 * account has at most one prober while other accounts keep working normally.
 */
async function waitForCooldownWithProbe(url, options, state) {
  const tag = keyTag(apiKeyFromOptions(options));
  while (true) {
    const now = Date.now();
    const waitMs = Math.max(state.cooldownUntil, stormPauseUntil) - now;
    if (waitMs <= 0) return;

    if (now - state.lastLogTime > 5000) {
      console.log(`[Dentally] Cooldown active for account ${tag}. Waiting ${Math.round(waitMs / 1000)}s (probing every ${Math.round(COOLDOWN_PROBE_INTERVAL_MS / 60000)} min for early recovery)...`);
      state.lastLogTime = now;
    }

    if (waitMs <= COOLDOWN_PROBE_INTERVAL_MS) {
      await sleep(waitMs);
      return;
    }

    await sleep(COOLDOWN_PROBE_INTERVAL_MS);

    if (state.probeInFlight || Date.now() - state.lastProbeAt < COOLDOWN_PROBE_INTERVAL_MS / 2) continue;
    state.probeInFlight = true;
    state.lastProbeAt = Date.now();
    try {
      const probeUrl = `${new URL(url).origin}/v1/sites?per_page=1`;
      const res = await fetch(probeUrl, {
        method: 'GET',
        headers: options.headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      readRateLimitHeaders(res, state);
      if (res.ok) {
        const aheadSecs = Math.round((state.cooldownUntil - Date.now()) / 1000);
        console.log(`[Dentally] Cooldown probe OK for account ${tag} (${state.remaining} remaining) — limiter recovered, resuming ${aheadSecs}s ahead of schedule`);
        state.cooldownUntil = 0;
        persistCooldown(Date.now(), state); // share the all-clear with restarts
        return;
      }
    } catch {
      // Network error — keep waiting; next interval probes again.
    } finally {
      state.probeInFlight = false;
    }
  }
}

/**
 * Fetch with retry and smart rate limit handling.
 * Uses exponential backoff and reads rate limit headers.
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  let lastError = null;
  const apiKey = apiKeyFromOptions(options);
  const state = getAccountState(apiKey);
  const tag = keyTag(apiKey);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Wait for THIS account's cooldown if active (probes for early recovery)
      await waitForCooldownWithProbe(url, options, state);

      // Proactively wait if this account's rate limit is low
      await waitIfRateLimitLow(state, tag);

      // Prefer the caller's signal when present; otherwise enforce our own
      // timeout so a hung socket cannot pin a worker indefinitely.
      const response = await fetch(url, {
        ...options,
        signal: options?.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Read rate limit headers into THIS account's state
      readRateLimitHeaders(response, state);

      if (response.ok) return response;

      // Rate limit: Dentally uses 403 with "Rate limit exceeded" OR standard 429
      if (response.status === 429 || (response.status === 403 && await isRateLimitError(response))) {
        // readRateLimitHeaders(response) above captured THIS response's
        // headers. If they still show real hourly budget, this is a blip —
        // short escalating backoff instead of the hour-boundary cooldown.
        // The final attempt always falls through to the conservative path so
        // a persistent limiter (stale headers, undocumented limit) still ends
        // in RATE_LIMIT_EXHAUSTED and the queue-level pause.
        if (Number.isFinite(state.remaining) && state.remaining > BURST_BLIP_MIN_REMAINING && attempt < retries - 1) {
          const blipDelay = BURST_BLIP_RETRY_MS * (attempt + 1); // 30s, 60s, 90s…
          state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + blipDelay);
          // Deliberately not persisted: a ≤90s blip isn't worth re-imposing
          // on every account's boot seed after a restart.
          console.log(`[Dentally] Rate limit blip for account ${tag} (${response.status} but ${state.remaining} remaining). Backing off ${Math.round(blipDelay / 1000)}s, retry ${attempt + 1}/${retries}...`);
          lastError = new Error(`HTTP ${response.status}: Rate limit blip`);
          await sleep(blipDelay);
          continue;
        }

        // Use reset header if available, otherwise exponential backoff
        let retryDelay;
        if (state.resetAt > Date.now()) {
          // Wait until the API's reset timestamp + 2s buffer
          retryDelay = state.resetAt - Date.now() + 2000;
        } else {
          // No reset time — wait until the next hour boundary + 2s buffer
          const msIntoHour = Date.now() % 3600000;
          retryDelay = (3600000 - msIntoHour) + 2000;
        }

        const currentTime = Date.now();
        if (currentTime - state.lastLogTime > 5000) {
          console.log(`[Dentally] Rate limit hit for account ${tag} (${response.status}). Waiting ${Math.round(retryDelay / 1000)}s before retry ${attempt + 1}/${retries}...`);
          state.lastLogTime = currentTime;
        }

        // Cooldown pauses THIS account's lane only — Dentally's bucket is per
        // connected account. Persisted (global row) as the restart seed, and
        // counted toward the storm brake in case the whole IP is throttled.
        state.cooldownUntil = currentTime + retryDelay;
        state.remaining = 0;
        persistCooldown(state.cooldownUntil, state);
        noteRateLimitHit(apiKey);

        lastError = new Error(`HTTP ${response.status}: Rate limit exceeded`);
        if (attempt < retries - 1) {
          // The cooldown was just set above, so this waits the same window as
          // the old blind sleep(retryDelay) — but probes for early recovery.
          await waitForCooldownWithProbe(url, options, state);
          continue;
        }
        // Final attempt: throw special error so the queue can pause instead of failing
        const err = new Error('RATE_LIMIT_EXHAUSTED');
        err.isRateLimit = true;
        err.rateLimitResetAt = state.resetAt || 0;
        throw err;
      }

      // Don't retry real auth errors (401, non-rate-limit 403)
      if (response.status === 401 || response.status === 403) {
        return response;
      }

      const text = await response.text();
      lastError = new Error(`HTTP ${response.status}: ${text}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Re-throw rate limit exhausted errors immediately
      if (lastError.isRateLimit || lastError.message === 'RATE_LIMIT_EXHAUSTED') {
        throw lastError;
      }
    }

    if (attempt < retries - 1) {
      const delay = RETRY_DELAY_MS * (attempt + 1);
      await sleep(delay);
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * Fetch a single page of data from the Dentally API.
 * @param {object} [entityConfigOverride] - Optional partial entity config to override defaults (e.g. for historical mode)
 */
async function fetchDentallyPage(apiKey, apiEndpoint, entityAlias, page, startDate, endDate, entityConfigOverride) {
  const baseUrl = apiEndpoint.replace(/\/$/, '');
  const apiPath = ENDPOINT_MAP[entityAlias];
  if (!apiPath) throw new Error(`Unknown entity alias: ${entityAlias}`);

  const entity = entityConfigOverride
    ? { ...ENTITY_BY_ALIAS[entityAlias], ...entityConfigOverride }
    : ENTITY_BY_ALIAS[entityAlias];
  const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });

  // Add date filters based on entity config
  // Dates must be sent as YYYY-MM-DDT00:00:00 (no timezone) — the Dentally API
  // returns incorrect results with plain YYYY-MM-DD or with timezone offset (+00:00)
  // 'after' is effectively inclusive (after=2026-02-01T00:00:00 includes Feb 1 records
  //   because appointment times like 09:00 are after midnight 00:00)
  // 'before' is exclusive (before=2026-02-19T00:00:00 excludes Feb 19 records)
  //   so we add 1 day to include the end date
  if (startDate && entity.dateFilter) {
    // Apply lookback: extend start date backward to capture records created earlier
    // but updated/paid in the current sync window (e.g. invoices created in Feb, paid in Mar)
    let effectiveStartDate = startDate;
    if (entity.lookbackDays && entity.lookbackDays > 0) {
      const d = new Date(startDate);
      d.setDate(d.getDate() - entity.lookbackDays);
      effectiveStartDate = d.toISOString().slice(0, 10);
    }
    params.append(entity.dateFilter, toIsoDatetime(effectiveStartDate));

    if (entity.dateFilterEnd && endDate) {
      // For date-only fields (e.g. invoices dated_on_before), pass the date as-is —
      // the API already treats it as inclusive. Only add +1 day for datetime fields
      // (e.g. appointments before) where the API treats 'before' as exclusive.
      const endValue = entity.endDateInclusive
        ? toIsoDatetime(endDate)
        : toIsoDatetimeNextDay(endDate);
      params.append(entity.dateFilterEnd, endValue);
    }
  }

  // sort_by must be sent on every page (date or no date) so pagination is
  // stable. Without it, Dentally can repeat or skip records across pages,
  // which the dedup layer can't compensate for (skipped rows just disappear).
  if (entity.sortBy) params.append('sort_by', entity.sortBy);

  // Add any extra static query params from entity config (e.g. state=Completed for appointments)
  if (entity.extraParams) {
    for (const [key, val] of Object.entries(entity.extraParams)) {
      params.append(key, val);
    }
  }

  const url = `${baseUrl}${apiPath}?${params.toString()}`;
  console.log(`[Dentally] Fetching: ${url}`);

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'DentPulse/1.0',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dentally API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Extract records array and metadata from a Dentally API response.
 */
function extractRecords(responseData, entityAlias) {
  const entity = ENTITY_BY_ALIAS[entityAlias];
  const responseKey = entity ? entity.responseKey : entityAlias;

  let records = [];
  if (Array.isArray(responseData)) {
    records = responseData;
  } else if (responseData[responseKey] && Array.isArray(responseData[responseKey])) {
    records = responseData[responseKey];
  } else if (responseData[entityAlias] && Array.isArray(responseData[entityAlias])) {
    records = responseData[entityAlias];
  } else if (responseData.data && Array.isArray(responseData.data)) {
    records = responseData.data;
  }

  let totalPages = null;
  let total = null;
  if (responseData.meta) {
    if (responseData.meta.total_pages) totalPages = responseData.meta.total_pages;
    if (responseData.meta.total != null) total = responseData.meta.total;
  }

  // Some Dentally endpoints (e.g. /v1/treatment_plan_items) return meta.total but
  // omit meta.total_pages. Without a page total the sync engine can't detect the
  // last page and falls back to the MAX_PAGES_PER_JOB safety cap, which silently
  // truncates large result sets (e.g. a bulk updated_at re-stamp piling 170k+ TPIs
  // into one monthly chunk). Derive the page count from the record total so
  // pagination always knows where to stop.
  if (totalPages == null && total != null) {
    totalPages = Math.ceil(total / PER_PAGE);
  }

  return { records, totalPages, total };
}

/**
 * Fetch a single invoice's detail (includes invoice_items).
 */
async function fetchInvoiceDetail(apiKey, apiEndpoint, invoiceId) {
  const baseUrl = apiEndpoint.replace(/\/$/, '');
  const url = `${baseUrl}/v1/invoices/${invoiceId}`;

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'DentPulse/1.0',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dentally invoice detail API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Fetch invoice details in parallel batches.
 * Auto-adjusts concurrency based on rate limit state.
 * Only adds delay when rate limit is under pressure.
 * Supports cancellation via cancelTokens map.
 */
async function fetchInvoiceDetailsBatch(apiKey, apiEndpoint, invoices, cancelCheck) {
  const results = [];
  let i = 0;

  while (i < invoices.length) {
    // Check cancellation between batches
    if (cancelCheck && cancelCheck()) {
      console.log(`[Dentally] Invoice detail fetch cancelled`);
      return results; // return partial results
    }

    // Dynamically adjust concurrency based on this account's rate limit
    const concurrency = getInvoiceBatchConcurrency(apiKey);
    const batch = invoices.slice(i, i + concurrency);

    const settled = await Promise.allSettled(
      batch.map(invoice =>
        fetchInvoiceDetail(apiKey, apiEndpoint, invoice.id)
          .then(detail => detail.invoice || detail)
      )
    );

    for (let j = 0; j < settled.length; j++) {
      if (settled[j].status === 'fulfilled') {
        results.push(settled[j].value);
      } else {
        const errMsg = settled[j].reason?.message || '';
        // If rate limit exhausted, re-throw to pause the job
        if (errMsg === 'RATE_LIMIT_EXHAUSTED' || settled[j].reason?.isRateLimit) {
          throw settled[j].reason;
        }
        console.error(`[Dentally] Failed to fetch invoice ${batch[j].id}: ${errMsg}`);
        results.push(batch[j]); // fallback to list record
      }
    }

    i += batch.length;

    // Only add delay between batches when this account's limit is under pressure
    if (i < invoices.length && getAccountState(apiKey).remaining <= 20) {
      await sleep(100);
    }
  }

  return results;
}

/**
 * Fetch a single account's detail (includes `uuid` not present on the list endpoint).
 */
async function fetchAccountDetail(apiKey, apiEndpoint, accountId) {
  const baseUrl = apiEndpoint.replace(/\/$/, '');
  const url = `${baseUrl}/v1/accounts/${accountId}`;

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'DentPulse/1.0',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dentally account detail API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.account || data;
}

/**
 * Fetch account details in parallel batches.
 *
 * IMPORTANT: Dentally's account list and detail endpoints disagree on field
 * naming for the same data:
 *   List:   { id: 64970681 (BIGINT), patient_id: 20605 (BIGINT), ... }
 *   Detail: { id: "be58ab..." (UUID), sid: 64970681 (BIGINT),
 *             patient_id: "2b3c03..." (UUID), patient_name, ... }
 *
 * Spreading detail over list would clobber the numeric `id` and `patient_id`
 * with UUIDs — breaking parseBigInt() in the transformer. We instead pull
 * just the new fields off detail and bolt them on under non-colliding keys.
 *
 * Mirrors fetchInvoiceDetailsBatch — auto-adjusts concurrency, supports
 * cancellation, and falls back to the list record if detail fails so the
 * row still upserts (just without uuid).
 */
async function fetchAccountDetailsBatch(apiKey, apiEndpoint, accounts, cancelCheck) {
  const results = [];
  let i = 0;

  while (i < accounts.length) {
    if (cancelCheck && cancelCheck()) {
      console.log(`[Dentally] Account detail fetch cancelled`);
      return results;
    }

    const concurrency = getInvoiceBatchConcurrency(apiKey);
    const batch = accounts.slice(i, i + concurrency);

    const settled = await Promise.allSettled(
      batch.map(account => fetchAccountDetail(apiKey, apiEndpoint, account.id))
    );

    for (let j = 0; j < settled.length; j++) {
      if (settled[j].status === 'fulfilled') {
        const detail = settled[j].value || {};
        // Keep ALL list fields verbatim, then add detail's UUID under `uuid`
        // (detail puts the UUID in `id` — confusing but that's the contract).
        results.push({
          ...batch[j],
          uuid: detail.id || null,
        });
      } else {
        const errMsg = settled[j].reason?.message || '';
        if (errMsg === 'RATE_LIMIT_EXHAUSTED' || settled[j].reason?.isRateLimit) {
          throw settled[j].reason;
        }
        console.error(`[Dentally] Failed to fetch account ${batch[j].id}: ${errMsg}`);
        results.push(batch[j]);
      }
    }

    i += batch.length;

    if (i < accounts.length && getAccountState(apiKey).remaining <= 20) {
      await sleep(100);
    }
  }

  return results;
}

/**
 * Fetch a single patient by Dentally patient ID.
 * Returns the patient object or null if not found.
 */
async function fetchPatientById(apiKey, apiEndpoint, patientId) {
  const baseUrl = apiEndpoint.replace(/\/$/, '');
  const url = `${baseUrl}/v1/patients/${patientId}`;

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'DentPulse/1.0',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Dentally] Failed to fetch patient ${patientId}: ${response.status} ${errorText}`);
    return null;
  }

  const data = await response.json();
  return data.patient || data;
}

module.exports = { fetchDentallyPage, fetchInvoiceDetail, fetchInvoiceDetailsBatch, fetchAccountDetail, fetchAccountDetailsBatch, fetchPatientById, extractRecords, PER_PAGE, getInvoiceBatchConcurrency };
