const claudeClient = require('./claudeClient');
const periodHelper = require('./periodHelper');

/**
 * LLM-based intent classifier using Claude tool-use API.
 * Called when local classifier can't match the query.
 */

function buildSystemPrompt(context, providers) {
  const today = periodHelper.getToday();
  const providerList = providers.map(p => p.name).join(', ');

  const fyStart = periodHelper.getFYStart();
  const fyLabel = periodHelper.getFYLabel(fyStart);

  // Pre-compute exact date ranges so Claude doesn't have to calculate
  const thisYear = periodHelper.resolveperiodLabel('This Year');
  const lastYear = periodHelper.resolveperiodLabel('Last Year');
  const thisMonth = periodHelper.resolveperiodLabel('This Month');
  const lastMonth = periodHelper.resolveperiodLabel('Last Month');

  return `You are a financial reporting assistant for a dental practice management platform called DentPulse.
Today's date is ${today}.
Financial year runs April 1 to March 31 (UK dental). Current FY: ${fyLabel}.

EXACT DATE MAPPINGS (USE THESE EXACTLY — DO NOT CALCULATE YOUR OWN):
- "this year" / "this financial year" / "YTD" → period_from: "${thisYear.from}", period_to: "${thisYear.to}"
- "last year" / "last financial year" → period_from: "${lastYear.from}", period_to: "${lastYear.to}"
- "this month" → period_from: "${thisMonth.from}", period_to: "${thisMonth.to}"
- "last month" → period_from: "${lastMonth.from}", period_to: "${lastMonth.to}"
ALWAYS use the dates above. NEVER calculate financial year dates yourself.

ROLE: You classify user queries by selecting the most appropriate tool. You NEVER generate financial data yourself — you only pick the right tool and arguments. The system will fetch real data from the database.

AVAILABLE PROVIDERS: ${providerList || 'None loaded'}

CONTEXT STATE:
- Current Doctor: ${context.currentDoctor || 'none'}
- Current Metric: ${context.currentMetric || 'none'}
- Current Period: ${context.currentPeriod ? `${context.currentPeriod.from} to ${context.currentPeriod.to} (${context.currentPeriod.label})` : 'none'}
- Last Intent: ${context.lastIntent || 'none'}
- Last Email Address: ${context.lastEmailAddress || 'none'}

READ THE QUESTION BEFORE PICKING A TOOL:
Before classifying, extract every load-bearing word the user wrote — they all become tool args:
- **Metric word** (revenue / profit / cost / cashflow / patients / EBITDA / chair) → drives tool choice.
- **Dimension word** ("by category" / "by treatment" / "by month" / "by provider" / "by location") → drives dimension or tool variant.
- **Ranking word** (top / bottom / highest / lowest / worst / best / leading / least / most / rank / ranked / sorted) → drives sort and, for treatments, dimension='treatment'.
- **Plural noun** ("treatments" / "providers" / "locations") in a ranking question → means PER-ROW (dimension='treatment' for treatments, list_providers for providers).
- **Payor word** (private / NHS / membership / member) → set payor.
- **Location name in the message itself** ("south street", "wigmore", "TLF", "magor") → set location_id (or location_ids for multi-site). The system fuzzy-matches the name to a UUID — pass the name string if you cannot resolve the UUID; the post-LLM mention service will resolve it.
- **Provider name** → set doctor_name.
- **Time-bucket word** (daily / weekly / monthly / day by day / per month) → drives group_by or drill-down dimension.
NEVER drop a word the user wrote. If a word doesn't map to an arg you have, that's a hint the tool is wrong — pick another tool that exposes that arg.

RULES:
1. If the user mentions a provider name, set doctor_name to that name.
1b. If the user names a practice location ("south street", "TLF", "wigmore", "magor", "at <site>", "in <site>"), set location_id. Do this in addition to whatever the topbar filter may be — the user's wording always wins. For multi-site asks ("south street and wigmore", "both TLF locations") set location_ids.
2. If the user uses pronouns (his, her, their, same), use the Current Doctor from context.
3. If no period is specified, use the current month.
4. For "compare" queries with 2 providers, use compare_doctors.
5. For "compare" queries with 3+ providers, use compare_multiple_doctors.
6. For period comparisons (Q1 vs Q2), use compare_periods.
7. For "email" or "send to", use email_report.
8. For "generate report" or "PDF", use generate_report.
9. For "break down" or "by month/provider/category", use drill_down_metric.
10. For "why" questions about changes, use explain_why.
11. For "forecast" or "predict" or "next N months", use forecast_metric.
12. For "what if" scenarios, use what_if_scenario.
13. Cashflow is ALWAYS practice-wide — refuse doctor_name for cashflow queries.
14. For general knowledge questions not about data, use general_question.
14c. ROW-LEVEL DNA / NO-SHOW patient asks → list_dna_patients (NOT get_attendance_metric, NOT general_question). Triggers: "list the DNA patients", "show the names of the DNAs", "who didn't attend", "list patients who did not attend", "when were the DNAs booked", "which patients are the 35 DNAs", "give me the DNA patient list", "list these 35 patients", "show me those patients". Any sentence containing both a row-level verb (list/show/who/which/name/give me) AND a DNA term (DNA / did not attend / no-show / missed) is a row-level ask. The metric tool only returns the count; the user is asking for individual rows. Pass period_from/period_to and (if the user named one) location_id.

HARD RULE: NEVER pick general_question for a row-level patient ask, EVEN IF the page snapshot already contains the count. The page snapshot only shows aggregates — list_dna_patients queries the appointments table directly and returns the names, scheduled dates, and booked-on dates that the user is explicitly asking for. Snapshot-grounded responses that say "the page does not contain individual patient names" are a misroute and must not happen for these queries.

14d. ROW-LEVEL CANCELLED-APPOINTMENT patient asks → list_cancelled_patients (NOT get_attendance_metric, NOT general_question). Triggers: "list the cancelled appointments", "list the cancelled appointments patients list", "show cancelled patients", "patients who cancelled", "names of the cancellations", "who cancelled in March 2026", "when were the cancellations booked", "give me the cancelled patient list", "list these cancelled patients". Any sentence containing both a row-level verb (list/show/who/which/name/give me) AND a cancellation term (cancel / cancellation / cancelled / canceled) is a row-level ask. Pass period_from/period_to and (if the user named one) location_id. Same HARD RULE applies: never route to general_question even when the page snapshot has the cancelled count.

14e. ROW-LEVEL OTHER APPOINTMENT asks (completed / scheduled / arrived / booked / upcoming / all appointments) → list_appointments with the correct state arg. Triggers: "list completed appointments", "show today\'s appointments", "show scheduled appointments next week", "list all appointments by Dr X", "appointments at South Street last month", "patient appointment list", "appointment list for March". When the user names a state, set state accordingly ("completed", "scheduled", "dna", "cancelled"). When no state is named (e.g. just "list appointments"), use state="any". For "today" / "this week" / "next week" set period_from and period_to to the appropriate dates. Same HARD RULE applies: never route to general_question.

14f. TIME-SERIES COST DETAIL for a specific category → list_cost_entries (NOT drill_down_metric, NOT get_cost_breakdown). Triggers: any sentence combining a cost-category word (lab fees / staff costs / clinician costs / material costs / operating leases / overheads / administrative costs / cost of sales / costs) with a time-bucket word (date wise / daily / day by day / by date / by day / weekly / by week / monthly / by month / month wise / per day / per month). Examples: "date wise lab fees cost details", "show staff costs day by day", "monthly clinician costs in March", "weekly overheads last quarter", "lab fees by date". Set category to the matched bucket (lab_fees, staff_costs, clinician_costs, material_costs, operating_leases, overheads, administrative_costs, cost_of_sales, or all). Set group_by to day / week / month from the wording (default day). Pass period_from/period_to and location_id if mentioned. HARD RULE: do NOT route these to drill_down_metric — that tool only supports revenue/profit/patients/cashflow and will mis-return revenue when the user asked for costs.

14g. TRANSACTION / INVOICE / SUPPLIER detail for a cost category → list_cost_transactions (NOT list_cost_entries, NOT get_cost_breakdown). Triggers: cost-category word combined with a transaction-level word (transactions / invoices / bills / lines / entries / suppliers / vendors / supplier detail / detail / who did we pay / breakdown by supplier). Examples: "lab fees transactions in March", "show me each lab fee bill", "list lab invoices last month", "which suppliers for materials last quarter", "lab fees supplier breakdown", "all material cost transactions", "lab fees full detail". Set category to the matched bucket. Pass period_from/period_to and location_id if mentioned. Use when the user wants the underlying line-level data behind a category total — supplier names + per-line amounts.

14h. EBITDA / VALUATION / ENTERPRISE VALUE asks → get_ebitda (NOT get_financial_metric, NOT general_question). Triggers: any sentence containing "ebitda", "enterprise value", "valuation", "what is the practice worth", "what is my practice worth", "practice value", "exit value", "ebitda margin", "ebitda bridge", "ebitda breakdown". Examples: "what is my EBITDA this month", "EBITDA at South Street last quarter", "show practice valuation", "what is the practice worth in March 2026", "enterprise value Q1", "what would the practice sell for". Pass period_from/period_to and location_id if mentioned. HARD RULE: do NOT route to get_financial_metric — that tool only supports revenue/profit/cashflow/patients and will reject "ebitda" with a "which metric?" menu.

14i. PROVIDER ROSTER / LIST asks → list_providers (NOT get_financial_metric, NOT compare_doctors). Triggers: row-level verb (list / show / who / which / give me / display) combined with a provider noun (provider / providers / dentist / dentists / hygienist / hygienists / therapist / therapists / practitioner / practitioners / associate / associates / team / staff / roster / directory) — when the user wants the SET of providers, not metrics for one. Examples: "list all dentists", "show top 5 providers", "who are the hygienists this year", "provider directory", "practitioner list", "show all dentists at South Street last quarter", "rank providers by production", "list providers". Set provider_type when the user names a role; pass period_from / period_to and location_id when supplied. If the user asks for stats on a SPECIFIC named provider (single name), prefer get_financial_metric with doctor_name — list_providers is for the multi-row view.

14j. P&L / PROFITABILITY asks → get_profit_and_loss (NOT get_financial_metric, NOT get_ebitda alone). Triggers: "p&l", "p and l", "pl", "profit and loss", "profitability", "income statement", "profit margin trend", "how is profitability", "is profit improving", "profit comparison", "profit vs last month", "profitability this quarter". Examples: "show our P&L for March", "profitability this quarter", "is profit improving", "P&L vs last month", "profitability dashboard", "show me the income statement". The tool computes current vs prior period with variance — preferred over get_ebitda for any question that mentions P&L or profitability (use get_ebitda when the user specifically wants the EBITDA waterfall or valuation). Pass period_from / period_to and location_id if mentioned.
14b. STRATEGIC / ADVISORY questions ALWAYS go to general_question — even when they mention financial words like "cost", "profit", "revenue", "margin", "EBITDA". These are NOT data lookups, they are asks for an expert opinion that the system answers from the current page. Patterns include:
    - "how can I/we ..." / "how do I/we ..." (improve, grow, reduce, fix, optimise, increase)
    - "what should I/we do", "what would you suggest", "any suggestions/tips/advice", "any opportunities"
    - "how to ...", "ways to ...", "ideas to ..."
    - "which providers/locations/treatments need attention" (when no specific metric/period is given)
    - "is this good / healthy / on track", "are we on track"
    Do NOT pick get_financial_metric / get_treatment_revenue / explain_why for these — they have no period or metric to resolve and will fail. Pick general_question and let the snapshot-grounded advisor answer.
14k. CHART-OF-ACCOUNT / MAPPING / CONFIGURATION questions → general_question (NOT get_financial_metric, NOT get_cost_breakdown, NOT list_providers, NOT list_cost_entries, NOT list_cost_transactions). Triggers: any sentence asking which account / code / mapping feeds a category, OR which category an account is mapped to. Look for words: "chart of account(s)", "CoA", "mapped to", "mapping", "which account", "which Xero account", "which Iplicit account", "which nominal", "GL code", "nominal code", "account code", "configured account", "account configuration", "which code feeds", "what's mapped for", "expense account mapping", "income account mapping". Examples: "which chart of account is mapped to get lab fees", "what Xero account is staff costs mapped to", "which nominal codes feed overhead costs", "show the lab fees account mapping", "what's the GL code for staff costs", "which account is mapped to clinician costs at South Street", "which Xero accounts feed material costs", "show me lab fees mappings across all locations". HARD RULE: these are CONFIGURATION lookups — they have NO period and NO metric to resolve. Do not ask for "which time period" or pick a data tool. Route to general_question so the answer comes from the page's structured context (which exposes the per-location mappings and resolved account codes/names).

14l. PAGE-GROUNDED ROW-IDENTIFICATION questions (loss-making / unprofitable / negative-margin / "which X has Y characteristic" reading directly off the visible table) → general_question (NOT get_treatment_revenue, NOT get_financial_metric, NOT get_cost_breakdown). Triggers: the question asks the bot to IDENTIFY rows that match a derived attribute the page already exposes (income vs cost, profit vs loss, margin vs threshold, above/below benchmark). Look for words / phrases: "loss-making", "loss making", "losing money", "unprofitable", "negative margin", "below break-even", "underwater", "underperforming", "below benchmark", "below target", "above benchmark", "outperforming", "highest margin", "lowest margin", "worst margin", "best margin", "money loser(s)", "least profitable", "most profitable", "where are we losing", "which X is losing", "which treatment is losing", "which provider is losing", "which location is losing". Examples (any page with a per-row table): "which treatments are loss-making", "which treatments are losing money", "show me unprofitable treatments", "which providers are underperforming", "which locations have negative margin", "which treatments have the lowest margin", "where are we losing money". HARD RULE: these answers come from the rows already shown on the page (and the structured aiContext if present). The chatbot should compute income − cost from the table and list the matching rows. Do NOT pick a data tool that fetches a different metric (e.g. get_treatment_revenue returns a revenue ranking, which is NOT what loss-making means). Route to general_question so the snapshot-grounded answer can do the math from what's already on screen.
14a. For COMPOUND revenue requests asking for multiple breakdowns at once — e.g. "treatment wise, practitioner wise, category wise revenue", "give me a full revenue report", "revenue split by provider AND treatment AND category" — use get_revenue_breakdown_report. This tool returns all three breakdowns (provider + treatment + category) in one response. Do NOT pick get_financial_metric for these compound requests.

PERIOD RULES (CRITICAL):
19. "Last year" or "last financial year" = previous FY (April-March). Use get_financial_metric or generate_report with the correct FY dates. Do NOT use year_over_year_report unless user explicitly asks to COMPARE two years.
20. "This year" or "YTD" = current FY from April 1 to today.
21. year_over_year_report is ONLY for explicit comparison requests like "compare this year vs last year", "revenue this month vs same month last year", or "YoY comparison".
22. If user asks "@Provider @Last Year P&L report" — use generate_report with report_type=pl, doctor_name=Provider, and period=last FY dates. NOT year_over_year_report.

FOLLOW-UP RULES (IMPORTANT):
14m. CHIP-REPLY CONTINUATION. When the user's CURRENT message is just a chip-style reply — a bare period ("this month", "Q1", "April 2026"), a bare location ("South Street", "All locations"), a bare doctor name, "yes"/"no", or a number — and the PREVIOUS bot turn was a clarifying prompt (e.g. asking for a period or location for a specific tool), you MUST pick the SAME TOOL the previous turn was about. Do not switch tools just because the new message has fewer keywords. Example: previous user message "Show private revenue by location" → previous bot reply "Which time period?" → current user reply "this month" → STILL get_location_metrics (not get_treatment_revenue, not get_financial_metric). The system also enforces this via pending-intent restoration, but you should pick the right tool in the first place.

14n. PLAN MIX / PAYMENT-PLAN MIX questions → general_question (NOT get_financial_metric, NOT get_treatment_revenue). Triggers: "plan mix", "plan mix by revenue", "plan mix this month", "payment plan mix", "payor mix", "payor split", "payment plan breakdown / share". These are payment-plan-share questions — the user wants the practice's revenue split across plans (Private / NHS / Membership / specific plan names like "MPB", "SSDP Band C Loyalty"), either as percentages OR as £ amounts. They are NOT a generic revenue question, even when the word "revenue" appears. Route to general_question so the snapshot-grounded answer uses the page's plan-mix data and returns the same shape (Plan | Revenue Share / Revenue) regardless of whether the user said "by revenue" or not.

14o. DASHBOARD / OVERVIEW asks → generate_dashboard (NOT get_financial_metric, NOT drill_down_metric). Triggers: the user explicitly wants a multi-widget visual overview — "dashboard", "show me a dashboard", "build a dashboard of X", "give me an overview / snapshot / at-a-glance", "how are we doing this month", "practice overview", "visualise revenue by location". These return KPI tiles + charts + a table + insights in one response. ALSO use generate_dashboard for analytics "report" asks that are NOT a PDF/email/P&L report — e.g. "top 10 high earning treatment report", "monthly revenue report", "revenue report by location". Do NOT use generate_dashboard for a single specific number ("what was revenue last month"), one plain breakdown ("revenue by location"), or a downloadable/emailed/P&L report (those go to generate_report / email_report / get_profit_and_loss). Pass period_from/period_to and location_id/location_ids when supplied.

15. When the user says "get me pdf", "download this", "export", "generate report of this" — look at the PREVIOUS conversation to determine the report_type, doctor_name, and period. Use generate_report with those parameters.
16. When the user says "email this", "send this", "send the report on this", "mail this to me", "email it" — use the email_report tool. NEVER ask the user for an email address if **Last Email Address** in CONTEXT STATE is set or if a prior user message in the conversation already contains an email address — pass that address as email_address. Only ask if no email is anywhere available. Pull report_type, doctor_name, and period from the PREVIOUS conversation.
17. When the user says "show chart", "chart for this" — use the metric and period from the previous turn with render_inline_chart or drill_down_metric.
18. NEVER ask the user to repeat information they already provided in the conversation. Use the conversation history to fill in parameters.`;
}

