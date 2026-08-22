/**
 * Iplicit in-memory job queue — sequential processing per organization.
 *
 * Follows the same pattern as the Dentally jobQueue but adapted for:
 *  - platform_integrations table (instead of integrations)
 *  - integration_id stores platform_integrations.id (FK relaxed by migration)
 *  - Single-call entities (no page chunks needed)
 *  - Default date range: last 2 months (not used by CoA, stored for future date entities)
 */

const fs   = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../../config/supabase');
const { processIplicitSyncJob } = require('./processor');
const { ENTITIES } = require('../../api/iplicit/config');
const { sleep } = require('../../utils/helpers');

const { getSyncSettings } = require('../../services/sync/settingsStore');

const CONCURRENCY_PER_ORG = 1; // Sequential, 1 job at a time per org
const POLL_INTERVAL_MS = 2000;

/** In-memory state */
const orgQueues = new Map();    // orgId -> Array<jobRow>
const activeWorkers = new Map(); // orgId -> number of running workers
const cancelTokens = new Map();  // jobId -> boolean
let isShuttingDown = false;

/**
 * Add a job to the in-memory queue and start processing if capacity available.
 */
function enqueueJob(job) {
  const orgId = job.organization_id;

  if (!orgQueues.has(orgId)) {
    orgQueues.set(orgId, []);
    activeWorkers.set(orgId, 0);
  }

  orgQueues.get(orgId).push(job);
  processQueue(orgId);
}

/**
 * Start workers for an org if capacity is available.
 */
function processQueue(orgId) {
  if (isShuttingDown) return;

  const queue = orgQueues.get(orgId);
  if (!queue || queue.length === 0) return;

  const active = activeWorkers.get(orgId) || 0;
  const available = CONCURRENCY_PER_ORG - active;

  for (let i = 0; i < available && queue.length > 0; i++) {
    const job = queue.shift();
    activeWorkers.set(orgId, (activeWorkers.get(orgId) || 0) + 1);
    runWorker(orgId, job);
  }
}

/**
 * Run a single worker for a job.
 */
async function runWorker(orgId, job) {
  try {
    // Fetch platform_integrations connection using integration_id
    // (integration_id stores platform_integrations.id for iplicit jobs)
    const { data: connection, error } = await supabaseAdmin
      .from('platform_integrations')
      .select('id, client_id, username, client_secret, access_token, token_expires_at, is_connected')
      .eq('id', job.integration_id)
      .single();

    if (error || !connection) {
      console.error(`[IplicitQueue] Platform integration not found for job ${job.id} (integration_id: ${job.integration_id})`);
      const logger = require('../../services/sync/logger');
      await logger.markFailed(job.id, 'Iplicit connection not found');
      return;
    }

    const result = await processIplicitSyncJob(job, connection, cancelTokens);

    if (result === 'retry') {
      await sleep(5000);

      if (cancelTokens.get(job.id)) {
        console.log(`[IplicitQueue] Job ${job.id} was cancelled during retry delay`);
        return;
      }

      const { data: updatedJob } = await supabaseAdmin
        .from('sync_jobs')
        .select('*')
        .eq('id', job.id)
        .single();

      if (updatedJob && updatedJob.status !== 'cancelled') {
        enqueueJob(updatedJob);
      }
    }
  } catch (err) {
    console.error(`[IplicitQueue] Worker error for job ${job.id}:`, err.message);
  } finally {
    const current = activeWorkers.get(orgId) || 1;
    activeWorkers.set(orgId, current - 1);
    processQueue(orgId);
  }
}

/**
 * Recover incomplete iplicit jobs from the database on server start.
 * Identifies iplicit jobs by checking integration_id against platform_integrations.
 */
async function initialize() {
  console.log('[IplicitQueue] Initializing...');

  const MAX_INIT_RETRIES = 5;
  const INIT_RETRY_DELAY_MS = 3000;

  let iplicitPlatforms = null;

  for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
    try {
      const { data, error: piError } = await supabaseAdmin
        .from('platform_integrations')
        .select('id')
        .eq('platform_name', 'iplicit');

      if (piError) {
        throw new Error(piError.message);
      }

      iplicitPlatforms = data;
      break; // success

    } catch (err) {
      const isLastAttempt = attempt === MAX_INIT_RETRIES;
      const errSummary = String(err.message || err).substring(0, 120).replace(/\n/g, ' ');
      console.error(`[IplicitQueue] Supabase unreachable (attempt ${attempt}/${MAX_INIT_RETRIES}): ${errSummary}`);

      if (isLastAttempt) {
        console.warn('[IplicitQueue] Could not reach Supabase after all retries. Starting without job recovery.');
        console.log('[IplicitQueue] Queue initialized (no recovery)');
        return;
      }

      console.log(`[IplicitQueue] Retrying in ${INIT_RETRY_DELAY_MS / 1000}s...`);
      await sleep(INIT_RETRY_DELAY_MS);
    }
  }


  const iplicitIds = (iplicitPlatforms || []).map(p => p.id);


  if (iplicitIds.length === 0) {
    console.log('[IplicitQueue] No Iplicit integrations found, skipping recovery');
    console.log('[IplicitQueue] Queue initialized');
    return;
  }

  const { data: incompleteJobs, error } = await supabaseAdmin
    .from('sync_jobs')
    .select('*')
    .in('status', ['queued', 'running'])
    .in('integration_id', iplicitIds)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[IplicitQueue] Could not recover jobs:', error.message);
    console.log('[IplicitQueue] Queue initialized (no recovery)');
    return;
  }

  if (incompleteJobs && incompleteJobs.length > 0) {
    console.log(`[IplicitQueue] Recovering ${incompleteJobs.length} incomplete iplicit jobs`);

    for (const job of incompleteJobs) {
      if (job.status === 'running') {
        await supabaseAdmin
          .from('sync_jobs')
          .update({ status: 'queued' })
          .eq('id', job.id);
        job.status = 'queued';
      }
      enqueueJob(job);
    }
  }

  console.log('[IplicitQueue] Queue initialized');
}

