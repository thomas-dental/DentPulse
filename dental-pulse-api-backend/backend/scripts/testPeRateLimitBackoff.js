/**
 * Quick verification that PE rate-limit backoff retries 429s then succeeds.
 *
 * Usage: node backend/scripts/testPeRateLimitBackoff.js
 */
const assert = require('assert');

process.env.PE_SYNC_RATE_LIMIT_BASE_MS = '1';
process.env.PE_SYNC_RATE_LIMIT_CAP_MS = '8';
process.env.PE_SYNC_RATE_LIMIT_MAX_RETRIES = '4';

delete require.cache[require.resolve('../services/patientEconomics/sync/rateLimitBackoff')];
const { withRateLimitBackoff, isRateLimitError } = require('../services/patientEconomics/sync/rateLimitBackoff');

function makeRateLimitError() {
  const err = new Error('RATE_LIMIT_EXHAUSTED');
  err.isRateLimit = true;
  return err;
}

async function testBackoffRetriesThenSucceeds() {
  let calls = 0;
  const result = await withRateLimitBackoff('test', async () => {
    calls += 1;
    if (calls <= 2) throw makeRateLimitError();
    return 'ok';
  });

  assert.strictEqual(result, 'ok');
  assert.strictEqual(calls, 3);
  console.log('✓ retries 429 twice then succeeds');
}

async function testBackoffExhaustedThrows() {
  let calls = 0;
  let threw = false;
  try {
    await withRateLimitBackoff('test-exhaust', async () => {
      calls += 1;
      throw makeRateLimitError();
    }, { maxRetries: 2 });
  } catch (err) {
    threw = true;
    assert.ok(isRateLimitError(err));
  }
  assert.ok(threw);
  assert.strictEqual(calls, 3);
  console.log('✓ throws after retries exhausted');
}

async function testNonRateLimitFailsImmediately() {
  let calls = 0;
  await assert.rejects(
    () => withRateLimitBackoff('test-auth', async () => {
      calls += 1;
      throw new Error('Dentally API error (401): unauthorized');
    }),
    /401/
  );
  assert.strictEqual(calls, 1);
  console.log('✓ non-rate-limit errors fail immediately');
}

async function main() {
  await testBackoffRetriesThenSucceeds();
  await testBackoffExhaustedThrows();
  await testNonRateLimitFailsImmediately();
  console.log('All rate-limit backoff tests passed.');
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
