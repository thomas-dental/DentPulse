/**
 * Unit tests for PE Event Ledger — Day 1 hooks:
 *   PLAN_CREATED, APPOINTMENT_LINKED/UNLINKED, TREATMENT_STARTED
 * including resumed-chunk heal for each.
 *
 * Run: node backend/services/patientEconomics/sync/__test__/eventLedgerWriter.test.js
 */

const assert = require('assert');
const {
  diffTreatmentPlanEvents,
  diffTreatmentAppointmentEvents,
  diffRowEvents,
} = require('../eventLedgerDiff');

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

console.log('eventLedger — PLAN_CREATED / APPOINTMENT_* / TREATMENT_STARTED\n');

// ── PLAN_CREATED ────────────────────────────────────────────────────────────

test('PLAN_CREATED on first insert', () => {
  const events = diffTreatmentPlanEvents(null, {
    tp_id: 101,
    tp_patient_id: 9,
    tp_nickname: 'Plan A',
    tp_private_treatment_value: 250,
    tp_created_at: '2024-01-15T10:00:00Z',
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'PLAN_CREATED');
  assert.strictEqual(events[0].idempotency_key, 'plan_created:101');
  assert.strictEqual(events[0].payload.plan_id, 101);
  assert.strictEqual(events[0].payload.source_table, 'treatment_plans');
});

test('PLAN_CREATED not re-emitted when oldRow exists and no key set', () => {
  const oldRow = { tp_id: 101, tp_patient_id: 9 };
  const events = diffTreatmentPlanEvents(oldRow, {
    tp_id: 101,
    tp_patient_id: 9,
    tp_nickname: 'Plan A updated',
  });
  assert.strictEqual(events.length, 0);
});

test('PLAN_CREATED heal: oldRow exists but ledger key missing (resume)', () => {
  const oldRow = { tp_id: 101, tp_patient_id: 9 };
  const keys = new Set();
  const events = diffTreatmentPlanEvents(
    oldRow,
    { tp_id: 101, tp_patient_id: 9, tp_created_at: '2024-01-15T10:00:00Z' },
    keys,
  );
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].idempotency_key, 'plan_created:101');
});

test('PLAN_CREATED not healed when key already present', () => {
  const oldRow = { tp_id: 101, tp_patient_id: 9 };
  const keys = new Set(['plan_created:101']);
  const events = diffTreatmentPlanEvents(
    oldRow,
    { tp_id: 101, tp_patient_id: 9 },
    keys,
  );
  assert.strictEqual(events.length, 0);
});

test('PLAN_CREATED resumed-chunk: same key after heal, then silent', () => {
  const planRow = { tp_id: 77, tp_patient_id: 3, tp_created_at: '2024-03-01T00:00:00Z' };
  const firstPass = diffTreatmentPlanEvents(null, planRow);
  assert.strictEqual(firstPass[0].idempotency_key, 'plan_created:77');

  const resumePass = diffTreatmentPlanEvents(planRow, planRow, new Set());
  assert.strictEqual(resumePass.length, 1);
  assert.strictEqual(resumePass[0].idempotency_key, firstPass[0].idempotency_key);

  const afterHeal = diffTreatmentPlanEvents(
    planRow,
    planRow,
    new Set(['plan_created:77']),
  );
  assert.strictEqual(afterHeal.length, 0);
});

// ── TREATMENT_STARTED (tp_start_date) ───────────────────────────────────────

test('TREATMENT_STARTED when tp_start_date set from null', () => {
  const events = diffTreatmentPlanEvents(
    { tp_id: 101, tp_patient_id: 9, tp_start_date: null },
    {
      tp_id: 101,
      tp_patient_id: 9,
      tp_start_date: '2024-06-01',
      tp_private_treatment_value: 400,
    },
  );
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'TREATMENT_STARTED');
  assert.strictEqual(events[0].idempotency_key, 'treatment_started:101');
  assert.strictEqual(events[0].payload.tp_start_date, '2024-06-01');
  assert.strictEqual(events[0].payload.start_date, '2024-06-01');
  assert.strictEqual(events[0].payload.source_table, 'treatment_plans');
});

