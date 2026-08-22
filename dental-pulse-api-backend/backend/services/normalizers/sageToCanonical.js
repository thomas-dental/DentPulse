/**
 * Maps Sage staging tables into canonical finance_* tables (Supabase).
 * Called by the Sage sync after COA and invoice upserts.
 *
 * Mirrors backend/services/normalizers/xeroToCanonical.js exactly so all
 * downstream consumers (useChartOfAccounts with useCanonicalFirst=true,
 * EBITDA/Cost Impact RPCs, etc.) see Sage data the same way they see Xero.
 *
 * Canonical mapping:
 *   sage_chart_of_accounts       → finance_accounts
 *   sage_invoices + line_items   → finance_journal_entries + finance_journal_lines
 *
 * Each Sage purchase invoice becomes one journal entry; each line item
 * becomes one journal line. Sage purchase invoices are ACCPAY only (sales
 * SKIP — dental practices use Dentally for patient billing) so all lines
 * post as debits (expense side).
 */

const { supabaseAdmin } = require('../../config/supabase');

const BATCH = 300;
const UNMAPPED_CODE = '_unmapped_sage_account';

/**
 * Ensure a finance_data_sources row exists for this org + sage integration.
 */
async function ensureFinanceDataSource(organizationId, platformIntegrationId, baseCurrency = 'GBP') {
  if (!organizationId || !platformIntegrationId) return null;

  const { data: existingRows, error: selectErr } = await supabaseAdmin
    .from('finance_data_sources')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('platform', 'sage')
    .eq('platform_integration_id', platformIntegrationId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (selectErr) {
    console.error('[SageCanonical] ensureFinanceDataSource select failed:', selectErr.message);
    return null;
  }

  if (existingRows && existingRows.length > 0 && existingRows[0]?.id) return existingRows[0].id;

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('finance_data_sources')
    .insert({
      organization_id: organizationId,
      platform: 'sage',
      platform_integration_id: platformIntegrationId,
      base_currency: baseCurrency,
      is_active: true,
      metadata_json: {},
    })
    .select('id')
    .maybeSingle();

  if (insertErr) {
    // Race-safe fallback.
    const { data: racedRows } = await supabaseAdmin
      .from('finance_data_sources')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform', 'sage')
      .eq('platform_integration_id', platformIntegrationId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!racedRows || racedRows.length === 0 || !racedRows[0]?.id) {
      console.error('[SageCanonical] ensureFinanceDataSource insert failed:', insertErr.message);
      return null;
    }
    return racedRows[0].id;
  }

  return inserted?.id || null;
}

/**
 * Upsert finance_accounts from sage_chart_of_accounts (Sage COA sync path).
 */
async function syncAccountsFromSageChartTable(organizationId, sourceId, platformIntegrationId) {
  if (!sourceId) return { upserted: 0 };

  const { data: rows, error } = await supabaseAdmin
    .from('sage_chart_of_accounts')
    .select('sage_account_id, account_code, account_name, account_type, classification, description, is_active')
    .eq('organization_id', organizationId)
    .eq('platform_integration_id', platformIntegrationId);

  if (error) {
    console.error('[SageCanonical] load sage_chart_of_accounts failed:', error.message);
    return { upserted: 0 };
  }

  const accounts = (rows || [])
    .filter(r => r.sage_account_id)
    .map(r => ({
      organization_id: organizationId,
      source_id: sourceId,
      canonical_account_code: String(r.sage_account_id),
      account_name: r.account_name || r.account_code || String(r.sage_account_id),
      account_type: r.account_type || null,
      report_category: r.classification || null,
      is_active: r.is_active !== false,
      attributes_json: {
        code: r.account_code || null,
        description: r.description || null,
      },
    }));

  let upserted = 0;
  for (let i = 0; i < accounts.length; i += BATCH) {
    const chunk = accounts.slice(i, i + BATCH);
    const { error: upErr } = await supabaseAdmin
      .from('finance_accounts')
      .upsert(chunk, { onConflict: 'organization_id,source_id,canonical_account_code' });
    if (upErr) {
      console.error('[SageCanonical] finance_accounts upsert failed:', upErr.message);
    } else {
      upserted += chunk.length;
    }
  }

  return { upserted };
}

async function ensureUnmappedAccount(organizationId, sourceId) {
  const { data, error } = await supabaseAdmin
    .from('finance_accounts')
    .upsert(
      {
        organization_id: organizationId,
        source_id: sourceId,
        canonical_account_code: UNMAPPED_CODE,
        account_name: 'Unmapped Sage account',
        account_type: null,
        report_category: null,
        is_active: true,
        attributes_json: { placeholder: true },
      },
      { onConflict: 'organization_id,source_id,canonical_account_code' },
    )
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[SageCanonical] ensureUnmappedAccount failed:', error.message);
    return null;
  }
  return data?.id || null;
}

