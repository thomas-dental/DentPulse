/**
 * Patient Economics — sync one chunk of Dentally treatment plans into
 * public.treatment_plans.
 *
 * Links to patients via tp_patient_id ↔ patients.pt_id (Dentally numeric id).
 * Raw Dentally completion fields (completed_at → tp_completed_at / tp_is_completed)
 * are stored as-is; Economic Journey state derivation is M3 / Event Ledger work.
 *
 * Uses monthly created_after/created_before windows from practice onboarding
 * start_date → today so backfill stays resumable against large practice volumes.
 */

const { RESOURCE_TREATMENT_PLANS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');
const { getPracticeSyncRange } = require('./practiceSyncRange');

async function syncTreatmentPlans(practiceId) {
  const { startDate } = await getPracticeSyncRange(practiceId);
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_TREATMENT_PLANS,
    entityAlias: 'treatment_plans',
    dateChunking: {
      rangeStart: startDate,
    },
  });
}

module.exports = { syncTreatmentPlans };
