/**
 * Iplicit API client.
 *
 * Handles authentication (session token) and data fetching from the Iplicit API.
 * Credentials are stored in platform_integrations:
 *   client_id     = domain        (e.g. demo.dentpulse.2026)
 *   username      = username/login
 *   client_secret = apiKey
 *   access_token  = cached session token
 *   token_expires_at = token expiry timestamp
 */

const { supabaseAdmin } = require('../../config/supabase');

const IPLICIT_API_BASE = 'https://api.iplicit.com';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry — retries on network errors and non-4xx HTTP errors.
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      // Don't retry on auth errors
      if (response.status === 401 || response.status === 403) return response;
      const text = await response.text();
      lastError = new Error(`HTTP ${response.status}: ${text}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < retries - 1) {
      const delay = RETRY_DELAY_MS * (attempt + 1);
      console.log(`[IplicitClient] Retry ${attempt + 1}/${retries - 1} after ${delay}ms — ${lastError?.message}`);
      await sleep(delay);
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * Create a new Iplicit session token.
 * @param {string} domain
 * @param {string} username
 * @param {string} apiKey
 * @returns {Promise<{ sessionToken: string, tokenDue: string }>}
 */
async function createSession(domain, username, apiKey) {
  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/session/create/api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Domain': domain,
    },
    body: JSON.stringify({ username, userApiKey: apiKey }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Iplicit authentication failed (${response.status}): ${text}`);
  }

  return response.json(); // { sessionToken, tokenDue, domain, apiVer }
}

/**
 * Get or refresh session token for a platform_integrations connection.
 * Reuses cached token if still valid (expires > 5 min from now).
 * Persists new token back to platform_integrations.
 *
 * @param {string} connectionId   — platform_integrations.id
 * @param {string} domain         — client_id
 * @param {string} username       — username (platform_integrations.username)
 * @param {string} apiKey         — API key (platform_integrations.client_secret)
 * @param {string|null} currentToken
 * @param {string|null} tokenExpiresAt
 * @returns {Promise<{ sessionToken: string, tokenExpiry: string }>}
 */
