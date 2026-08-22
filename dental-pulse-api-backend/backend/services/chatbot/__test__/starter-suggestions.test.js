/**
 * Audit every predefined starter suggestion in src/components/chatbot/
 * pageSuggestions.ts against the live local classifier. Reports the tool
 * each one routes to, plus a sanity check based on the suggestion's keywords.
 *
 * Run with:
 *   node backend/services/chatbot/__test__/starter-suggestions.test.js
 *
 * The goal is to surface "this chip looks like X but routes to Y" mismatches,
 * which are the most common cause of unexpected answers when users click a
 * predefined question.
 */

const path = require('path');
const fs = require('fs');
const { classify } = require(path.join(__dirname, '..', 'localClassifier.js'));

// Path to the frontend suggestion source.
const SUGGESTIONS_FILE = 'C:\\xampp\\htdocs\\dental-pulse-dev\\src\\components\\chatbot\\pageSuggestions.ts';

// Parse the file by string-scraping. Avoids needing TS/tsx tooling on the
// backend repo.
const raw = fs.readFileSync(SUGGESTIONS_FILE, 'utf-8');

// Each route entry: { match: (p) => …, suggestions: [...] }
// We split by the literal `match:` lines and pull suggestions text out.
const ROUTE_RE = /match:\s*\(p\)\s*=>\s*([^,]+),[\s\S]*?suggestions:\s*\[([\s\S]*?)\]\s*,?\s*\}/g;
const SUG_TEXT_RE = /text:\s*"([^"]+)"/g;

const allEntries = [];
let m;
while ((m = ROUTE_RE.exec(raw)) !== null) {
  const matchExpr = m[1].trim();
  const sugBlock = m[2];
  const texts = [];
  let t;
  while ((t = SUG_TEXT_RE.exec(sugBlock)) !== null) {
    texts.push(t[1]);
  }
  allEntries.push({ matchExpr, texts });
}

// Also pull DEFAULT_SUGGESTIONS.
const defBlock = raw.match(/DEFAULT_SUGGESTIONS:\s*Suggestion\[\]\s*=\s*\[([\s\S]*?)\];/);
if (defBlock) {
  const texts = [];
  let t;
  while ((t = SUG_TEXT_RE.exec(defBlock[1])) !== null) {
    texts.push(t[1]);
  }
  if (texts.length > 0) {
    allEntries.unshift({ matchExpr: 'DEFAULT (no specific page)', texts });
  }
}

