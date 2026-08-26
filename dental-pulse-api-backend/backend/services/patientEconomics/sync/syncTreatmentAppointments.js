/**
 * Patient Economics — sync one chunk of Dentally treatment appointments into
 * public.treatment_appointments.
 *
 * Distinct resource: GET /v1/treatment_appointments (plan-linked visit slots).
 * Links:
 *   ta_patient_id        ↔ patients.pt_id
 *   ta_appointment_id    ↔ appointments.apmt_id (nullable until booked)
 *   ta_treatment_plan_id ↔ treatment_plans.tp_id
 *
 * Event Ledger (via upsertPePage → eventLedgerWriter):
 *   APPOINTMENT_LINKED / UNLINKED — from ta_appointment_id transitions
 *   (not diary syncAppointments).
 *
 * Window: practice onboarding start_date → today (monthly updated_after/before).
 */

const { RESOURCE_TREATMENT_APPOINTMENTS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');
const { getPracticeSyncRange } = require('./practiceSyncRange');

async function syncTreatmentAppointments(practiceId) {
  const { startDate } = await getPracticeSyncRange(practiceId);
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_TREATMENT_APPOINTMENTS,
    entityAlias: 'treatment_appointments',
    dateChunking: {
      rangeStart: startDate,
    },
  });
}

module.exports = { syncTreatmentAppointments };
