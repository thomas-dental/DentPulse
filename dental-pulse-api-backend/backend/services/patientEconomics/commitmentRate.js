/**
 * Practice Commitment Rate — loads ledger + plan items + assumptions from DB.
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  DEFAULT_COMMITMENT_RATE_WINDOW_DAYS,
  computePracticeCommitmentRate,
  weightOpenPlansByCommitmentRate,
} = require('./commitmentRateLogic');

const PAGE_SIZE = 1000;

function plansMapFromRpcRows(rows) {
  const plans = new Map();

  for (const row of rows ?? []) {
    if (!row?.planId) continue;
    plans.set(String(row.planId), {
      planId: String(row.planId),
      patientId: row.patientId != null ? String(row.patientId) : '',
      plannedValue: Number(row.plannedValue) || 0,
      planCreatedAt: row.planCreatedAt ?? null,
      firstLinkedAt: row.firstLinkedAt ?? null,
      lastLinkedAt: row.lastLinkedAt ?? null,
      lastUnlinkedAt: row.lastUnlinkedAt ?? null,
      isCompleted: Boolean(row.isCompleted),
    });
  }

  return plans;
}

async function loadAggregatedPlans(practiceId, scope = {}) {
  const locationId = scope.locationId || null;
  const startDate = scope.startDate || null;
  const endDate = scope.endDate || null;

  const { data, error } = await supabaseAdmin.rpc('pe_ledger_plan_states', {
    p_practice_id: practiceId,
    p_location_id: locationId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    throw new Error(`pe_ledger_plan_states: ${error.message}`);
  }

  return plansMapFromRpcRows(Array.isArray(data) ? data : []);
}

/** @deprecated Use loadAggregatedPlans — kept for callers migrating off raw ledger rows. */
async function loadLedgerPlanEvents(practiceId, scope = {}) {
  const plans = await loadAggregatedPlans(practiceId, scope);
  return [...plans.values()];
}

async function loadCommitmentWindowDays(practiceId) {
  const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  return assumptions.commitmentRateWindowDays || DEFAULT_COMMITMENT_RATE_WINDOW_DAYS;
}

async function loadEligiblePlanItems(practiceId, planIds) {
  const items = [];
  if (planIds.length === 0) return items;

  const numericPlanIds = planIds
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (numericPlanIds.length === 0) return items;

  const treatmentTypeByExtId = new Map();

  for (let i = 0; i < numericPlanIds.length; i += PAGE_SIZE) {
    const chunk = numericPlanIds.slice(i, i + PAGE_SIZE);

    const { data: tpiRows, error: tpiErr } = await supabaseAdmin
      .from('treatment_plan_items')
      .select('tpi_id, tpi_treatment_plan_id, tpi_treatment_id, tpi_price, tpi_practitioner_id')
      .eq('organization_id', practiceId)
      .in('tpi_treatment_plan_id', chunk)
      .is('deleted_at', null);

    if (tpiErr) throw new Error(`treatment_plan_items: ${tpiErr.message}`);

    const treatmentExtIds = [
      ...new Set(
        (tpiRows ?? [])
          .map((r) => r.tpi_treatment_id)
          .filter((id) => id != null)
          .map((id) => Number(id)),
      ),
    ];

    if (treatmentExtIds.length > 0) {
      const { data: treatments, error: trErr } = await supabaseAdmin
        .from('treatments')
        .select('external_id, treatment_type, treatment_name, nomenclature')
        .eq('organization_id', practiceId)
        .in('external_id', treatmentExtIds)
        .is('deleted_at', null);

      if (trErr) throw new Error(`treatments: ${trErr.message}`);

      for (const t of treatments ?? []) {
        if (t.external_id != null) {
          treatmentTypeByExtId.set(String(t.external_id), {
            treatmentType: String(t.treatment_type || ''),
            treatmentName:
              (t.treatment_name && String(t.treatment_name).trim()) ||
              (t.nomenclature && String(t.nomenclature).trim()) ||
              null,
          });
        }
      }
    }

    for (const row of tpiRows ?? []) {
      if (row.tpi_treatment_plan_id == null) continue;
      const planId = String(row.tpi_treatment_plan_id);
      const treatmentId =
        row.tpi_treatment_id != null ? String(row.tpi_treatment_id) : null;
      const treatmentMeta =
        treatmentId != null ? treatmentTypeByExtId.get(treatmentId) ?? null : null;
      const treatmentType =
        treatmentMeta && typeof treatmentMeta === 'object'
          ? treatmentMeta.treatmentType
          : treatmentMeta;
      const treatmentName =
        treatmentMeta && typeof treatmentMeta === 'object'
          ? treatmentMeta.treatmentName
          : null;

      items.push({
        planId,
        tpiId: row.tpi_id != null ? String(row.tpi_id) : null,
        value: Number(row.tpi_price) || 0,
        treatmentId,
        treatmentType,
        treatmentName,
        practitionerExtId:
          row.tpi_practitioner_id != null ? String(row.tpi_practitioner_id) : null,
      });
    }
  }

  return items;
}

/**
 * @param {string} practiceId
 */
async function computePracticeCommitmentRateForPractice(practiceId) {
  const windowDays = await loadCommitmentWindowDays(practiceId);
  const plans = await loadAggregatedPlans(practiceId);
  const planIds = [...plans.keys()];
  const items = await loadEligiblePlanItems(practiceId, planIds);
  const commitmentResult = computePracticeCommitmentRate(plans, items, windowDays);

  return {
    practiceId,
    windowDays,
    plans,
    items,
    commitmentResult,
  };
}

/**
 * Commitment Rate + per-patient weighted opportunity for read APIs.
 */
async function buildOpportunityWeightingForPractice(practiceId) {
  const { plans, items, commitmentResult } =
    await computePracticeCommitmentRateForPractice(practiceId);

  const { byPatient, confidence, tierNote } = weightOpenPlansByCommitmentRate(
    plans,
    commitmentResult,
  );

  return {
    byPatient,
    commitmentResult,
    confidence,
    tierNote,
    practicePlanCount: commitmentResult.eligibleItemCount,
  };
}

module.exports = {
  DEFAULT_COMMITMENT_RATE_WINDOW_DAYS,
  loadCommitmentWindowDays,
  loadAggregatedPlans,
  loadLedgerPlanEvents,
  loadEligiblePlanItems,
  computePracticeCommitmentRateForPractice,
  buildOpportunityWeightingForPractice,
  plansMapFromRpcRows,
};
