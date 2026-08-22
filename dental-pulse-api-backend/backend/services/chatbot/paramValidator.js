const periodHelper = require('./periodHelper');

/**
 * Validates required args and fills missing ones from conversation context.
 */

// Tools whose answer is only meaningful for a specific period.
const TOOLS_NEEDING_PERIOD = new Set([
  'generate_dashboard',
  'get_financial_metric',
  'compare_doctors',
  'compare_periods',
  'get_cashflow_data',
  'get_treatment_revenue',
  'get_revenue_breakdown_report',
  'get_chair_metrics',
  'get_location_metrics',
  'get_cost_breakdown',
  'drill_down_metric',
  'explain_why',
  'generate_report',
  'year_over_year_report',
  'what_if_scenario',
  'list_cost_entries',
  'list_cost_transactions',
  'list_dna_patients',
  'list_cancelled_patients',
  'list_appointments',
  'get_ebitda',
  'list_providers',
  'get_profit_and_loss',
]);

// Detects whether the user wrote any period reference in their own words.
const PERIOD_KEYWORD_RE = /\b(today|yesterday|tomorrow|this\s+(week|month|quarter|year)|last\s+(week|month|quarter|year)|next\s+(week|month|quarter|year)|past\s+\d+\s+(day|week|month|year)s?|q[1-4]\b|ytd|fy\s*\d|financial\s+year|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may\b|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?|\d{4}|\d{1,2}[\-\/]\d{1,2})\b/i;

function userMentionedPeriod(message) {
  if (!message || typeof message !== 'string') return false;
  return PERIOD_KEYWORD_RE.test(message);
}

