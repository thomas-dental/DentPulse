/**
 * Opportunity weighted £ — uses practice Commitment Rate (commitmentRate.js).
 */

const { buildOpportunityWeightingForPractice } = require('./commitmentRate');

const OPPORTUNITY_WEIGHTED_TIER = 'Modelled';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function applyCommitmentOpportunityWeighting(practiceId, rows) {
  if (rows.length === 0) return rows;

  const { byPatient, confidence, tierNote } = await buildOpportunityWeightingForPractice(
    practiceId,
  );
  const { deriveRecommendedAction } = require('./peRecommendedAction');
  const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  const actionThresholds = {
    highOpportunityWeightedGbp: assumptions.recommendedActionHighOpportunityWeightedGbp,
    highQualityScore: assumptions.recommendedActionHighQualityScore,
    lowQualityScore: assumptions.recommendedActionLowQualityScore,
  };

  return rows.map((row) => {
    const computed = byPatient.get(row.patientId);
    const grossFromLedger = computed?.gross ?? 0;
    const sqlGross = num(row.opportunityGross);

    const gross = sqlGross > 0 ? sqlGross : grossFromLedger;
    const weighted = computed?.weighted ?? 0;
    const rowConfidence = computed?.confidence ?? confidence ?? 0;

    const rowTierNote =
      computed?.tierNote ??
      tierNote ??
      (gross > 0
        ? 'No Commitment Rate history yet — weighted £0 until eligible private plan items exist in ledger.'
        : 'No unscheduled pipeline on file.');

    const recommendedAction = deriveRecommendedAction(
      row.retentionStatus,
      weighted,
      row.qualityScore,
      actionThresholds,
    );

    return {
      ...row,
      opportunityGross: gross,
      opportunityGrossTier: row.opportunityGrossTier || 'Derived',
      opportunityWeighted: weighted,
      opportunityWeightedTier: OPPORTUNITY_WEIGHTED_TIER,
      opportunityWeightedTierNote: rowTierNote,
      opportunityWeightConfidence: rowConfidence,
      recommendedAction,
      recommendedActionTier: 'Modelled',
      recommendedActionTierNote:
        'Rule table: retention_status + commitment-weighted opportunity (>=500 high) + quality_score. See peRecommendedAction.js — not ML.',
    };
  });
}

module.exports = {
  buildOpportunityWeightingForPractice,
  applyCommitmentOpportunityWeighting,
  OPPORTUNITY_WEIGHTED_TIER,
};
