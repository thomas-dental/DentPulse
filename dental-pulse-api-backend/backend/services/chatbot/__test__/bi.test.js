/**
 * Conversational BI unit tests — plain Node script, no Jest (matches the
 * other chatbot test files). Exits non-zero on any failure.
 *
 * Covers the pure, DB-free parts of backend/services/chatbot/bi/:
 *   1. nlResolver  — question → KPI + dimensions + vague flag
 *   2. tableAllowList.assertQueryShape — security boundary rejects bad shapes
 *   3. safeAggregator.aggregateRows — count/sum/avg/distinct/group/topN/charting
 *   4. safeAggregator.formatDateBucket — day/month/year bucketing
 *   5. planDashboard — data shape → widget set, KPI-only forbidden
 *   6. insights.computeFacts / deterministicInsights — grounded facts
 *
 * Run: node backend/services/chatbot/__test__/bi.test.js
 */

const path = require('path');
const BI = path.join(__dirname, '..', 'bi');

const { resolveKpis } = require(path.join(BI, 'nlResolver.js'));
const allowList = require(path.join(BI, 'tableAllowList.js'));
const { aggregateRows, formatDateBucket } = require(path.join(BI, 'safeAggregator.js'));
const { planDashboard } = require(path.join(BI, 'planDashboard.js'));
const { BY_ID } = require(path.join(BI, 'kpiRegistry.js'));
const { computeFacts, deterministicInsights } = require(path.join(BI, 'insights.js'));
const { adaptResolvedToDashboard } = require(path.join(BI, 'resolvedAdapter.js'));

let pass = 0;
let fail = 0;
const failures = [];

function ok(label, cond) {
  if (cond) { pass++; } else { fail++; failures.push(label); }
}
function eq(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; } else { fail++; failures.push(`${label}\n    expected: ${b}\n    got:      ${a}`); }
}
function throws(label, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(label, threw);
}
function section(n) { console.log(`\n─── ${n} ───`); }

// ─────────────────────────────────────────────────────────────────────────
section('1. nlResolver');

let r = resolveKpis('show me treatment revenue by location this month');
eq('revenue primary', r.primary && r.primary.id, 'total_treatment_revenue');
eq('location dimension detected', r.dimensions, ['location']);
ok('not vague', r.vague === false);

r = resolveKpis('how many patients did we treat, by month');
eq('patients primary', r.primary && r.primary.id, 'patients_treated');
eq('month dimension', r.dimensions, ['month']);

r = resolveKpis('how are we doing this quarter?');
ok('vague flagged', r.vague === true);

r = resolveKpis('what is our average revenue per patient');
eq('derived KPI selected', r.primary && r.primary.id, 'avg_revenue_per_patient');

r = resolveKpis('the weather is nice today');
ok('no KPI match → null primary', r.primary === null);

// ── broadened dimension phrasing (the "for all locations separately" bug) ──
r = resolveKpis('generate last month income and expense dashboard for all locations seprately');
eq('income → revenue primary', r.primary && r.primary.id, 'total_treatment_revenue');
ok('"for all locations seprately" → location dim', r.dimensions.includes('location'));
ok('"expense" → unsupported flagged', r.unsupported === true);

r = resolveKpis('revenue for each location');
ok('"for each location" → location dim', r.dimensions.includes('location'));

r = resolveKpis('treatment revenue split by site');
ok('"split by site" → location dim', r.dimensions.includes('location'));

r = resolveKpis('compare practices this quarter');
ok('"compare practices" → location dim', r.dimensions.includes('location'));

// ── treatment dimension ──
r = resolveKpis('show treatment revenue by treatment type');
eq('treatment-revenue primary', r.primary && r.primary.id, 'total_treatment_revenue');
ok('"by treatment type" → treatment dim', r.dimensions.includes('treatment'));
ok('clean revenue ask → not unsupported', r.unsupported === false);

r = resolveKpis('show profitability by treatments');
ok('"by treatments" → treatment dim', r.dimensions.includes('treatment'));
ok('"profitability" → unsupported flagged', r.unsupported === true);

// ── regression guards: must NOT over-detect ──
r = resolveKpis('show me treatment revenue by location this month');
eq('unchanged: only location dim', r.dimensions, ['location']);
r = resolveKpis('what is our average revenue per patient');
ok('"per patient" is NOT a treatment breakdown', !r.dimensions.includes('treatment'));
ok('plain revenue/per-patient → not unsupported', r.unsupported === false);
r = resolveKpis('how many patients did we treat, by month');
eq('unchanged: only month dim', r.dimensions, ['month']);

