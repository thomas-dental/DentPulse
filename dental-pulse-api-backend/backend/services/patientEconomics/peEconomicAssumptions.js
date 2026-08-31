/**
 * PE Economic Assumptions — single loader + save for practice-level config.
 * Defaults match inline constants / env fallbacks in production today.
 */

const { supabaseAdmin } = require('../../config/supabase');

const PE_ASSUMPTION_DEFAULTS = {
  membershipServiceCostAnnual: 0,
  defaultCac: 0,
  commitmentRateWindowDays: 30,
  commitmentRateClinicianWindowDays: 30,
  commitmentRateStandardWindowsDays: [7, 30, 60, 90],
  leakageUnscheduledThresholdDays: 60,
  growthLeversTrailingMonths: 12,
  growthLeversBenchmarkMethod: 'group_top',
  growthLeversTargetVisitFrequency: null,
  growthLeversTargetValuePerVisit: null,
  growthLeversTargetTenureYears: null,
  growthLeversTargetProjectedLifetimeYears: null,
  cltvAcquisitionMinSample: 5,
  collectionRateTrailingMonths: 12,
  cashLeakageCollectionWindowDays: 30,
  agingBucketBoundaryDays: [30, 60, 90],
  retentionDriftingVisitGapDays: 182,
  retentionLapsedRecallOverdueDays: 90,
  retentionLapsedVisitGapDays: 365,
  retentionEffectivelyLostRecallOverdueDays: 180,
  retentionEffectivelyLostVisitGapDays: 730,
  reactivationMinContributionAtRiskGbp: 100,
  reactivationRecoveryContributionWindowDays: 365,
  reactivationHighValueAtRiskGbp: 500,
  reactivationWorklistTrailingMonths: 12,
  recommendedActionHighOpportunityWeightedGbp: 500,
  recommendedActionHighQualityScore: 70,
  recommendedActionLowQualityScore: 40,
  projectedLifetimeYearsActive: 8,
  projectedLifetimeYearsDrifting: 5,
  projectedLifetimeYearsLapsed: 2,
  projectedLifetimeYearsEffectivelyLost: 1,
  cltvProjectionHorizonYears: 5,
  cltvProjectionDiscountRate: 0.1,
  modelledVisitsPerYearCap: 6,
  modelledMinVisitsPerYearActive: 0.5,
  modelledInactiveRetentionFactor: 0.3,
  modelledFullEngagementVisitsPerYear: 2,
  modelledQualityScorePlanBonus: 5,
  journeyMinPlannedEvents: 5,
  journeyMinTotalFunnelEvents: 10,
};

