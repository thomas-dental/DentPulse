const { supabaseAdmin } = require('../../../config/supabase');

async function createSyncRun(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('sync_runs')
    .insert({
      practice_id: practiceId,
      status: 'running',
    })
    .select('id, started_at')
    .single();

  if (error) {
    throw new Error(`Failed to create sync run: ${error.message}`);
  }

  return data;
}

async function completeSyncRun(syncRunId, status, errorMessage = null) {
  const payload = {
    status,
    completed_at: new Date().toISOString(),
  };
  if (errorMessage != null) payload.error_message = errorMessage;

  const { error } = await supabaseAdmin
    .from('sync_runs')
    .update(payload)
    .eq('id', syncRunId);

  if (error) {
    throw new Error(`Failed to update sync run: ${error.message}`);
  }
}

module.exports = {
  createSyncRun,
  completeSyncRun,
};
