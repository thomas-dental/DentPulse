/**
 * Sage Business Cloud Accounting (UK) OAuth client.
 *
 * Handles authorize URL build, token exchange, refresh, and persistence.
 * Mirrors the Xero client pattern (backend/api/xero/client.js).
 *
 * Sage OAuth quick facts:
 *   - Authorize URL: https://www.sageone.com/oauth2/auth/central
 *   - Token URL:     https://oauth.accounting.sage.com/token
 *   - API base:      https://api.accounting.sage.com/v3.1
 *   - access_token lifetime:  5 minutes (300 s)
 *   - refresh_token lifetime: 31 days
 *   - Scope:         full_access (broadest read+write)
 *
 * Requires env vars:
 *   SAGE_CLIENT_ID
 *   SAGE_CLIENT_SECRET
 *   SAGE_REDIRECT_URI
 */

const { supabaseAdmin } = require('../../config/supabase');

const SAGE_AUTH_URL  = 'https://www.sageone.com/oauth2/auth/central';
const SAGE_TOKEN_URL = 'https://oauth.accounting.sage.com/token';
const SAGE_API_BASE  = 'https://api.accounting.sage.com/v3.1';

const TOKEN_EXPIRY_BUFFER_MS = 60_000; // refresh if <60s remaining

/**
 * Build the Sage authorization URL the user must visit to grant access.
 *
 * @param {string} state — CSRF token; verify on callback
 * @param {string} [country='gb'] — region (UK = gb)
 * @returns {string}
 */
function buildAuthUrl(state, country = 'gb') {
  const clientId    = process.env.SAGE_CLIENT_ID;
  const redirectUri = process.env.SAGE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('SAGE_CLIENT_ID and SAGE_REDIRECT_URI must be set in environment variables');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  redirectUri,
    scope:         'full_access',
    state,
    country,
    locale:        'en-GB',
  });

  return `${SAGE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 *
 * @param {string} code — the `code` query param Sage sent to our callback
 * @returns {{ access_token, refresh_token, expires_in, token_type, requested_by_id }}
 */
async function exchangeCodeForTokens(code) {
  const clientId     = process.env.SAGE_CLIENT_ID;
  const clientSecret = process.env.SAGE_CLIENT_SECRET;
  const redirectUri  = process.env.SAGE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, and SAGE_REDIRECT_URI must be set');
  }

  const response = await fetch(SAGE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sage token exchange failed (${response.status}): ${text.substring(0, 300)}`);
  }

  return response.json();
}

/**
 * Refresh an expired Sage access token and persist the new tokens.
 *
 * @param {string} integrationId — platform_integrations.id
 * @param {string} refreshToken
 * @returns {{ accessToken, refreshToken, expiresAt }}
 */
