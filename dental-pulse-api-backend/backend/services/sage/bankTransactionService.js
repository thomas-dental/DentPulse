/**
 * Sage Bank Transactions Service
 *
 * Fetches all bank transactions from Sage Business Cloud Accounting and upserts
 * them into the sage_bank_transactions table. FK to sage_bank_accounts via
 * bank_account_id (Sage GUID, not a Supabase UUID).
 *
 * Mirrors supplierService.js — paged fetch + transformer + batch upsert.
 *
 * Usage:
 *   const { syncAllBankTransactions } = require('./bankTransactionService');
 *   const result = await syncAllBankTransactions(organizationId);
 *   // → { upserted, total_pages, total_fetched }
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');
const { transformRecord } = require('../transformers/sage');

const ITEMS_PER_PAGE = 200;
const UPSERT_BATCH   = 100;

async function syncAllBankTransactions(organizationId, userId = null, connectionId = null) {
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

  const ctx = {
    organizationId,
    userId,
    platformIntegrationId: integration.id,
  };

  // Sage has NO single "bank_transactions" endpoint that maps cleanly to all
  // bank-affecting movements. The cleanest available global endpoint that
  // returns bank-side transactions is `/contact_payments` (supplier payments +
  // customer receipts, both of which affect a bank account).
  //
  // If a tenant has no payments yet, the call returns an empty $items array —
  // not a 404. If the endpoint itself isn't enabled on this tenant's plan we
  // catch and skip gracefully so the rest of Sync Now still succeeds.
  let page = 1;
  let totalFetched  = 0;
  let totalUpserted = 0;
  let totalPages    = 0;
  let hasNextPage   = true;

  try {
    while (hasNextPage) {
      console.log(`[SageBankTxnService] Fetching /contact_payments page ${page} (${ITEMS_PER_PAGE}/page)...`);
      const response = await sageClient.sageGet(integration, '/contact_payments', {
        attributes:     'all',
        items_per_page: ITEMS_PER_PAGE,
        page,
      });

      const items = response?.$items || [];
      totalFetched += items.length;
      totalPages    = page;

      const rows = [];
      for (const raw of items) {
        const row = transformRecord('sage_bank_transactions', raw, ctx);
        if (row) rows.push(row);
      }

      for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
        const batch = rows.slice(i, i + UPSERT_BATCH);
        const { error: upsertErr, count } = await supabaseAdmin
          .from('sage_bank_transactions')
          .upsert(batch, {
            onConflict:       'organization_id,platform_integration_id,sage_bank_transaction_id',
            ignoreDuplicates: false,
            count:            'exact',
          });

        if (upsertErr) {
          throw new Error(`Failed to upsert sage_bank_transactions batch (page ${page}, batch ${i}): ${upsertErr.message}`);
        }
        totalUpserted += (count ?? batch.length);
      }

      hasNextPage = Boolean(response?.$next);
      page++;
      if (page > 1000) {
        console.warn('[SageBankTxnService] Stopping at 1000 pages — safety cap reached');
        break;
      }
    }
  } catch (err) {
    // Endpoint not available on this Sage plan / tenant — log and skip, don't
    // fail the whole Sync Now flow.
    if (String(err.message).includes('404') || String(err.message).toLowerCase().includes('not found')) {
      console.warn(`[SageBankTxnService] /contact_payments not available on this tenant — skipping. (${err.message})`);
      return { upserted: 0, total_fetched: 0, total_pages: 0, skipped: true };
    }
    throw err;
  }

  console.log(`[SageBankTxnService] Sync complete: ${totalUpserted} txns upserted (${totalFetched} fetched across ${totalPages} pages)`);

  return {
    upserted:      totalUpserted,
    total_fetched: totalFetched,
    total_pages:   totalPages,
  };
}

module.exports = {
  syncAllBankTransactions,
};