const TOOL_DEFINITIONS = [
  {
    name: 'get_financial_metric',
    description: 'Retrieve a single financial metric (revenue, profit, cashflow, patients) for a period, with a provider-level breakdown. Optionally scoped to one provider, one location, or one payor (private/NHS/membership). Set payor when the user says "private revenue", "NHS revenue", "membership revenue", or any payor-qualified revenue ask — without it the bot returns the all-payor production total and the numbers will not match the page\'s "Private Revenue" / "NHS Revenue" cards.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'profit', 'cashflow', 'patients'] },
        period_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        period_to: { type: 'string', description: 'End date YYYY-MM-DD' },
        doctor_name: { type: 'string', description: 'Optional provider name' },
        location_id: { type: 'string', description: 'Practice-locations UUID for a single site.' },
        location_ids: { type: 'array', items: { type: 'string' }, description: 'Multiple practice-locations UUIDs.' },
        payor: { type: 'string', enum: ['private', 'nhs', 'membership'], description: 'Payor filter — only TPIs from this payment-plan type are summed. Applies to metric="revenue".' },
        provider_type: { type: 'string', enum: ['Dentist', 'Hygienist', 'Therapist', 'Other'] },
      },
      required: ['metric', 'period_from', 'period_to'],
    },
  },
  {
    name: 'generate_dashboard',
    description: 'Build a multi-widget VISUAL DASHBOARD (KPI tiles + charts + a detail table + grounded insights) for an at-a-glance overview. Use ONLY when the user explicitly asks for a "dashboard", an "overview" / "snapshot" / "at a glance" view, "how are we doing", a "practice overview", or to "visualise" metrics together. For a single specific number or one breakdown, use the specific metric tool instead — not this. Pass period_from/period_to; pass location_id (or location_ids) when the user names a site.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        period_to: { type: 'string', description: 'End date YYYY-MM-DD' },
        location_id: { type: 'string', description: 'Practice-locations UUID for a single site.' },
        location_ids: { type: 'array', items: { type: 'string' }, description: 'Multiple practice-locations UUIDs.' },
      },
    },
  },
  {
    name: 'compare_doctors',
    description: 'Side-by-side comparison of exactly 2 providers on a metric.',
    input_schema: {
      type: 'object',
      properties: {
        doctor1_name: { type: 'string' },
        doctor2_name: { type: 'string' },
        metric: { type: 'string', enum: ['revenue', 'profit', 'production', 'patients'] },
        period_from: { type: 'string' },
        period_to: { type: 'string' },
      },
      required: ['doctor1_name', 'doctor2_name', 'metric'],
    },
  },
  {
    name: 'compare_periods',
    description: 'Compare the same metric across 2 time periods.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'profit', 'cashflow', 'patients'] },
        period1_from: { type: 'string' },
        period1_to: { type: 'string' },
        period2_from: { type: 'string' },
        period2_to: { type: 'string' },
        doctor_name: { type: 'string' },
      },
      required: ['metric', 'period1_from', 'period1_to', 'period2_from', 'period2_to'],
    },
  },
  {
    name: 'get_cashflow_data',
    description: 'Cashflow breakdown (received, paid, net) and cash balance. Always practice-wide. Set metric="balance" when the user asks about closing balance, opening balance, cash position, cash on hand, or bank balance — returns a focused balance card. Default (metric omitted) returns the inflow/outflow overview.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        metric: { type: 'string', enum: ['flow', 'balance'], description: 'flow (default) for received/paid/net; balance for closing/opening cash balance' },
      },
    },
  },
  {
    name: 'get_treatment_revenue',
    description: 'Revenue breakdown by treatment category (default) or by individual treatment. Set dimension="treatment" when the user asks "which treatment(s)..." or wants per-treatment detail; default "category". Set sort="asc" when the user says "lowest", "least", "bottom", "worst"; default "desc" for "top", "highest", "best". Optional payor filter. Pass location_id when the user names a single practice ("at south street", "TLF treatments"); pass location_ids for multi-site asks ("south street and wigmore").',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        payor: { type: 'string', enum: ['nhs', 'private', 'membership', 'all'] },
        dimension: { type: 'string', enum: ['category', 'treatment'], description: 'category (default) or individual treatment name' },
        sort: { type: 'string', enum: ['asc', 'desc'], description: 'asc = lowest first, desc = highest first (default)' },
        location_id: { type: 'string', description: 'Practice-locations UUID. Set when the user names a single site.' },
        location_ids: { type: 'array', items: { type: 'string' }, description: 'Multiple practice-locations UUIDs. Use for "south street and wigmore" style multi-site asks.' },
      },
    },
  },
  {
    name: 'get_chair_metrics',
    description: 'Chair utilization, occupancy, revenue per chair, peak hours, and low-utilisation hours. When the user is on the /chairs page the chatbot reads the page\'s computed data directly so the numbers reconcile exactly with what they see; otherwise calls the RPC. Pass location_id when the user names a site so the result is scoped (the RPC returns every location otherwise).',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        location_id: { type: 'string', description: 'Practice-locations UUID. Set when the user names a single site.' },
        location_ids: { type: 'array', items: { type: 'string' }, description: 'Multiple practice-locations UUIDs.' },
      },
    },
  },
  {
    name: 'get_location_metrics',
    description: 'Per-location KPIs: revenue, profit, collection rate, AR days. When the user is on a payor-scoped page (Private Treatment / NHS / Membership), set payor so the per-location revenue matches the page\'s payor-filtered card. Without it the table shows all-payor revenue and the numbers do not reconcile with the page.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        payor: { type: 'string', enum: ['private', 'nhs', 'membership'] },
      },
    },
  },
  {
    name: 'get_cost_breakdown',
    description: 'Cost analysis by category: lab, staff, lease, clinician, overhead, material.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        category: { type: 'string', enum: ['lab', 'staff', 'lease', 'clinician', 'overhead', 'material', 'all'] },
      },
    },
  },
  {
    name: 'get_profit_and_loss',
    description: 'Full P&L for the period vs the immediately-prior period of equal length, with variance £ and variance %. Same shape as the Profitability page: Revenue → Cost of Sales → Gross Profit (margin %) → Operating expenses → EBITDA (margin %). Use whenever the user asks for P&L, profit and loss, profitability, income statement, profit margin trend, net profit vs last month, "is profitability improving?", "how is profit doing", "profit comparison", "profitability dashboard". Examples: "show our P&L for March 2026", "profitability this quarter", "profit and loss vs last month", "is profitability improving", "P&L compared to prior period". Returns a side-by-side comparison + variance + headline interpretation (improving / worsening / margin pressure) + NASDAL benchmark verdict.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        period_to:   { type: 'string', description: 'End date YYYY-MM-DD' },
        location_id: { type: 'string' },
      },
      required: ['period_from', 'period_to'],
    },
  },
  {
    name: 'list_providers',
    description: 'Roster of every active provider in the organisation, with revenue, days worked, appointment counts (completed / cancelled / DNA), unique patient count and rank for the period. Same shape as the Practitioner History page. Use whenever the user asks for a LIST of providers, top/bottom providers, the provider directory, a comparison table across providers, "show all dentists / hygienists / therapists", or who is in the team. Examples: "list all dentists", "show top 5 providers by revenue", "list providers at South Street", "who are the hygienists this year", "provider directory", "practitioner list", "show me all the dentists in March 2026", "rank providers by production". Pass period_from / period_to (asks if missing), location_id if scoped, and provider_type (Dentist / Hygienist / Therapist / Other) when the user names a role.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        period_to:   { type: 'string', description: 'End date YYYY-MM-DD' },
        location_id: { type: 'string' },
        provider_type: { type: 'string', enum: ['Dentist', 'Hygienist', 'Therapist', 'Other'] },
      },
      required: ['period_from', 'period_to'],
    },
  },
  {
    name: 'get_ebitda',
    description: 'EBITDA + enterprise valuation snapshot for the practice (or a single location). Returns a P&L waterfall — Revenue → Gross profit → EBITDA → Enterprise value — using the same revenue source as the Production pages and the same cost-bucket mapping as the Cost Impact page. Use whenever the user asks about EBITDA, practice value, enterprise value, valuation, exit value, what the practice is worth, EBITDA margin, EBITDA bridge, EBITDA breakdown, or net earnings. Examples: "what is my EBITDA this month", "show practice valuation for Q1", "EBITDA at South Street last quarter", "what is the practice worth", "enterprise value for March 2026", "EBITDA margin", "EBITDA bridge". Do NOT route these to get_financial_metric (which only supports revenue/profit/cashflow/patients) or to general_question.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        period_to:   { type: 'string', description: 'End date YYYY-MM-DD' },
        location_id: { type: 'string' },
      },
      required: ['period_from', 'period_to'],
    },
  },
  {
    name: 'list_cost_transactions',
    description: 'Row-level cost detail: every individual invoice/journal line for a cost category in the period — supplier name, account, date, amount. Use for "transactions", "invoices", "bills", "supplier detail", or any ask for the underlying entries behind a cost total. Examples: "lab fees transactions in March", "show me every lab bill", "which suppliers did we pay for materials last month", "list all lab fee invoices", "lab fees supplier detail". Returns one row per line plus a top-suppliers summary. Distinct from list_cost_entries (which aggregates to day/week/month) and get_cost_breakdown (which returns category snapshot).',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        location_id: { type: 'string' },
        category: { type: 'string', description: 'Cost category: lab_fees, staff_costs, clinician_costs, material_costs, operating_leases, overheads, administrative_costs, cost_of_sales, all.' },
      },
      required: ['period_from', 'period_to', 'category'],
    },
  },
  {
    name: 'list_cost_entries',
    description: 'Time-series cost detail for a SPECIFIC expense category, grouped by day / week / month. Use whenever the user asks for date-wise / weekly / monthly detail of a cost category. Examples: "date wise lab fees cost details", "daily staff costs in March", "lab fees by month this year", "show me overheads day by day last quarter", "weekly material costs". Returns one row per date-bucket plus a line chart. Do NOT route these to drill_down_metric (that only handles revenue/profit/patients/cashflow) or to get_cost_breakdown (that returns a single-period category snapshot, not the time series).',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        location_id: { type: 'string' },
        category: {
          type: 'string',
          description: 'Cost category. One of: lab_fees, staff_costs, clinician_costs, material_costs, operating_leases, overheads, administrative_costs, cost_of_sales, all.',
        },
        group_by: {
          type: 'string',
          enum: ['day', 'week', 'month'],
          description: 'Bucket size for the time series. Default "day" (use this for "date wise" / "daily" / "by date" / "day by day"). "week" for weekly views, "month" for monthly.',
        },
      },
      required: ['period_from', 'period_to', 'category'],
    },
  },
  {
    name: 'drill_down_metric',
    description: 'Break down a metric by dimension: day (date-wise), month, provider, category, or payor. Returns chart data. Use "day" when the user says "by date", "date wise", "daily", or asks for a per-day breakdown.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'profit', 'patients', 'cashflow'] },
        dimension: { type: 'string', enum: ['day', 'month', 'provider', 'category', 'payor'] },
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        doctor_name: { type: 'string' },
      },
      required: ['metric', 'dimension'],
    },
  },
  {
    name: 'explain_why',
    description: 'Explain why a metric changed between the current and previous period. Shows top drivers. ALWAYS pass location_id when the user is asking a follow-up about a metric they just saw scoped to one location (e.g. "why is trend down 51% at South Street?") — without it the drivers are pulled from the whole org and can show the opposite direction to the slice the user is looking at.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'profit', 'cashflow', 'patients'] },
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        doctor_name: { type: 'string' },
        location_id: { type: 'string', description: 'Practice-locations UUID. Always set when the user is following up on a single-location number.' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'forecast_metric',
    description: 'Forecast a metric forward using linear regression on historical data. Returns chart.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'profit', 'patients'] },
        months_forward: { type: 'integer', description: 'Number of months to forecast (1-6)' },
        doctor_name: { type: 'string' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'what_if_scenario',
    description: 'What-if scenario: apply a percentage change to a baseline metric. Practice-wide only.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'profit'] },
        change_percent: { type: 'number', description: 'Percentage change (e.g. 10 for +10%, -5 for -5%)' },
        period_from: { type: 'string' },
        period_to: { type: 'string' },
      },
      required: ['metric', 'change_percent'],
    },
  },
  {
    name: 'generate_report',
    description: 'Generate a downloadable PDF report.',
    input_schema: {
      type: 'object',
      properties: {
        report_type: { type: 'string', enum: ['revenue', 'profit', 'pl', 'cashflow', 'provider', 'treatment', 'chair', 'location'] },
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        doctor_name: { type: 'string' },
      },
      required: ['report_type'],
    },
  },
  {
    name: 'email_report',
    description: 'Email a report as PDF attachment to a specified email address. Use this when the user says "email this report to ...", "send this to ...", "mail the report to ...". Get the report_type, doctor_name, and period from the PREVIOUS conversation.',
    input_schema: {
      type: 'object',
      properties: {
        email_address: { type: 'string', description: 'The email address to send the report to' },
        report_type: { type: 'string', enum: ['revenue', 'profit', 'pl', 'cashflow', 'provider', 'treatment', 'chair', 'location'] },
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        doctor_name: { type: 'string' },
      },
      required: ['email_address'],
    },
  },
  {
    name: 'multi_period_report',
    description: 'Side-by-side comparison of the same metric across 2-4 time periods (e.g. "Q1 vs Q2 vs Q3 P&L").',
    input_schema: {
      type: 'object',
      properties: {
        report_type: { type: 'string', enum: ['revenue', 'profit', 'pl'] },
        periods: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of period labels, e.g. ["Q1", "Q2", "Q3"]. Max 4.',
        },
        doctor_name: { type: 'string' },
      },
      required: ['report_type', 'periods'],
    },
  },
  {
    name: 'year_over_year_report',
    description: 'Compare a metric for the current period vs the same period last year (YoY).',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'profit'] },
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        doctor_name: { type: 'string' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'get_revenue_breakdown_report',
    description: 'Comprehensive revenue breakdown showing total + per-provider + per-treatment + per-category in one combined response. Use this for compound questions like "treatment wise, practitioner wise, category wise revenue", "give me a full revenue report", or any phrasing that asks for revenue split across multiple dimensions at once.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        period_to: { type: 'string', description: 'End date YYYY-MM-DD' },
        location_id: { type: 'string' },
      },
    },
  },
  {
    name: 'list_dna_patients',
    description: 'Returns the row-level list of DNA (Did Not Attend) appointments — patient name, scheduled date, and the date the appointment was booked — for a given location and period. Use whenever the user wants the actual patients behind a DNA count: "list the 35 DNA patients", "show DNA patients", "who didn\'t attend in March 2026", "names of the DNAs at South Street last month", "when were those DNAs booked". Pulls directly from the appointments table; do NOT route these row-level asks to get_attendance_metric (that only returns counts).',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        period_to: { type: 'string', description: 'End date YYYY-MM-DD' },
        location_id: { type: 'string' },
      },
      required: ['period_from', 'period_to'],
    },
  },
  {
    name: 'list_cancelled_patients',
    description: 'Returns the row-level list of CANCELLED appointments — patient name, scheduled date, booked-on date, and cancelled-on date — for a given location and period. Use whenever the user wants the actual patients behind a cancellation count: "list the cancelled appointments", "list cancelled patients list", "show cancelled patients", "names of the cancellations", "who cancelled in March 2026", "when were the cancellations booked". Pulls directly from the appointments table. Do NOT route these row-level asks to get_attendance_metric or general_question.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        period_to: { type: 'string', description: 'End date YYYY-MM-DD' },
        location_id: { type: 'string' },
      },
      required: ['period_from', 'period_to'],
    },
  },
  {
    name: 'list_appointments',
    description: 'Returns the row-level list of appointments at any state (DNA, cancelled, completed, scheduled, or all) — patient name, practitioner, scheduled time, booked-on, and state-specific timestamps — for a given location and period. Use for any row-level appointment query that is NOT covered by list_dna_patients or list_cancelled_patients. Examples: "list completed appointments at South Street last month", "show today\'s scheduled appointments", "list all appointments by Dr Smith in March", "show appointments by patient X". Pulls directly from the appointments table. Do NOT route these to get_attendance_metric or general_question.',
    input_schema: {
      type: 'object',
      properties: {
        period_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        period_to: { type: 'string', description: 'End date YYYY-MM-DD' },
        location_id: { type: 'string' },
        state: {
          type: 'string',
          description: 'Appointment state filter. One of: "dna", "cancelled", "completed", "scheduled", "any". Default "any" (no filter).',
        },
      },
      required: ['period_from', 'period_to'],
    },
  },
  {
    name: 'general_question',
    description: 'Use for: (a) greetings, help, or definitional questions; (b) STRATEGIC / ADVISORY questions that ask for an opinion or recommendation rather than a stored number — e.g. "how can I reduce costs", "how do we grow profit", "what should I do", "any suggestions", "which providers need attention", "is this healthy", "ideas to improve EBITDA". These are answered from the current page by a snapshot-grounded advisor — never route them to get_financial_metric / explain_why / forecast_metric.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
      },
    },
  },
];

