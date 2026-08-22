/**
 * Programmatic classifier test harness.
 *
 * Runs a curated list of representative user questions through the LOCAL
 * regex classifier and reports which ones route to the expected tool, which
 * misroute, and which defer to the LLM (null result). Designed to be run
 * with `node backend/services/chatbot/__test__/classifier.test.js` — no test
 * framework required.
 *
 * Limitations:
 * - Only exercises the local regex classifier. The LLM classifier path
 *   (Claude tool-call) is not exercised here because that's an API call.
 *   Questions that should defer to the LLM are marked with expected: '__llm__'
 *   so this harness verifies "no local match" — i.e. the local layer correctly
 *   handed off.
 * - Does NOT exercise the resolver or formatter. Once routing is right the
 *   downstream layers tend to follow.
 */

const path = require('path');
const { classify } = require(path.join(__dirname, '..', 'localClassifier.js'));

// Each row: [question, expectedTool, expectedArgsSubset?, label?]
// expectedArgsSubset is optional — when present, the test also asserts each
// listed arg matches what the classifier stamped.
const TESTS = [
  // ── Cost categories (the one we just fixed) ─────────────────────────
  ['What were material costs this month?',          'get_cost_breakdown', { category: 'material' }],
  ['Show me lab fees',                              'get_cost_breakdown', { category: 'lab' }],
  ['What are our staff costs?',                     'get_cost_breakdown', { category: 'staff' }],
  ['Show clinician costs',                          'get_cost_breakdown', { category: 'clinician' }],
  ['What were our overheads?',                      'get_cost_breakdown', { category: 'overhead' }],
  ['What are operating lease costs?',               'get_cost_breakdown', { category: 'lease' }],
  ['Show our total expenses',                       'get_cost_breakdown', { category: 'all' }],
  ['How much did we spend on payroll?',             'get_cost_breakdown', { category: 'staff' }],
  ['Materials cost this quarter',                   'get_cost_breakdown', { category: 'material' }],

  // ── Loss-making / row-identification (page-grounded) ────────────────
  ['Which treatments are loss-making?',             'general_question'],
  ['Which providers are underperforming?',          'general_question'],
  ['Show me the lowest margin treatments',          'general_question'],
  ['Where are we losing money?',                    'general_question'],
  ['Which treatments are unprofitable?',            'general_question'],
  ['Worst margin providers',                        'general_question'],

  // ── By-location aggregation ────────────────────────────────────────
  ['Show private revenue by location',              'get_location_metrics'],
  ['Compare locations by revenue',                  'get_location_metrics'],
  ['Revenue across all sites',                      'get_location_metrics'],
  ['Per location breakdown',                        'get_location_metrics'],
  ['Each location revenue',                         'get_location_metrics'],

  // ── Mapping / configuration questions ──────────────────────────────
  // These currently DON'T have a dedicated local pattern (handled by LLM
  // rule 14k → general_question). So we expect deferred to LLM.
  ['Which chart of account is mapped to lab fees?', '__llm__'],
  ['What Xero account is staff costs mapped to?',   '__llm__'],

  // ── Revenue ────────────────────────────────────────────────────────
  ['What is our revenue this month?',               'get_financial_metric', { metric: 'revenue' }],
  ['Show me income this quarter',                   'get_financial_metric', { metric: 'revenue' }],
  ['Production figures',                            'get_financial_metric', { metric: 'revenue' }],

  // ── Profit ─────────────────────────────────────────────────────────
  ['What is our profit this month?',                'get_financial_metric', { metric: 'profit' }],
  ['Show me net income',                            'get_financial_metric', { metric: 'profit' }],

  // ── P&L / Profitability (different tool: get_profit_and_loss) ──────
  ['Show me the P&L for March',                     'get_profit_and_loss'],
  ['How is profitability doing?',                   'get_profit_and_loss'],
  ['Income statement this year',                    'get_profit_and_loss'],

  // ── EBITDA / Valuation ─────────────────────────────────────────────
  ['What is our EBITDA?',                           'get_ebitda'],
  ['Show practice valuation',                       'get_ebitda'],
  ['What is the practice worth?',                   'get_ebitda'],
  ['Enterprise value Q1',                           'get_ebitda'],

  // ── Treatment revenue ──────────────────────────────────────────────
  ['Treatment revenue breakdown',                   'get_treatment_revenue'],
  ['Which treatments earn the most?',               'get_treatment_revenue'],
  ['Top treatments by revenue',                     'get_treatment_revenue'],
  ['What are the top private treatments?',          'get_treatment_revenue', { dimension: 'treatment', payor: 'private' }],
  ['Private Treatment This Month revenue by treatment type', 'get_treatment_revenue', { dimension: 'treatment', payor: 'private' }],
  ['Show me revenue by treatment type',             'get_treatment_revenue', { dimension: 'treatment' }],
  ['Revenue by treatment types this quarter',       'get_treatment_revenue', { dimension: 'treatment' }],
  ['What are the most profitable treatments?',      'general_question'], // loss-making pattern (intentional — page snapshot answers)
  ['Show top NHS treatments',                       'get_treatment_revenue', { dimension: 'treatment', payor: 'nhs' }],
  ['What are the lowest membership treatments?',    'get_treatment_revenue', { dimension: 'treatment', payor: 'membership', sort: 'asc' }],

  // ── Cashflow ───────────────────────────────────────────────────────
  ['Show our cashflow',                             'get_cashflow_data'],
  ['Cash in this month',                            'get_cashflow_data'],
  ['What is our closing balance?',                  'get_cashflow_data', { metric: 'balance' }],
  ['Cash position today',                           'get_cashflow_data', { metric: 'balance' }],

  // ── Chair / utilisation ────────────────────────────────────────────
  ['Chair utilisation this month',                  'get_chair_metrics'],
  ['What is our occupancy rate?',                   'get_chair_metrics'],

  // ── Patients ───────────────────────────────────────────────────────
  ['How many patients did we see?',                 'get_financial_metric', { metric: 'patients' }],
  ['Patient count this month',                      'get_financial_metric', { metric: 'patients' }],

  // ── DNA / attendance ───────────────────────────────────────────────
  ['DNA rate this month',                           'get_attendance_metric'],
  ['List patients who did not attend',              'list_dna_patients'],
  ['Show the names of the DNAs',                    'list_dna_patients'],
  ['Who didn\'t attend yesterday?',                 'list_dna_patients'],

  // ── Cancelled appointments ─────────────────────────────────────────
  ['List cancelled appointments',                   'list_cancelled_patients'],
  ['Who cancelled this week?',                      'list_cancelled_patients'],

  // ── Provider list ──────────────────────────────────────────────────
  ['List all dentists',                             'list_providers'],
  ['Show top 5 providers',                          'list_providers'],
  ['Show all hygienists',                           'list_providers'],

  // ── Recommendations / advisory ─────────────────────────────────────
  ['Suggest improvements',                          'get_recommendations'],
  ['What should we focus on?',                      'get_recommendations'],
  ['Any tips for growing profit?',                  'get_recommendations'],

  // ── Greeting / general ─────────────────────────────────────────────
  ['Hello',                                         'general_question'],
  ['Hi there',                                      'general_question'],

  // ── Page-referenced questions (must defer so general_question reads page) ──
  ['What does this page show?',                     '__llm__'],
  ['Private Treatment this page total revenue of this month?', '__llm__'],
  ['What is the total on this page?',               '__llm__'],
  ['Whats currently displayed?',                    '__llm__'],

  // ── Conversational BI: dashboard + report-style routing ────────────
  ['show me a dashboard of revenue by location this month', 'generate_dashboard'],
  ['how are we doing this month',                   'generate_dashboard'],
  ['practice overview',                             'generate_dashboard'],
  ['top 10 high earning treatment report',          'generate_dashboard'],
  ['monthly revenue report',                        'generate_dashboard'],
  ['revenue report by location this month',         'generate_dashboard'],
  ['patient report this quarter',                   'generate_dashboard'],
  // Typo-tolerant "dashboard" — a misspelt "dashboard" must still be
  // recognised (not fall through to a single-metric tool on a stray keyword).
  ['generate revenue dashbaord for last month',      'generate_dashboard', null, 'dashboard misspelling: dashbaord → BI (revenue)'],
  ['show me a dashbord by location',                 'generate_dashboard', null, 'dashboard misspelling: dashbord → BI'],
  // Profit / expense / EBITDA AS a dashboard → audited P&L/EBITDA resolvers
  // (rendered as a dashboard via resolvedAdapter), NOT the BI engine (no cost
  // data). Also covers the typo'd "dashborad".
  ['generate profitability by treatments dashborad', 'get_profit_and_loss', null, 'profit + (typo) dashboard → P&L resolver'],
  ['profit dashboard last quarter',                  'get_profit_and_loss', null, 'profit dashboard → P&L resolver'],
  ['expenses dashboard this month',                  'get_profit_and_loss', null, 'expenses dashboard → P&L resolver'],
  ['cost breakdown dashboard for caldicot',          'get_profit_and_loss', null, 'cost dashboard → P&L resolver'],
  ['ebitda dashboard this year',                     'get_ebitda',          null, 'ebitda dashboard → EBITDA resolver'],
  // Regression: a plain metric dashboard with NO profit/cost term stays BI.
  ['revenue dashboard by location this month',       'generate_dashboard',  null, 'revenue dashboard stays BI'],
  // Exclusions — report word but owned by other tools (must NOT dashboard)
  ['P&L report this month',                         'get_profit_and_loss'],
  ['email me the revenue report',                   '__llm__'],
  // Plain single-metric (no dashboard/report trigger) stays as-is
  ['revenue this month',                            'get_financial_metric', { metric: 'revenue' }],

  // ── Cost time-series & transactions (specific list_* tools) ────────
  ['Daily lab fees',                                'list_cost_entries',     { category: 'lab_fees' }],
  ['Material costs by month',                       'list_cost_entries',     { category: 'material_costs' }],
  ['Lab fees transactions',                         'list_cost_transactions', { category: 'lab_fees' }],
  ['Show me lab invoices',                          'list_cost_transactions', { category: 'lab_fees' }],
  ['Which suppliers for materials?',                'list_cost_transactions', { category: 'material_costs' }],
];

