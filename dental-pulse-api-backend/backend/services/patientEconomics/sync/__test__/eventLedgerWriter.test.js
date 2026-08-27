/**
 * Unit tests for PE Event Ledger — all 8 event types:
 *   Day 1: PLAN_CREATED, APPOINTMENT_LINKED/UNLINKED, TREATMENT_STARTED
 *   + PLAN_COMPLETED, ITEM_COMPLETED, INVOICE_RAISED
 *   + PAYMENT_ALLOCATED, RECALL_DUE/OVERDUE, PATIENT_REACTIVATED
 * including resumed-chunk heal where applicable.
 *
 * Run: node backend/services/patientEconomics/sync/__test__/eventLedgerWriter.test.js
 */

const assert = require('assert');
const {
  diffTreatmentPlanEvents,
  diffTreatmentAppointmentEvents,
  diffTreatmentItemEvents,
  diffInvoiceEvents,
  diffPaymentEvents,
  diffPatientEvents,
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

// ── PLAN_COMPLETED (tp_completed_at / tp_is_completed) ──────────────────────

console.log('\neventLedger — PLAN_COMPLETED\n');

test('PLAN_COMPLETED when tp_completed_at set from null', () => {
  const events = diffTreatmentPlanEvents(
    { tp_id: 101, tp_patient_id: 9, tp_completed_at: null, tp_is_completed: false },
    {
      tp_id: 101,
      tp_patient_id: 9,
      tp_completed_at: '2024-10-01T12:00:00Z',
      tp_is_completed: true,
      tp_private_treatment_value: 500,
    },
  );
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'PLAN_COMPLETED');
  assert.strictEqual(events[0].idempotency_key, 'plan_completed:101');
  assert.strictEqual(events[0].payload.tp_completed_at, '2024-10-01T12:00:00Z');
  assert.strictEqual(events[0].payload.completed_at, '2024-10-01T12:00:00Z');
  assert.strictEqual(events[0].payload.source_table, 'treatment_plans');
});

test('insert already completed emits PLAN_CREATED + PLAN_COMPLETED', () => {
  const events = diffTreatmentPlanEvents(null, {
    tp_id: 303,
    tp_patient_id: 9,
    tp_completed_at: '2024-10-02T00:00:00Z',
    tp_is_completed: true,
    tp_created_at: '2024-01-01T00:00:00Z',
  });
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].event_type, 'PLAN_CREATED');
  assert.strictEqual(events[1].event_type, 'PLAN_COMPLETED');
  assert.strictEqual(events[1].idempotency_key, 'plan_completed:303');
});

test('PLAN_COMPLETED not re-emitted when already completed (no key set)', () => {
  const row = {
    tp_id: 101,
    tp_patient_id: 9,
    tp_completed_at: '2024-10-01T12:00:00Z',
    tp_is_completed: true,
  };
  const events = diffTreatmentPlanEvents(row, row);
  assert.strictEqual(events.length, 0);
});

test('PLAN_COMPLETED heal on resume (completed set, ledger key missing)', () => {
  const row = {
    tp_id: 101,
    tp_patient_id: 9,
    tp_completed_at: '2024-10-01T12:00:00Z',
    tp_is_completed: true,
  };
  const keys = new Set(['plan_created:101']);
  const events = diffTreatmentPlanEvents(row, row, keys);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'PLAN_COMPLETED');
  assert.strictEqual(events[0].idempotency_key, 'plan_completed:101');
});

test('PLAN_COMPLETED not healed when key already present', () => {
  const row = {
    tp_id: 101,
    tp_patient_id: 9,
    tp_completed_at: '2024-10-01T12:00:00Z',
    tp_is_completed: true,
  };
  const keys = new Set(['plan_created:101', 'plan_completed:101']);
  const events = diffTreatmentPlanEvents(row, row, keys);
  assert.strictEqual(events.length, 0);
});

test('completed_at change alone does not re-emit PLAN_COMPLETED', () => {
  const events = diffTreatmentPlanEvents(
    {
      tp_id: 101,
      tp_patient_id: 9,
      tp_completed_at: '2024-10-01T12:00:00Z',
      tp_is_completed: true,
    },
    {
      tp_id: 101,
      tp_patient_id: 9,
      tp_completed_at: '2024-11-01T12:00:00Z',
      tp_is_completed: true,
    },
  );
  assert.strictEqual(events.length, 0);
});

