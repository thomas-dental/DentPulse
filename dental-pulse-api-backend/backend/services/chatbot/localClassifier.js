const periodHelper = require('./periodHelper');

/**
 * Fast-path regex classifier. Returns intent or null (defer to LLM).
 * ~30 patterns that handle common queries without an LLM call.
 */

// Detect period phrases in plain text (without @ prefix)
const INLINE_PERIOD_PATTERNS = [
  { regex: /\bthis\s+year\b/i, label: 'This Year' },
  { regex: /\blast\s+year\b/i, label: 'Last Year' },
  { regex: /\bthis\s+month\b/i, label: 'This Month' },
  { regex: /\blast\s+month\b/i, label: 'Last Month' },
  { regex: /\bthis\s+quarter\b/i, label: 'This Quarter' },
  { regex: /\blast\s+quarter\b/i, label: 'Last Quarter' },
  { regex: /\bytd\b/i, label: 'YTD' },
  { regex: /\bq1\b/i, label: 'Q1' },
  { regex: /\bq2\b/i, label: 'Q2' },
  { regex: /\bq3\b/i, label: 'Q3' },
  { regex: /\bq4\b/i, label: 'Q4' },
  { regex: /\blast\s+7\s+days?\b/i, label: 'Last 7 Days' },
  { regex: /\blast\s+30\s+days?\b/i, label: 'Last 30 Days' },
  { regex: /\blast\s+90\s+days?\b/i, label: 'Last 90 Days' },
  { regex: /\blast\s+week\b/i, label: 'Last 7 Days' },
];

const MONTH_NAMES = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

// Parse absolute month-year phrases that the LLM used to handle:
//   "march 2026", "march-2026", "Mar/2026", "2026-03", "03/2026", "2026/03"
// Returns { from: 'YYYY-MM-01', to: 'YYYY-MM-<lastday>' } or null.
function detectInlineMonthYear(message) {
  const monthAlt = Object.keys(MONTH_NAMES).join('|');
  const reNameYear = new RegExp(`\\b(${monthAlt})\\b[\\s\\-,/]+(\\d{4})\\b`, 'i');
  const reYearName = new RegExp(`\\b(\\d{4})[\\s\\-,/]+(${monthAlt})\\b`, 'i');
  const reYearMonth = /\b(\d{4})[\s\-/](\d{1,2})\b/;
  const reMonthYear = /\b(\d{1,2})[\s\-/](\d{4})\b/;

  let m = message.match(reNameYear);
  let year, mo;
  if (m) { mo = MONTH_NAMES[m[1].toLowerCase()]; year = Number(m[2]); }
  else if ((m = message.match(reYearName))) { year = Number(m[1]); mo = MONTH_NAMES[m[2].toLowerCase()]; }
  else if ((m = message.match(reYearMonth))) { year = Number(m[1]); mo = Number(m[2]); }
  else if ((m = message.match(reMonthYear))) { mo = Number(m[1]); year = Number(m[2]); }
  else return null;

  if (!mo || mo < 1 || mo > 12 || !year || year < 1900 || year > 2100) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(year, mo, 0).getDate();
  return { from: `${year}-${pad(mo)}-01`, to: `${year}-${pad(mo)}-${pad(lastDay)}` };
}

function detectInlinePeriod(message) {
  for (const { regex, label } of INLINE_PERIOD_PATTERNS) {
    if (regex.test(message)) {
      return periodHelper.resolveperiodLabel(label);
    }
  }
  // Absolute month-year — handles "march 2026", "march-2026", "2026-03" etc.
  const my = detectInlineMonthYear(message);
  if (my) return my;
  return null;
}

