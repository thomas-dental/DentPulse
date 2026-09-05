/**
 * Growth Levers headroom — benchmark resolution and gap math.
 *
 * Benchmark methods (pe_economic_assumptions.growth_levers_benchmark_method):
 *   group_top        — per lever, benchmark = max actual across visible practices
 *                      (top-performing peer in the user's group view).
 *   configured_target — per practice, benchmark = that practice's target columns
 *                      on pe_economic_assumptions; missing targets fall back to group_top.
 *
 * Headroom = benchmark − actual (positive = room to grow toward benchmark).
 * Tenure and projected lifetime headroom are NEVER merged into one lifetime gap.
 */

const BENCHMARK_METHOD_GROUP_TOP = 'group_top';
const BENCHMARK_METHOD_CONFIGURED = 'configured_target';
const DEFAULT_BENCHMARK_METHOD = BENCHMARK_METHOD_GROUP_TOP;

const DEFAULT_CLTV_MIN_SAMPLE = 5;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Admin / non-clinical locations: no visit revenue → headroom ranks are not meaningful. */
function hasClinicalLeverData(row) {
  if (row?.visitFrequency == null || row?.valuePerVisit == null) return false;
  const visitFrequency = numOrNull(row.visitFrequency);
  const valuePerVisit = numOrNull(row.valuePerVisit);
  return visitFrequency != null && visitFrequency > 0 && valuePerVisit != null;
}

/**
 * @param {Array<{ visitFrequency?: number|null, valuePerVisit?: number|null, tenureYears?: number|null, projectedLifetimeYears?: number|null }>} rows
 */
function maxLeverAcrossPractices(rows, key) {
  let max = null;
  for (const row of rows) {
    const v = numOrNull(row[key]);
    if (v == null) continue;
    if (max == null || v > max) max = v;
  }
  return max;
}

/**
 * Stretch targets when none configured — aligned with Growth Lever Simulator defaults (+14% freq, +8.7% VPV, +10% lifetime).
 */
function deriveStretchTargets(actuals) {
  const vf = numOrNull(actuals?.visitFrequency);
  const vv = numOrNull(actuals?.valuePerVisit);
  const tenure = numOrNull(actuals?.tenureYears);
  const projected = numOrNull(actuals?.projectedLifetimeYears);

  if (vf == null && vv == null && tenure == null && projected == null) return null;

  const bumpLife = (years) => {
    if (years == null) return null;
    return years < 1 ? round2(years + 0.5) : round2(years * 1.1);
  };

  return {
    visitFrequency: vf != null ? round2(vf * 1.14) : null,
    valuePerVisit: vv != null ? round2(vv * 1.087) : null,
    tenureYears: bumpLife(tenure),
    projectedLifetimeYears: bumpLife(projected),
  };
}

/**
 * @param {object} targets from pe_economic_assumptions
 * @param {object} groupTop from maxLeverAcrossPractices
 * @param {object} [actuals] practice lever actuals for stretch fallback
 */
function resolveBenchmarksForPractice(targets, groupTop, actuals = null) {
  const configured = {
    visitFrequency: numOrNull(targets.targetVisitFrequency),
    valuePerVisit: numOrNull(targets.targetValuePerVisit),
    tenureYears: numOrNull(targets.targetTenureYears),
    projectedLifetimeYears: numOrNull(targets.targetProjectedLifetimeYears),
  };
  const stretch = actuals ? deriveStretchTargets(actuals) : null;

  const pick = (key) =>
    configured[key] ?? stretch?.[key] ?? groupTop[key] ?? null;

  return {
    visitFrequency: pick('visitFrequency'),
    valuePerVisit: pick('valuePerVisit'),
    tenureYears: pick('tenureYears'),
    projectedLifetimeYears: pick('projectedLifetimeYears'),
  };
}

function headroom(benchmark, actual) {
  const b = numOrNull(benchmark);
  const a = numOrNull(actual);
  if (b == null || a == null) return null;
  return round2(b - a);
}

/**
 * Relative gap % = (benchmark − actual) / benchmark when benchmark > 0.
 */
function headroomPct(benchmark, actual) {
  const b = numOrNull(benchmark);
  const a = numOrNull(actual);
  if (b == null || a == null || b <= 0) return null;
  return round2(((b - a) / b) * 100);
}

/**
 * Combined headroom % for table ranking — average of available lever gap %s.
 * Tenure and projected lifetime contribute as separate levers (never blended).
 */
function combinedHeadroomPct(gaps) {
  const pcts = gaps.filter((p) => p != null && Number.isFinite(p));
  if (pcts.length === 0) return null;
  return round2(pcts.reduce((s, p) => s + p, 0) / pcts.length);
}

/**
 * Lever with largest relative headroom %.
 */
function topLeverToPull(gapPcts) {
  const entries = [
    { lever: 'Visit Frequency', pct: gapPcts.visitFrequency },
    { lever: 'Value per Visit', pct: gapPcts.valuePerVisit },
    { lever: 'Tenure', pct: gapPcts.tenureYears },
    { lever: 'Projected lifetime', pct: gapPcts.projectedLifetimeYears },
  ].filter((e) => e.pct != null && e.pct > 0);

  if (entries.length === 0) return null;
  entries.sort((a, b) => b.pct - a.pct);
  return entries[0].lever;
}

function benchmarkMethodNote(method) {
  if (method === BENCHMARK_METHOD_CONFIGURED) {
    return 'Benchmark = configured targets on pe_economic_assumptions (per practice); missing targets use simulator stretch or group top';
  }
  return 'Benchmark = configured target, else simulator stretch (+14% visits, +8.7% VPV, +10% lifetime), else top peer in group';
}

module.exports = {
  BENCHMARK_METHOD_GROUP_TOP,
  BENCHMARK_METHOD_CONFIGURED,
  DEFAULT_BENCHMARK_METHOD,
  DEFAULT_CLTV_MIN_SAMPLE,
  round2,
  numOrNull,
  maxLeverAcrossPractices,
  resolveBenchmarksForPractice,
  deriveStretchTargets,
  headroom,
  headroomPct,
  combinedHeadroomPct,
  topLeverToPull,
  benchmarkMethodNote,
  numOrNull,
  hasClinicalLeverData,
};
