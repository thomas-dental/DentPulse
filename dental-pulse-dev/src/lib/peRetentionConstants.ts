/**
 * Patient Economics retention thresholds — must stay aligned with
 * supabase/migrations/20260828140001_v_patient_contribution_retention_opportunity.sql
 *
 * Derived rules use synced Dentally / appointment facts directly.
 * Modelled rules apply explicit day thresholds (assumptions, not facts).
 */
export const PE_RETENTION_THRESHOLDS = {
  /** Recall overdue beyond this → lapsed (Modelled). */
  LAPSED_RECALL_OVERDUE_DAYS: 90,
  /** No completed visit within this window → drifting (Modelled). */
  DRIFTING_VISIT_GAP_DAYS: 182,
  /** No completed visit beyond this → lapsed (Modelled). */
  LAPSED_VISIT_GAP_DAYS: 365,
} as const;

export type PeRetentionStatus = 'active' | 'drifting' | 'lapsed' | 'healthy';

export type PeRetentionStatusTier = 'Derived' | 'Modelled';

/** Weighted opportunity provenance until M6 Value & Leakage. */
export const PE_OPPORTUNITY_WEIGHTED_TIER_NOTE =
  'Modelled — partial, full weighting arrives with Value & Leakage (M6)';
