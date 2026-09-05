/**
 * Growth Levers — practice rollup (visit frequency + value per visit).
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  DERIVED_TIER,
  DEFAULT_GROWTH_LEVERS_TRAILING_MONTHS,
  DERIVED_TIER_NOTE,
  trailingSinceIsoDate,
  buildTrailingMonthKeys,
  round2,
  computePracticeLevers,
} = require('./growthLeversLogic');
const {
  MODELLED_TIER,
  TENURE_DERIVED_TIER_NOTE,
  PROJECTED_LIFETIME_TIER_NOTE,
} = require('./patientLifetimeLogic');

const { withPeReadCache } = require('./peReadCache');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function loadGrowthLeversTrailingMonths(practiceId) {
  const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  return assumptions.growthLeversTrailingMonths || DEFAULT_GROWTH_LEVERS_TRAILING_MONTHS;
}

function mapLifetimeMetricsRpc(body) {
  const payload = body && typeof body === 'object' ? body : {};

  return {
    tenureYears: payload.tenureYears == null ? null : num(payload.tenureYears),
    tenureTier: DERIVED_TIER,
    tenureTierNote: TENURE_DERIVED_TIER_NOTE,
    tenurePatientCount: num(payload.tenurePatientCount),
    projectedLifetimeYears:
      payload.projectedLifetimeYears == null ? null : num(payload.projectedLifetimeYears),
    projectedLifetimeTier: MODELLED_TIER,
    projectedLifetimeTierNote: PROJECTED_LIFETIME_TIER_NOTE,
    projectedLifetimePatientCount: num(payload.projectedLifetimePatientCount),
    hasTenureData: Boolean(payload.hasTenureData),
    hasProjectedLifetimeData: Boolean(payload.hasProjectedLifetimeData),
  };
}

function buildMonthlySeries(monthKeys, visitsByMonth, revenueByMonth) {
  return monthKeys.map((month) => {
    const visits = visitsByMonth.get(month) ?? 0;
    const revenue = revenueByMonth.get(month) ?? 0;
    const valuePerVisit = visits > 0 ? round2(revenue / visits) : null;
    return {
      month,
      completedVisits: visits,
      revenuePrivatePlan: round2(revenue),
      valuePerVisit,
    };
  });
}

function mapGrowthLeversSummaryRpc(practiceId, raw, scope = {}) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const trailingMonths = num(payload.trailingMonths) || DEFAULT_GROWTH_LEVERS_TRAILING_MONTHS;
  const sinceDate = String(payload.sinceDate ?? trailingSinceIsoDate(trailingMonths)).slice(0, 10);
  const endDate = String(payload.endDate ?? '').slice(0, 10) || null;
  const { buildMonthKeysFromRange } = require('./peReadScope');
  const monthKeys =
    scope.startDate && scope.endDate
      ? buildMonthKeysFromRange(scope.startDate, scope.endDate)
      : endDate
        ? buildMonthKeysFromRange(sinceDate, endDate)
        : buildTrailingMonthKeys(sinceDate, trailingMonths);

  const visitsByMonth = new Map();
  for (const [key, value] of Object.entries(payload.visits_by_month ?? {})) {
    visitsByMonth.set(key, num(value));
  }

  const revenueByMonth = new Map();
  for (const [key, value] of Object.entries(payload.revenue_by_month ?? {})) {
    revenueByMonth.set(key, num(value));
  }

  const activePatientCount = num(payload.active_patient_count);
  const visitTotal = num(payload.total_completed_visits);
  const revenueTotal = round2(num(payload.total_revenue_private_plan));
  const contributionTotal = round2(num(payload.total_contribution));
  const marginPct =
    payload.margin_pct != null ? round2(num(payload.margin_pct)) : null;

  const levers = computePracticeLevers(visitTotal, activePatientCount, revenueTotal);
  const monthly = buildMonthlySeries(monthKeys, visitsByMonth, revenueByMonth);
  const lifetime = mapLifetimeMetricsRpc(payload);

  return {
    practiceId,
    trailingMonths,
    sinceDate,
    visitFrequency: levers.visitFrequency,
    visitFrequencyTier: DERIVED_TIER,
    visitFrequencyTierNote: DERIVED_TIER_NOTE,
    valuePerVisit: levers.valuePerVisit,
    valuePerVisitTier: DERIVED_TIER,
    valuePerVisitTierNote: DERIVED_TIER_NOTE,
    totalCompletedVisits: levers.totalCompletedVisits,
    totalRevenuePrivatePlan: levers.totalRevenuePrivatePlan,
    activePatientCount: levers.activePatientCount,
    tenureYears: lifetime.tenureYears,
    tenureTier: lifetime.tenureTier,
    tenureTierNote: lifetime.tenureTierNote,
    tenurePatientCount: lifetime.tenurePatientCount,
    projectedLifetimeYears: lifetime.projectedLifetimeYears,
    projectedLifetimeTier: lifetime.projectedLifetimeTier,
    projectedLifetimeTierNote: lifetime.projectedLifetimeTierNote,
    projectedLifetimePatientCount: lifetime.projectedLifetimePatientCount,
    hasTenureData: lifetime.hasTenureData,
    hasProjectedLifetimeData: lifetime.hasProjectedLifetimeData,
    monthly,
    hasAppointmentData: visitTotal > 0,
    hasRevenueData: revenueTotal > 0,
    hasActivePatients: activePatientCount > 0,
    totalContribution: contributionTotal,
    marginPct,
    tier: DERIVED_TIER,
    tierNote: DERIVED_TIER_NOTE,
  };
}

async function fetchGrowthLeversSummaryRpc(practiceId, scope = {}) {
  const { data, error } = await supabaseAdmin.rpc('pe_growth_levers_summary', {
    p_practice_id: practiceId,
    p_location_id: scope.locationId || null,
    p_start_date: scope.startDate || null,
    p_end_date: scope.endDate || null,
  });

  if (error) {
    throw new Error(`pe_growth_levers_summary: ${error.message}`);
  }

  return mapGrowthLeversSummaryRpc(practiceId, data, scope);
}

/**
 * @param {string} practiceId
 * @param {{ locationId?: string | null, startDate?: string | null, endDate?: string | null }} [scope]
 */
async function getGrowthLeversSummary(practiceId, scope = {}) {
  const { scopeCacheExtra } = require('./peReadScope');

  return withPeReadCache(
    'growth-levers-summary',
    practiceId,
    async () => fetchGrowthLeversSummaryRpc(practiceId, scope),
    { extra: scopeCacheExtra(scope) },
  );
}

module.exports = {
  getGrowthLeversSummary,
  loadGrowthLeversTrailingMonths,
};