test('PLAN_COMPLETED resumed-chunk: same key after heal, then silent', () => {
  const before = {
    tp_id: 88,
    tp_patient_id: 1,
    tp_completed_at: null,
    tp_is_completed: false,
  };
  const after = {
    tp_id: 88,
    tp_patient_id: 1,
    tp_completed_at: '2024-12-01T00:00:00Z',
    tp_is_completed: true,
  };
  const firstPass = diffTreatmentPlanEvents(before, after);
  assert.strictEqual(firstPass[0].idempotency_key, 'plan_completed:88');

  const resumePass = diffTreatmentPlanEvents(after, after, new Set(['plan_created:88']));
  assert.strictEqual(resumePass.length, 1);
  assert.strictEqual(resumePass[0].idempotency_key, firstPass[0].idempotency_key);

  const afterHeal = diffTreatmentPlanEvents(
    after,
    after,
    new Set(['plan_created:88', 'plan_completed:88']),
  );
  assert.strictEqual(afterHeal.length, 0);
});

// ── ITEM_COMPLETED ──────────────────────────────────────────────────────────

console.log('\neventLedger — ITEM_COMPLETED\n');

test('ITEM_COMPLETED when tpi_completed set from false', () => {
  const events = diffTreatmentItemEvents(
    {
      tpi_id: 501,
      tpi_patient_id: 9,
      tpi_treatment_plan_id: 101,
      tpi_completed: false,
      tpi_completed_at: null,
    },
    {
      tpi_id: 501,
      tpi_patient_id: 9,
      tpi_treatment_plan_id: 101,
      tpi_completed: true,
      tpi_completed_at: '2024-05-01T10:00:00Z',
      tpi_price: 120,
    },
  );
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'ITEM_COMPLETED');
  assert.strictEqual(events[0].idempotency_key, 'item_completed:501');
  assert.strictEqual(events[0].payload.treatment_item_id, 501);
  assert.strictEqual(events[0].payload.plan_id, 101);
  assert.strictEqual(events[0].payload.completed_at, '2024-05-01T10:00:00Z');
  assert.strictEqual(events[0].payload.value, 120);
  assert.strictEqual(events[0].payload.source_table, 'treatment_plan_items');
});

test('ITEM_COMPLETED via tpi_completed_at alone', () => {
  const events = diffTreatmentItemEvents(
    { tpi_id: 502, tpi_patient_id: 9, tpi_completed: false, tpi_completed_at: null },
    {
      tpi_id: 502,
      tpi_patient_id: 9,
      tpi_treatment_plan_id: 10,
      tpi_completed: false,
      tpi_completed_at: '2024-05-02T00:00:00Z',
    },
  );
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'ITEM_COMPLETED');
  assert.strictEqual(events[0].idempotency_key, 'item_completed:502');
});

test('insert already completed emits ITEM_COMPLETED', () => {
  const events = diffTreatmentItemEvents(null, {
    tpi_id: 503,
    tpi_patient_id: 9,
    tpi_treatment_plan_id: 11,
    tpi_completed: true,
    tpi_completed_at: '2024-05-03T00:00:00Z',
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'ITEM_COMPLETED');
});

test('ITEM_COMPLETED not re-emitted when already completed (no key set)', () => {
  const row = {
    tpi_id: 501,
    tpi_patient_id: 9,
    tpi_completed: true,
    tpi_completed_at: '2024-05-01T10:00:00Z',
  };
  const events = diffTreatmentItemEvents(row, row);
  assert.strictEqual(events.length, 0);
});

test('ITEM_COMPLETED heal on resume', () => {
  const row = {
    tpi_id: 501,
    tpi_patient_id: 9,
    tpi_treatment_plan_id: 101,
    tpi_completed: true,
    tpi_completed_at: '2024-05-01T10:00:00Z',
  };
  const events = diffTreatmentItemEvents(row, row, new Set());
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].idempotency_key, 'item_completed:501');
});

test('ITEM_COMPLETED not healed when key already present', () => {
  const row = {
    tpi_id: 501,
    tpi_patient_id: 9,
    tpi_completed: true,
    tpi_completed_at: '2024-05-01T10:00:00Z',
  };
  const events = diffTreatmentItemEvents(row, row, new Set(['item_completed:501']));
  assert.strictEqual(events.length, 0);
});

