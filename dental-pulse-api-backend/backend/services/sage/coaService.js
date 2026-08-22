/**
 * Sage Chart of Accounts (Ledger Accounts) Service
 *
 * Fetches all ledger accounts from Sage Business Cloud Accounting and upserts
 * them into the dedicated `sage_chart_of_accounts` table.
 *
 * Same pattern as supplierService.js — paged fetch + transformer + batch upsert.
 * Sage paginates via $next URL; we loop until $next is null.
 *
 * Usage:
 *   const { syncAllCoaAccounts } = require('./coaService');
 *   const result = await syncAllCoaAccounts(organizationId);
 *   // → { upserted, total_pages, total_fetched }
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');
const { transformRecord } = require('../transformers/sage');

const ITEMS_PER_PAGE = 200;
const UPSERT_BATCH   = 100;

/**
 * Sync all Sage ledger accounts (chart of accounts) for an organization.
 *
 * @param {string} organizationId
 * @param {string|null} userId
 * @param {string|null} connectionId
 * @returns {Promise<{ upserted: number, total_fetched: number, total_pages: number }>}
 */
async function syncAllCoaAccounts(organizationId, userId = null, connectionId = null, businessId = null) {
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

    // Page through /ledger_accounts?attributes=all for this business
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      console.log(`[SageCoaService] business ${bizId || 'lead'} — ledger_accounts page ${page}...`);
      const response = await sageClient.sageGet(integration, '/ledger_accounts', {
        attributes:     'all',
        items_per_page: ITEMS_PER_PAGE,
        page,
      }, bizId);

      const items = response?.$items || [];
      totalFetched += items.length;
      totalPages   += 1;

      // Transform
      const rows = [];
      for (const raw of items) {
        const row = transformRecord('sage_chart_of_accounts', raw, ctx);
        if (row) rows.push(row);
      }

      // Batch upsert
      for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
        const batch = rows.slice(i, i + UPSERT_BATCH);
        const { error: upsertErr, count } = await supabaseAdmin
          .from('sage_chart_of_accounts')
          .upsert(batch, {
            onConflict:       'organization_id,platform_integration_id,sage_account_id',
            ignoreDuplicates: false,
            count:            'exact',
          });

        if (upsertErr) {
          throw new Error(`Failed to upsert COA batch (page ${page}, batch ${i}): ${upsertErr.message}`);
        }
        totalUpserted += (count ?? batch.length);
      }

      hasNextPage = Boolean(response?.$next);
      page++;

      // Safety cap
      if (page > 1000) {
        console.warn('[SageCoaService] Stopping at 1000 pages — safety cap reached');
        break;
      }
    }
  }

  console.log(`[SageCoaService] Sync complete: ${totalUpserted} COA accounts upserted across ${businesses.length} business(es)`);

  return {
    upserted:      totalUpserted,
    total_fetched: totalFetched,
    total_pages:   totalPages,
    businesses:    businesses.length,
  };
}

module.exports = {
  syncAllCoaAccounts,
};