async function getOrRefreshSession(connectionId, domain, username, apiKey, currentToken, tokenExpiresAt) {
  console.log(`[IplicitClient] getOrRefreshSession: connection=${connectionId}, domain=${domain}, username=${username}`);

  // Reuse valid token if it expires more than 5 min from now
  // Token must exist AND be fresh — each connection has its own token in the DB
  const expiry = tokenExpiresAt ? new Date(tokenExpiresAt) : null;
  const cutoff = new Date(Date.now() + 5 * 60 * 1000);
  if (expiry && expiry > cutoff && currentToken) {
    console.log(`[IplicitClient] Reusing valid token for ${username} (expires ${tokenExpiresAt})`);
    return { sessionToken: currentToken, tokenExpiry: tokenExpiresAt };
  }

  console.log(`[IplicitClient] Refreshing Iplicit session token for ${username}@${domain}...`);

  if (!domain || !username || !apiKey) {
    throw new Error('Invalid Iplicit credentials: domain, username and apiKey are all required');
  }

  const session = await createSession(domain, username, apiKey);

  // Persist new token to DB — scoped to THIS connection only
  await supabaseAdmin
    .from('platform_integrations')
    .update({
      access_token: session.sessionToken,
      token_expires_at: session.tokenDue,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId);

  console.log(`[IplicitClient] Token refreshed for ${username}, expires ${session.tokenDue}`);
  return { sessionToken: session.sessionToken, tokenExpiry: session.tokenDue };
}

/**
 * Fetch Chart of Accounts from /api/Catalog/Account.
 * Returns a flat array of accounts (no pagination).
 * @param {string} domain
 * @param {string} sessionToken
 * @returns {Promise<Array>}
 */
async function fetchChartOfAccounts(domain, sessionToken) {
  console.log('[IplicitClient] Fetching Chart of Accounts...');

  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/Catalog/Account`, {
    method: 'GET',
    headers: {
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Chart of Accounts (${response.status}): ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch records from an Iplicit Enquiry report.
 * POST /api/Enquiry/run/{enquiryId}/list?top=N
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @param {string} enquiryId
 * @param {object} bodyParams  - optional body params e.g. { PeriodDateFrom, PeriodDateTo, Currency }
 * @param {number} top         - max records (default 1000; use higher for date-range entities)
 * @returns {Promise<Array>}
 */
async function fetchEnquiry(domain, sessionToken, enquiryId, bodyParams = {}, top = 1000) {
  console.log(`[IplicitClient] Fetching Enquiry ${enquiryId} (top=${top})...`);

  const response = await fetchWithRetry(
    `${IPLICIT_API_BASE}/api/Enquiry/run/${enquiryId}/list?top=${top}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Domain': domain,
        'Authorization': `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(bodyParams),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Enquiry ${enquiryId} failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch Legal Entities from /api/LegalEntity.
 * @param {string} domain
 * @param {string} sessionToken
 * @returns {Promise<Array>}
 */
async function fetchLegalEntities(domain, sessionToken) {
  console.log('[IplicitClient] Fetching Legal Entities...');

  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/LegalEntity`, {
    method: 'GET',
    headers: {
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Legal Entities (${response.status}): ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Create a Purchase Invoice in Iplicit.
 * POST /api/PurchaseInvoice
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @param {object} invoiceData - Invoice payload
 * @returns {Promise<object>} - Created invoice response
 */
async function createPurchaseInvoice(domain, sessionToken, invoiceData) {
  console.log('[IplicitClient] Creating Purchase Invoice...', invoiceData);
  
  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/PurchaseInvoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(invoiceData),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[IplicitClient] Create invoice failed:', response.status, text);
    throw new Error(`Failed to create Purchase Invoice (${response.status}): ${text}`);
  }

  const data = await response.json();
  console.log('[IplicitClient] Purchase Invoice created:', data);
  return data;
}

/**
 * Update a Purchase Invoice in Iplicit.
 * PATCH /api/PurchaseInvoice/{invoiceId}
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @param {string} invoiceId - The Iplicit invoice ID
 * @param {object} invoiceData - Updated invoice payload (including details with line item IDs)
 * @returns {Promise<object>} - Updated invoice response
 */
async function updatePurchaseInvoice(domain, sessionToken, invoiceId, invoiceData) {
  console.log('[IplicitClient] Updating Purchase Invoice:', invoiceId, invoiceData);

  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/PurchaseInvoice/${invoiceId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(invoiceData),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[IplicitClient] Update invoice failed:', response.status, text);
    throw new Error(`Failed to update Purchase Invoice (${response.status}): ${text}`);
  }

  // Handle empty response (common for PUT requests)
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      // Response is not JSON, use text as-is
      data = text;
    }
  }

  console.log('[IplicitClient] Purchase Invoice updated:', data || invoiceId);
  return data || { id: invoiceId, success: true };
}

/**
 * Fetch a Purchase Invoice by ID from Iplicit.
 * GET /api/PurchaseInvoice/{invoiceId}
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @param {string} invoiceId - The Iplicit invoice ID
 * @returns {Promise<object>} - Invoice data including details (line items)
 */
async function fetchPurchaseInvoice(domain, sessionToken, invoiceId) {
  console.log('[IplicitClient] Fetching Purchase Invoice:', invoiceId);

  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/PurchaseInvoice/${invoiceId}`, {
    method: 'GET',
    headers: {
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[IplicitClient] Fetch invoice failed:', response.status, text);
    throw new Error(`Failed to fetch Purchase Invoice (${response.status}): ${text}`);
  }

  const data = await response.json();
  console.log('[IplicitClient] Purchase Invoice fetched:', data?.id);
  return data;
}

/**
 * Get suppliers/vendors from Iplicit.
 * GET /api/Supplier
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @returns {Promise<Array>}
 */
async function fetchSuppliers(domain, sessionToken) {
  console.log('[IplicitClient] Fetching Suppliers...');

  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/Supplier`, {
    method: 'GET',
    headers: {
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Suppliers (${response.status}): ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch all products from Iplicit.
 * GET /api/Product
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @returns {Promise<Array>}
 */
async function fetchProducts(domain, sessionToken) {
  console.log('[IplicitClient] Fetching Products...');

  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/Product`, {
    method: 'GET',
    headers: {
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Products (${response.status}): ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Create a Product in Iplicit.
 * POST /api/Product
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @param {object} productData - { code, description, purchase: { accountId, isActive } }
 * @returns {Promise<object>} - Created product response
 */
async function createProduct(domain, sessionToken, productData) {
  console.log('[IplicitClient] Creating Product...', productData);

  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/Product`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(productData),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[IplicitClient] Create product failed:', response.status, text);
    throw new Error(`Failed to create Product (${response.status}): ${text}`);
  }

  const data = await response.json();
  console.log('[IplicitClient] Product created:', data);
  return data;
}

/**
 * Generate product code from description.
 * - Take first 20 characters
 * - Replace spaces with dash (-)
 * - Remove special characters
 * - Convert to uppercase
 *
 * @param {string} description
 * @returns {string}
 */
function generateProductCode(description) {
  if (!description) return 'PRODUCT';

  return description
    .substring(0, 20)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '');
}

/**
 * Create a Contact Account in Iplicit (supplier/vendor).
 * POST /api/ContactAccount
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @param {string} vendorName - The vendor/supplier name to use as description
 * @returns {Promise<string>} - Contact account ID
 */
async function createContactAccount(domain, sessionToken, vendorName) {
  console.log('[IplicitClient] Creating Contact Account:', vendorName);

  const contactAccountData = {
    description: vendorName,
    customer: {
      contactGroupCustomerId: 'CU',
    },
    supplier: {
      contactGroupSupplierId: 'SU',
    },
  };

  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/ContactAccount`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(contactAccountData),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create Contact Account (${response.status}): ${text}`);
  }

  // Iplicit returns the ID directly as string or as object with id
  const contactAccountId = await response.json();
  // const contactAccountId = typeof data === 'string' ? data : data?.id || data;
  // console.log('[IplicitClient] Contact Account created, ID:', contactAccountId);
  return contactAccountId;
}

