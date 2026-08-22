/**
 * Maps iplicit staging tables into canonical finance_* tables (Supabase).
 * Used by the Node iplicit sync processor after platform-specific upserts.
 */

const { supabaseAdmin } = require('../../config/supabase');

const BATCH = 300;
const UNMAPPED_CODE = '_unmapped_iplicit_pl_bs';

/**
 * Ensure a finance_data_sources row exists for this org + iplicit integration.
 * @returns {Promise<string|null>} source UUID
 */
async function ensureFinanceDataSource(organizationId, platformIntegrationId, baseCurrency = 'GBP') {
  if (!organizationId || !platformIntegrationId) return null;

  const { data: existingRows, error: selectErr } = await supabaseAdmin
    .from('finance_data_sources')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('platform', 'iplicit')
    .eq('platform_integration_id', platformIntegrationId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (selectErr) {
    console.error('[IplicitCanonical] ensureFinanceDataSource select failed:', selectErr.message);
    return null;
  }

  if (existingRows && existingRows.length > 0 && existingRows[0]?.id) return existingRows[0].id;

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('finance_data_sources')
    .insert({
      organization_id: organizationId,
      platform: 'iplicit',
      platform_integration_id: platformIntegrationId,
      base_currency: baseCurrency,
      is_active: true,
      metadata_json: {},
    })
    .select('id')
    .maybeSingle();

  if (insertErr) {
    // Race-safe fallback: if another worker inserted first, read again.
    const { data: racedRows, error: raceErr } = await supabaseAdmin
      .from('finance_data_sources')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform', 'iplicit')
      .eq('platform_integration_id', platformIntegrationId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (raceErr || !racedRows || racedRows.length === 0 || !racedRows[0]?.id) {
      console.error('[IplicitCanonical] ensureFinanceDataSource insert failed:', insertErr.message);
      return null;
    }
    return racedRows[0].id;
  }

  return inserted?.id || null;
}

/**
 * Upsert finance_accounts from iplicit_chart_of_accounts (Enquiry sync path).
 */
async function syncAccountsFromIplicitChartTable(organizationId, sourceId, platformIntegrationId) {
  if (!sourceId) return { upserted: 0 };

  const { data: rows, error } = await supabaseAdmin
    .from('iplicit_chart_of_accounts')
    .select(
      'account_id, code, name, description, account_type, is_active, coa_group_id'
    )
    .eq('organization_id', organizationId)
    .eq('platform_integration_id', platformIntegrationId);

  if (error) {
    console.error('[IplicitCanonical] load iplicit_chart_of_accounts failed:', error.message);
    return { upserted: 0 };
  }

  const accounts = (rows || []).map((r) => ({
    organization_id: organizationId,
    source_id: sourceId,
    canonical_account_code: String(r.account_id),
    account_name: r.name || r.description || String(r.account_id),
    account_type: r.account_type || null,
    report_category: r.coa_group_id ? String(r.coa_group_id) : null,
    is_active: r.is_active !== false,
    attributes_json: {
      code: r.code || null,
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
      console.error('[IplicitCanonical] finance_accounts upsert failed:', upErr.message);
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
        account_name: 'Unmapped iplicit account',
        account_type: null,
        report_category: null,
        is_active: true,
        attributes_json: { placeholder: true },
      },
      { onConflict: 'organization_id,source_id,canonical_account_code' }
    )
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[IplicitCanonical] ensureUnmappedAccount failed:', error.message);
    return null;
  }
  return data?.id || null;
}

async function buildFinanceAccountMap(organizationId, sourceId) {
  const byCanonicalCode = new Map();
  const byCoaCode = new Map();

  const { data: rows, error } = await supabaseAdmin
    .from('finance_accounts')
    .select('id, canonical_account_code, attributes_json')
    .eq('organization_id', organizationId)
    .eq('source_id', sourceId);

  if (error) {
    console.error('[IplicitCanonical] buildFinanceAccountMap failed:', error.message);
    return { byCanonicalCode, byCoaCode };
  }

  for (const row of rows || []) {
    const id = row.id;
    const code = String(row.canonical_account_code || '').trim();
    if (code) byCanonicalCode.set(code, id);
    const coa = row.attributes_json?.code || row.attributes_json?.coa_account_code;
    const coaCode = coa != null ? String(coa).trim() : '';
    if (coaCode) byCoaCode.set(coaCode, id);
  }

  return { byCanonicalCode, byCoaCode };
}

function resolveAccountId(row, maps, unmappedId) {
  const aid = row.account_id != null ? String(row.account_id).trim() : '';
  if (aid && maps.byCanonicalCode.has(aid)) return maps.byCanonicalCode.get(aid);
  const code = row.account_code != null ? String(row.account_code).trim() : '';
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
 * Build finance_journal_entries / finance_journal_lines from iplicit PL + BS staging tables.
 */
async function syncJournalsFromIplicitReportTables(organizationId, sourceId, platformIntegrationId) {
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
    const [plRes, bsRes] = await Promise.all([
      supabaseAdmin
        .from('iplicit_profit_loss')
        .select(
          'id, doc_id, doc_no, doc_class, trans_line_no, amount, account_id, account_code, period_date, post_date, invoice_date, description, doc_description, currency, base_currency, contact_account_code, contact_account_id, legal_entity_id'
        )
        .eq('organization_id', organizationId)
        .eq('platform_integration_id', platformIntegrationId),
      supabaseAdmin
        .from('iplicit_balance_sheet')
        .select(
          'id, doc_id, doc_no, doc_class, trans_line_no, amount, account_id, account_code, period_date, post_date, invoice_date, description, doc_description, currency, base_currency, contact_account_code, contact_account_id, legal_entity_id'
        )
        .eq('organization_id', organizationId)
        .eq('platform_integration_id', platformIntegrationId),
    ]);

    if (plRes.error) throw new Error(plRes.error.message);
    if (bsRes.error) throw new Error(bsRes.error.message);

    const list = [
      ...(plRes.data || []).map((r) => ({ ...r, source_type: 'profit_loss' })),
      ...(bsRes.data || []).map((r) => ({ ...r, source_type: 'balance_sheet' })),
    ];
    out.sourceRowCount = list.length;

    if (list.length === 0) {
      out.skippedReason = 'no_iplicit_pl_bs_rows';
      return out;
    }

    const maps = await buildFinanceAccountMap(organizationId, sourceId);
    const unmappedId = await ensureUnmappedAccount(organizationId, sourceId);

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

    const byJournal = new Map();
    for (const row of list) {
      const key = `${row.source_type || 'unknown'}::${row.doc_id || ''}`;
      if (!byJournal.has(key)) byJournal.set(key, []);
      byJournal.get(key).push(row);
    }

    const journalRows = [];
    for (const [jkey, rows] of byJournal.entries()) {
      const first = rows[0];
      const posting =
        (first.period_date && String(first.period_date).slice(0, 10)) ||
        (first.post_date && String(first.post_date).slice(0, 10)) ||
        (first.invoice_date && String(first.invoice_date).slice(0, 10)) ||
        new Date().toISOString().slice(0, 10);
      const cur = first.currency || first.base_currency || 'GBP';
      journalRows.push({
        organization_id: organizationId,
        source_id: sourceId,
        external_journal_id: jkey,
        journal_number: first.doc_no || null,
        posting_date: posting,
        document_date: first.invoice_date ? String(first.invoice_date).slice(0, 10) : null,
        description: first.description || first.doc_description || first.doc_no || null,
        status: 'posted',
        currency_code: String(cur).slice(0, 3),
        fx_rate: null,
        metadata_json: {
          source_type: first.source_type || null,
          source_ref: first.doc_no || null,
          doc_class: first.doc_class || null,
        },
      });
    }

    const journalMap = new Map();
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

    const lineRows = [];
    for (const [jkey, rows] of byJournal.entries()) {
      const journalId = journalMap.get(jkey);
      if (!journalId) {
        out.skippedNoJournalMap += rows.length;
        continue;
      }
      const sorted = [...rows].sort((a, b) => (Number(a.trans_line_no) || 0) - (Number(b.trans_line_no) || 0));
      for (let li = 0; li < sorted.length; li++) {
        const row = sorted[li];
        out.mappedLineCandidates += 1;
        const accountId = resolveAccountId(row, maps, unmappedId);
        if (!accountId) {
          out.skippedNoAccount += 1;
          continue;
        }
        const amount = Number(row.amount) || 0;
        const debit = amount >= 0 ? Math.abs(amount) : 0;
        const credit = amount < 0 ? Math.abs(amount) : 0;
        const posting =
          (row.period_date && String(row.period_date).slice(0, 10)) ||
          (row.post_date && String(row.post_date).slice(0, 10)) ||
          (row.invoice_date && String(row.invoice_date).slice(0, 10)) ||
          new Date().toISOString().slice(0, 10);
        const extLine = row.trans_line_no != null ? String(row.trans_line_no) : `L${li}`;

        lineRows.push({
          organization_id: organizationId,
          source_id: sourceId,
          journal_entry_id: journalId,
          external_line_id: extLine,
          account_id: accountId,
          posting_date: posting,
          line_order: li,
          debit_amount: debit,
          credit_amount: credit,
          tax_code: null,
          cost_center: null,
          contact_ref: row.contact_account_code || row.contact_account_id || null,
          project_ref: null,
          dimensions_json: {
            doc_class: row.doc_class || null,
            source_type: row.source_type || null,
            legal_entity_id: row.legal_entity_id || null,
          },
          extras_json: {
            source_row_id: row.id || null,
            narrative: row.doc_description || null,
            line_description: row.description || null,
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

module.exports = {
  ensureFinanceDataSource,
  syncAccountsFromIplicitChartTable,
  syncJournalsFromIplicitReportTables,
};
