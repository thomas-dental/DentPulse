/**
 * Unit tests for period coverage flags and period sync cursor stop logic.
 * Pure logic only — no Supabase imports.
 *
 * Run: node backend/services/patientEconomics/sync/__test__/periodCoverage.test.js
 */

const assert = require('assert');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/** Mirrors periodCoverage.derivePeriodCoverageFlags */
function derivePeriodCoverageFlags(configuredStart, startDate, hasData) {
  const beforeConfiguredStart = startDate < configuredStart;
  const needsSync = beforeConfiguredStart || !hasData;
  return { beforeConfiguredStart, needsSync, hasData };
}

/** Mirrors cursorStore.dayAfter */
function dayAfter(yyyyMmDd) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Mirrors kickoffPeriod date validation */
function validateKickoffPeriodDates(startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) {
    throw new Error('kickoffPeriod requires valid startDate and endDate (YYYY-MM-DD)');
  }
}

console.log('periodCoverage — derivePeriodCoverageFlags\n');

test('needsSync when period has no synced data', () => {
  const flags = derivePeriodCoverageFlags('2024-01-01', '2026-09-01', false);
  assert.strictEqual(flags.needsSync, true);
  assert.strictEqual(flags.beforeConfiguredStart, false);
});

test('needsSync when start before configured sync start', () => {
  const flags = derivePeriodCoverageFlags('2025-06-01', '2025-01-01', true);
  assert.strictEqual(flags.needsSync, true);
  assert.strictEqual(flags.beforeConfiguredStart, true);
});

test('no sync needed when data exists within configured range', () => {
  const flags = derivePeriodCoverageFlags('2024-01-01', '2026-09-01', true);
  assert.strictEqual(flags.needsSync, false);
  assert.strictEqual(flags.beforeConfiguredStart, false);
});

console.log('\nperiod sync — stop at periodSyncEnd\n');

function shouldCompletePeriodSync(chunkEnd, periodSyncEnd) {
  const nextStart = dayAfter(chunkEnd);
  return Boolean(periodSyncEnd && nextStart > periodSyncEnd);
}

test('period sync completes when next chunk start is after period end', () => {
  assert.strictEqual(shouldCompletePeriodSync('2026-09-30', '2026-09-30'), true);
  assert.strictEqual(shouldCompletePeriodSync('2026-09-15', '2026-09-30'), false);
});

test('incremental sync does not stop when periodSyncEnd unset', () => {
  assert.strictEqual(shouldCompletePeriodSync('2026-09-30', null), false);
});

console.log('\nkickoffPeriod — validation\n');

test('kickoffPeriod rejects inverted date range', () => {
  let threw = false;
  try {
    validateKickoffPeriodDates('2026-09-30', '2026-09-01');
  } catch (err) {
    threw = true;
    assert.match(err.message, /valid startDate and endDate/);
  }
  assert.strictEqual(threw, true);
});

console.log(`\n${passed} tests passed`);
