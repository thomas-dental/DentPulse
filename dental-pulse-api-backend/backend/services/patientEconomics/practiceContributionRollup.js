/**
 * Practice contribution rollup for Cost Impact / multi-site location bars.
 * Uses SQL RPCs (facts when available) instead of paginating invoice grain in Node.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { resolvePeRollupUnits } = require('./peRollupUnits');
const { withPeReadCache } = require('./peReadCache');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function emptyRow(unit, organizationName) {
  return {
    practiceId: unit.unitId,
    practiceName: unit.unitName,
    unitType: unit.unitType,
    organizationId: unit.organizationId,
    invoiceCount: 0,
    invoicesWithRevenue: 0,
    patientCount: 0,
    patientsWithRevenue: 0,
    revenuePrivatePlan: 0,
    clinicianCost: 0,
    directCost: 0,
    contribution: 0,
    marginPct: null,
    invoicesComplete: 0,
    invoicesPartialNoPractitioner: 0,
    invoicesPartialMissingRate: 0,
    pctComplete: null,
    pctPartialNoPractitioner: null,
    pctPartialMissingRate: null,
    contributionProvenanceStatus: 'complete',
    revenueTier: 'Dentally',
    clinicianCostTier: 'Derived',
    contributionTier: 'Derived',
    confidenceScore: null,
  };
}

function finalizeRow(row) {
  const withRevenue = row.invoicesWithRevenue;
  row.marginPct =
    row.revenuePrivatePlan > 0
      ? Math.round((row.contribution / row.revenuePrivatePlan) * 1000) / 10
      : null;
  row.pctComplete =
    withRevenue > 0 ? Math.round((1000 * row.invoicesComplete) / withRevenue) / 10 : null;
  row.pctPartialNoPractitioner =
    withRevenue > 0
      ? Math.round((1000 * row.invoicesPartialNoPractitioner) / withRevenue) / 10
      : null;
  row.pctPartialMissingRate =
    withRevenue > 0
      ? Math.round((1000 * row.invoicesPartialMissingRate) / withRevenue) / 10
      : null;

  if (row.invoicesPartialNoPractitioner > 0) {
    row.contributionProvenanceStatus = 'partial_no_practitioner';
  } else if (row.invoicesPartialMissingRate > 0) {
    row.contributionProvenanceStatus = 'partial_missing_rate';
  } else {
    row.contributionProvenanceStatus = 'complete';
  }

  if (row.invoicesPartialNoPractitioner > 0 || row.invoicesPartialMissingRate > 0) {
    row.clinicianCostTier = 'External';
  } else {
    row.clinicianCostTier = 'Derived';
  }

  if (row.confidenceScore != null && row.invoiceCount > 0) {
    row.confidenceScore = Math.round(row.confidenceScore / row.invoiceCount);
  }

  row.revenuePrivatePlan = Math.round(row.revenuePrivatePlan * 100) / 100;
  row.clinicianCost = Math.round(row.clinicianCost * 100) / 100;
  row.directCost = Math.round(row.directCost * 100) / 100;
  row.contribution = Math.round(row.contribution * 100) / 100;

  return row;
}

function rowFromPracticeFacts(unit, facts) {
  const row = emptyRow(unit);
  if (!facts || typeof facts !== 'object') return finalizeRow(row);

  row.invoiceCount = num(facts.invoice_count);
  row.invoicesWithRevenue = num(facts.invoices_with_revenue);
  row.patientCount = num(facts.patient_count);
  row.patientsWithRevenue = num(facts.patients_with_revenue);
  row.revenuePrivatePlan = num(facts.revenue_private_plan);
  row.clinicianCost = num(facts.clinician_cost);
  row.directCost = num(facts.direct_cost);
  row.contribution = num(facts.contribution);
  row.invoicesComplete = num(facts.invoices_complete);
  row.invoicesPartialNoPractitioner = num(facts.invoices_partial_no_practitioner);
  row.invoicesPartialMissingRate = num(facts.invoices_partial_missing_rate);
  row.pctComplete = facts.pct_complete != null ? num(facts.pct_complete) : null;
  row.pctPartialNoPractitioner =
    facts.pct_partial_no_practitioner != null
      ? num(facts.pct_partial_no_practitioner)
      : null;
  row.pctPartialMissingRate =
    facts.pct_partial_missing_rate != null ? num(facts.pct_partial_missing_rate) : null;
  row.contributionProvenanceStatus =
    String(facts.contribution_provenance_status || 'complete');
  row.revenueTier = String(facts.revenue_tier || 'Dentally');
  row.clinicianCostTier = String(facts.clinician_cost_tier || 'Derived');
  row.contributionTier = String(facts.contribution_tier || 'Derived');
  row.confidenceScore =
    facts.confidence_score != null ? num(facts.confidence_score) : null;

  return finalizeRow(row);
}

function rowFromLocationFacts(unit, loc) {
  const row = emptyRow(unit);
  if (!loc || typeof loc !== 'object') return finalizeRow(row);

  row.invoiceCount = num(loc.invoice_count);
  row.invoicesWithRevenue = num(loc.invoices_with_revenue);
  row.patientCount = num(loc.patient_count);
  row.patientsWithRevenue = num(loc.patients_with_revenue);
  row.revenuePrivatePlan = num(loc.revenue_private_plan);
  row.clinicianCost = num(loc.clinician_cost);
  row.directCost = num(loc.direct_cost);
  row.contribution = num(loc.contribution);
  row.invoicesComplete = num(loc.invoices_complete);
  row.invoicesPartialNoPractitioner = num(loc.invoices_partial_no_practitioner);
  row.invoicesPartialMissingRate = num(loc.invoices_partial_missing_rate);
  row.confidenceScore = loc.confidence_score_sum != null ? num(loc.confidence_score_sum) : null;

  return finalizeRow(row);
}

/**
 * @param {string} userId
 */
