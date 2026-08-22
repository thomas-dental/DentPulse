/**
 * Sync job logger - updates sync_jobs table and logs to console.
 */

const { supabaseAdmin } = require('../../config/supabase');

/**
 * Update sync job progress in the database.
 */
async function updateJobProgress(jobId, updates) {
  const { error } = await supabaseAdmin
    .from('sync_jobs')
    .update(updates)
    .eq('id', jobId);

  if (error) {
    console.error(`[SyncLogger] Failed to update job ${jobId}:`, error.message);
  }
}

/**
 * Append a permanent record of how this run finished to sync_run_history.
 *
 * sync_jobs is mutable working state that the queue cleans up and re-queues,
 * so it cannot answer "how has this org's sync behaved over time". Called
 * AFTER the terminal status update so the job row already holds final counts.
 *
 * Never throws: failing to write history must not fail the sync itself.
 */
async function recordRunHistory(jobId, status) {
  try {
    const { data: job, error } = await supabaseAdmin
      .from('sync_jobs')
      .select('id, organization_id, integration_id, entity_alias, started_at, records_processed, records_failed, current_page, total_pages, error_message')
      .eq('id', jobId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!job) return;

    // duration_seconds is a GENERATED column — never insert it.
    const { error: insErr } = await supabaseAdmin.from('sync_run_history').insert({
      job_id: job.id,
      organization_id: job.organization_id,
      integration_id: job.integration_id,
      entity_alias: job.entity_alias,
      status,
      records_processed: job.records_processed || 0,
      records_failed: job.records_failed || 0,
      current_page: job.current_page,
      total_pages: job.total_pages,
      error_message: job.error_message,
      started_at: job.started_at,
      finished_at: new Date().toISOString(),
    });
    if (insErr) throw new Error(insErr.message);
  } catch (err) {
    console.error(`[SyncLogger] Failed to record run history for job ${jobId}:`, err.message);
  }
}

/**
 * Mark job as running.
 */
async function markRunning(jobId) {
  await updateJobProgress(jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });
}

/**
 * Update page progress during sync.
 */
async function updatePageProgress(jobId, { currentPage, totalPages, recordsProcessed, recordsFailed }) {
  const progress = totalPages
    ? Math.min(95, Math.floor((currentPage / totalPages) * 100))
    : Math.min(95, Math.floor((currentPage / (currentPage + 5)) * 100));

  await updateJobProgress(jobId, {
    current_page: currentPage,
    total_pages: totalPages,
    records_processed: recordsProcessed,
    records_failed: recordsFailed,
    progress_percentage: progress,
  });
}

/**
 * Mark job as completed.
 */
async function markCompleted(jobId, { recordsProcessed, recordsFailed, currentPage, totalPages, errorMessage = null }) {
  await updateJobProgress(jobId, {
    status: 'completed',
    progress_percentage: 100,
    current_page: currentPage,
    total_pages: totalPages || currentPage,
    records_processed: recordsProcessed,
    records_failed: recordsFailed,
    // Preserve partial-failure messages (e.g. per-tenant errors in a multi-tenant sync)
    // so the UI can surface them even when the job otherwise completed.
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  });
  await recordRunHistory(jobId, 'completed');
}

/**
 * Mark job as failed.
 */
async function markFailed(jobId, errorMessage) {
  await updateJobProgress(jobId, {
    status: 'failed',
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  });
  await recordRunHistory(jobId, 'failed');
}

/**
 * Queue job for retry.
 */
async function markRetry(jobId, retryCount, errorMessage) {
  await updateJobProgress(jobId, {
    status: 'queued',
    error_message: errorMessage,
    retry_count: retryCount,
  });
}

/**
 * Mark job as cancelled.
 */
async function markCancelled(jobId) {
  await updateJobProgress(jobId, {
    status: 'cancelled',
    completed_at: new Date().toISOString(),
  });
  await recordRunHistory(jobId, 'cancelled');
}

module.exports = {
  updateJobProgress,
  recordRunHistory,
  markRunning,
  updatePageProgress,
  markCompleted,
  markFailed,
  markRetry,
  markCancelled,
};
