/**
 * cashflowForecastPredict
 *
 * The 13-Week Cash Flow Forecast AI prediction, extracted from routes/cashflowForecast.js
 * so BOTH callers share one implementation:
 *   - POST /api/cashflow-forecast/predict  (a user opening the page)
 *   - aiForecastCron.js                    (the twice-daily scheduled refresh)
 *
 * Keeping this in one place matters: a second copy of the prompt + sanitiser would
 * drift, and the two callers would quietly disagree about the same practice's numbers.
 *
 * The frontend computes a deterministic baseline (recency-weighted run-rate forward;
 * NHS/membership/costs as monthly lumps). This hands that baseline to Claude and asks
 * it to PREDICT an adjusted set of forward numbers — applying trend, seasonality and
 * known payment cadence — grounded in the real figures it was given. It NEVER invents
 * rows and stays close to the baseline.
 *
 * Model: env override wins; otherwise the org's configured format model (the same model
 * the chatbot already uses — guaranteed available on this key), falling back to Sonnet.
 * This avoids a "model not found / no access" failure from hard-coding a model the
 * account may not have enabled.
 */
const { getOrgApiKey } = require('./chatbot/apiKeyService');
const claudeClient = require('./chatbot/claudeClient');

const ENV_MODEL = (process.env.CASHFLOW_FORECAST_MODEL || '').trim();

const PREDICTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    narrative: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    predictedRows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          values: { type: 'array', items: { type: 'number' } },
        },
        required: ['key', 'values'],
      },
    },
  },
  required: ['narrative', 'assumptions', 'predictedRows'],
};

const SYSTEM_PROMPT = `You are a dental-practice cash flow forecasting analyst inside DentPulse.

You receive a JSON payload describing a 13-week cash flow forecast for one practice location: the forecast weeks (with dates), and a list of line-item rows (both money IN and money OUT). Each row has:
- key: a stable identifier (use this exactly in your output)
- label: human name (e.g. "NHS", "Private", "Materials", "Payroll")
- section: "inflow" (money in) or "outflow" (money out / costs)
- cadence: "monthly-lump" (the whole monthly amount lands in ONE week per month and is 0 in the other weeks) or "weekly" (a real week-by-week pattern)
- baseline: an array of numbers, one per forecast week, built from this row's ACTUAL trailing 13-week records
- membership (OPTIONAL, only on membership/Denplan rows): the observed dynamics from the practice's uploaded membership sheet — currentMembers, avgRevenuePerMember, avgMonthlyJoiners (members added per month), avgMonthlyLeavers (members removed per month), monthlyChurnPct, monthsObserved, and monthlyActivity (a per-month history of { month, members, joiners, leavers, revenue }). Use this to trend each monthly lump.
- private (OPTIONAL, only on the Private treatment income row): the real drivers —
    · weeklyActivity: the TRAILING per-week history of { week, patients, revenue } (actual cash taken)
    · bookedAppointments: appointments ALREADY BOOKED in the diary for each FORECAST week, same order/length as the forecast weeks
    · diaryReliableWeeks: how many of those weeks have a genuinely filled diary
    · avgPatientsPerWeek, avgRevenuePerPatient, weeklyTrendPct (observed momentum per week)

Your job: PREDICT an adjusted set of weekly numbers for each row, grounded in its own past-13-week baseline. How you fill the weeks depends on the row's cadence (see rules 3 and 4).

HARD RULES:
1. Output one entry per INPUT row, using the SAME key, with exactly the same number of values as forecast weeks. Do not add, drop, rename, or merge rows.
2. Stay grounded in each row's own baseline: keep its 13-week TOTAL within roughly ±25% of the baseline total. Do NOT hallucinate numbers. EXCEPTION: the Private row (rule 3a) — there you build the numbers from the practice's real history and diary, so its total may differ from that mechanical baseline; rule 3d is its guardrail instead.
3. "weekly" rows (a real week-by-week pattern — e.g. Private treatment income, or ongoing costs like Materials/Lab Fees/Payroll): predict a realistic figure for EVERY week, then apply trend (gradual growth/decline) and seasonality (e.g. quieter holiday weeks). If the past was lumpy with empty weeks (typical for cost invoices), smooth it into a steady week-by-week run-rate — do not copy the £0 gaps. If the past already varies week to week (typical for income), KEEP that realistic week-to-week variation rather than flattening it. Either way, do not leave mid-period gaps.

3a. THE PRIVATE ROW — build this one YOURSELF from the data, do not just nudge its baseline. Its "baseline" is a mechanical run-rate and is only a sanity reference; the real inputs are "private.weeklyActivity" (what was actually taken each past week) and "private.bookedAppointments" (what is already in the diary for each forecast week). Method:
   (a) From weeklyActivity work out the practice's cash per booked week — roughly total revenue divided by total patients — and note how busy a typical week is.
   (b) For each forecast week i where i is less than diaryReliableWeeks: scale from bookedAppointments at that week. A week with clearly FEWER booked appointments than a typical week MUST forecast clearly LOWER, and a fuller week higher. This is the single most useful signal you have — a half-empty diary genuinely means a quiet cash week.
   (c) For weeks at or beyond diaryReliableWeeks: IGNORE bookedAppointments entirely. Those weeks look empty only because patients have not booked yet, NOT because they will be quiet. Use the typical week's cash instead, carried forward with the observed trend.
   (d) Keep the result inside the range the practice actually experiences in weeklyActivity — never below about a third of its quietest real week, never above about 1.5 times its busiest.
   Do not flatten Private into a constant: real weekly cash varies, and the diary tells you which weeks are the quiet ones.
4. "monthly-lump" rows (e.g. Membership — Denplan pays the practice once a month): KEEP the payment in the SAME weeks the baseline placed it (one lump per month) and £0 in every other week. Adjust only the size of each monthly lump (small trend/attrition is fine). Do NOT spread a monthly payment across the weeks — the cash genuinely arrives once a month. When a row has a "membership" object, size each monthly lump from its real dynamics: roll members forward by (avgMonthlyJoiners − avgMonthlyLeavers) per month from currentMembers, multiply by avgRevenuePerMember, and let monthlyActivity guide the direction (a base that is consistently losing more members than it gains should drift DOWN month over month, and vice versa). Keep the change gradual and within the ±25% guardrail.
5. All values are whole pounds (GBP), no currency symbols, no negatives.
6. If a row's baseline is entirely 0 across ALL weeks, leave it entirely 0 (there is no past record at all to predict from).

Also return:
- narrative: 2-3 plain-English sentences for the practice manager — the headline of how your prediction differs from the straight-line baseline, the highest-cash and tightest weeks, and one actionable observation. Be specific with weeks/dates and £ amounts. No markdown, no lists.
- assumptions: 2-4 short strings, each naming one adjustment you made and why (e.g. "Trimmed Private income ~8% in late-Aug weeks for the summer holiday dip").

Return ONLY the JSON object matching the schema.`;

function toNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Normalise the caller's raw rows into the exact shape the prompt documents. */
function normaliseRows(rows, n) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r && typeof r.key === 'string' && Array.isArray(r.baseline))
    .map(r => {
      const baseline = r.baseline.slice(0, n).map(toNum);
      while (baseline.length < n) baseline.push(0);
      const out = {
        key: r.key,
        label: String(r.label ?? r.key),
        section: r.section === 'outflow' ? 'outflow' : 'inflow',
        cadence: r.cadence === 'weekly' ? 'weekly' : 'monthly-lump',
        baseline,
      };
      // Membership rows carry the observed month-by-month add/remove activity
      // from the uploaded membership sheet — grounding for trending the lumps.
      if (r.membership && typeof r.membership === 'object') {
        const m = r.membership;
        const activity = Array.isArray(m.monthlyActivity)
          ? m.monthlyActivity.slice(-12).map(a => ({
              month: String(a?.month ?? ''),
              members: Math.round(toNum(a?.members)),
              joiners: Math.round(toNum(a?.joiners)),
              leavers: Math.round(toNum(a?.leavers)),
              revenue: Math.round(toNum(a?.revenue)),
            }))
          : [];
        out.membership = {
          currentMembers: Math.round(toNum(m.currentMembers)),
          avgRevenuePerMember: Math.round(toNum(m.avgRevenuePerMember)),
          avgMonthlyJoiners: toNum(m.avgMonthlyJoiners),
          avgMonthlyLeavers: toNum(m.avgMonthlyLeavers),
          monthlyChurnPct: toNum(m.monthlyChurnPct),
          monthsObserved: Math.round(toNum(m.monthsObserved)),
          monthlyActivity: activity,
        };
      }
      // Private rows carry the trailing week-by-week patient counts AND revenue
      // so Claude forecasts from real volume × value, not just the revenue line.
      if (r.private && typeof r.private === 'object') {
        const p = r.private;
        const weekly = Array.isArray(p.weeklyActivity)
          ? p.weeklyActivity.slice(0, n).map((a, idx) => ({
              week: Math.round(toNum(a?.week)) || idx + 1,
              patients: Math.round(toNum(a?.patients)),
              revenue: Math.round(toNum(a?.revenue)),
            }))
          : [];
        // Booked appointments per FORECAST week (the diary) — padded/truncated to the
        // forecast length so index i always lines up with week i.
        const bookedRaw = Array.isArray(p.bookedAppointments) ? p.bookedAppointments.slice(0, n).map(toNum) : [];
        while (bookedRaw.length < n) bookedRaw.push(0);
        const reliable = Math.max(0, Math.min(n, Math.round(toNum(p.diaryReliableWeeks))));
        out.private = {
          avgPatientsPerWeek: toNum(p.avgPatientsPerWeek),
          avgRevenuePerPatient: Math.round(toNum(p.avgRevenuePerPatient)),
          weeklyTrendPct: toNum(p.weeklyTrendPct),
          weeklyActivity: weekly,
          bookedAppointments: bookedRaw.map((v) => Math.round(v)),
          diaryReliableWeeks: reliable,
        };
      }
      return out;
    });
}

