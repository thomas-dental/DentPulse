/**
 * Unit tests for orphan patient binding in event ledger writer.
 *
 * Run: node backend/services/patientEconomics/sync/__test__/eventLedgerWriterOrphan.test.js
 */

const assert = require('assert');
const {
  resolveLedgerPatientBinding,
  resolveLedgerLocationId,
  buildLedgerInsertRow,
} = require('../eventLedgerPatientBinding');

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

console.log('eventLedgerWriter — orphan patient binding\n');

test('resolveLedgerPatientBinding skips when pt_id missing', () => {
  const result = resolveLedgerPatientBinding(null, 'uuid-1');
  assert.strictEqual(result.skip, true);
  assert.strictEqual(result.reason, 'no_pt_id');
});

test('resolveLedgerPatientBinding matches when patients row exists', () => {
  const result = resolveLedgerPatientBinding(42, 'uuid-abc');
  assert.strictEqual(result.skip, false);
  assert.strictEqual(result.patientId, 'uuid-abc');
  assert.strictEqual(result.patientMatch, 'matched');
});

test('resolveLedgerPatientBinding writes orphan when no patients row', () => {
  const result = resolveLedgerPatientBinding(42, undefined);
  assert.strictEqual(result.skip, false);
  assert.strictEqual(result.patientId, null);
  assert.strictEqual(result.patientMatch, 'orphan');
});

test('resolveLedgerLocationId prefers invoice row location then patient home', () => {
  assert.strictEqual(
    resolveLedgerLocationId('invoices', { location_id: 'loc-invoice' }, { location_id: 'loc-home' }),
    'loc-invoice',
  );
  assert.strictEqual(
    resolveLedgerLocationId('treatment_plans', {}, { location_id: 'loc-home' }),
    'loc-home',
  );
});

test('buildLedgerInsertRow stores location_id on row and payload', () => {
  const row = buildLedgerInsertRow({
    practiceId: 'practice-1',
    patientId: 'uuid-1',
    patientMatch: 'matched',
    ptId: 99,
    locationId: 'loc-1',
    evt: {
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      idempotency_key: 'plan_created:101',
      payload: { plan_id: 101, tp_patient_id: 99 },
    },
    payloadSource: 'dentally_sync',
    syncRunId: 'run-1',
  });

  assert.strictEqual(row.location_id, 'loc-1');
  assert.strictEqual(row.payload.location_id, 'loc-1');
});

test('buildLedgerInsertRow stores orphan pt_id and patient_match on payload', () => {
  const row = buildLedgerInsertRow({
    practiceId: 'practice-1',
    patientId: null,
    patientMatch: 'orphan',
    ptId: 99,
    locationId: null,
    evt: {
      event_type: 'PLAN_CREATED',
      created_at: '2024-01-01T00:00:00Z',
      idempotency_key: 'plan_created:101',
      payload: { plan_id: 101, tp_patient_id: 99 },
    },
    payloadSource: 'dentally_sync',
    syncRunId: 'run-1',
  });

  assert.strictEqual(row.patient_id, null);
  assert.strictEqual(row.location_id, null);
  assert.strictEqual(row.payload.pt_id, 99);
  assert.strictEqual(row.payload.patient_match, 'orphan');
});

console.log(`\n${passed} tests passed`);