const DB_COLUMN_MAP = {
  membershipServiceCostAnnual: 'membership_service_cost_annual',
  defaultCac: 'default_cac',
  commitmentRateWindowDays: 'commitment_rate_window_days',
  commitmentRateClinicianWindowDays: 'commitment_rate_clinician_window_days',
  commitmentRateStandardWindowsDays: 'commitment_rate_standard_windows_days',
  leakageUnscheduledThresholdDays: 'leakage_unscheduled_threshold_days',
  growthLeversTrailingMonths: 'growth_levers_trailing_months',
  growthLeversBenchmarkMethod: 'growth_levers_benchmark_method',
  growthLeversTargetVisitFrequency: 'growth_levers_target_visit_frequency',
  growthLeversTargetValuePerVisit: 'growth_levers_target_value_per_visit',
  growthLeversTargetTenureYears: 'growth_levers_target_tenure_years',
  growthLeversTargetProjectedLifetimeYears: 'growth_levers_target_projected_lifetime_years',
  cltvAcquisitionMinSample: 'cltv_acquisition_min_sample',
  collectionRateTrailingMonths: 'collection_rate_trailing_months',
  cashLeakageCollectionWindowDays: 'cash_leakage_collection_window_days',
  agingBucketBoundaryDays: 'aging_bucket_boundary_days',
  retentionDriftingVisitGapDays: 'retention_drifting_visit_gap_days',
  retentionLapsedRecallOverdueDays: 'retention_lapsed_recall_overdue_days',
  retentionLapsedVisitGapDays: 'retention_lapsed_visit_gap_days',
  retentionEffectivelyLostRecallOverdueDays: 'retention_effectively_lost_recall_overdue_days',
  retentionEffectivelyLostVisitGapDays: 'retention_effectively_lost_visit_gap_days',
  reactivationMinContributionAtRiskGbp: 'reactivation_min_contribution_at_risk_gbp',
  reactivationRecoveryContributionWindowDays: 'reactivation_recovery_contribution_window_days',
  reactivationHighValueAtRiskGbp: 'reactivation_high_value_at_risk_gbp',
  reactivationWorklistTrailingMonths: 'reactivation_worklist_trailing_months',
  recommendedActionHighOpportunityWeightedGbp: 'recommended_action_high_opportunity_weighted_gbp',
  recommendedActionHighQualityScore: 'recommended_action_high_quality_score',
  recommendedActionLowQualityScore: 'recommended_action_low_quality_score',
  projectedLifetimeYearsActive: 'projected_lifetime_years_active',
  projectedLifetimeYearsDrifting: 'projected_lifetime_years_drifting',
  projectedLifetimeYearsLapsed: 'projected_lifetime_years_lapsed',
  projectedLifetimeYearsEffectivelyLost: 'projected_lifetime_years_effectively_lost',
  cltvProjectionHorizonYears: 'cltv_projection_horizon_years',
  cltvProjectionDiscountRate: 'cltv_projection_discount_rate',
  modelledVisitsPerYearCap: 'modelled_visits_per_year_cap',
  modelledMinVisitsPerYearActive: 'modelled_min_visits_per_year_active',
  modelledInactiveRetentionFactor: 'modelled_inactive_retention_factor',
  modelledFullEngagementVisitsPerYear: 'modelled_full_engagement_visits_per_year',
  modelledQualityScorePlanBonus: 'modelled_quality_score_plan_bonus',
  journeyMinPlannedEvents: 'journey_min_planned_events',
  journeyMinTotalFunnelEvents: 'journey_min_total_funnel_events',
};

