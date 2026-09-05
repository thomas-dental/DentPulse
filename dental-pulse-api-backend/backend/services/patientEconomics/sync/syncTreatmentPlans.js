/**
 * Patient Economics — sync one chunk of Dentally treatment plans into
 * public.treatment_plans.
 *
 * Links to patients via tp_patient_id ↔ patients.pt_id (Dentally numeric id).
 * Raw Dentally completion fields (completed_at → tp_completed_at / tp_is_completed)
 * are stored as-is; Economic Journey state derivation is M3 / Event Ledger work.
 *
 * Event Ledger (via upsertPePage → eventLedgerWriter):
 *   PLAN_CREATED — first upsert of a plan (or heal if source row exists without
 *   ledger key after a mid-chunk resume).
 *   TREATMENT_STARTED — when Dentally start_date lands as tp_start_date
 *   (null → set); not an inferred presented/accepted/committed status.
 *   PLAN_COMPLETED — when Dentally completed_at lands as tp_completed_at /
 *   tp_is_completed (unset → set); heal-on-resume if ledger key missing.
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