test('insert with start_date already set emits PLAN_CREATED + TREATMENT_STARTED', () => {
  const events = diffTreatmentPlanEvents(null, {
    tp_id: 202,
    tp_patient_id: 9,
    tp_start_date: '2024-07-01',
    tp_created_at: '2024-06-15T00:00:00Z',
  });
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].event_type, 'PLAN_CREATED');
  assert.strictEqual(events[1].event_type, 'TREATMENT_STARTED');
  assert.strictEqual(events[1].idempotency_key, 'treatment_started:202');
});

test('TREATMENT_STARTED not re-emitted when start already set (no key set)', () => {
  const row = {
    tp_id: 101,
    tp_patient_id: 9,
    tp_start_date: '2024-06-01',
  };
  const events = diffTreatmentPlanEvents(row, row);
  assert.strictEqual(events.length, 0);
});

test('TREATMENT_STARTED heal on resume (start set, ledger key missing)', () => {
  const row = {
    tp_id: 101,
    tp_patient_id: 9,
    tp_start_date: '2024-06-01',
  };
  const keys = new Set(['plan_created:101']); // plan ok, started missing
  const events = diffTreatmentPlanEvents(row, row, keys);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'TREATMENT_STARTED');
  assert.strictEqual(events[0].idempotency_key, 'treatment_started:101');
});

test('TREATMENT_STARTED not healed when key already present', () => {
  const row = {
    tp_id: 101,
    tp_patient_id: 9,
    tp_start_date: '2024-06-01',
  };
  const keys = new Set(['plan_created:101', 'treatment_started:101']);
  const events = diffTreatmentPlanEvents(row, row, keys);
  assert.strictEqual(events.length, 0);
});

test('start_date change alone does not re-emit TREATMENT_STARTED', () => {
  const events = diffTreatmentPlanEvents(
    { tp_id: 101, tp_patient_id: 9, tp_start_date: '2024-06-01' },
    { tp_id: 101, tp_patient_id: 9, tp_start_date: '2024-08-01' },
  );
  assert.strictEqual(events.length, 0);
});

test('TREATMENT_STARTED resumed-chunk: same key after heal, then silent', () => {
  const before = { tp_id: 88, tp_patient_id: 1, tp_start_date: null };
  const after = { tp_id: 88, tp_patient_id: 1, tp_start_date: '2024-09-01' };
  const firstPass = diffTreatmentPlanEvents(before, after);
  assert.strictEqual(firstPass[0].idempotency_key, 'treatment_started:88');

  const resumePass = diffTreatmentPlanEvents(after, after, new Set(['plan_created:88']));
  assert.strictEqual(resumePass.length, 1);
  assert.strictEqual(resumePass[0].idempotency_key, firstPass[0].idempotency_key);

  const afterHeal = diffTreatmentPlanEvents(
    after,
    after,
    new Set(['plan_created:88', 'treatment_started:88']),
  );
  assert.strictEqual(afterHeal.length, 0);
});

// ── APPOINTMENT_LINKED / UNLINKED ───────────────────────────────────────────

test('APPOINTMENT_LINKED when ta_appointment_id set from null', () => {
  const events = diffTreatmentAppointmentEvents(
    { ta_id: 50, ta_appointment_id: null, ta_patient_id: 9, ta_treatment_plan_id: 101 },
    {
      ta_id: 50,
      ta_appointment_id: 9001,
      ta_patient_id: 9,
      ta_treatment_plan_id: 101,
      ta_updated_at: '2024-02-01T12:00:00Z',
    },
  );
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'APPOINTMENT_LINKED');
  assert.strictEqual(events[0].idempotency_key, 'appointment_linked:50:9001');
  assert.strictEqual(events[0].payload.appointment_id, 9001);
  assert.strictEqual(events[0].payload.source_table, 'treatment_appointments');
});

