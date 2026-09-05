/**
 * Opportunity gross vs weighted — treatment category buckets for Value & Leakage chart.
 */

const {
  isEligiblePrivatePlanItem,
  isOpenOpportunityPlan,
} = require('./commitmentRateLogic');

const OPPORTUNITY_CATEGORIES = ['Whitening', 'Implant', 'Ortho', 'Other'];

/**
 * @param {string | null | undefined} treatmentName
 */
function classifyOpportunityCategory(treatmentName) {
  const n = String(treatmentName || '').toLowerCase();
  if (!n) return 'Other';
  if (/(whiten|bleach|enlighten)/i.test(n)) return 'Whitening';
  if (/(implant|abutment|all[- ]on[- ]4|all[- ]on[- ]six)/i.test(n)) return 'Implant';
  if (/(invisalign|aligner|\bbrace\b|orthodont|retainer|\bortho\b)/i.test(n)) return 'Ortho';
  return 'Other';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Map<string, object>} plans
 * @param {Array<{ planId: string, value: number, treatmentType: string | null, treatmentId: string | null, treatmentName?: string | null }>} items
 * @param {number} commitmentRate 0–1
 */
function summarizeOpportunityByCategory(plans, items, commitmentRate) {
  const rate = Math.max(0, Math.min(1, num(commitmentRate)));
  const buckets = Object.fromEntries(
    OPPORTUNITY_CATEGORIES.map((key) => [key, { category: key, gross: 0, weighted: 0 }]),
  );

  for (const item of items) {
    if (!isEligiblePrivatePlanItem(item)) continue;

    const plan = plans.get(item.planId);
    if (!plan || !isOpenOpportunityPlan(plan)) continue;

    const value = num(item.value);
    if (value <= 0) continue;

    const category = classifyOpportunityCategory(item.treatmentName);
    const bucket = buckets[category];
    bucket.gross += value;
    bucket.weighted += value * rate;
  }

  return OPPORTUNITY_CATEGORIES.map((key) => {
    const row = buckets[key];
    return {
      category: key,
      gross: Math.round(row.gross * 100) / 100,
      weighted: Math.round(row.weighted * 100) / 100,
    };
  });
}

module.exports = {
  OPPORTUNITY_CATEGORIES,
  classifyOpportunityCategory,
  summarizeOpportunityByCategory,
};
