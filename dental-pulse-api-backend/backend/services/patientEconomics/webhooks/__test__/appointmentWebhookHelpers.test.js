/**
 * Unit tests — appointment webhook payload helpers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAppointmentWebhookEvent,
  parseAppointmentAction,
  parseWebhookPayload,
  extractAppointmentId,
  normalizePatientId,
  mergeTreatmentAppointmentIds,
  extractTreatmentAppointmentIdsForAppointment,
} = require('../appointmentWebhookHelpers');

test('isAppointmentWebhookEvent recognises appointment events', () => {
  assert.equal(isAppointmentWebhookEvent('appointment.created'), true);
  assert.equal(isAppointmentWebhookEvent('appointment.updated'), true);
  assert.equal(isAppointmentWebhookEvent('appointment.deleted'), true);
  assert.equal(isAppointmentWebhookEvent('payment.updated'), false);
});

test('parseAppointmentAction maps event suffix', () => {
  assert.equal(parseAppointmentAction('appointment.created'), 'created');
  assert.equal(parseAppointmentAction('appointment.updated'), 'updated');
  assert.equal(parseAppointmentAction('appointment.deleted'), 'deleted');
  assert.equal(parseAppointmentAction('patient.updated'), null);
});

test('parseWebhookPayload extracts event object and data', () => {
  const payload = {
    event: 'appointment.updated',
    object: 'appointment',
    data: { id: 501, patient_id: 42 },
  };
  const parsed = parseWebhookPayload(payload);
  assert.equal(parsed.event, 'appointment.updated');
  assert.equal(parsed.object, 'appointment');
  assert.equal(parsed.data.id, 501);
});

test('extractAppointmentId and normalizePatientId', () => {
  assert.equal(extractAppointmentId({ id: 501 }), 501);
  assert.equal(extractAppointmentId({ id: 'bad' }), null);
  assert.equal(normalizePatientId(42), 42);
  assert.equal(normalizePatientId(null), null);
});

test('mergeTreatmentAppointmentIds dedupes preserving order', () => {
  assert.deepEqual(mergeTreatmentAppointmentIds([1, 2], [2, 3], null), [1, 2, 3]);
});

test('extractTreatmentAppointmentIdsForAppointment filters by appointment_id', () => {
  const records = [
    { id: 10, appointment_id: 501 },
    { id: 11, appointment_id: 999 },
    { id: 12, appointment_id: 501 },
    { id: 'bad' },
  ];
  assert.deepEqual(extractTreatmentAppointmentIdsForAppointment(records, 501), [10, 12]);
  assert.deepEqual(extractTreatmentAppointmentIdsForAppointment(records, 777), []);
});
