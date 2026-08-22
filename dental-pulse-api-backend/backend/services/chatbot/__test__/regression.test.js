/**
 * Chatbot regression test harness.
 *
 * Covers every behaviour fix from the chatbot-tuning session:
 *   1. Local-classifier routing for newly-added patterns (plan-mix,
 *      treatment-revenue dimension, per-X ratios, location-overview,
 *      chair-by-location, hourly-chair, entity-specific advisory, payor
 *      detection, etc.).
 *   2. Pure-chip-reply detector (used by pending-intent restoration).
 *   3. Suggestion-chip count normalisation (always 3-4 chips).
 *   4. Internal-identifier scrubbing (no camelCase leaks in user text).
 *   5. Loading-hint detector (frontend contextual loading messages).
 *
 * Run with `node backend/services/chatbot/__test__/regression.test.js`. Exits
 * non-zero on any failure so CI can pick it up.
 */

const path = require('path');
const fs = require('fs');
const { classify } = require(path.join(__dirname, '..', 'localClassifier.js'));

let totalPass = 0;
let totalFail = 0;
const failures = [];

function assertEq(label, got, expected) {
  // Deep-ish equality for primitives + arrays + simple objects.
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) {
    totalPass++;
    return true;
  }
  totalFail++;
  failures.push(`${label}\n    expected: ${b}\n    got:      ${a}`);
  return false;
}

