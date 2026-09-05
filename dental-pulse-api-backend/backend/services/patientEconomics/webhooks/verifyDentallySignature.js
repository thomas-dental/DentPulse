/**
 * Verify Dentally webhook HMAC-SHA256 signature (X-Dentally-Signature header).
 * @see https://developer.dentally.co/#signing-webhooks
 */

const crypto = require('crypto');

/**
 * @param {string} rawBody — unparsed request body
 * @param {string|null|undefined} headerSignature — X-Dentally-Signature value
 * @param {string|null|undefined} secret — webhook endpoint secret
 * @returns {boolean}
 */
function verifyDentallySignature(rawBody, headerSignature, secret) {
  if (!secret || typeof secret !== 'string' || secret.trim() === '') return false;
  if (!headerSignature || typeof headerSignature !== 'string') return false;
  if (rawBody == null) return false;

  const body = typeof rawBody === 'string' ? rawBody : String(rawBody);
  const expected = crypto.createHmac('sha256', secret.trim()).update(body).digest('hex');
  const received = headerSignature.trim().toLowerCase();

  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(received, 'hex');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

module.exports = {
  verifyDentallySignature,
};
