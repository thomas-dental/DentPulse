const { supabaseAdmin } = require('../../../config/supabase');
const apiKeyService = require('../apiKeyService');
const { resolveDateRange } = require('./dateRange');
const { resolveKpis } = require('./nlResolver');
const { BY_ID, buildFilters } = require('./kpiRegistry');
const { getTemplate } = require('./dashboardTemplates');
const { aiAggregate } = require('./safeAggregator');
const { planDashboard } = require('./planDashboard');
const { generateInsights } = require('./insights');

/**
 * Deterministic Conversational BI pipeline. Runs the fixed sequence:
 *   resolveDateRange → resolveKpi(s) → aggregate → label → planDashboard →
 *   generateInsights → suggestFollowUps → DashboardPayload
 *
 * Each KPI aggregation is isolated: a failure degrades that one block to
 * "Unavailable" instead of failing the whole turn.
 */

const FOLLOW_UP_POOL = [
  'Break down by location',
  'Show monthly trend',
  'Compare with last month',
  'Revenue per patient',
  'How are we doing this quarter?',
  'Patients treated this period',
];

function locationScope(args) {
  if (args._scopeAllLocations) return null;
  if (Array.isArray(args.location_ids) && args.location_ids.length > 0) return args.location_ids;
  if (args.location_id) return [args.location_id];
  return null;
}

/**
 * Build the ordered list of { kpi, dimension } plan items from the resolved
 * question. Guarantees at least one chartable (dimensioned) item so the
 * dashboard is never KPI-only.
 */
function buildPlanItems(resolved) {
  const items = [];
  if (resolved.vague || !resolved.primary) {
    const tpl = getTemplate('practice_overview');
    for (const it of tpl.items) {
      const kpi = BY_ID[it.kpiId];
      if (kpi) items.push({ kpi, dimension: it.dimension });
    }
    return { items, title: tpl.title };
  }

  const primary = resolved.primary;
  // Scalar headline.
  items.push({ kpi: primary, dimension: null });

  // Requested breakdowns the primary KPI actually supports.
  let added = 0;
  for (const dim of resolved.dimensions) {
    if (primary.dimensions && primary.dimensions[dim]) {
      items.push({ kpi: primary, dimension: dim });
      added++;
    }
  }
  // No explicit breakdown → default to a monthly trend so there's always a chart.
  if (added === 0 && primary.dimensions && primary.dimensions.month) {
    items.push({ kpi: primary, dimension: 'month' });
  }
  // Add the patient-value derived KPI as a companion tile on revenue questions.
  if (primary.id === 'total_treatment_revenue' && BY_ID.avg_revenue_per_patient) {
    items.push({ kpi: BY_ID.avg_revenue_per_patient, dimension: null });
  }
  return { items, title: `${primary.name}` };
}

async function resolveLabels(orgId, dimension, points) {
  // Map grouped keys (UUIDs / ids) to friendly names. Best-effort: an
  // unresolved key falls back to a readable placeholder, never a hard error.
  if (!points || points.length === 0) return points;
  try {
    if (dimension === 'location') {
      const ids = points.map(p => p.key).filter(Boolean);
      const { data } = await supabaseAdmin
        .from('practice_locations')
        .select('id, location_name')
        .eq('organization_id', orgId)
        .in('id', ids);
      const map = new Map((data || []).map(r => [String(r.id), r.location_name]));
      return points.map(p => ({ ...p, label: map.get(String(p.key)) || 'Unknown location' }));
    }
    if (dimension === 'provider') {
      const ids = points.map(p => p.key).filter(Boolean);
      const { data } = await supabaseAdmin
        .from('providers')
        .select('id, name')
        .eq('organization_id', orgId)
        .in('id', ids);
      const map = new Map((data || []).map(r => [String(r.id), r.name]));
      return points.map(p => ({ ...p, label: map.get(String(p.key)) || `Provider ${p.key}` }));
    }
  } catch (err) {
    console.error('[BI-ORCH] label resolution failed:', err.message);
  }
  // Time buckets / fallthrough: key is already display-ready.
  return points.map(p => ({ ...p, label: p.key }));
}

