const { resolveDateRange } = require('./dateRange');

/**
 * Render adapter — wraps the EXISTING (tuned, tested) resolver output of a
 * data/report tool into a dashboard payload so it renders in the dashboard
 * UI shell, WITHOUT rerouting through the v1 BI engine (which only knows
 * treatment-revenue/patients). All numbers stay from the original resolver,
 * so cashflow / EBITDA / P&L / cost answers remain correct.
 *
 * Returns null when there's nothing chartable/tabular — the turn then falls
 * back to the normal text answer (never a forced empty dashboard).
 */

function prettify(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// Map a resolver `chart` ({type,title,labels,values,valueUnit}) → a widget.
function chartWidget(chart, range) {
  if (!chart || !Array.isArray(chart.labels) || !Array.isArray(chart.values) || chart.labels.length === 0) {
    return null;
  }
  const type = chart.type === 'line' ? 'line' : 'bar';
  const unit = chart.valueUnit === 'currency' ? 'currency'
    : chart.valueUnit === 'count' ? 'count' : undefined;
  const points = chart.labels.map((label, i) => ({
    label: String(label),
    value: Number(chart.values[i]) || 0,
  }));
  return {
    id: 'a1',
    type,
    title: chart.title || 'Trend',
    description: `${chart.title || 'Data'} · ${range.displayLabel}`,
    gridSpan: 2,
    data: { points, unit },
    meta: { explain: `${chart.title || 'Chart'} for ${range.displayLabel}.` },
  };
}

// Internal identifier columns must never surface in the UI (product rule:
// plain business language only — no raw ids/UUIDs/DB jargon).
const ID_KEY_RE = /(^|[_\s])(id|uuid|guid|pk|fk)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDisplayableColumn(key, sampleValue) {
  if (!(sampleValue === null || ['string', 'number', 'boolean'].includes(typeof sampleValue))) return false;
  if (ID_KEY_RE.test(key)) return false;                 // provider_id, legacy_id, uuid, …
  if (typeof sampleValue === 'string' && UUID_RE.test(sampleValue.trim())) return false; // UUID-valued col
  return true;
}

// Best-effort generic table from an array-of-flat-objects resolver `data`.
function tableWidget(data, range, kpiName) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;

  const keys = Object.keys(first)
    .filter(k => isDisplayableColumn(k, first[k]))
    .slice(0, 6);
  if (keys.length === 0) return null;

  const valueColumnIndex = keys.findIndex(k => typeof first[k] === 'number');
  const rows = data.slice(0, 200).map(r => keys.map(k => {
    const v = r[k];
    return v === null || v === undefined ? '' : v;
  }));

  return {
    id: 'a2',
    type: 'table',
    title: `${kpiName} — detail`,
    description: `${kpiName} · ${range.displayLabel}`,
    gridSpan: 2,
    data: {
      columns: keys.map(prettify),
      rows,
      valueColumnIndex: valueColumnIndex >= 0 ? valueColumnIndex : undefined,
    },
    meta: { explain: `${rows.length} row(s) for ${range.displayLabel}.` },
  };
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Resolvers expose their tabular result under different keys (data / rows /
// providers / transactions / …). Find the first array-of-flat-objects so the
// adapter works across the heterogeneous resolver shapes.
function pickTabular(resolved) {
  const named = ['data', 'rows', 'items', 'list', 'records', 'providers', 'entries', 'transactions', 'breakdown'];
  for (const k of named) {
    const v = resolved[k];
    if (Array.isArray(v) && v.length > 0 && isObj(v[0])) return v;
  }
  for (const k of Object.keys(resolved)) {
    const v = resolved[k];
    if (Array.isArray(v) && v.length > 0 && isObj(v[0])) return v;
  }
  return null;
}

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

// Profit & Loss / EBITDA resolvers return rich scalar objects (not arrays),
// so the generic chart/table path can't render them. Build KPI tiles + a
// P&L bar + (Phase 2) a cost-category breakdown directly from the resolver's
// own numbers — nothing recomputed, so it stays reconciled with the Cost
// Impact / EBITDA Valuation / P&L pages.
function pnlDashboard(resolved, range) {
  const isPnl = resolved.metric === 'profit_and_loss';
  const isEbitda = !isPnl && num(resolved.ebitda) != null && num(resolved.revenue) != null;
  if (!isPnl && !isEbitda) return null;

  const src = isPnl ? (resolved.current || {}) : resolved;
  const label = isPnl ? 'Profit & Loss' : 'EBITDA';

  const TILES = [
    ['Revenue', src.revenue],
    ['Gross profit', src.grossProfit],
    ['EBITDA', src.ebitda],
    ['Total costs', src.totalCosts],
  ];
  let n = 0;
  const tiles = [];
  for (const [t, v] of TILES) {
    if (num(v) == null) continue;
    n += 1;
    tiles.push({
      id: `pl${n}`,
      type: 'kpi',
      title: t,
      description: `${t} · ${range.displayLabel}`,
      gridSpan: 1,
      data: { value: v, unit: 'currency' },
      meta: { explain: `${t} for ${range.displayLabel}.` },
    });
  }

  const barPts = [['Revenue', src.revenue], ['Gross profit', src.grossProfit], ['EBITDA', src.ebitda]]
    .filter(([, v]) => num(v) != null)
    .map(([l, v]) => ({ label: l, value: v }));
  const widgets = [];
  if (barPts.length >= 2) {
    widgets.push({
      id: 'plbar',
      type: 'bar',
      title: `${label} summary`,
      description: `${label} · ${range.displayLabel}`,
      gridSpan: 2,
      data: { points: barPts, unit: 'currency' },
      meta: { explain: `${label} headline figures for ${range.displayLabel}.` },
    });
  }
  widgets.push(...tiles);

  // Phase 2 — expense by category, straight from the resolver's costBuckets.
  const cbPts = (resolved.costBuckets || [])
    .filter(b => b && num(b.total) != null && Math.abs(b.total) > 0.005)
    .map(b => ({ label: b.label || prettify(b.key || ''), value: Math.abs(b.total) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  if (cbPts.length >= 2) {
    widgets.push({
      id: 'plcb',
      type: cbPts.length <= 6 ? 'pie' : 'bar',
      title: 'Cost breakdown',
      description: `Cost by category · ${range.displayLabel}`,
      gridSpan: 2,
      data: { points: cbPts, unit: 'currency' },
      meta: { explain: `Costs by category for ${range.displayLabel}.` },
    });
  }

  if (widgets.length === 0) return null;

  const loc = resolved.locationName ? ` — ${resolved.locationName}` : '';
  return {
    title: `${label}${loc} — ${range.displayLabel}`,
    period: { from: range.from, to: range.to, label: range.displayLabel },
    steps: [
      { key: 'resolveDateRange', label: `Resolved date range (${range.displayLabel})`, ok: true },
      { key: 'fetchData', label: `Fetched ${label.toLowerCase()} figures`, ok: true },
      { key: 'buildDashboard', label: `Built dashboard (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`, ok: true },
      { key: 'prepareAnswer', label: 'Prepared answer', ok: true },
    ],
    insights: [],
    widgets,
    followUps: [],
  };
}

// Plan Mix — revenue distribution by payment plan. resolvePlanMix returns
// { metric:'plan_mix', total, locationName, data:[{plan,revenue,sharePercent,
// count}] }. Numbers pass through unrecomputed (reconcile with the Treatment
// Insights Plan Mix card).
function planMixDashboard(resolved, range) {
  if (resolved.metric !== 'plan_mix' || !Array.isArray(resolved.data) || resolved.data.length === 0) {
    return null;
  }
  const rows = resolved.data.filter(d => d && num(d.revenue) != null);
  if (rows.length === 0) return null;

  const points = rows.slice(0, 12).map(d => ({ label: String(d.plan), value: d.revenue }));
  const widgets = [];

  if (num(resolved.total) != null) {
    widgets.push({
      id: 'pmtot',
      type: 'kpi',
      title: 'Total plan-mix revenue',
      description: `Plan mix · ${range.displayLabel}`,
      gridSpan: 1,
      data: { value: resolved.total, unit: 'currency' },
      meta: { explain: `Total revenue across payment plans for ${range.displayLabel}.` },
    });
  }
  widgets.push({
    id: 'pmchart',
    type: points.length <= 6 ? 'pie' : 'bar',
    title: 'Plan mix',
    description: `Revenue distribution by plan · ${range.displayLabel}`,
    gridSpan: 2,
    data: { points, unit: 'currency' },
    meta: { explain: `Revenue share by payment plan for ${range.displayLabel}.` },
  });
  widgets.push({
    id: 'pmtbl',
    type: 'table',
    title: 'Plan mix — detail',
    description: `Revenue by payment plan · ${range.displayLabel}`,
    gridSpan: 2,
    data: {
      columns: ['Plan', 'Revenue', 'Share %'],
      rows: rows.map(d => [d.plan, d.revenue, `${(Number(d.sharePercent) || 0).toFixed(2)}%`]),
      unit: 'currency',
      valueColumnIndex: 1,
    },
    meta: { explain: `${rows.length} payment plan(s) for ${range.displayLabel}.` },
  });

  const loc = resolved.locationName ? ` — ${resolved.locationName}` : '';
  return {
    title: `Plan mix${loc} — ${range.displayLabel}`,
    period: { from: range.from, to: range.to, label: range.displayLabel },
    steps: [
      { key: 'resolveDateRange', label: `Resolved date range (${range.displayLabel})`, ok: true },
      { key: 'fetchData', label: 'Fetched plan-mix figures', ok: true },
      { key: 'buildDashboard', label: `Built dashboard (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`, ok: true },
      { key: 'prepareAnswer', label: 'Prepared answer', ok: true },
    ],
    insights: [],
    widgets,
    followUps: [],
  };
}

// NHS Contract Performance — headline tiles + per-provider chart/table.
// resolveNhsPerformance returns { metric:'nhs_performance', totals:{...},
// providers:[{name,role,feeExpected,feeAwarded,claims,deliveryPct}] }.
// Numbers pass through unrecomputed (reconcile with the NHS page).
function nhsDashboard(resolved, range) {
  if (resolved.metric !== 'nhs_performance' || !resolved.totals) return null;
  const t = resolved.totals;
  const widgets = [];

  const TILES = [
    ['UDA delivered', t.udaDelivered, 'count'],
    ['UDA target', t.udaTarget, 'count'],
    ['Fee expected', t.feeExpected, 'currency'],
    ['Fee awarded', t.feeAwarded, 'currency'],
    ['YTD revenue', t.ytdRevenue, 'currency'],
  ];
  for (const [label, val, unit] of TILES) {
    if (num(val) == null) continue;
    widgets.push({
      id: `nhs${widgets.length + 1}`,
      type: 'kpi',
      title: label,
      description: `${label} · ${range.displayLabel}`,
      gridSpan: 1,
      data: { value: val, unit },
      meta: { explain: `${label} for ${range.displayLabel}.` },
    });
  }

  const provs = Array.isArray(resolved.providers) ? resolved.providers : [];
  const pts = provs.filter(p => p && num(p.feeExpected) != null)
    .slice(0, 12)
    .map(p => ({ label: String(p.name), value: p.feeExpected }));
  if (pts.length >= 2) {
    widgets.push({
      id: 'nhsprov',
      type: pts.length <= 6 ? 'pie' : 'bar',
      title: 'Fee expected by provider',
      description: `NHS fee expected by provider · ${range.displayLabel}`,
      gridSpan: 2,
      data: { points: pts, unit: 'currency' },
      meta: { explain: `NHS fee expected per provider for ${range.displayLabel}.` },
    });
  }
  if (provs.length > 0) {
    widgets.push({
      id: 'nhstbl',
      type: 'table',
      title: 'NHS performance by provider',
      description: `Per-provider UDA/fee · ${range.displayLabel}`,
      gridSpan: 2,
      data: {
        columns: ['Provider', 'Role', 'Fee expected', 'Fee awarded', 'Claims', 'Delivery %'],
        rows: provs.map(p => [p.name, p.role, p.feeExpected, p.feeAwarded, p.claims, `${Math.round(Number(p.deliveryPct) || 0)}%`]),
        unit: 'currency',
        valueColumnIndex: 2,
      },
      meta: { explain: `${provs.length} provider(s) for ${range.displayLabel}.` },
    });
  }

  if (widgets.length === 0) return null;
  const loc = resolved.locationName ? ` — ${resolved.locationName}` : '';
  return {
    title: `NHS contract performance${loc} — ${range.displayLabel}`,
    period: { from: range.from, to: range.to, label: range.displayLabel },
    steps: [
      { key: 'resolveDateRange', label: `Resolved date range (${range.displayLabel})`, ok: true },
      { key: 'fetchData', label: 'Fetched NHS claims', ok: true },
      { key: 'buildDashboard', label: `Built dashboard (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`, ok: true },
      { key: 'prepareAnswer', label: 'Prepared answer', ok: true },
    ],
    insights: [],
    widgets,
    followUps: [],
  };
}

// Membership Performance — members + membership revenue per plan.
// resolveMembershipPerformance returns { metric:'membership_performance',
// totals:{totalMembers,membershipRevenue,planCount}, plans:[{plan,members,
// monthlyFee,revenue}] }. Scoped: NO cost/profit/margin (deferred — see
// the resolver doc). Numbers pass through unrecomputed.
function membershipDashboard(resolved, range) {
  if (resolved.metric !== 'membership_performance' || !resolved.totals) return null;
  const t = resolved.totals;
  const plans = Array.isArray(resolved.plans) ? resolved.plans : [];
  const widgets = [];

  const TILES = [
    ['Total members', t.totalMembers, 'count'],
    ['Membership revenue', t.membershipRevenue, 'currency'],
    ['Plans', t.planCount, 'count'],
  ];
  for (const [label, val, unit] of TILES) {
    if (num(val) == null) continue;
    widgets.push({
      id: `mb${widgets.length + 1}`,
      type: 'kpi',
      title: label,
      description: `${label} · ${range.displayLabel}`,
      gridSpan: 1,
      data: { value: val, unit },
      meta: { explain: `${label} for ${range.displayLabel}.` },
    });
  }

  const pts = plans.filter(p => p && num(p.members) != null && p.members > 0)
    .slice(0, 12)
    .map(p => ({ label: String(p.plan), value: p.members }));
  if (pts.length >= 2) {
    widgets.push({
      id: 'mbchart',
      type: pts.length <= 6 ? 'pie' : 'bar',
      title: 'Members by plan',
      description: `Members by plan · ${range.displayLabel}`,
      gridSpan: 2,
      data: { points: pts, unit: 'count' },
      meta: { explain: `Member distribution by plan for ${range.displayLabel}.` },
    });
  }
  if (plans.length > 0) {
    widgets.push({
      id: 'mbtbl',
      type: 'table',
      title: 'Membership by plan',
      description: `Members & revenue by plan · ${range.displayLabel}`,
      gridSpan: 2,
      data: {
        columns: ['Plan', 'Members', 'Monthly fee', 'Revenue'],
        rows: plans.map(p => [p.plan, p.members, p.monthlyFee, p.revenue]),
        unit: 'currency',
        valueColumnIndex: 3,
      },
      meta: { explain: `${plans.length} membership plan(s) for ${range.displayLabel}.` },
    });
  }

  if (widgets.length === 0) return null;
  const loc = resolved.locationName ? ` — ${resolved.locationName}` : '';
  return {
    title: `Membership performance${loc} — ${range.displayLabel}`,
    period: { from: range.from, to: range.to, label: range.displayLabel },
    steps: [
      { key: 'resolveDateRange', label: `Resolved date range (${range.displayLabel})`, ok: true },
      { key: 'fetchData', label: 'Fetched membership data', ok: true },
      { key: 'buildDashboard', label: `Built dashboard (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`, ok: true },
      { key: 'prepareAnswer', label: 'Prepared answer', ok: true },
    ],
    insights: [],
    widgets,
    followUps: [],
  };
}

// Treatment Profit Goals — actual vs target. resolveProfitGoals returns
// { metric:'profit_goals', totals:{unitActual,unitTarget,avgActual,avgTarget},
// rows:[{name,unitActual,unitTarget,avgActual,avgTarget,progressPct}] }.
// Numbers pass through unrecomputed (mirror the Profit Goals page).
function profitGoalsDashboard(resolved, range) {
  if (resolved.metric !== 'profit_goals' || !resolved.totals) return null;
  const t = resolved.totals;
  const rows = Array.isArray(resolved.rows) ? resolved.rows : [];
  const widgets = [];

  const TILES = [
    ['Units (actual)', t.unitActual, 'count'],
    ['Units (target)', t.unitTarget, 'count'],
    ['Avg £ (actual)', t.avgActual, 'currency'],
    ['Avg £ (target)', t.avgTarget, 'currency'],
  ];
  for (const [label, val, unit] of TILES) {
    if (num(val) == null) continue;
    widgets.push({
      id: `pg${widgets.length + 1}`,
      type: 'kpi',
      title: label,
      description: `${label} · ${range.displayLabel}`,
      gridSpan: 1,
      data: { value: val, unit },
      meta: { explain: `${label} for ${range.displayLabel}.` },
    });
  }

  const pts = rows.filter(r => r && num(r.unitActual) != null && r.unitActual > 0)
    .slice(0, 12)
    .map(r => ({ label: String(r.name), value: r.unitActual }));
  if (pts.length >= 2) {
    widgets.push({
      id: 'pgchart',
      type: pts.length <= 6 ? 'pie' : 'bar',
      title: 'Units by treatment (actual)',
      description: `Treatment units · ${range.displayLabel}`,
      gridSpan: 2,
      data: { points: pts, unit: 'count' },
      meta: { explain: `Actual treatment units for ${range.displayLabel}.` },
    });
  }
  if (rows.length > 0) {
    widgets.push({
      id: 'pgtbl',
      type: 'table',
      title: 'Profit goals — actual vs target',
      description: `Per-treatment actual vs target · ${range.displayLabel}`,
      gridSpan: 2,
      data: {
        columns: ['Treatment', 'Units (A)', 'Units (T)', 'Avg £ (A)', 'Avg £ (T)', 'Progress'],
        rows: rows.map(r => [r.name, r.unitActual, r.unitTarget, r.avgActual, r.avgTarget, `${Math.round(Number(r.progressPct) || 0)}%`]),
        unit: 'currency',
        valueColumnIndex: 3,
      },
      meta: { explain: `${rows.length} treatment(s) for ${range.displayLabel}.` },
    });
  }

  if (widgets.length === 0) return null;
  const loc = resolved.locationName ? ` — ${resolved.locationName}` : '';
  return {
    title: `Treatment profit goals${loc} — ${range.displayLabel}`,
    period: { from: range.from, to: range.to, label: range.displayLabel },
    steps: [
      { key: 'resolveDateRange', label: `Resolved date range (${range.displayLabel})`, ok: true },
      { key: 'fetchData', label: 'Fetched actuals + targets', ok: true },
      { key: 'buildDashboard', label: `Built dashboard (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`, ok: true },
      { key: 'prepareAnswer', label: 'Prepared answer', ok: true },
    ],
    insights: [],
    widgets,
    followUps: [],
  };
}

function adaptResolvedToDashboard(intent, resolved) {
  if (!resolved || resolved.preformatted || resolved.isGeneral || resolved.dashboard) return null;

  const range = resolveDateRange(intent.args || {});

  // P&L / EBITDA scalar resolvers get a purpose-built layout (KPI tiles +
  // headline bar + cost-category breakdown) — checked before the generic
  // chart/table path, which can't shape a non-array result.
  const pnl = pnlDashboard(resolved, range);
  if (pnl) return pnl;

  const planMix = planMixDashboard(resolved, range);
  if (planMix) return planMix;

  const nhs = nhsDashboard(resolved, range);
  if (nhs) return nhs;

  const membership = membershipDashboard(resolved, range);
  if (membership) return membership;

  const profitGoals = profitGoalsDashboard(resolved, range);
  if (profitGoals) return profitGoals;

  const kpiName = prettify(intent.args?.metric || intent.toolName.replace(/^(get_|list_)/, ''));

  const widgets = [];
  const chart = chartWidget(resolved.chart, range);
  if (chart) widgets.push(chart);
  const table = tableWidget(pickTabular(resolved), range, kpiName);
  if (table) widgets.push(table);

  // Nothing to show in a dashboard → let the normal text answer stand.
  if (widgets.length === 0) return null;

  const title = (resolved.chart && resolved.chart.title) || `${kpiName} — ${range.displayLabel}`;

  return {
    title: `${title}`,
    period: { from: range.from, to: range.to, label: range.displayLabel },
    steps: [
      { key: 'resolveDateRange', label: `Resolved date range (${range.displayLabel})`, ok: true },
      { key: 'fetchData', label: `Fetched ${kpiName.toLowerCase()} data`, ok: true },
      { key: 'buildDashboard', label: `Built dashboard (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`, ok: true },
      { key: 'prepareAnswer', label: 'Prepared answer', ok: true },
    ],
    // The authoritative narrative + numbers stay in the chat bubble
    // (formatter markdown); the canvas is the visual companion.
    insights: [],
    widgets,
    followUps: [],
  };
}

// ── Page-mirror fallback ────────────────────────────────────────────────
// When a generic "make a dashboard" ask doesn't resolve to a specific KPI
// and the page has no dedicated resolver, build the dashboard from the
// PAGE'S OWN aiContext (the numbers it already computed + sent) instead of
// the one fixed practice_overview template — so the dashboard reflects the
// page you're on (feedback-chatbot-reuse-page-logic). Deliberately
// conservative: only clearly-numeric/labelled data, ids scrubbed, the huge
// visibleText snapshot never touched; if nothing usable → return null so the
// caller safely falls back to practice_overview (never an empty/junk board).
const PC_MONEY_RE = /(revenue|income|profit|cost|fee|ebitda|spend|turnover|value|balance|payable|receivable|charge|amount|gbp|£)/i;
const PC_COUNT_RE = /(count|patients?|members?|claims?|units?|treatments?|providers?|appointments?|days?|sessions?|chairs?|visits?)/i;
const PC_SKIP_KEYS = new Set(['snapshot', 'isPageLoading', 'page', 'selectedLocationName', 'selectedLocationId', 'selectedRegionId', 'period', 'userMessage']);

function pageContextDashboard(pageContext, range) {
  if (!pageContext || typeof pageContext !== 'object') return null;
  const rest = {};
  for (const [k, v] of Object.entries(pageContext)) {
    if (!PC_SKIP_KEYS.has(k) && !ID_KEY_RE.test(k)) rest[k] = v;
  }
  if (Object.keys(rest).length === 0) return null;

  // aiContext keys are JS camelCase (totalRevenue) — split before prettify so
  // tiles read "Total Revenue", not "TotalRevenue". Local to this path; the
  // shared prettify() stays snake_case-only for the data-tool adapter.
  const pcLabel = (k) => prettify(String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2'));

  const widgets = [];

  // 1. Scalar KPI tiles — top-level numbers + numbers inside a
  //    summary/totals/metrics/kpis object. Cap 6, ids skipped.
  const scalars = [];
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === 'number' && isFinite(v)) scalars.push([k, v]);
  }
  for (const objKey of ['summary', 'totals', 'metrics', 'kpis', 'headline']) {
    const o = rest[objKey];
    if (isObj(o)) for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && isFinite(v) && !ID_KEY_RE.test(k)) scalars.push([k, v]);
    }
  }
  for (const [k, v] of scalars) {
    if (widgets.length >= 6) break;
    if (v === 0) continue; // never headline a £0 / 0 tile (noise + misleading)
    const norm = String(k).replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (/^(location|region|site|practice|connection|integration|tenant)s?count$/.test(norm)) continue; // config-entity counts aren't a KPI
    const label = pcLabel(k);
    let unit;
    if (PC_MONEY_RE.test(k)) unit = 'currency';
    else if (PC_COUNT_RE.test(k) && Number.isInteger(v)) unit = 'count';
    widgets.push({
      id: `pc${widgets.length + 1}`,
      type: 'kpi',
      title: label,
      description: `${label} · ${range.displayLabel}`,
      gridSpan: 1,
      data: { value: v, unit },
      meta: { explain: `${label}, from the page you're on, for ${range.displayLabel}.` },
    });
  }

  // 2. First usable array-of-flat-objects → detail table (+ bar if it has a
  //    clear label + numeric value pair). Reuses the id-scrubbing helpers.
  const arr = pickTabular(rest);
  if (arr) {
    const first = arr[0];
    const keys = Object.keys(first).filter(k => isDisplayableColumn(k, first[k]));
    const numKeys = keys.filter(k => typeof first[k] === 'number');
    // Only render an array if it has at least one NON-ZERO numeric value —
    // an all-£0 table (e.g. a page's week-P/L when its data is unavailable)
    // is misleading noise; skip it and let the caller fall back.
    const anyNonZero = numKeys.some(nk => arr.some(r => Number(r[nk]) !== 0));
    if (numKeys.length > 0 && anyNonZero) {
      const labelKey = keys.find(k => typeof first[k] === 'string');
      const valKey = numKeys.find(k => arr.some(r => Number(r[k]) !== 0)) || numKeys[0];
      if (labelKey && valKey) {
        const pts = arr.slice(0, 12)
          .map(r => ({ label: String(r[labelKey]), value: Number(r[valKey]) || 0 }))
          .filter(p => p.label);
        if (pts.length >= 2) {
          widgets.push({
            id: 'pcchart',
            type: pts.length <= 6 ? 'pie' : 'bar',
            title: `${pcLabel(valKey)} by ${pcLabel(labelKey)}`,
            description: `From the page · ${range.displayLabel}`,
            gridSpan: 2,
            data: { points: pts, unit: PC_MONEY_RE.test(valKey) ? 'currency' : 'count' },
            meta: { explain: `From the page you're on, for ${range.displayLabel}.` },
          });
        }
      }
      const t = tableWidget(arr, range, prettify(typeof pageContext.page === 'string' ? pageContext.page : 'Page'));
      if (t) widgets.push(t);
    }
  }

  // 3. A resolver-style chart object the page may have passed.
  const ch = chartWidget(rest.chart, range);
  if (ch) widgets.unshift(ch);

  if (widgets.length === 0) return null;

  const pageName = typeof pageContext.page === 'string' && pageContext.page.trim()
    ? prettify(pageContext.page)
    : ((pageContext.snapshot && typeof pageContext.snapshot.title === 'string' && pageContext.snapshot.title.trim())
      ? pageContext.snapshot.title.trim()
      : 'This page');
  return {
    title: `${pageName} — ${range.displayLabel}`,
    period: { from: range.from, to: range.to, label: range.displayLabel },
    steps: [
      { key: 'resolveDateRange', label: `Resolved date range (${range.displayLabel})`, ok: true },
      { key: 'readPage', label: `Read the ${pageName} page`, ok: true },
      { key: 'buildDashboard', label: `Built dashboard (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`, ok: true },
      { key: 'prepareAnswer', label: 'Prepared answer', ok: true },
    ],
    insights: [],
    widgets,
    followUps: [],
    _pageName: pageName,
  };
}

module.exports = { adaptResolvedToDashboard, pageContextDashboard };
