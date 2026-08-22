/**
 * Sage Attachments Service
 *
 * File attachments (PDFs, images) on invoices etc.
 * Source: /attachments?attributes=all → sage_attachments table.
 *
 * The attachment row records metadata + a download URL when available.
 * Actually downloading the file content is out of scope for this sync
 * (would be done at runtime when a user clicks "view attachment").
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');
const { transformRecord } = require('../transformers/sage');

const ITEMS_PER_PAGE = 200;
const UPSERT_BATCH   = 100;

async function syncAllAttachments(organizationId, userId = null, connectionId = null) {
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

  let page = 1, totalFetched = 0, totalUpserted = 0, totalPages = 0, hasNextPage = true;

  while (hasNextPage) {
    console.log(`[SageAttachmentService] Fetching attachments page ${page}...`);

    let response;
    try {
      response = await sageClient.sageGet(integration, '/attachments', {
        attributes: 'all', items_per_page: ITEMS_PER_PAGE, page,
      });
    } catch (err) {
      if (err && /404|PathNotFound/i.test(err.message)) {
        console.warn('[SageAttachmentService] /attachments not available — skipping');
        return { upserted: 0, total_fetched: 0, total_pages: 0, skipped: true };
      }
      throw err;
    }

    const items = response?.$items || [];
    totalFetched += items.length;
    totalPages    = page;

    const rows = [];
    for (const raw of items) {
      const row = transformRecord('sage_attachments', raw, ctx);
      if (row) rows.push(row);
    }

    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const batch = rows.slice(i, i + UPSERT_BATCH);
      const { error: upsertErr, count } = await supabaseAdmin
        .from('sage_attachments')
        .upsert(batch, {
          onConflict: 'organization_id,platform_integration_id,sage_attachment_id',
          ignoreDuplicates: false,
          count: 'exact',
        });
      if (upsertErr) throw new Error(`Failed to upsert attachments batch: ${upsertErr.message}`);
      totalUpserted += (count ?? batch.length);
    }

    hasNextPage = Boolean(response?.$next);
    page++;
    if (page > 1000) break;
  }

  console.log(`[SageAttachmentService] Sync complete: ${totalUpserted} upserted (${totalFetched} fetched)`);
  return { upserted: totalUpserted, total_fetched: totalFetched, total_pages: totalPages };
}

module.exports = { syncAllAttachments };
