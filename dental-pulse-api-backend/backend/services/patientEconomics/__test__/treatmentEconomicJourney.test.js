/**
 * Unit tests for Treatment Economic Journey ledger-only aggregation.
 *
 * Run: node backend/services/patientEconomics/__test__/treatmentEconomicJourney.test.js
 */

const assert = require('assert');
const {
  payloadGbp,
  payloadPtId,
  rowMatchesLocationScope,
  aggregateFunnelRows,
} = require('../treatmentEconomicJourneyLedger');

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

console.log('treatmentEconomicJourney — ledger aggregation\n');

test('payloadGbp prefers planned_value', () => {
  assert.strictEqual(payloadGbp({ planned_value: 120, amount: 50 }), 120);
});

test('payloadPtId reads pt_id and entity patient fields', () => {
  assert.strictEqual(payloadPtId({ pt_id: 9 }), 9);
  assert.strictEqual(payloadPtId({ tp_patient_id: 42 }), 42);
});

test('rowMatchesLocationScope matches location_id column', () => {
  assert.strictEqual(
    rowMatchesLocationScope({ location_id: 'loc-1' }, null, null, 'loc-1'),
    true,
  );
  assert.strictEqual(
    rowMatchesLocationScope({ location_id: 'loc-2' }, null, null, 'loc-1'),
    false,
  );
});

test('rowMatchesLocationScope matches patient_id fallback', () => {
  const patientIdSet = new Set(['uuid-1']);
  assert.strictEqual(
    rowMatchesLocationScope({ patient_id: 'uuid-1', payload: {} }, patientIdSet, null),
    true,
  );
  assert.strictEqual(
    rowMatchesLocationScope({ patient_id: 'uuid-2', payload: {} }, patientIdSet, null),
    false,
  );
});

test('rowMatchesLocationScope matches orphan payload pt_id', () => {
  const ptIdSet = new Set([99]);
  assert.strictEqual(
    rowMatchesLocationScope(
      { patient_id: null, payload: { pt_id: 99, plan_id: 1 } },
      new Set(),
      ptIdSet,
    ),
    true,
  );
});

test('aggregateFunnelRows counts all journey event types from ledger rows', () => {
  const byType = new Map([
    ['PLAN_CREATED', { eventCount: 0, valueGbp: 0 }],
    ['APPOINTMENT_LINKED', { eventCount: 0, valueGbp: 0 }],
    ['TREATMENT_STARTED', { eventCount: 0, valueGbp: 0 }],
    ['PLAN_COMPLETED', { eventCount: 0, valueGbp: 0 }],
    ['INVOICE_RAISED', { eventCount: 0, valueGbp: 0 }],
    ['PAYMENT_ALLOCATED', { eventCount: 0, valueGbp: 0 }],
  ]);
  const scheduledPlanValue = new Map();

  aggregateFunnelRows(
    [
      {
        event_type: 'PLAN_CREATED',
        payload: { planned_value: 100 },
      },
      {
        event_type: 'APPOINTMENT_LINKED',
        payload: { plan_id: 7, planned_value: 100 },
      },
      {
        event_type: 'INVOICE_RAISED',
        payload: { amount: 80 },
      },
    ],
    byType,
    scheduledPlanValue,
  );

  assert.strictEqual(byType.get('PLAN_CREATED').eventCount, 1);
  assert.strictEqual(byType.get('PLAN_CREATED').valueGbp, 100);
  assert.strictEqual(byType.get('APPOINTMENT_LINKED').eventCount, 1);
  assert.strictEqual(scheduledPlanValue.get('7'), 100);
  assert.strictEqual(byType.get('INVOICE_RAISED').valueGbp, 80);
});

console.log(`\n${passed} tests passed`);
