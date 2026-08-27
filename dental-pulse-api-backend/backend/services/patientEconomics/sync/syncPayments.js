/**
 * Patient Economics — sync one chunk of Dentally payments (+ nested explanations)
 * into dentally_payments / dentally_payment_explanations.
 *
 * Invoice link: explanations[].invoice_id → dpe_invoice_id
 *   ↔ platform_integration_invoices.platform_invoice_id (logical, no FK).
 * Also: dp_patient_id ↔ pt_id, dp_account_id ↔ da_id.
 *
 * Raw amounts/dates/status/method synced as-is. Collection-rate / aged debt = M7.
 *
 * Event Ledger (via upsertPePage → eventLedgerWriter):
 *   PAYMENT_ALLOCATED — explanation with invoice_id (new payment or heal).
 */

const { RESOURCE_PAYMENTS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');
const { getPracticeSyncRange } = require('./practiceSyncRange');

async function syncPayments(practiceId) {
  const { startDate } = await getPracticeSyncRange(practiceId);
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_PAYMENTS,
    entityAlias: 'payments',
    dateChunking: {
      rangeStart: startDate,
    },
  });
}

module.exports = { syncPayments };