test('ITEM_COMPLETED resumed-chunk: same key after heal, then silent', () => {
  const before = {
    tpi_id: 600,
    tpi_patient_id: 2,
    tpi_treatment_plan_id: 10,
    tpi_completed: false,
  };
  const after = {
    tpi_id: 600,
    tpi_patient_id: 2,
    tpi_treatment_plan_id: 10,
    tpi_completed: true,
    tpi_completed_at: '2024-06-01T00:00:00Z',
  };
  const firstPass = diffTreatmentItemEvents(before, after);
  assert.strictEqual(firstPass[0].idempotency_key, 'item_completed:600');

  const resumePass = diffTreatmentItemEvents(after, after, new Set());
  assert.strictEqual(resumePass.length, 1);
  assert.strictEqual(resumePass[0].idempotency_key, firstPass[0].idempotency_key);

  const afterHeal = diffTreatmentItemEvents(
    after,
    after,
    new Set(['item_completed:600']),
  );
  assert.strictEqual(afterHeal.length, 0);
});

// ── INVOICE_RAISED ──────────────────────────────────────────────────────────

console.log('\neventLedger — INVOICE_RAISED\n');

test('INVOICE_RAISED on first insert', () => {
  const events = diffInvoiceEvents(null, {
    platform_invoice_id: '9001',
    patient_id: 9,
    subtotal: 350.5,
    invoice_date: '2024-08-15',
    api_record_created_at: '2024-08-15T09:00:00Z',
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'INVOICE_RAISED');
  assert.strictEqual(events[0].idempotency_key, 'invoice_raised:9001');
  assert.strictEqual(events[0].payload.invoice_id, 9001);
  assert.strictEqual(events[0].payload.amount, 350.5);
  assert.strictEqual(events[0].payload.total, 350.5);
  assert.strictEqual(events[0].payload.raised_at, '2024-08-15');
  assert.strictEqual(events[0].payload.source_table, 'platform_integration_invoices');
});

test('INVOICE_RAISED not re-emitted when oldRow exists and no key set', () => {
  const oldRow = { platform_invoice_id: '9001', patient_id: 9, subtotal: 350.5 };
  const events = diffInvoiceEvents(oldRow, {
    platform_invoice_id: '9001',
    patient_id: 9,
    subtotal: 400,
    invoice_date: '2024-08-15',
  });
  assert.strictEqual(events.length, 0);
});

test('INVOICE_RAISED heal: oldRow exists but ledger key missing (resume)', () => {
  const row = {
    platform_invoice_id: '9001',
    patient_id: 9,
    subtotal: 350.5,
    invoice_date: '2024-08-15',
  };
  const events = diffInvoiceEvents(row, row, new Set());
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].idempotency_key, 'invoice_raised:9001');
});

test('INVOICE_RAISED not healed when key already present', () => {
  const row = {
    platform_invoice_id: '9001',
    patient_id: 9,
    subtotal: 350.5,
  };
  const events = diffInvoiceEvents(row, row, new Set(['invoice_raised:9001']));
  assert.strictEqual(events.length, 0);
});

test('INVOICE_RAISED resumed-chunk: same key after heal, then silent', () => {
  const invoiceRow = {
    platform_invoice_id: '777',
    patient_id: 3,
    subtotal: 99,
    invoice_date: '2024-09-01',
  };
  const firstPass = diffInvoiceEvents(null, invoiceRow);
  assert.strictEqual(firstPass[0].idempotency_key, 'invoice_raised:777');

  const resumePass = diffInvoiceEvents(invoiceRow, invoiceRow, new Set());
  assert.strictEqual(resumePass.length, 1);
  assert.strictEqual(resumePass[0].idempotency_key, firstPass[0].idempotency_key);

  const afterHeal = diffInvoiceEvents(
    invoiceRow,
    invoiceRow,
    new Set(['invoice_raised:777']),
  );
  assert.strictEqual(afterHeal.length, 0);
});

// ── APPOINTMENT_LINKED / UNLINKED ───────────────────────────────────────────

console.log('\neventLedger — APPOINTMENT_LINKED / UNLINKED\n');

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

// ── PAYMENT_ALLOCATED ───────────────────────────────────────────────────────

console.log('\neventLedger — PAYMENT_ALLOCATED\n');

