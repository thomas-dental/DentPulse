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

module.exports = {
  markCredentialsNeedReconnection,
  clearCredentialsNeedReconnection,
  practiceNeedsReconnection,
};
