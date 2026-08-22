export interface Suggestion {
  icon: string;
  text: string;
}

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { icon: '📊', text: "What was our revenue last year?" },
  { icon: '💰', text: "Show me profit by provider this month." },
  { icon: '🪑', text: "What is our chair utilisation rate?" },
  { icon: '🦷', text: "Break down treatment revenue by category." },
];

const ROUTE_SUGGESTIONS: { match: (path: string) => boolean; suggestions: Suggestion[] }[] = [
  {
    match: (p) => p === '/' || p === '/dashboard',
    suggestions: [
      { icon: '💰', text: "How much revenue did we make this month?" },
      { icon: '📈', text: "What is our current profit margin?" },
      { icon: '🏦', text: "What is our cash position today?" },
      { icon: '🪑', text: "What is our chair utilisation rate this month?" },
    ],
  },
  {
    match: (p) => p === '/performance',
    suggestions: [
      { icon: '📊', text: "How do this month's KPIs compare to last month?" },
      { icon: '👥', text: "Who are the top performing providers this month?" },
      { icon: '📍', text: "Which location performed best this quarter?" },
      { icon: '⚠️', text: "Which KPIs are below target right now?" },
    ],
  },
  {
    match: (p) => p.startsWith('/cashflow'),
    suggestions: [
      { icon: '🏦', text: "What is our closing cash balance this month?" },
      { icon: '⬆️', text: "What were the biggest cash inflows in the last 30 days?" },
      { icon: '⬇️', text: "What were the biggest cash outflows in the last 30 days?" },
      { icon: '📉', text: "Show net cash movement by month." },
    ],
  },
  {
    match: (p) => p === '/profitability' || p.startsWith('/profitability/'),
    suggestions: [
      { icon: '🏆', text: "How do we benchmark against peers?" },
      { icon: '📊', text: "Where are we below benchmark?" },
      { icon: '💡', text: "What actions would improve our benchmark?" },
      { icon: '📈', text: "Show the benchmark trend over time." },
    ],
  },
  {
    match: (p) => p.startsWith('/profitability'),
    suggestions: [
      { icon: '💰', text: "What is our gross profit this month?" },
      { icon: '📉', text: "What are the top expense categories this period?" },
      { icon: '🏥', text: "Show profit by location this quarter." },
      { icon: '📊', text: "How has profit margin trended over the last 6 months?" },
    ],
  },
  {
    match: (p) => p === '/tax',
    suggestions: [
      { icon: '🧾', text: "What is our VAT liability this quarter?" },
      { icon: '💼', text: "What is the estimated corporation tax this year?" },
      { icon: '📅', text: "What tax deadlines are coming up?" },
      { icon: '📊', text: "How much tax have we paid year to date?" },
    ],
  },
  {
    match: (p) => p === '/budget' || p.startsWith('/planning'),
    suggestions: [
      { icon: '🎯', text: "How are we tracking budget vs actual this month?" },
      { icon: '⚠️', text: "Where are we over budget?" },
      { icon: '📈', text: "Forecast revenue for next quarter." },
      { icon: '👥', text: "Show me the associate planning summary." },
    ],
  },
  {
    match: (p) => p.startsWith('/locations/'),
    suggestions: [
      { icon: '💰', text: "What is this location's revenue this month?" },
      { icon: '👥', text: "Who are the top providers at this location?" },
      { icon: '📈', text: "Show this location's performance trend." },
      { icon: '🪑', text: "What is the chair utilisation here?" },
    ],
  },
  {
    match: (p) => p === '/locations',
    suggestions: [
      { icon: '🏆', text: "Which location performed best this month?" },
      { icon: '📊', text: "Show revenue by location." },
      { icon: '⚠️', text: "Which locations need attention?" },
      { icon: '📈', text: "Compare location growth across sites." },
    ],
  },
  {
    match: (p) => p.startsWith('/providers/') && p.split('/').length >= 4,
    suggestions: [
      { icon: '💰', text: "What is this provider's revenue this month?" },
      { icon: '🦷', text: "What are this provider's top treatments?" },
      { icon: '📈', text: "Show this provider's productivity trend." },
      { icon: '🎯', text: "How is this provider tracking against goal?" },
    ],
  },
  {
    match: (p) => p.startsWith('/providers'),
    suggestions: [
      { icon: '🏆', text: "Who are the top earning providers this month?" },
      { icon: '📊', text: "Show me the provider revenue breakdown." },
      { icon: '⏱️', text: "What are provider hours and utilisation?" },
      { icon: '📈', text: "Show the provider performance trend." },
    ],
  },
  {
    match: (p) => p === '/treatments/private',
    suggestions: [
      { icon: '💰', text: "What is our private revenue this month?" },
      { icon: '🦷', text: "What are the top private treatments?" },
      { icon: '👥', text: "Show private revenue by provider." },
      { icon: '📍', text: "Show private revenue by location." },
    ],
  },
  {
    match: (p) => p.startsWith('/treatments/membership'),
    suggestions: [
      { icon: '👥', text: "How many active members do we have?" },
      { icon: '💰', text: "What is our membership revenue this month?" },
      { icon: '📈', text: "How is member acquisition trending?" },
      { icon: '⚠️', text: "How many cancellations this period?" },
    ],
  },
  {
    match: (p) => p === '/treatments/nhs',
    suggestions: [
      { icon: '🦷', text: "How many NHS UDAs were delivered this period?" },
      { icon: '📊', text: "How are we tracking against UDA target?" },
      { icon: '👥', text: "Show NHS performance by provider." },
      { icon: '📍', text: "Show NHS performance by location." },
    ],
  },
  {
    match: (p) => p === '/treatments/profit-by-treatments',
    suggestions: [
      { icon: '💎', text: "Which are our most profitable treatments?" },
      { icon: '📉', text: "Which treatments are loss-making?" },
      { icon: '📊', text: "Show profit margin by treatment." },
      { icon: '🦷', text: "Show the treatment profit trend." },
    ],
  },
  {
    match: (p) => p === '/treatments/insights',
    suggestions: [
      { icon: '📈', text: "How is treatment volume trending?" },
      { icon: '🦷', text: "Which treatments are growing fastest?" },
      { icon: '📉', text: "Which treatments are declining?" },
      { icon: '💡', text: "How has the treatment mix changed?" },
    ],
  },
  {
    match: (p) => p.startsWith('/treatments'),
    suggestions: [
      { icon: '🦷', text: "Break down treatment revenue by category." },
      { icon: '🏆', text: "What are our top treatments this month?" },
      { icon: '👥', text: "Show treatments by provider." },
      { icon: '📈', text: "Show the treatment trend over the last 6 months." },
    ],
  },
  {
    match: (p) => p === '/chairs',
    suggestions: [
      { icon: '🪑', text: "What is our chair utilisation rate this month?" },
      { icon: '📊', text: "Show utilisation by location." },
      { icon: '⚠️', text: "Which chairs are underutilised?" },
      { icon: '⏱️', text: "Compare booked vs available hours." },
    ],
  },
  {
    match: (p) => p.startsWith('/accounts-payable'),
    suggestions: [
      { icon: '🧾', text: "What is the total of outstanding bills?" },
      { icon: '📅', text: "Which bills are due this week?" },
      { icon: '⚠️', text: "Which bills are overdue?" },
      { icon: '👥', text: "Who are our top suppliers by spend?" },
    ],
  },
  {
    match: (p) => p === '/lab-fees' || p === '/lab-fees/view',
    suggestions: [
      { icon: '🧪', text: "What were our lab fees this month?" },
      { icon: '📊', text: "What percentage of revenue goes to lab fees?" },
      { icon: '👥', text: "Show lab fees by provider." },
      { icon: '📈', text: "Show the lab fee trend." },
    ],
  },
  {
    match: (p) => p === '/staff-costs',
    suggestions: [
      { icon: '👥', text: "What were total staff costs this month?" },
      { icon: '📊', text: "What is staff cost as a percentage of revenue?" },
      { icon: '📍', text: "Show staff cost by location." },
      { icon: '📈', text: "Show the staff cost trend." },
    ],
  },
  {
    match: (p) => p === '/clinician-costs',
    suggestions: [
      { icon: '🩺', text: "What were clinician costs this month?" },
      { icon: '📊', text: "How does clinician cost compare to revenue?" },
      { icon: '👥', text: "Show cost by clinician." },
      { icon: '📈', text: "Show the clinician cost trend over the last 6 months." },
    ],
  },
  {
    match: (p) => p === '/operating-leases',
    suggestions: [
      { icon: '🏢', text: "What are our total lease costs this month?" },
      { icon: '📅', text: "Which lease renewals are coming up?" },
      { icon: '📍', text: "Show lease cost by location." },
      { icon: '📊', text: "What percentage of overheads is lease cost?" },
    ],
  },
  {
    match: (p) => p === '/overhead-costs',
    suggestions: [
      { icon: '💸', text: "What were total overheads this month?" },
      { icon: '📊', text: "Break down overheads by type." },
      { icon: '📍', text: "Show overhead by location." },
      { icon: '📈', text: "Show the overhead trend." },
    ],
  },
  {
    match: (p) => p === '/material-costs',
    suggestions: [
      { icon: '🧰', text: "What were material costs this month?" },
      { icon: '📊', text: "What percentage of revenue goes to materials?" },
      { icon: '📍', text: "Show material cost by location." },
      { icon: '📈', text: "Show the material cost trend." },
    ],
  },
  {
    match: (p) => p === '/marketing-costs',
    suggestions: [
      { icon: '📣', text: "What were marketing costs this month?" },
      { icon: '📊', text: "What percentage of revenue goes to marketing?" },
      { icon: '📍', text: "Show marketing cost by location." },
      { icon: '📈', text: "Show the marketing cost trend." },
    ],
  },
  {
    match: (p) => p === '/cost-impact',
    suggestions: [
      { icon: '💸', text: "What are the biggest cost drivers this month?" },
      { icon: '📊', text: "Break down costs by category." },
      { icon: '📈', text: "Show the cost trend over the last 6 months." },
      { icon: '⚠️', text: "Which costs are growing fastest?" },
    ],
  },
  {
    match: (p) => p === '/marketing',
    suggestions: [
      { icon: '💰', text: "How much did we spend on marketing this month?" },
      { icon: '📊', text: "What is our marketing ROI?" },
      { icon: '👥', text: "What is our new patient acquisition cost?" },
      { icon: '📈', text: "Show the lead trend by channel." },
    ],
  },
  {
    match: (p) => p === '/reports',
    suggestions: [
      { icon: '📑', text: "Show me a profit and loss summary." },
      { icon: '🏦', text: "Show me a balance sheet summary." },
      { icon: '💵', text: "Show me the cash flow statement." },
      { icon: '📊', text: "Compare reports period over period." },
    ],
  },
  {
    match: (p) => p === '/ebitda-valuation',
    suggestions: [
      { icon: '💼', text: "What is our current EBITDA?" },
      { icon: '💰', text: "What is our estimated business valuation?" },
      { icon: '📈', text: "Show the EBITDA trend over the last 12 months." },
      { icon: '🎯', text: "How can we grow EBITDA?" },
    ],
  },
  {
    match: (p) => p === '/scenario-simulator',
    suggestions: [
      { icon: '🎯', text: "What is the impact of 10% revenue growth?" },
      { icon: '✂️', text: "What is the impact of a 5% cost reduction?" },
      { icon: '💼', text: "What is the best lever to improve EBITDA?" },
      { icon: '📊', text: "Compare scenarios side by side." },
    ],
  },
  {
    match: (p) => p === '/ebitda-bridge',
    suggestions: [
      { icon: '🌉', text: "Show me the EBITDA bridge for this year." },
      { icon: '📈', text: "Who are the top contributors to EBITDA?" },
      { icon: '📉', text: "What are the top drags on EBITDA?" },
      { icon: '💡', text: "What add-back opportunities do we have?" },
    ],
  },
  {
    match: (p) => p === '/quality-score',
    suggestions: [
      { icon: '🏅', text: "What is our current quality score?" },
      { icon: '⚠️', text: "What areas are dragging the score down?" },
      { icon: '💡', text: "How can we improve our quality score?" },
      { icon: '📈', text: "Show the quality score trend." },
    ],
  },
  {
    match: (p) => p === '/multiple-engine',
    suggestions: [
      { icon: '✖️', text: "What is our current EBITDA multiple?" },
      { icon: '📊', text: "What drives our multiple?" },
      { icon: '🎯', text: "What is our path to a higher multiple?" },
      { icon: '🏆', text: "What are peer multiples?" },
    ],
  },
  {
    match: (p) => p === '/due-diligence',
    suggestions: [
      { icon: '✅', text: "How is our due diligence readiness?" },
      { icon: '⚠️', text: "What are the top DD risks?" },
      { icon: '📑', text: "Which documents are missing?" },
      { icon: '💡', text: "What recommendations should we act on?" },
    ],
  },
  {
    match: (p) => p === '/group-heatmap',
    suggestions: [
      { icon: '🔥', text: "Which are the top performing locations?" },
      { icon: '⚠️', text: "Which locations are at risk?" },
      { icon: '📊', text: "Show the KPI heatmap by site." },
      { icon: '📈', text: "Where are the best growth opportunities?" },
    ],
  },
  {
    match: (p) => p === '/gap-analysis',
    suggestions: [
      { icon: '📉', text: "What are our top performance gaps?" },
      { icon: '💡', text: "What are the quick wins to close gaps?" },
      { icon: '📊', text: "Show gaps by value driver." },
      { icon: '🎯', text: "What are our priority actions?" },
    ],
  },
  {
    match: (p) => p === '/exit-cockpit',
    suggestions: [
      { icon: '🚪', text: "How exit-ready are we?" },
      { icon: '💼', text: "What is our estimated exit value?" },
      { icon: '⚠️', text: "What risks should we address before exit?" },
      { icon: '📅', text: "How long until we're exit-ready?" },
    ],
  },
  {
    match: (p) => p === '/location-history',
    suggestions: [
      { icon: '💰', text: "What is this location's total revenue and EBITDA?" },
      { icon: '🪑', text: "What is the collection rate and avg revenue per patient here?" },
      { icon: '📈', text: "Show the revenue trend for this location." },
      { icon: '👥', text: "Who are the top providers at this location?" },
    ],
  },
  {
    match: (p) => /^\/practitioner-history\/[^/]+/.test(p),
    suggestions: [
      { icon: '💰', text: "What is this practitioner's revenue this period?" },
      { icon: '📈', text: "Show this practitioner's performance trend." },
      { icon: '📍', text: "Which locations has this practitioner worked at?" },
      { icon: '🦷', text: "What treatments has this practitioner delivered?" },
    ],
  },
  {
    match: (p) => p === '/practitioner-history',
    suggestions: [
      { icon: '🏆', text: "Who are the top practitioners by revenue?" },
      { icon: '📊', text: "Compare practitioner activity across the list." },
      { icon: '⚠️', text: "Which practitioners need attention?" },
      { icon: '📈', text: "Show overall practitioner performance trend." },
    ],
  },
  {
    match: (p) => p === '/sync-summary',
    suggestions: [
      { icon: '🔄', text: "What is the last sync status?" },
      { icon: '⚠️', text: "Which sync jobs failed?" },
      { icon: '📅', text: "Show sync history this week." },
      { icon: '📊', text: "How many records were synced today?" },
    ],
  },
];

export function getPageSuggestions(pathname: string): Suggestion[] {
  for (const entry of ROUTE_SUGGESTIONS) {
    if (entry.match(pathname)) return entry.suggestions;
  }
  return DEFAULT_SUGGESTIONS;
}