const emptyContext = {};
const emptyMentions = { providers: [], periods: [] };

let pass = 0;
let fail = 0;
const failures = [];

console.log('───────────────────────────────────────────────────────────────────');
console.log('CHATBOT LOCAL CLASSIFIER TEST HARNESS');
console.log('───────────────────────────────────────────────────────────────────');
console.log(`Running ${TESTS.length} test cases against localClassifier.js`);
console.log('');

for (const test of TESTS) {
  const [question, expectedTool, expectedArgs, label] = test;
  const result = classify(question, emptyContext, emptyMentions);

  let status, detail;

  if (expectedTool === '__llm__') {
    // Expected to defer to LLM (no local match).
    if (result === null) {
      status = 'PASS';
      detail = '(deferred to LLM as expected)';
    } else {
      status = 'FAIL';
      detail = `expected LLM deferral, got local match: ${result.toolName}`;
    }
  } else if (!result) {
    status = 'FAIL';
    detail = `expected ${expectedTool}, got LLM deferral`;
  } else if (result.toolName !== expectedTool) {
    status = 'FAIL';
    detail = `expected ${expectedTool}, got ${result.toolName}`;
  } else if (expectedArgs) {
    const wrong = Object.entries(expectedArgs).filter(([k, v]) => result.args[k] !== v);
    if (wrong.length > 0) {
      status = 'FAIL';
      detail = `tool right (${expectedTool}) but args wrong: ${wrong.map(([k, v]) => `${k}=${result.args[k]} (wanted ${v})`).join(', ')}`;
    } else {
      status = 'PASS';
      detail = `→ ${result.toolName} ${JSON.stringify(result.args || {})}`;
    }
  } else {
    status = 'PASS';
    detail = `→ ${result.toolName}`;
  }

  if (status === 'PASS') {
    pass++;
    console.log(`  PASS  "${question.length > 50 ? question.slice(0, 50) + '…' : question}"`);
    console.log(`        ${detail}`);
  } else {
    fail++;
    failures.push({ question, expectedTool, expectedArgs, detail, label });
    console.log(`  FAIL  "${question.length > 50 ? question.slice(0, 50) + '…' : question}"`);
    console.log(`        ${detail}`);
  }
}

console.log('');
console.log('───────────────────────────────────────────────────────────────────');
console.log(`Result: ${pass}/${TESTS.length} passing (${fail} fail)`);
console.log('───────────────────────────────────────────────────────────────────');

if (failures.length > 0) {
  console.log('\nFailure summary:');
  for (const f of failures) {
    console.log(`  - "${f.question}"`);
    console.log(`    ${f.detail}`);
  }
  process.exit(1);
}
process.exit(0);