async function buildFinanceAccountMap(organizationId, sourceId) {
  const byCanonicalCode = new Map(); // Sage AccountID (GUID) → finance_accounts.id
  const byCoaCode       = new Map(); // Sage nominal code (e.g. "5000") → finance_accounts.id

  const { data: rows, error } = await supabaseAdmin
    .from('finance_accounts')
    .select('id, canonical_account_code, attributes_json')
    .eq('organization_id', organizationId)
    .eq('source_id', sourceId);

  if (error) {
    console.error('[SageCanonical] buildFinanceAccountMap failed:', error.message);
    return { byCanonicalCode, byCoaCode };
  }

  for (const row of rows || []) {
    const id = row.id;
    const canonical = String(row.canonical_account_code || '').trim();
    if (canonical) byCanonicalCode.set(canonical, id);
    const coa = row.attributes_json?.code;
    const coaCode = coa != null ? String(coa).trim() : '';
    if (coaCode) byCoaCode.set(coaCode, id);
  }

  return { byCanonicalCode, byCoaCode };
}

function resolveAccountId(line, maps, unmappedId) {
  const aid = line.account_id != null ? String(line.account_id).trim() : '';
  if (aid && maps.byCanonicalCode.has(aid)) return maps.byCanonicalCode.get(aid);
  const code = line.account_code != null ? String(line.account_code).trim() : '';
  if (code && maps.byCoaCode.has(code)) return maps.byCoaCode.get(code);
  if (code && maps.byCanonicalCode.has(code)) return maps.byCanonicalCode.get(code);
  return unmappedId;
}

async function upsertBatches(table, rows, onConflict) {
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    total += chunk.length;
  }
  return total;
}

/**
 * Build finance_journal_entries / _lines from Sage invoices + line items.
 *
 * One Sage purchase invoice → one journal entry (keyed by invoice UUID).
 * One line item → one journal line.
 *
 * Sign convention:
 *   ACCPAY (Sage purchase invoices) → debit the expense account (positive net)
 *   Negative amounts flip to credit (handles credit notes / reversals).
 *
 * Sales invoices are NOT processed (dental practices don't use Sage for sales).
 */