test('PAYMENT_ALLOCATED on first insert with invoice explanation', () => {
  const events = diffPaymentEvents(null, {
    dp_id: 1001,
    dp_patient_id: 9,
    dp_amount: 200,
    dp_dated_on: '2024-08-20',
    _explanations: [{ id: 1, invoice_id: 9001, amount: 200 }],
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'PAYMENT_ALLOCATED');
  assert.strictEqual(events[0].idempotency_key, 'payment_allocated:1001:9001');
  assert.strictEqual(events[0].payload.payment_id, 1001);
  assert.strictEqual(events[0].payload.invoice_id, 9001);
  assert.strictEqual(events[0].payload.amount, 200);
  assert.strictEqual(events[0].payload.source_table, 'dentally_payments');
});

test('PAYMENT_ALLOCATED emits one event per invoice allocation', () => {
  const events = diffPaymentEvents(null, {
    dp_id: 1002,
    dp_patient_id: 9,
    dp_amount: 300,
    _explanations: [
      { invoice_id: 10, amount: 100 },
      { invoice_id: 20, amount: 200 },
    ],
  });
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].idempotency_key, 'payment_allocated:1002:10');
  assert.strictEqual(events[1].idempotency_key, 'payment_allocated:1002:20');
});

test('PAYMENT_ALLOCATED not emitted without invoice_id on explanations', () => {
  const events = diffPaymentEvents(null, {
    dp_id: 1003,
    dp_patient_id: 9,
    dp_amount: 50,
    _explanations: [{ id: 1, amount: 50 }],
  });
  assert.strictEqual(events.length, 0);
});

test('PAYMENT_ALLOCATED not re-emitted when oldRow exists and no key set', () => {
  const row = {
    dp_id: 1001,
    dp_patient_id: 9,
    dp_amount: 200,
    _explanations: [{ invoice_id: 9001, amount: 200 }],
  };
  const events = diffPaymentEvents(row, row);
  assert.strictEqual(events.length, 0);
});

test('PAYMENT_ALLOCATED heal on resume', () => {
  const row = {
    dp_id: 1001,
    dp_patient_id: 9,
    dp_amount: 200,
    _explanations: [{ invoice_id: 9001, amount: 200 }],
  };
  const events = diffPaymentEvents(row, row, new Set());
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].idempotency_key, 'payment_allocated:1001:9001');
});

test('PAYMENT_ALLOCATED not healed when key present', () => {
  const row = {
    dp_id: 1001,
    dp_patient_id: 9,
    _explanations: [{ invoice_id: 9001, amount: 200 }],
  };
  const events = diffPaymentEvents(
    row,
    row,
    new Set(['payment_allocated:1001:9001']),
  );
  assert.strictEqual(events.length, 0);
});

test('PAYMENT_ALLOCATED resumed-chunk: same key after heal, then silent', () => {
  const payment = {
    dp_id: 55,
    dp_patient_id: 2,
    dp_amount: 80,
    dp_dated_on: '2024-09-01',
    _explanations: [{ invoice_id: 44, amount: 80 }],
  };
  const firstPass = diffPaymentEvents(null, payment);
  assert.strictEqual(firstPass[0].idempotency_key, 'payment_allocated:55:44');

  const resumePass = diffPaymentEvents(payment, payment, new Set());
  assert.strictEqual(resumePass.length, 1);
  assert.strictEqual(resumePass[0].idempotency_key, firstPass[0].idempotency_key);

  const afterHeal = diffPaymentEvents(
    payment,
    payment,
    new Set(['payment_allocated:55:44']),
  );
  assert.strictEqual(afterHeal.length, 0);
});

// ── RECALL_DUE / RECALL_OVERDUE ─────────────────────────────────────────────

console.log('\neventLedger — RECALL_DUE / RECALL_OVERDUE\n');

const AS_OF = '2024-06-15';

test('RECALL_DUE when dentist recall date is today or future', () => {
  const events = diffPatientEvents(
    null,
    {
      pt_id: 9,
      is_active: true,
      pt_dentist_recall_date: '2024-06-15',
      pt_recall_method: 'SMS',
    },
    new Set(),
    AS_OF,
  );
  const due = events.filter((e) => e.event_type === 'RECALL_DUE');
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].idempotency_key, 'recall_due:dentist:9:2024-06-15');
  assert.strictEqual(due[0].payload.due_date, '2024-06-15');
  assert.strictEqual(due[0].payload.recall_type, 'dentist');
  assert.strictEqual(due[0].payload.overdue_as_of, null);
});

