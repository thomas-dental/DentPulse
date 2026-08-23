/**
 * Patient Economics — sync one chunk of Dentally treatment plan items into
 * public.treatment_plan_items.
 *
 * PE cursor slug: treatment_items (sync_cursors.resource_type).
 * Dentally entity/API: treatment_plan_items (GET /v1/treatment_plan_items).
 *
 * Links:
 *   tpi_patient_id        ↔ patients.pt_id
 *   tpi_treatment_plan_id ↔ treatment_plans.tp_id
 *   tpi_treatment_appointment_id ↔ treatment_appointments.ta_id (optional)
 *
 * Raw pricing/completion fields (tpi_price, tpi_charged, tpi_completed, …)
 * stored as-is; Contribution Engine cost allocation is M4 work.
 */

const { RESOURCE_TREATMENT_ITEMS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');

const TREATMENT_ITEMS_RANGE_START =
  process.env.PE_SYNC_TREATMENT_ITEMS_START || '2020-01-01';

async function syncTreatmentItems(practiceId) {
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_TREATMENT_ITEMS,
    entityAlias: 'treatment_plan_items',
    dateChunking: {
      rangeStart: TREATMENT_ITEMS_RANGE_START,
    },
  });
}

module.exports = { syncTreatmentItems };
