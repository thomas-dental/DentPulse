/**
 * Planned > N days unscheduled — billing/commercial leakage (pure logic).
 *
 * Eligible: private treatment_plan_items on plans with PLAN_CREATED in ledger,
 * currently unscheduled (no active APPOINTMENT_LINKED), not PLAN_COMPLETED.
 * NHS items excluded (treatments.treatment_type = 'nhs').
 *
 * Row included when days since PLAN_CREATED > leakage_unscheduled_threshold_days
 * and no qualifying APPOINTMENT_LINKED within that window (present-state unscheduled).
 */

const {
  daysBetweenUtc,
  isEligiblePrivatePlanItem,
  isOpenOpportunityPlan,
} = require('./commitmentRateLogic');

const DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS = 60;

/**
 * @param {Map<string, object>} plans
 * @param {Array<{ planId: string, tpiId: string | null, value: number, treatmentId: string | null, treatmentType: string | null }>} items
 * @param {number} thresholdDays
 * @param {Map<string, string>} patientNames patient UUID -> display name
 * @param {string} [asOfIso]
 */
function buildPlannedUnscheduledLeakageRows(
  plans,
  items,
  thresholdDays,
  patientNames,
  asOfIso,
) {
  const threshold = Math.max(
    1,
    Math.round(Number(thresholdDays)) || DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS,
  );
  const asOf = asOfIso || new Date().toISOString();
  const rows = [];

  for (const item of items) {
    if (!isEligiblePrivatePlanItem(item)) continue;

    const plan = plans.get(item.planId);
    if (!plan?.planCreatedAt) continue;
    if (!isOpenOpportunityPlan(plan)) continue;

    const daysUnscheduled = daysBetweenUtc(plan.planCreatedAt, asOf);
    if (daysUnscheduled <= threshold) continue;

    rows.push({
      planId: item.planId,
      tpiId: item.tpiId,
      patientId: plan.patientId,
      patientName: patientNames.get(plan.patientId) || 'Unknown patient',
      treatmentValue: Math.round(num(item.value) * 100) / 100,
      daysUnscheduled,
      planCreatedAt: plan.planCreatedAt,
    });
  }

  rows.sort((a, b) => b.treatmentValue - a.treatmentValue);
  return rows;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function summarizeLeakageRows(rows) {
  const totalValueAtRisk = rows.reduce((s, r) => s + r.treatmentValue, 0);
  return {
    itemCount: rows.length,
    totalValueAtRisk: Math.round(totalValueAtRisk * 100) / 100,
  };
}

module.exports = {
  DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS,
  buildPlannedUnscheduledLeakageRows,
  summarizeLeakageRows,
};