test('RECALL_OVERDUE when recall date is before asOf', () => {
  const events = diffPatientEvents(
    null,
    {
      pt_id: 9,
      is_active: true,
      pt_dentist_recall_date: '2024-06-01',
    },
    new Set(),
    AS_OF,
  );
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'RECALL_OVERDUE');
  assert.strictEqual(
    events[0].idempotency_key,
    'recall_overdue:dentist:9:2024-06-01',
  );
  assert.strictEqual(events[0].payload.overdue_as_of, AS_OF);
});

test('RECALL emits dentist and hygienist independently', () => {
  const events = diffPatientEvents(
    null,
    {
      pt_id: 3,
      is_active: true,
      pt_dentist_recall_date: '2024-07-01',
      pt_hygienist_recall_date: '2024-05-01',
    },
    new Set(),
    AS_OF,
  );
  assert.strictEqual(events.length, 2);
  const types = events.map((e) => e.event_type).sort();
  assert.deepStrictEqual(types, ['RECALL_DUE', 'RECALL_OVERDUE']);
});

test('RECALL not re-emitted when key present', () => {
  const row = {
    pt_id: 9,
    is_active: true,
    pt_dentist_recall_date: '2024-06-01',
  };
  const events = diffPatientEvents(
    row,
    row,
    new Set(['recall_overdue:dentist:9:2024-06-01']),
    AS_OF,
  );
  assert.strictEqual(events.length, 0);
});

test('RECALL_OVERDUE heal / resumed-chunk', () => {
  const row = {
    pt_id: 12,
    is_active: true,
    pt_hygienist_recall_date: '2024-01-01',
  };
  const first = diffPatientEvents(null, row, new Set(), AS_OF);
  assert.strictEqual(first[0].event_type, 'RECALL_OVERDUE');
  assert.strictEqual(
    first[0].idempotency_key,
    'recall_overdue:hygienist:12:2024-01-01',
  );

  const resume = diffPatientEvents(row, row, new Set(), AS_OF);
  assert.strictEqual(resume.length, 1);
  assert.strictEqual(resume[0].idempotency_key, first[0].idempotency_key);

  const after = diffPatientEvents(
    row,
    row,
    new Set(['recall_overdue:hygienist:12:2024-01-01']),
    AS_OF,
  );
  assert.strictEqual(after.length, 0);
});

test('no recall events when dates are null', () => {
  const events = diffPatientEvents(
    null,
    { pt_id: 9, is_active: true },
    new Set(),
    AS_OF,
  );
  assert.strictEqual(events.length, 0);
});

// ── PATIENT_REACTIVATED ─────────────────────────────────────────────────────

console.log('\neventLedger — PATIENT_REACTIVATED\n');

test('PATIENT_REACTIVATED when is_active false → true', () => {
  const events = diffPatientEvents(
    { pt_id: 9, is_active: false },
    { pt_id: 9, is_active: true, pt_updated_at: '2024-08-01T12:00:00Z' },
    new Set(),
    AS_OF,
  );
  const re = events.filter((e) => e.event_type === 'PATIENT_REACTIVATED');
  assert.strictEqual(re.length, 1);
  assert.strictEqual(re[0].idempotency_key, 'patient_reactivated:9');
  assert.strictEqual(re[0].payload.source_table, 'patients');
  assert.strictEqual(re[0].payload.pt_id, 9);
});

test('PATIENT_REACTIVATED not emitted for always-active patient', () => {
  const events = diffPatientEvents(
    { pt_id: 9, is_active: true },
    { pt_id: 9, is_active: true },
    new Set(),
    AS_OF,
  );
  assert.strictEqual(
    events.filter((e) => e.event_type === 'PATIENT_REACTIVATED').length,
    0,
  );
});

test('PATIENT_REACTIVATED not emitted on first insert (no prior inactive)', () => {
  const events = diffPatientEvents(
    null,
    { pt_id: 9, is_active: true },
    new Set(),
    AS_OF,
  );
  assert.strictEqual(
    events.filter((e) => e.event_type === 'PATIENT_REACTIVATED').length,
    0,
  );
});

test('PATIENT_REACTIVATED not re-emitted when key present', () => {
  const events = diffPatientEvents(
    { pt_id: 9, is_active: false },
    { pt_id: 9, is_active: true },
    new Set(['patient_reactivated:9']),
    AS_OF,
  );
  assert.strictEqual(
    events.filter((e) => e.event_type === 'PATIENT_REACTIVATED').length,
    0,
  );
});

