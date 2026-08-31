/**
 * Unit tests — planned > N days unscheduled leakage (no DB).
 */

const assert = require('assert');
const {
  aggregatePlansFromLedger,
} = require('../commitmentRateLogic');
const {
  buildPlannedUnscheduledLeakageRows,
  summarizeLeakageRows,
  DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS,
} = require('../plannedUnscheduledLeakageLogic');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('plannedUnscheduledLeakageLogic\n');

test('includes unscheduled private item beyond threshold', () => {
  const ledgerRows = [
    {
      patient_id: 'pat-1',
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      payload: { plan_id: '100', planned_value: 1200 },
    },
  ];
  const plans = aggregatePlansFromLedger(ledgerRows);
  const items = [
    { planId: '100', tpiId: 'tpi-1', value: 1200, treatmentType: 'private', treatmentId: '10' },
  ];
  const patientNames = new Map([['pat-1', 'Jane Doe']]);

  const rows = buildPlannedUnscheduledLeakageRows(
    plans,
    items,
    60,
    patientNames,
    '2024-03-15T00:00:00Z',
  );

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].patientName, 'Jane Doe');
  assert.strictEqual(rows[0].treatmentValue, 1200);
  assert.strictEqual(rows[0].daysUnscheduled, 74);
});

test('excludes item within threshold and linked appointments', () => {
  const ledgerRows = [
    {
      patient_id: 'pat-1',
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      payload: { plan_id: '100', planned_value: 500 },
    },
    {
      patient_id: 'pat-1',
      event_type: 'APPOINTMENT_LINKED',
      created_at: '2024-01-20T00:00:00Z',
      payload: { plan_id: '100' },
    },
    {
      patient_id: 'pat-2',
      event_type: 'PLAN_CREATED',
      created_at: '2024-02-01T00:00:00Z',
      payload: { plan_id: '101', planned_value: 300 },
    },
  ];
  const plans = aggregatePlansFromLedger(ledgerRows);
  const items = [
    { planId: '100', tpiId: 'tpi-1', value: 500, treatmentType: 'private', treatmentId: '10' },
    { planId: '101', tpiId: 'tpi-2', value: 300, treatmentType: 'private', treatmentId: '11' },
  ];

  const rows = buildPlannedUnscheduledLeakageRows(
    plans,
    items,
    60,
    new Map(),
    '2024-02-15T00:00:00Z',
  );

  assert.strictEqual(rows.length, 0);
});

test('excludes NHS and sorts by treatment value descending', () => {
  const ledgerRows = [
    {
      patient_id: 'pat-1',
      event_type: 'PLAN_CREATED',
      created_at: '2023-01-01T00:00:00Z',
      payload: { plan_id: '100', planned_value: 200 },
    },
    {
      patient_id: 'pat-2',
      event_type: 'PLAN_CREATED',
      created_at: '2023-01-01T00:00:00Z',
      payload: { plan_id: '101', planned_value: 900 },
    },
  ];
  const plans = aggregatePlansFromLedger(ledgerRows);
  const items = [
    { planId: '100', tpiId: 'tpi-1', value: 200, treatmentType: 'nhs', treatmentId: '10' },
    { planId: '101', tpiId: 'tpi-2', value: 900, treatmentType: 'private', treatmentId: '11' },
    { planId: '100', tpiId: 'tpi-3', value: 50, treatmentType: 'private', treatmentId: '12' },
  ];

  const rows = buildPlannedUnscheduledLeakageRows(plans, items, 60, new Map(), '2024-06-01T00:00:00Z');

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].treatmentValue, 900);
  assert.strictEqual(rows[1].treatmentValue, 50);

  const summary = summarizeLeakageRows(rows);
  assert.strictEqual(summary.itemCount, 2);
  assert.strictEqual(summary.totalValueAtRisk, 950);
});

test('default threshold constant is 60', () => {
  assert.strictEqual(DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS, 60);
});

console.log('\nAll plannedUnscheduledLeakageLogic tests passed.\n');
