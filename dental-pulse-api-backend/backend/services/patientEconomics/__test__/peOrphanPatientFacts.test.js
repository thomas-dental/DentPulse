/**
 * Unit tests for orphan patient-facts grain (store orphans, hide at read helpers).
 *
 * Run: node backend/services/patientEconomics/__test__/peOrphanPatientFacts.test.js
 */

const assert = require('assert');
const {
  patientFactsGrainKey,
  accumulateInvoiceIntoPatientMap,
  patientRowsFromAggMap,
  isMatchedInvoiceListRow,
} = require('../pePatientFactsGrain');
const { filterPatientRows } = require('../pePatientListQuery');

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

console.log('peOrphanPatientFacts\n');

test('patientFactsGrainKey uses UUID when matched', () => {
  assert.strictEqual(
    patientFactsGrainKey({ patient_id: 'aaa-bbb', pt_id: 99 }),
    'aaa-bbb',
  );
});

test('patientFactsGrainKey uses pt: prefix for orphans', () => {
  assert.strictEqual(
    patientFactsGrainKey({ patient_id: null, pt_id: 4242 }),
    'pt:4242',
  );
});

test('patientFactsGrainKey returns null when both missing', () => {
  assert.strictEqual(patientFactsGrainKey({ patient_id: null, pt_id: null }), null);
});

test('accumulateInvoiceIntoPatientMap stores orphan rows', () => {
  const map = new Map();
  accumulateInvoiceIntoPatientMap(map, {
    practice_id: 'org-1',
    patient_id: null,
    pt_id: 777,
    contribution: 10.5,
    revenue_private_plan: 20,
    confidence_score: 80,
  });
  accumulateInvoiceIntoPatientMap(map, {
    practice_id: 'org-1',
    patient_id: null,
    pt_id: 777,
    contribution: 4.5,
    revenue_private_plan: 5,
    confidence_score: 90,
  });

  assert.strictEqual(map.size, 1);
  assert.ok(map.has('pt:777'));
  const agg = map.get('pt:777');
  assert.strictEqual(agg.patient_id, null);
  assert.strictEqual(agg.pt_id, 777);
  assert.strictEqual(agg.invoice_count, 2);
  assert.strictEqual(agg.contribution, 15);
  assert.strictEqual(agg.revenue_private_plan, 25);

  const rows = patientRowsFromAggMap(map, new Map(), new Map());
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].patient_id, null);
  assert.strictEqual(rows[0].pt_id, 777);
  assert.strictEqual(rows[0].contribution, 15);
  assert.strictEqual(rows[0].retention_status, 'active');
});

test('accumulate keeps matched and orphan grains separate', () => {
  const map = new Map();
  accumulateInvoiceIntoPatientMap(map, {
    practice_id: 'org-1',
    patient_id: 'uuid-1',
    pt_id: 1,
    contribution: 100,
    revenue_private_plan: 200,
    confidence_score: 100,
  });
  accumulateInvoiceIntoPatientMap(map, {
    practice_id: 'org-1',
    patient_id: null,
    pt_id: 1,
    contribution: 50,
    revenue_private_plan: 60,
    confidence_score: 70,
  });
  assert.strictEqual(map.size, 2);
  assert.ok(map.has('uuid-1'));
  assert.ok(map.has('pt:1'));
});

test('filterPatientRows keeps orphans for summary math', () => {
  const filtered = filterPatientRows(
    [
      { patientId: 'a', patientName: 'A', retentionStatus: 'active' },
      { patientId: null, patientName: '', ptId: 9, retentionStatus: 'active' },
    ],
    { search: '', retentionFilter: 'all', typeFilter: 'all' },
  );
  assert.strictEqual(filtered.length, 2);
});

test('isDisplayablePatientRow hides orphans from tables', () => {
  const { isDisplayablePatientRow } = require('../pePatientListQuery');
  assert.strictEqual(isDisplayablePatientRow({ patientId: 'a' }), true);
  assert.strictEqual(isDisplayablePatientRow({ patientId: null, ptId: 9 }), false);
  assert.strictEqual(isDisplayablePatientRow({ patientId: '' }), false);
});

test('isMatchedInvoiceListRow requires patientRecordId for table only', () => {
  assert.strictEqual(
    isMatchedInvoiceListRow({ patientRecordId: 'uuid-p', outstandingGbp: 10 }),
    true,
  );
  assert.strictEqual(
    isMatchedInvoiceListRow({ patientRecordId: null, patientId: 99, outstandingGbp: 10 }),
    false,
  );
  assert.strictEqual(isMatchedInvoiceListRow(null), false);
});

test('computePatientListSummary includes orphan contribution', () => {
  const { computePatientListSummary } = require('../pePatientListQuery');
  const summary = computePatientListSummary([
    {
      patientId: 'a',
      isActive: true,
      retentionStatus: 'active',
      contribution12mo: 100,
      patientEconomicValue: 200,
      revenuePrivatePlan: 50,
      hasPaymentPlan: false,
    },
    {
      patientId: null,
      ptId: 9,
      isActive: false,
      retentionStatus: 'active',
      contribution12mo: 50,
      patientEconomicValue: 50,
      revenuePrivatePlan: 0,
      hasPaymentPlan: false,
    },
  ]);
  assert.strictEqual(summary.totalPatients, 2);
  assert.strictEqual(summary.averageContribution, 75);
  assert.strictEqual(summary.averageProjectedLtv, 125);
});

test('patient rollup skips unpaid invoice facts', () => {
  const map = new Map();
  const paid = {
    practice_id: 'org-1',
    patient_id: 'uuid-1',
    pt_id: 1,
    contribution: 100,
    revenue_private_plan: 200,
    confidence_score: 100,
    is_paid: true,
  };
  const unpaid = {
    practice_id: 'org-1',
    patient_id: 'uuid-1',
    pt_id: 1,
    contribution: 50,
    revenue_private_plan: 60,
    confidence_score: 70,
    is_paid: false,
  };
  // Mirror refreshPatientFacts paid gate
  for (const row of [paid, unpaid]) {
    if (!row.is_paid) continue;
    accumulateInvoiceIntoPatientMap(map, row);
  }
  assert.strictEqual(map.get('uuid-1').contribution, 100);
  assert.strictEqual(map.get('uuid-1').invoice_count, 1);
});

console.log(`\n${passed} tests passed`);
