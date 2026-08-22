/**
 * Sage Journals Service
 *
 * Fetches all manual journal entries from Sage with lines inline
 * (`attributes=all` expands `journal_lines[]`), then upserts:
 *   - Header → sage_journals
 *   - Lines  → sage_journal_lines (DELETE+INSERT per journal)
 *
 * Mirrors invoiceService.js / creditNoteService.js pattern.
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');
const { transformRecord } = require('../transformers/sage');

const ITEMS_PER_PAGE = 100;
const HEADER_BATCH   = 50;
const LINE_BATCH     = 200;

async function syncAllJournals(organizationId, userId = null, connectionId = null) {
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

  let page = 1;
  let totalFetched         = 0;
  let totalHeadersUpserted = 0;
  let totalLinesInserted   = 0;
  let totalPages           = 0;
  let hasNextPage          = true;

  while (hasNextPage) {
    console.log(`[SageJournalService] Fetching journals page ${page} (${ITEMS_PER_PAGE}/page)...`);

    let response;
    try {
      response = await sageClient.sageGet(integration, '/journals', {
        attributes:     'all',
        items_per_page: ITEMS_PER_PAGE,
        page,
      });
    } catch (err) {
      if (err && /404|PathNotFound/i.test(err.message)) {
        console.warn('[SageJournalService] /journals endpoint not available — skipping');
        return { headers_upserted: 0, lines_inserted: 0, total_fetched: 0, total_pages: 0, skipped: true };
      }
      throw err;
    }

    const items = response?.$items || [];
    totalFetched += items.length;
    totalPages    = page;

    const transformed = [];
    for (const raw of items) {
      const t = transformRecord('sage_journals', raw, ctx);
      if (t && t.header) transformed.push(t);
    }

    if (transformed.length === 0) {
      hasNextPage = Boolean(response?.$next);
      page++;
      continue;
    }

    // Step A: Upsert journal headers
    const sageToJournalId = new Map();

    for (let i = 0; i < transformed.length; i += HEADER_BATCH) {
      const headerBatch = transformed.slice(i, i + HEADER_BATCH).map(t => t.header);

      const { data: upserted, error: upsertErr } = await supabaseAdmin
        .from('sage_journals')
        .upsert(headerBatch, {
          onConflict:       'organization_id,platform_integration_id,sage_journal_id',
          ignoreDuplicates: false,
        })
        .select('id, sage_journal_id');

      if (upsertErr) {
        throw new Error(`Failed to upsert journal headers (page ${page}, batch ${i}): ${upsertErr.message}`);
      }

      (upserted || []).forEach(row => sageToJournalId.set(row.sage_journal_id, row.id));
      totalHeadersUpserted += headerBatch.length;
    }

    // Step B: For each journal, replace its lines
    const journalIdsForReplace = [];
    const newLines             = [];

    for (const { header, lines } of transformed) {
      const journalId = sageToJournalId.get(header.sage_journal_id);
      if (!journalId) {
        console.warn(`[SageJournalService] Could not resolve journal_id for sage_journal_id ${header.sage_journal_id}, skipping its lines`);
        continue;
      }
      journalIdsForReplace.push(journalId);
      for (const line of lines) {
        newLines.push({ ...line, journal_id: journalId });
      }
    }

    if (journalIdsForReplace.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from('sage_journal_lines')
        .delete()
        .in('journal_id', journalIdsForReplace);

      if (delErr) {
        throw new Error(`Failed to delete old journal lines (page ${page}): ${delErr.message}`);
      }
    }

    for (let i = 0; i < newLines.length; i += LINE_BATCH) {
      const batch = newLines.slice(i, i + LINE_BATCH);
      const { error: lineErr } = await supabaseAdmin
        .from('sage_journal_lines')
        .insert(batch);

      if (lineErr) {
        throw new Error(`Failed to insert journal lines batch (page ${page}, batch ${i}): ${lineErr.message}`);
      }
      totalLinesInserted += batch.length;
    }

    console.log(`[SageJournalService] Page ${page}: ${transformed.length} headers, ${newLines.length} lines processed`);

    hasNextPage = Boolean(response?.$next);
    page++;

    if (page > 1000) {
      console.warn('[SageJournalService] Stopping at 1000 pages — safety cap reached');
      break;
    }
  }

  console.log(`[SageJournalService] Sync complete: ${totalHeadersUpserted} headers, ${totalLinesInserted} lines (${totalFetched} fetched across ${totalPages} pages)`);

  return {
    headers_upserted: totalHeadersUpserted,
    lines_inserted:   totalLinesInserted,
    total_fetched:    totalFetched,
    total_pages:      totalPages,
  };
}

module.exports = {
  syncAllJournals,
};
