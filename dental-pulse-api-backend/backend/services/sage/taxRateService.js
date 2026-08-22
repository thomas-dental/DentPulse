/**
 * Sage Tax Rates Service
 *
 * Fetches all tax rates from Sage Business Cloud Accounting and upserts
 * them into the dedicated `sage_tax_rates` table.
 *
 * Tax rates are a small lookup set (typically 4-6 rows for UK VAT) —
 * pagination still supported for safety but rarely needed.
 *
 * Usage:
 *   const { syncAllTaxRates } = require('./taxRateService');
 *   const result = await syncAllTaxRates(organizationId);
 *   // → { upserted, total_fetched, total_pages }
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');
const { transformRecord } = require('../transformers/sage');

const ITEMS_PER_PAGE = 200;
const UPSERT_BATCH   = 100;

async function syncAllTaxRates(organizationId, userId = null, connectionId = null, businessId = null) {
  if (!organizationId) throw new Error('organizationId is required');

  // Load Sage integration
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

  // Multi-business: sync each business (X-Business header per request).
  const targets = businessId
    ? [businessId]
    : ((await sageClient.fetchBusinesses(integration)).map(b => b.id).filter(Boolean) || []);
  const businesses = targets.length ? targets : [null]; // null = lead business

  let totalFetched  = 0;
  let totalUpserted = 0;
  let totalPages    = 0;

  for (const bizId of businesses) {
    const ctx = { organizationId, userId, platformIntegrationId: integration.id, businessId: bizId };

    // Page through /tax_rates?attributes=all for this business
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      console.log(`[SageTaxRateService] business ${bizId || 'lead'} — tax_rates page ${page}...`);

      let response;
      try {
        response = await sageClient.sageGet(integration, '/tax_rates', {
          attributes:     'all',
          items_per_page: ITEMS_PER_PAGE,
          page,
        }, bizId);
      } catch (err) {
        // Graceful skip if endpoint not available on this Sage plan
        if (err && /404|PathNotFound/i.test(err.message)) {
          console.warn('[SageTaxRateService] /tax_rates endpoint not available on this plan — skipping business');
          break;
        }
        throw err;
      }

      const items = response?.$items || [];
      totalFetched += items.length;
      totalPages   += 1;

      const rows = [];
      for (const raw of items) {
        const row = transformRecord('sage_tax_rates', raw, ctx);
        if (row) rows.push(row);
      }

      for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
        const batch = rows.slice(i, i + UPSERT_BATCH);
        const { error: upsertErr, count } = await supabaseAdmin
          .from('sage_tax_rates')
          .upsert(batch, {
            onConflict:       'organization_id,platform_integration_id,sage_tax_rate_id',
            ignoreDuplicates: false,
            count:            'exact',
          });

        if (upsertErr) {
          throw new Error(`Failed to upsert tax_rates batch (page ${page}, batch ${i}): ${upsertErr.message}`);
        }
        totalUpserted += (count ?? batch.length);
      }

      hasNextPage = Boolean(response?.$next);
      page++;

      if (page > 1000) {
        console.warn('[SageTaxRateService] Stopping at 1000 pages — safety cap reached');
        break;
      }
    }
  }

  console.log(`[SageTaxRateService] Sync complete: ${totalUpserted} tax rates upserted across ${businesses.length} business(es)`);

  return {
    upserted:      totalUpserted,
    total_fetched: totalFetched,
    total_pages:   totalPages,
    businesses:    businesses.length,
  };
}

module.exports = {
  syncAllTaxRates,
};
