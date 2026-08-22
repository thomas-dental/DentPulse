/**
 * Pure-JS dashboard planner. Turns the orchestrator's computed result blocks
 * into an ordered widget list. No LLM, no DB — deterministic layout only.
 *
 * Order (matches the reference dashboard UI): the main time-series chart on
 * top (full row), then the KPI-tile row, then categorical breakdown charts,
 * then detail tables, with a text fallback only if nothing charted.
 *
 * Result block (input) shape:
 *   { kpi, dimension|null, displayLabel, unit, scalar?:number,
 *     points?:[{label,value,count}], records?:number, description }
 *
 * Widget (output) shape:
 *   { id, type:'kpi'|'bar'|'line'|'pie'|'table'|'text', title, description,
 *     gridSpan:1|2, data, meta:{ kpiId, dimension?, records?, explain } }
 */

let wid = 0;
function nextId() { return `w${++wid}`; }

const MAX_CHART_CATEGORIES = 12;

function capitalize(s) {
  return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
}

// Plain-English explanation for the Info popover. NEVER name DB tables/columns
// (product rule: tooltips use business language only).
function explainOf(block) {
  let txt = block.description || block.kpi.name;
  if (block.kpi && block.kpi.excludeCharting) {
    txt += ' Charting/odontogram entries are excluded so totals match the Treatments pages.';
  }
  return txt;
}

function baseMeta(block) {
  return {
    kpiId: block.kpi.id,
    dimension: block.dimension || undefined,
    records: typeof block.records === 'number' ? block.records : undefined,
    explain: explainOf(block),
  };
}

function kpiWidget(block) {
  return {
    id: nextId(),
    type: 'kpi',
    title: block.kpi.name,
    description: block.description,
    gridSpan: 1,
    data: { value: block.scalar ?? 0, unit: block.unit },
    meta: baseMeta(block),
  };
}

function timeSeriesWidget(block) {
  return {
    id: nextId(),
    type: 'line',
    title: `${block.kpi.name} over time`,
    description: block.description,
    gridSpan: 2,
    data: { points: block.points || [], unit: block.unit },
    meta: baseMeta(block),
  };
}

function categoricalWidget(block) {
  const points = (block.points || []).slice(0, MAX_CHART_CATEGORIES);
  const type = points.length >= 2 && points.length <= 6 ? 'pie' : 'bar';
  return {
    id: nextId(),
    type,
    title: `${block.kpi.name} by ${block.dimension}`,
    description: block.description,
    gridSpan: 2,
    data: { points, unit: block.unit },
    meta: baseMeta(block),
  };
}

function tableWidget(block) {
  return {
    id: nextId(),
    type: 'table',
    title: `${block.kpi.name} by ${block.dimension} — detail`,
    description: block.description,
    gridSpan: 2,
    data: {
      columns: [capitalize(block.dimension), block.kpi.name, 'Records'],
      rows: (block.points || []).map(p => [p.label, p.value, p.count ?? '']),
      unit: block.unit,
      valueColumnIndex: 1,
    },
    meta: baseMeta(block),
  };
}

/**
 * @param {Array} blocks  computed result blocks
 * @returns {Array} widgets, ordered: time-series → KPI tiles → categorical → tables
 */
function planDashboard(blocks) {
  wid = 0;

  const scalars = blocks.filter(b => b.dimension == null);
  const timeBlocks = blocks.filter(b => b.dimension === 'month' || b.dimension === 'day');
  const catBlocks = blocks.filter(b => b.dimension != null && b.dimension !== 'month' && b.dimension !== 'day');

  const timeWidgets = timeBlocks.map(timeSeriesWidget);
  const kpiWidgets = scalars.map(kpiWidget);
  const catWidgets = [];
  for (const b of catBlocks) {
    catWidgets.push(categoricalWidget(b));
    if ((b.points || []).length >= 3) catWidgets.push(tableWidget(b));
  }

  const widgets = [...timeWidgets, ...kpiWidgets, ...catWidgets];
  const hasChart = timeWidgets.length > 0 || catWidgets.some(w => w.type !== 'table');

  // KPI-only dashboards are forbidden (reference rule). If nothing charted,
  // surface a text-summary so the response is still coherent.
  if (!hasChart && widgets.length > 0) {
    widgets.push({
      id: nextId(),
      type: 'text',
      title: 'Summary',
      description: '',
      gridSpan: 2,
      data: { markdown: '_No breakdown was available for this question — figures above are period totals._' },
      meta: {},
    });
  }

  return widgets;
}

module.exports = { planDashboard };
