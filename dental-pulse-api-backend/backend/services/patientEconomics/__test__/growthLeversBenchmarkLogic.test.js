/**
 * Unit tests — growth levers benchmark / headroom resolution.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveBenchmarksForPractice,
  deriveStretchTargets,
  headroomPct,
  combinedHeadroomPct,
} = require('../growthLeversBenchmarkLogic');

test('deriveStretchTargets mirrors simulator bumps', () => {
  const stretch = deriveStretchTargets({
    visitFrequency: 2,
    valuePerVisit: 184,
    tenureYears: 6,
    projectedLifetimeYears: 8.4,
  });
  assert.equal(stretch.visitFrequency, 2.28);
  assert.equal(stretch.valuePerVisit, 200.01);
  assert.equal(stretch.tenureYears, 6.6);
  assert.equal(stretch.projectedLifetimeYears, 9.24);
});

test('single practice uses stretch targets when none configured', () => {
  const actuals = {
    visitFrequency: 2,
    valuePerVisit: 184,
    tenureYears: 6,
    projectedLifetimeYears: 8.4,
  };
  const groupTop = {
    visitFrequency: 2,
    valuePerVisit: 184,
    tenureYears: 6,
    projectedLifetimeYears: 8.4,
  };
  const benchmarks = resolveBenchmarksForPractice({}, groupTop, actuals);
  assert.equal(benchmarks.visitFrequency, 2.28);
  assert.ok(headroomPct(benchmarks.visitFrequency, actuals.visitFrequency) > 0);
  const combined = combinedHeadroomPct([
    headroomPct(benchmarks.visitFrequency, actuals.visitFrequency),
    headroomPct(benchmarks.valuePerVisit, actuals.valuePerVisit),
    headroomPct(benchmarks.tenureYears, actuals.tenureYears),
    headroomPct(benchmarks.projectedLifetimeYears, actuals.projectedLifetimeYears),
  ]);
  assert.ok(combined != null && combined > 0);
});

test('configured targets win over stretch and group top', () => {
  const actuals = { visitFrequency: 2, valuePerVisit: 184, tenureYears: 6, projectedLifetimeYears: 8.4 };
  const groupTop = { visitFrequency: 2.5, valuePerVisit: 201, tenureYears: 6.8, projectedLifetimeYears: 9 };
  const benchmarks = resolveBenchmarksForPractice(
    { targetVisitFrequency: 2.6, targetValuePerVisit: 205 },
    groupTop,
    actuals,
  );
  assert.equal(benchmarks.visitFrequency, 2.6);
  assert.equal(benchmarks.valuePerVisit, 205);
});
