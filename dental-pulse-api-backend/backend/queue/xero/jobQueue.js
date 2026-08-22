/**
 * Xero in-memory job queue — sequential processing per organization.
 * Follows the same pattern as the Iplicit jobQueue.
 *
 * integration_id stores platform_integrations.id for Xero jobs
 * (same FK relaxation as Iplicit — see migration 20260220000001)
 */

const path = require('path');
const fs   = require('fs');
const { supabaseAdmin }       = require('../../config/supabase');
const { processXeroSyncJob }  = require('./processor');
const { ENTITIES, entitiesForFullSync } = require('../../api/xero/config');
const { sleep }               = require('../../utils/helpers');
const { resolveXeroSyncWindow } = require('./syncWindow');

const CONCURRENCY_PER_ORG = 1;

/** In-memory state */
const orgQueues    = new Map(); // orgId -> Array<jobRow>
const activeWorkers = new Map(); // orgId -> number
const cancelTokens  = new Map(); // jobId -> boolean
let isShuttingDown  = false;

function enqueueJob(job) {
  const orgId = job.organization_id;
  if (!orgQueues.has(orgId)) {
    orgQueues.set(orgId, []);
    activeWorkers.set(orgId, 0);
  }
  orgQueues.get(orgId).push(job);
  processQueue(orgId);
}

function processQueue(orgId) {
  if (isShuttingDown) return;
  const queue   = orgQueues.get(orgId);
  if (!queue || queue.length === 0) return;
  const active    = activeWorkers.get(orgId) || 0;
  const available = CONCURRENCY_PER_ORG - active;
  for (let i = 0; i < available && queue.length > 0; i++) {
    const job = queue.shift();
    activeWorkers.set(orgId, (activeWorkers.get(orgId) || 0) + 1);
    runWorker(orgId, job);
  }
}

async function runWorker(orgId, job) {
  try {
    const { data: integration, error } = await supabaseAdmin
      .from('platform_integrations')
      .select('id, access_token, refresh_token, token_expires_at, is_connected, last_synced_at')
      .eq('id', job.integration_id)
      .single();

    if (error || !integration) {
      console.error(`[XeroQueue] Platform integration not found for job ${job.id} (integration_id: ${job.integration_id})`);
      const logger = require('../../services/sync/logger');
      await logger.markFailed(job.id, 'Xero connection not found');
      return;
    }

    const result = await processXeroSyncJob(job, integration, cancelTokens);

    if (result === 'retry' || result === 'rate_limited') {
      const delayMs = result === 'rate_limited' ? 30000 : 5000;
      await sleep(delayMs);
      if (cancelTokens.get(job.id)) return;

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
    console.error(`[XeroQueue] Worker error for job ${job.id}:`, err.message);
  } finally {
    const current = activeWorkers.get(orgId) || 1;
    activeWorkers.set(orgId, current - 1);
    processQueue(orgId);
  }
}

/**
 * Recover incomplete Xero jobs on server start.
 */
async function initialize() {
  console.log('[XeroQueue] Initializing...');

  const MAX_RETRIES       = 5;
  const RETRY_DELAY_MS    = 3000;
  let xeroPlatforms       = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabaseAdmin
        .from('platform_integrations')
        .select('id')
        .eq('platform_name', 'xero');

      if (error) throw new Error(error.message);
      xeroPlatforms = data;
      break;
    } catch (err) {
      const isLast = attempt === MAX_RETRIES;
      console.error(`[XeroQueue] Supabase unreachable (attempt ${attempt}/${MAX_RETRIES}): ${String(err.message).substring(0, 120)}`);
      if (isLast) {
        console.warn('[XeroQueue] Starting without job recovery.');
        console.log('[XeroQueue] Queue initialized (no recovery)');
        return;
      }
      await sleep(RETRY_DELAY_MS);
    }
  }

  const xeroIds = (xeroPlatforms || []).map(p => p.id);

  // Fail jobs whose Xero connection no longer exists. Reconnecting Xero replaces
  // the platform_integrations row, and both the disconnect flow and the frontend's
  // orphan cleanup delete rows outright — so this cannot be handled at a single
  // call site. Recovery below is scoped to live integration ids, so without this
  // an orphaned job stays "queued" forever and Sync Summary shows a phantom
  // in-progress run that no worker will ever pick up.
  let orphanQuery = supabaseAdmin
    .from('sync_jobs')
    .update({
      status:        'failed',
      error_message: 'Xero connection was removed or replaced before this job ran. Re-run the sync on the current connection.',
      completed_at:  new Date().toISOString(),
    })
    .in('status', ['queued', 'running'])
    .in('entity_alias', ENTITIES.map(e => e.alias));

  // With no live connections every Xero job is an orphan, so the filter is omitted.
  if (xeroIds.length > 0) {
    orphanQuery = orphanQuery.or(`integration_id.is.null,integration_id.not.in.(${xeroIds.join(',')})`);
  }

  const { data: orphanedJobs, error: orphanError } = await orphanQuery.select('id, entity_alias');

  if (orphanError) {
    console.warn('[XeroQueue] Could not reap orphaned jobs:', orphanError.message);
  } else if (orphanedJobs?.length) {
    console.warn(
      `[XeroQueue] Failed ${orphanedJobs.length} orphaned job(s) with a deleted connection:`,
      orphanedJobs.map(j => j.entity_alias).join(', ')
    );
  }

  if (xeroIds.length === 0) {
    console.log('[XeroQueue] No Xero integrations found, skipping recovery');
    console.log('[XeroQueue] Queue initialized');
    return;
  }

  // Fail zombie jobs stuck in "running" with no progress (e.g. token-refresh hang).
  const staleBefore = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: staleJobs } = await supabaseAdmin
    .from('sync_jobs')
    .update({
      status:        'failed',
      error_message: 'Job timed out after 20 minutes with no completion. Cancel and retry the sync.',
      completed_at:  new Date().toISOString(),
    })
    .in('integration_id', xeroIds)
    .eq('status', 'running')
    .lt('started_at', staleBefore)
    .select('id, entity_alias');

  if (staleJobs?.length) {
    console.warn(`[XeroQueue] Marked ${staleJobs.length} stale running job(s) as failed:`, staleJobs.map(j => j.entity_alias).join(', '));
  }

  // Page past PostgREST's default 1000-row cap so a large backlog can't hide
  // incomplete Xero jobs from recovery the way it historically hid Dentally ones.
  const PAGE_SIZE = 1000;
  const incompleteJobs = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: pageError } = await supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .in('status', ['queued', 'running'])
      .in('integration_id', xeroIds)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (pageError) {
      console.warn('[XeroQueue] Could not recover jobs:', pageError.message);
      console.log('[XeroQueue] Queue initialized (no recovery)');
      return;
    }
    if (!page || page.length === 0) break;
    incompleteJobs.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  if (incompleteJobs.length > 0) {
    console.log(`[XeroQueue] Recovering ${incompleteJobs.length} incomplete Xero jobs`);
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

  console.log('[XeroQueue] Queue initialized');
}

