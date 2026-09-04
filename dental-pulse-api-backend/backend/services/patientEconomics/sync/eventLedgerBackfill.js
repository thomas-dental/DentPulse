/**
 * Backfill missing PE event_ledger rows from already-synced source tables.
 *
 * Uses the same diff/heal path as live sync: oldRow === newRow so only missing
 * idempotency keys are emitted. Safe to re-run (ignoreDuplicates on upsert).
 */

const { supabaseAdmin } = require('../../../config/supabase');
const {
  writeLedgerEventsFromUpsert,
  loadExistingLedgerKeys,
  candidateKeysForRows,
  normalizeEntityId,
} = require('./eventLedgerWriter');

const DEFAULT_PAGE_SIZE = 500;

const BACKFILL_SPECS = [
  {
    alias: 'treatment_plans',
    table: 'treatment_plans',
    idField: 'tp_id',
    order: 'tp_id',
  },
  {
    alias: 'treatment_appointments',
    table: 'treatment_appointments',
    idField: 'ta_id',
    order: 'ta_id',
  },
  {
    alias: 'treatment_plan_items',
    table: 'treatment_plan_items',
    idField: 'tpi_id',
    order: 'tpi_id',
  },
  {
    alias: 'invoices',
    table: 'platform_integration_invoices',
    idField: 'platform_invoice_id',
    order: 'invoice_date',
    applyFilters: (query) => query.eq('platform_type', 'dentally'),
  },
  {
    alias: 'payments',
    table: 'dentally_payments',
    idField: 'dp_id',
    order: 'dp_dated_on',
    applyFilters: (query) => query.is('deleted_at', null),
    attachExplanations: true,
  },
  {
    alias: 'patients',
    table: 'patients',
    idField: 'pt_id',
    order: 'pt_id',
    applyFilters: (query) => query.is('deleted_at', null),
    pageSize: 100,
  },
];

function buildSelfMap(rows, idField, entityAlias) {
  const map = new Map();
  for (const row of rows) {
    const id = normalizeEntityId(entityAlias, row[idField]);
    if (id != null) map.set(id, row);
  }
  return map;
}

async function attachPaymentExplanations(practiceId, rows) {
  const paymentIds = rows.map((r) => r.id).filter(Boolean);
  if (paymentIds.length === 0) return rows;

  const byPaymentId = new Map();
  const chunkSize = 200;
  for (let i = 0; i < paymentIds.length; i += chunkSize) {
    const chunk = paymentIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from('dentally_payment_explanations')
      .select('payment_id, dpe_invoice_id, dpe_amount, dpe_id')
      .eq('organization_id', practiceId)
      .is('deleted_at', null)
      .in('payment_id', chunk);

    if (error) {
      throw new Error(`[PE ledger backfill] payment explanations load failed: ${error.message}`);
    }

    for (const exp of data || []) {
      if (!byPaymentId.has(exp.payment_id)) byPaymentId.set(exp.payment_id, []);
      byPaymentId.get(exp.payment_id).push({
        id: exp.dpe_id,
        invoice_id: exp.dpe_invoice_id,
        amount: exp.dpe_amount,
      });
    }
  }

  return rows.map((row) => ({
    ...row,
    _explanations: byPaymentId.get(row.id) || [],
  }));
}

async function fetchEntityPage(practiceId, spec, page, pageSize) {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from(spec.table)
    .select('*', { count: 'exact' })
    .eq('organization_id', practiceId)
    .order(spec.order, { ascending: true, nullsFirst: false });

  if (spec.applyFilters) {
    query = spec.applyFilters(query);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`[PE ledger backfill] ${spec.alias} page ${page} failed: ${error.message}`);
  }

  return { rows: data || [], total: count ?? null };
}

/**
 * Backfill one ledger entity for a practice.
 * @returns {Promise<{ entityAlias: string, pages: number, rowsScanned: number, written: number, skippedNoPatient: number, orphanedNoPatient: number }>}
 */
async function backfillLedgerEntity(practiceId, entityAlias, options = {}) {
  const spec = BACKFILL_SPECS.find((s) => s.alias === entityAlias);
  if (!spec) {
    throw new Error(`Unknown ledger entity: ${entityAlias}`);
  }

  const pageSize = options.pageSize || spec.pageSize || DEFAULT_PAGE_SIZE;
  let page = 0;
  let rowsScanned = 0;
  let written = 0;
  let skippedNoPatient = 0;
  let orphanedNoPatient = 0;

  for (;;) {
    const { rows, total } = await fetchEntityPage(practiceId, spec, page, pageSize);
    if (rows.length === 0) break;

    rowsScanned += rows.length;
    let processedRows = rows;
    if (spec.attachExplanations) {
      processedRows = await attachPaymentExplanations(practiceId, rows);
    }

    const existingByEntityId = buildSelfMap(processedRows, spec.idField, entityAlias);
    const existingLedgerKeys = await loadExistingLedgerKeys(
      practiceId,
      candidateKeysForRows(entityAlias, processedRows),
    );

    const result = await writeLedgerEventsFromUpsert({
      practiceId,
      entityAlias,
      syncRunId: 'ledger_backfill',
      newRows: processedRows,
      existingByEntityId,
      existingLedgerKeys,
      payloadSource: 'ledger_backfill',
    });

    written += result.written || 0;
    skippedNoPatient += result.skippedNoPatient || 0;
    orphanedNoPatient += result.orphanedNoPatient || 0;

    if (options.onProgress) {
      options.onProgress({
        entityAlias,
        page,
        rows: rows.length,
        written: result.written || 0,
        skippedNoPatient: result.skippedNoPatient || 0,
        orphanedNoPatient: result.orphanedNoPatient || 0,
      });
    }

    page += 1;
    if (rows.length < pageSize) break;
    if (total != null && page * pageSize >= total) break;
  }

  return {
    entityAlias,
    pages: page,
    rowsScanned,
    written,
    skippedNoPatient,
    orphanedNoPatient,
  };
}

/**
 * Backfill all (or selected) ledger entities for a practice.
 * @param {string} practiceId
 * @param {{ entities?: string[], pageSize?: number, onProgress?: Function }} [options]
 */
async function backfillPracticeEventLedger(practiceId, options = {}) {
  const allAliases = BACKFILL_SPECS.map((s) => s.alias);
  const requested = options.entities?.length
    ? options.entities.filter((alias) => allAliases.includes(alias))
    : allAliases;

  if (requested.length === 0) {
    throw new Error(
      `No valid entities. Choose from: ${allAliases.join(', ')}`,
    );
  }

  const results = [];
  for (const entityAlias of requested) {
    results.push(await backfillLedgerEntity(practiceId, entityAlias, options));
  }

  const summary = {
    rowsScanned: results.reduce((n, r) => n + r.rowsScanned, 0),
    written: results.reduce((n, r) => n + r.written, 0),
    skippedNoPatient: results.reduce((n, r) => n + r.skippedNoPatient, 0),
    orphanedNoPatient: results.reduce((n, r) => n + r.orphanedNoPatient, 0),
  };

  return { practiceId, results, summary };
}

module.exports = {
  BACKFILL_SPECS,
  backfillLedgerEntity,
  backfillPracticeEventLedger,
};
