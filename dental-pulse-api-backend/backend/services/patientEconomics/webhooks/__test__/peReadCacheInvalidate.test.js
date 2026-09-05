/**
 * Unit tests — PE read cache invalidation after webhooks.
 */

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  withPeReadCache,
  invalidatePeReadCache,
} = require('../../peReadCache');

test('invalidatePeReadCache clears invoice endpoints for practice', async () => {
  const practiceId = crypto.randomUUID();

  await withPeReadCache('invoices-mapped', practiceId, async () => ({ total: 1 }), {
    ttlMs: 600_000,
  });
  await withPeReadCache('invoices-list', practiceId, async () => ({ rows: [] }), {
    ttlMs: 600_000,
  });
  await withPeReadCache('growth-levers', practiceId, async () => ({ ok: true }), {
    ttlMs: 600_000,
  });

  invalidatePeReadCache(practiceId, 'invoices-');

  let invoiceMappedCalls = 0;
  const mapped = await withPeReadCache('invoices-mapped', practiceId, async () => {
    invoiceMappedCalls += 1;
    return { total: 2 };
  });
  assert.equal(mapped.total, 2);
  assert.equal(invoiceMappedCalls, 1);

  let growthCalls = 0;
  const growth = await withPeReadCache('growth-levers', practiceId, async () => {
    growthCalls += 1;
    return { ok: true };
  });
  assert.equal(growth.ok, true);
  assert.equal(growthCalls, 0);
});
