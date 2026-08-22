const { KPIS, BY_ID } = require('./kpiRegistry');

/**
 * Maps a natural-language question to one or more canonical KPIs by scoring
 * the question text against each KpiDef's synonyms. Deterministic and
 * LLM-free — the model already classified intent upstream; this just picks
 * which registry templates to run so columns are never hallucinated.
 */

const DIMENSION_PATTERNS = [
  { dim: 'location', re: /\b(?:by|per|across|each|every)\s+(?:location|site|practice|clinic)s?\b|\blocation[\s-]?wise\b|\bby\s+branch\b/i },
  { dim: 'provider', re: /\b(?:by|per|across|each|every)\s+(?:provider|dentist|practitioner|clinician|associate|doctor)s?\b|\bprovider[\s-]?wise\b/i },
  { dim: 'treatment', re: /\b(?:by|per|across|each|every|for\s+each)\s+(?:treatment|procedure|service)s?\b|\btreatment[\s-]?wise\b|\b(?:treatment|procedure|service)\s+(?:breakdown|type)s?\b|\bbreakdown\s+by\s+(?:treatment|procedure|service)s?\b/i },
  { dim: 'month', re: /\b(?:by|per)\s+month\b|\bmonth(?:ly|[\s-]?wise|[\s-]?on[\s-]?month)\b|\btrend\b|\bover\s+time\b/i },
  { dim: 'day', re: /\b(?:by|per)\s+day\b|\bdaily\b|\bday[\s-]?by[\s-]?day\b|\bday[\s-]?wise\b/i },
];

// A "breakdown noun + split signal" pair also implies a categorical breakdown,
// catching natural phrasings the tight "by/per X" patterns miss — e.g.
// "income for all locations separately", "revenue for each site",
// "split treatments individually", "compare practices". The signal set is
// deliberately the *strong* ones only (separately / individually / split /
// breakdown / side-by-side / compare / versus); "by/per/each X" stays the job
// of the tight patterns above so "revenue per patient" never reads as a
// treatment breakdown. `sep[ae]?rat\w*` matches both "separately" and the
// very common "seprately" misspelling.
const SPLIT_SIGNAL_RE = /\b(?:sep[ae]?rat\w*|individual\w*|split|broken[\s-]?down|breakdown|side[\s-]?by[\s-]?side|compare|comparison|versus|vs)\b/i;
const NOUN_RE = {
  location: /\b(?:location|site|practice|clinic|branch)s?\b/i,
  provider: /\b(?:provider|dentist|practitioner|clinician|associate|doctor)s?\b/i,
  treatment: /\b(?:treatment|procedure|service)s?\b/i,
};

