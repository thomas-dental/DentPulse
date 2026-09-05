/**
 * Run: node backend/services/patientEconomics/__test__/peStablePagination.test.js
 */

const assert = require('assert');
const {
  normalizeOrderSpec,
  withStableOrder,
  TABLE_ORDER,
} = require('../peStablePagination');

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

console.log('peStablePagination\n');

test('normalizeOrderSpec maps table names to ascending columns', () => {
  const specs = normalizeOrderSpec('event_ledger');
  assert.deepStrictEqual(specs, [
    { column: 'created_at', ascending: true },
    { column: 'id', ascending: true },
  ]);
});

test('normalizeOrderSpec supports custom descending order', () => {
  const specs = normalizeOrderSpec([
    { column: 'contribution', ascending: false },
    { column: 'patient_id', ascending: true },
  ]);
  assert.deepStrictEqual(specs, [
    { column: 'contribution', ascending: false },
    { column: 'patient_id', ascending: true },
  ]);
});

test('withStableOrder chains .order calls', () => {
  const calls = [];
  const query = {
    order(column, opts) {
      calls.push({ column, ascending: opts.ascending });
      return query;
    },
  };

  withStableOrder(query, TABLE_ORDER.patients);
  assert.deepStrictEqual(calls, [{ column: 'id', ascending: true }]);
});

console.log(`\n${passed} tests passed`);
