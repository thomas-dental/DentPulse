/**
 * dentally_credentials helpers for PE auth / reconnection state.
 */

const { supabaseAdmin } = require('../../../config/supabase');

async function markCredentialsNeedReconnection(practiceId, message) {
  const { error } = await supabaseAdmin
    .from('dentally_credentials')
    .update({
      needs_reconnection: true,
      auth_error_message: message || null,
      auth_failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('practice_id', practiceId);

  if (error) {
    console.error('[PE sync] Failed to mark credentials needs_reconnection:', error.message);
  }
}

async function clearCredentialsNeedReconnection(practiceId) {
  const { error } = await supabaseAdmin
    .from('dentally_credentials')
    .update({
      needs_reconnection: false,
      auth_error_message: null,
      auth_failed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('practice_id', practiceId);

  if (error) {
    console.error('[PE sync] Failed to clear credentials needs_reconnection:', error.message);
  }
}

async function practiceNeedsReconnection(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('dentally_credentials')
    .select('needs_reconnection')
    .eq('practice_id', practiceId)
    .maybeSingle();

  if (error) {
    console.error('[PE sync] Failed to read needs_reconnection:', error.message);
    return false;
  }
  return data?.needs_reconnection === true;
}

module.exports = {
  markCredentialsNeedReconnection,
  clearCredentialsNeedReconnection,
  practiceNeedsReconnection,
};