// ── treatment dimension is wired into the KPI registry + allow-list ──
eq('revenue KPI groups treatment by nomenclature',
  BY_ID.total_treatment_revenue.dimensions.treatment.groupBy, 'tpi_patient_nomenclature');
ok('treatment groupBy column is allow-listed',
  allowList.isAllowedColumn('treatment_plan_items', 'tpi_patient_nomenclature'));

// ─────────────────────────────────────────────────────────────────────────
section('2. tableAllowList security boundary');

ok('allowed table', allowList.isAllowedTable('treatment_plan_items'));
ok('blocked table', !allowList.isAllowedTable('users'));
ok('allowed column', allowList.isAllowedColumn('treatment_plan_items', 'tpi_price'));
ok('blocked column', !allowList.isAllowedColumn('treatment_plan_items', 'password'));
ok('sql-ish column rejected', !allowList.isAllowedColumn('treatment_plan_items', 'tpi_price; drop table'));
ok('allowed operator', allowList.isAllowedOperator('gte'));
ok('blocked operator', !allowList.isAllowedOperator('like'));

throws('assert: bad table', () => allowList.assertQueryShape({ table: 'secrets', columns: [], filters: [] }));
throws('assert: bad column', () =>
  allowList.assertQueryShape({ table: 'patients', columns: ['ssn'], filters: [] }));
throws('assert: bad filter operator', () =>
  allowList.assertQueryShape({ table: 'patients', columns: [], filters: [{ column: 'id', operator: 'like', value: 'x' }] }));
throws('assert: bad groupBy', () =>
  allowList.assertQueryShape({ table: 'patients', columns: [], filters: [], groupBy: 'evil' }));
(() => {
  let threw = false;
  try {
    allowList.assertQueryShape({
      table: 'treatment_plan_items',
      columns: ['tpi_price'],
      filters: [{ column: 'organization_id', operator: 'eq', value: 'org1' }],
      groupBy: 'location_id',
    });
  } catch { threw = true; }
  ok('assert: valid shape passes', threw === false);
})();

// ─────────────────────────────────────────────────────────────────────────
section('3. safeAggregator.aggregateRows');

const rows = [
  { tpi_price: '100', location_id: 'A', tpi_patient_id: 1, tpi_completed_at: '2026-03-02', tpi_patient_nomenclature: 'Crown' },
  { tpi_price: '200', location_id: 'A', tpi_patient_id: 1, tpi_completed_at: '2026-03-15', tpi_patient_nomenclature: 'Filling' },
  { tpi_price: '300', location_id: 'B', tpi_patient_id: 2, tpi_completed_at: '2026-04-05', tpi_patient_nomenclature: 'Crown' },
  { tpi_price: '999', location_id: 'B', tpi_patient_id: 3, tpi_completed_at: '2026-04-09', tpi_patient_nomenclature: 'Missing' }, // charting
];

let agg = aggregateRows(rows, { method: 'sum', valueCol: 'tpi_price' });
eq('sum all', agg.total, 1599);

agg = aggregateRows(rows, { method: 'sum', valueCol: 'tpi_price', excludeCharting: true });
eq('sum excluding charting', agg.total, 600);

agg = aggregateRows(rows, { method: 'count', excludeCharting: true });
eq('count excluding charting', agg.rows[0].value, 3);

agg = aggregateRows(rows, { method: 'count_distinct', distinctCol: 'tpi_patient_id', excludeCharting: true });
eq('distinct patients (charting row dropped)', agg.rows[0].value, 2);

agg = aggregateRows(rows, { method: 'sum', valueCol: 'tpi_price', groupBy: 'location_id', excludeCharting: true, sort: 'desc' });
eq('group by location, ranked desc', agg.rows.map(x => [x.key, x.value]), [['A', 300], ['B', 300]]);

agg = aggregateRows(rows, { method: 'avg', valueCol: 'tpi_price', excludeCharting: true });
eq('avg excluding charting', Math.round(agg.rows[0].value), 200);

agg = aggregateRows(rows, {
  method: 'sum', valueCol: 'tpi_price', groupBy: 'tpi_completed_at',
  dateFormat: 'month', excludeCharting: true,
});
eq('group by month, chronological', agg.rows.map(x => [x.key, x.value]), [['2026-03', 300], ['2026-04', 300]]);