const SELECT_COLUMNS = [...new Set(Object.values(DB_COLUMN_MAP))].join(', ');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function parseJsonIntArray(raw, fallback) {
  if (Array.isArray(raw)) {
    const nums = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
    return nums.length > 0 ? nums : fallback;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parseJsonIntArray(parsed, fallback);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function rowToAssumptions(row) {
  const out = { ...PE_ASSUMPTION_DEFAULTS };
  if (!row) return out;

  const numOr = (col, fallback) => {
    const n = Number(row[col]);
    return Number.isFinite(n) ? n : fallback;
  };

  out.membershipServiceCostAnnual = numOr('membership_service_cost_annual', out.membershipServiceCostAnnual);
  out.defaultCac = numOr('default_cac', out.defaultCac);
  out.commitmentRateWindowDays = Math.round(
    numOr('commitment_rate_window_days', out.commitmentRateWindowDays),
  );
  out.commitmentRateClinicianWindowDays = Math.round(
    numOr('commitment_rate_clinician_window_days', out.commitmentRateClinicianWindowDays),
  );
  out.commitmentRateStandardWindowsDays = parseJsonIntArray(
    row.commitment_rate_standard_windows_days,
    out.commitmentRateStandardWindowsDays,
  );
  out.leakageUnscheduledThresholdDays = Math.round(
    numOr('leakage_unscheduled_threshold_days', out.leakageUnscheduledThresholdDays),
  );
  out.growthLeversTrailingMonths = Math.round(
    numOr('growth_levers_trailing_months', out.growthLeversTrailingMonths),
  );
  const method = row.growth_levers_benchmark_method;
  out.growthLeversBenchmarkMethod =
    method === 'configured_target' ? 'configured_target' : 'group_top';
  out.growthLeversTargetVisitFrequency =
    row.growth_levers_target_visit_frequency != null
      ? numOr('growth_levers_target_visit_frequency', null)
      : null;
  out.growthLeversTargetValuePerVisit =
    row.growth_levers_target_value_per_visit != null
      ? numOr('growth_levers_target_value_per_visit', null)
      : null;
  out.growthLeversTargetTenureYears =
    row.growth_levers_target_tenure_years != null
      ? numOr('growth_levers_target_tenure_years', null)
      : null;
  out.growthLeversTargetProjectedLifetimeYears =
    row.growth_levers_target_projected_lifetime_years != null
      ? numOr('growth_levers_target_projected_lifetime_years', null)
      : null;
  out.cltvAcquisitionMinSample = Math.round(
    numOr('cltv_acquisition_min_sample', out.cltvAcquisitionMinSample),
  );
  out.collectionRateTrailingMonths = Math.round(
    numOr('collection_rate_trailing_months', out.collectionRateTrailingMonths),
  );
  out.cashLeakageCollectionWindowDays = Math.round(
    numOr('cash_leakage_collection_window_days', out.cashLeakageCollectionWindowDays),
  );
  out.agingBucketBoundaryDays = parseJsonIntArray(
    row.aging_bucket_boundary_days,
    out.agingBucketBoundaryDays,
  );
  out.retentionDriftingVisitGapDays = Math.round(
    numOr('retention_drifting_visit_gap_days', out.retentionDriftingVisitGapDays),
  );
  out.retentionLapsedRecallOverdueDays = Math.round(
    numOr('retention_lapsed_recall_overdue_days', out.retentionLapsedRecallOverdueDays),
  );
  out.retentionLapsedVisitGapDays = Math.round(
    numOr('retention_lapsed_visit_gap_days', out.retentionLapsedVisitGapDays),
  );
  out.retentionEffectivelyLostRecallOverdueDays = Math.round(
    numOr('retention_effectively_lost_recall_overdue_days', out.retentionEffectivelyLostRecallOverdueDays),
  );
  out.retentionEffectivelyLostVisitGapDays = Math.round(
    numOr('retention_effectively_lost_visit_gap_days', out.retentionEffectivelyLostVisitGapDays),
  );
  out.reactivationMinContributionAtRiskGbp = numOr(
    'reactivation_min_contribution_at_risk_gbp',
    out.reactivationMinContributionAtRiskGbp,
  );
  out.reactivationRecoveryContributionWindowDays = Math.round(
    numOr('reactivation_recovery_contribution_window_days', out.reactivationRecoveryContributionWindowDays),
  );
  out.reactivationHighValueAtRiskGbp = numOr(
    'reactivation_high_value_at_risk_gbp',
    out.reactivationHighValueAtRiskGbp,
  );
  out.reactivationWorklistTrailingMonths = Math.round(
    numOr('reactivation_worklist_trailing_months', out.reactivationWorklistTrailingMonths),
  );
  out.recommendedActionHighOpportunityWeightedGbp = numOr(
    'recommended_action_high_opportunity_weighted_gbp',
    out.recommendedActionHighOpportunityWeightedGbp,
  );
  out.recommendedActionHighQualityScore = Math.round(
    numOr('recommended_action_high_quality_score', out.recommendedActionHighQualityScore),
  );
  out.recommendedActionLowQualityScore = Math.round(
    numOr('recommended_action_low_quality_score', out.recommendedActionLowQualityScore),
  );
  out.projectedLifetimeYearsActive = numOr(
    'projected_lifetime_years_active',
    out.projectedLifetimeYearsActive,
  );
  out.projectedLifetimeYearsDrifting = numOr(
    'projected_lifetime_years_drifting',
    out.projectedLifetimeYearsDrifting,
  );
  out.projectedLifetimeYearsLapsed = numOr(
    'projected_lifetime_years_lapsed',
    out.projectedLifetimeYearsLapsed,
  );
  out.projectedLifetimeYearsEffectivelyLost = numOr(
    'projected_lifetime_years_effectively_lost',
    out.projectedLifetimeYearsEffectivelyLost,
  );
  out.cltvProjectionHorizonYears = Math.round(
    numOr('cltv_projection_horizon_years', out.cltvProjectionHorizonYears),
  );
  out.cltvProjectionDiscountRate = numOr(
    'cltv_projection_discount_rate',
    out.cltvProjectionDiscountRate,
  );
  out.modelledVisitsPerYearCap = numOr('modelled_visits_per_year_cap', out.modelledVisitsPerYearCap);
  out.modelledMinVisitsPerYearActive = numOr(
    'modelled_min_visits_per_year_active',
    out.modelledMinVisitsPerYearActive,
  );
  out.modelledInactiveRetentionFactor = numOr(
    'modelled_inactive_retention_factor',
    out.modelledInactiveRetentionFactor,
  );
  out.modelledFullEngagementVisitsPerYear = numOr(
    'modelled_full_engagement_visits_per_year',
    out.modelledFullEngagementVisitsPerYear,
  );
  out.modelledQualityScorePlanBonus = Math.round(
    numOr('modelled_quality_score_plan_bonus', out.modelledQualityScorePlanBonus),
  );
  out.journeyMinPlannedEvents = Math.round(
    numOr('journey_min_planned_events', out.journeyMinPlannedEvents),
  );
  out.journeyMinTotalFunnelEvents = Math.round(
    numOr('journey_min_total_funnel_events', out.journeyMinTotalFunnelEvents),
  );

  return out;
}

function assumptionsToRow(assumptions) {
  const row = {};
  for (const [camel, col] of Object.entries(DB_COLUMN_MAP)) {
    const val = assumptions[camel];
    if (val === undefined) continue;
    if (camel === 'commitmentRateStandardWindowsDays' || camel === 'agingBucketBoundaryDays') {
      row[col] = JSON.stringify(parseJsonIntArray(val, PE_ASSUMPTION_DEFAULTS[camel]));
    } else if (camel === 'growthLeversBenchmarkMethod') {
      row[col] = val === 'configured_target' ? 'configured_target' : 'group_top';
    } else if (
      camel.startsWith('growthLeversTarget') &&
      (val === null || val === '' || val === undefined)
    ) {
      row[col] = null;
    } else {
      row[col] = val;
    }
  }
  return row;
}

function clampAssumptionsInput(input = {}) {
  const a = { ...PE_ASSUMPTION_DEFAULTS, ...input };
  a.commitmentRateWindowDays = Math.min(
    365,
    Math.max(1, Math.round(Number(a.commitmentRateWindowDays) || 30)),
  );
  a.commitmentRateClinicianWindowDays = Math.min(
    365,
    Math.max(1, Math.round(Number(a.commitmentRateClinicianWindowDays) || 30)),
  );
  a.commitmentRateStandardWindowsDays = parseJsonIntArray(
    a.commitmentRateStandardWindowsDays,
    PE_ASSUMPTION_DEFAULTS.commitmentRateStandardWindowsDays,
  );
  a.leakageUnscheduledThresholdDays = Math.min(
    365,
    Math.max(1, Math.round(Number(a.leakageUnscheduledThresholdDays) || 60)),
  );
  a.growthLeversTrailingMonths = Math.min(
    60,
    Math.max(1, Math.round(Number(a.growthLeversTrailingMonths) || 12)),
  );
  a.growthLeversBenchmarkMethod =
    a.growthLeversBenchmarkMethod === 'configured_target' ? 'configured_target' : 'group_top';
  a.cltvAcquisitionMinSample = Math.min(
    100,
    Math.max(1, Math.round(Number(a.cltvAcquisitionMinSample) || 5)),
  );
  a.collectionRateTrailingMonths = Math.min(
    60,
    Math.max(1, Math.round(Number(a.collectionRateTrailingMonths) || 12)),
  );
  a.cashLeakageCollectionWindowDays = Math.min(
    365,
    Math.max(1, Math.round(Number(a.cashLeakageCollectionWindowDays) || 30)),
  );
  a.agingBucketBoundaryDays = parseJsonIntArray(
    a.agingBucketBoundaryDays,
    PE_ASSUMPTION_DEFAULTS.agingBucketBoundaryDays,
  );
  a.retentionDriftingVisitGapDays = Math.min(
    1095,
    Math.max(1, Math.round(Number(a.retentionDriftingVisitGapDays) || 182)),
  );
  a.retentionLapsedRecallOverdueDays = Math.min(
    365,
    Math.max(1, Math.round(Number(a.retentionLapsedRecallOverdueDays) || 90)),
  );
  a.retentionLapsedVisitGapDays = Math.min(
    1095,
    Math.max(1, Math.round(Number(a.retentionLapsedVisitGapDays) || 365)),
  );
  a.retentionEffectivelyLostRecallOverdueDays = Math.min(
    365,
    Math.max(1, Math.round(Number(a.retentionEffectivelyLostRecallOverdueDays) || 180)),
  );
  a.retentionEffectivelyLostVisitGapDays = Math.min(
    1825,
    Math.max(1, Math.round(Number(a.retentionEffectivelyLostVisitGapDays) || 730)),
  );
  a.reactivationMinContributionAtRiskGbp = Math.max(
    0,
    round2(Number(a.reactivationMinContributionAtRiskGbp) || 100),
  );
  a.reactivationRecoveryContributionWindowDays = Math.min(
    1095,
    Math.max(1, Math.round(Number(a.reactivationRecoveryContributionWindowDays) || 365)),
  );
  a.reactivationHighValueAtRiskGbp = Math.max(
    0,
    round2(Number(a.reactivationHighValueAtRiskGbp) || 500),
  );
  a.reactivationWorklistTrailingMonths = Math.min(
    60,
    Math.max(1, Math.round(Number(a.reactivationWorklistTrailingMonths) || 12)),
  );
  a.recommendedActionHighOpportunityWeightedGbp = Math.max(
    0,
    round2(Number(a.recommendedActionHighOpportunityWeightedGbp) || 500),
  );
  a.recommendedActionHighQualityScore = Math.min(
    100,
    Math.max(0, Math.round(Number(a.recommendedActionHighQualityScore) || 70)),
  );
  a.recommendedActionLowQualityScore = Math.min(
    100,
    Math.max(0, Math.round(Number(a.recommendedActionLowQualityScore) || 40)),
  );
  a.projectedLifetimeYearsActive = Math.min(
    30,
    Math.max(0, round2(Number(a.projectedLifetimeYearsActive) || 8)),
  );
  a.projectedLifetimeYearsDrifting = Math.min(
    30,
    Math.max(0, round2(Number(a.projectedLifetimeYearsDrifting) || 5)),
  );
  a.projectedLifetimeYearsLapsed = Math.min(
    30,
    Math.max(0, round2(Number(a.projectedLifetimeYearsLapsed) || 2)),
  );
  a.projectedLifetimeYearsEffectivelyLost = Math.min(
    30,
    Math.max(0, round2(Number(a.projectedLifetimeYearsEffectivelyLost) || 1)),
  );
  a.cltvProjectionHorizonYears = Math.min(
    20,
    Math.max(1, Math.round(Number(a.cltvProjectionHorizonYears) || 5)),
  );
  a.cltvProjectionDiscountRate = Math.min(
    1,
    Math.max(0, round2(Number(a.cltvProjectionDiscountRate) || 0.1)),
  );
  a.modelledVisitsPerYearCap = Math.min(
    24,
    Math.max(1, round2(Number(a.modelledVisitsPerYearCap) || 6)),
  );
  a.modelledMinVisitsPerYearActive = Math.min(
    12,
    Math.max(0, round2(Number(a.modelledMinVisitsPerYearActive) || 0.5)),
  );
  a.modelledInactiveRetentionFactor = Math.min(
    1,
    Math.max(0, round2(Number(a.modelledInactiveRetentionFactor) || 0.3)),
  );
  a.modelledFullEngagementVisitsPerYear = Math.min(
    24,
    Math.max(0.5, round2(Number(a.modelledFullEngagementVisitsPerYear) || 2)),
  );
  a.modelledQualityScorePlanBonus = Math.min(
    25,
    Math.max(0, Math.round(Number(a.modelledQualityScorePlanBonus) || 5)),
  );
  a.journeyMinPlannedEvents = Math.min(
    100,
    Math.max(1, Math.round(Number(a.journeyMinPlannedEvents) || 5)),
  );
  a.journeyMinTotalFunnelEvents = Math.min(
    500,
    Math.max(1, Math.round(Number(a.journeyMinTotalFunnelEvents) || 10)),
  );
  a.membershipServiceCostAnnual = Math.max(
    0,
    round2(Number(a.membershipServiceCostAnnual) || 0),
  );
  a.defaultCac = Math.max(0, round2(Number(a.defaultCac) || 0));

  const parseNullableTarget = (v) => {
    if (v === null || v === '' || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? round2(n) : null;
  };
  a.growthLeversTargetVisitFrequency = parseNullableTarget(a.growthLeversTargetVisitFrequency);
  a.growthLeversTargetValuePerVisit = parseNullableTarget(a.growthLeversTargetValuePerVisit);
  a.growthLeversTargetTenureYears = parseNullableTarget(a.growthLeversTargetTenureYears);
  a.growthLeversTargetProjectedLifetimeYears = parseNullableTarget(
    a.growthLeversTargetProjectedLifetimeYears,
  );

  return a;
}

async function loadPeEconomicAssumptions(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('pe_economic_assumptions')
    .select(SELECT_COLUMNS)
    .eq('practice_id', practiceId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`pe_economic_assumptions: ${error.message}`);
  }

  return rowToAssumptions(data);
}

async function getEconomicAssumptionsSummary(practiceId) {
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  return {
    practiceId,
    assumptions,
    defaults: { ...PE_ASSUMPTION_DEFAULTS },
    opsOnlyNote:
      'Dentally sync schedules, retry policy, and modelled-score batch limits are environment variables (PE_SYNC_*, PE_MODELLED_MAX_PRACTICES) — ops-only, not editable in this panel.',
  };
}

async function saveEconomicAssumptions(userId, practiceId, payload) {
  const clamped = clampAssumptionsInput(payload?.assumptions ?? payload);
  const row = assumptionsToRow(clamped);
  row.practice_id = practiceId;
  row.updated_at = new Date().toISOString();

  const { error } = await supabaseAdmin.from('pe_economic_assumptions').upsert(row, {
    onConflict: 'practice_id',
  });

  if (error) throw new Error(`pe_economic_assumptions upsert: ${error.message}`);

  return getEconomicAssumptionsSummary(practiceId);
}

function projectedLifetimeYearsMap(assumptions) {
  return {
    active: assumptions.projectedLifetimeYearsActive,
    drifting: assumptions.projectedLifetimeYearsDrifting,
    lapsed: assumptions.projectedLifetimeYearsLapsed,
    effectively_lost: assumptions.projectedLifetimeYearsEffectivelyLost,
  };
}

function retentionThresholdsFromAssumptions(assumptions) {
  return {
    DRIFTING_VISIT_GAP_DAYS: assumptions.retentionDriftingVisitGapDays,
    LAPSED_RECALL_OVERDUE_DAYS: assumptions.retentionLapsedRecallOverdueDays,
    LAPSED_VISIT_GAP_DAYS: assumptions.retentionLapsedVisitGapDays,
    EFFECTIVELY_LOST_RECALL_OVERDUE_DAYS: assumptions.retentionEffectivelyLostRecallOverdueDays,
    EFFECTIVELY_LOST_VISIT_GAP_DAYS: assumptions.retentionEffectivelyLostVisitGapDays,
  };
}

function discountFactorFromAssumptions(assumptions) {
  const rate = assumptions.cltvProjectionDiscountRate;
  const years = assumptions.cltvProjectionHorizonYears;
  return Array.from({ length: years }, (_, i) => 1 / (1 + rate) ** (i + 1)).reduce(
    (a, b) => a + b,
    0,
  );
}

module.exports = {
  PE_ASSUMPTION_DEFAULTS,
  DB_COLUMN_MAP,
  loadPeEconomicAssumptions,
  getEconomicAssumptionsSummary,
  saveEconomicAssumptions,
  clampAssumptionsInput,
  projectedLifetimeYearsMap,
  retentionThresholdsFromAssumptions,
  discountFactorFromAssumptions,
};