async function refreshAccessToken(integrationId, refreshToken) {
  const clientId     = process.env.SAGE_CLIENT_ID;
  const clientSecret = process.env.SAGE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('SAGE_CLIENT_ID and SAGE_CLIENT_SECRET must be set in environment variables');
  }

  const response = await fetch(SAGE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sage token refresh failed (${response.status}): ${text.substring(0, 300)}`);
  }

  const tokenData = await response.json();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  const newRefresh = tokenData.refresh_token || refreshToken;

  await supabaseAdmin
    .from('platform_integrations')
    .update({
      access_token:     tokenData.access_token,
      refresh_token:    newRefresh,
      token_expires_at: expiresAt,
      updated_at:       new Date().toISOString(),
    })
    .eq('id', integrationId);

  console.log('[SageClient] Token refreshed, expires:', expiresAt);
  return { accessToken: tokenData.access_token, refreshToken: newRefresh, expiresAt };
}

/**
 * Get a valid access token for the given integration row.
 * Auto-refreshes if expired or expiring within 60 seconds.
 *
 * @param {{ id, access_token, refresh_token, token_expires_at }} integration
 * @returns {string} access token
 */
async function getOrRefreshToken(integration) {
  const { id, access_token, refresh_token, token_expires_at } = integration;

  if (!access_token) {
    throw new Error('No Sage access_token found. Please reconnect Sage.');
  }
  if (!refresh_token) {
    throw new Error('No Sage refresh_token found. Please reconnect Sage.');
  }

  if (token_expires_at) {
    const msLeft = new Date(token_expires_at).getTime() - Date.now();
    if (msLeft > TOKEN_EXPIRY_BUFFER_MS) {
      return access_token;
    }
  }

  console.log('[SageClient] Token expired or expiring soon — refreshing...');
  const refreshed = await refreshAccessToken(id, refresh_token);
  return refreshed.accessToken;
}

/**
 * Persist tokens for an org into platform_integrations.
 *
 * MULTI-CONNECTION (Xero / QuickBooks parity): an org can have MANY separate
 * Sage logins, each its own row. We no longer enforce a single row per org.
 *   - integrationId given (reconnect / dedup) → UPDATE that specific row.
 *   - integrationId null (fresh connect)      → INSERT a brand-new row.
 *
 * @param {string} organizationId
 * @param {string|null} userId — auth.users.id, optional
 * @param {{ access_token, refresh_token, expires_in }} tokens — from exchangeCodeForTokens
 * @param {string|null} integrationId — existing platform_integrations.id to update (reconnect)
 * @returns {object} the saved integration row
 */
async function saveTokens(organizationId, userId, tokens, integrationId = null) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const now       = new Date().toISOString();

  const payload = {
    organization_id:  organizationId,
    user_id:          userId,
    platform_name:    'sage',
    access_token:     tokens.access_token,
    refresh_token:    tokens.refresh_token,
    token_expires_at: expiresAt,
    is_connected:    true,
    updated_at:       now,
  };

  // Reconnect (or dedup of the same login) — update the existing row in place.
  if (integrationId) {
    const { data, error } = await supabaseAdmin
      .from('platform_integrations')
      .update(payload)
      .eq('id', integrationId)
      .select()
      .single();
    if (error) throw new Error(`Failed to update Sage integration: ${error.message}`);
    return data;
  }

  // Fresh connection — always INSERT a new row (multiple Sage accounts allowed).
  const { data, error } = await supabaseAdmin
    .from('platform_integrations')
    .insert({ ...payload, created_at: now })
    .select()
    .single();
  if (error) throw new Error(`Failed to insert Sage integration: ${error.message}`);
  return data;
}

/**
 * Fetch the businesses a freshly-issued token can access, WITHOUT a saved
 * integration row. Used during OAuth callback to dedup the same Sage login
 * connecting twice (mirrors Xero's tenant-based dedup). The token is fresh, so
 * getOrRefreshToken returns it directly (no row id needed for refresh).
 *
 * @param {{ access_token, refresh_token, expires_in }} tokens
 * @returns {Promise<object[]>}
 */
async function fetchBusinessesWithTokens(tokens) {
  const tempIntegration = {
    id:               null,
    access_token:     tokens.access_token,
    refresh_token:    tokens.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };
  return fetchBusinesses(tempIntegration);
}

/**
 * Authenticated GET request to the Sage Accounting API.
 * Auto-refreshes the access token if expired.
 *
 * @param {object} integration — platform_integrations row (id, access_token, refresh_token, token_expires_at)
 * @param {string} path — API path starting with `/`, e.g. `/contacts`
 * @param {object} [query] — optional query params (items_per_page, etc.)
 * @returns {object} parsed JSON
 */
async function sageGet(integration, path, query = {}, businessId = null) {
  const token = await getOrRefreshToken(integration);
  const params = new URLSearchParams(query);
  const qs = params.toString();
  const url = `${SAGE_API_BASE}${path}${qs ? `?${qs}` : ''}`;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  };
  // Multi-business: target a specific Sage business. Without this header the
  // API uses the "lead" (first-created) business. See /businesses + multi_business docs.
  if (businessId) headers['X-Business'] = String(businessId);

  const response = await fetch(url, { method: 'GET', headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sage API GET ${path} failed (${response.status}): ${text.substring(0, 500)}`);
  }

  return response.json();
}

/**
 * Authenticated POST request to the Sage Accounting API (writes).
 * Requires the `full_access` scope. Pass `businessId` to target a specific
 * business via the X-Business header (multi-business orgs).
 *
 * @param {object} integration — platform_integrations row
 * @param {string} path — API path starting with `/`, e.g. `/purchase_invoices`
 * @param {object} body — request body (will be JSON-stringified)
 * @param {string|null} [businessId] — Sage business GUID for X-Business header
 * @returns {object} parsed JSON
 */
async function sagePost(integration, path, body, businessId = null) {
  const token = await getOrRefreshToken(integration);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (businessId) headers['X-Business'] = String(businessId);

  const response = await fetch(`${SAGE_API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sage API POST ${path} failed (${response.status}): ${text.substring(0, 500)}`);
  }

  return response.json();
}

/**
 * List every Sage business the connection's token can access.
 * Returns the $items array from GET /businesses (each has id, name, ...).
 * Used to sync per-business (loop) and to populate platform_integration_organizations.
 *
 * @param {object} integration — platform_integrations row
 * @returns {Promise<object[]>}
 */
