/**
 * Per-practice Dentally sync window from onboarding (user start_date / end_date).
 *
 * Stored in public.sync_settings (organization_id = practiceId).
 * getPracticeSyncRange() uses sync_start_date → today for PE pull caps
 * (ongoing syncs catch up to present). Onboarding jobs use the stored end as-is.
 */

const { supabaseAdmin } = require('../../../config/supabase');
const { todayUtc } = require('./cursorStore');

const DEFAULT_START =
  process.env.PE_SYNC_DEFAULT_START ||
  process.env.PE_SYNC_APPOINTMENTS_START ||
  '2020-01-01';

function isYmd(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Persist the onboarding (or settings) sync range for a practice.
 * Both bounds come from the user picker on onboarding.
 */
async function savePracticeSyncRange(practiceId, startDate, endDate = null) {
  if (!practiceId || !isYmd(startDate)) {
    throw new Error('savePracticeSyncRange requires practiceId and YYYY-MM-DD startDate');
  }
  if (endDate != null && !isYmd(endDate)) {
    throw new Error('savePracticeSyncRange endDate must be YYYY-MM-DD when provided');
  }

  const { data: existing, error: selErr } = await supabaseAdmin
    .from('sync_settings')
    .select('id, settings')
    .eq('organization_id', practiceId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  const prev =
    existing?.settings && typeof existing.settings === 'object' ? existing.settings : {};
  const settings = {
    ...prev,
    sync_start_date: startDate,
    sync_end_date: isYmd(endDate) ? endDate : prev.sync_end_date || startDate,
  };
  const row = {
    settings,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabaseAdmin
      .from('sync_settings')
      .update(row)
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin.from('sync_settings').insert({
      organization_id: practiceId,
      ...row,
    });
    if (error) throw new Error(error.message);
  }

  return { startDate: settings.sync_start_date, endDate: settings.sync_end_date };
}

async function startFromSettings(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('sync_settings')
    .select('settings')
    .eq('organization_id', practiceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const start = data?.settings?.sync_start_date;
  return isYmd(start) ? start : null;
}

async function startFromSyncJobs(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('sync_jobs')
    .select('start_date')
    .eq('organization_id', practiceId)
    .not('start_date', 'is', null)
    .order('start_date', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const start = data?.[0]?.start_date;
  if (!start) return null;
  const ymd = String(start).slice(0, 10);
  return isYmd(ymd) ? ymd : null;
}

/**
 * @returns {Promise<{ startDate: string, endDate: string, source: string }>}
 */
async function getPracticeSyncRange(practiceId) {
  const endDate = todayUtc();

  try {
    const fromSettings = await startFromSettings(practiceId);
    if (fromSettings) {
      return {
        startDate: fromSettings > endDate ? endDate : fromSettings,
        endDate,
        source: 'sync_settings',
      };
    }
  } catch (err) {
    console.warn(
      `[PE sync range] settings read failed for ${practiceId.slice(0, 8)}…:`,
      err.message
    );
  }

  try {
    const fromJobs = await startFromSyncJobs(practiceId);
    if (fromJobs) {
      return {
        startDate: fromJobs > endDate ? endDate : fromJobs,
        endDate,
        source: 'sync_jobs',
      };
    }
  } catch (err) {
    console.warn(
      `[PE sync range] sync_jobs read failed for ${practiceId.slice(0, 8)}…:`,
      err.message
    );
  }

  return {
    startDate: DEFAULT_START > endDate ? endDate : DEFAULT_START,
    endDate,
    source: 'env_default',
  };
}

module.exports = {
  DEFAULT_START,
  savePracticeSyncRange,
  getPracticeSyncRange,
};