async function runAggregation(item, ctx) {
  const { kpi, dimension } = item;
  const dimSpec = dimension && kpi.dimensions ? kpi.dimensions[dimension] : null;
  const filters = buildFilters(kpi, ctx);
  const { total, rows } = await aiAggregate({
    table: kpi.table,
    filters,
    method: kpi.method,
    valueCol: kpi.valueColumn || null,
    distinctCol: kpi.distinctColumn || null,
    groupBy: dimSpec ? dimSpec.groupBy : null,
    dateFormat: dimSpec ? dimSpec.dateFormat || null : null,
    excludeCharting: !!kpi.excludeCharting,
    sort: 'desc',
    topN: dimension && !['month', 'day'].includes(dimension) ? 12 : null,
  });
  return { total, rows };
}

async function run(intent, orgId, context) {
  const args = intent.args || {};
  const question = args._question || context?.userMessage || '';
  const range = resolveDateRange(args);
  const locationIds = locationScope(args);
  const orgKey = await apiKeyService.getOrgApiKey(orgId);

  const resolved = resolveKpis(question);

  // Page-mirror fallback. A generic dashboard ask (no specific KPI, and NOT
  // an explicit "overview/how are we doing" request) that reached the BI
  // engine means no dedicated page resolver matched (v2Handler already tried
  // pageAwareDashboardTool). Rather than the one fixed practice_overview
  // template, reflect the PAGE the user is on by building from its own
  // aiContext. Conservative: returns null when nothing usable → we fall
  // through to practice_overview (safe default). Explicit "overview" (vague)
  // legitimately keeps practice_overview.
  if (!resolved.primary && !resolved.vague) {
    try {
      const { pageContextDashboard } = require('./resolvedAdapter');
      const pcd = pageContextDashboard(context && context.pageContext, range);
      if (pcd) {
        const pageName = pcd._pageName || 'this page';
        delete pcd._pageName;
        return {
          preformatted: true,
          markdown: `Here's a dashboard built from the **${pageName}** page for **${range.displayLabel}**.`,
          suggestions: ['Break down by location', 'Show monthly trend', 'Revenue per patient', 'Compare with last month'],
          dashboard: pcd,
        };
      }
    } catch (err) {
      console.error('[BI-ORCH] page-mirror fallback failed (non-fatal):', err.message);
    }
  }

  const { items, title } = buildPlanItems(resolved);

  const aggCtx = { organizationId: orgId, from: range.from, to: range.to, locationIds };
  const filterNote = locationIds ? ' · selected location(s)' : ' · all locations';

  // Run scalar/non-derived aggregations first (derived KPIs need their inputs).
  const scalarTotals = {}; // kpiId -> numeric total (period, no breakdown)

  const blocks = [];
  await Promise.all(items.map(async (item) => {
    try {
      if (item.kpi.method === 'derived') return; // second pass
      const { total, rows } = await runAggregation(item, aggCtx);
      const records = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
      if (item.dimension == null) {
        scalarTotals[item.kpi.id] = total;
        blocks.push({
          kpi: item.kpi,
          dimension: null,
          unit: item.kpi.unit,
          scalar: total,
          records,
          description: `${item.kpi.name} · ${range.displayLabel}${filterNote}`,
          _order: items.indexOf(item),
        });
      } else {
        const points = await resolveLabels(orgId, item.dimension,
          rows.map(r => ({ key: r.key, value: r.value, count: r.count })));
        blocks.push({
          kpi: item.kpi,
          dimension: item.dimension,
          unit: item.kpi.unit,
          points: points.map(p => ({ label: p.label, value: p.value, count: p.count })),
          records,
          description: `${item.kpi.name} by ${item.dimension} · ${range.displayLabel}${filterNote}`,
          _order: items.indexOf(item),
        });
      }
    } catch (err) {
      console.error(`[BI-ORCH] aggregation failed for ${item.kpi.id}/${item.dimension}:`, err.message);
      blocks.push({
        kpi: item.kpi,
        dimension: item.dimension,
        unit: item.kpi.unit,
        scalar: item.dimension == null ? 0 : undefined,
        points: item.dimension == null ? undefined : [],
        unavailable: true,
        description: `${item.kpi.name} — unavailable`,
        _order: items.indexOf(item),
      });
    }
  }));

  // Second pass: derived KPIs (e.g. revenue per patient = revenue ÷ patients).
  for (const item of items) {
    if (item.kpi.method !== 'derived' || item.dimension != null) continue;
    const [numId, denId] = item.kpi.derivedFrom || [];
    let num = scalarTotals[numId];
    let den = scalarTotals[denId];
    try {
      if (num == null) num = (await runAggregation({ kpi: BY_ID[numId], dimension: null }, aggCtx)).total;
      if (den == null) den = (await runAggregation({ kpi: BY_ID[denId], dimension: null }, aggCtx)).total;
      const value = den > 0 ? num / den : 0;
      blocks.push({
        kpi: item.kpi,
        dimension: null,
        unit: item.kpi.unit,
        scalar: value,
        description: `${item.kpi.name} · ${range.displayLabel}${filterNote}`,
        _order: items.indexOf(item),
      });
    } catch (err) {
      console.error(`[BI-ORCH] derived KPI ${item.kpi.id} failed:`, err.message);
    }
  }

  blocks.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));

  const widgets = planDashboard(blocks.filter(b => !b.unavailable || b.dimension == null));

  const { insights } = await generateInsights({
    blocks: blocks.filter(b => !b.unavailable),
    range,
    question,
    orgKey,
    organizationId: orgId,
    userId: context?.userId || null,
  });

  // Honest disclosure: if the user explicitly asked for a metric the v1 KPI
  // catalog can't compute (expense / profit / margin / P&L — no accounting
  // data source yet), prepend a clear note rather than letting the
  // revenue-only dashboard silently masquerade as the answer.
  const insightTexts = resolved.unsupported
    ? [
      "Expense and profit aren't part of this dashboard yet — it covers treatment revenue and patient activity only. Showing the revenue side of your question.",
      ...insights,
    ]
    : insights;

  // Follow-up chips: deterministic, deduped, 3-4.
  const followUps = [];
  if (resolved.primary && resolved.primary.id !== 'total_treatment_revenue') followUps.push('Show treatment revenue');
  for (const f of FOLLOW_UP_POOL) {
    if (followUps.length >= 4) break;
    if (!followUps.includes(f)) followUps.push(f);
  }

  // Static "what I did" checklist shown in the chat column (the pipeline is
  // deterministic and already finished — these are reported, not streamed).
  const steps = [
    { key: 'resolveDateRange', label: `Resolved date range (${range.displayLabel})`, ok: true },
    { key: 'resolveKpi', label: resolved.primary ? `Resolved KPI — ${resolved.primary.name}${resolved.unsupported ? ' (revenue only — expense/profit not available)' : ''}` : 'Selected dashboard template', ok: true },
    { key: 'planDashboard', label: 'Planned layout', ok: true },
    { key: 'generateDashboard', label: `Generated dashboard (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`, ok: widgets.length > 0 },
    { key: 'generateInsights', label: `Surfaced insights (${insightTexts.length})`, ok: insightTexts.length > 0 },
    { key: 'suggestFollowUps', label: 'Suggested follow-ups', ok: followUps.length > 0 },
  ];

  const dashboard = {
    title: `${title} — ${range.displayLabel}`,
    period: { from: range.from, to: range.to, label: range.displayLabel },
    steps,
    insights: insightTexts.map(text => ({ text })),
    widgets,
    followUps: followUps.slice(0, 4),
  };

  return {
    preformatted: true,
    markdown: `Here's your **${title}** dashboard for **${range.displayLabel}**.`,
    suggestions: dashboard.followUps,
    dashboard,
  };
}

module.exports = { run };
