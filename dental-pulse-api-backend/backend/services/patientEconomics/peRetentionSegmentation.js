/**
 * Patient Economics — 4-tier retention segmentation (shared rule table).
 *
 * Mirror of dental-pulse-dev/src/lib/peRetentionSegmentation.ts — keep in sync.
 * Classification is computed in SQL (pe_retention_status); this module parses and
 * labels DB output for API responses.
 *
 * See migration comments in 20260830260001_pe_retention_segmentation_formalize.sql
 * for the full ordered rule table and default thresholds.
 */

const PE_RETENTION_DEFAULT_THRESHOLDS = {
  DRIFTING_VISIT_GAP_DAYS: 182,
  LAPSED_RECALL_OVERDUE_DAYS: 90,
  LAPSED_VISIT_GAP_DAYS: 365,
  EFFECTIVELY_LOST_RECALL_OVERDUE_DAYS: 180,
  EFFECTIVELY_LOST_VISIT_GAP_DAYS: 730,
};

function parseRetentionStatus(raw) {
  const s = String(raw ?? 'active').toLowerCase().trim();
  if (s === 'healthy') return 'active';
  if (s === 'drifting' || s === 'lapsed' || s === 'effectively_lost') return s;
  return 'active';
}

function parseRetentionStatusTier(raw) {
  return String(raw ?? 'Derived') === 'Modelled' ? 'Modelled' : 'Derived';
}

function retentionStatusLabel(status) {
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

function retentionDisplayFromRow(statusRaw, tierRaw) {
  const status = parseRetentionStatus(statusRaw);
  return {
    status,
    label: retentionStatusLabel(status),
    tier: parseRetentionStatusTier(tierRaw),
    tone: status,
  };
}

function isAtRiskRetentionStatus(status) {
  return status === 'lapsed' || status === 'effectively_lost';
}

module.exports = {
  PE_RETENTION_DEFAULT_THRESHOLDS,
  parseRetentionStatus,
  parseRetentionStatusTier,
  retentionStatusLabel,
  retentionDisplayFromRow,
  isAtRiskRetentionStatus,
};
