/**
 * Patient Economics — sync one chunk of Dentally appointments into public.appointments.
 *
 * Distinct from treatment_appointments: diary/calendar slots via GET /v1/appointments.
 * Links to patients via apmt_patient_id ↔ patients.pt_id (Dentally numeric patient id).
 *
 * Note: APPOINTMENT_LINKED / UNLINKED Event Ledger hooks attach to
 * syncTreatmentAppointments (ta_appointment_id), not this diary sync.
 *
 * Dentally returns an empty list without a date filter — PE uses monthly
 * updated_after/updated_before windows in the cursor (chunkStart/chunkEnd).
 * Includes cancelled/DNA via cancelled=true (same as main Dentally sync).
 *
 * Full backfill starts at practice onboarding start_date (not a fixed env year).
 */

const { RESOURCE_APPOINTMENTS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');
const { getPracticeSyncRange } = require('./practiceSyncRange');

async function syncAppointments(practiceId) {
  const { startDate } = await getPracticeSyncRange(practiceId);
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_APPOINTMENTS,
    entityAlias: 'appointments',
    entityConfigOverride: {
      extraParams: { cancelled: true },
    },
    dateChunking: {
      rangeStart: startDate,
    },
  });
}

module.exports = { syncAppointments };