test('APPOINTMENT_UNLINKED when ta_appointment_id cleared', () => {
  const events = diffTreatmentAppointmentEvents(
    { ta_id: 50, ta_appointment_id: 9001, ta_patient_id: 9, ta_treatment_plan_id: 101 },
    {
      ta_id: 50,
      ta_appointment_id: null,
      ta_patient_id: 9,
      ta_treatment_plan_id: 101,
    },
  );
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'APPOINTMENT_UNLINKED');
  assert.strictEqual(events[0].idempotency_key, 'appointment_unlinked:50:9001');
  assert.strictEqual(events[0].payload.previous_ta_appointment_id, 9001);
});

test('relink emits UNLINKED then LINKED', () => {
  const events = diffTreatmentAppointmentEvents(
    { ta_id: 50, ta_appointment_id: 9001, ta_patient_id: 9, ta_treatment_plan_id: 101 },
    {
      ta_id: 50,
      ta_appointment_id: 9002,
      ta_patient_id: 9,
      ta_treatment_plan_id: 101,
    },
  );
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].event_type, 'APPOINTMENT_UNLINKED');
  assert.strictEqual(events[0].idempotency_key, 'appointment_unlinked:50:9001');
  assert.strictEqual(events[1].event_type, 'APPOINTMENT_LINKED');
  assert.strictEqual(events[1].idempotency_key, 'appointment_linked:50:9002');
});

test('unchanged link emits nothing without key set', () => {
  const row = {
    ta_id: 50,
    ta_appointment_id: 9001,
    ta_patient_id: 9,
    ta_treatment_plan_id: 101,
  };
  const events = diffTreatmentAppointmentEvents(row, row);
  assert.strictEqual(events.length, 0);
});

test('APPOINTMENT_LINKED heal on resume (source upserted, ledger missing)', () => {
  const row = {
    ta_id: 50,
    ta_appointment_id: 9001,
    ta_patient_id: 9,
    ta_treatment_plan_id: 101,
  };
  const keys = new Set();
  const events = diffTreatmentAppointmentEvents(row, row, keys);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'APPOINTMENT_LINKED');
  assert.strictEqual(events[0].idempotency_key, 'appointment_linked:50:9001');
});

test('no heal when LINKED key already present', () => {
  const row = {
    ta_id: 50,
    ta_appointment_id: 9001,
    ta_patient_id: 9,
    ta_treatment_plan_id: 101,
  };
  const keys = new Set(['appointment_linked:50:9001']);
  const events = diffTreatmentAppointmentEvents(row, row, keys);
  assert.strictEqual(events.length, 0);
});

test('APPOINTMENT_LINKED resumed-chunk: same key after heal, then silent', () => {
  const before = {
    ta_id: 60,
    ta_appointment_id: null,
    ta_patient_id: 2,
    ta_treatment_plan_id: 10,
  };
  const after = {
    ta_id: 60,
    ta_appointment_id: 7000,
    ta_patient_id: 2,
    ta_treatment_plan_id: 10,
  };
  const firstPass = diffTreatmentAppointmentEvents(before, after);
  assert.strictEqual(firstPass[0].idempotency_key, 'appointment_linked:60:7000');

  const resumePass = diffTreatmentAppointmentEvents(after, after, new Set());
  assert.strictEqual(resumePass.length, 1);
  assert.strictEqual(resumePass[0].idempotency_key, firstPass[0].idempotency_key);

  const afterHeal = diffTreatmentAppointmentEvents(
    after,
    after,
    new Set(['appointment_linked:60:7000']),
  );
  assert.strictEqual(afterHeal.length, 0);
});

// ── routing ─────────────────────────────────────────────────────────────────

test('diffRowEvents routes by entity alias', () => {
  const plan = diffRowEvents('treatment_plans', null, { tp_id: 1, tp_patient_id: 2 });
  assert.strictEqual(plan[0].event_type, 'PLAN_CREATED');
  const other = diffRowEvents('appointments', null, { apmt_id: 1 });
  assert.strictEqual(other.length, 0);
});

test('first insert with empty ledger key set still emits PLAN_CREATED once', () => {
  const events = diffTreatmentPlanEvents(
    null,
    { tp_id: 5, tp_patient_id: 1 },
    new Set(),
  );
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'PLAN_CREATED');
});

console.log(`\n${passed} tests passed`);