async function getPracticeContributionRollup(userId) {
  const { loadUserPracticeIds } = require('./peRollupUnits');
  const practiceIds = await loadUserPracticeIds(userId);
  const contextPracticeId = practiceIds[0] ?? '';
  const { rollupMode, units } = await resolvePeRollupUnits(userId, contextPracticeId);
  if (units.length === 0) {
    return { rollupMode: 'practice', rows: [] };
  }

  const cacheKey = units.map((u) => u.unitId).join(',');

  return withPeReadCache('practice-contribution-rollup', userId, async () => {
    const rows = [];

    if (rollupMode === 'practice') {
      for (const unit of units) {
        const { data, error } = await supabaseAdmin.rpc('pe_practice_contribution_row', {
          p_practice_id: unit.organizationId,
        });
        if (error) throw new Error(`pe_practice_contribution_row: ${error.message}`);
        rows.push(rowFromPracticeFacts(unit, data));
      }
    } else {
      const orgIds = [...new Set(units.map((u) => u.organizationId))];
      const locationFactsByOrg = new Map();

      for (const orgId of orgIds) {
        const { data, error } = await supabaseAdmin.rpc('pe_location_contribution_rollup', {
          p_practice_id: orgId,
        });
        if (error) throw new Error(`pe_location_contribution_rollup: ${error.message}`);
        const byLocation = new Map();
        for (const loc of data ?? []) {
          if (loc?.location_id) byLocation.set(String(loc.location_id), loc);
        }
        locationFactsByOrg.set(orgId, byLocation);
      }

      for (const unit of units) {
        const byLocation = locationFactsByOrg.get(unit.organizationId) ?? new Map();
        const locFacts = unit.locationId ? byLocation.get(unit.locationId) : null;
        rows.push(rowFromLocationFacts(unit, locFacts));
      }
    }

    rows.sort((a, b) => b.contribution - a.contribution);
    return { rollupMode, rows };
  }, { extra: cacheKey });
}

module.exports = {
  getPracticeContributionRollup,
};