/**
 * Trigger Xero sync for an organization.
 *
 * Progressive watermark:
 *   - First sync / force: configured start (or ~18 months) via resolveXeroSyncWindow
 *   - Later syncs: If-Modified-Since / report range from last_synced_at − overlap
 * Window is snapshotted onto each job so sibling entities share the same cutoff.
 *
 * @param {string}      orgId
 * @param {string|null} singleEntityAlias
 * @param {string|null} userId
 * @param {boolean}     force
 */
async function triggerSync(orgId, singleEntityAlias = null, userId = null, force = false, connectionId = null) {
  // Multi-account support: target a specific Xero integration when connectionId given.
  let connectionQuery = supabaseAdmin
    .from('platform_integrations')
    .select('id, access_token, refresh_token, token_expires_at, is_connected, last_synced_at')
    .eq('organization_id', orgId)
    .eq('platform_name', 'xero')
    .eq('is_connected', true)
    .not('access_token', 'is', null);

  if (connectionId) connectionQuery = connectionQuery.eq('id', connectionId);

  const { data: connection, error: connError } = await connectionQuery
    .limit(1)
    .maybeSingle();

  if (connError || !connection) {
    throw new Error(
      connectionId
        ? `No connected Xero integration found for connection ${connectionId}`
        : 'No connected Xero integration found for this organization',
    );
  }

  let entitiesToSync;
  if (singleEntityAlias) {
    entitiesToSync = ENTITIES.filter(e => e.alias === singleEntityAlias);
    if (entitiesToSync.length === 0) throw new Error(`Unknown Xero entity: ${singleEntityAlias}`);
  } else {
    // Full pipeline (initial AND progressive): every entity, reference catalogs
    // first (Chart of Accounts + Tracking Categories). Tracking categories have
    // no date window but must still download on the first sync so location
    // mapping is available without a follow-up progressive run.
    entitiesToSync = entitiesForFullSync();
  }

  // Force full sync: clear watermark so the next window is treated as initial
  if (force) {
    const { error: resetError } = await supabaseAdmin
      .from('platform_integrations')
      .update({ last_synced_at: null })
      .eq('id', connection.id);

    if (resetError) {
      console.error(`[XeroQueue] Failed to reset last_synced_at:`, resetError.message);
    } else {
      connection.last_synced_at = null;
      console.log(`[XeroQueue] Reset last_synced_at for connection ${connection.id} (force sync)`);
    }
  }

  // For full sync: cancel existing jobs and clean up
  if (!singleEntityAlias) {
    await cancelAllJobs(orgId);

    const statusesToClean = ['cancelled', 'failed'];
    if (force) statusesToClean.push('completed');

    await supabaseAdmin
      .from('sync_jobs')
      .delete()
      .eq('organization_id', orgId)
      .eq('integration_id', connection.id)
      .in('status', statusesToClean);
  }

  // Skip already active jobs
  const activeSet = new Set();
  const { data: existingJobs } = await supabaseAdmin
    .from('sync_jobs')
    .select('entity_alias, status')
    .eq('organization_id', orgId)
    .eq('integration_id', connection.id)
    .in('status', ['running', 'queued']);

  if (existingJobs) {
    for (const job of existingJobs) activeSet.add(job.entity_alias);
  }

  const window = resolveXeroSyncWindow({
    lastSyncedAt: connection.last_synced_at,
    force,
  });

  const referenceAliases = entitiesToSync
    .filter(e => e.dateFilter === 'none')
    .map(e => e.alias);
  console.log(
    `[XeroQueue] ${window.isInitialSync ? 'Initial' : 'Incremental'} sync window` +
    ` for org ${orgId}: IMS=${window.modifiedSince || '(none)'}` +
    ` reports=${window.reportStartDate || '?'}→${window.reportEndDate || '?'}` +
    ` reference=[${referenceAliases.join(', ')}]` +
    ` entities=[${entitiesToSync.map(e => e.alias).join(', ')}]`,
  );

  const jobRows = [];
  let skipped   = 0;

  for (const entity of entitiesToSync) {
    if (activeSet.has(entity.alias)) { skipped++; continue; }

    let startDate = null;
    let endDate   = null;

    if (entity.dateFilter === 'date_range') {
      startDate = window.reportStartDate;
      endDate   = window.reportEndDate;
    } else if (entity.dateFilter === 'if_modified_since') {
      // Snapshot full ISO onto TIMESTAMPTZ start_date so sibling entities share
      // the same progressive cutoff even after last_synced_at advances mid-batch.
      startDate = window.modifiedSince;
      endDate   = null;
    }

    jobRows.push({
      organization_id:     orgId,
      integration_id:      connection.id,
      user_id:             userId,
      job_type:            'entity_sync',
      entity_alias:        entity.alias,
      status:              'queued',
      progress_percentage: 0,
      current_page:        1,
      total_pages:         null,
      records_processed:   0,
      records_failed:      0,
      retry_count:         0,
      max_retries:         3,
      start_date:          startDate,
      end_date:            endDate,
    });
  }

  if (jobRows.length === 0) {
    console.log(`[XeroQueue] All Xero jobs already active for org ${orgId}`);
    return { jobCount: 0, skipped, jobs: [] };
  }

  const { data: createdJobs, error: insertError } = await supabaseAdmin
    .from('sync_jobs')
    .insert(jobRows)
    .select();

  if (insertError) throw new Error(`Failed to create Xero sync jobs: ${insertError.message}`);

  console.log(`[XeroQueue] Created ${createdJobs.length} Xero sync jobs for org ${orgId} (skipped ${skipped})`);

  const priorityByAlias = new Map(ENTITIES.map(e => [e.alias, e.priority]));
  const orderedJobs = [...createdJobs].sort((a, b) =>
    (priorityByAlias.get(a.entity_alias) ?? 99) - (priorityByAlias.get(b.entity_alias) ?? 99));
  for (const job of orderedJobs) enqueueJob(job);

  return { jobCount: createdJobs.length, skipped, jobs: createdJobs };
}

