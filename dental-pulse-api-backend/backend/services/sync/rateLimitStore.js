/**
 * Dentally rate-limit cooldown store — database-backed, JSON file kept as a
 * warm fallback.
 *
 * The client tracks cooldown as an epoch-ms number; the table stores it as a
 * TIMESTAMPTZ, so this module converts at the boundary.
 *
 * integrationId is optional. Dentally throttles per connected account, so the
 * table is keyed by integration_id; passing null uses the global row, which
 * matches the client's current process-wide cooldown.
 */

const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../../config/supabase');

const COOLDOWN_STATE_FILE = path.join(__dirname, '..', '..', 'config', 'dentallyRateLimitState.json');

/** Synchronous file read — used at module init before any await is possible. */
function loadCooldownFromFile() {
  try {
    const s = JSON.parse(fs.readFileSync(COOLDOWN_STATE_FILE, 'utf8'));
    return typeof s.cooldownUntil === 'number' ? s.cooldownUntil : 0;
  } catch {
    return 0;
  }
}

function writeCooldownToFile(cooldownUntil) {
  try {
    fs.writeFileSync(COOLDOWN_STATE_FILE, JSON.stringify({ cooldownUntil }), 'utf8');
  } catch {
    // Non-fatal — in-memory cooldown still works for this process.
  }
}

function baseQuery(integrationId) {
  const q = supabaseAdmin.from('dentally_rate_limit_state');
  return { q, filter: (b) => (integrationId ? b.eq('integration_id', integrationId) : b.is('integration_id', null)) };
}

/**
 * Read the persisted cooldown (epoch ms, 0 = none) from the DB.
 * Falls back to the file when the DB is unreachable.
 */
async function loadCooldown(integrationId = null) {
  try {
    const { q, filter } = baseQuery(integrationId);
    const { data, error } = await filter(q.select('cooldown_until')).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || !data.cooldown_until) return 0;
    return new Date(data.cooldown_until).getTime();
  } catch (err) {
    console.warn('[DentallyRateLimit] DB read failed, using file fallback:', err.message);
    return loadCooldownFromFile();
  }
}

/**
 * Persist the cooldown. Never throws — a failure to record the cooldown must
 * not abort the sync that is already backing off in memory.
 */
async function persistCooldown(cooldownUntil, integrationId = null, remaining = null) {
  writeCooldownToFile(cooldownUntil);
  try {
    const row = {
      cooldown_until: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
      remaining,
      updated_at: new Date().toISOString(),
    };

    // Expression unique index (COALESCE(integration_id, sentinel)) cannot be
    // targeted by PostgREST on_conflict, so select-then-write.
    const { q, filter } = baseQuery(integrationId);
    const { data: existing } = await filter(q.select('id')).maybeSingle();

    if (existing) {
      await supabaseAdmin.from('dentally_rate_limit_state').update(row).eq('id', existing.id);
    } else {
      await supabaseAdmin
        .from('dentally_rate_limit_state')
        .insert({ integration_id: integrationId, ...row });
    }
  } catch (err) {
    console.warn('[DentallyRateLimit] DB write failed (file fallback written):', err.message);
  }
}

module.exports = {
  loadCooldownFromFile,
  loadCooldown,
  persistCooldown,
  COOLDOWN_STATE_FILE,
};
