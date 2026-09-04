/**
 * Unit tests — Dentally webhook signature verification.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyDentallySignature } = require('../verifyDentallySignature');

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

test('verifyDentallySignature accepts valid HMAC', () => {
  const body = '{"event":"payment.updated","object":"payment","data":{"id":1}}';
  const secret = 'test-secret-key';
  const sig = sign(body, secret);
  assert.equal(verifyDentallySignature(body, sig, secret), true);
});

test('verifyDentallySignature rejects wrong secret', () => {
  const body = '{"event":"payment.updated"}';
  const sig = sign(body, 'correct-secret');
  assert.equal(verifyDentallySignature(body, sig, 'wrong-secret'), false);
});

test('verifyDentallySignature rejects tampered body', () => {
  const body = '{"event":"payment.updated"}';
  const sig = sign(body, 'secret');
  assert.equal(verifyDentallySignature('{"event":"payment.created"}', sig, 'secret'), false);
});

test('verifyDentallySignature rejects missing header or secret', () => {
  const body = '{"event":"payment.updated"}';
  const sig = sign(body, 'secret');
  assert.equal(verifyDentallySignature(body, null, 'secret'), false);
  assert.equal(verifyDentallySignature(body, sig, null), false);
  assert.equal(verifyDentallySignature(body, sig, ''), false);
});
