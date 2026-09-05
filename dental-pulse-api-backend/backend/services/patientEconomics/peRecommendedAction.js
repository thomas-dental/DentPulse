/**
 * Recommended action rule table — mirror of dental-pulse-dev/src/lib/peRecommendedAction.ts
 * Keep thresholds in sync when either file changes.
 */

const PE_HIGH_OPPORTUNITY_WEIGHTED_GBP = 500;
const PE_HIGH_QUALITY_SCORE = 70;
const PE_LOW_QUALITY_SCORE = 40;

function deriveRecommendedAction(retentionStatus, opportunityWeighted, qualityScore, thresholds = {}) {
  const highOppGbp =
    thresholds.highOpportunityWeightedGbp ?? PE_HIGH_OPPORTUNITY_WEIGHTED_GBP;
  const highQualityScore = thresholds.highQualityScore ?? PE_HIGH_QUALITY_SCORE;
  const lowQualityScore = thresholds.lowQualityScore ?? PE_LOW_QUALITY_SCORE;

  const highOpp = opportunityWeighted >= highOppGbp;
  const quality = qualityScore ?? 0;
  const highQuality = quality >= highQualityScore;
  const lowQuality = quality < lowQualityScore;

  if (retentionStatus === 'lapsed' || retentionStatus === 'effectively_lost') {
    if (highOpp) return 'priority_reactivation';
    if (highQuality) return 'reactivation_relationship';
    return 'priority_reactivation';
  }

  if (retentionStatus === 'drifting') {
    return highOpp ? 'schedule_treatment_recall' : 'recall_follow_up';
  }

  if (highOpp && lowQuality) return 'chase_completion_data';
  if (highOpp && highQuality) return 'maintain_high_value';
  return 'monitor';
}

module.exports = {
  PE_HIGH_OPPORTUNITY_WEIGHTED_GBP,
  deriveRecommendedAction,
};