/**
 * Generate the AI forecast for one location's baseline.
 *
 * @returns {Promise<{predictedRows: Array<{key:string, values:number[]}>, narrative: string, assumptions: string[], model: string}>}
 * @throws  {Error} with .status when the caller should surface a specific HTTP code.
 */
async function predictForecast({ organizationId, locationLabel, period, weeks, rows, userId = null }) {
  if (!organizationId) {
    const e = new Error('organizationId is required');
    e.status = 400;
    throw e;
  }
  if (!Array.isArray(weeks) || weeks.length === 0 || !Array.isArray(rows)) {
    const e = new Error('weeks (non-empty) and rows are required');
    e.status = 400;
    throw e;
  }
  const n = weeks.length;
  const inputRows = normaliseRows(rows, n);
  const metaByKey = new Map(inputRows.map(r => [r.key, r]));

  // Nothing has ever been recorded — there is nothing to predict FROM, and calling
  // Claude would only invent numbers. Return the empty result the page treats as "no AI".
  const hasData = inputRows.some(r => r.baseline.some(v => v !== 0));
  if (!hasData) {
    return { predictedRows: [], narrative: '', assumptions: [], model: ENV_MODEL || 'baseline' };
  }

  const { apiKey, formatModel } = await getOrgApiKey(organizationId);
  const model = ENV_MODEL || formatModel || 'claude-sonnet-4-6';

  const userMessage = JSON.stringify({
    locationLabel: locationLabel || 'All locations',
    period: period || null,
    weeks: weeks.map((w, i) => ({ index: i, weekNumber: w.weekNumber ?? i + 1, date: w.date ?? w.iso ?? null })),
    rows: inputRows,
  });

  console.log(`[CASHFLOW-FORECAST-AI] predict: org=${organizationId}, model=${model}, weeks=${n}, rows=${inputRows.length}`);
  const result = await claudeClient.callForJson({
    apiKey,
    model,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    schema: PREDICTION_SCHEMA,
    feature: 'cashflow-forecast-ai',
    maxTokens: 4096,
    organizationId,
    userId,
  });
  if (!result || !Array.isArray(result.predictedRows)) {
    const e = new Error('AI did not return a usable forecast. Please try again.');
    e.status = 502;
    throw e;
  }

  // Sanitise: keep only known rows, coerce to whole non-negative pounds,
  // pad/truncate to exactly n weeks. A row with NO past record stays 0.
  // Cadence-aware: "weekly" rows are filled every week (capped at a full period's
  // spend); "monthly-lump" rows keep their payment in the SAME weeks the baseline
  // placed it and 0 elsewhere.
  const predictedRows = [];
  for (const pr of result.predictedRows) {
    if (!pr || typeof pr.key !== 'string') continue;
    const meta = metaByKey.get(pr.key);
    if (!meta) continue; // model invented a row — drop it
    const { baseline, cadence } = meta;
    const baseTotal = baseline.reduce((a, b) => a + (b || 0), 0);
    const rowHasData = baseTotal !== 0;
    const cap = baseTotal > 0 ? Math.round(baseTotal) : 0; // ≤ a full period's spend
    const src = Array.isArray(pr.values) ? pr.values : [];
    const values = [];
    for (let i = 0; i < n; i++) {
      if (!rowHasData) { values.push(0); continue; }
      if (cadence === 'monthly-lump' && (baseline[i] ?? 0) === 0) { values.push(0); continue; }
      let v = Math.max(0, Math.round(toNum(src[i])));
      if (cap > 0) v = Math.min(v, cap);
      values.push(v);
    }
    predictedRows.push({ key: pr.key, values });
  }

  return {
    predictedRows,
    narrative: typeof result.narrative === 'string' ? result.narrative : '',
    assumptions: Array.isArray(result.assumptions)
      ? result.assumptions.filter(a => typeof a === 'string').slice(0, 6)
      : [],
    model,
  };
}

module.exports = { predictForecast, SYSTEM_PROMPT, PREDICTION_SCHEMA };
