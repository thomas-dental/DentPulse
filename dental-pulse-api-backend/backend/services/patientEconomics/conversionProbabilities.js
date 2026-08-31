/**
 * Conversion Probabilities — read-only review of D16 commitment-derived weighting.
 */

const { buildOpportunityWeightingForPractice } = require('./commitmentRate');
const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');

async function getConversionProbabilitiesSummary(practiceId) {
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  const { byPatient, commitmentResult, confidence, tierNote } =
    await buildOpportunityWeightingForPractice(practiceId);
  const rate = commitmentResult?.commitmentRate ?? 0;

  let openPlanGross = 0;
  let openPlanCount = 0;
  for (const entry of byPatient.values()) {
    openPlanGross += entry.gross ?? 0;
    openPlanCount += entry.planCount ?? 0;
  }

  return {
    practiceId,
    readOnly: true,
    readOnlyReason:
      'Opportunity weighted £ uses a single practice-level Commitment Rate learned from historical PLAN_CREATED → APPOINTMENT_LINKED conversions. There is no per-treatment manual override — adjust commitment_rate_window_days in Economic Assumptions to change the learning window.',
    modelTier: 'Modelled',
    windowDays: assumptions.commitmentRateWindowDays,
    commitmentRate: rate,
    commitmentRatePct: Math.round(rate * 1000) / 10,
    confidence,
    tierNote,
    eligibleItemCount: commitmentResult?.eligibleItemCount ?? 0,
    committedItemCount: commitmentResult?.committedItemCount ?? 0,
    totalEligibleValue: commitmentResult?.totalEligibleValue ?? 0,
    committedValueWithinWindow: commitmentResult?.committedValueWithinWindow ?? 0,
    openPlanCount,
    openPlanGrossGbp: Math.round(openPlanGross * 100) / 100,
    weightedFormula: 'opportunity_weighted_gbp = opportunity_gross_gbp × commitment_rate',
    standardWindowsDays: assumptions.commitmentRateStandardWindowsDays,
  };
}

module.exports = {
  getConversionProbabilitiesSummary,
};
