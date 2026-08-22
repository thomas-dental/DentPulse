/**
 * Sage Contact Persons enrichment service.
 *
 * Fetches /contact_persons from Sage and patches the existing sage_suppliers
 * rows with telephone / mobile / fax (currently NULL because the supplier sync
 * can't get these from /contacts alone).
 *
 * Does NOT create a new table — uses existing sage_suppliers columns.
 *
 * Usage:
 *   const { syncAllContactPersons } = require('./contactPersonService');
 *   const result = await syncAllContactPersons(organizationId);
 *   // → { updated, fetched, total_pages }
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');

const ITEMS_PER_PAGE = 200;

async function syncAllContactPersons(organizationId, userId = null, connectionId = null) {
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

  // Per contact_id, store best contact_person (prefer is_main_contact=true).
  // Map<sage_contact_id, { telephone, mobile, fax, contact_name, isMain }>
  const bestByContact = new Map();

  let page = 1;
  let totalFetched = 0;
  let totalPages   = 0;
  let hasNextPage  = true;

  while (hasNextPage) {
    console.log(`[SageContactPersonService] Fetching contact_persons page ${page} (${ITEMS_PER_PAGE}/page)...`);
    const response = await sageClient.sageGet(integration, '/contact_persons', {
      attributes:     'all',
      items_per_page: ITEMS_PER_PAGE,
      page,
    });

    const items = response?.$items || [];
    totalFetched += items.length;
    totalPages    = page;

    for (const cp of items) {
      const parentContactId = cp.contact?.id;
      if (!parentContactId) continue;

      const isMain  = Boolean(cp.is_main_contact);
      const current = bestByContact.get(parentContactId);

      // Skip if we already have a main contact for this parent and this one isn't.
      if (current?.isMain && !isMain) continue;

      bestByContact.set(parentContactId, {
        telephone:    cp.telephone || null,
        mobile:       cp.mobile    || null,
        fax:          cp.fax       || null,
        contact_name: cp.name || cp.displayed_as || null,
        isMain,
      });
    }

    hasNextPage = Boolean(response?.$next);
    page++;
    if (page > 1000) {
      console.warn('[SageContactPersonService] Stopping at 1000 pages — safety cap reached');
      break;
    }
  }

  // Apply updates to sage_suppliers. One UPDATE per parent contact_id —
  // batch UPDATE with different WHERE per row isn't supported by supabase-js.
  let totalUpdated = 0;
  const nowIso     = new Date().toISOString();

  for (const [parentContactId, enrich] of bestByContact.entries()) {
    // Only set fields that are non-null so we never overwrite real data with null.
    const update = { last_synced_at: nowIso };
    if (enrich.telephone)    update.telephone    = enrich.telephone;
    if (enrich.mobile)       update.mobile       = enrich.mobile;
    if (enrich.fax)          update.fax          = enrich.fax;
    if (enrich.contact_name) update.contact_name = enrich.contact_name;

    if (Object.keys(update).length === 1) continue; // only last_synced_at — nothing to patch

    const { data, error } = await supabaseAdmin
      .from('sage_suppliers')
      .update(update)
      .eq('organization_id',         organizationId)
      .eq('platform_integration_id', integration.id)
      .eq('sage_contact_id',         parentContactId)
      .select('id');

    if (error) {
      console.warn(`[SageContactPersonService] Update failed for contact ${parentContactId}: ${error.message}`);
      continue;
    }
    totalUpdated += data?.length || 0;
  }

  console.log(`[SageContactPersonService] Sync complete: ${totalUpdated} suppliers enriched (${totalFetched} contact_persons fetched across ${totalPages} pages, ${bestByContact.size} unique parents)`);

  return {
    updated:       totalUpdated,
    fetched:       totalFetched,
    unique_parents: bestByContact.size,
    total_pages:   totalPages,
  };
}

module.exports = {
  syncAllContactPersons,
};
