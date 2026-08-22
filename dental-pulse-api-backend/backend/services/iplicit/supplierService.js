/**
 * Iplicit Supplier Service
 *
 * Fetches a single supplier from Iplicit by ContactAccountId and upserts
 * it into the iplicit_suppliers table.
 *
 * Intended for use by the invoice push mechanism — when creating/pushing
 * an invoice to Iplicit, call fetchAndSyncSupplier() first to ensure the
 * supplier exists locally before referencing it.
 *
 * Usage:
 *   const { fetchAndSyncSupplier } = require('./supplierService');
 *   const supplier = await fetchAndSyncSupplier(organizationId, supplierId);
 */

const { supabaseAdmin } = require('../../config/supabase');
const { getOrRefreshSession, fetchEnquiry } = require('../../api/iplicit/client');
const { transformRecord } = require('../transformers/iplicit');
const { ENQUIRY_IDS } = require('../../api/iplicit/config');

/**
 * Fetch a single supplier from Iplicit by ContactAccountId and upsert into DB.
 *
 * @param {string} organizationId  — our org UUID
 * @param {string} supplierId      — Iplicit ContactAccountId (e.g. "SUP-001")
 * @param {string|null} connectionId — optional platform_integrations.id to target a specific connection
 * @returns {Promise<object>}      — the upserted supplier row from iplicit_suppliers
 * @throws if credentials are missing, API call fails, or supplier not found
 */
async function fetchAndSyncSupplier(organizationId, supplierId, connectionId = null) {
  if (!organizationId) throw new Error('organizationId is required');
  if (!supplierId)     throw new Error('supplierId (ContactAccountId) is required');

  // ── 1. Load Iplicit credentials ─────────────────────────────────────────────
  let connQuery = supabaseAdmin
    .from('platform_integrations')
    .select('id, client_id, username, client_secret, access_token, token_expires_at, is_connected')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'iplicit')
    .eq('is_connected', true);

  if (connectionId) {
    connQuery = connQuery.eq('id', connectionId);
  }

  const { data: connections, error: connErr } = await connQuery.limit(1);

  const connection = connections?.[0] || null;

  if (connErr || !connection) {
    throw new Error(`No active Iplicit connection found for organization ${organizationId}`);
  }

  const domain   = connection.client_id;
  const apiKey   = connection.client_secret;
  const username = connection.username;

  if (!domain || !username || !apiKey) {
    throw new Error('Iplicit connection is missing domain, username or API key');
  }

  // ── 2. Get / refresh session token ──────────────────────────────────────────
  const { sessionToken } = await getOrRefreshSession(
    connection.id,
    domain,
    username,
    apiKey,
    connection.access_token,
    connection.token_expires_at,
  );

  // ── 3. Fetch supplier from Enquiry API filtered by ContactAccountId ──────────
  console.log(`[SupplierService] Fetching supplier ${supplierId} for org ${organizationId}`);

  const records = await fetchEnquiry(
    domain,
    sessionToken,
    ENQUIRY_IDS.iplicit_suppliers,
    { ContactAccountId: supplierId },
    10, // only expecting 1 record
  );

  if (!records || records.length === 0) {
    throw new Error(`Supplier "${supplierId}" not found in Iplicit`);
  }

  // Use the first match (ContactAccountId should be unique)
  const raw = records[0];

  // ── 4. Transform ─────────────────────────────────────────────────────────────
  const ctx = {
    organizationId,
    userId:                 null, // no user context in background service calls
    platformIntegrationId:  connection.id,
  };

  const transformed = transformRecord('iplicit_suppliers', raw, ctx);

  if (!transformed) {
    throw new Error(`Failed to transform supplier record for ContactAccountId "${supplierId}"`);
  }

  // ── 5. Upsert into iplicit_suppliers ─────────────────────────────────────────
  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from('iplicit_suppliers')
    .upsert(transformed, {
      onConflict:       'organization_id,platform_integration_id,contact_account_id',
      ignoreDuplicates: false,
    })
    .select()
    .single();

  if (upsertErr) {
    throw new Error(`Failed to upsert supplier: ${upsertErr.message}`);
  }

  console.log(`[SupplierService] Supplier "${supplierId}" synced (id: ${upserted.id})`);
  return upserted;
}

module.exports = { fetchAndSyncSupplier };