// Patterns that ALWAYS defer to LLM (too complex for regex)
const DEFER_PATTERNS = [
  /\b(email|mail|send\s+to)\b/i,
  /\bcompare\b/i,                              // all compare queries → LLM (handles 2-doc, 3+, periods)
  // Chart-of-account / mapping / configuration questions must reach the LLM
  // classifier so rule 14k routes them to general_question. Without this they
  // can match a cost_breakdown pattern via the category keyword ("lab fees")
  // and lose the mapping intent entirely.
  /\b(?:chart\s+of\s+account|coa|mapped\s+to|which\s+(?:xero|iplicit|chart\s+of\s+)?account|nominal\s+code|gl\s+code|account\s+code|expense\s+account\s+mapping|income\s+account\s+mapping|configured\s+account|account\s+configuration)\b/i,
  /\b(vs?|versus)\b/i,                         // "X vs Y" → LLM
  /(?:q[1-4]|this|last)\s+(?:vs?|versus)\s+/i, // multi-period "Q1 vs Q2"
  /\b(break\s*down|breakdown|drill|by\s+(?:month|provider|category|payor))\b/i,
  // Plan mix / payment-plan mix / payor mix — distinct concept from bare
  // "revenue" or "treatments". Defer so the LLM handles "plan mix" /
  // "plan mix by revenue" / "payment plan breakdown" consistently using the
  // same snapshot-grounded narrative. Without this, "plan mix by revenue"
  // matched the bare revenue rule and returned a provider revenue table.
  /\b(?:plan\s*mix|payment\s+plan\s+mix|payor\s*(?:mix|split)|payment\s+plan\s+(?:breakdown|split|share))\b/i,
  /\b(forecast|project|predict)\b.*\b(next|forward|future)\b/i,
  /@\w+.*\b(page|dashboard|profitability|cashflow|report)\b/i,
  /\byear\s+over\s+year\b|\byoy\b|\blast\s+year\b.*\bsame\b/i, // YoY queries → LLM
  // Specific month-year date specs ("dec 2025", "dec-2025", "december 2025",
  // "2025-12", "12/2025") — too varied for the inline regex catalogue, so let
  // the LLM convert them into period_from/period_to.
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b[\s\-,/]*\d{4}\b/i,
  /\b\d{4}[\s\-,/]+(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i,
  /\b\d{4}-\d{1,2}\b|\b\d{1,2}\/\d{4}\b|\b\d{4}\/\d{1,2}\b/,
  /\bof\s+(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)/i,
  // "P&L report" / "pl report" / "profit report" → generate_report tool, LLM.
  /\b(p\s*&\s*l|p&l|profit\s*(?:and|&)\s*loss|pl)\s+report\b/i,
  /\b(generate|download|export|pdf)\s+(report|p&l)/i,
];

// Sort-direction phrases. Used to flip top-N tables to bottom-N when the user
// asks about the "lowest"/"highest" performer.
const SORT_ASC_RE = /\b(lowest|least|bottom|smallest|worst|fewest|under-?performing|under\s+performing)\b/i;
const SORT_DESC_RE = /\b(highest|top|largest|biggest|best|leading)\b/i;

// Switches the treatment-revenue tool to dimension=treatment (per-treatment
// rows) instead of the default dimension=category. Five families of trigger:
//   1. "which/what/name/list/rank (the) treatment(s)"  — explicit row-pick form
//   2. "(top|best|highest|lowest|worst|most/least profitable|ranked|ranking)
//      treatment(s)" — ranking form, including "what ARE the top treatments" /
//      "show top treatments" / "ranked treatments" / "the most profitable
//      treatments"
//   3. "treatments rank(ed|ing)" / "treatments ordered/sorted" — the noun-first
//      phrasing users actually type ("treatments rank by revenue", "treatments
//      sorted by income"). Without this the bot defaulted to the category
//      breakdown despite the user literally asking about treatments.
//   4. "individual treatment(s)" / "treatment by treatment" / "per treatment"
//      — explicit per-treatment phrasing
//   5. "by treatment type" / "treatment type(s)" — matches the page's own
//      "Revenue by Treatment Type" chart heading; on the Private Treatment
//      page this means individual treatments, not categories.
const TREATMENT_DIM_RE = /\b(?:which|what|name(?:\s+the)?|list(?:\s+the)?|rank(?:\s+the)?|sort(?:\s+the)?|order(?:\s+the)?)\s+(?:the\s+)?(?:top\s+|bottom\s+|best\s+|worst\s+|highest\s+|lowest\s+|most\s+(?:profitable|popular|valuable)\s+|least\s+profitable\s+|leading\s+|biggest\s+|private\s+|nhs\s+|membership\s+)?treatments?\b|\b(?:top|bottom|best|worst|highest|lowest|most\s+profitable|least\s+profitable|leading|biggest|ranked|ranking)\s+(?:the\s+)?(?:private\s+|nhs\s+|membership\s+)?treatments?\b|\btreatments?\s+(?:rank(?:ed|ing)?|ordered|sorted|listed|listing)\b|\bindividual\s+treatments?\b|\btreatment\s+by\s+treatment\b|\bper\s+treatment\b|\bby\s+treatment\s+type|\btreatment\s+types?\b|\btreatment[\s-]?wise\b/i;

// Direct match patterns. ORDER MATTERS — earlier patterns win, so specialised
// intents (recommendations, attendance) must precede the bare financial rules
// to stop "give me a suggestion" or "DNA rate" getting force-fitted into a
// revenue table.
// Conversational BI trigger — the user explicitly wants a multi-widget
// dashboard / at-a-glance overview, not a single text answer. MUST be the
// first pattern AND a PRIORITY_INTENT so it wins even when defer words
// ("by location", "breakdown", "compare") also appear ("dashboard of revenue
// by location this month"). Requires an explicit dashboard/overview trigger
// so ordinary single-metric questions are NOT hijacked.
//
// "dashboard" is the single most-typed trigger word and users misspell it
// constantly (dashborad / dashbaord / dashbord / dashboad …). `dash\s?b[oar]{2,5}ds?`
// tolerates any transposition/omission of the "oard" tail (no real word
// starts "dashb…", so false positives are nil) — without it a single
// transposed letter silently reroutes the request to another tool.
const DASHBOARD_WORD = 'dash\\s?b[oar]{2,5}ds?';
const DASHBOARD_TRIGGER_RE = new RegExp(
  `\\b${DASHBOARD_WORD}\\b` +
  `|\\b(?:build|create|make|generate|put\\s+together|show\\s+me|give\\s+me|i\\s+want)\\b[\\s\\S]{0,30}\\b(?:${DASHBOARD_WORD}|overview|snapshot|at\\s+a\\s+glance)\\b` +
  `|\\bhow(?:['’]s|\\s+(?:is|are))\\s+(?:the\\s+)?(?:practice|business|clinic|we|things|everything|it\\s+all)\\b[\\s\\S]{0,12}\\bdoing\\b` +
  `|\\b(?:practice|business)\\s+(?:overview|snapshot|health\\s*check|pulse)\\b` +
  `|\\bvisuali[sz]e\\b`,
  'i',
);

// A "report"-style analytics ask → dashboard, e.g. "top 10 high earning
// treatment report", "monthly revenue report", "revenue report by location".
// Guarded so the existing report tools keep their phrases:
//   - excludes pdf / download / export / email / send / generate (→ PDF +
//     email report tools)
//   - excludes p&l / profit-and-loss (→ get_profit_and_loss)
// Requires an analytics noun so a bare "report" / "P&L report" doesn't match.
const REPORT_DASHBOARD_RE = /^(?=[\s\S]*\breport\b)(?![\s\S]*\b(?:pdf|download|export|e-?mail|email|send|mail|generate|p\s*&\s*l|p\s+and\s+l|profit\s+and\s+loss|p&l)\b)(?=[\s\S]*\b(?:revenue|income|sales|earnings?|earn|turnover|production|treatments?|patients?|performance|kpis?|metrics?)\b)/i;

// Profit / expense / EBITDA asked AS a dashboard. The v1 BI engine has no
// cost data, so "profitability dashboard" / "expenses dashboard" would fall
// to generate_dashboard and degrade to the "not available" note. Instead
// route to the existing audited P&L / EBITDA resolvers — already wrapped into
// the dashboard UI by resolvedAdapter (see DASHBOARD_ADAPT_TOOLS in
// v2Handler), so numbers stay reconciled with the Cost Impact / EBITDA pages.
// Lookahead form: needs BOTH a dashboard/overview trigger AND a profit/expense
// (or EBITDA) term, in any order. MUST precede the generate_dashboard entries
// in PATTERNS so the first-pass priority loop selects these first.
const DASH_CTX = `(?:\\b${DASHBOARD_WORD}\\b|\\b(?:overview|snapshot|at\\s+a\\s+glance)\\b)`;
const EBITDA_DASHBOARD_RE = new RegExp(
  `^(?=[\\s\\S]*${DASH_CTX})(?=[\\s\\S]*\\b(?:ebitda|enterprise\\s+value|practice\\s+(?:value|worth|valuation)|exit\\s+value)\\b)`,
  'i',
);
const PROFIT_DASHBOARD_RE = new RegExp(
  `^(?=[\\s\\S]*${DASH_CTX})(?=[\\s\\S]*\\b(?:p\\s*&\\s*l|p\\s*and\\s*l|profit\\w*|income\\s+statement|margins?|expenses?|expenditures?|overheads?|opex|cogs|cost\\s+breakdown|costs?)\\b)`,
  'i',
);
// Plan mix / payment-plan mix / payor split → get_plan_mix (DB-backed,
// mirrors the Treatment Insights Plan Mix card). Matches with OR without a
// "dashboard" trigger; works on any page (not snapshot-dependent).
const PLAN_MIX_RE = /\b(?:plan\s*mix|payment\s+plan\s+mix|payor\s*(?:mix|split)|payment\s+plan\s+(?:breakdown|split|share)|revenue\s+(?:distribution|split|breakdown)\s+by\s+(?:payment\s+)?plan|by\s+payment\s+plan)\b/i;
// NHS *contract performance* / UDA delivery → dedicated get_nhs_performance
// resolver (mirrors useNHSContractPerformance). Tight: contract/performance/
// delivery/UDA-target context required, so plain "NHS revenue" / "NHS
// treatment revenue" still routes to get_treatment_revenue (payor=nhs).
const NHS_PERF_RE = /\b(?:nhs\s+contract|nhs\s+performance|contract\s+performance|uda\s+(?:delivery|performance|target|contract|shortfall|remaining)|nhs\s+uda|uda\s+vs\s+target)\b/i;
// Membership *performance / per-plan* → dedicated get_membership_performance
// resolver (mirrors useMembershipPerformance for the reconcilable parts).
// Tight: must not steal "membership revenue" (→ get_treatment_revenue
// payor=membership) or "member count"/"active members" (→ get_financial_metric).
const MEMBERSHIP_PERF_RE = /\bmembership\s+(?:performance|plans?|mix|overview|dashboard|breakdown)\b|\bmembers?\s+(?:by|per)\s+plan\b/i;
// Chair/utilisation asked AS a dashboard → get_chair_metrics (mirrors
// Chairs.tsx). Needs BOTH a chair term AND a dashboard/overview trigger, so
// it only fixes the "dashboard"-word hijack and does NOT steal per-X ratios
// ("profit per chair hour") or advisory ("how can we optimise chair
// utilisation") — those keep flowing to the lower chair/ratio/defer rules.
// Treatment Profit Goals (actuals vs targets per treatment) → dedicated
// get_profit_goals resolver (mirrors TreatmentProfitGoals.tsx). Tight:
// excludes "profit planning by associates" (drift-prone, stays on-page) and
// does not collide with profitability/P&L (→ get_profit_and_loss).
const PROFIT_GOALS_RE = /\b(?:profit\s+goals?|treatment\s+(?:profit\s+)?goals?|goals?\s+(?:vs|versus)\s+actuals?|actuals?\s+vs\s+(?:target|goal)s?|targets?\s+vs\s+actuals?|treatment\s+targets?|profit\s+planning\s+by\s+treatment|goal\s+progress)\b/i;
const CHAIR_DASHBOARD_RE = new RegExp(
  `^(?=[\\s\\S]*\\b(?:chairs?|utili[sz]ation|occupancy|under[\\s-]?utili[sz]ed|over[\\s-]?utili[sz]ed|booked\\s+vs\\s+available)\\b)(?=[\\s\\S]*${DASH_CTX})`,
  'i',
);

const PATTERNS = [
  // Treatment Profit Goals (actual vs target per treatment) → dedicated DB
  // resolver. FIRST: it's the most specific intent — "profit goals dashboard"
  // must beat the generic profit/EBITDA-dashboard guards below (which match
  // bare "profit"+"dashboard"). The tight regex only matches genuine
  // goals/target phrasing, so profitability/P&L are unaffected.
  {
    regex: PROFIT_GOALS_RE,
    intent: { toolName: 'get_profit_goals', args: {} },
  },
  // Profit / expense / EBITDA asked as a dashboard → audited P&L/EBITDA
  // resolvers (rendered as a dashboard via resolvedAdapter). EBITDA first
  // (more specific); both MUST precede the generate_dashboard entries.
  {
    regex: EBITDA_DASHBOARD_RE,
    intent: { toolName: 'get_ebitda', args: {} },
  },
  {
    regex: PROFIT_DASHBOARD_RE,
    intent: { toolName: 'get_profit_and_loss', args: {} },
  },
  // Plan mix / payment-plan mix → the dedicated DB-backed resolver
  // (revenue by payment plan, mirrors the Treatment Insights "Plan Mix"
  // card). MUST precede the generate_dashboard entry: "plan mix dashboard"
  // would otherwise hijack to the BI engine, which has no plan concept and
  // degrades to a generic Practice-overview dashboard.
  {
    regex: PLAN_MIX_RE,
    intent: { toolName: 'get_plan_mix', args: {} },
  },
  // NHS contract / UDA performance → dedicated DB resolver (mirrors the
  // NHS Contract Performance page). Before generate_dashboard so "NHS
  // performance dashboard" isn't hijacked, and before the payor=nhs
  // treatment-revenue rule so contract/UDA questions get the right tool.
  {
    regex: NHS_PERF_RE,
    intent: { toolName: 'get_nhs_performance', args: {} },
  },
  // Membership performance / per-plan → dedicated DB resolver (mirrors the
  // Membership Performance page). Before generate_dashboard so "membership
  // dashboard" isn't hijacked; tight regex leaves "membership revenue" /
  // "member count" to their existing tools.
  {
    regex: MEMBERSHIP_PERF_RE,
    intent: { toolName: 'get_membership_performance', args: {} },
  },
  // Chair/utilisation + dashboard → the dedicated get_chair_metrics resolver
  // (mirrors Chairs.tsx). MUST precede generate_dashboard so "chairs
  // dashboard" / "chair utilisation dashboard" isn't hijacked to the generic
  // Practice-overview. Non-dashboard chair asks (incl. per-X ratios and
  // advisory) still flow to the lower chair/ratio/defer rules.
  {
    regex: CHAIR_DASHBOARD_RE,
    intent: { toolName: 'get_chair_metrics', args: {} },
  },
  // Conversational BI — generate a multi-widget dashboard.
  {
    regex: DASHBOARD_TRIGGER_RE,
    intent: { toolName: 'generate_dashboard', args: {} },
  },
  // "report"-style analytics ask (not a PDF/email/P&L report) → dashboard.
  {
    regex: REPORT_DASHBOARD_RE,
    intent: { toolName: 'generate_dashboard', args: {} },
  },
  // Page-grounded row-identification questions ("which treatments are
  // loss-making", "which providers are underperforming", "lowest margin",
  // "where are we losing money"). The answer requires reading the per-row
  // table on the current page and computing income − cost — a tool that
  // fetches a different metric (treatment revenue, profit-and-loss summary,
  // etc.) will return the wrong shape. Route to general_question so the
  // page snapshot + aiContext path handles it.
  // MUST come first so it beats: treatment revenue, profit-and-loss,
  // recommendations, list_providers, attendance.
  {
    regex: /\b(?:loss[\s-]?making|loss[\s-]?makers?|losing\s+money|unprofitable|negative\s+margin|below\s+break[\s-]?even|underwater|underperform(?:ing|er|ers)?|below\s+benchmark|above\s+benchmark|outperform(?:ing|er|ers)?|highest\s+margin|lowest\s+margin|worst\s+margin|best\s+margin|money\s+losers?|least\s+profitable|most\s+profitable|where\s+(?:are\s+we|am\s+i)\s+losing|which\s+(?:treatment|treatments|provider|providers|location|locations|categor(?:y|ies))\s+(?:is|are)\s+(?:losing|loss|unprofitable|underperform))\b/i,
    intent: { toolName: 'general_question', args: {} },
  },
  // Per-X derived/ratio metrics — "revenue per appointment", "revenue per
  // patient", "average revenue per visit", "profit per chair hour", etc.
  // The user wants a CALCULATED ratio (e.g. revenue ÷ completed appointments),
  // not the raw revenue table. Route to general_question — the snapshot-
  // grounded path + server-side provider-stats fallback computes the ratio
  // from the underlying data and explains the components. Without this rule
  // the bare revenue word would hijack the question into a generic provider
  // ranking that doesn't answer the ratio. MUST come BEFORE the bare revenue
  // rule.
  {
    regex: /\b(?:revenue|income|production|earnings|profit)\s+per\s+(?:\w+\s+){0,2}(?:appointment|appointments|visit|visits|patient|patients|booking|bookings|treatment|treatments|hour|hours|day|days|chair[\s-]?hour|chair[\s-]?day|surgery|chair)\b|\baverage\s+(?:revenue|income|profit|earnings)\s+per\s+(?:\w+\s+){0,2}(?:appointment|visit|patient|booking|treatment|hour|day)\b|\bper[\s-]?(?:appointment|visit|patient|booking|treatment|chair[\s-]?hour|chair[\s-]?day)\s+(?:revenue|income|profit|earnings)\b/i,
    intent: { toolName: 'general_question', args: {} },
  },
  // Plan mix / payment-plan mix / payor mix — how revenue splits across
  // payment plans. Routes to the DB-backed get_plan_mix resolver (mirrors
  // the Treatment Insights Plan Mix card; accurate on any page). The
  // top-of-PATTERNS priority entry normally catches these first; this
  // remains as the bare-revenue-rule precedence guard + second-pass match.
  {
    regex: PLAN_MIX_RE,
    intent: { toolName: 'get_plan_mix', args: {} },
  },
  // Chair / utilisation / occupancy combined with a by-location dimension —
  // "chair utilisation by location", "utilisation across sites", "occupancy
  // per practice". MUST come BEFORE the generic by-location rule below,
  // otherwise the user's chair-specific question routes to get_location_metrics
  // (which returns revenue/profit, not chair stats).
  {
    regex: /\b(?:chairs?|utili[sz]ation|utili[sz]ed|occupancy|booked\s+vs\s+available)\b[\s\S]{0,80}\b(?:by|across|per|for\s+each|each|every)\s+(?:all\s+|every\s+|the\s+)?(?:location|locations|site|sites|practice|practices)\b|\b(?:by|across|per|for\s+each|each|every)\s+(?:all\s+|every\s+|the\s+)?(?:location|locations|site|sites|practice|practices)\b[\s\S]{0,80}\b(?:chairs?|utili[sz]ation|utili[sz]ed|occupancy)\b/i,
    intent: { toolName: 'get_chair_metrics', args: {} },
  },
  // Cross-location aggregation: "X by location", "across locations",
  // "compare locations", "per location/site", "location breakdown".
  // MUST beat get_treatment_revenue (which only knows category/treatment
  // dimensions and would otherwise drop the location dimension on the floor)
  // and get_financial_metric (which returns a single total, no breakdown).
  // get_location_metrics returns per-location revenue/profit/AR/collection —
  // the right shape for "show me X by location".
  {
    regex: /\b(?:by\s+location|across\s+(?:all\s+)?(?:locations?|sites?|practices?)|per\s+(?:location|site|practice)|for\s+each\s+(?:location|site|practice)|location[\s-]+breakdown|site[\s-]+breakdown|location[\s-]+comparison|compare\s+(?:all\s+)?(?:locations?|sites?|practices?)|location[\s-]+wise|site[\s-]+wise|location[\s-]+by[\s-]+location|each\s+(?:location|site|practice)|every\s+(?:location|site|practice)|all\s+(?:locations?|sites?|practices?)\s+(?:overview|summary|performance|stats|comparison|breakdown|view|revenue|profit)|(?:show|list|display|give\s+me)\s+(?:me\s+)?(?:all\s+|every\s+)(?:locations?|sites?|practices?)\b|(?:locations?|sites?|practices?)\s+(?:overview|summary|performance|stats|comparison|breakdown|view))\b/i,
    intent: { toolName: 'get_location_metrics', args: {} },
  },
  // Entity-specific advisory: "how can I improve composite filling margin",
  // "how do we grow private revenue", "how to reduce lab costs at south
  // street". These are analyst-style questions about a specific metric or
  // entity — the user wants concrete advice grounded in the visible numbers,
  // not the generic recommendations engine (which falls back to a blank
  // "no active recommendations" reply when nothing is queued). Route to
  // general_question so the advisory LLM path uses the page snapshot to
  // produce prioritised, numbers-anchored actions. MUST come BEFORE the
  // get_recommendations rule below — both match the "how can/do I/we
  // improve" pattern, and the first match wins.
  {
    regex: /\b(?:how\s+(?:can|do|should|could)\s+(?:i|we|you)|how\s+to|how\s+might\s+(?:i|we))\s+(?:improve|grow|reduce|fix|cut|optimi[sz]e|increase|raise|boost|lower|maximi[sz]e|minimi[sz]e|drive)\b/i,
    intent: { toolName: 'general_question', args: {} },
  },
  // Suggestions / recommendations / insights — route to the dedicated
  // recommendations engine so generic asks like "what should I focus on" stop
  // returning a revenue table by default. The "how can/should/could we
  // improve" verb form is intentionally NOT in this regex any more — it's
  // handled by the entity-specific advisory rule above, which gives the
  // LLM-advisor a chance to read the page and answer with concrete advice.
  {
    regex: /\b(suggest(?:ion)?s?|recommend(?:ation)?s?|tip|tips|insight|insights|advise|advice|what\s+(?:should|can|could)\s+(?:i|we)\s+(?:focus|do|look)|any\s+ideas?|action\s+items?|ways?\s+to\s+(?:improve|grow|reduce|fix)|what\s+actions?)\b/i,
    intent: { toolName: 'get_recommendations', args: {} },
  },
  // DNA patient LIST — must come BEFORE the generic DNA metric pattern so
  // "list the DNA patients" / "show DNA patients" / "who didn't attend" /
  // "list this 35 patients who have did not attend" routes to the row-level
  // resolver instead of the count summary.
  //
  // Three alternatives covered:
  //   1. (verb) ... patient/booking/name ... (DNA term)
  //      → "list/show/give me ... patient(s) who did not attend"
  //   2. (DNA term) ... patient/appointment ... (list/detail/name/booked)
  //      → "DNA patients list", "DNA appointments detail"
  //   3. "who did(n't|not) attend"
  //      → bare row-level ask without an explicit verb
  {
    regex: /\b(?:list|show|names?|give\s+(?:me|us)|fetch|pull|get|display)\b[\s\S]{0,160}(?:\b(?:patient|booking|name)s?\b[\s\S]{0,160}\b(?:dnas?|did[\s-]?not[\s-]?attend|no[\s-]?show(?:s)?|missed)|\b(?:dnas?|did[\s-]?not[\s-]?attend|no[\s-]?show(?:s)?|missed)\b[\s\S]{0,160}\b(?:patient|booking|appointment|name)s?)\b|\b(?:dnas?|did[\s-]?not[\s-]?attend|no[\s-]?show)\b[\s\S]{0,80}\b(?:patient|appointment)s?\b[\s\S]{0,40}\b(?:list|detail|names?|booking|booked)\b|\bwho\s+(?:did(?:n[’']?t|\s+not)\s+attend|missed\s+(?:the\s+)?appointments?)\b/i,
    intent: { toolName: 'list_dna_patients', args: {} },
  },
  // Cancelled-appointment patient LIST — same shape as list_dna_patients.
  // Branches (any of):
  //   1. verb → patient/appointment → cancel term
  //   2. verb → cancel term → patient/appointment   (e.g. "show cancelled patients")
  //   3. cancel term → patient/appointment → list/detail/names/booking
  //   4. "who cancelled"
  {
    regex: /\b(?:list|show|names?|give\s+(?:me|us)|fetch|pull|get|display)\b[\s\S]{0,160}(?:\b(?:patient|appointment|booking|name)s?\b[\s\S]{0,160}\b(?:cancell?ed|cancell?ation)|\b(?:cancell?ed|cancell?ation)\b[\s\S]{0,160}\b(?:patient|appointment|booking|name)s?)\b|\b(?:cancell?ed|cancell?ation)s?\b[\s\S]{0,80}\b(?:patient|appointment)s?\b[\s\S]{0,40}\b(?:list|detail|names?|booking|booked)\b|\bwho\s+cancell?ed\b/i,
    intent: { toolName: 'list_cancelled_patients', args: {} },
  },
  // P&L / Profitability — full income statement vs prior period. Routed to
  // get_profit_and_loss so the user gets the comparison table rather than a
  // single-number profit metric or just an EBITDA snapshot.
  {
    regex: /\b(?:p\s*&\s*l|p\s*and\s*l|\bpl\b|profit\s*(?:and|&)\s*loss|profitability|income\s+statement|profit\s+margin\s+trend|how\s+is\s+profit(?:ability)?\s+doing|is\s+profit(?:ability)?\s+improving|profit\s+(?:comparison|vs))\b/i,
    intent: { toolName: 'get_profit_and_loss', args: {} },
  },
  // Provider roster — "list dentists / hygienists", "show top providers",
  // "provider directory". Routed to list_providers so the user gets every
  // active practitioner with appointment counts + revenue side-by-side.
  // Must come BEFORE the financial-metric / generic patterns so phrases
  // like "show all dentists" don't fall into the revenue path.
  //
  // Two guards:
  //   1. We DO NOT include bare "staff" or "team" in the noun list — those
  //      collide with "staff cost(s)" / "team performance" wrongly. The
  //      explicit role nouns (dentist/hygienist/therapist/practitioner/
  //      associate) plus "provider" cover the intended use case.
  //   2. Reject the pattern when the message ALSO contains a cost-category
  //      or revenue noun + dimension marker ("by/per/across") — e.g.
  //      "Show lab fees by provider" is a cost-breakdown query, not a
  //      provider list. Done via a separate negative pre-check below.
  {
    regex: /\b(?:list|show|names?|give\s+(?:me|us)|fetch|pull|get|display|rank|who\s+are)\b[\s\S]{0,80}\b(?:provider|providers|dentist|dentists|hygienist|hygienists|therapist|therapists|practitioner|practitioners|associate|associates|roster|directory|practitioner\s+history)\b|\b(?:provider|practitioner)\s+(?:directory|roster|list)\b|\b(?:top|bottom|all)\s+(?:provider|providers|dentists?|hygienists?|therapists?|practitioners?|associates?)\b/i,
    intent: { toolName: 'list_providers', args: {} },
  },
  // Transaction-level cost detail — "X transactions / invoices / bills /
  // supplier detail / lines / entries". Must come BEFORE the time-series
  // list_cost_entries pattern so phrases that include both ("daily lab
  // fee transactions") prefer the transaction view (richer per-row data).
  // Category-word matching tolerates singular/plural ("lab fee" vs "lab fees").
  {
    regex: /\b(?:labs?|lab\s*fees?|staff\s*costs?|wages?|salar(?:y|ies)|clinician\s*costs?|associates?|material\s*costs?|materials?|consumables?|operating\s*leases?|rent|overheads?|administrative|admin|cost\s*of\s*sales|cogs|costs?|expenses?)\b[\s\S]{0,80}\b(?:transactions?|invoices?|bills?|lines?|entries|suppliers?|vendors?|payees?|supplier\s+detail|vendor\s+detail|full\s+detail)\b|\b(?:transactions?|invoices?|bills?|suppliers?|vendors?|who\s+(?:did\s+)?we\s+pa(?:y|id))\b[\s\S]{0,80}\b(?:labs?|lab\s*fees?|staff\s*costs?|wages?|salar(?:y|ies)|clinician\s*costs?|associates?|material\s*costs?|materials?|consumables?|operating\s*leases?|rent|overheads?|administrative|admin|cost\s*of\s*sales|cogs|costs?|expenses?)\b/i,
    intent: { toolName: 'list_cost_transactions', args: {} },
  },
  // Time-series cost detail — "date wise X costs", "X by date/week/month",
  // "daily/weekly/monthly X". Routed to list_cost_entries so the user gets
  // the per-bucket trend (one row per day/week/month) instead of revenue or
  // a category snapshot. MUST come before any cost-aggregate pattern so the
  // time-bucket hint wins.
  {
    regex: /\b(?:date\s*wise|by\s*date|day\s*by\s*day|daily|per\s*day|week\s*wise|by\s*week|weekly|per\s*week|month\s*wise|by\s*month|monthly|per\s*month)\b[\s\S]{0,80}\b(?:cost|costs|expense|expenses|lab\s*fees|staff\s*costs?|wages?|salar(?:y|ies)|clinician\s*costs?|associates?|material\s*costs?|materials?|consumables?|operating\s*leases?|rent|overheads?|administrative|admin|cost\s*of\s*sales|cogs)\b|\b(?:lab\s*fees|staff\s*costs?|wages?|salar(?:y|ies)|clinician\s*costs?|associates?|material\s*costs?|materials?|consumables?|operating\s*leases?|rent|overheads?|administrative|admin|cost\s*of\s*sales|cogs|costs?|expenses?)\b[\s\S]{0,80}\b(?:date\s*wise|by\s*date|day\s*by\s*day|daily|per\s*day|week\s*wise|by\s*week|weekly|per\s*week|month\s*wise|by\s*month|monthly|per\s*month)\b/i,
    intent: { toolName: 'list_cost_entries', args: {} },
  },
  // Generic appointment list — completed / scheduled / "today's appointments" /
  // unspecified state. MUST come AFTER list_dna_patients and list_cancelled_patients
  // so those keep priority for their specific keywords. Branches:
  //   1. verb (list/show/etc) → state-keyword + appointment(s)
  //   2. verb (list/show/etc) → appointment(s) (no state, defaults to any)
  //   3. "today's appointments" / "this week's appointments" — implicit list
  {
    regex: /\b(?:list|show|names?|give\s+(?:me|us)|fetch|pull|get|display)\b[\s\S]{0,80}\b(?:completed|complete|arrived|attended|scheduled|booked|confirmed|upcoming)\b[\s\S]{0,80}\bappointments?\b|\b(?:list|show|names?|give\s+(?:me|us)|fetch|pull|get|display)\b[\s\S]{0,80}\bappointments?\b|\b(?:today|tomorrow|this\s+week|next\s+week)['’]?s?\s+appointments?\b/i,
    intent: { toolName: 'list_appointments', args: {} },
  },
  // Attendance / DNA / no-shows — until a proper attendance RPC ships, the
  // resolver returns a clear "not yet wired up" message instead of letting the
  // question fall through to revenue.
  {
    regex: /\b(dna|did[\s-]?not[\s-]?attend|no[\s-]?show(?:s)?|missed\s+appointments?|attendance\s+rate|cancell?ation\s+rate)\b/i,
    intent: { toolName: 'get_attendance_metric', args: {} },
  },
  // Treatment revenue — must come before the bare `revenue` rule so questions
  // like "which treatment has the lowest revenue" route here instead of to
  // the practice-wide provider list. Verb forms "earn|earns" included so
  // "which treatments earn the most" doesn't get hijacked by the bare
  // revenue rule (which would drop the per-treatment dimension).
  //
  // Three families:
  //   1. treatments + revenue word, or revenue word + treatments
  //   2. ranking word (top/best/highest/lowest/biggest/leading) + optional
  //      payor (private/nhs/membership) + treatments — even without an
  //      explicit revenue word, "top private treatments" is unambiguously
  //      a treatment-revenue ranking question
  //   3. "treatments + by category/treatment/payor" — dimension queries
  {
    regex: /\btreatments?\b.*?\b(revenue|income|earnings|earns?|production|turnover)\b|\b(revenue|income|earnings|earns?|production|turnover)\b.*?\btreatments?\b|\b(?:top|bottom|best|worst|highest|lowest|biggest|leading)\s+(?:\d+\s+)?(?:private|nhs|membership)?\s*treatments?\b|\btreatments?\s+by\s+(?:category|treatment|payor)\b/i,
    intent: { toolName: 'get_treatment_revenue', args: {} },
  },
  // Profit — MUST come before the Revenue rule because "net income" / "net
  // profit" both contain "income" which would otherwise win for Revenue and
  // return the wrong metric.
  {
    regex: /\b(profit|p&l|p\s*&\s*l|profit\s*(?:and|&)\s*loss|margin|net\s*income|net\s*profit)\b/i,
    intent: { toolName: 'get_financial_metric', args: { metric: 'profit' } },
  },
  // Revenue
  {
    regex: /\b(revenue|income|production|turnover|earnings|earn|earns)\b/i,
    intent: { toolName: 'get_financial_metric', args: { metric: 'revenue' } },
  },
  // Cash balance — must come before the bare cashflow rule so "closing
  // balance"/"cash position" routes to the focused balance card instead of
  // the Received/Paid/Net overview.
  {
    regex: /\b(closing|opening|ending|cash|bank)\s+balance\b|\bcash\s+position\b|\bcash\s+on\s+hand\b/i,
    intent: { toolName: 'get_cashflow_data', args: { metric: 'balance' } },
  },
  // Cashflow — match the various ways users phrase it: bare "cashflow",
  // "cash flow", "cash in/out" (two-word), and the compound forms "cash
  // inflow(s)" / "cash outflow(s)" / "cash movement(s)" / "net cash" that
  // didn't match the earlier two-word-only pattern.
  {
    regex: /\b(cash\s*flow|cashflow|cash\s+in|cash\s+out|cash\s+(?:in|out)flows?|cash\s+movements?|net\s+cash|cash\s+received|cash\s+paid)\b/i,
    intent: { toolName: 'get_cashflow_data', args: {} },
  },
  // Patients / members — extends to "active members", "how many members"
  // for membership-plan pages where the natural noun is "member" not "patient".
  {
    regex: /\b(patient\s*count|active\s*patients?|how\s+many\s+patients?|patient\s+volume|active\s*members?|how\s+many\s+(?:active\s+)?members?|member\s*count|member\s+volume)\b/i,
    intent: { toolName: 'get_financial_metric', args: { metric: 'patients' } },
  },
  // Chair utilisation — match underutilised/overutilised variants too.
  {
    regex: /\b(chairs?|utilisation|utilization|occupancy|under[\s-]?utili[sz]ed|over[\s-]?utili[sz]ed|under[\s-]?occupied|booked\s+vs\s+available)\b/i,
    intent: { toolName: 'get_chair_metrics', args: {} },
  },
  // Cost / expenses — patterns must match BOTH singular ("cost") and plural
  // ("costs") forms. Older patterns used \bcost\b which excludes "costs"
  // (the word boundary requires a non-word char after, but "s" is a word
  // char). Plural form is far more natural in English — "material costs",
  // "staff costs", "what were the overheads" — so the previous regex made
  // most cost questions fall through to the LLM classifier, which then
  // mis-routed them (e.g. to profit). Each cost category is wired explicitly
  // so the resolver can filter by the right bucket.
  {
    regex: /\b(lab\s+fees?|lab\s+costs?|laboratory\s+(?:fees?|costs?))\b/i,
    intent: { toolName: 'get_cost_breakdown', args: { category: 'lab' } },
  },
  {
    regex: /\b(staff\s+costs?|wages?|salar(?:y|ies)|payroll)\b/i,
    intent: { toolName: 'get_cost_breakdown', args: { category: 'staff' } },
  },
  {
    regex: /\b(material\s+costs?|materials?|consumables?)\b/i,
    intent: { toolName: 'get_cost_breakdown', args: { category: 'material' } },
  },
  {
    regex: /\b(clinician\s+costs?|associate\s+(?:costs?|pay)|practitioner\s+(?:costs?|pay))\b/i,
    intent: { toolName: 'get_cost_breakdown', args: { category: 'clinician' } },
  },
  {
    regex: /\b(operating\s+leases?|rent|rental\s+costs?|lease\s+costs?)\b/i,
    intent: { toolName: 'get_cost_breakdown', args: { category: 'lease' } },
  },
  {
    regex: /\b(overheads?|overhead\s+costs?|administrative\s+costs?|admin\s+costs?)\b/i,
    intent: { toolName: 'get_cost_breakdown', args: { category: 'overhead' } },
  },
  // Catch-all for generic cost questions — must come LAST in this group so
  // category-specific patterns above win. Matches both "cost" and "costs",
  // plus the umbrella synonyms.
  {
    regex: /\b(costs?|expenses?|spending|outgoings?|expenditures?)\b/i,
    intent: { toolName: 'get_cost_breakdown', args: { category: 'all' } },
  },
  // NHS / treatments
  {
    regex: /\b(uda|nhs\s+contract|nhs\s+band)\b/i,
    intent: { toolName: 'get_treatment_revenue', args: { payor: 'nhs' } },
  },
  {
    regex: /\b(treatment\s+revenue|treatment\s+income)\b/i,
    intent: { toolName: 'get_treatment_revenue', args: {} },
  },
  // Location
  {
    regex: /\b(location|site|practice)\s+(performance|metric|revenue|profit)\b/i,
    intent: { toolName: 'get_location_metrics', args: {} },
  },
  // EBITDA
  {
    regex: /\b(ebitda|enterprise\s+value|valuat(?:e|ion)|practice\s+(?:value|worth|valuation)|exit\s+value|what\s+(?:is|s)\s+(?:my|the|our)\s+practice\s+worth|ebitda\s+(?:margin|bridge|breakdown|stack))\b/i,
    intent: { toolName: 'get_ebitda', args: {} },
  },
  // Greeting / general
  {
    regex: /^(hi|hello|hey|good\s+(?:morning|afternoon|evening))\b/i,
    intent: { toolName: 'general_question', args: {} },
  },
];

// Intents that are specific enough that we should keep the local match even
// if a DEFER_PATTERN also fires (e.g. month-year date phrase). Inline period
// detection now handles month-year, so deferring to the LLM for date parsing
// is no longer required — and the LLM has been observed misrouting these.
const PRIORITY_INTENTS = new Set([
  // Dashboard request wins over defer words (by-X / breakdown / compare) so
  // "dashboard of revenue by location" isn't deferred or mis-routed.
  'generate_dashboard',
  'list_dna_patients',
  'list_cancelled_patients',
  'list_appointments',
  'list_cost_entries',
  'list_cost_transactions',
  'get_ebitda',
  'list_providers',
  'get_profit_and_loss',
  // Plan mix → dedicated DB resolver; priority so "plan mix dashboard" /
  // "payment plan breakdown" win over generate_dashboard + defer words.
  'get_plan_mix',
  // NHS contract/UDA performance → dedicated resolver; priority so it wins
  // over generate_dashboard + the payor=nhs treatment-revenue rule.
  'get_nhs_performance',
  // Membership performance → dedicated resolver; priority so it wins over
  // generate_dashboard + the payor=membership treatment-revenue rule.
  'get_membership_performance',
  // Treatment Profit Goals → dedicated resolver; priority so "profit goals
  // dashboard" / "actual vs target" win over generate_dashboard + defer words.
  'get_profit_goals',
  // Added so these route correctly even when DEFER_PATTERNS (compare/
  // breakdown/by-X/vs) also matches. Without priority, "Compare locations by
  // revenue" and "Per location breakdown" defer to the LLM and get mis-routed.
  'get_location_metrics',
  // get_cost_breakdown so "material costs breakdown" / "compare lab costs"
  // routes correctly even with the defer word.
  'get_cost_breakdown',
  // get_treatment_revenue so "Treatment revenue breakdown" stays here, not
  // deferred to the LLM (which then mis-handles the "breakdown" word).
  'get_treatment_revenue',
  // general_question — for the loss-making / margin / row-identification
  // pattern, and greetings. Beats defer for any of these.
  'general_question',
  // get_chair_metrics so "Compare booked vs available hours" /
  // "Chair utilisation by month" don't lose their tool routing to the
  // "compare" / "by-X" defer patterns.
  'get_chair_metrics',
]);

// Map free-text cost category to the canonical arg sent to list_cost_entries.
const COST_CATEGORY_KEYWORDS = [
  { re: /\blab\s*fees?\b|\blab\b/i,                          category: 'lab_fees' },
  { re: /\bstaff\s*(?:costs?|wages?|salar(?:y|ies))\b|\bwages?\b|\bsalar(?:y|ies)\b/i, category: 'staff_costs' },
  { re: /\bclinician\s*costs?\b|\bassociates?\b/i,           category: 'clinician_costs' },
  { re: /\bmaterial\s*costs?\b|\bmaterials?\b|\bconsumables?\b/i, category: 'material_costs' },
  { re: /\boperating\s*leases?\b|\brent\b/i,                 category: 'operating_leases' },
  { re: /\boverheads?\b/i,                                   category: 'overheads' },
  { re: /\badmin(?:istrative)?\s*costs?\b/i,                 category: 'administrative_costs' },
  { re: /\bcost\s*of\s*sales\b|\bcogs\b/i,                   category: 'cost_of_sales' },
  { re: /\bcosts?\b|\bexpenses?\b/i,                         category: 'all' }, // last resort
];

const TIME_BUCKET_KEYWORDS = [
  { re: /\b(?:date\s*wise|by\s*date|day\s*by\s*day|daily|per\s*day|by\s*day)\b/i, group: 'day' },
  { re: /\b(?:week\s*wise|by\s*week|weekly|per\s*week)\b/i,                       group: 'week' },
  { re: /\b(?:month\s*wise|by\s*month|monthly|per\s*month)\b/i,                   group: 'month' },
];

function detectCostCategory(text) {
  for (const k of COST_CATEGORY_KEYWORDS) if (k.re.test(text)) return k.category;
  return null;
}
function detectTimeBucket(text) {
  for (const k of TIME_BUCKET_KEYWORDS) if (k.re.test(text)) return k.group;
  return null;
}

// Map free-text state words → canonical state arg for list_appointments.
const APPT_STATE_KEYWORDS = [
  { re: /\b(completed|complete|arrived|attended)\b/i, state: 'completed' },
  { re: /\b(scheduled|booked|confirmed|upcoming)\b/i, state: 'scheduled' },
  { re: /\b(dna|did[\s-]?not[\s-]?attend|no[\s-]?show(?:s)?|missed)\b/i, state: 'dna' },
  { re: /\b(cancell?ed|cancell?ation)\b/i, state: 'cancelled' },
];

function detectApptState(message) {
  for (const { re, state } of APPT_STATE_KEYWORDS) {
    if (re.test(message)) return state;
  }
  return null;
}

function classify(message, context, mentions) {
  // Multiple @-provider mentions → defer
  if (mentions.providers.length >= 2) return null;

  // Multiple @-period mentions → defer
  if (mentions.periods.length >= 2) return null;

  // Hard-defer for mapping/CoA questions BEFORE any priority pass. These
  // contain category keywords ("lab fees", "staff costs") that would otherwise
  // hijack the question into a cost-breakdown match. The LLM classifier
  // (rule 14k) handles these correctly by routing to general_question, which
  // then uses the structured pageContext / loadMappingReference to answer.
  const MAPPING_HARD_DEFER = /\b(?:chart\s+of\s+accounts?|coa|mapped\s+to|which\s+(?:xero|iplicit|chart\s+of\s+)?account|nominal\s+code|gl\s+code|account\s+code|expense\s+account\s+mapping|income\s+account\s+mapping|configured\s+account|account\s+configuration|what'?s\s+mapped)\b/i;
  if (MAPPING_HARD_DEFER.test(message)) return null;

  // Hard-defer when the user explicitly references the CURRENT PAGE
  // ("this page", "on this page", "shown above", "what's displayed").
  // These questions are answered best from the page snapshot + aiContext —
  // not by re-running a DB tool that uses defaults. Route to LLM →
  // general_question. Catches cases like:
  //   "Private Treatment this page total revenue of this month?"
  //   "What does this page show?"
  //   "What's the total on this page?"
  const PAGE_REFERENCE_DEFER = /\b(?:this\s+page|on\s+this\s+page|on\s+the\s+page|shown\s+(?:on|above|here)|displayed\s+(?:on|above|here)|visible\s+(?:on|above|here)|currently\s+(?:showing|displayed)|current\s+page|the\s+page['’]?s|page\s+total|page\s+shows?|what'?s?\s+(?:on|shown|displayed|here))\b/i;
  if (PAGE_REFERENCE_DEFER.test(message)) return null;

  // Hard-defer for compound NON-TIME-BUCKET cost-dimension queries like
  // "Show lab fees by provider", "Staff cost by location". No local tool
  // handles a cost × entity-dimension breakdown cleanly — let the LLM
  // classifier pick between get_cost_breakdown / list_cost_transactions
  // / get_location_metrics with full context.
  // EXCLUDES time-bucket dimensions (day/week/month/quarter/year) so
  // "Material costs by month" still routes to list_cost_entries with
  // group_by=month (it handles that natively).
  const COST_DIMENSION_DEFER = /\b(?:lab\s*fees?|staff\s*costs?|wages?|salar(?:y|ies)|clinician\s*costs?|associate\s+pay|material\s*costs?|operating\s*leases?|rent|overheads?|administrative\s*costs?|admin\s*costs?|cost\s*of\s*sales|cogs)\b[\s\S]{0,40}\b(?:by|per|across)\s+(?:provider|providers|dentist|dentists|hygienist|hygienists|therapist|therapists|practitioner|practitioners|associate|associates|location|locations|site|sites|practice|practices|category|categor(?:y|ies)|payor|payors|treatment|treatments)\b/i;
  if (COST_DIMENSION_DEFER.test(message)) return null;

  // First pass: priority intents win even if a DEFER_PATTERN also matches.
  for (const { regex, intent } of PATTERNS) {
    if (PRIORITY_INTENTS.has(intent.toolName) && regex.test(message)) {
      const result = {
        toolName: intent.toolName,
        args: { ...intent.args },
        classifiedBy: 'local',
      };
      if (mentions.providers.length === 1) result.args.doctor_name = mentions.providers[0];
      // The BI orchestrator parses the question itself (KPI + dimension), so
      // hand it the raw text.
      if (intent.toolName === 'generate_dashboard') result.args._question = message;
      // For the generic appointment list, also stamp the state arg so the
      // resolver doesn't have to re-parse it.
      if (intent.toolName === 'list_appointments') {
        const s = detectApptState(message);
        if (s) result.args.state = s;
      }
      // For the time-series cost list, stamp category + group_by inferred
      // from the same message so the resolver has everything it needs.
      if (intent.toolName === 'list_cost_entries') {
        const c = detectCostCategory(message);
        if (c) result.args.category = c;
        const g = detectTimeBucket(message);
        if (g) result.args.group_by = g;
      }
      // For the transaction-level cost list, stamp the category.
      if (intent.toolName === 'list_cost_transactions') {
        const c = detectCostCategory(message);
        if (c) result.args.category = c;
      }
      // For the provider roster, stamp the type ("dentist" / "hygienist" /
      // "therapist") so the resolver filters down to that role.
      if (intent.toolName === 'list_providers') {
        const lower = message.toLowerCase();
        if (/\bhyg(?:i?e?nists?|enists?|ien(?:e|ist)|enic?)\b/i.test(lower))      result.args.provider_type = 'Hygienist';
        else if (/\btherap?ists?\b/i.test(lower))                                 result.args.provider_type = 'Therapist';
        else if (/\b(?:dent[ia]?sts?|associates?)\b/i.test(lower))               result.args.provider_type = 'Dentist';
      }
      // For treatment revenue, stamp dimension + payor here in Pass 1 as
      // well (Pass 2 has the same stamping, but priority returns before it).
      // Without this, "What are the top private treatments?" routed but
      // returned the default category breakdown instead of per-treatment +
      // payor-filtered.
      if (intent.toolName === 'get_treatment_revenue') {
        if (TREATMENT_DIM_RE.test(message)) result.args.dimension = 'treatment';
        if (!result.args.payor) {
          if (/\bprivate\b/i.test(message))                result.args.payor = 'private';
          else if (/\bnhs\b/i.test(message))               result.args.payor = 'nhs';
          else if (/\bmembership|members?\b/i.test(message)) result.args.payor = 'membership';
        }
        if (SORT_ASC_RE.test(message)) result.args.sort = 'asc';
        else if (SORT_DESC_RE.test(message)) result.args.sort = 'desc';
      }
      return result;
    }
  }

  // Check if message should defer to LLM
  for (const pattern of DEFER_PATTERNS) {
    if (pattern.test(message)) return null;
  }

  // Try direct match patterns
  for (const { regex, intent } of PATTERNS) {
    if (regex.test(message)) {
      const result = {
        toolName: intent.toolName,
        args: { ...intent.args },
        classifiedBy: 'local',
      };

      // If single provider mentioned, add to args
      if (mentions.providers.length === 1) {
        result.args.doctor_name = mentions.providers[0];
      }

      // BI orchestrator needs the raw question text to pick KPI + dimension.
      if (result.toolName === 'generate_dashboard') {
        result.args._question = message;
      }

      // If single @-period mentioned, resolve it
      if (mentions.periods.length === 1) {
        const period = periodHelper.resolveperiodLabel(mentions.periods[0]);
        if (period) {
          result.args.period_from = period.from;
          result.args.period_to = period.to;
        }
      }

      // If no @-period but message contains a known period phrase, resolve it
      if (!result.args.period_from) {
        const detected = detectInlinePeriod(message);
        if (detected) {
          result.args.period_from = detected.from;
          result.args.period_to = detected.to;
        }
      }

      // Sort direction — applies to ranked tables (treatment revenue, provider
      // revenue/profit). "lowest" wins over "highest" if both appear because
      // the question word usually carries the user's intent.
      if (
        result.toolName === 'get_treatment_revenue' ||
        result.toolName === 'get_financial_metric'
      ) {
        if (SORT_ASC_RE.test(message)) result.args.sort = 'asc';
        else if (SORT_DESC_RE.test(message)) result.args.sort = 'desc';
      }

      // For treatment-revenue, choose between category (default) and
      // individual-treatment rollup based on the user's wording.
      if (result.toolName === 'get_treatment_revenue' && TREATMENT_DIM_RE.test(message)) {
        result.args.dimension = 'treatment';
      }
      // Payor filter: detect "private", "NHS", "membership" in the question
      // so the bot returns only that subset. Without this, asking on the
      // Private Treatment page "what are the top private treatments?"
      // returns a MIXED-payor breakdown (NHS + private + membership all
      // collapsed). Only stamps when the payor word is unambiguous and not
      // already set. Applies to both treatment_revenue and the bare
      // financial_metric=revenue path ("private revenue this month?").
      const payorAware = result.toolName === 'get_treatment_revenue'
        || (result.toolName === 'get_financial_metric' && result.args.metric === 'revenue');
      if (payorAware && !result.args.payor) {
        if (/\bprivate\b/i.test(message))          result.args.payor = 'private';
        else if (/\bnhs\b/i.test(message))         result.args.payor = 'nhs';
        else if (/\bmembership|member\b/i.test(message)) result.args.payor = 'membership';
      }

      return result;
    }
  }

  // No match — defer to LLM
  return null;
}

module.exports = { classify, detectInlinePeriod };
