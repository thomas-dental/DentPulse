/**
 * Dentally credential status helpers — reads/writes public.integrations
 * (encrypted_pat / encrypted_pat_iv / validated_at / needs_reconnection).
 */

const { supabaseAdmin } = require('../../../config/supabase');
const {
  findEncryptedDentallyCredential,
} = require('../integrationCredentials');

async function markCredentialsNeedReconnection(practiceId, message) {
  const row = await findEncryptedDentallyCredential(practiceId);
  if (!row) return;

  const { error } = await supabaseAdmin
    .from('integrations')
    .update({
      needs_reconnection: true,
      auth_error_message: message || null,
      auth_failed_at: new Date().toISOString(),
      validated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('organization_id', practiceId);

  if (error) {
    console.error('[PE sync] Failed to mark credentials needs_reconnection:', error.message);
  }
}

async function clearCredentialsNeedReconnection(practiceId) {
  const row = await findEncryptedDentallyCredential(practiceId);
  if (!row) return;

  const { error } = await supabaseAdmin
    .from('integrations')
    .update({
      needs_reconnection: false,
      auth_error_message: null,
      auth_failed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('organization_id', practiceId);

  if (error) {
    console.error('[PE sync] Failed to clear credentials needs_reconnection:', error.message);
  }
}

async function practiceNeedsReconnection(practiceId) {
  try {
    const row = await findEncryptedDentallyCredential(practiceId);
    return row?.needs_reconnection === true;
  } catch (err) {
    console.error('[PE sync] Failed to read needs_reconnection:', err.message);
    return false;
  }
}

/**
 * Valid for auto-schedule: encrypted PAT present, not flagged for reconnection,
 * and validated_at set (Day 2 validate flow).
 * @returns {Promise<{ ok: boolean, reason?: string, row?: object }>}
 */
async function getPracticePatValidity(practiceId) {
  try {
    const row = await findEncryptedDentallyCredential(practiceId);
    if (!row) {
      return { ok: false, reason: 'no_credential' };
    }
    if (row.needs_reconnection === true) {
      return { ok: false, reason: 'needs_reconnection', row };
    }
    if (!row.validated_at) {
      return { ok: false, reason: 'not_validated', row };
    }
    return { ok: true, row };
  } catch (err) {
    console.error('[PE sync] Failed to read PAT validity:', err.message);
    return { ok: false, reason: 'lookup_error' };
  }
}

async function practiceHasValidPat(practiceId) {
  const v = await getPracticePatValidity(practiceId);
  return v.ok;
}

/**
 * Practices that have a Dentally encrypted_pat row (candidates for schedule).
 * Callers still apply getPracticePatValidity for skip/run decisions.
 */
async function listPracticesWithEncryptedPat(limit = 100) {
  const { data, error } = await supabaseAdmin
    .from('integrations')
    .select(
      'id, organization_id, validated_at, needs_reconnection, encrypted_pat'
    )
    .ilike('integration_name', 'Dentally')
    .is('deleted_at', null)
    .not('encrypted_pat', 'is', null)
    .order('organization_id', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list Dentally PAT practices: ${error.message}`);
  }

  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    const id = row.organization_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      practiceId: id,
      validatedAt: row.validated_at,
      needsReconnection: row.needs_reconnection === true,
    });
  }
  return out;
}

module.exports = {
  markCredentialsNeedReconnection,
  clearCredentialsNeedReconnection,
  practiceNeedsReconnection,
  getPracticePatValidity,
  practiceHasValidPat,
  listPracticesWithEncryptedPat,
};
