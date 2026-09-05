/**
 * Facts-first read helpers — single invoice/patient grain source selection.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { queryInPatientChunks } = require('./pePatientQueryChunks');
const {
  withStableOrder,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_PAGES,
} = require('./peStablePagination');

const INVOICE_FACTS_TABLE = 'pe_invoice_contribution_facts';
const INVOICE_VIEW_TABLE = 'v_invoice_contribution';
const PATIENT_FACTS_TABLE = 'pe_patient_contribution_facts';
const RETENTION_VIEW_TABLE = 'v_pe_retention_segment';

async function hasInvoiceFacts(practiceId) {
  const { data, error } = await supabaseAdmin.rpc('pe_invoice_source_has_facts', {
    p_practice_id: practiceId,
  });

  if (!error) return Boolean(data);

  const { count, error: countErr } = await supabaseAdmin
    .from(INVOICE_FACTS_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('practice_id', practiceId);

  if (countErr && countErr.code === '42P01') return false;
  if (countErr) throw countErr;
  return (count ?? 0) > 0;
}

function invoiceGrainTables() {
  return [INVOICE_FACTS_TABLE, INVOICE_VIEW_TABLE];
}

function patientRetentionTables() {
  return [PATIENT_FACTS_TABLE, RETENTION_VIEW_TABLE];
}

/**
 * Page through invoice-grain tables (facts first, live view fallback).
 * Stops after the first table that returns rows.
 */
async function forEachInvoiceGrainPage(
  practiceId,
  {
    select,
    applyFilters = null,
    pageSize = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
  },
  onBatch,
) {
  for (const table of invoiceGrainTables()) {
    let offset = 0;
    let found = false;

    for (let page = 0; page < maxPages; page++) {
      let query = supabaseAdmin.from(table).select(select).eq('practice_id', practiceId);
      if (applyFilters) query = applyFilters(query);
      query = withStableOrder(query, table);

      const { data, error } = await query.range(offset, offset + pageSize - 1);
      if (error && error.code === '42P01') break;
      if (error) throw error;

      const batch = data ?? [];
      if (batch.length > 0) found = true;
      await onBatch(batch, table);

      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    if (found) return true;
  }

  return false;
}

/**
 * Chunked patient_id IN queries across invoice-grain tables (facts first).
 */
async function queryInvoiceGrainInPatientChunks(
  practiceId,
  patientIds,
  select,
  { applyFilters = null, chunkSize = 100 } = {},
) {
  if (!patientIds?.length) return [];

  for (const table of invoiceGrainTables()) {
    const rows = await queryInPatientChunks(
      patientIds,
      (chunk) => {
        let query = supabaseAdmin
          .from(table)
          .select(select)
          .eq('practice_id', practiceId)
          .in('patient_id', chunk);
        if (applyFilters) query = applyFilters(query);
        return query;
      },
      chunkSize,
    );

    if (rows.length > 0) return rows;
  }

  return [];
}

/**
 * Page through patient retention tables (facts first, segmentation view fallback).
 */
async function forEachPatientRetentionPage(
  practiceId,
  {
    select,
    applyFilters = null,
    pageSize = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
  },
  onBatch,
) {
  for (const table of patientRetentionTables()) {
    let offset = 0;
    let found = false;

    for (let page = 0; page < maxPages; page++) {
      let query = supabaseAdmin.from(table).select(select).eq('practice_id', practiceId);
      if (applyFilters) query = applyFilters(query);
      query = withStableOrder(query, table);

      const { data, error } = await query.range(offset, offset + pageSize - 1);
      if (error && error.code === '42P01') break;
      if (error) throw error;

      const batch = data ?? [];
      if (batch.length > 0) found = true;
      await onBatch(batch, table);

      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    if (found) return true;
  }

  return false;
}

module.exports = {
  INVOICE_FACTS_TABLE,
  INVOICE_VIEW_TABLE,
  PATIENT_FACTS_TABLE,
  RETENTION_VIEW_TABLE,
  hasInvoiceFacts,
  invoiceGrainTables,
  patientRetentionTables,
  forEachInvoiceGrainPage,
  queryInvoiceGrainInPatientChunks,
  forEachPatientRetentionPage,
};
