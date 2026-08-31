/**
 * Growth Levers — practice-level visit frequency and value per visit (Derived tier).
 */

const DERIVED_TIER = 'Derived';
const DEFAULT_GROWTH_LEVERS_TRAILING_MONTHS = 12;
const DERIVED_TIER_NOTE =
  'Computed from synced appointments and invoice revenue (private/plan; NHS excluded)';

function trailingSinceIsoDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function monthKeyFromIsoDate(dateStr) {
  return String(dateStr).slice(0, 7);
}

/**
 * Ordered YYYY-MM keys from sinceDate (inclusive) through current month.
 * @param {string} sinceDate YYYY-MM-DD
 */
function buildTrailingMonthKeys(sinceDate, trailingMonths) {
  const keys = [];
  const start = new Date(`${sinceDate.slice(0, 10)}T00:00:00`);
  const end = new Date();
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= endMonth && keys.length <= trailingMonths + 2) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    keys.push(`${y}-${m}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return keys;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isCompletedAppointment(row) {
  const state = String(row.apmt_state ?? '').toLowerCase().trim();
  if (state === 'cancelled' || state === 'did not attend' || state === 'dna') return false;
  if (!row.apmt_completed_at && state !== 'completed') return false;
  return true;
}

/**
 * @param {number} totalVisits
 * @param {number} activePatients
 * @param {number} totalRevenuePrivatePlan
 */
function computePracticeLevers(totalVisits, activePatients, totalRevenuePrivatePlan) {
  const visitFrequency =
    activePatients > 0 && totalVisits > 0
      ? round2(totalVisits / activePatients)
      : activePatients > 0
        ? 0
        : null;

  const valuePerVisit =
    totalVisits > 0 ? round2(totalRevenuePrivatePlan / totalVisits) : null;

  return {
    visitFrequency,
    valuePerVisit,
    totalCompletedVisits: totalVisits,
    totalRevenuePrivatePlan: round2(totalRevenuePrivatePlan),
    activePatientCount: activePatients,
  };
}

module.exports = {
  DERIVED_TIER,
  DEFAULT_GROWTH_LEVERS_TRAILING_MONTHS,
  DERIVED_TIER_NOTE,
  trailingSinceIsoDate,
  monthKeyFromIsoDate,
  buildTrailingMonthKeys,
  round2,
  isCompletedAppointment,
  computePracticeLevers,
};
