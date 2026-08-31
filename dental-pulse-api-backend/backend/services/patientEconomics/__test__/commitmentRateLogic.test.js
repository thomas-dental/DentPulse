/**
 * Unit tests — 30-day value-weighted Commitment Rate (no DB).
 */

const assert = require('assert');
const {
  aggregatePlansFromLedger,
  computePracticeCommitmentRate,
  isEligiblePrivatePlanItem,
  weightOpenPlansByCommitmentRate,
  daysBetweenUtc,
  computeCommitmentRatesByWindows,
  computeCommitmentRateByClinician,
  DEFAULT_COMMITMENT_RATE_WINDOW_DAYS,
} = require('../commitmentRateLogic');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('commitmentRateLogic\n');

test('excludes NHS treatment items', () => {
  assert.strictEqual(
    isEligiblePrivatePlanItem({ value: 100, treatmentType: 'nhs', treatmentId: '1' }),
    false,
  );
  assert.strictEqual(
    isEligiblePrivatePlanItem({ value: 100, treatmentType: 'private', treatmentId: '1' }),
    true,
  );
});

test('value-weighted rate within 30-day window', () => {
  const ledgerRows = [
    {
      patient_id: 'p1',
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      payload: { plan_id: '100', planned_value: 1000 },
    },
    {
      patient_id: 'p1',
      event_type: 'APPOINTMENT_LINKED',
      created_at: '2024-01-15T00:00:00Z',
      payload: { plan_id: '100' },
    },
    {
      patient_id: 'p2',
      event_type: 'PLAN_CREATED',
      created_at: '2024-02-01T00:00:00Z',
      payload: { plan_id: '101', planned_value: 500 },
    },
  ];

  const plans = aggregatePlansFromLedger(ledgerRows);
  const items = [
    { planId: '100', value: 800, treatmentType: 'private', treatmentId: '10' },
    { planId: '100', value: 200, treatmentType: 'private', treatmentId: '11' },
    { planId: '101', value: 500, treatmentType: 'private', treatmentId: '12' },
  ];

  const result = computePracticeCommitmentRate(plans, items, 30);

  assert.strictEqual(result.totalEligibleValue, 1500);
  assert.strictEqual(result.committedValueWithinWindow, 1000);
  assert.strictEqual(result.commitmentRate, 1000 / 1500);
  assert.strictEqual(result.eligibleItemCount, 3);
  assert.strictEqual(result.committedItemCount, 2);
  assert.strictEqual(daysBetweenUtc('2024-01-01T00:00:00Z', '2024-01-15T00:00:00Z'), 14);
});

test('link after window does not count toward committed value', () => {
  const ledgerRows = [
    {
      patient_id: 'p1',
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      payload: { plan_id: '100' },
    },
    {
      patient_id: 'p1',
      event_type: 'APPOINTMENT_LINKED',
      created_at: '2024-02-15T00:00:00Z',
      payload: { plan_id: '100' },
    },
  ];

  const plans = aggregatePlansFromLedger(ledgerRows);
  const items = [{ planId: '100', value: 300, treatmentType: 'private', treatmentId: '1' }];

  const result = computePracticeCommitmentRate(plans, items, 30);
  assert.strictEqual(result.committedValueWithinWindow, 0);
  assert.strictEqual(result.commitmentRate, 0);
});

test('open plan weighted by practice commitment rate', () => {
  const ledgerRows = [
    {
      patient_id: 'p1',
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      payload: { plan_id: '200', planned_value: 400 },
    },
    {
      patient_id: 'p2',
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      payload: { plan_id: '201', planned_value: 600 },
    },
    {
      patient_id: 'p1',
      event_type: 'APPOINTMENT_LINKED',
      created_at: '2024-01-10T00:00:00Z',
      payload: { plan_id: '200' },
    },
  ];

  const plans = aggregatePlansFromLedger(ledgerRows);
  const commitmentResult = computePracticeCommitmentRate(
    plans,
    [
      { planId: '200', value: 400, treatmentType: 'private', treatmentId: '1' },
      { planId: '201', value: 600, treatmentType: 'private', treatmentId: '2' },
    ],
    DEFAULT_COMMITMENT_RATE_WINDOW_DAYS,
  );

  const { byPatient } = weightOpenPlansByCommitmentRate(plans, commitmentResult);
  const open = byPatient.get('p2');
  assert.ok(open);
  assert.strictEqual(open.gross, 600);
  assert.strictEqual(open.weighted, 600 * commitmentResult.commitmentRate);
});

test('multi-window rates decrease or stay flat as window widens', () => {
  const ledgerRows = [
    {
      patient_id: 'p1',
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      payload: { plan_id: '100', planned_value: 1000 },
    },
    {
      patient_id: 'p1',
      event_type: 'APPOINTMENT_LINKED',
      created_at: '2024-01-20T00:00:00Z',
      payload: { plan_id: '100' },
    },
  ];
  const plans = aggregatePlansFromLedger(ledgerRows);
  const items = [
    { planId: '100', value: 1000, treatmentType: 'private', treatmentId: '10' },
  ];
  const windows = computeCommitmentRatesByWindows(plans, items, [7, 30, 60, 90]);
  assert.strictEqual(windows[0].commitmentRate, 0);
  assert.strictEqual(windows[1].commitmentRate, 1);
  assert.strictEqual(windows[2].commitmentRate, 1);
});

test('by-clinician groups on practitionerExtId', () => {
  const ledgerRows = [
    {
      patient_id: 'p1',
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      payload: { plan_id: '100', planned_value: 500 },
    },
    {
      patient_id: 'p2',
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      payload: { plan_id: '101', planned_value: 300 },
    },
    {
      patient_id: 'p1',
      event_type: 'APPOINTMENT_LINKED',
      created_at: '2024-01-05T00:00:00Z',
      payload: { plan_id: '100' },
    },
  ];
  const plans = aggregatePlansFromLedger(ledgerRows);
  const items = [
    {
      planId: '100',
      value: 500,
      treatmentType: 'private',
      treatmentId: '10',
      practitionerExtId: '42',
    },
    {
      planId: '101',
      value: 300,
      treatmentType: 'private',
      treatmentId: '11',
      practitionerExtId: '99',
    },
  ];
  const rows = computeCommitmentRateByClinician(plans, items, 30);
  assert.strictEqual(rows.length, 2);
  const dr42 = rows.find((r) => r.practitionerExtId === '42');
  const dr99 = rows.find((r) => r.practitionerExtId === '99');
  assert.strictEqual(dr42.commitmentRate, 1);
  assert.strictEqual(dr99.commitmentRate, 0);
});

console.log('\nAll commitmentRateLogic tests passed.\n');