function fillFromContext(intent, context, originalMessage) {
  if (!intent || !intent.args) return;

  const args = intent.args;

  // Extract "top N" from the user's message when the classifier missed it, so
  // queries like "top 5 providers" actually return 5 rows rather than the
  // resolver's default cap. Run this BEFORE the missing-period refusal so the
  // value survives into context.pendingIntent and is carried into the chip-
  // reply turns that complete the query.
  if (!args.top && typeof originalMessage === 'string') {
    const trimmed = originalMessage.trim();
    const m = originalMessage.match(/\btop\s+(\d{1,3})\b/i)
      || originalMessage.match(/\bfirst\s+(\d{1,3})\b/i)
      || originalMessage.match(/\b(?:show|give|list|return|get)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?(\d{1,3})\b/i)
      || originalMessage.match(/^(\d{1,3})\s*(?:please|pls)?$/i);  // bare "5" reply
    if (m) {
      const n = parseInt(m[1], 10);
      // Cap to 50 so a noisy "show 100 entries" doesn't override resolver caps,
      // and ignore patterns that grabbed a year (4 digits) by accident.
      if (Number.isFinite(n) && n > 0 && n <= 999 && trimmed.length > 0) {
        args.top = Math.min(n, 50);
      }
    }
  }

  // Extract provider type from common dental terms so chart_get_production_metrics
  // returns the same row set the Production page shows. The page defaults to
  // "Dentist" (matches "TOTAL DENTISTS: 6" card), so the chatbot must filter
  // by provider type when the user uses words like "dentist"/"practitioner",
  // otherwise hygienists, therapists, and lab entries leak into the answer.
  //
  // Regexes are typo-tolerant — "hygenist" (missing the second 'i'), "dentits",
  // and "hygenic" all show up in real queries and used to cause the LLM to
  // mis-match against a provider whose surname contained "Hygiene".
  const PROVIDER_TYPE_REGEX = {
    Hygienist: /\bhyg(?:i?e?nists?|enists?|ien(?:e|ist)|enic?)\b/i,
    Therapist: /\btherap?ists?\b/i,
    Dentist:   /\b(?:dent[ia]?sts?|practitioners?|associates?)\b/i,
  };
  function detectProviderType(text) {
    for (const [type, re] of Object.entries(PROVIDER_TYPE_REGEX)) {
      if (re.test(text)) return type;
    }
    return null;
  }

  if (!args.provider_type && typeof originalMessage === 'string') {
    const t = detectProviderType(originalMessage);
    if (t) args.provider_type = t;
  }

  // If the LLM stuck a provider-type word into doctor_name (e.g.
  // doctor_name="hygenist" or "the hygienist"), promote to provider_type
  // and drop the bogus name.
  //
  // Also handle the false-match case: the user said "hygienist" but the LLM
  // picked a real provider whose surname contains "Hygiene" (e.g. "Rachel
  // Hygiene") because that's the only provider whose name fuzzy-matches the
  // type word. Heuristic: if the original USER MESSAGE clearly asked for a
  // type, we trust the type over the LLM's name guess. We only override the
  // name in this case — we never strip a doctor_name when the user actually
  // typed a person's name.
  if (args.doctor_name && typeof args.doctor_name === 'string') {
    const nameType = detectProviderType(args.doctor_name);
    if (nameType && !/\s/.test(args.doctor_name.trim())) {
      // Single word like "hygenist" — definitely a type, not a name.
      args.provider_type = args.provider_type || nameType;
      delete args.doctor_name;
    } else if (typeof originalMessage === 'string') {
      const messageType = detectProviderType(originalMessage);
      // The doctor_name (e.g. "Rachel Hygiene") only matches because of the
      // type word inside it, and the user's question contained that type
      // word as a category — favour the type.
      if (messageType && nameType === messageType) {
        // Strip the type word from the doctor_name and check if anything
        // useful is left. If the residual looks like a real first/last
        // name we keep it as doctor_name too (rare).
        const stripped = args.doctor_name.replace(PROVIDER_TYPE_REGEX[messageType], '').trim();
        args.provider_type = args.provider_type || messageType;
        if (!stripped || stripped.length < 2) delete args.doctor_name;
        else args.doctor_name = stripped;
      }
    }
  }

  // If the user didn't name a period and we have no period from prior turns,
  // ask for one instead of silently defaulting (avoids picking a misleading window).
  if (
    TOOLS_NEEDING_PERIOD.has(intent.toolName) &&
    !args.period_from && !args.period_to &&
    !context.currentPeriod &&
    !userMentionedPeriod(originalMessage)
  ) {
    intent.refused = true;
    intent.refusalMessage = "Which time period would you like to see? For example: **this month**, **last month**, **last quarter**, **Q1**, **this year**, or a specific range like **April 2026** or **2026-01-01 to 2026-03-31**.";
    intent.refusalSuggestions = ['This month', 'Last month', 'Last quarter', 'This year'];
    return;
  }

  // Fill period from context or default
  if (!args.period_from || !args.period_to) {
    if (context.currentPeriod) {
      args.period_from = args.period_from || context.currentPeriod.from;
      args.period_to = args.period_to || context.currentPeriod.to;
    } else {
      const defaultPeriod = periodHelper.getDefaultPeriod();
      args.period_from = args.period_from || defaultPeriod.from;
      args.period_to = args.period_to || defaultPeriod.to;
    }
  }

  // Fill doctor from context (if tool accepts it and context has one)
  const doctorTools = [
    'get_financial_metric', 'drill_down_metric', 'explain_why',
    'forecast_metric', 'render_inline_chart', 'generate_report',
  ];
  if (doctorTools.includes(intent.toolName) && !args.doctor_name && context.currentDoctor) {
    args.doctor_name = context.currentDoctor;
  }

  // Fill metric from context
  if (!args.metric && context.currentMetric) {
    args.metric = context.currentMetric;
  }

  // Refuse cashflow + doctor combination
  if (args.metric === 'cashflow' && args.doctor_name) {
    intent.refused = true;
    intent.refusalMessage = `Cashflow is a practice-wide metric and can't be scoped to a single provider. Would you like me to show **${args.doctor_name}**'s revenue or profit instead?`;
    delete args.doctor_name;
  }
}

module.exports = { fillFromContext };
