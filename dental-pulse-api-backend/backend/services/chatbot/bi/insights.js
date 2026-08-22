/**
 * Grounded insights. Facts (top / top3 / total / share) are computed in JS
 * from the actual aggregated rows; the LLM is then only allowed to PHRASE
 * those numbers — it cannot invent figures, names, or percentages. If the LLM
 * call fails we fall back to deterministic sentences built from the same
 * facts, so a dashboard never ends up with no narrative.
 */

function fmt(value, unit) {
  if (unit === 'currency') {
    return '£' + Math.round(Number(value) || 0).toLocaleString('en-GB');
  }
  return (Number(value) || 0).toLocaleString('en-GB');
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Pure, unit-testable: derive the ground-truth fact set from result blocks.
 */
function computeFacts(blocks, range) {
  const facts = { period: range.displayLabel, scalars: [], breakdowns: [] };

  for (const b of blocks) {
    if (b.dimension == null) {
      facts.scalars.push({
        kpi: b.kpi.name,
        value: b.scalar ?? 0,
        unit: b.unit,
        display: fmt(b.scalar ?? 0, b.unit),
      });
    } else {
      const pts = (b.points || []).filter(p => p && p.label != null);
      const total = pts.reduce((s, p) => s + (Number(p.value) || 0), 0);
      const ranked = [...pts].sort((a, b2) => (Number(b2.value) || 0) - (Number(a.value) || 0));
      const top = ranked[0] || null;
      facts.breakdowns.push({
        kpi: b.kpi.name,
        dimension: b.dimension,
        unit: b.unit,
        total,
        totalDisplay: fmt(total, b.unit),
        top: top ? { label: top.label, value: top.value, display: fmt(top.value, b.unit), sharePct: pct(top.value, total) } : null,
        top3: ranked.slice(0, 3).map(p => ({ label: p.label, display: fmt(p.value, b.unit) })),
        groups: pts.length,
      });
    }
  }
  return facts;
}

// Deterministic narrative — used as the LLM fallback and as the floor so the
// dashboard always has 2-3 callouts.
function deterministicInsights(facts) {
  const out = [];
  for (const s of facts.scalars) {
    out.push(`${s.kpi} for ${facts.period} was ${s.display}.`);
  }
  for (const b of facts.breakdowns) {
    if (b.top && b.dimension !== 'month' && b.dimension !== 'day') {
      out.push(`Top ${b.dimension} by ${b.kpi.toLowerCase()}: ${b.top.label} at ${b.top.display} (${b.top.sharePct}% of ${b.totalDisplay}).`);
    } else if (b.dimension === 'month' || b.dimension === 'day') {
      out.push(`${b.kpi} is tracked across ${b.groups} ${b.dimension === 'month' ? 'months' : 'days'} in ${facts.period}, totalling ${b.totalDisplay}.`);
    }
  }
  return out.slice(0, 3);
}

const SYSTEM_PROMPT = `You write 2-3 short business insights for a UK dental practice dashboard.
STRICT RULES:
- Use ONLY the numbers and labels in the provided FACTS JSON. Never invent or estimate any figure, name, or percentage.
- Currency is GBP shown as £ (already formatted in FACTS — copy verbatim). Dates are DD/MM/YYYY.
- Each insight is ONE sentence, plain business English, no markdown, no preamble.
- Do not name a provider/location/period that is not present in FACTS.
- Return ONLY a JSON array of strings, e.g. ["...", "...", "..."]. No other text.`;

async function generateInsights({ blocks, range, question, orgKey, organizationId, userId }) {
  const facts = computeFacts(blocks, range);
  const floor = deterministicInsights(facts);

  // No usable facts → just return whatever deterministic gave us.
  if (facts.scalars.length === 0 && facts.breakdowns.length === 0) {
    return { insights: floor, facts };
  }

  try {
    // Lazy-require: keeps computeFacts/deterministicInsights loadable without
    // Anthropic/Supabase env (DB-free __test__/bi.test.js).
    const claudeClient = require('../claudeClient');
    const raw = await claudeClient.callForInsights({
      apiKey: orgKey.apiKey,
      model: orgKey.formatModel,
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `User question: ${JSON.stringify(question || '')}\n\nFACTS:\n${JSON.stringify(facts, null, 2)}`,
      organizationId,
      userId,
    });
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const arr = JSON.parse(raw.slice(start, end + 1));
      const cleaned = (Array.isArray(arr) ? arr : [])
        .filter(s => typeof s === 'string' && s.trim().length > 0)
        .map(s => s.trim())
        .slice(0, 3);
      if (cleaned.length > 0) return { insights: cleaned, facts };
    }
  } catch (err) {
    console.error('[BI-INSIGHTS] LLM phrasing failed, using deterministic fallback:', err.message);
  }
  return { insights: floor, facts };
}

module.exports = { generateInsights, computeFacts, deterministicInsights };
