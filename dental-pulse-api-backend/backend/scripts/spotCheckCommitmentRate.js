/**
 * Spot-check Commitment Rate against real ledger + plan items.
 *
 * Usage:
 *   node backend/scripts/spotCheckCommitmentRate.js <practiceId> [planTpId ...]
 *
 * Prints PLAN_CREATED → first APPOINTMENT_LINKED trace per plan and practice rate.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { supabaseAdmin } = require('../config/supabase');
const {
  daysBetweenUtc,
  aggregatePlansFromLedger,
  computePracticeCommitmentRate,
  isEligiblePrivatePlanItem,
} = require('../services/patientEconomics/commitmentRateLogic');
const {
  computePracticeCommitmentRateForPractice,
} = require('../services/patientEconomics/commitmentRate');

async function tracePlan(practiceId, tpId, windowDays) {
  const planKey = String(tpId);

  const { data: ledger, error: leErr } = await supabaseAdmin
    .from('event_ledger')
    .select('event_type, created_at, payload, patient_id')
    .eq('practice_id', practiceId)
    .in('event_type', ['PLAN_CREATED', 'APPOINTMENT_LINKED', 'APPOINTMENT_UNLINKED', 'PLAN_COMPLETED']);

  if (leErr) throw leErr;

  const relevant = (ledger ?? []).filter((row) => {
    const p = row.payload || {};
    const id = String(p.tp_id || p.plan_id || p.ta_treatment_plan_id || '');
    return id === planKey;
  });

  const plans = aggregatePlansFromLedger(relevant);
  const plan = plans.get(planKey);

  const { data: items, error: iErr } = await supabaseAdmin
    .from('treatment_plan_items')
    .select('tpi_id, tpi_treatment_plan_id, tpi_treatment_id, tpi_price')
    .eq('organization_id', practiceId)
    .eq('tpi_treatment_plan_id', Number(tpId))
    .is('deleted_at', null);

  if (iErr) throw iErr;

  const treatmentIds = [...new Set((items ?? []).map((i) => i.tpi_treatment_id).filter(Boolean))];
  const typeMap = new Map();
  if (treatmentIds.length > 0) {
    const { data: treatments } = await supabaseAdmin
      .from('treatments')
      .select('external_id, treatment_type')
      .eq('organization_id', practiceId)
      .in('external_id', treatmentIds);
    for (const t of treatments ?? []) {
      typeMap.set(String(t.external_id), t.treatment_type);
    }
  }

  console.log(`\n--- Plan tp_id=${tpId} ---`);
  if (!plan) {
    console.log('  No ledger aggregate for this plan_id');
    return;
  }

  console.log(`  PLAN_CREATED at:     ${plan.planCreatedAt ?? '—'}`);
  console.log(`  First LINKED at:     ${plan.firstLinkedAt ?? '—'}`);
  if (plan.planCreatedAt && plan.firstLinkedAt) {
    const days = daysBetweenUtc(plan.planCreatedAt, plan.firstLinkedAt);
    console.log(`  Days to schedule:    ${days} (window ${windowDays}d)`);
    console.log(`  Within window:       ${days <= windowDays ? 'YES' : 'NO'}`);
  }

  for (const row of items ?? []) {
    const treatmentId = row.tpi_treatment_id != null ? String(row.tpi_treatment_id) : null;
    const treatmentType = treatmentId ? typeMap.get(treatmentId) : null;
    const eligible = isEligiblePrivatePlanItem({
      value: Number(row.tpi_price) || 0,
      treatmentType,
      treatmentId,
    });
    console.log(
      `  Item tpi_id=${row.tpi_id} £${row.tpi_price} treatment=${treatmentId} type=${treatmentType ?? '—'} eligible=${eligible}`,
    );
  }

  console.log('  Ledger events:');
  for (const row of relevant.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    console.log(`    ${row.created_at} ${row.event_type}`);
  }
}

async function main() {
  const practiceId = process.argv[2];
  const planIds = process.argv.slice(3);

  if (!practiceId) {
    console.error('Usage: node spotCheckCommitmentRate.js <practiceId> [tp_id ...]');
    process.exit(1);
  }

  const ctx = await computePracticeCommitmentRateForPractice(practiceId);
  const r = ctx.commitmentResult;

  console.log('Practice Commitment Rate');
  console.log(`  practice_id:              ${practiceId}`);
  console.log(`  window_days:              ${r.windowDays}`);
  console.log(`  commitment_rate:          ${(r.commitmentRate * 100).toFixed(1)}%`);
  console.log(`  total_eligible_value:     £${r.totalEligibleValue}`);
  console.log(`  committed_within_window:  £${r.committedValueWithinWindow}`);
  console.log(`  eligible_items:           ${r.eligibleItemCount}`);
  console.log(`  committed_items:          ${r.committedItemCount}`);

  if (planIds.length > 0) {
    for (const tpId of planIds) {
      await tracePlan(practiceId, tpId, r.windowDays);
    }
  } else {
    const samplePlans = [...ctx.plans.keys()].slice(0, 3);
    for (const tpId of samplePlans) {
      await tracePlan(practiceId, tpId, r.windowDays);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