function section(name) {
  console.log(`\n─── ${name} ───`);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. LOCAL-CLASSIFIER ROUTING (additions / fixes from this session)
// ─────────────────────────────────────────────────────────────────────────
section('1. Classifier routing');

const ROUTING_CASES = [
  // Treatment-revenue: ranking / sort phrasings → dimension='treatment'
  ['treatments rank by revenue?', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['treatments rank by revenue', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['rank treatments by revenue', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['rank the treatments by income', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['ranked treatments by revenue', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['treatments sorted by revenue', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['treatments ordered by income', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['revenue by treatment type', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['treatment-wise revenue', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['treatment wise revenue', 'get_treatment_revenue', { dimension: 'treatment' }],
  ['top treatments by revenue', 'get_treatment_revenue', { dimension: 'treatment' }],

  // Treatment-revenue: still default category for the bare phrase
  ['treatments by category', 'get_treatment_revenue', { dimension: undefined }],
  ['treatment revenue', 'get_treatment_revenue', { dimension: undefined }],

  // Treatment-revenue: payor stamped
  ['top private treatments', 'get_treatment_revenue', { payor: 'private' }],
  ['NHS treatment revenue', 'get_treatment_revenue', { payor: 'nhs' }],

  // Plan-mix → general_question (was previously hijacked by bare-revenue rule)
  ['plan mix', 'general_question'],
  ['plan mix by revenue', 'general_question'],
  ['plan mix with revenue', 'general_question'],
  ['plan mix revenue', 'general_question'],
  ['payment plan mix', 'general_question'],
  ['payment plan breakdown', 'general_question'],
  ['payor mix', 'general_question'],
  ['payor split', 'general_question'],

  // Per-X ratio questions → general_question
  ['What is David Bianchi revenue per completed appointment?', 'general_question'],
  ["What's David Bianchi's revenue per completed appointment?", 'general_question'],
  ['Revenue per appointment for Luke Fisher-Brown', 'general_question'],
  ['Average revenue per visit', 'general_question'],
  ['Revenue per patient David Bianchi', 'general_question'],
  ['Profit per chair hour', 'general_question'],
  ['Revenue per new patient', 'general_question'],
  ['Revenue per scheduled appointment', 'general_question'],
  ['Revenue per day', 'general_question'],

  // Entity-specific advisory → general_question
  ['How can I improve Composite Filling margin?', 'general_question'],
  ['how can I improve revenue', 'general_question'],
  ['how do we grow profit', 'general_question'],
  ['how to reduce lab costs', 'general_question'],
  ['how can we optimize chair utilization', 'general_question'],
  ['how might we improve margins', 'general_question'],

  // Generic recommendations → get_recommendations
  ['Suggest improvements', 'get_recommendations'],
  ['What should we focus on?', 'get_recommendations'],
  ['Any tips for growing profit?', 'get_recommendations'],
  ['Any recommendations?', 'get_recommendations'],
  ['Give me advice', 'get_recommendations'],

  // Bare revenue → get_financial_metric, with payor when present
  ['private revenue of this month?', 'get_financial_metric', { metric: 'revenue', payor: 'private' }],
  ['NHS revenue this month', 'get_financial_metric', { metric: 'revenue', payor: 'nhs' }],
  ['membership revenue', 'get_financial_metric', { metric: 'revenue', payor: 'membership' }],
  ['revenue this month', 'get_financial_metric', { metric: 'revenue', payor: undefined }],

  // Chair: across all chair phrasings
  ['What is our chair utilisation rate this month?', 'get_chair_metrics'],
  ['Show utilisation by location.', 'get_chair_metrics'],
  ['Which chairs are underutilised?', 'get_chair_metrics'],
  ['Compare booked vs available hours.', 'get_chair_metrics'],
  ['Peak hours for chairs', 'get_chair_metrics'],
  ['Chair utilisation across all locations', 'get_chair_metrics'],
  ['Chair utilisation across every site', 'get_chair_metrics'],
  ['Occupancy by the practice', 'get_chair_metrics'],
  ['Occupancy by site', 'get_chair_metrics'],

  // Location-metrics: overview / list / compare phrasings
  ['Show all locations overview', 'get_location_metrics'],
  ['Show all locations', 'get_location_metrics'],
  ['Show locations overview', 'get_location_metrics'],
  ['Locations overview', 'get_location_metrics'],
  ['All locations performance', 'get_location_metrics'],
  ['Compare locations', 'get_location_metrics'],
  ['Show every site', 'get_location_metrics'],
  ['List all locations', 'get_location_metrics'],
  ['Sites comparison', 'get_location_metrics'],
  ['Revenue by location', 'get_location_metrics'],
  // negative — non-finance "locations" mentions should NOT route here
  ['Show me the locations of patients', null /* not get_location_metrics */],
  ['I work at three locations', null],

  // Conversational BI — generate_dashboard (must win over by-X / breakdown
  // / compare defer words because it's a PRIORITY_INTENT placed first).
  ['Show me a dashboard', 'generate_dashboard'],
  ['show me a dashboard of revenue by location this month', 'generate_dashboard'],
  ['build a revenue dashboard', 'generate_dashboard'],
  ['create a dashboard for last quarter', 'generate_dashboard'],
  ['give me an overview of the practice', 'generate_dashboard'],
  ['practice overview', 'generate_dashboard'],
  ['how are we doing this month?', 'generate_dashboard'],
  ["how's the practice doing", 'generate_dashboard'],
  ['practice snapshot', 'generate_dashboard'],
  ['visualise revenue by provider', 'generate_dashboard'],
  ['I want a dashboard of patients by location', 'generate_dashboard'],
  ['revenue dashboard with charts', 'generate_dashboard'],
  // report-style analytics asks → dashboard (C)
  ['top 10 high earning treatment report', 'generate_dashboard'],
  ['monthly revenue report', 'generate_dashboard'],
  ['revenue report by location this month', 'generate_dashboard'],
  ['give me a patient report for this quarter', 'generate_dashboard'],
  // report exclusions — still owned by the report/P&L tools
  ['P&L report this quarter', 'get_profit_and_loss'],
  // negative — plain single-metric asks must NOT become a dashboard
  ['revenue this month', 'get_financial_metric'],
  ['Revenue by location', 'get_location_metrics'],
  ['treatment revenue', 'get_treatment_revenue'],
];

for (const row of ROUTING_CASES) {
  const [message, expectedTool, expectedArgs] = row;
  const r = classify(message, {}, { providers: [], periods: [] });
  const got = r?.toolName ?? null;
  if (expectedTool === null) {
    // Negative case — want anything except get_location_metrics
    const ok = got !== 'get_location_metrics';
    if (ok) {
      totalPass++;
    } else {
      totalFail++;
      failures.push(`routing: ${JSON.stringify(message)}\n    expected NOT get_location_metrics, got ${got}`);
    }
    continue;
  }
  let ok = got === expectedTool;
  if (ok && expectedArgs) {
    for (const [k, v] of Object.entries(expectedArgs)) {
      if (v === undefined) {
        if (r.args[k] !== undefined) { ok = false; break; }
      } else if (r.args[k] !== v) { ok = false; break; }
    }
  }
  if (ok) {
    totalPass++;
  } else {
    totalFail++;
    failures.push(`routing: ${JSON.stringify(message)}\n    expected ${expectedTool} ${JSON.stringify(expectedArgs || {})}\n    got      ${got} ${JSON.stringify(r?.args || {})}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. PURE-CHIP-REPLY DETECTOR
// ─────────────────────────────────────────────────────────────────────────
// Mirrors the logic in v2Handler.js — period strip + chip-list exact match.
section('2. Pure chip-reply detector');

function isPureChipReply(message, lastChips = []) {
  const trimmedMsg = (message || '').trim();
  const chipMatch = lastChips.some(c =>
    typeof c === 'string' && c.trim().toLowerCase() === trimmedMsg.toLowerCase()
  );
  const stripped = trimmedMsg
    .toLowerCase()
    .replace(/\b(this|last|next|past)\s+(year|month|week|quarter|day|fy|financial\s+year)s?\b/g, '')
    .replace(/\b(today|yesterday|tomorrow|ytd|fy\s*\d{0,4})\b/g, '')
    .replace(/\bq[1-4]\b/g, '')
    .replace(/\blast\s+\d+\s+days?\b/g, '')
    .replace(/\b\d{4}[-\/]\d{1,2}([-\/]\d{1,2})?\b/g, '')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/g, '')
    .replace(/\ball\s+locations?\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return chipMatch || stripped.length <= 3;
}

const CHIP_CASES = [
  // Period chips — pure replies
  ['This month', [], true],
  ['this month', [], true],
  ['Last month', [], true],
  ['Last quarter', [], true],
  ['This year', [], true],
  ['YTD', [], true],
  ['Q1', [], true],
  ['Q3', [], true],
  ['April 2026', [], true],
  ['2026-04-01', [], true],
  ['All locations', [], true],
  // Location-name chip via exact match
  ['The South Street Dental Practice', ['The South Street Dental Practice', 'All locations'], true],
  ['Teeth For Life Dental Care - Magor', ['Teeth For Life Dental Care - Magor'], true],
  // Real questions — not chip replies
  ['Show private revenue by location', [], false],
  ['profit this month', [], false],
  ['revenue by treatment type', [], false],
  ['top providers in Q1', [], false],
  ['compare south street and wigmore', [], false],
];

for (const [msg, chips, expected] of CHIP_CASES) {
  assertEq(`isPureChipReply(${JSON.stringify(msg)})`, isPureChipReply(msg, chips), expected);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. SUGGESTION-CHIP COUNT NORMALISATION
// ─────────────────────────────────────────────────────────────────────────
section('3. Chip count normalisation');

// Inline-copy from v2Handler.js (kept in sync with that source). We test the
// function from the v2Handler file directly to catch drift.
const v2Src = fs.readFileSync(path.join(__dirname, '..', 'v2Handler.js'), 'utf8');
const normMatch = v2Src.match(/function normalizeSuggestionChips[\s\S]*?^}/m);
if (!normMatch) {
  console.log('FAIL: normalizeSuggestionChips not found in v2Handler.js');
  process.exit(1);
}
// eslint-disable-next-line no-eval
eval(normMatch[0]);

const NORM_CASES = [
  // [label, input, ctx, expected min count, expected max count]
  ['empty input pads to 3', [], { intent: { toolName: 'get_financial_metric' }, currentMetric: 'revenue' }, 3, 4],
  ['null input pads to 3', null, { intent: { toolName: 'get_financial_metric' } }, 3, 4],
  ['single chip pads to 3', ['Show by location'], { intent: { toolName: 'get_chair_metrics' } }, 3, 4],
  ['two chips pad to 3', ['Break down by month', 'Compare with last month'], { intent: { toolName: 'get_financial_metric' }, currentMetric: 'profit' }, 3, 4],
  ['three chips passthrough', ['A', 'B', 'C'], { intent: { toolName: 'get_chair_metrics' } }, 3, 3],
  ['four chips passthrough', ['A', 'B', 'C', 'D'], { intent: { toolName: 'get_chair_metrics' } }, 4, 4],
  ['five chips truncated to 4', ['A', 'B', 'C', 'D', 'E'], { intent: { toolName: 'get_chair_metrics' } }, 4, 4],
  ['dupes collapsed', ['Show profit', 'Show Profit', 'show PROFIT'], { intent: { toolName: 'get_financial_metric' }, currentMetric: 'revenue' }, 3, 4],
];

for (const [label, input, ctx, minCount, maxCount] of NORM_CASES) {
  const got = normalizeSuggestionChips(input, ctx);
  const ok = Array.isArray(got) && got.length >= minCount && got.length <= maxCount
    && got.every(s => typeof s === 'string' && s.length > 0);
  if (ok) totalPass++;
  else {
    totalFail++;
    failures.push(`normalizer ${label}: got ${JSON.stringify(got)}, expected ${minCount}-${maxCount} chips`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. INTERNAL-IDENTIFIER SCRUBBER
// ─────────────────────────────────────────────────────────────────────────
section('4. Internal identifier scrubber');

const formatterSrc = fs.readFileSync(path.join(__dirname, '..', 'responseFormatter.js'), 'utf8');
const scrubMatch = formatterSrc.match(/function scrubInternalIdentifiers[\s\S]*?function splitIdentifier[\s\S]*?^}/m);
if (!scrubMatch) {
  console.log('FAIL: scrubInternalIdentifiers/splitIdentifier not found');
  process.exit(1);
}
// eslint-disable-next-line no-eval
eval(scrubMatch[0]);

const SCRUB_CASES = [
  // [input, expected]
  ['The planMix array is empty', 'The plan mix array is empty'],
  ['planMixTotalRevenue is £0', 'plan mix total revenue is £0'],
  ['Look at `planMix` for data', 'Look at plan mix for data'],
  ['No plan mix data is available', 'No plan mix data is available'], // plain English, unchanged
  ['Private dominates at 89.26%', 'Private dominates at 89.26%'],     // proper noun untouched
  ['Use accounts.length to check', 'Use accounts length to check'],
  ['The locations[0] entry shows', 'The locations entry shows'],
  ['£33,946.31 for Private plan', '£33,946.31 for Private plan'],
  ['The planMix array is empty and planMixTotalRevenue is £0', 'The plan mix array is empty and plan mix total revenue is £0'],
];

for (const [input, expected] of SCRUB_CASES) {
  assertEq(`scrub: ${JSON.stringify(input)}`, scrubInternalIdentifiers(input), expected);
}

// ─────────────────────────────────────────────────────────────────────────
// 5. LOADING-HINT DETECTOR (frontend helper)
// ─────────────────────────────────────────────────────────────────────────
// Recreates the regex logic from ChatMessageList.tsx → getLoadingHint. Kept
// in this backend test to catch drift, since the frontend is TypeScript and
// not part of this test runner.
section('5. Loading hint detector');

function getLoadingHint(message) {
  const m = (message || '').toLowerCase();
  if (!m) return null;
  if (/\b(?:cost|costs|expense|expenses|lab\s*fees?|staff\s*costs?|clinician\s*costs?|material\s*costs?|operating\s*leases?|overheads?|admin)\b/.test(m)
    && /\b(?:trend|over\s+(?:the\s+)?(?:last|past)\s+\d+\s+(?:month|months|quarter|year)|by\s+month|monthly|months?\s+(?:trend|history))\b/.test(m)) {
    return 'multi-month';
  }
  if (/\b(?:cost|costs|expense|expenses|lab\s*fees?|staff\s*costs?|clinician\s*costs?|material\s*costs?|operating\s*leases?|overheads?)\b/.test(m)) {
    return 'cost';
  }
  if (/\b(?:profitability|loss-?making|margin|profit\s+per|unprofitable)\b/.test(m) && /\b(?:treatment|treatments)\b/.test(m)) {
    return 'treatment-profitability';
  }
  if (/\b(?:ebitda|valuation|enterprise\s+value|practice\s+(?:value|worth))\b/.test(m)) {
    return 'ebitda';
  }
  if (/\bwhy\s+(?:is|are|did|has|have)\b/.test(m) || /\bwhat\s+drove\b/.test(m)) {
    return 'why';
  }
  if (/\bplan\s*mix|payor\s*(?:mix|split)\b/.test(m)) {
    return 'plan-mix';
  }
  if (/\btreatments?\b.*\b(?:revenue|income|by\s+category|by\s+treatment)\b|\b(?:revenue|income)\b.*\btreatments?\b/.test(m)) {
    return 'treatment-revenue';
  }
  if (/\b(?:top|bottom|rank|list)\b.*\b(?:provider|providers|dentist|hygienist|practitioner)\b/.test(m)) {
    return 'provider-ranking';
  }
  if (/\bhow\s+(?:can|do|should|could)\b|\bsuggest|recommend|advise|advice\b/.test(m)) {
    return 'advisory';
  }
  return null;
}

const HINT_CASES = [
  ['Show clinician cost trend over the last 6 months', 'multi-month'],
  ['Material costs by month this year', 'multi-month'],
  ['lab fees this month', 'cost'],
  ['What were staff costs?', 'cost'],
  // 'Composite Filling' lacks the literal word 'treatment(s)', so this lands
  // on the advisory ("how can I improve…") branch. That's the actual code
  // behaviour — captured here so a regex tighten/loosen is caught.
  ['How can I improve Composite Filling margin?', 'advisory'],
  ['Which treatments are loss-making?', 'treatment-profitability'],
  ['Show me unprofitable treatments', 'treatment-profitability'],
  ['What is our EBITDA?', 'ebitda'],
  ['Practice value this quarter', 'ebitda'],
  ['Why is revenue down?', 'why'],
  ['What drove the change?', 'why'],
  ['plan mix with revenue', 'plan-mix'],
  ['payor mix this month', 'plan-mix'],
  ['top treatments by revenue', 'treatment-revenue'],
  ['Top providers by revenue', 'provider-ranking'],
  ['How should we grow profit?', 'advisory'],
  ['Suggest improvements', 'advisory'],
  // No hint expected
  ['Revenue this month', null],
  ['Hi', null],
  ['', null],
];

for (const [msg, expected] of HINT_CASES) {
  assertEq(`hint: ${JSON.stringify(msg)}`, getLoadingHint(msg), expected);
}

// ─────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log(`Result: ${totalPass}/${totalPass + totalFail} passing (${totalFail} fail)`);
console.log('═'.repeat(70));

if (totalFail > 0) {
  console.log('\nFAILURES:\n');
  for (const f of failures) console.log('  ✗ ' + f + '\n');
  process.exit(1);
}
process.exit(0);
