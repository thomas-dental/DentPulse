/**
 * Patient Economics — sync one chunk of Dentally invoices (+ nested invoice items)
 * into platform_integration_invoices / platform_integration_invoice_line_items.
 *
 * Combined resource: Dentally returns invoice_items only on GET /v1/invoices/{id}.
 * List pagination is the resume unit (resource_type: invoices). Items are upserted
 * in the same chunk after detail enrich — no separate invoice_items cursor.
 *
 * Links (Dentally ids, no Postgres FKs):
 *   patient_id              ↔ patients.pt_id
 *   account_id              ↔ dentally_patients_accounts.da_id
 *   treatment_plan_item_id  ↔ treatment_plan_items.tpi_id
 *   treatment_plan_id       ↔ treatment_plans.tp_id
 *
 * Raw amounts/status/dates synced as-is. Charged-not-collected / leakage = M6.
 */

const { fetchInvoiceDetailsBatch } = require('../../../api/dentally/client');
const { RESOURCE_INVOICES } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');
const { getPracticeSyncRange } = require('./practiceSyncRange');

async function syncInvoices(practiceId) {
  const { startDate } = await getPracticeSyncRange(practiceId);
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_INVOICES,
    entityAlias: 'invoices',
    enrichRecords: (records, pat, apiEndpoint) =>
      fetchInvoiceDetailsBatch(pat, apiEndpoint, records),
    dateChunking: {
      rangeStart: startDate,
    },
  });
}

/** Alias — items are not a separate Dentally list sync in this codebase. */
async function syncInvoiceItems(practiceId) {
  return syncInvoices(practiceId);
}

module.exports = { syncInvoices, syncInvoiceItems };
