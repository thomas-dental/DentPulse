/**
 * Economic Pulse hero row — single fast read aggregating invoice, leakage, retention, growth.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { withPeReadCache } = require('./peReadCache');
const { getInvoiceContributionSummary } = require('./patientEconomicsRead');
const { getValueLeakageSummary } = require('./valueLeakageSummary');
const { getGrowthLeversSummary } = require('./growthLeversSummary');
const {
  parseRetentionStatus,
  retentionStatusLabel,
} = require('./peRetentionSegmentation');

const SEGMENT_ORDER = ['active', 'drifting', 'lapsed', 'effectively_lost'];
const AT_RISK_STATUSES = new Set(['drifting', 'lapsed', 'effectively_lost']);
const DERIVED_TIER = 'Derived';
const TIER_NOTE =
  'Sum of invoice contribution on v_patient_contribution per retention segment (pe_retention_status). Segmentation thresholds are Modelled; contribution £ is Derived.';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function rollupFromSegmentRpc(segments) {
  const buckets = Object.fromEntries(
    SEGMENT_ORDER.map((status) => [status, { patientCount: 0, contributionGbp: 0 }]),
  );

  for (const seg of segments ?? []) {
    const status = parseRetentionStatus(seg.retention_status);
    if (!buckets[status]) continue;
    buckets[status].patientCount += num(seg.patient_count);
    buckets[status].contributionGbp += num(seg.contribution_gbp);
  }

  const segmentRows = SEGMENT_ORDER.map((status) => ({
    status,
    label: retentionStatusLabel(status),
    patientCount: buckets[status].patientCount,
    contributionGbp: round2(buckets[status].contributionGbp),
  }));

  const atRiskContributionGbp = round2(
    segmentRows
      .filter((s) => AT_RISK_STATUSES.has(s.status))
      .reduce((sum, s) => sum + s.contributionGbp, 0),
  );

  return {
    atRiskContributionGbp,
    tier: DERIVED_TIER,
    tierNote: TIER_NOTE,
  };
}

async function loadRetentionAtRiskRollup(practiceId) {
  const { data, error } = await supabaseAdmin.rpc('pe_retention_segment_rollup', {
    p_practice_id: practiceId,
    p_location_id: null,
  });
  if (error) throw new Error(`pe_retention_segment_rollup: ${error.message}`);
  return rollupFromSegmentRpc(data);
}

function computeProjectedLtv(growth) {
  if (!growth) return null;
  const life = growth.projectedLifetimeYears ?? growth.tenureYears;
  if (
    growth.visitFrequency == null ||
    growth.valuePerVisit == null ||
    life == null ||
    !Number.isFinite(growth.visitFrequency) ||
    !Number.isFinite(growth.valuePerVisit) ||
    !Number.isFinite(life)
  ) {
    return null;
  }
  return Math.round(growth.visitFrequency * growth.valuePerVisit * life);
}

function computeAvgAnnualContribution(growth) {
  if (!growth || growth.activePatientCount <= 0) return null;
  const months = growth.trailingMonths > 0 ? growth.trailingMonths : 12;
  const annualized = (growth.totalRevenuePrivatePlan / months) * 12;
  return Math.round(annualized / growth.activePatientCount);
}

/**
 * @param {string} practiceId
 */
async function getEconomicPulseHero(practiceId) {
  return withPeReadCache(
    'economic-pulse-hero',
    practiceId,
    async () => {
      const [invoiceSummary, leakage, growth, retention] = await Promise.all([
        getInvoiceContributionSummary(practiceId),
        getValueLeakageSummary(practiceId),
        getGrowthLeversSummary(practiceId),
        loadRetentionAtRiskRollup(practiceId),
      ]);

      return {
        practiceId,
        invoiceSummary,
        opportunityWeighted: leakage.opportunityWeighted,
        opportunityGross: leakage.opportunityGross,
        opportunityWeightedTier: leakage.opportunityWeightedTier,
        atRiskContributionGbp: retention.atRiskContributionGbp,
        retentionTier: retention.tier,
        commitmentRate30d: leakage.commitmentRate30d,
        commitmentRate30dTier: leakage.commitmentRate30dTier,
        avgAnnualContribution: computeAvgAnnualContribution(growth),
        projectedLtv: computeProjectedLtv(growth),
        projectedLtvTier: growth.projectedLifetimeTier ?? 'Modelled',
      };
    },
    { ttlMs: 120_000 },
  );
}

module.exports = {
  getEconomicPulseHero,
};