async function cancelJob(jobId) {
  cancelTokens.set(jobId, true);
  await supabaseAdmin
    .from('sync_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['queued', 'running']);

  for (const [, queue] of orgQueues) {
    const idx = queue.findIndex(j => j.id === jobId);
    if (idx !== -1) { queue.splice(idx, 1); break; }
  }
}

async function cancelAllJobs(orgId) {
  const { data: connection } = await supabaseAdmin
    .from('platform_integrations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform_name', 'xero')
    .maybeSingle();

  if (!connection) return;

  const { data: jobs } = await supabaseAdmin
    .from('sync_jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('integration_id', connection.id)
    .in('status', ['queued', 'running']);

  if (jobs && jobs.length > 0) {
    for (const job of jobs) cancelTokens.set(job.id, true);
    await supabaseAdmin
      .from('sync_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('integration_id', connection.id)
      .in('status', ['queued', 'running']);
  }

  orgQueues.set(orgId, []);
  activeWorkers.set(orgId, 0);
}

async function resumeQueuedJobs(orgId) {
  const { data: connection } = await supabaseAdmin
    .from('platform_integrations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform_name', 'xero')
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
    if (!existingIds.has(job.id)) { enqueueJob(job); resumed++; }
  }
  console.log(`[XeroQueue] Resumed ${resumed} queued jobs for org ${orgId}`);
  return { resumed };
}

function getQueueStats() {
  const stats = {};
  for (const [orgId, queue] of orgQueues) {
    stats[orgId] = { queued: queue.length, active: activeWorkers.get(orgId) || 0 };
  }
  return stats;
}

function shutdown() {
  isShuttingDown = true;
  console.log('[XeroQueue] Shutting down...');
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
