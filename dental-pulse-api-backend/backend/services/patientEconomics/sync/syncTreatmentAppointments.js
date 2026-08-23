/**
 * Patient Economics — sync one chunk of Dentally treatment appointments into
 * public.treatment_appointments.
 *
 * Distinct resource: GET /v1/treatment_appointments (plan-linked visit slots).
 * Links:
 *   ta_patient_id        ↔ patients.pt_id
 *   ta_appointment_id    ↔ appointments.apmt_id (nullable until booked)
 *   ta_treatment_plan_id ↔ treatment_plans.tp_id
 */

const { RESOURCE_TREATMENT_APPOINTMENTS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');

async function syncTreatmentAppointments(practiceId) {
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_TREATMENT_APPOINTMENTS,
    entityAlias: 'treatment_appointments',
    // Full backfill (no date window); main sync uses updated_after date chunks.
    entityConfigOverride: {
      dateFilter: null,
      dateFilterEnd: null,
    },
  });
}

module.exports = { syncTreatmentAppointments };