test('PATIENT_REACTIVATED no heal after upsert already active', () => {
  // Mid-chunk limitation: after source upsert, oldRow is already active.
  const events = diffPatientEvents(
    { pt_id: 9, is_active: true },
    { pt_id: 9, is_active: true },
    new Set(),
    AS_OF,
  );
  assert.strictEqual(
    events.filter((e) => e.event_type === 'PATIENT_REACTIVATED').length,
    0,
  );
});

// ── routing + full 8-type smoke ─────────────────────────────────────────────

console.log('\neventLedger — routing / full suite smoke\n');

test('diffRowEvents routes by entity alias', () => {
  const plan = diffRowEvents('treatment_plans', null, { tp_id: 1, tp_patient_id: 2 });
  assert.strictEqual(plan[0].event_type, 'PLAN_CREATED');
  const item = diffRowEvents('treatment_plan_items', null, {
    tpi_id: 5,
    tpi_patient_id: 2,
    tpi_completed: true,
  });
  assert.strictEqual(item[0].event_type, 'ITEM_COMPLETED');
  const invoice = diffRowEvents('invoices', null, {
    platform_invoice_id: '9',
    patient_id: 2,
    subtotal: 10,
  });
  assert.strictEqual(invoice[0].event_type, 'INVOICE_RAISED');
  const payment = diffRowEvents('payments', null, {
    dp_id: 1,
    dp_patient_id: 2,
    _explanations: [{ invoice_id: 3, amount: 1 }],
  });
  assert.strictEqual(payment[0].event_type, 'PAYMENT_ALLOCATED');
  const patient = diffRowEvents(
    'patients',
    { pt_id: 2, is_active: false },
    { pt_id: 2, is_active: true, pt_dentist_recall_date: '2024-01-01' },
    new Set(),
    AS_OF,
  );
  const patientTypes = new Set(patient.map((e) => e.event_type));
  assert.ok(patientTypes.has('PATIENT_REACTIVATED'));
  assert.ok(patientTypes.has('RECALL_OVERDUE'));
  const other = diffRowEvents('appointments', null, { apmt_id: 1 });
  assert.strictEqual(other.length, 0);
});

test('full 8 event-type suite has no cross-hook interference', () => {
  const seen = new Set();

  for (const e of diffTreatmentPlanEvents(null, {
    tp_id: 1,
    tp_patient_id: 1,
    tp_start_date: '2024-01-01',
    tp_completed_at: '2024-02-01',
    tp_is_completed: true,
    tp_created_at: '2024-01-01',
  })) {
    seen.add(e.event_type);
  }
  for (const e of diffTreatmentAppointmentEvents(
    { ta_id: 1, ta_appointment_id: null, ta_patient_id: 1, ta_treatment_plan_id: 1 },
    { ta_id: 1, ta_appointment_id: 99, ta_patient_id: 1, ta_treatment_plan_id: 1 },
  )) {
    seen.add(e.event_type);
  }
  for (const e of diffTreatmentItemEvents(null, {
    tpi_id: 1,
    tpi_patient_id: 1,
    tpi_completed: true,
  })) {
    seen.add(e.event_type);
  }
  for (const e of diffInvoiceEvents(null, {
    platform_invoice_id: '1',
    patient_id: 1,
    subtotal: 1,
  })) {
    seen.add(e.event_type);
  }
  for (const e of diffPaymentEvents(null, {
    dp_id: 1,
    dp_patient_id: 1,
    _explanations: [{ invoice_id: 1 }],
  })) {
    seen.add(e.event_type);
  }
  for (const e of diffPatientEvents(
    { pt_id: 1, is_active: false },
    {
      pt_id: 1,
      is_active: true,
      pt_dentist_recall_date: '2024-12-01',
      pt_hygienist_recall_date: '2024-01-01',
    },
    new Set(),
    AS_OF,
  )) {
    seen.add(e.event_type);
  }

  const expected = [
    'PLAN_CREATED',
    'TREATMENT_STARTED',
    'PLAN_COMPLETED',
    'APPOINTMENT_LINKED',
    'ITEM_COMPLETED',
    'INVOICE_RAISED',
    'PAYMENT_ALLOCATED',
    'PATIENT_REACTIVATED',
    'RECALL_DUE',
    'RECALL_OVERDUE',
  ];
  for (const t of expected) {
    assert.ok(seen.has(t), `missing event type ${t}`);
  }
  // 8 contract families: APPOINTMENT covers LINKED+UNLINKED; RECALL covers DUE+OVERDUE
  assert.ok(seen.size >= 8);
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
