/**
 * aiForecastCron
 *
 * Regenerates the 13-Week Cash Flow Forecast AI prediction on a schedule (default
 * TWICE A DAY, 07:00 and 19:00 Europe/London) so the page shows a ready AI forecast
 * on open instead of requiring a manual click.
 *
 * Why a cron + a persisted baseline (the same shape as cashflowThresholdCron):
 *  - The 13-week baseline is computed in the FRONTEND (useCashflowForecast), so this
 *    process cannot recompute it without a second, drift-prone copy of that engine.
 *  - The browser therefore PERSISTS its computed baseline payload into
 *    `cashflow_forecast_overrides` (section 'ai_baseline', line_key
 *    'ai_forecast_baseline', JSON in `line_label`) — see the frontend hook
 *    useAiForecastSnapshotSync.
 *  - This cron reads those baselines, asks Claude for the adjusted numbers via the
 *    shared services/cashflowForecastPredict, and writes the result back as section
 *    'ai_forecast'. The page then renders that stored result immediately.
 *
 * ── HONEST LIMITATION, do not oversell ──────────────────────────────────────────
 * The stored BASELINE is only as fresh as the last time someone opened the forecast
 * page for that scope. Re-running the AI on a stale baseline refreshes the narrative,
 * not the underlying numbers. We therefore SKIP baselines older than STALE_DAYS and
 * stamp `baselineComputedAt` on every result so the UI can say how old the inputs are.
 * Regenerating more often also does NOT make a forecast more accurate — weekly cash is
 * genuinely noisy; frequency buys freshness, not predictive power.
 *
 * Reusing `cashflow_forecast_overrides` (rather than a dedicated table) follows the
 * proven pattern in this codebase: a previous dedicated table failed on a missing RLS
 * helper (`user_in_org`), and both the Bills feature and the threshold status solved it
 * the same way. No migration required.
 */
const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');
const { predictForecast } = require('./cashflowForecastPredict');

// Twice daily by default: 07:00 (before the practice opens) and 19:00 (after close).
const SCHEDULE = process.env.AI_FORECAST_CRON_SCHEDULE || '0 7,19 * * *';
const TIMEZONE = process.env.AI_FORECAST_CRON_TIMEZONE || 'Europe/London';
// Don't spend Claude calls on a projection nobody has opened in over a week.
const STALE_DAYS = Number(process.env.AI_FORECAST_CRON_STALE_DAYS || 8);
// Serial, with a small gap: these are long Claude calls and every org shares rate limits.
const GAP_MS = Number(process.env.AI_FORECAST_CRON_GAP_MS || 1500);
const MAX_PER_RUN = Number(process.env.AI_FORECAST_CRON_MAX || 50);

const BASELINE_SECTION = 'ai_baseline';
const BASELINE_LINE_KEY = 'ai_forecast_baseline';
const RESULT_SECTION = 'ai_forecast';
const RESULT_LINE_KEY = 'ai_forecast_result';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Replace the single stored AI result for one (org, location) scope. */
async function writeResult({ orgId, locationId, anchorIso, payload }) {
  let del = supabaseAdmin
    .from('cashflow_forecast_overrides')
    .delete()
    .eq('organization_id', orgId)
    .eq('section', RESULT_SECTION)
    .eq('line_key', RESULT_LINE_KEY);
  del = locationId ? del.eq('location_id', locationId) : del.is('location_id', null);
  const { error: delErr } = await del;
  if (delErr) throw new Error(`delete previous result: ${delErr.message}`);

  const { error: insErr } = await supabaseAdmin.from('cashflow_forecast_overrides').insert({
    organization_id: orgId,
    location_id: locationId,
    section: RESULT_SECTION,
    week_start: anchorIso,
    line_key: RESULT_LINE_KEY,
    line_label: JSON.stringify(payload),
    amount: 0,
    updated_at: new Date().toISOString(),
  });
  if (insErr) throw new Error(`insert result: ${insErr.message}`);
}

async function runAiForecastRefresh() {
  const staleBefore = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

  const { data: baselines, error } = await supabaseAdmin
    .from('cashflow_forecast_overrides')
    .select('organization_id, location_id, week_start, line_label, updated_at')
    .eq('section', BASELINE_SECTION)
    .eq('line_key', BASELINE_LINE_KEY);
  if (error) {
    console.error('[ai-forecast-cron] read baselines failed:', error.message);
    return;
  }

  const due = [];
  for (const row of baselines || []) {
    let parsed;
    try { parsed = JSON.parse(row.line_label || '{}'); } catch { continue; }
    const computedAt = parsed.computedAt ? new Date(parsed.computedAt).getTime() : 0;
    if (computedAt < staleBefore) continue;               // nobody has opened it recently
    if (!Array.isArray(parsed.weeks) || !parsed.weeks.length) continue;
    if (!Array.isArray(parsed.rows) || !parsed.rows.length) continue;
    due.push({
      orgId: row.organization_id,
      locationId: row.location_id ?? null,
      anchorIso: row.week_start,
      parsed,
    });
  }

  if (due.length === 0) {
    console.log('[ai-forecast-cron] no fresh baselines — nothing to refresh');
    return;
  }

  const batch = due.slice(0, MAX_PER_RUN);
  if (due.length > batch.length) {
    // Never silently truncate — say what was dropped.
    console.warn(`[ai-forecast-cron] ${due.length} baselines due but MAX_PER_RUN=${MAX_PER_RUN}; ${due.length - batch.length} deferred to the next run`);
  }

  let ok = 0;
  let failed = 0;
  for (const item of batch) {
    const scope = `${item.orgId.slice(0, 8)}/${item.locationId ? item.locationId.slice(0, 8) : 'all'}`;
    try {
      const result = await predictForecast({
        organizationId: item.orgId,
        locationLabel: item.parsed.locationLabel,
        period: item.parsed.period,
        weeks: item.parsed.weeks,
        rows: item.parsed.rows,
        userId: null, // scheduled run — not attributable to a user
      });
      await writeResult({
        orgId: item.orgId,
        locationId: item.locationId,
        anchorIso: item.anchorIso,
        payload: {
          ...result,
          anchorIso: item.anchorIso,
          locationLabel: item.parsed.locationLabel ?? null,
          // Both stamps matter: how old the INPUTS were vs when we ran. The UI needs
          // the first to be honest about staleness.
          baselineComputedAt: item.parsed.computedAt ?? null,
          generatedAt: new Date().toISOString(),
          generatedBy: 'cron',
        },
      });
      ok++;
    } catch (e) {
      failed++;
      console.error(`[ai-forecast-cron] ${scope} failed: ${e?.message}`);
    }
    if (GAP_MS > 0) await sleep(GAP_MS);
  }

  console.log(`[ai-forecast-cron] done — ${ok} refreshed, ${failed} failed, of ${batch.length} due`);
}

function startAiForecastCron() {
  if (!cron.validate(SCHEDULE)) {
    console.error(`[ai-forecast-cron] invalid AI_FORECAST_CRON_SCHEDULE "${SCHEDULE}" — cron not started`);
    return;
  }
  cron.schedule(SCHEDULE, () => {
    runAiForecastRefresh().catch((e) => console.error('[ai-forecast-cron] run failed:', e.message));
  }, { timezone: TIMEZONE });
  console.log(`[ai-forecast-cron] scheduled "${SCHEDULE}" (${TIMEZONE})`);
}

module.exports = { startAiForecastCron, runAiForecastRefresh };
