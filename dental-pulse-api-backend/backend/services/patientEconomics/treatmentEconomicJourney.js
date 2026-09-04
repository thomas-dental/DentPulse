/**
 * Treatment Economic Journey™ — funnel stages for a practice.
 *
 * All stages roll up from event_ledger only.
 * Date scope: event_ledger.created_at. Location scope: event_ledger.location_id.
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  JOURNEY_STAGES,
  FUNNEL_EVENT_TYPES,
  emptyBuckets,
  aggregateFunnelRows,
  buildJourneyResult,
  payloadGbp,
  payloadPtId,
} = require('./treatmentEconomicJourneyLedger');

const PAGE_SIZE = 1000;

async function paginateFunnelEvents(
  practiceId,
  startDate,
  endDate,
  locationId = null,
  eventTypes = FUNNEL_EVENT_TYPES,
) {
  const rows = [];
  let offset = 0;

  for (let i = 0; i < 500; i++) {
    let query = supabaseAdmin
      .from('event_ledger')
      .select('event_type, payload, patient_id, location_id')
      .eq('practice_id', practiceId)
      .in('event_type', eventTypes);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }
    if (startDate) {
      query = query.gte('created_at', `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query = query.lte('created_at', `${endDate}T23:59:59.999Z`);
    }

    // Stable sort required — offset pagination without ORDER BY returns a random
    // row subset on each request, so journey £/counts drift on reload.
    query = query
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      const err = new Error(error.message || 'Failed to load event_ledger');
      err.code = error.code;
      throw err;
    }

    const batch = data || [];
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

/**
 * @param {string} practiceId organizations.id
 */
async function getTreatmentEconomicJourney(practiceId, scope = {}) {
  const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
  const { scopeCacheExtra } = require('./peReadScope');
  const { withPeReadCache } = require('./peReadCache');
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  const minPlannedEvents = assumptions.journeyMinPlannedEvents;
  const minTotalFunnelEvents = assumptions.journeyMinTotalFunnelEvents;
  const locationId = scope.locationId || null;
  const startDate = scope.startDate || null;
  const endDate = scope.endDate || null;

  return withPeReadCache(
    'treatment-economic-journey',
    practiceId,
    async () => {
      const byType = emptyBuckets();
      const scheduledPlanValue = new Map();

      const rows = await paginateFunnelEvents(
        practiceId,
        startDate,
        endDate,
        locationId,
        FUNNEL_EVENT_TYPES,
      );

      aggregateFunnelRows(rows, byType, scheduledPlanValue);

      return buildJourneyResult(
        byType,
        scheduledPlanValue,
        minPlannedEvents,
        minTotalFunnelEvents,
      );
    },
    { extra: scopeCacheExtra(scope) },
  );
}

module.exports = {
  JOURNEY_STAGES,
  getTreatmentEconomicJourney,
  payloadGbp,
  payloadPtId,
  aggregateFunnelRows,
  paginateFunnelEvents,
};