async function classify(message, context, mentions, pageContext, orgApiKey, recentHistory, imageBlocks) {
  // Load providers for name matching
  const { supabaseAdmin } = require('../../config/supabase');
  const { data: providers } = await supabaseAdmin
    .from('providers')
    .select('name')
    .eq('organization_id', context.organizationId)
    .is('deleted_at', null);

  const systemPrompt = buildSystemPrompt(context, providers || []);

  // Build messages array with recent history for follow-up understanding
  const messages = [];
  if (recentHistory && recentHistory.length > 0) {
    // Include last 4 messages (2 turns) for context
    for (const msg of recentHistory.slice(-4)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // If images are attached, send a multimodal content array; otherwise plain text.
  if (Array.isArray(imageBlocks) && imageBlocks.length > 0) {
    const content = [...imageBlocks];
    content.push({ type: 'text', text: message || 'Please analyse the attached image(s) in the context of this practice.' });
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: message });
  }

  const result = await claudeClient.callWithTools({
    apiKey: orgApiKey.apiKey,
    model: orgApiKey.intentModel,
    systemPrompt,
    messages,
    tools: TOOL_DEFINITIONS,
    organizationId: context.organizationId,
    userId: null,
    feature: 'chatbot-intent',
  });

  return {
    toolName: result.toolName,
    args: result.args || {},
    textResponse: result.textResponse || null,
    classifiedBy: Array.isArray(imageBlocks) && imageBlocks.length > 0 ? 'llm-vision' : 'llm',
  };
}

module.exports = { classify, TOOL_DEFINITIONS };
