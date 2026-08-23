/**
 * Verify PE sync error classification + retry marking (no live Dentally calls).
 *
 * Usage: node backend/scripts/testPeSyncRetry.js
 */
const assert = require('assert');

process.env.PE_SYNC_MAX_RETRIES = '3';
process.env.PE_SYNC_RETRY_BASE_MS = '1000';
process.env.PE_SYNC_RETRY_CAP_MS = '8000';

delete require.cache[require.resolve('../services/patientEconomics/sync/dentallyErrors')];
delete require.cache[require.resolve('../services/patientEconomics/sync/retryPolicy')];

const {
  classifyDentallyFetchError,
} = require('../services/patientEconomics/sync/dentallyErrors');
const {
  getMaxRetries,
  computeNextRetryAt,
} = require('../services/patientEconomics/sync/retryPolicy');

function testClassifyTransient500() {
  const c = classifyDentallyFetchError(new Error('Dentally API error (500): Internal Server Error'));
  assert.strictEqual(c.kind, 'transient');
  assert.strictEqual(c.code, 'DENTALLY_5XX');
  console.log('✓ 500 → transient');
}

function testClassifyTimeout() {
  const c = classifyDentallyFetchError(new Error('request timeout after 60000ms'));
  assert.strictEqual(c.kind, 'transient');
  assert.strictEqual(c.code, 'NETWORK_TRANSIENT');
  console.log('✓ timeout → transient');
}

function testClassifyRateLimit() {
  const err = new Error('RATE_LIMIT_EXHAUSTED');
  err.isRateLimit = true;
  const c = classifyDentallyFetchError(err);
  assert.strictEqual(c.kind, 'transient');
  assert.strictEqual(c.code, 'RATE_LIMIT_RETRY');
  console.log('✓ rate limit exhausted → transient');
}

function testClassifyAuthNoRetry() {
  const c401 = classifyDentallyFetchError(new Error('Dentally API error (401): Unauthorized'));
  assert.strictEqual(c401.kind, 'pat_auth');
  assert.strictEqual(c401.code, 'PAT_EXPIRED_OR_INVALID');

  const c403 = classifyDentallyFetchError(new Error('Dentally API error (403): Forbidden'));
  assert.strictEqual(c403.kind, 'pat_auth');
  assert.strictEqual(c403.code, 'PAT_EXPIRED_OR_INVALID');
  console.log('✓ 401/403 → pat_auth (no auto-retry category)');
}

function testClassifyUnknown() {
  const c = classifyDentallyFetchError(new Error('something weird happened'));
  assert.strictEqual(c.kind, 'unknown');
  assert.strictEqual(c.code, 'SYNC_ERROR');
  console.log('✓ unknown → unknown');
}

function testBackoffSchedule() {
  assert.strictEqual(getMaxRetries(), 3);
  const t0 = Date.parse('2026-01-01T00:00:00.000Z');
  const r1 = Date.parse(computeNextRetryAt(1, t0));
  const r2 = Date.parse(computeNextRetryAt(2, t0));
  const r3 = Date.parse(computeNextRetryAt(3, t0));
  assert.strictEqual(r1 - t0, 1000);
  assert.strictEqual(r2 - t0, 2000);
  assert.strictEqual(r3 - t0, 4000);
  console.log('✓ exponential backoff 1s → 2s → 4s');
}

/**
 * Simulate handleSyncError decision tree without DB:
 * auth → autoRetry false; transient → autoRetry true until max.
 */
function testRetryDecisionTree() {
  const max = getMaxRetries();

  function decide(kind, retryCount) {
    if (kind === 'pat_auth') {
      return { status: 'failed', autoRetry: false };
    }
    const next = retryCount + 1;
    if (next > max) {
      return { status: 'failed', autoRetry: false, retryCount: next };
    }
    return { status: 'retryable', autoRetry: true, retryCount: next };
  }

  const auth = decide('pat_auth', 0);
  assert.strictEqual(auth.autoRetry, false);
  assert.strictEqual(auth.status, 'failed');

  const t1 = decide('transient', 0);
  assert.strictEqual(t1.autoRetry, true);
  assert.strictEqual(t1.retryCount, 1);

  const tMax = decide('transient', max - 1);
  assert.strictEqual(tMax.autoRetry, true);

  const tExhaust = decide('transient', max);
  assert.strictEqual(tExhaust.autoRetry, false);
  assert.strictEqual(tExhaust.status, 'failed');

  const u1 = decide('unknown', 0);
  assert.strictEqual(u1.autoRetry, true);

  console.log('✓ auth never auto-retries; transient/unknown retry until cap');
}

async function main() {
  testClassifyTransient500();
  testClassifyTimeout();
  testClassifyRateLimit();
  testClassifyAuthNoRetry();
  testClassifyUnknown();
  testBackoffSchedule();
  testRetryDecisionTree();
  console.log('All PE sync retry tests passed.');
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