async function fetchBusinesses(integration) {
  try {
    const resp = await sageGet(integration, '/businesses', { attributes: 'all' });
    return resp?.$items || (Array.isArray(resp) ? resp : (resp?.id ? [resp] : []));
  } catch (err) {
    // Some plans expose /business (singular)
    try {
      const single = await sageGet(integration, '/business', { attributes: 'all' });
      return single?.id ? [single] : [];
    } catch (err2) {
      console.warn('[SageClient] fetchBusinesses failed:', err.message);
      return [];
    }
  }
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getOrRefreshToken,
  saveTokens,
  sageGet,
  sagePost,
  fetchBusinesses,
  fetchBusinessesWithTokens,
  saveSageTenant,
  SAGE_API_BASE,
};

/**
 * Fetch Sage business info and upsert into platform_integration_organizations.
 *
 * Sage Business Cloud Accounting is single-tenant per OAuth (unlike Xero which
 * supports multi-tenant). We fetch GET /businesses (Sage returns the array of
 * businesses the access_token has access to — usually exactly 1) and save the
 * primary one as a row in platform_integration_organizations so it shows up
 * in the Practice Location Mapping UI alongside Xero/QuickBooks tenants.
 *
 * Safe to call multiple times — uses UPSERT on (platform_integration_id, platform_org_id).
 *
 * @param {object} integration — platform_integrations row (id, organization_id, user_id, access_token, ...)
 * @returns {Promise<{ ok: boolean, tenant?: object, skipped?: boolean, reason?: string }>}
 */
async function saveSageTenant(integration) {
  if (!integration?.id) {
    return { ok: false, reason: 'No integration row provided' };
  }

  let businessesResponse;
  try {
    // GET /businesses returns array of businesses authorized for this token
    businessesResponse = await sageGet(integration, '/businesses', { attributes: 'all' });
  } catch (err) {
    // Some plans return /business (singular) — try fallback
    try {
      const single = await sageGet(integration, '/business', { attributes: 'all' });
      businessesResponse = { $items: [single] };
    } catch (err2) {
      console.warn('[SageClient] /businesses + /business both failed; cannot save tenant:', err.message);
      return { ok: false, reason: `Sage business endpoint unavailable: ${err.message}` };
    }
  }

  const items = businessesResponse?.$items
    || (Array.isArray(businessesResponse) ? businessesResponse : null)
    || (businessesResponse?.id ? [businessesResponse] : []);

  if (!items.length) {
    return { ok: false, reason: 'No business returned from Sage' };
  }

  // Multi-business: a single Sage token can access several businesses. We save
  // EVERY business as its own platform_integration_organizations row so they
  // all appear in the Practice Location Mapping UI and each location can be
  // mapped to a different Sage business (Xero-parity). is_selected=true for all.
  const tenants = [];
  for (const business of items) {
    const tenantPayload = {
      organization_id:           integration.organization_id,
      platform_integration_id:   integration.id,
      user_id:                   integration.user_id,
      platform_name:             'sage',
      platform_org_id:           String(business.id),
      platform_org_name:         business.name || business.displayed_as || 'Sage Business',
      platform_org_code:         business.sage_one_account_number
                                    || business.account_number
                                    || null,
      email:                     business.email || null,
      country:                   business.country?.id || business.country || null,
      currency:                  business.currency?.id || business.currency || 'GBP',
      timezone:                  business.timezone?.id || business.timezone || null,
      status:                    'active',
      is_selected:               true,
      raw_data:                  business,
      meta_data: {
        sage_business_id: business.id,
        country_id:       business.country?.id || null,
        currency_id:      business.currency?.id || null,
        vat_registered:   business.vat_registered ?? null,
        financial_year_end: business.financial_year_end || null,
      },
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('platform_integration_organizations')
      .upsert(tenantPayload, { onConflict: 'platform_integration_id,platform_org_id' })
      .select()
      .single();

    if (error) {
      console.error(`[SageClient] Failed to upsert Sage tenant ${tenantPayload.platform_org_id}:`, error.message);
      continue; // keep going — one bad business shouldn't drop the rest
    }
    tenants.push(data);
    console.log(`[SageClient] Saved Sage tenant: ${tenantPayload.platform_org_name} (${tenantPayload.platform_org_id})`);
  }

  if (!tenants.length) {
    return { ok: false, reason: 'All Sage tenant upserts failed' };
  }

  // Return `tenant` (first) for back-compat with existing callers + full list.
  return { ok: true, tenant: tenants[0], tenants };
}