agg = aggregateRows(rows, { method: 'sum', valueCol: 'tpi_price', groupBy: 'location_id', topN: 1 });
eq('topN truncates groups', agg.rows.length, 1);

eq('formatDateBucket day', formatDateBucket('2026-03-02T11:00:00', 'day'), '2026-03-02');
eq('formatDateBucket month', formatDateBucket('2026-03-02T11:00:00', 'month'), '2026-03');
eq('formatDateBucket year', formatDateBucket('2026-03-02', 'year'), '2026');

// ─────────────────────────────────────────────────────────────────────────
section('4. planDashboard');

const rev = BY_ID.total_treatment_revenue;
const widgets = planDashboard([
  { kpi: rev, dimension: null, unit: 'currency', scalar: 1234, description: 'd' },
  { kpi: rev, dimension: 'month', unit: 'currency', points: [{ label: '2026-03', value: 300 }, { label: '2026-04', value: 300 }], description: 'd' },
  { kpi: rev, dimension: 'location', unit: 'currency', points: [{ label: 'A', value: 300, count: 2 }, { label: 'B', value: 300, count: 1 }, { label: 'C', value: 50, count: 1 }], description: 'd' },
]);
const types = widgets.map(w => w.type);
ok('has a kpi tile', types.includes('kpi'));
ok('time series → line', types.includes('line'));
ok('categorical → chart (bar/pie)', types.includes('bar') || types.includes('pie'));
ok('categorical (>=3 rows) → detail table', types.includes('table'));

const kpiOnly = planDashboard([{ kpi: rev, dimension: null, unit: 'currency', scalar: 10, description: 'd' }]);
ok('KPI-only forbidden → text fallback added', kpiOnly.some(w => w.type === 'text'));

// ─────────────────────────────────────────────────────────────────────────
section('5. insights — grounded facts');

const blocks = [
  { kpi: rev, dimension: null, unit: 'currency', scalar: 600 },
  { kpi: rev, dimension: 'location', unit: 'currency', points: [{ label: 'A', value: 400 }, { label: 'B', value: 200 }] },
];
const facts = computeFacts(blocks, { displayLabel: 'March 2026' });
eq('scalar fact display', facts.scalars[0].display, '£600');
eq('breakdown top label', facts.breakdowns[0].top.label, 'A');
eq('breakdown top share %', facts.breakdowns[0].top.sharePct, 66.7);
const det = deterministicInsights(facts);
ok('deterministic insights produced', det.length >= 1 && det.length <= 3);
ok('insight cites the period', det.join(' ').includes('March 2026'));

// ─────────────────────────────────────────────────────────────────────────
section('6. resolvedAdapter (data/report tools → dashboard shell)');

const intent = { toolName: 'get_financial_metric', args: { metric: 'revenue', period_from: '2026-05-01', period_to: '2026-05-16' } };

let d = adaptResolvedToDashboard(intent, {
  chart: { type: 'line', title: 'Revenue by month', labels: ['2026-04', '2026-05'], values: [100, 200], valueUnit: 'currency' },
});
ok('chart → dashboard built', !!d);
eq('chart → line widget', d.widgets[0].type, 'line');
eq('chart points mapped', d.widgets[0].data.points, [{ label: '2026-04', value: 100 }, { label: '2026-05', value: 200 }]);
eq('currency unit mapped', d.widgets[0].data.unit, 'currency');
ok('adapter sets steps', Array.isArray(d.steps) && d.steps.length >= 1);

d = adaptResolvedToDashboard(intent, {
  data: [{ provider: 'A', revenue: 500 }, { provider: 'B', revenue: 300 }],
});
ok('array data → dashboard built', !!d);
eq('array data → table widget', d.widgets[0].type, 'table');
eq('table columns prettified', d.widgets[0].data.columns, ['Provider', 'Revenue']);
eq('table value column detected', d.widgets[0].data.valueColumnIndex, 1);

// Internal id / UUID columns must be scrubbed from the generic table.
d = adaptResolvedToDashboard(intent, {
  data: [{
    provider_name: 'Luke Fisher-Brown',
    production_amount: 28486.73,
    provider_id: '40e25bb2-8993-4edf-a688-c1e82d904086',
    practitioner_id: '40e25bb2-8993-4edf-a688-c1e82d904086',
    rank: 1,
  }],
});
eq('id/uuid columns scrubbed from table',
  d.widgets[0].data.columns, ['Provider Name', 'Production Amount', 'Rank']);

