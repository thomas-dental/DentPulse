/**
 * Sage Purchase Invoice (Bills) Service
 *
 * Fetches all purchase invoices from Sage with line items inline
 * (`attributes=all` expands `invoice_lines[]`), then upserts:
 *   - Header → sage_invoices  (dedicated)
 *   - Lines  → sage_invoice_line_items  (dedicated)
 *
 * Re-sync strategy:
 *   - Header: UPSERT on (organization_id, platform_integration_id, sage_invoice_id)
 *   - Lines:  DELETE existing rows for the invoice_id, then INSERT fresh
 *     (Sage line IDs are stable but line counts can change, so full replace
 *     is safest and matches Xero's behaviour)
 *
 * Usage:
 *   const { syncAllPurchaseInvoices } = require('./invoiceService');
 *   const result = await syncAllPurchaseInvoices(organizationId);
 */

const { supabaseAdmin } = require('../../config/supabase');
const sageClient        = require('../../api/sage/client');
const { transformRecord } = require('../transformers/sage');

const ITEMS_PER_PAGE = 100;
const HEADER_BATCH   = 50;
const LINE_BATCH     = 200;

async function syncAllPurchaseInvoices(organizationId, userId = null, connectionId = null) {
  if (!organizationId) throw new Error('organizationId is required');

  // ── Load Sage integration ──────────────────────────────────────────────────
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

  // Resolve the practice location for this Sage connection from the Practice
  // Location Mapping (business → location). Sage purchase invoices are fetched
  // connection-wide here, so we can only stamp a location when the connection
  // maps to exactly one (the common 1 business → 1 practice case); otherwise we
  // leave it null and the frontend resolves per-business via sage_business_id.
  let resolvedLocationId = null;
  try {
    const { data: orgs } = await supabaseAdmin
      .from('platform_integration_organizations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform_integration_id', integration.id)
      .eq('platform_name', 'sage');
    const orgIds = (orgs || []).map(o => String(o.id));
    if (orgIds.length > 0) {
      const { data: maps } = await supabaseAdmin
        .from('platform_integration_organization_mapping')
        .select('location_id')
        .eq('organization_id', organizationId)
        .in('platform_integration_organizations_id', orgIds);
      const locs = [...new Set((maps || []).map(m => m.location_id).filter(Boolean).map(String))];
      if (locs.length === 1) resolvedLocationId = locs[0];
    }
  } catch (e) {
    console.warn(`[SageInvoiceService] Could not resolve location: ${e.message}`);
  }

  const ctx = {
    organizationId,
    userId,
    platformIntegrationId: integration.id,
    locationId: resolvedLocationId,
  };

  // ── Page through /purchase_invoices?attributes=all ─────────────────────────
  let page = 1;
  let totalFetched         = 0;
  let totalHeadersUpserted = 0;
  let totalLinesInserted   = 0;
  let totalPages           = 0;
  let hasNextPage          = true;

  while (hasNextPage) {
    console.log(`[SageInvoiceService] Fetching purchase_invoices page ${page} (${ITEMS_PER_PAGE}/page)...`);
    const response = await sageClient.sageGet(integration, '/purchase_invoices', {
      attributes:     'all',
      items_per_page: ITEMS_PER_PAGE,
      page,
    });

    const items = response?.$items || [];
    totalFetched += items.length;
    totalPages    = page;

    // Transform: each item → { header, lines }
    const transformed = [];
    for (const raw of items) {
      const t = transformRecord('sage_invoices', raw, ctx);
      if (t && t.header) transformed.push(t);
    }

    if (transformed.length === 0) {
      hasNextPage = Boolean(response?.$next);
      page++;
      continue;
    }

    // ── Step A: Upsert headers in batches, capture returned UUIDs ────────────
    // Map<sage_invoice_id, UUID> for the FK in the lines step.
    const sageToInvoiceId = new Map();

    for (let i = 0; i < transformed.length; i += HEADER_BATCH) {
      const headerBatch = transformed.slice(i, i + HEADER_BATCH).map(t => t.header);

      const { data: upserted, error: upsertErr } = await supabaseAdmin
        .from('sage_invoices')
        .upsert(headerBatch, {
          onConflict:       'organization_id,platform_integration_id,sage_invoice_id',
          ignoreDuplicates: false,
        })
        .select('id, sage_invoice_id');

      if (upsertErr) {
        throw new Error(`Failed to upsert invoice headers (page ${page}, batch ${i}): ${upsertErr.message}`);
      }

      (upserted || []).forEach(row => sageToInvoiceId.set(row.sage_invoice_id, row.id));
      totalHeadersUpserted += headerBatch.length;
    }

    // ── Step B: For each invoice, replace its line items ─────────────────────
    // Collect invoice IDs to delete old lines for, then bulk-insert fresh ones.
    const invoiceIdsForReplace = [];
    const newLines             = [];

    for (const { header, lines } of transformed) {
      const invoiceId = sageToInvoiceId.get(header.sage_invoice_id);
      if (!invoiceId) {
        console.warn(`[SageInvoiceService] Could not resolve invoice_id for sage_invoice_id ${header.sage_invoice_id}, skipping its lines`);
        continue;
      }
      invoiceIdsForReplace.push(invoiceId);
      for (const line of lines) {
        newLines.push({ ...line, invoice_id: invoiceId });
      }
    }

    if (invoiceIdsForReplace.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from('sage_invoice_line_items')
        .delete()
        .in('invoice_id', invoiceIdsForReplace);

      if (delErr) {
        throw new Error(`Failed to delete old line items (page ${page}): ${delErr.message}`);
      }
    }

    // Batch-insert new lines
    for (let i = 0; i < newLines.length; i += LINE_BATCH) {
      const batch = newLines.slice(i, i + LINE_BATCH);
      const { error: lineErr } = await supabaseAdmin
        .from('sage_invoice_line_items')
        .insert(batch);

      if (lineErr) {
        throw new Error(`Failed to insert line items batch (page ${page}, batch ${i}): ${lineErr.message}`);
      }
      totalLinesInserted += batch.length;
    }

    console.log(`[SageInvoiceService] Page ${page}: ${transformed.length} headers, ${newLines.length} lines processed`);

    hasNextPage = Boolean(response?.$next);
    page++;

    if (page > 1000) {
      console.warn('[SageInvoiceService] Stopping at 1000 pages — safety cap reached');
      break;
    }
  }

  console.log(`[SageInvoiceService] Sync complete: ${totalHeadersUpserted} headers, ${totalLinesInserted} lines (${totalFetched} fetched across ${totalPages} pages)`);

  return {
    headers_upserted: totalHeadersUpserted,
    lines_inserted:   totalLinesInserted,
    total_fetched:    totalFetched,
    total_pages:      totalPages,
  };
}

module.exports = {
  syncAllPurchaseInvoices,
};
