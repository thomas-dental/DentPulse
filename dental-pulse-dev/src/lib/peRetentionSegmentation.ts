/**
 * Patient Economics — 4-tier retention segmentation (shared rule table).
 *
 * Source of truth for classification: SQL `pe_retention_status()` on
 * `v_patient_contribution` / `v_pe_retention_segment` (migration
 * 20260830250002 + 20260830260001). App code parses DB output only — do not
 * recompute segments in the UI.
 *
 * ---------------------------------------------------------------------------
 * RULE TABLE (evaluated in order; first match wins)
 *
 * | # | Condition | Status | Tier |
 * |---|-----------|--------|------|
 * | 1 | patients.is_active = false | effectively_lost | Derived |
 * | 2 | days since last completed visit > EFFECTIVELY_LOST_VISIT_GAP_DAYS | effectively_lost | Modelled |
 * | 3 | max(dentist/hygienist recall overdue days) > EFFECTIVELY_LOST_RECALL_OVERDUE_DAYS | effectively_lost | Modelled |
 * | 4 | max recall overdue > LAPSED_RECALL_OVERDUE_DAYS | lapsed | Modelled |
 * | 5 | days since last visit > LAPSED_VISIT_GAP_DAYS | lapsed | Modelled |
 * | 6 | max recall overdue in 1..LAPSED_RECALL_OVERDUE_DAYS | drifting | Modelled |
 * | 7 | days since last visit > DRIFTING_VISIT_GAP_DAYS | drifting | Modelled |
 * | 8 | default | active | Derived |
 *
 * Completed visit = appointments.apmt_completed_at IS NOT NULL OR
 * lower(apmt_state) = 'completed' (excludes cancelled / DNA).
 *
 * Recall overdue = GREATEST overdue days across dentist + hygienist recall dates
 * vs UTC today (pe_max_recall_overdue_days).
 *
 * Threshold defaults mirror pe_economic_assumptions; tunable per practice in
 * Economic Assumptions → Retention thresholds. Tag Modelled rules as assumptions,
 * not Dentally facts.
 *
 * Legacy: Step 2 inline CASE used `healthy` (future recall booked) and mapped
 * is_active=false → lapsed. `healthy` is normalized to `active` when parsing.
 * event_ledger RECALL_* / PATIENT_REACTIVATED support journey analytics but are
 * not inputs to this segmentation today.
 */

export type PeRetentionStatus =
  | 'active'
  | 'drifting'
  | 'lapsed'
  | 'effectively_lost';

export type PeRetentionStatusTier = 'Derived' | 'Modelled';

export type PeRetentionStatusTone = PeRetentionStatus;

export const PE_RETENTION_SEGMENT_ORDER: PeRetentionStatus[] = [
  'active',
  'drifting',
  'lapsed',
  'effectively_lost',
];

export const PE_AT_RISK_RETENTION_STATUSES: PeRetentionStatus[] = [
  'drifting',
  'lapsed',
  'effectively_lost',
];

/** Default day thresholds — keep aligned with pe_economic_assumptions columns. */
export const PE_RETENTION_DEFAULT_THRESHOLDS = {
  DRIFTING_VISIT_GAP_DAYS: 182,
  LAPSED_RECALL_OVERDUE_DAYS: 90,
  LAPSED_VISIT_GAP_DAYS: 365,
  EFFECTIVELY_LOST_RECALL_OVERDUE_DAYS: 180,
  EFFECTIVELY_LOST_VISIT_GAP_DAYS: 730,
} as const;

/** @deprecated Use PE_RETENTION_DEFAULT_THRESHOLDS */
export const PE_RETENTION_THRESHOLDS = {
  LAPSED_RECALL_OVERDUE_DAYS: PE_RETENTION_DEFAULT_THRESHOLDS.LAPSED_RECALL_OVERDUE_DAYS,
  DRIFTING_VISIT_GAP_DAYS: PE_RETENTION_DEFAULT_THRESHOLDS.DRIFTING_VISIT_GAP_DAYS,
  LAPSED_VISIT_GAP_DAYS: PE_RETENTION_DEFAULT_THRESHOLDS.LAPSED_VISIT_GAP_DAYS,
} as const;

export function parseRetentionStatus(raw: unknown): PeRetentionStatus {
  const s = String(raw ?? 'active').toLowerCase().trim();
  if (s === 'healthy') return 'active';
  if (s === 'drifting' || s === 'lapsed' || s === 'effectively_lost') return s;
  return 'active';
}

export function parseRetentionStatusTier(raw: unknown): PeRetentionStatusTier {
  return String(raw ?? 'Derived') === 'Modelled' ? 'Modelled' : 'Derived';
}

export function retentionStatusLabel(status: PeRetentionStatus): string {
  switch (status) {
    case 'effectively_lost':
      return 'Effectively lost';
    case 'lapsed':
      return 'Lapsed';
    case 'drifting':
      return 'Drifting';
    default:
      return 'Active';
  }
}

/** @deprecated Use retentionStatusLabel */
export function retentionListLabel(status: PeRetentionStatus): string {
  return retentionStatusLabel(status);
}

export function retentionStatusTone(status: PeRetentionStatus): PeRetentionStatusTone {
  return status;
}

export type RetentionDisplay = {
  status: PeRetentionStatus;
  label: string;
  tier: PeRetentionStatusTier;
  tone: PeRetentionStatusTone;
};

export function retentionDisplayFromRow(
  statusRaw: unknown,
  tierRaw: unknown,
): RetentionDisplay {
  const status = parseRetentionStatus(statusRaw);
  return {
    status,
    label: retentionStatusLabel(status),
    tier: parseRetentionStatusTier(tierRaw),
    tone: retentionStatusTone(status),
  };
}

export function isAtRiskRetentionStatus(status: PeRetentionStatus): boolean {
  return PE_AT_RISK_RETENTION_STATUSES.includes(status);
}
