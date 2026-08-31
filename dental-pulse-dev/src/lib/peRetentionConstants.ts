/**
 * Re-exports retention segmentation types/helpers.
 * Rule table and thresholds: see peRetentionSegmentation.ts
 */

export {
  PE_RETENTION_DEFAULT_THRESHOLDS,
  PE_RETENTION_THRESHOLDS,
  PE_RETENTION_SEGMENT_ORDER,
  PE_AT_RISK_RETENTION_STATUSES,
  type PeRetentionStatus,
  type PeRetentionStatusTier,
  type PeRetentionStatusTone,
  type RetentionDisplay,
  parseRetentionStatus,
  parseRetentionStatusTier,
  retentionStatusLabel,
  retentionListLabel,
  retentionStatusTone,
  retentionDisplayFromRow,
  isAtRiskRetentionStatus,
} from '@/lib/peRetentionSegmentation';

/** Weighted opportunity provenance — learned Commitment Rate at API read. */
export const PE_OPPORTUNITY_WEIGHTED_TIER_NOTE =
  'Modelled — probability from historical Planned→Scheduled ledger conversions; confidence reflects sample size';
