/**
 * Sage Bank Accounts Service
 *
 * Fetches all bank accounts from Sage Business Cloud Accounting and upserts
 * them into the sage_bank_accounts table.
 *
 * Mirrors supplierService.js — paged fetch + transformer + batch upsert.
 *
 * Usage:
 *   const { syncAllBankAccounts } = require('./bankAccountService');
 *   const result = await syncAllBankAccounts(organizationId);
 *   // → { upserted, total_pages, total_fetched }
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');
const { transformRecord } = require('../transformers/sage');

const ITEMS_PER_PAGE = 200;
const UPSERT_BATCH   = 100;

async function syncAllBankAccounts(organizationId, userId = null, connectionId = null, businessId = null) {
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

  // Multi-business: sync EVERY business the token can access (X-Business header
  // per request), unless a specific businessId was requested. `null` = lead business.
  const targets = await resolveBusinessTargets(integration, businessId);

  let totalFetched  = 0;
  let totalUpserted = 0;
  let totalPages    = 0;

  for (const bizId of targets) {
    const ctx = { organizationId, userId, platformIntegrationId: integration.id, businessId: bizId };
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      console.log(`[SageBankAccountService] business ${bizId || 'lead'} — bank_accounts page ${page}...`);
      const response = await sageClient.sageGet(integration, '/bank_accounts', {
        attributes:     'all',
        items_per_page: ITEMS_PER_PAGE,
        page,
      }, bizId);

      const items = response?.$items || [];
      totalFetched += items.length;
      totalPages   += 1;

      const rows = [];
      for (const raw of items) {
        const row = transformRecord('sage_bank_accounts', raw, ctx);
        if (row) rows.push(row);
      }

      for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
        const batch = rows.slice(i, i + UPSERT_BATCH);
        const { error: upsertErr, count } = await supabaseAdmin
          .from('sage_bank_accounts')
          .upsert(batch, {
            onConflict:       'organization_id,platform_integration_id,sage_bank_account_id',
            ignoreDuplicates: false,
            count:            'exact',
          });

        if (upsertErr) {
          throw new Error(`Failed to upsert sage_bank_accounts batch (page ${page}, batch ${i}): ${upsertErr.message}`);
        }
        totalUpserted += (count ?? batch.length);
      }

      hasNextPage = Boolean(response?.$next);
      page++;
      if (page > 1000) {
        console.warn('[SageBankAccountService] Stopping at 1000 pages — safety cap reached');
        break;
      }
    }
  }

  console.log(`[SageBankAccountService] Sync complete: ${totalUpserted} bank accounts upserted across ${targets.length} business(es)`);

  return {
    upserted:      totalUpserted,
    total_fetched: totalFetched,
    total_pages:   totalPages,
    businesses:    targets.length,
  };
}

/**
 * Resolve which Sage businesses to sync. If `businessId` is given, sync only
 * that one. Otherwise list all businesses on the token; falls back to [null]
 * (lead business) if listing fails or returns none.
 */
async function resolveBusinessTargets(integration, businessId) {
  if (businessId) return [businessId];
  const ids = (await sageClient.fetchBusinesses(integration)).map(b => b.id).filter(Boolean);
  return ids.length ? ids : [null];
}

module.exports = {
  syncAllBankAccounts,
};