/**
 * Fetch all Contact Accounts from Iplicit.
 * GET /api/ContactAccount
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @returns {Promise<Array>}
 */
async function fetchContactAccounts(domain, sessionToken) {
  console.log('[IplicitClient] Fetching Contact Accounts...');

  const response = await fetchWithRetry(`${IPLICIT_API_BASE}/api/ContactAccount`, {
    method: 'GET',
    headers: {
      'Domain': domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Contact Accounts (${response.status}): ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch one page from an Iplicit REST endpoint with skip/top pagination.
 * Supports optional date range filtering via query params.
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @param {string} endpoint      — e.g. '/api/Payment'
 * @param {number} skip          — number of records to skip (0-based)
 * @param {number} top           — page size
 * @param {string|null} dateFrom — YYYY-MM-DD
 * @param {string|null} dateTo   — YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function fetchRestApiPaged(domain, sessionToken, endpoint, skip = 0, top = 100, dateFrom = null, dateTo = null) {
  const params = new URLSearchParams({ skip: String(skip), top: String(top) });
  if (dateFrom) params.append('dateFrom', dateFrom);
  if (dateTo)   params.append('dateTo',   dateTo);

  const url = `${IPLICIT_API_BASE}${endpoint}?${params.toString()}`;
  console.log(`[IplicitClient] REST page: ${endpoint} skip=${skip} top=${top}`);

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'Domain':        domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${endpoint} failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : (data?.items || data?.data || []);
}

/**
 * Fetch a single record by ID from an Iplicit REST endpoint.
 * Used to retrieve detail responses including allocations[].
 *
 * @param {string} domain
 * @param {string} sessionToken
 * @param {string} endpoint  — e.g. '/api/Payment'
 * @param {string} id        — Iplicit API UUID
 * @returns {Promise<object>}
 */
async function fetchRestApiById(domain, sessionToken, endpoint, id) {
  const url = `${IPLICIT_API_BASE}${endpoint}/${id}`;
  console.log(`[IplicitClient] GET ${endpoint}/${id}`);

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'Domain':        domain,
      'Authorization': `Bearer ${sessionToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${endpoint}/${id} failed (${response.status}): ${text}`);
  }

  return response.json();
}

module.exports = {
  createSession,
  getOrRefreshSession,
  fetchEnquiry,
  fetchChartOfAccounts,
  fetchLegalEntities,
  fetchRestApiPaged,
  fetchRestApiById,
  createPurchaseInvoice,
  updatePurchaseInvoice,
  fetchPurchaseInvoice,
  fetchSuppliers,
  fetchProducts,
  createProduct,
  generateProductCode,
  createContactAccount,
  fetchContactAccounts,
};
