/**
 * Process Dentally payment webhook events: upsert payment + refresh linked invoices.
 */

const { supabaseAdmin } = require('../../../config/supabase');
const { transformRecord } = require('../../transformers/dentally');
const {
  TABLE_MAP,
  ON_CONFLICT_MAP,
} = require('../../../api/dentally/config');
const {
  getLocationMap,
  upsertInvoicesWithLineItems,
  upsertPaymentsWithExplanations,
} = require('../../sync/upsert');
const { fetchPaymentDetail, fetchInvoiceDetail } = require('../../../api/dentally/client');
const { getDentallyBaseUrl } = require('../validatePat');
const { decryptPAT } = require('../patEncryption');
const { findEncryptedDentallyCredential } = require('../integrationCredentials');
const { loadLedgerExistingState, writeLedgerEventsFromUpsert } = require('../sync/eventLedgerWriter');
const { invalidatePeReadCache } = require('../peReadCache');
const {
  loadStoredInvoiceIdsForPaymentRpc,
  refreshContributionFactsForInvoicesRpc,
} = require('./webhookContributionRefresh');
const {
  parsePaymentAction,
  extractPaymentId,
  extractInvoiceIdsFromPayment,
  mergeInvoiceIds,
} = require('./paymentWebhookHelpers');

const WEBHOOK_SYNC_RUN_ID = 'dentally-payment-webhook';

async function loadWebhookContext(practiceId) {
  const row = await findEncryptedDentallyCredential(practiceId);
  if (!row) {
    const err = new Error('No Dentally PAT saved for this practice');
    err.code = 'NO_CREDENTIAL';
    throw err;
  }
  if (row.needs_reconnection === true) {
    const err = new Error('Dentally PAT needs reconnection');
    err.code = 'NEEDS_RECONNECTION';
    throw err;
  }
  const apiKey = decryptPAT(row.encrypted_pat, row.encrypted_pat_iv);
  const apiEndpoint = getDentallyBaseUrl();
  const locationMap = await getLocationMap(practiceId);
  return {
    integration: row,
    apiKey,
    apiEndpoint,
    transformCtx: {
      organizationId: practiceId,
      userId: null,
      locationMap,
    },
  };
}

/**
 * @param {string} practiceId
 * @param {number} dpId
 * @returns {Promise<number[]>}
 */
async function loadStoredInvoiceIdsForPayment(practiceId, dpId) {
  return loadStoredInvoiceIdsForPaymentRpc(practiceId, dpId);
}

/**
 * @param {string} practiceId
 * @param {number} dpId
 */
async function deleteLocalPayment(practiceId, dpId) {
  const { error } = await supabaseAdmin
    .from('dentally_payments')
    .delete()
    .eq('organization_id', practiceId)
    .eq('dp_id', dpId);

  if (error) {
    throw new Error(`Failed to delete local payment ${dpId}: ${error.message}`);
  }
}

/**
 * @param {object} ctx — from loadWebhookContext
 * @param {object} paymentRecord — Dentally API payment shape
 */
async function upsertPaymentFromRecord(practiceId, ctx, paymentRecord) {
  const row = transformRecord('payments', paymentRecord, ctx.transformCtx);
  if (!row) {
    throw new Error('Payment transform returned null');
  }

  const ledgerRows = [{
    ...row,
    _explanations: Array.isArray(row._explanations) ? [...row._explanations] : [],
  }];

  const ledgerState = await loadLedgerExistingState(practiceId, 'payments', ledgerRows);

  const result = await upsertPaymentsWithExplanations(
    TABLE_MAP.payments,
    ON_CONFLICT_MAP.payments,
    [row],
    practiceId,
  );

  if (result.processed > 0) {
    await writeLedgerEventsFromUpsert({
      practiceId,
      entityAlias: 'payments',
      syncRunId: WEBHOOK_SYNC_RUN_ID,
      newRows: ledgerRows,
      existingByEntityId: ledgerState.existingByEntityId,
      existingLedgerKeys: ledgerState.existingLedgerKeys,
    });
  }

  return result;
}

/**
 * @param {object} ctx
 * @param {number[]} invoiceIds
 */