/**
 * Trigger a sync for an organization.
 * Uses last 2 months as default date range (stored for future date-filtered entities).
 *
 * @param {string} orgId
 * @param {string|null} singleEntityAlias - sync only this entity
 * @param {string|null} userId
 * @param {boolean} force - re-sync even completed jobs
 * @returns {Promise<{ jobCount: number, skipped: number, jobs: Array }>}
 */
async function triggerSync(orgId, singleEntityAlias = null, userId = null, force = false, connectionId = null) {
  // Get iplicit platform_integration for this org (credentials required, is_connected not required)
  let connection = null;
  let connError = null;

  if (connectionId) {
    // Look up by specific connection ID (multi-account support)
    const result = await supabaseAdmin
      .from('platform_integrations')
      .select('id, client_id, client_secret, access_token, token_expires_at, is_connected')
      .eq('id', connectionId)
      .eq('organization_id', orgId)
      .eq('platform_name', 'iplicit')
      .not('client_secret', 'is', null)
      .not('username', 'is', null)
      .maybeSingle();
    connection = result.data;
    connError = result.error;
  } else {
    // Fallback: find first iplicit connection for this org
    const result = await supabaseAdmin
      .from('platform_integrations')
      .select('id, client_id, client_secret, access_token, token_expires_at, is_connected')
      .eq('organization_id', orgId)
      .eq('platform_name', 'iplicit')
      .not('client_secret', 'is', null)
      .not('username', 'is', null)
      .limit(1)
      .maybeSingle();
    connection = result.data;
    connError = result.error;
  }

  if (connError || !connection) {
    throw new Error('No Iplicit integration with credentials found for this organization');
  }

  // Determine entities to sync
  let entitiesToSync;
  if (singleEntityAlias) {
    entitiesToSync = ENTITIES.filter(e => e.alias === singleEntityAlias);
    if (entitiesToSync.length === 0) {
      throw new Error(`Unknown Iplicit entity: ${singleEntityAlias}`);
    }
  } else {
    entitiesToSync = ENTITIES;
  }

  // For full sync: cancel existing jobs and clean up old ones
  if (!singleEntityAlias) {
    await cancelAllJobs(orgId);

    const statusesToClean = ['cancelled', 'failed'];
    if (force) statusesToClean.push('completed');

    const { error: cleanupError } = await supabaseAdmin
      .from('sync_jobs')
      .delete()
      .eq('organization_id', orgId)
      .eq('integration_id', connection.id)
      .in('status', statusesToClean);

    if (cleanupError) {
      console.error(`[IplicitQueue] Failed to clean up old jobs:`, cleanupError.message);
    }
  }

  // Build set of already-running/queued jobs to skip (never skip completed — always allow a new run)
  const activeSet = new Set();
  const { data: existingJobs } = await supabaseAdmin
    .from('sync_jobs')
    .select('entity_alias, status')
    .eq('organization_id', orgId)
    .eq('integration_id', connection.id)
    .in('status', ['running', 'queued']);

  if (existingJobs) {
    for (const job of existingJobs) {
      activeSet.add(job.entity_alias);
    }
    if (activeSet.size > 0) {
      console.log(`[IplicitQueue] Found ${activeSet.size} already running/queued jobs — will skip duplicates`);
    }
  }

  const now = new Date();

  // Build job rows
  const jobRows = [];
  let skipped = 0;

  for (const entity of entitiesToSync) {
    if (activeSet.has(entity.alias)) {
      skipped++;
      continue;
    }

    // Date range for entities with dateFilter: true (Balance Sheet, P&L).
    // Priority: superadmin-configured range (sync_settings table) > default last 13 months.
    // Use local date getters (not toISOString) to avoid UTC offset shifting the date by 1 day.
    let startDate = null;
    let endDate = null;
    if (entity.dateFilter) {
      // Try reading superadmin-configured range first
      try {
        const settings = getSyncSettings();
        startDate = settings.iplicit_start_date || null;
        endDate   = settings.iplicit_end_date   || null;
      } catch { /* settings unavailable — fall through to default */ }

      // Default: last 13 months (start of month 12 months ago → last day of current month)
      if (!startDate || !endDate) {
        const from    = new Date(now.getFullYear(), now.getMonth() - 12, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const pad = n => String(n).padStart(2, '0');
        startDate = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-01`;
        endDate   = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`;
        console.log(`[IplicitQueue] Using default 13-month range: ${startDate} to ${endDate}`);
      } else {
        console.log(`[IplicitQueue] Using configured range: ${startDate} to ${endDate}`);
      }
    }

    jobRows.push({
      organization_id:    orgId,
      integration_id:     connection.id,
      user_id:            userId,
      job_type:           'entity_sync',
      entity_alias:       entity.alias,
      status:             'queued',
      progress_percentage: 0,
      current_page:       1,
      total_pages:        null,
      records_processed:  0,
      records_failed:     0,
      retry_count:        0,
      max_retries:        3,
      start_date:         startDate,
      end_date:           endDate,
    });
  }

  if (skipped > 0) {
    console.log(`[IplicitQueue] Skipped ${skipped} already-active jobs for org ${orgId}`);
  }

  if (jobRows.length === 0) {
    console.log(`[IplicitQueue] All Iplicit jobs already completed for org ${orgId}`);
    return { jobCount: 0, skipped, jobs: [] };
  }

  // Insert job rows
  const { data: createdJobs, error: insertError } = await supabaseAdmin
    .from('sync_jobs')
    .insert(jobRows)
    .select();

  if (insertError) {
    throw new Error(`Failed to create Iplicit sync jobs: ${insertError.message}`);
  }

  console.log(`[IplicitQueue] Created ${createdJobs.length} Iplicit sync jobs for org ${orgId} (skipped ${skipped} completed)`);

  // Enqueue all jobs
  for (const job of createdJobs) {
    enqueueJob(job);
  }

  return { jobCount: createdJobs.length, skipped, jobs: createdJobs };
}

/**
 * Cancel a single job.
 */
async function cancelJob(jobId) {
  cancelTokens.set(jobId, true);

  await supabaseAdmin
    .from('sync_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['queued', 'running']);

  // Remove from in-memory queues
  for (const [, queue] of orgQueues) {
    const idx = queue.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      break;
    }
  }
}

/**
 * Cancel all active iplicit jobs for an organization.
 */
async function cancelAllJobs(orgId) {
  // Find active iplicit jobs for this org
  const { data: connection } = await supabaseAdmin
    .from('platform_integrations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform_name', 'iplicit')
    .maybeSingle();

  if (!connection) return;

  const { data: jobs } = await supabaseAdmin
    .from('sync_jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('integration_id', connection.id)
    .in('status', ['queued', 'running']);

  if (jobs && jobs.length > 0) {
    for (const job of jobs) {
      cancelTokens.set(job.id, true);
    }

    await supabaseAdmin
      .from('sync_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('integration_id', connection.id)
      .in('status', ['queued', 'running']);
  }

  // Clear in-memory queue
  orgQueues.set(orgId, []);
  activeWorkers.set(orgId, 0);
}

/**
 * Resume existing queued iplicit jobs (no new jobs created).
 */
async function resumeQueuedJobs(orgId) {
  const { data: connection } = await supabaseAdmin
    .from('platform_integrations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform_name', 'iplicit')
    .maybeSingle();

  if (!connection) return { resumed: 0 };

  const { data: queuedJobs, error } = await supabaseAdmin
    .from('sync_jobs')
    .select('*')
    .eq('organization_id', orgId)
    .eq('integration_id', connection.id)
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  if (error || !queuedJobs?.length) return { resumed: 0 };

  const existingIds = new Set((orgQueues.get(orgId) || []).map(j => j.id));
  let resumed = 0;

  for (const job of queuedJobs) {
    if (!existingIds.has(job.id)) {
      enqueueJob(job);
      resumed++;
    }
  }

  console.log(`[IplicitQueue] Resumed ${resumed} queued jobs for org ${orgId}`);
  return { resumed };
}

/**
 * Get queue stats for monitoring.
 */
function getQueueStats() {
  const stats = {};
  for (const [orgId, queue] of orgQueues) {
    stats[orgId] = {
      queued: queue.length,
      active: activeWorkers.get(orgId) || 0,
    };
  }
  return stats;
}

/**
 * Graceful shutdown.
 */
function shutdown() {
  isShuttingDown = true;
  console.log('[IplicitQueue] Shutting down...');
}

module.exports = {
  initialize,
  triggerSync,
  resumeQueuedJobs,
  cancelJob,
  cancelAllJobs,
  getQueueStats,
  shutdown,
};
