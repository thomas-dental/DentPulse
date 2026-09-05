/**
 * Pure helpers for Dentally payment webhook payloads.
 */

const PAYMENT_EVENTS = new Set([
  'payment.created',
  'payment.updated',
  'payment.deleted',
]);

/**
 * @param {string|null|undefined} eventName
 * @returns {boolean}
 */
function isPaymentWebhookEvent(eventName) {
  return PAYMENT_EVENTS.has(String(eventName || '').trim());
}

/**
 * @param {string} eventName — e.g. payment.updated
 * @returns {'created'|'updated'|'deleted'|null}
 */
function parsePaymentAction(eventName) {
  const parts = String(eventName || '').split('.');
  if (parts.length !== 2 || parts[0] !== 'payment') return null;
  const action = parts[1];
  if (action === 'created' || action === 'updated' || action === 'deleted') return action;
  return null;
}

/**
 * @param {unknown} payload — full webhook JSON body
 * @returns {{ event: string, object: string, data: object|null }}
 */
function parseWebhookPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { event: '', object: '', data: null };
  }
  const event = typeof payload.event === 'string' ? payload.event : '';
  const object = typeof payload.object === 'string' ? payload.object : '';
  const data =
    payload.data != null && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data
      : null;
  return { event, object, data };
}

/**
 * @param {object|null|undefined} data — webhook data or payment record
 * @returns {number|null}
 */
function extractPaymentId(data) {
  if (!data || data.id == null) return null;
  const id = Number(data.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Collect Dentally invoice ids from payment explanations (webhook or API shape).
 * @param {object|null|undefined} paymentRecord
 * @returns {number[]}
 */
function extractInvoiceIdsFromPayment(paymentRecord) {
  if (!paymentRecord) return [];
  const explanations = Array.isArray(paymentRecord.explanations)
    ? paymentRecord.explanations
    : [];
  const ids = new Set();
  for (const exp of explanations) {
    if (exp?.invoice_id == null) continue;
    const id = Number(exp.invoice_id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * Merge invoice id lists, dedupe, preserve order (prior first).
 * @param {...(number[]|null|undefined)} lists
 * @returns {number[]}
 */
function mergeInvoiceIds(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const id = Number(raw);
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

module.exports = {
  PAYMENT_EVENTS,
  isPaymentWebhookEvent,
  parsePaymentAction,
  parseWebhookPayload,
  extractPaymentId,
  extractInvoiceIdsFromPayment,
  mergeInvoiceIds,
};
