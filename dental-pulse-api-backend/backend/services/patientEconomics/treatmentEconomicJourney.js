/**
 * Treatment Economic Journey™ — funnel stages for a practice.
 *
 * All stages roll up from event_ledger only.
 * Date scope: event_ledger.created_at. Location scope: event_ledger.location_id.
 *
 * Aggregated in Postgres via pe_treatment_economic_journey (one round-trip).
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  JOURNEY_STAGES,
  FUNNEL_EVENT_TYPES,
  aggregateFunnelRows,
  payloadGbp,
  payloadPtId,
  mapJourneyRpcResult,
} = require('./treatmentEconomicJourneyLedger');
const { withStableOrder, DEFAULT_PAGE_SIZE } = require('./peStablePagination');

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

async function fetchTreatmentEconomicJourneyRpc(
  practiceId,
  locationId = null,
  startDate = null,
  endDate = null,
) {
  const { data, error } = await supabaseAdmin.rpc('pe_treatment_economic_journey', {
    p_practice_id: practiceId,
    p_location_id: locationId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    throw new Error(`pe_treatment_economic_journey: ${error.message}`);
  }

  return mapJourneyRpcResult(data);
}

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

    query = withStableOrder(query, 'event_ledger');

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
  const { scopeCacheExtra } = require('./peReadScope');
  const { withPeReadCache } = require('./peReadCache');
  const locationId = scope.locationId || null;
  const startDate = scope.startDate || null;
  const endDate = scope.endDate || null;

  return withPeReadCache(
    'treatment-economic-journey',
    practiceId,
    async () =>
      fetchTreatmentEconomicJourneyRpc(practiceId, locationId, startDate, endDate),
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
  mapJourneyRpcResult,
  fetchTreatmentEconomicJourneyRpc,
};