async function syncJournalsFromSageInvoices(organizationId, sourceId, platformIntegrationId) {
  const out = {
    sourceRowCount: 0,
    journalEntriesUpserted: 0,
    journalLinesUpserted: 0,
    mappedLineCandidates: 0,
    skippedNoAccount: 0,
    skippedNoJournalMap: 0,
    skippedReason: null,
    error: null,
  };

  try {
    // 1. Load Sage invoices for this org+integration
    const { data: invoices, error: invErr } = await supabaseAdmin
      .from('sage_invoices')
      .select('id, sage_invoice_id, invoice_number, invoice_type, invoice_date, due_date, status, reference, currency, currency_rate, contact_id')
      .eq('organization_id', organizationId)
      .eq('platform_integration_id', platformIntegrationId);

    if (invErr) throw new Error(`load sage_invoices failed: ${invErr.message}`);
    if (!invoices || invoices.length === 0) {
      out.skippedReason = 'no_sage_invoices';
      return out;
    }

    const invoiceUuids = invoices.map(i => i.id);
    const invoiceById  = new Map(invoices.map(i => [i.id, i]));
    out.sourceRowCount = invoices.length;

    // 2. Load line items in batches
    const lineItems = [];
    for (let i = 0; i < invoiceUuids.length; i += 500) {
      const chunk = invoiceUuids.slice(i, i + 500);
      const { data: liData, error: liErr } = await supabaseAdmin
        .from('sage_invoice_line_items')
        .select('id, invoice_id, line_number, description, account_id, account_code, line_amount, tax_amount, tax_type, quantity, unit_amount')
        .eq('organization_id', organizationId)
        .in('invoice_id', chunk);
      if (liErr) throw new Error(`load line items failed: ${liErr.message}`);
      lineItems.push(...(liData || []));
    }

    const maps        = await buildFinanceAccountMap(organizationId, sourceId);
    const unmappedId  = await ensureUnmappedAccount(organizationId, sourceId);

    // 3. Build one journal entry per invoice
    const journalRows = invoices.map(inv => {
      const posting = inv.invoice_date ? String(inv.invoice_date).slice(0, 10)
                    : inv.due_date     ? String(inv.due_date).slice(0, 10)
                    : new Date().toISOString().slice(0, 10);
      return {
        organization_id: organizationId,
        source_id: sourceId,
        external_journal_id: String(inv.id),
        journal_number: inv.invoice_number || null,
        posting_date: posting,
        document_date: inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : null,
        description: inv.reference || inv.invoice_number || null,
        status: inv.status === 'voided' ? 'void' : 'posted',
        currency_code: (inv.currency || 'GBP').slice(0, 3),
        fx_rate: inv.currency_rate != null ? Number(inv.currency_rate) : null,
        metadata_json: {
          invoice_type: inv.invoice_type || 'ACCPAY',
          sage_invoice_id: inv.sage_invoice_id || null,
          contact_id: inv.contact_id || null,
        },
      };
    });

    // Clear existing Sage journals for this source before re-inserting so we don't
    // leave orphan entries if invoices were deleted upstream.
    const { error: delLines } = await supabaseAdmin
      .from('finance_journal_lines')
      .delete()
      .eq('source_id', sourceId);
    if (delLines) throw new Error(`[delete finance_journal_lines] ${delLines.message}`);

    const { error: delEntries } = await supabaseAdmin
      .from('finance_journal_entries')
      .delete()
      .eq('source_id', sourceId);
    if (delEntries) throw new Error(`[delete finance_journal_entries] ${delEntries.message}`);

    const journalMap = new Map(); // external_journal_id → finance_journal_entries.id
    for (let i = 0; i < journalRows.length; i += BATCH) {
      const chunk = journalRows.slice(i, i + BATCH);
      const { data, error } = await supabaseAdmin
        .from('finance_journal_entries')
        .upsert(chunk, { onConflict: 'source_id,external_journal_id' })
        .select('id, external_journal_id');
      if (error) throw new Error(`finance_journal_entries upsert failed: ${error.message}`);
      for (const row of data || []) journalMap.set(row.external_journal_id, row.id);
    }
    out.journalEntriesUpserted = journalMap.size;

    // 4. Build lines
    const linesByInvoice = new Map();
    for (const li of lineItems) {
      if (!linesByInvoice.has(li.invoice_id)) linesByInvoice.set(li.invoice_id, []);
      linesByInvoice.get(li.invoice_id).push(li);
    }

    const lineRows = [];
    for (const [invoiceUuid, lis] of linesByInvoice.entries()) {
      const journalId = journalMap.get(String(invoiceUuid));
      if (!journalId) {
        out.skippedNoJournalMap += lis.length;
        continue;
      }
      const inv     = invoiceById.get(invoiceUuid);
      const posting = inv?.invoice_date ? String(inv.invoice_date).slice(0, 10)
                    : new Date().toISOString().slice(0, 10);

      const sorted = [...lis].sort((a, b) => (Number(a.line_number) || 0) - (Number(b.line_number) || 0));
      for (let li = 0; li < sorted.length; li++) {
        const line = sorted[li];
        out.mappedLineCandidates += 1;

        const accountId = resolveAccountId(line, maps, unmappedId);
        if (!accountId) {
          out.skippedNoAccount += 1;
          continue;
        }

        const net = Number(line.line_amount) || 0;
        const absNet = Math.abs(net);
        // Sage purchase invoices = ACCPAY → debit expense.
        // Flip for negative amounts (credit notes / reversals).
        let debit = 0, credit = 0;
        if (net >= 0) debit  = absNet; else credit = absNet;

        const extLine = line.id ? String(line.id) : `L${li}`;

        lineRows.push({
          organization_id:   organizationId,
          source_id:         sourceId,
          journal_entry_id:  journalId,
          external_line_id:  extLine,
          account_id:        accountId,
          posting_date:      posting,
          line_order:        li,
          debit_amount:      debit,
          credit_amount:     credit,
          tax_code:          line.tax_type || null,
          cost_center:       null,
          contact_ref:       inv?.contact_id || null,
          project_ref:       null,
          dimensions_json: {
            invoice_type: inv?.invoice_type || 'ACCPAY',
          },
          extras_json: {
            quantity:     line.quantity     ?? null,
            unit_amount:  line.unit_amount  ?? null,
            tax_amount:   line.tax_amount   ?? null,
            line_number:  line.line_number  ?? null,
            line_description: line.description || null,
          },
        });
      }
    }

    if (lineRows.length === 0) {
      out.skippedReason =
        `no_line_rows_after_mapping candidates=${out.mappedLineCandidates} skippedNoAccount=${out.skippedNoAccount} skippedNoJournalMap=${out.skippedNoJournalMap}`;
      return out;
    }

    await upsertBatches('finance_journal_lines', lineRows, 'journal_entry_id,external_line_id');
    out.journalLinesUpserted = lineRows.length;
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
}

/**
 * Top-level orchestrator — called from Sage sync flow after entities have synced.
 * Runs the full Sage → canonical ETL in sequence.
 *
 * @param {string} organizationId
 * @returns {Promise<object>} summary of what was synced
 */
async function runSageToCanonical(organizationId, connectionId = null) {
  if (!organizationId) throw new Error('organizationId is required');

  // Multi-connection: an org can have several Sage logins. Process the given
  // connection, or ALL connected Sage integrations. (Was .maybeSingle() — that
  // threw "multiple rows returned" once a 2nd Sage account was connected.)
  let intQuery = supabaseAdmin
    .from('platform_integrations')
    .select('id, is_connected')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'sage')
    .eq('is_connected', true);
  if (connectionId) intQuery = intQuery.eq('id', connectionId);

  const { data: integrations, error: intErr } = await intQuery;
  if (intErr) throw new Error(`load Sage integration failed: ${intErr.message}`);
  if (!integrations || integrations.length === 0) {
    console.warn(`[SageCanonical] No active Sage connection for org ${organizationId} — skipping canonical ETL`);
    return { skipped: true, reason: 'no_active_sage_connection' };
  }

  // Run the ETL once per connection and aggregate the counts.
  let totalAccounts = 0, totalEntries = 0, totalLines = 0;
  const perConnection = [];
  let lastError = null, lastSkipped = null;

  for (const integration of integrations) {
    const platformIntegrationId = integration.id;

    // 1. Ensure finance_data_sources row exists (per integration)
    const sourceId = await ensureFinanceDataSource(organizationId, platformIntegrationId, 'GBP');
    if (!sourceId) {
      perConnection.push({ platformIntegrationId, skipped: 'finance_data_source_creation_failed' });
      continue;
    }

    // 2. COA → finance_accounts
    const coaResult = await syncAccountsFromSageChartTable(organizationId, sourceId, platformIntegrationId);
    console.log(`[SageCanonical] [${platformIntegrationId}] finance_accounts: ${coaResult.upserted} upserted`);

    // 3. Invoices → finance_journal_entries + lines
    const journalResult = await syncJournalsFromSageInvoices(organizationId, sourceId, platformIntegrationId);
    console.log(`[SageCanonical] [${platformIntegrationId}] journals: ${journalResult.journalEntriesUpserted} entries, ${journalResult.journalLinesUpserted} lines`);
    if (journalResult.error) {
      console.error('[SageCanonical] journal sync error:', journalResult.error);
      lastError = journalResult.error;
    }
    if (journalResult.skippedReason) lastSkipped = journalResult.skippedReason;

    totalAccounts += coaResult.upserted || 0;
    totalEntries  += journalResult.journalEntriesUpserted || 0;
    totalLines    += journalResult.journalLinesUpserted || 0;
    perConnection.push({
      platformIntegrationId,
      source_id: sourceId,
      accounts_upserted: coaResult.upserted,
      journal_entries_upserted: journalResult.journalEntriesUpserted,
      journal_lines_upserted: journalResult.journalLinesUpserted,
    });
  }

  return {
    // back-compat fields (aggregated across connections)
    source_id: perConnection[0]?.source_id || null,
    accounts_upserted: totalAccounts,
    journal_entries_upserted: totalEntries,
    journal_lines_upserted: totalLines,
    journal_skipped_reason: lastSkipped,
    journal_error: lastError,
    connections: perConnection,
  };
}

module.exports = {
  ensureFinanceDataSource,
  syncAccountsFromSageChartTable,
  syncJournalsFromSageInvoices,
  runSageToCanonical,
};
