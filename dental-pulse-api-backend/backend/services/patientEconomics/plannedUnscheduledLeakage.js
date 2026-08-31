/**
 * Planned > N days unscheduled — API read layer (event_ledger + plan items).
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  aggregatePlansFromLedger,
} = require('./commitmentRateLogic');
const {
  DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS,
  buildPlannedUnscheduledLeakageRows,
  summarizeLeakageRows,
} = require('./plannedUnscheduledLeakageLogic');
const {
  loadLedgerPlanEvents,
  loadEligiblePlanItems,
} = require('./commitmentRate');

const PAGE_SIZE = 1000;
/** PostgREST `.in(id, …)` URL limit — keep well below 1000 UUIDs per request. */
const PATIENT_NAME_CHUNK = 200;

async function loadLeakageThresholdDays(practiceId) {
  const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  return assumptions.leakageUnscheduledThresholdDays || DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS;
}

async function loadPracticeMarginPct(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('v_practice_contribution')
    .select('margin_pct, contribution, revenue_private_plan')
    .eq('practice_id', practiceId)
    .maybeSingle();

  if (error) return null;

  const pct = Number(data?.margin_pct);
  if (Number.isFinite(pct) && pct > 0) return pct;

  const rev = Number(data?.revenue_private_plan);
  const contrib = Number(data?.contribution);
  if (rev > 0 && contrib > 0) return Math.round((contrib / rev) * 1000) / 10;

  return null;
}

async function loadPatientNames(practiceId, patientIds) {
  const map = new Map();
  if (patientIds.length === 0) return map;

  for (let i = 0; i < patientIds.length; i += PATIENT_NAME_CHUNK) {
    const chunk = patientIds.slice(i, i + PATIENT_NAME_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select('id, pt_first_name, pt_last_name, pt_id')
      .eq('organization_id', practiceId)
      .in('id', chunk)
      .is('deleted_at', null);

    if (error) throw new Error(`patients: ${error.message}`);

    for (const row of data ?? []) {
      const name = [row.pt_first_name, row.pt_last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      map.set(
        String(row.id),
        name || (row.pt_id != null ? `Patient #${row.pt_id}` : 'Unknown patient'),
      );
    }
  }

  return map;
}

/**
 * @param {string} practiceId
 */
async function getPlannedUnscheduledLeakage(practiceId) {
  const thresholdDays = await loadLeakageThresholdDays(practiceId);
  const ledgerRows = await loadLedgerPlanEvents(practiceId);
  const plans = aggregatePlansFromLedger(ledgerRows);
  const planIds = [...plans.keys()];
  const items = await loadEligiblePlanItems(practiceId, planIds);

  const patientIds = [...new Set([...plans.values()].map((p) => p.patientId))];
  const patientNames = await loadPatientNames(practiceId, patientIds);

  const rows = buildPlannedUnscheduledLeakageRows(
    plans,
    items,
    thresholdDays,
    patientNames,
  );
  const summary = summarizeLeakageRows(rows);
  const marginPct = await loadPracticeMarginPct(practiceId);
  const contributionOpportunity =
    marginPct != null && summary.totalValueAtRisk > 0
      ? Math.round(summary.totalValueAtRisk * (marginPct / 100) * 100) / 100
      : null;

  return {
    practiceId,
    thresholdDays,
    tier: 'Derived',
    tierNote:
      'Private planned items on ledger plans with no active appointment link beyond threshold days after PLAN_CREATED. NHS items excluded.',
    marginPct,
    contributionOpportunity,
    ...summary,
    rows,
  };
}

module.exports = {
  DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS,
  getPlannedUnscheduledLeakage,
};