// List/roster resolvers expose their array under `rows`, not `data`.
d = adaptResolvedToDashboard(
  { toolName: 'list_providers', args: { period_from: '2026-04-01', period_to: '2026-04-30' } },
  { rows: [{ practitioner: 'Luke', role: 'Dentist', completed: 191, provider_id: 'a-b-c-d-e' }] },
);
ok('rows[] detected → dashboard built', !!d);
eq('rows → table widget', d.widgets[0].type, 'table');
eq('rows table id-scrubbed', d.widgets[0].data.columns, ['Practitioner', 'Role', 'Completed']);

ok('no chart/data → null', adaptResolvedToDashboard(intent, { data: 'nothing' }) === null);
ok('preformatted → null', adaptResolvedToDashboard(intent, { preformatted: true, markdown: 'x' }) === null);
ok('isGeneral → null', adaptResolvedToDashboard(intent, { isGeneral: true }) === null);
ok('existing dashboard → null (no double-wrap)',
  adaptResolvedToDashboard(intent, { dashboard: { title: 't', widgets: [] } }) === null);

// ── P&L / EBITDA scalar resolvers → purpose-built dashboard (Phase 1+2) ──
const plIntent = { toolName: 'get_profit_and_loss', args: { period_from: '2026-04-01', period_to: '2026-04-30' } };
let pl = adaptResolvedToDashboard(plIntent, {
  metric: 'profit_and_loss',
  locationName: 'Teeth For Life Dental Care - Caldicot',
  current: { revenue: 27315, grossProfit: 27315, ebitda: 27315, totalCosts: 0, grossMargin: 100, ebitdaMargin: 100 },
  prior: { revenue: 24316.5, ebitda: 24316.5 },
  costBuckets: [],
});
ok('P&L → dashboard built', !!pl);
ok('P&L title names the statement + location', /Profit & Loss/.test(pl.title) && /Caldicot/.test(pl.title));
ok('P&L has KPI tiles', pl.widgets.some(w => w.type === 'kpi' && w.title === 'Revenue'));
ok('P&L has a headline bar', pl.widgets.some(w => w.type === 'bar'));
ok('P&L numbers passed through unrecomputed',
  pl.widgets.some(w => w.type === 'kpi' && w.title === 'EBITDA' && w.data.value === 27315));
ok('P&L empty costBuckets → no cost widget', !pl.widgets.some(w => w.title === 'Cost breakdown'));

pl = adaptResolvedToDashboard(plIntent, {
  metric: 'profit_and_loss',
  current: { revenue: 50000, grossProfit: 38000, ebitda: 20000, totalCosts: 30000 },
  costBuckets: [
    { key: 'staff_costs_accounts', label: 'Staff costs', total: 18000 },
    { key: 'lab_fees_accounts', label: 'Lab fees', total: 7000 },
    { key: 'overhead_cost_accounts', label: 'Overheads', total: 5000 },
  ],
});
ok('costBuckets → cost-breakdown widget', pl.widgets.some(w => w.title === 'Cost breakdown' && (w.type === 'pie' || w.type === 'bar')));
eq('cost-breakdown sorted desc, labelled',
  (pl.widgets.find(w => w.title === 'Cost breakdown').data.points || []).map(p => p.label),
  ['Staff costs', 'Lab fees', 'Overheads']);

const ebIntent = { toolName: 'get_ebitda', args: { period_from: '2026-04-01', period_to: '2026-04-30' } };
const eb = adaptResolvedToDashboard(ebIntent, {
  revenue: 50000, grossProfit: 30000, ebitda: 20000, totalCosts: 30000, ebitdaMargin: 40, costBuckets: [],
});
ok('EBITDA-shaped resolver → dashboard built', !!eb);
ok('EBITDA title', /EBITDA/.test(eb.title));
ok('EBITDA has KPI tiles + bar', eb.widgets.some(w => w.type === 'kpi') && eb.widgets.some(w => w.type === 'bar'));

ok('non-P&L chart resolver unaffected (still line widget)',
  adaptResolvedToDashboard(ebIntent, { chart: { type: 'line', title: 'Revenue', labels: ['x'], values: [1], valueUnit: 'currency' } })
    .widgets[0].type === 'line');
ok('preformatted P&L → null', adaptResolvedToDashboard(plIntent, { preformatted: true, metric: 'profit_and_loss' }) === null);

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(48)}`);
console.log(`BI tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('All BI tests passed.');
process.exit(0);
