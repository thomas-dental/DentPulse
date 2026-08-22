/**
 * Sync settings store — public.sync_settings (global row, organization_id IS NULL)
 * is the single source of truth. There is no on-disk fallback: the old
 * config/syncSettings.json was removed because the API runs on hosts with an
 * ephemeral filesystem, so a redeploy silently reverted admin-configured date
 * ranges back to whatever was committed to the repo.
 *
 * Callers read these settings SYNCHRONOUSLY from queue/processor code paths
 * that are not async at that point, so the DB row is cached in memory and
 * exposed through a sync getter:
 *
 *   getSyncSettings()  -> sync, never throws, {} if the row has not loaded yet
 *   refresh()          -> async, pulls the DB row into the cache
 *   saveSyncSettings() -> async, writes the DB row and updates the cache
 *
 * server.js awaits refresh() before any queue initialises, so by the time a
 * sync job is built the cache is warm. If that boot load fails, refresh()
 * retries in the background rather than leaving the process permanently blind.
 */

const { supabaseAdmin } = require('../../config/supabase');

const RETRY_DELAYS_MS = [5000, 15000, 60000];

let cache = null;        // last known settings object (null = never loaded)
let loadedFromDb = false;
let warnedUnloaded = false;
let retryTimer = null;

/**
 * Synchronous read. Returns {} until refresh() has populated the cache —
 * callers each apply their own documented defaults for missing keys, which is
 * the same behaviour they had when the config file was absent.
 */
function getSyncSettings() {
  if (cache) return cache;
  if (!warnedUnloaded) {
    warnedUnloaded = true;
    console.warn('[SyncSettings] Settings not loaded from DB yet — callers will use built-in defaults.');
  }
  return {};
}

function scheduleRetry(attempt) {
  if (retryTimer || attempt >= RETRY_DELAYS_MS.length) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    refresh(attempt + 1).catch(() => {});
  }, RETRY_DELAYS_MS[attempt]);
  // Do not hold the event loop open just for a settings retry.
  if (typeof retryTimer.unref === 'function') retryTimer.unref();
}

/**
 * Pull the global settings row into the cache. Safe to call repeatedly.
 * Never throws — on failure it keeps the previous cache and retries.
 */
async function refresh(attempt = 0) {
  try {
    const { data, error } = await supabaseAdmin
      .from('sync_settings')
      .select('settings')
      .is('organization_id', null)
      .maybeSingle();

    if (error) throw new Error(error.message);

    // No global row yet (DDL run but never seeded) — treat as empty rather
    // than failing, so an admin can populate it from the settings UI.
    cache = (data && data.settings && typeof data.settings === 'object') ? data.settings : {};
    loadedFromDb = true;
    warnedUnloaded = false;
    return cache;
  } catch (err) {
    console.error(
      `[SyncSettings] Failed to load sync_settings from DB (attempt ${attempt + 1}): ${err.message}`
    );
    scheduleRetry(attempt);
    return cache || {};
  }
}

/**
 * Persist the full settings object, then update the cache.
 */
async function saveSyncSettings(settings, updatedBy = null) {
  // The unique index is on COALESCE(organization_id, <sentinel>), an expression
  // index PostgREST cannot target with on_conflict — so select-then-write.
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('sync_settings')
    .select('id')
    .is('organization_id', null)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  const row = { settings, updated_by: updatedBy, updated_at: new Date().toISOString() };

  if (existing) {
    const { error } = await supabaseAdmin.from('sync_settings').update(row).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin
      .from('sync_settings')
      .insert({ organization_id: null, ...row });
    if (error) throw new Error(error.message);
  }

  cache = settings;
  loadedFromDb = true;
  return settings;
}

module.exports = {
  getSyncSettings,
  refresh,
  saveSyncSettings,
  isLoadedFromDb: () => loadedFromDb,
};