// Cheap heuristics: given the question text, what tool would a human expect?
// Returns a set of acceptable toolNames, or null if "could be many".
function expectedTools(q) {
  const t = q.toLowerCase();
  // Mapping/CoA → defer to LLM (general_question)
  if (/chart of account|coa|mapped to|nominal code|gl code|account code/.test(t)) return new Set(['__llm__']);
  // EBITDA / valuation
  if (/ebitda|valuation|enterprise value|practice worth|exit value|multiple/.test(t)) return new Set(['get_ebitda', '__llm__']);
  // Cash position / balance
  if (/cash position|closing balance|opening balance|cash on hand|bank balance/.test(t)) return new Set(['get_cashflow_data']);
  // Cashflow flow
  if (/cash\s*flow|cash inflow|cash outflow|cash in |cash out |net cash/.test(t)) return new Set(['get_cashflow_data']);
  // Specific cost categories
  if (/\blab fees?\b|\blab cost/.test(t)) return new Set(['get_cost_breakdown', 'list_cost_entries', 'list_cost_transactions']);
  if (/\bstaff cost|wage|salary|payroll/.test(t)) return new Set(['get_cost_breakdown']);
  if (/\bmaterial cost/.test(t)) return new Set(['get_cost_breakdown']);
  if (/\bclinician cost|associate cost/.test(t)) return new Set(['get_cost_breakdown']);
  if (/\boverheads?|administrative cost/.test(t)) return new Set(['get_cost_breakdown']);
  if (/operating lease|rent\b|rental/.test(t)) return new Set(['get_cost_breakdown']);
  // Generic costs / expenses
  if (/biggest cost|cost driver|break down (?:the )?cost|cost trend|total cost|cost growth/.test(t)) return new Set(['get_cost_breakdown', '__llm__']);
  // Profit / P&L
  if (/\bp&l|profit and loss|profitability|income statement|profit margin trend|profit comparison|gross profit|net profit/.test(t)) return new Set(['get_profit_and_loss', 'get_financial_metric']);
  if (/\bprofit\b|\bmargin\b/.test(t)) return new Set(['get_financial_metric', 'get_profit_and_loss', 'general_question']);
  // Revenue (generic)
  if (/revenue|production|turnover|earning/.test(t)) return new Set(['get_financial_metric', 'get_treatment_revenue', 'get_location_metrics', '__llm__']);
  // Patients
  if (/active member|patient count|new patients|patient volume|how many patients|how many member/.test(t)) return new Set(['get_financial_metric']);
  // Chair / utilisation
  if (/chair|utilisation|utilization|occupancy/.test(t)) return new Set(['get_chair_metrics']);
  // DNA / attendance / cancellation
  if (/\bdna\b|did not attend|no.show|attendance rate|cancell?ation rate|missed appointment/.test(t)) return new Set(['get_attendance_metric', 'list_dna_patients']);
  // Recommendations / advice
  if (/suggest|recommend|tip|advice|advise|action item|focus on|improvement|how can we improve|how can i improve|what should (i|we)/.test(t)) return new Set(['get_recommendations']);
  // Listing providers
  if (/(top |bottom |all )?(provider|dentist|hygienist|therapist|practitioner)s?\b/.test(t) && /\b(list|show|who|are|directory|by name)\b/.test(t)) return new Set(['list_providers']);
  // Treatment-level / category
  if (/treatment(s)? (by category|by provider|revenue|trend|volume|growing|declining|mix)|by treatment|top treatment|loss[\s-]?making treatment/.test(t)) return new Set(['get_treatment_revenue', 'general_question', '__llm__']);
  // NHS
  if (/\buda|nhs\s+contract|nhs\s+band|nhs\s+target|nhs.*performance/.test(t)) return new Set(['get_treatment_revenue', '__llm__']);
  // Budget / planning
  if (/budget|forecast|target|tracking|over budget/.test(t)) return new Set(['__llm__']);
  // Tax
  if (/\bvat\b|corporation tax|tax deadline|tax paid|tax liability|tax planning/.test(t)) return new Set(['__llm__']);
  return null; // "could be many" → don't fail
}

const emptyContext = {};
const emptyMentions = { providers: [], periods: [] };

console.log('───────────────────────────────────────────────────────────────────');
console.log('STARTER SUGGESTION CLASSIFIER AUDIT');
console.log('───────────────────────────────────────────────────────────────────');

let totalSuggestions = 0;
let surprising = 0;
let deferredToLLM = 0;
const surprisingList = [];
const deferredList = [];

for (const entry of allEntries) {
  console.log(`\n[${entry.matchExpr}]`);
  for (const text of entry.texts) {
    totalSuggestions++;
    const result = classify(text, emptyContext, emptyMentions);
    const tool = result ? result.toolName : '__llm__';
    const expected = expectedTools(text);
    const ok = !expected || expected.has(tool);
    const flag = ok ? '   ' : ' ✗ ';
    const expectedLabel = expected ? ` (expected: ${[...expected].join('/')})` : '';
    console.log(`${flag} "${text}"`);
    console.log(`     → ${tool}${ok ? '' : expectedLabel}`);
    if (!ok) {
      surprising++;
      surprisingList.push({ page: entry.matchExpr, text, tool, expected });
    }
    if (tool === '__llm__') {
      deferredToLLM++;
      deferredList.push({ page: entry.matchExpr, text });
    }
  }
}

console.log('');
console.log('───────────────────────────────────────────────────────────────────');
console.log(`Total predefined suggestions: ${totalSuggestions}`);
console.log(`Routed locally:               ${totalSuggestions - deferredToLLM}`);
console.log(`Deferred to LLM:              ${deferredToLLM}`);
console.log(`Surprising routes (likely wrong): ${surprising}`);
console.log('───────────────────────────────────────────────────────────────────');

if (surprising > 0) {
  console.log('\n=== SURPRISING ROUTES (likely producing wrong answers) ===\n');
  for (const s of surprisingList) {
    console.log(`  • [${s.page}]`);
    console.log(`    "${s.text}"`);
    console.log(`    routed to ${s.tool}, expected: ${[...s.expected].join(' or ')}`);
    console.log('');
  }
}
