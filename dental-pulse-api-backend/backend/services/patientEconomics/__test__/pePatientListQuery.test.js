/**
 * Unit tests for PE patient list query helpers (filter, sort, summary).
 *
 * Run: node backend/services/patientEconomics/__test__/pePatientListQuery.test.js
 */

const assert = require('assert');
const {
  parsePatientListParams,
  filterPatientRows,
  sortPatientRows,
  computePatientListSummary,
} = require('../pePatientListQuery');

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

const sampleRows = [
  {
    patientId: 'a',
    patientName: 'Alice Smith',
    ptId: 101,
    hasPaymentPlan: true,
    revenuePrivatePlan: 500,
    contribution: 200,
    invoiceCount: 3,
    isActive: true,
    retentionStatus: 'active',
    contribution12mo: 120,
    patientEconomicValue: 1000,
    marginPct: 40,
    opportunityWeighted: 50,
  },
  {
    patientId: 'b',
    patientName: 'Bob NHS',
    ptId: 202,
    hasPaymentPlan: false,
    revenuePrivatePlan: 0,
    contribution: 80,
    invoiceCount: 2,
    isActive: false,
    retentionStatus: 'drifting',
    contribution12mo: 40,
    patientEconomicValue: 200,
    marginPct: null,
    opportunityWeighted: 10,
  },
];

console.log('pePatientListQuery\n');

test('parsePatientListParams defaults', () => {
  const p = parsePatientListParams({});
  assert.strictEqual(p.page, 1);
  assert.strictEqual(p.pageSize, 25);
  assert.strictEqual(p.sortKey, 'contribution');
  assert.strictEqual(p.sortDir, 'desc');
});

test('filterPatientRows by retention chip', () => {
  const filtered = filterPatientRows(sampleRows, {
    search: '',
    retentionFilter: 'drifting',
    typeFilter: 'all',
  });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].patientId, 'b');
});

test('filterPatientRows by member type', () => {
  const filtered = filterPatientRows(sampleRows, {
    search: '',
    retentionFilter: 'all',
    typeFilter: 'member',
  });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].patientId, 'a');
});

test('sortPatientRows by contribution desc', () => {
  const sorted = sortPatientRows(sampleRows, 'contribution', 'desc');
  assert.strictEqual(sorted[0].patientId, 'a');
});

test('computePatientListSummary counts', () => {
  const summary = computePatientListSummary(sampleRows);
  assert.strictEqual(summary.totalPatients, 2);
  assert.strictEqual(summary.retentionDriftingCount, 1);
  assert.strictEqual(summary.memberPatients, 1);
  assert.strictEqual(summary.nhsTypePatients, 1);
});

console.log(`\n${passed} passed`);
