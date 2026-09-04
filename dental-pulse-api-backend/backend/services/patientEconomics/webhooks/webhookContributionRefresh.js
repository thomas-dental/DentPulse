/**
 * Incremental contribution-facts refresh via Supabase RPC (webhook fast path).
 */

const { supabaseAdmin } = require('../../../config/supabase');

/**
 * @param {string} practiceId
 * @param {number} dpId
 * @returns {Promise<number[]>}
 */
async function loadStoredInvoiceIdsForPaymentRpc(practiceId, dpId) {
  const { data, error } = await supabaseAdmin.rpc('pe_webhook_payment_invoice_ids', {
    p_practice_id: practiceId,
    p_dp_id: dpId,
  });

  if (error) {
    console.warn('[PaymentWebhook] pe_webhook_payment_invoice_ids failed:', error.message);
    return [];
  }

  if (!Array.isArray(data)) return [];
  return data
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * @param {string} practiceId
 * @param {number[]} platformInvoiceIds — Dentally numeric invoice ids
 * @returns {Promise<{ invoiceCount: number, patientCount: number }>}
 */
async function refreshContributionFactsForInvoicesRpc(practiceId, platformInvoiceIds) {
  const ids = [...new Set(
    (platformInvoiceIds ?? [])
      .map((id) => String(id))
      .filter((s) => s.length > 0),
  )];

  if (ids.length === 0) {
    return { invoiceCount: 0, patientCount: 0, skipped: true };
  }

  const { data, error } = await supabaseAdmin.rpc('pe_webhook_refresh_contribution_facts', {
    p_practice_id: practiceId,
    p_platform_invoice_ids: ids,
  });

  if (error) {
    throw new Error(`pe_webhook_refresh_contribution_facts: ${error.message}`);
  }

  const payload = data && typeof data === 'object' ? data : {};
  return {
    invoiceCount: Number(payload.invoiceCount) || 0,
    patientCount: Number(payload.patientCount) || 0,
    skipped: payload.skipped === true,
  };
}

module.exports = {
  loadStoredInvoiceIdsForPaymentRpc,
  refreshContributionFactsForInvoicesRpc,
};
