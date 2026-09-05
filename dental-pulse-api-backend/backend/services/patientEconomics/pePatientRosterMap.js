/**
 * Map pe_patient_roster_* RPC rows into the PE list API shape.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function displayName(rawName, ptId) {
  const trimmed = String(rawName ?? '').trim();
  if (trimmed) return trimmed;
  if (ptId != null) return `Patient #${ptId}`;
  return 'Unknown patient';
}

function parseRetentionStatus(raw) {
  const s = String(raw || 'active').toLowerCase();
  if (
    s === 'active' ||
    s === 'drifting' ||
    s === 'lapsed' ||
    s === 'effectively_lost'
  ) {
    return s;
  }
  return 'active';
}

/**
 * Page RPC row → API patient object (contribution mode base).
 */
function mapRosterPageRow(row, practiceName) {
  if (row == null || row.patient_id == null) return null;

  const ptId =
    row.pt_id == null || row.pt_id === ''
      ? null
      : Number.isFinite(Number(row.pt_id))
        ? Number(row.pt_id)
        : null;

  const visits = num(row.visits_12mo);
  const c12 = num(row.contribution_12mo);
  const contribution = num(row.contribution);

  return {
    patientId: String(row.patient_id),
    ptId,
    patientName: displayName(row.patient_name, ptId),
    patientUuid:
      row.patient_uuid != null && String(row.patient_uuid).trim().length > 0
        ? String(row.patient_uuid).trim()
        : null,
    practiceName,
    locationId: row.location_id != null ? String(row.location_id) : null,
    locationName:
      row.location_name != null && String(row.location_name).trim().length > 0
        ? String(row.location_name).trim()
        : null,
    isActive: row.is_active === true,
    hasPaymentPlan: row.has_payment_plan === true,
    contribution12mo: c12,
    visits12mo: visits,
    visitFreqPerYear: row.visit_freq_per_year == null ? (visits > 0 ? visits : null) : num(row.visit_freq_per_year),
    valuePerVisit: row.value_per_visit == null ? null : num(row.value_per_visit),
    invoiceCount: num(row.invoice_count),
    invoicesWithRevenue: num(row.invoices_with_revenue),
    revenuePrivatePlan: num(row.revenue_private_plan),
    clinicianCost: num(row.clinician_cost),
    directCost: num(row.direct_cost),
    contribution,
    marginPct: row.margin_pct == null ? null : num(row.margin_pct),
    invoicesComplete: num(row.invoices_complete),
    invoicesPartialNoPractitioner: num(row.invoices_partial_no_practitioner),
    invoicesPartialMissingRate: num(row.invoices_partial_missing_rate),
    pctComplete: row.pct_complete == null ? null : num(row.pct_complete),
    contributionProvenanceStatus:
      row.contribution_provenance_status === 'partial_no_practitioner' ||
      row.contribution_provenance_status === 'partial_missing_rate'
        ? row.contribution_provenance_status
        : 'complete',
    revenueTier: row.revenue_tier != null ? String(row.revenue_tier) : 'Dentally',
    clinicianCostTier:
      row.clinician_cost_tier != null ? String(row.clinician_cost_tier) : 'Derived',
    contributionTier:
      row.contribution_tier != null ? String(row.contribution_tier) : 'Derived',
    confidenceScore: row.confidence_score == null ? null : num(row.confidence_score),
    retentionStatus: parseRetentionStatus(row.retention_status),
    retentionStatusTier: 'Modelled',
    opportunityGross: num(row.opportunity_gross),
    opportunityGrossTier: 'Derived',
    opportunityWeighted: num(row.opportunity_weighted),
    opportunityWeightedTier: 'Modelled',
    opportunityWeightedTierNote: null,
    opportunityWeightConfidence: 0,
    patientEconomicValue: num(row.patient_economic_value) || contribution,
    patientEconomicValueTier: 'Derived',
    patientEconomicValueTierNote: null,
    qualityScore: row.quality_score == null ? null : num(row.quality_score),
    recommendedAction:
      row.recommended_action != null && String(row.recommended_action).trim()
        ? String(row.recommended_action).trim()
        : null,
    recommendedActionTier: row.recommended_action != null ? 'Modelled' : null,
    recommendedActionTierNote: null,
    cltvProjection: row.cltv_projection == null ? null : num(row.cltv_projection),
    cltvTier: row.cltv_tier != null ? String(row.cltv_tier) : null,
    qualityScoreTier: row.quality_score_tier != null ? String(row.quality_score_tier) : null,
    modelledConfidenceScore:
      row.modelled_confidence_score == null ? null : num(row.modelled_confidence_score),
    modelledComputedAt: row.modelled_computed_at ?? null,
  };
}

function summaryFromRpc(row, prefix = '') {
  const g = (key) => row?.[`${prefix}${key}`];
  const totalPatients = num(g('total_patients'));
  return {
    totalPatients,
    activePatients: num(g('active_patients')),
    retentionActiveCount: num(g('retention_active_count')),
    retentionDriftingCount: num(g('retention_drifting_count')),
    retentionLapsedCount: num(g('retention_lapsed_count')),
    retentionEffectivelyLostCount: num(g('retention_effectively_lost_count')),
    privatePlanPatients: num(g('private_plan_patients')),
    memberPatients: num(g('member_patients')),
    privateTypePatients: num(g('private_type_patients')),
    nhsTypePatients: num(g('nhs_type_patients')),
    averageContribution: num(g('average_contribution')),
    averageProjectedLtv: num(g('average_projected_ltv')),
  };
}

function mapRosterSummaryRpc(row) {
  if (!row) {
    const empty = summaryFromRpc({});
    return {
      matchedTotal: 0,
      matchedUnfiltered: 0,
      summary: empty,
      baselineSummary: empty,
    };
  }
  return {
    matchedTotal: num(row.matched_total),
    matchedUnfiltered: num(row.matched_unfiltered),
    summary: summaryFromRpc(row),
    baselineSummary: summaryFromRpc(row, 'baseline_'),
  };
}

/** Orphans must never appear in table pages (patient_id required). */
function isRosterPageDisplayable(row) {
  return row != null && row.patient_id != null && String(row.patient_id).trim() !== '';
}

module.exports = {
  mapRosterPageRow,
  mapRosterSummaryRpc,
  isRosterPageDisplayable,
  summaryFromRpc,
};
