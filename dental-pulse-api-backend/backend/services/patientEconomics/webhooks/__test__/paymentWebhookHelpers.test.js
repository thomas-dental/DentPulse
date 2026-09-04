/**
 * Unit tests — payment webhook payload helpers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPaymentWebhookEvent,
  parsePaymentAction,
  parseWebhookPayload,
  extractPaymentId,
  extractInvoiceIdsFromPayment,
  mergeInvoiceIds,
} = require('../paymentWebhookHelpers');

test('isPaymentWebhookEvent recognises payment events', () => {
  assert.equal(isPaymentWebhookEvent('payment.created'), true);
  assert.equal(isPaymentWebhookEvent('payment.updated'), true);
  assert.equal(isPaymentWebhookEvent('payment.deleted'), true);
  assert.equal(isPaymentWebhookEvent('patient.updated'), false);
});

test('parsePaymentAction maps event suffix', () => {
  assert.equal(parsePaymentAction('payment.created'), 'created');
  assert.equal(parsePaymentAction('payment.updated'), 'updated');
  assert.equal(parsePaymentAction('payment.deleted'), 'deleted');
  assert.equal(parsePaymentAction('invoice.created'), null);
});

test('parseWebhookPayload extracts event object and data', () => {
  const payload = {
    event: 'payment.updated',
    object: 'payment',
    data: { id: 99, amount: '10.0' },
    user: { id: 1 },
  };
  const parsed = parseWebhookPayload(payload);
  assert.equal(parsed.event, 'payment.updated');
  assert.equal(parsed.object, 'payment');
  assert.equal(parsed.data.id, 99);
});

test('extractPaymentId and invoice ids from explanations', () => {
  assert.equal(extractPaymentId({ id: 42 }), 42);
  assert.equal(extractPaymentId({ id: 'bad' }), null);

  const ids = extractInvoiceIdsFromPayment({
    explanations: [
      { invoice_id: 100 },
      { invoice_id: 200 },
      { invoice_id: 100 },
      { amount: '5' },
    ],
  });
  assert.deepEqual(ids, [100, 200]);
});

test('mergeInvoiceIds dedupes preserving order', () => {
  assert.deepEqual(mergeInvoiceIds([1, 2], [2, 3], null), [1, 2, 3]);
});
