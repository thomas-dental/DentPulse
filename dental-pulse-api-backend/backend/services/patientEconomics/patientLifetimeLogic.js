/**
 * Patient Lifetime lever — tenure (Derived) vs projected lifetime (Modelled).
 *
 * SPEC: these two figures must NEVER be blended into a single output field.
 * Tenure = elapsed time only. Projected = modelled total relationship length only.
 */

const DERIVED_TIER = 'Derived';
const MODELLED_TIER = 'Modelled';

const TENURE_DERIVED_TIER_NOTE =
  'Elapsed years from earliest synced completed appointment or invoice to today; averaged over active patients with activity history';

const { parseRetentionStatus } = require('./peRetentionSegmentation');

const PROJECTED_LIFETIME_TIER_NOTE =
  'Rule table: retention_status → expected total relationship years. See peRetentionSegmentation + pe_economic_assumptions projected_lifetime_years_* — not ML';

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function daysBetween(fromDate, toDate) {
  const a = new Date(`${String(fromDate).slice(0, 10)}T00:00:00.000Z`);
  const b = new Date(`${String(toDate).slice(0, 10)}T00:00:00.000Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * @param {string|null} firstActivityDate YYYY-MM-DD
 * @param {string} today YYYY-MM-DD
 * @returns {number|null} tenure in years
 */
function tenureYearsFromFirstActivity(firstActivityDate, today) {
  if (!firstActivityDate) return null;
  const days = daysBetween(firstActivityDate, today);
  if (days < 0) return null;
  return round2(days / DAYS_PER_YEAR);
}

/**
 * @param {number[]} tenureYearsList
 */
function averageTenureYears(tenureYearsList) {
  if (tenureYearsList.length === 0) return null;
  const sum = tenureYearsList.reduce((a, b) => a + b, 0);
  return round2(sum / tenureYearsList.length);
}

/**
 * @param {string[]} retentionStatuses
 * @param {Record<string, number>} lifetimeYearsMap
 */
function averageProjectedLifetimeYears(retentionStatuses, lifetimeYearsMap = {}) {
  if (retentionStatuses.length === 0) return null;
  let sum = 0;
  for (const raw of retentionStatuses) {
    const status = parseRetentionStatus(raw);
    sum += lifetimeYearsMap[status] ?? lifetimeYearsMap.active ?? 8;
  }
  return round2(sum / retentionStatuses.length);
}

/**
 * Earliest activity date from appointment and invoice candidates.
 * @param {string|null} firstVisitDate
 * @param {string|null} firstInvoiceDate
 */
function earliestActivityDate(firstVisitDate, firstInvoiceDate) {
  const dates = [firstVisitDate, firstInvoiceDate].filter(Boolean).map(String);
  if (dates.length === 0) return null;
  return dates.sort()[0];
}

module.exports = {
  DERIVED_TIER,
  MODELLED_TIER,
  TENURE_DERIVED_TIER_NOTE,
  PROJECTED_LIFETIME_TIER_NOTE,
  tenureYearsFromFirstActivity,
  averageTenureYears,
  averageProjectedLifetimeYears,
  earliestActivityDate,
  parseRetentionStatus,
};
