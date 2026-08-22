/**
 * QuickBooks in-memory job queue — sequential processing per organization.
 * Mirrors backend/queue/xero/jobQueue.js.
 *
 * QuickBooks credential model is PER-ORG (client_id/client_secret on the
 * platform_integrations row, like iplicit) but the token model is OAuth
 * (access/refresh tokens on the same row, like Xero). The queue therefore
 * follows the Xero pattern, selecting client_id/client_secret as well so the
 * client can refresh per-org.
 *
 * integration_id stores platform_integrations.id for QuickBooks jobs.
 */

const path = require('path');
const fs   = require('fs');
const { supabaseAdmin }            = require('../../config/supabase');
const { processQuickBooksSyncJob } = require('./processor');
const { ENTITIES }                 = require('../../api/quickbooks/config');
const { sleep }                    = require('../../utils/helpers');

const { getSyncSettings } = require('../../services/sync/settingsStore');

function getQuickBooksDateRange() {
  try {
    const s = getSyncSettings();
    return {
      startDate: s.quickbooks_start_date || s.xero_start_date || null,
      endDate:   s.quickbooks_end_date   || s.xero_end_date   || null,
    };
  } catch {
    return { startDate: null, endDate: null };
  }
}

const CONCURRENCY_PER_ORG = 1;

const orgQueues     = new Map(); // orgId -> Array<jobRow>
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
  const queue = orgQueues.get(orgId);
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
      .select('id, access_token, refresh_token, token_expires_at, is_connected, client_id, client_secret, organization_id, user_id')
      .eq('id', job.integration_id)
      .single();

    if (error || !integration) {
      console.error(`[QuickBooksQueue] Integration not found for job ${job.id} (integration_id: ${job.integration_id})`);
      const logger = require('../../services/sync/logger');
      await logger.markFailed(job.id, 'QuickBooks connection not found');
      return;
    }

    const result = await processQuickBooksSyncJob(job, integration, cancelTokens);

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
    console.error(`[QuickBooksQueue] Worker error for job ${job.id}:`, err.message);
  } finally {
    const current = activeWorkers.get(orgId) || 1;
    activeWorkers.set(orgId, current - 1);
    processQueue(orgId);
  }
}

/**
 * Recover incomplete QuickBooks jobs on server start.
 */
async function initialize() {
  console.log('[QuickBooksQueue] Initializing...');

  const MAX_RETRIES    = 5;
  const RETRY_DELAY_MS = 3000;
  let qbPlatforms      = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabaseAdmin
        .from('platform_integrations')
        .select('id')
        .eq('platform_name', 'quickbooks');
      if (error) throw new Error(error.message);
      qbPlatforms = data;
      break;
    } catch (err) {
      const isLast = attempt === MAX_RETRIES;
      console.error(`[QuickBooksQueue] Supabase unreachable (attempt ${attempt}/${MAX_RETRIES}): ${String(err.message).substring(0, 120)}`);
      if (isLast) {
        console.warn('[QuickBooksQueue] Starting without job recovery.');
        console.log('[QuickBooksQueue] Queue initialized (no recovery)');
        return;
      }
      await sleep(RETRY_DELAY_MS);
    }
  }

  const qbIds = (qbPlatforms || []).map(p => p.id);
  if (qbIds.length === 0) {
    console.log('[QuickBooksQueue] No QuickBooks integrations found, skipping recovery');
    console.log('[QuickBooksQueue] Queue initialized');
    return;
  }

  const { data: incompleteJobs, error } = await supabaseAdmin
    .from('sync_jobs')
    .select('*')
    .in('status', ['queued', 'running'])
    .in('integration_id', qbIds)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[QuickBooksQueue] Could not recover jobs:', error.message);
    console.log('[QuickBooksQueue] Queue initialized (no recovery)');
    return;
  }

  if (incompleteJobs && incompleteJobs.length > 0) {
    console.log(`[QuickBooksQueue] Recovering ${incompleteJobs.length} incomplete QuickBooks jobs`);
    for (const job of incompleteJobs) {
      if (job.status === 'running') {
        await supabaseAdmin.from('sync_jobs').update({ status: 'queued' }).eq('id', job.id);
        job.status = 'queued';
      }
      enqueueJob(job);
    }
  }

  console.log('[QuickBooksQueue] Queue initialized');
}

