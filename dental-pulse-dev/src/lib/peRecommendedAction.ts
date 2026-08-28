/**
 * Recommended action — rule-based (not ML), easy to tune via thresholds below.
 *
 * Inputs (all on v_patient_contribution after migration):
 *   retention_status, opportunity_weighted, quality_score (from modelled job)
 *
 * Rules evaluated in order; first match wins. Mirror SQL CASE in migration
 * 20260828140001_v_patient_contribution_retention_opportunity.sql — keep in sync.
 *
 * Provenance: tier = Modelled; see PE_RECOMMENDED_ACTION_TIER_NOTE.
 */

import type { PeRetentionStatus } from '@/lib/peRetentionConstants';

export const PE_RECOMMENDED_ACTION_TIER = 'Modelled' as const;

export const PE_RECOMMENDED_ACTION_TIER_NOTE =
  'Rule table: retention_status + opportunity_weighted + quality_score thresholds. Adjust PE_RECOMMENDED_ACTION_RULES — not ML.';

/** Weighted opportunity £ above this → "high" pipeline (Modelled threshold). */
export const PE_HIGH_OPPORTUNITY_WEIGHTED_GBP = 500;

/** Quality score at or above → "high" engagement/data composite (Modelled). */
export const PE_HIGH_QUALITY_SCORE = 70;

/** Quality score below → data/engagement concern (Modelled). */
export const PE_LOW_QUALITY_SCORE = 40;

export type PeRecommendedAction =
  | 'priority_reactivation'
  | 'reactivation_relationship'
  | 'schedule_treatment_recall'
  | 'recall_follow_up'
  | 'review_unscheduled_next_visit'
  | 'chase_completion_data'
  | 'maintain_high_value'
  | 'routine_recall'
  | 'monitor';

export const PE_RECOMMENDED_ACTION_LABELS: Record<PeRecommendedAction, string> = {
  priority_reactivation: 'Priority reactivation outreach',
  reactivation_relationship: 'Reactivation — retain relationship',
  schedule_treatment_recall: 'Schedule unscheduled treatment + recall',
  recall_follow_up: 'Recall follow-up',
  review_unscheduled_next_visit: 'Review unscheduled treatment at next visit',
  chase_completion_data: 'Chase completion / improve data quality',
  maintain_high_value: 'Maintain — high-value active patient',
  routine_recall: 'Routine recall',
  monitor: 'Monitor',
};

/**
 * Rule table (order matters — most urgent first):
 *
 * | retention | opp_weighted      | quality              | action
 * |-----------|-------------------|----------------------|---------------------------
 * | lapsed    | >= HIGH_OPP       | any                  | priority_reactivation
 * | lapsed    | < HIGH_OPP        | >= HIGH_QUALITY      | reactivation_relationship
 * | lapsed    | < HIGH_OPP        | else                 | priority_reactivation
 * | drifting  | >= HIGH_OPP       | any                  | schedule_treatment_recall
 * | drifting  | < HIGH_OPP        | any                  | recall_follow_up
 * | healthy   | >= HIGH_OPP       | any                  | review_unscheduled_next_visit
 * | active    | >= HIGH_OPP       | < LOW_QUALITY        | chase_completion_data
 * | active    | >= HIGH_OPP       | >= HIGH_QUALITY      | maintain_high_value
 * | healthy   | < HIGH_OPP        | any                  | routine_recall
 * | else      | any               | any                  | monitor
 */
export function deriveRecommendedAction(
  retentionStatus: PeRetentionStatus,
  opportunityWeighted: number,
  qualityScore: number | null,
): PeRecommendedAction {
  const highOpp = opportunityWeighted >= PE_HIGH_OPPORTUNITY_WEIGHTED_GBP;
  const quality = qualityScore ?? 0;
  const highQuality = quality >= PE_HIGH_QUALITY_SCORE;
  const lowQuality = quality < PE_LOW_QUALITY_SCORE;

  if (retentionStatus === 'lapsed') {
    if (highOpp) return 'priority_reactivation';
    if (highQuality) return 'reactivation_relationship';
    return 'priority_reactivation';
  }

  if (retentionStatus === 'drifting') {
    return highOpp ? 'schedule_treatment_recall' : 'recall_follow_up';
  }

  if (retentionStatus === 'healthy') {
    return highOpp ? 'review_unscheduled_next_visit' : 'routine_recall';
  }

  // active (and any other fallback)
  if (highOpp && lowQuality) return 'chase_completion_data';
  if (highOpp && highQuality) return 'maintain_high_value';
  return 'monitor';
}

export function recommendedActionLabel(action: PeRecommendedAction): string {
  return PE_RECOMMENDED_ACTION_LABELS[action];
}

/** Short narrative for the detail card (rule-based, not plan-specific like the mockup). */
export function recommendedActionDetail(
  action: PeRecommendedAction,
  opportunityGross: number,
  opportunityWeighted: number,
): string {
  const gross =
    opportunityGross > 0
      ? `£${opportunityGross.toLocaleString('en-GB', { maximumFractionDigits: 0 })} gross pipeline`
      : 'no unscheduled plan value on file';
  const weighted =
    opportunityWeighted > 0
      ? `£${opportunityWeighted.toLocaleString('en-GB', { maximumFractionDigits: 0 })} weighted`
      : 'no weighted opportunity';

  switch (action) {
    case 'priority_reactivation':
      return `Lapsed patient with ${weighted} — prioritise reactivation outreach before value erodes further.`;
    case 'reactivation_relationship':
      return `Lapsed but high quality score — focus on relationship-led reactivation (${weighted}).`;
    case 'schedule_treatment_recall':
      return `Drifting with ${weighted} — book unscheduled treatment and recall (${gross}).`;
    case 'recall_follow_up':
      return `Drifting — recall follow-up; pipeline ${weighted}.`;
    case 'review_unscheduled_next_visit':
      return `Healthy with ${weighted} — review unscheduled treatment (${gross}) at the next visit.`;
    case 'chase_completion_data':
      return `High pipeline (${weighted}) but low quality/data score — chase completion and attribution gaps.`;
    case 'maintain_high_value':
      return `Active high-quality patient with ${weighted} — maintain engagement and scheduled care.`;
    case 'routine_recall':
      return `Healthy on recall track — routine recall; ${weighted} if plans exist.`;
    default:
      return `No urgent rule triggered — monitor (${weighted}).`;
  }
}

/** Map SQL snake_case action keys from the view to typed actions. */
export function parseRecommendedAction(raw: unknown): PeRecommendedAction {
  const key = String(raw || 'monitor');
  if (key in PE_RECOMMENDED_ACTION_LABELS) {
    return key as PeRecommendedAction;
  }
  return 'monitor';
}
