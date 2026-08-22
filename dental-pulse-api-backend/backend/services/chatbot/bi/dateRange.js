const periodHelper = require('../periodHelper');

/**
 * Normalises the period an intent carries into a single shape the BI pipeline
 * uses everywhere: ISO bounds for DB filters, DD/MM/YYYY for any user-facing
 * prose (DentPulse is UK dental — £ and DD/MM/YYYY, never US format).
 *
 * By the time the dashboard resolver runs, v2Handler + paramValidator have
 * already populated args.period_from / args.period_to (from @-mention, inline
 * text, page filter, context, or default), so this mostly formats — it only
 * falls back to periodHelper for a label-only edge case.
 */

function toDisplay(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`; // DD/MM/YYYY
}

function resolveDateRange(args = {}) {
  let from = args.period_from || null;
  let to = args.period_to || null;

  // Edge case: only a label survived (rare — paramValidator usually fills
  // from/to). Resolve it through the shared period helper.
  if ((!from || !to) && args.period_label) {
    const r = periodHelper.resolveperiodLabel(String(args.period_label).toLowerCase());
    if (r) { from = from || r.from; to = to || r.to; }
  }

  // Absolute last resort so the pipeline never runs without a window.
  if (!from || !to) {
    const def = periodHelper.getDefaultPeriod();
    from = from || def.from;
    to = to || def.to;
  }

  const displayLabel = args.period_label
    ? String(args.period_label)
    : `${toDisplay(from)} – ${toDisplay(to)}`;

  return {
    from,                       // ISO 'YYYY-MM-DD' — DB filter (>= from)
    to,                         // ISO 'YYYY-MM-DD' — DB filter (<= to, +time in aggregator filters)
    fromDisplay: toDisplay(from),
    toDisplay: toDisplay(to),
    displayLabel,               // human string for titles/insights
    source: args._periodSource || 'user',
  };
}

module.exports = { resolveDateRange, toDisplay };