// Phrases that signal "give me an overview" rather than one specific metric —
// these route to a curated multi-KPI template instead of a single KPI.
const VAGUE_RE = /\b(?:how\s+(?:are\s+we|is\s+(?:the\s+)?(?:practice|business)|'?s\s+(?:the\s+)?(?:practice|business))\s+doing|overview|snapshot|summary|how\s+are\s+things|how\s+is\s+everything|practice\s+(?:health|pulse|performance)|state\s+of\s+(?:play|the\s+practice)|big\s+picture|at\s+a\s+glance)\b/i;

function detectDimensions(question) {
  const dims = [];
  for (const { dim, re } of DIMENSION_PATTERNS) {
    if (re.test(question)) dims.push(dim);
  }
  // Second pass: "<breakdown noun> ... <split signal>" in any order.
  if (SPLIT_SIGNAL_RE.test(question)) {
    for (const dim of ['location', 'provider', 'treatment']) {
      if (!dims.includes(dim) && NOUN_RE[dim].test(question)) dims.push(dim);
    }
  }
  return dims;
}

// Metrics the v1 KPI catalog deliberately can't compute (no expense/profit
// data source — see kpiRegistry.js header). When the user explicitly asks for
// one of these we still answer the revenue/activity side, but the orchestrator
// surfaces an honest "not available" note instead of silently pretending the
// revenue dashboard answered an income-vs-expense / profitability question.
// "income" and "average spend" are intentionally NOT here — they map cleanly
// to revenue / revenue-per-patient KPIs.
const UNSUPPORTED_METRIC_RE = /\b(?:expenses?|expenditures?|costs?|overheads?|outgoings?|profit|profitable|profitability|gross\s+profit|net\s+(?:income|profit|earnings)|margins?|ebitda|p\s*&\s*l|p\s+and\s+l|losses?|cogs)\b/i;

function scoreKpi(kpi, q) {
  let score = 0;
  for (const syn of kpi.synonyms || []) {
    if (q.includes(syn)) score += syn.split(' ').length; // longer phrase = stronger signal
  }
  return score;
}

/**
 * @returns {{
 *   vague: boolean,
 *   primary: object|null,        // top-scoring KpiDef
 *   kpis: object[],              // all KpiDefs that scored > 0 (primary first)
 *   dimensions: string[],        // detected breakdowns ('location'|'provider'|'treatment'|'month'|'day')
 *   unsupported: boolean,        // user asked for expense/profit/etc (no v1 KPI)
 * }}
 */
function resolveKpis(question) {
  const q = String(question || '').toLowerCase();
  const dimensions = detectDimensions(q);
  const vague = VAGUE_RE.test(q);
  const unsupported = UNSUPPORTED_METRIC_RE.test(q);

  const scored = KPIS
    .map(k => ({ kpi: k, score: scoreKpi(k, q) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const kpis = scored.map(s => s.kpi);
  const primary = kpis[0] || null;

  return { vague, primary, kpis, dimensions, unsupported };
}

/**
 * Page-aware dashboard routing. When a "dashboard" ask is generic (no
 * specific KPI and not an explicit "overview" request) the BI engine would
 * otherwise emit the one fixed `practice_overview` template for EVERY page —
 * the "same dashboard everywhere" complaint. Instead, map the page the user
 * is on to its dedicated, page-reconciled resolver so the dashboard reflects
 * that page's real data ([[feedback-chatbot-reuse-page-logic]]).
 *
 * `pageContext` = the frontend payload: `{ ...aiContext, snapshot:{ url,
 * title, ... } }`. Matches on the URL path first (robust), then any
 * aiContext `page` key. Returns a toolName or null (null → keep the generic
 * practice_overview, the safe default for unmapped pages).
 */
const PAGE_TOOL_RULES = [
  [/\/treatments\/membership|membership[-_]performance/, 'get_membership_performance'],
  [/\/treatments\/nhs|nhs[-_](?:contract|performance)/, 'get_nhs_performance'],
  [/\/treatments\/private|private[-_]treatment/, 'get_treatment_revenue'],
  [/\/treatments\/insights|treatment[-_]insights/, 'get_treatment_revenue'],
  [/\/treatments\/goals|treatment[-_]profit[-_]goals|profit[-_]goals/, 'get_profit_goals'],
  [/\/treatments\/profitability|treatment[-_]profitability|\/profitability|\/profit[-_]benchmark/, 'get_profit_and_loss'],
  [/\/ebitda|ebitda[-_](?:valuation|bridge)|exit[-_]cockpit/, 'get_ebitda'],
  [/\/chairs(?:\b|\/)|chair[-_]utilisation/, 'get_chair_metrics'],
  [/\/cashflow|cash[-_]flow|statement[-_]of[-_]cash/, 'get_cashflow_data'],
  [/\/cost[-_]impact|\/lab[-_]fees|\/staff[-_]costs|\/clinician[-_]costs|\/overhead[-_]costs|\/material[-_]costs|\/operating[-_]leases/, 'get_cost_breakdown'],
  [/\/locations(?:\b|\/)|location[-_]detail/, 'get_location_metrics'],
  // Location/Provider History — per-location financials + collection/AR
  // (resolveLocationMetrics reconciles with this page's cards).
  [/\/practitioner-history|provider[-_]history|location[-_]history/, 'get_location_metrics'],
  // Providers roster (revenue + appointment counts side-by-side — same
  // logic the History page uses; resolveListProviders is reconciled).
  [/\/providers(?:\b|\/)|provider[-_]detail|providers[-_](?:dentist|therapist|hygienist|other)/, 'list_providers'],
  // Accounts Payable = supplier cost invoices → transaction-level cost detail.
  [/\/accounts-payable|accounts[-_]payable/, 'list_cost_transactions'],
];

function pageAwareDashboardTool(pageContext) {
  if (!pageContext || typeof pageContext !== 'object') return null;
  const snap = pageContext.snapshot;
  const url = typeof (snap && snap.url) === 'string' ? snap.url.toLowerCase() : '';
  const pageKey = typeof pageContext.page === 'string' ? pageContext.page.toLowerCase() : '';
  const hay = `${url} ${pageKey}`.trim();
  if (!hay) return null;
  for (const [re, tool] of PAGE_TOOL_RULES) {
    if (re.test(hay)) return tool;
  }
  return null;
}

module.exports = { resolveKpis, detectDimensions, pageAwareDashboardTool, UNSUPPORTED_METRIC_RE, BY_ID };