async function refreshInvoices(practiceId, ctx, invoiceIds) {
  if (!invoiceIds.length) return { refreshed: 0, failed: 0 };

  let refreshed = 0;
  let failed = 0;

  for (const invoiceId of invoiceIds) {
    try {
      const detail = await fetchInvoiceDetail(ctx.apiKey, ctx.apiEndpoint, invoiceId);
      const invoiceRecord = detail.invoice || detail;
      const row = transformRecord('invoices', invoiceRecord, ctx.transformCtx);
      if (!row) {
        failed += 1;
        continue;
      }

      const ledgerState = await loadLedgerExistingState(practiceId, 'invoices', [row]);
      const result = await upsertInvoicesWithLineItems(
        TABLE_MAP.invoices,
        ON_CONFLICT_MAP.invoices,
        [row],
        practiceId,
        null,
      );

      if (result.processed > 0) {
        await writeLedgerEventsFromUpsert({
          practiceId,
          entityAlias: 'invoices',
          syncRunId: WEBHOOK_SYNC_RUN_ID,
          newRows: [row],
          existingByEntityId: ledgerState.existingByEntityId,
          existingLedgerKeys: ledgerState.existingLedgerKeys,
        });
        refreshed += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      console.error(`[PaymentWebhook] Invoice refresh failed for ${invoiceId}:`, err.message);
      failed += 1;
    }
  }

  return { refreshed, failed };
}

/**
 * @param {object} params
 * @param {string} params.practiceId
 * @param {string} params.eventName — payment.created | payment.updated | payment.deleted
 * @param {object|null} params.data — webhook data object
 * @returns {Promise<{ paymentId: number|null, invoiceIds: number[], paymentUpserted: boolean, invoicesRefreshed: number }>}
 */
async function processPaymentWebhook({ practiceId, eventName, data }) {
  const action = parsePaymentAction(eventName);
  if (!action) {
    const err = new Error(`Unsupported payment event: ${eventName}`);
    err.code = 'UNSUPPORTED_EVENT';
    throw err;
  }

  const paymentId = extractPaymentId(data);
  if (!paymentId) {
    const err = new Error('Payment webhook missing data.id');
    err.code = 'MISSING_PAYMENT_ID';
    throw err;
  }

  const ctx = await loadWebhookContext(practiceId);
  const webhookInvoiceIds = extractInvoiceIdsFromPayment(data);
  const priorInvoiceIds =
    action === 'deleted' ? await loadStoredInvoiceIdsForPayment(practiceId, paymentId) : [];

  let paymentUpserted = false;
  let fetchedPayment = null;

  if (action === 'deleted') {
    fetchedPayment = await fetchPaymentDetail(ctx.apiKey, ctx.apiEndpoint, paymentId);
    if (fetchedPayment) {
      const deletedRecord = { ...fetchedPayment, deleted: true };
      await upsertPaymentFromRecord(practiceId, ctx, deletedRecord);
      paymentUpserted = true;
    } else {
      await deleteLocalPayment(practiceId, paymentId);
    }
  } else {
    fetchedPayment = await fetchPaymentDetail(ctx.apiKey, ctx.apiEndpoint, paymentId);
    if (!fetchedPayment) {
      const err = new Error(`Payment ${paymentId} not found in Dentally API`);
      err.code = 'PAYMENT_NOT_FOUND';
      throw err;
    }
    await upsertPaymentFromRecord(practiceId, ctx, fetchedPayment);
    paymentUpserted = true;
  }

  const invoiceIds = mergeInvoiceIds(
    webhookInvoiceIds,
    extractInvoiceIdsFromPayment(fetchedPayment),
    priorInvoiceIds,
  );

  const { refreshed } = await refreshInvoices(practiceId, ctx, invoiceIds);

  if (paymentUpserted || refreshed > 0) {
    try {
      const facts = await refreshContributionFactsForInvoicesRpc(practiceId, invoiceIds);
      console.log(
        `[PaymentWebhook] Incremental facts refresh: ${facts.invoiceCount} invoice(s), ${facts.patientCount} patient grain(s)`,
      );
    } catch (err) {
      console.error(`[PaymentWebhook] Incremental facts refresh failed: ${err.message}`);
    }
    invalidatePeReadCache(practiceId, 'invoices-');
  }

  return {
    paymentId,
    invoiceIds,
    paymentUpserted,
    invoicesRefreshed: refreshed,
  };
}

module.exports = {
  processPaymentWebhook,
  loadWebhookContext,
  loadStoredInvoiceIdsForPayment,
};
