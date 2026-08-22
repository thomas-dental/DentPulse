/**
 * Sage Products + Services Service
 *
 * Syncs BOTH `/products` and `/services` endpoints into the shared
 * `sage_products` table. The `product_type` column distinguishes them.
 *
 * If either endpoint returns 404, that part is skipped gracefully.
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');
const { transformRecord } = require('../transformers/sage');

const ITEMS_PER_PAGE = 200;
const UPSERT_BATCH   = 100;

async function fetchPaged(integration, ctx, sagePath, productType) {
  let page = 1, totalFetched = 0, totalUpserted = 0, totalPages = 0, hasNextPage = true;

  while (hasNextPage) {
    console.log(`[SageProductService] Fetching ${sagePath} page ${page}...`);

    let response;
    try {
      response = await sageClient.sageGet(integration, sagePath, {
        attributes: 'all', items_per_page: ITEMS_PER_PAGE, page,
      });
    } catch (err) {
      if (err && /404|PathNotFound/i.test(err.message)) {
        console.warn(`[SageProductService] ${sagePath} not available — skipping`);
        return { upserted: 0, total_fetched: 0, total_pages: 0, skipped: true };
      }
      throw err;
    }

    const items = response?.$items || [];
    totalFetched += items.length;
    totalPages    = page;

    const rows = [];
    for (const raw of items) {
      raw._productType = productType;
      const row = transformRecord('sage_products', raw, { ...ctx, productType });
      if (row) rows.push(row);
    }

    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const batch = rows.slice(i, i + UPSERT_BATCH);
      const { error: upsertErr, count } = await supabaseAdmin
        .from('sage_products')
        .upsert(batch, {
          onConflict: 'organization_id,platform_integration_id,sage_product_id',
          ignoreDuplicates: false,
          count: 'exact',
        });
      if (upsertErr) throw new Error(`Failed to upsert ${sagePath} batch: ${upsertErr.message}`);
      totalUpserted += (count ?? batch.length);
    }

    hasNextPage = Boolean(response?.$next);
    page++;
    if (page > 1000) break;
  }

  return { upserted: totalUpserted, total_fetched: totalFetched, total_pages: totalPages };
}

async function syncAllProducts(organizationId, userId = null, connectionId = null) {
  if (!organizationId) throw new Error('organizationId is required');

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

  const ctx = { organizationId, userId, platformIntegrationId: integration.id };

  const products = await fetchPaged(integration, ctx, '/products', 'product');
  const services = await fetchPaged(integration, ctx, '/services', 'service');

  const result = {
    upserted:      (products.upserted || 0)      + (services.upserted || 0),
    total_fetched: (products.total_fetched || 0) + (services.total_fetched || 0),
    total_pages:   (products.total_pages || 0)   + (services.total_pages || 0),
    products:      products.upserted || 0,
    services:      services.upserted || 0,
  };
  console.log(`[SageProductService] Sync complete: ${result.upserted} total (${result.products} products + ${result.services} services)`);
  return result;
}

module.exports = { syncAllProducts };
