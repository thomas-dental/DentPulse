/**
 * Pure helpers for Dentally appointment webhook payloads.
 */

const { parseWebhookPayload } = require('./paymentWebhookHelpers');

const APPOINTMENT_EVENTS = new Set([
  'appointment.created',
  'appointment.updated',
  'appointment.deleted',
]);

/**
 * @param {string|null|undefined} eventName
 * @returns {boolean}
 */
function isAppointmentWebhookEvent(eventName) {
  return APPOINTMENT_EVENTS.has(String(eventName || '').trim());
}

/**
 * @param {string} eventName — e.g. appointment.updated
 * @returns {'created'|'updated'|'deleted'|null}
 */
function parseAppointmentAction(eventName) {
  const parts = String(eventName || '').split('.');
  if (parts.length !== 2 || parts[0] !== 'appointment') return null;
  const action = parts[1];
  if (action === 'created' || action === 'updated' || action === 'deleted') return action;
  return null;
}

/**
 * @param {object|null|undefined} data — webhook data or appointment record
 * @returns {number|null}
 */
function extractAppointmentId(data) {
  if (!data || data.id == null) return null;
  const id = Number(data.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * @param {number|null|undefined} patientId
 * @returns {number|null}
 */
function normalizePatientId(patientId) {
  if (patientId == null) return null;
  const id = Number(patientId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Merge ta_id lists, dedupe, preserve order.
 * @param {...(number[]|null|undefined)} lists
 * @returns {number[]}
 */
function mergeTreatmentAppointmentIds(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const id = Number(raw);
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Collect ta_id values from Dentally treatment_appointment list records
 * that reference the given diary appointment id.
 * @param {object[]} records
 * @param {number} appointmentId
 * @returns {number[]}
 */
function extractTreatmentAppointmentIdsForAppointment(records, appointmentId) {
  if (!Array.isArray(records) || !appointmentId) return [];
  const ids = [];
  for (const record of records) {
    const apptId = Number(record?.appointment_id);
    if (!Number.isFinite(apptId) || apptId !== appointmentId) continue;
    const taId = Number(record?.id);
    if (Number.isFinite(taId) && taId > 0) ids.push(taId);
  }
  return ids;
}

module.exports = {
  APPOINTMENT_EVENTS,
  isAppointmentWebhookEvent,
  parseAppointmentAction,
  parseWebhookPayload,
  extractAppointmentId,
  normalizePatientId,
  mergeTreatmentAppointmentIds,
  extractTreatmentAppointmentIdsForAppointment,
};