/**
 * Trigger QuickBooks sync for an organization.
 *
 * @param {string}      orgId
 * @param {string|null} singleEntityAlias
 * @param {string|null} userId
 * @param {boolean}     force
 * @param {string|null} connectionId
 */
async function triggerSync(orgId, singleEntityAlias = null, userId = null, force = false, connectionId = null) {
  let connectionQuery = supabaseAdmin
    .from('platform_integrations')
    .select('id, access_token, refresh_token, token_expires_at, is_connected, client_id, client_secret')
    .eq('organization_id', orgId)
    .eq('platform_name', 'quickbooks')
    .eq('is_connected', true)
    .not('access_token', 'is', null);

  if (connectionId) connectionQuery = connectionQuery.eq('id', connectionId);

  const { data: connection, error: connError } = await connectionQuery
    .limit(1)
    .maybeSingle();

  if (connError || !connection) {
    throw new Error(
      connectionId
        ? `No connected QuickBooks integration found for connection ${connectionId}`
        : 'No connected QuickBooks integration found for this organization',
    );
  }

  let entitiesToSync;
  if (singleEntityAlias) {
    entitiesToSync = ENTITIES.filter(e => e.alias === singleEntityAlias);
    if (entitiesToSync.length === 0) throw new Error(`Unknown QuickBooks entity: ${singleEntityAlias}`);
  } else {
    entitiesToSync = ENTITIES;
  }

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

  const activeSet = new Set();
  const { data: existingJobs } = await supabaseAdmin
    .from('sync_jobs')
    .select('entity_alias, status')
    .eq('organization_id', orgId)
    .eq('integration_id', connection.id)
    .in('status', ['running', 'queued']);
  if (existingJobs) for (const j of existingJobs) activeSet.add(j.entity_alias);

  const { startDate, endDate } = getQuickBooksDateRange();
  const jobRows = [];
  let skipped   = 0;

  for (const entity of entitiesToSync) {
    if (activeSet.has(entity.alias)) { skipped++; continue; }
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
      start_date:          entity.dateFilter === 'date_range' ? startDate : null,
      end_date:            entity.dateFilter === 'date_range' ? endDate   : null,
    });
  }

  if (jobRows.length === 0) {
    console.log(`[QuickBooksQueue] All QuickBooks jobs already active for org ${orgId}`);
    return { jobCount: 0, skipped, jobs: [] };
  }

  const { data: createdJobs, error: insertError } = await supabaseAdmin
    .from('sync_jobs')
    .insert(jobRows)
    .select();

  if (insertError) throw new Error(`Failed to create QuickBooks sync jobs: ${insertError.message}`);

  console.log(`[QuickBooksQueue] Created ${createdJobs.length} QuickBooks sync jobs for org ${orgId} (skipped ${skipped})`);
  for (const job of createdJobs) enqueueJob(job);

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
  const { data: connections } = await supabaseAdmin
    .from('platform_integrations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform_name', 'quickbooks');

  if (!connections || connections.length === 0) return;
  const connIds = connections.map(c => c.id);

  const { data: jobs } = await supabaseAdmin
    .from('sync_jobs')
    .select('id')
    .eq('organization_id', orgId)
    .in('integration_id', connIds)
    .in('status', ['queued', 'running']);

  if (jobs && jobs.length > 0) {
    for (const job of jobs) cancelTokens.set(job.id, true);
    await supabaseAdmin
      .from('sync_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .in('integration_id', connIds)
      .in('status', ['queued', 'running']);
  }

  orgQueues.set(orgId, []);
  activeWorkers.set(orgId, 0);
}

async function resumeQueuedJobs(orgId) {
  const { data: connections } = await supabaseAdmin
    .from('platform_integrations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform_name', 'quickbooks');

  if (!connections || connections.length === 0) return { resumed: 0 };
  const connIds = connections.map(c => c.id);

  const { data: queuedJobs, error } = await supabaseAdmin
    .from('sync_jobs')
    .select('*')
    .eq('organization_id', orgId)
    .in('integration_id', connIds)
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  if (error || !queuedJobs?.length) return { resumed: 0 };

  const existingIds = new Set((orgQueues.get(orgId) || []).map(j => j.id));
  let resumed = 0;
  for (const job of queuedJobs) {
    if (!existingIds.has(job.id)) { enqueueJob(job); resumed++; }
  }
  console.log(`[QuickBooksQueue] Resumed ${resumed} queued jobs for org ${orgId}`);
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
  console.log('[QuickBooksQueue] Shutting down...');
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
