/**
 * Value & Leakage screen — practice rollup (opportunity + commitment breakdowns).
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  computePracticeCommitmentRate,
  computeCommitmentRatesByWindows,
  computeCommitmentRateByClinician,
  computeCommitmentConfidence,
  formatCommitmentTierNote,
  weightOpenPlansByCommitmentRate,
} = require('./commitmentRateLogic');
const {
  loadAggregatedPlans,
  loadEligiblePlanItems,
} = require('./commitmentRate');
const { summarizeOpportunityByCategory } = require('./opportunityCategoryLogic');
const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');

const PAGE_SIZE = 1000;

async function loadProviderLabelsByExtId(practiceId, extIds) {
  const map = new Map();
  const numericIds = [...new Set(extIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (numericIds.length === 0) return map;

  for (let i = 0; i < numericIds.length; i += PAGE_SIZE) {
    const chunk = numericIds.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabaseAdmin
      .from('providers')
      .select('id, external_id, name, provider_code')
      .eq('organization_id', practiceId)
      .in('external_id', chunk);

    if (error) throw new Error(`providers: ${error.message}`);

    for (const row of data ?? []) {
      if (row.external_id == null) continue;
      const extId = String(row.external_id);
      const label =
        (row.provider_code && String(row.provider_code).trim()) ||
        (row.name && String(row.name).trim()) ||
        `Clinician #${extId}`;
      map.set(extId, {
        providerId: String(row.id),
        practitionerName: label,
      });
    }
  }

  return map;
}

function summarizeOpportunity(byPatient) {
  let gross = 0;
  let weighted = 0;
  for (const entry of byPatient.values()) {
    gross += entry.gross;
    weighted += entry.weighted;
  }
  return {
    opportunityGross: Math.round(gross * 100) / 100,
    opportunityWeighted: Math.round(weighted * 100) / 100,
  };
}

/**
 * @param {string} practiceId
 * @param {{ locationId?: string | null, startDate?: string | null, endDate?: string | null }} [scope]
 */
async function getValueLeakageSummary(practiceId, scope = {}) {
  const { withPeReadCache } = require('./peReadCache');
  const { scopeCacheExtra } = require('./peReadScope');

  return withPeReadCache(
    'value-leakage-summary',
    practiceId,
    async () => {
      const assumptions = await loadPeEconomicAssumptions(practiceId);
      const defaultWindowDays = assumptions.commitmentRateWindowDays;
      const clinicianWindowDays = assumptions.commitmentRateClinicianWindowDays;
      const standardWindows = assumptions.commitmentRateStandardWindowsDays;
      const plans = await loadAggregatedPlans(practiceId, scope);
      const planIds = [...plans.keys()];
      const items = await loadEligiblePlanItems(practiceId, planIds);

      const commitmentForWeighting = computePracticeCommitmentRate(
        plans,
        items,
        defaultWindowDays,
      );
      const { byPatient, confidence, tierNote } = weightOpenPlansByCommitmentRate(
        plans,
        commitmentForWeighting,
      );
      const { opportunityGross, opportunityWeighted } = summarizeOpportunity(byPatient);
      const opportunityByCategory = summarizeOpportunityByCategory(
        plans,
        items,
        commitmentForWeighting.commitmentRate,
      );

      const commitment30d = computePracticeCommitmentRate(plans, items, 30);
      const byWindowRaw = computeCommitmentRatesByWindows(plans, items, standardWindows);
      const byClinicianRaw = computeCommitmentRateByClinician(
        plans,
        items,
        clinicianWindowDays,
      );

      const extIds = byClinicianRaw
        .map((r) => r.practitionerExtId)
        .filter((id) => id != null);
      const providerLabels = await loadProviderLabelsByExtId(practiceId, extIds);

      const byWindow = byWindowRaw.map((row) => ({
        windowDays: row.windowDays,
        commitmentRate: row.commitmentRate,
        totalEligibleValue: row.totalEligibleValue,
        committedValueWithinWindow: row.committedValueWithinWindow,
        eligibleItemCount: row.eligibleItemCount,
        committedItemCount: row.committedItemCount,
        confidence: computeCommitmentConfidence(row),
        tier: 'Derived',
        tierNote: formatCommitmentTierNote(row),
      }));

      const byClinician = byClinicianRaw.map((row) => {
        const extId = row.practitionerExtId;
        const meta = extId != null ? providerLabels.get(extId) : null;
        const unattributed = extId == null;
        return {
          practitionerExtId: extId,
          providerId: meta?.providerId ?? null,
          practitionerName: unattributed
            ? 'Unattributed'
            : meta?.practitionerName ?? `Clinician #${extId}`,
          windowDays: row.windowDays,
          commitmentRate: row.commitmentRate,
          totalEligibleValue: row.totalEligibleValue,
          committedValueWithinWindow: row.committedValueWithinWindow,
          eligibleItemCount: row.eligibleItemCount,
          committedItemCount: row.committedItemCount,
          confidence: computeCommitmentConfidence(row),
          tier: unattributed ? 'Derived' : 'Derived',
          attributionTier: unattributed ? 'partial_no_practitioner' : 'derived',
          tierNote: formatCommitmentTierNote(row),
        };
      });

      const unattributedEligible = byClinicianRaw
        .filter((r) => r.practitionerExtId == null)
        .reduce((s, r) => s + r.totalEligibleValue, 0);

      return {
        practiceId,
        opportunityGross,
        opportunityGrossTier: 'Derived',
        opportunityGrossTierNote:
          'Sum of open unscheduled planned private pipeline from event_ledger PLAN_CREATED (present-state unscheduled plans).',
        opportunityWeighted,
        opportunityWeightedTier: 'Modelled',
        opportunityWeightedTierNote: tierNote,
        opportunityWeightConfidence: confidence,
        opportunityByCategory,
        weightingWindowDays: defaultWindowDays,
        commitmentRate30d: commitment30d.commitmentRate,
        commitmentRate30dTier: 'Derived',
        commitmentRate30dConfidence: computeCommitmentConfidence(commitment30d),
        commitmentRate30dTierNote: formatCommitmentTierNote(commitment30d),
        commitmentRate30dEligibleValue: commitment30d.totalEligibleValue,
        commitmentRate30dCommittedValue: commitment30d.committedValueWithinWindow,
        byWindow,
        byClinician,
        clinicianWindowDays,
        hasUnattributedPlanItems: unattributedEligible > 0,
        unattributedEligibleValue: Math.round(unattributedEligible * 100) / 100,
        tier: 'Derived',
        tierNote:
          'Commitment Rate from event_ledger PLAN_CREATED → first APPOINTMENT_LINKED. Private plan items only; clinician attribution via treatment_plan_items.tpi_practitioner_id (Dentally external id).',
      };
    },
    { ttlMs: 120_000, extra: scopeCacheExtra(scope) },
  );
}

module.exports = {
  getValueLeakageSummary,
};
