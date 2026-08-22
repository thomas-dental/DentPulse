/**
 * Sage Supplier Service
 *
 * Fetches all VENDOR contacts from Sage Business Cloud Accounting and upserts
 * them into the sage_suppliers table.
 *
 * Mirrors the iplicit/supplierService.js pattern — paged fetch + transformer +
 * batch upsert. Sage paginates via $next URL; we follow until $next is null.
 *
 * Usage:
 *   const { syncAllSuppliers } = require('./supplierService');
 *   const result = await syncAllSuppliers(organizationId);
 *   // → { upserted, skipped_non_vendor, total_pages }
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');
const { transformRecord } = require('../transformers/sage');

const ITEMS_PER_PAGE = 200;
const UPSERT_BATCH   = 100;

/**
 * Sync all Sage suppliers for an organization.
 *
 * @param {string} organizationId — our org UUID
 * @param {string|null} userId    — optional user UUID who triggered this sync
 * @param {string|null} connectionId — specific platform_integrations.id (if multiple)
 * @returns {Promise<{ upserted: number, skipped_non_vendor: number, total_pages: number, total_fetched: number }>}
 */
async function syncAllSuppliers(organizationId, userId = null, connectionId = null) {
  if (!organizationId) throw new Error('organizationId is required');

  // ── 1. Load Sage integration ───────────────────────────────────────────────
  let connQuery = supabaseAdmin
    .from('platform_integrations')
    .select('id, access_token, refresh_token, token_expires_at, is_connected')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'sage')
    .eq('is_connected', true);

  if (connectionId) connQuery = connQuery.eq('id', connectionId);

  const { data: connections, error: connErr } = await connQuery.limit(1);
  const integration = connections?.[0];

  if (connErr) throw new Error(`Failed to load Sage integration: ${connErr.message}`);
  if (!integration) throw new Error(`No active Sage connection for organization ${organizationId}`);

  const ctx = {
    organizationId,
    userId,
    platformIntegrationId: integration.id,
  };

  // ── 2. Page through /contacts?attributes=all ───────────────────────────────
  let page = 1;
  let totalFetched   = 0;
  let totalUpserted  = 0;
  let totalSkipped   = 0;
  let totalPages     = 0;
  let hasNextPage    = true;

  while (hasNextPage) {
    console.log(`[SageSupplierService] Fetching contacts page ${page} (${ITEMS_PER_PAGE}/page)...`);
    const response = await sageClient.sageGet(integration, '/contacts', {
      attributes:     'all',
      items_per_page: ITEMS_PER_PAGE,
      page,
    });

    const items = response?.$items || [];
    totalFetched += items.length;
    totalPages    = page;

    // Transform + filter to suppliers only (VENDOR contact_type)
    const supplierRows = [];
    for (const raw of items) {
      const row = transformRecord('sage_suppliers', raw, ctx);
      if (!row) continue;
      if (!row.is_vendor) {
        totalSkipped++;
        continue;
      }
      supplierRows.push(row);
    }

    // Batch upsert
    for (let i = 0; i < supplierRows.length; i += UPSERT_BATCH) {
      const batch = supplierRows.slice(i, i + UPSERT_BATCH);
      const { error: upsertErr, count } = await supabaseAdmin
        .from('sage_suppliers')
        .upsert(batch, {
          onConflict:       'organization_id,platform_integration_id,sage_contact_id',
          ignoreDuplicates: false,
          count:            'exact',
        });

      if (upsertErr) {
        throw new Error(`Failed to upsert sage_suppliers batch (page ${page}, batch ${i}): ${upsertErr.message}`);
      }
      totalUpserted += (count ?? batch.length);
      console.log(`[SageSupplierService] Upserted batch of ${batch.length} (running total: ${totalUpserted})`);
    }

    hasNextPage = Boolean(response?.$next);
    page++;

    // Safety cap to prevent runaway loop
    if (page > 1000) {
      console.warn('[SageSupplierService] Stopping at 1000 pages — safety cap reached');
      break;
    }
  }

  console.log(`[SageSupplierService] Sync complete: ${totalUpserted} suppliers upserted, ${totalSkipped} non-vendors skipped (${totalFetched} total contacts across ${totalPages} pages)`);

  return {
    upserted:           totalUpserted,
    skipped_non_vendor: totalSkipped,
    total_fetched:      totalFetched,
    total_pages:        totalPages,
  };
}

module.exports = {
  syncAllSuppliers,
};
