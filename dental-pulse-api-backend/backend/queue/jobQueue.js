/**
 * In-memory job queue with sequential processing per Dentally integration (account).
 *
 * - 1 job at a time per integration (sequential, in priority order)
 * - Multiple integrations of the same org run in parallel (each account has its own lane)
 * - Jobs are persisted in sync_jobs table
 * - Recovery on restart: re-enqueues incomplete jobs from DB
 */

const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../config/supabase');
const { processSyncJob } = require('./processor');
const { ENTITIES, ENTITY_BY_ALIAS, NON_DATE_ENTITIES, DATE_ENTITIES } = require('../api/dentally/config');
const { generateReverseMonthlyChunksFromRange } = require('../utils/dateHelpers');
const { sleep } = require('../utils/helpers');

const { getSyncSettings } = require('../services/sync/settingsStore');

const CONCURRENCY_PER_INTEGRATION = 1; // Sequential within one Dentally account; parallel across accounts
const POLL_INTERVAL_MS = 2000;

/** Build the map key for a per-integration queue (orgId:integrationId). */
function makeQueueKey(orgId, integrationId) {
  return `${orgId}:${integrationId}`;
}

/** In-memory state (keyed by queueKey = orgId:integrationId) */
const orgQueues = new Map();            // queueKey -> Array<jobRow>
const activeWorkers = new Map();        // queueKey -> number of running workers
const activeJobIds = new Set();         // jobIds currently held by a worker in THIS process
const activePhase1Workers = new Map();  // queueKey -> number of running Phase 1 (locations) workers
const activePhase2Workers = new Map();  // queueKey -> number of running Phase 2 (non-date) workers
const activePhase3Workers = new Map();  // queueKey -> number of running Phase 3 (date) workers
const cancelTokens = new Map();         // jobId -> boolean
let isShuttingDown = false;

/** Determine job phase: 1=locations, 2=other non-date, 3=date entities, 4=accounts (last) */
function getJobPhase(job) {
  if (job.entity_alias === 'locations' || job.entity_alias === 'treatment_category') return 1;
  // Accounts sync last (Phase 4). It's slow — one /v1/accounts/{id} detail call
  // per record — and is a leaf entity: nothing the sync needs depends on it, and
  // its location_id is resolved FROM patients afterwards. Deferring it past the
  // date entities (Phase 3) means it never blocks patients/appointments/invoices.
  if (job.entity_alias === 'accounts') return 4;
  if (job.start_date === null || job.start_date === undefined) return 2; // non-date entity
  return 3; // date entity
}

/** Background retry when boot-time recovery could not reach Supabase.
 *  Re-runs initialize(); only re-armed from its failure branch, so a
 *  successful recovery never runs twice (no duplicate enqueues). */
const RECOVERY_RETRY_MS = 5 * 60 * 1000;
let recoveryRetryTimer = null;

function scheduleRecoveryRetry() {
  if (recoveryRetryTimer || isShuttingDown) return;
  recoveryRetryTimer = setTimeout(() => {
    recoveryRetryTimer = null;
    console.log('[JobQueue] Retrying job recovery...');
    initialize().catch((e) => {
      console.error('[JobQueue] Background recovery retry failed:', e.message);
      scheduleRecoveryRetry();
    });
  }, RECOVERY_RETRY_MS);
  if (recoveryRetryTimer.unref) recoveryRetryTimer.unref();
}

/**
 * Initialize the queue system.
 * Recovers incomplete jobs from the database.
 * Retries on transient network errors (e.g. Supabase SSL 525, Cloudflare outage).
 */
async function initialize() {
  console.log('[JobQueue] Initializing...');

  const MAX_INIT_RETRIES = 5;
  const INIT_RETRY_DELAY_MS = 3000;

  let dentallyIntegrations = null;

  for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
    try {
      // Recover incomplete Dentally jobs (running/queued) from DB.
      const { data, error: intError } = await supabaseAdmin
        .from('integrations')
        .select('id')
        .is('deleted_at', null);

      if (intError) {
        throw new Error(intError.message);
      }

      dentallyIntegrations = data;
      break; // success

    } catch (err) {
      const isLastAttempt = attempt === MAX_INIT_RETRIES;
      const errSummary = String(err.message || err).substring(0, 120).replace(/\n/g, ' ');
      console.error(`[JobQueue] Supabase unreachable (attempt ${attempt}/${MAX_INIT_RETRIES}): ${errSummary}`);

      if (isLastAttempt) {
        // Do NOT give up permanently: booting while Supabase is unreachable
        // (outage, revoked key later fixed at runtime, ...) used to strand
        // every incomplete job as a DB-only zombie until the next manual
        // restart. Keep retrying recovery in the background instead.
        console.warn('[JobQueue] Could not reach Supabase after all retries. Starting without job recovery — will retry recovery every 5 min.');
        console.log('[JobQueue] Queue initialized (recovery pending)');
        scheduleRecoveryRetry();
        return;
      }

      console.log(`[JobQueue] Retrying in ${INIT_RETRY_DELAY_MS / 1000}s...`);
      await sleep(INIT_RETRY_DELAY_MS);
    }
  }


  const dentallyIntegrationIds = (dentallyIntegrations || []).map(i => i.id);


  if (dentallyIntegrationIds.length === 0) {
    console.log('[JobQueue] No Dentally integrations found, skipping recovery');
    console.log('[JobQueue] Queue initialized');
    return;
  }

  // Page past PostgREST's default 1000-row cap. Without this, any incomplete jobs
  // created after the 1000th oldest are silently dropped on restart — they stay
  // "running"/"queued" in the DB forever and Sync Summary shows a phantom
  // in-progress run that no worker will ever pick up. Empirically this hid 500+
  // jobs (including the live treatment_plan_items backfill) behind the cap.
  const PAGE_SIZE = 1000;
  const incompleteJobs = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: pageError } = await supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .in('status', ['queued', 'running'])
      .in('integration_id', dentallyIntegrationIds)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (pageError) {
      console.error('[JobQueue] Failed to recover jobs:', pageError.message);
      return;
    }
    if (!page || page.length === 0) break;
    incompleteJobs.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  if (incompleteJobs.length > 0) {
    console.log(`[JobQueue] Recovering ${incompleteJobs.length} incomplete jobs`);

    // Deduplicate: only keep the most-progressed job per entity+date combo
    const bestJobPerKey = new Map(); // key -> job (keep the one with most progress)
    const duplicateIds = [];

    for (const job of incompleteJobs) {
      // Skip jobs that already completed (status stuck at running due to crash)
      if (job.completed_at && job.progress_percentage >= 100) {
        console.log(`[JobQueue] Fixing orphan job ${job.id} (${job.entity_alias}): already completed, marking as completed`);
        await supabaseAdmin
          .from('sync_jobs')
          .update({ status: 'completed' })
          .eq('id', job.id);
        continue;
      }

      const key = job.start_date
        ? `${job.organization_id}|${job.entity_alias}|${job.start_date}|${job.end_date}`
        : `${job.organization_id}|${job.entity_alias}`;

      const existing = bestJobPerKey.get(key);
      if (existing) {
        // Keep the one with more progress, cancel the other
        const existingProgress = (existing.current_page || 1) * 100 + (existing.records_processed || 0);
        const newProgress = (job.current_page || 1) * 100 + (job.records_processed || 0);
        if (newProgress > existingProgress) {
          duplicateIds.push(existing.id);
          bestJobPerKey.set(key, job);
        } else {
          duplicateIds.push(job.id);
        }
      } else {
        bestJobPerKey.set(key, job);
      }
    }

    // Cancel duplicate jobs
    if (duplicateIds.length > 0) {
      console.log(`[JobQueue] Cancelling ${duplicateIds.length} duplicate jobs`);
      for (const id of duplicateIds) {
        await supabaseAdmin
          .from('sync_jobs')
          .update({ status: 'cancelled', completed_at: new Date().toISOString() })
          .eq('id', id);
      }
    }

    // Enqueue deduplicated jobs
    for (const job of bestJobPerKey.values()) {
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

  console.log('[JobQueue] Queue initialized');
}

/**
 * Add a job to the in-memory queue and start processing if needed.
 * Jobs are routed to a per-integration lane so multiple Dentally accounts
 * on the same org sync in parallel.
 */
function enqueueJob(job) {
  const queueKey = makeQueueKey(job.organization_id, job.integration_id);

  if (!orgQueues.has(queueKey)) {
    orgQueues.set(queueKey, []);
    activeWorkers.set(queueKey, 0);
  }

  orgQueues.get(queueKey).push(job);
  processQueue(queueKey);
}

/**
 * Start workers for an organization if capacity is available.
 *
 * Enforces four-phase processing:
 * Phase 1: locations + treatment_category (no dependencies, must complete first)
 * Phase 2: Other non-date entities (payment_plans, treatments, practitioners — need locationMap)
 * Phase 3: Date entities (patients, appointments, invoices — need locationMap + categoryMap)
 * Phase 4: accounts (slow detail-fetch per record; leaf entity whose location_id
 *          resolves from patients — deferred last so it never blocks Phase 3)
 *
 * This ensures the location map and category map are populated before dependent entities load them.
 */
function processQueue(queueKey) {
  if (isShuttingDown) return;

  const queue = orgQueues.get(queueKey);
  if (!queue || queue.length === 0) return;

  const active = activeWorkers.get(queueKey) || 0;
  const available = CONCURRENCY_PER_INTEGRATION - active;

  for (let i = 0; i < available && queue.length > 0; i++) {
    const nextJob = queue[0]; // peek at next job without removing
    const nextPhase = getJobPhase(nextJob);

    // Phase gate: higher phases wait for all lower phases to finish
    if (nextPhase >= 2) {
      const phase1InQueue = queue.some(j => getJobPhase(j) === 1);
      const phase1Active = (activePhase1Workers.get(queueKey) || 0) > 0;
      if (phase1InQueue || phase1Active) break; // wait for locations/categories to finish
    }
    if (nextPhase >= 3) {
      const phase2InQueue = queue.some(j => getJobPhase(j) === 2);
      const phase2Active = (activePhase2Workers.get(queueKey) || 0) > 0;
      if (phase2InQueue || phase2Active) break; // wait for non-date entities to finish
    }
    if (nextPhase >= 4) {
      const phase3InQueue = queue.some(j => getJobPhase(j) === 3);
      const phase3Active = (activePhase3Workers.get(queueKey) || 0) > 0;
      if (phase3InQueue || phase3Active) break; // wait for all date entities to finish before accounts
    }

    const job = queue.shift();
    const phase = getJobPhase(job);
    activeWorkers.set(queueKey, (activeWorkers.get(queueKey) || 0) + 1);

    // Track phase workers for the gate
    if (phase === 1) activePhase1Workers.set(queueKey, (activePhase1Workers.get(queueKey) || 0) + 1);
    if (phase === 2) activePhase2Workers.set(queueKey, (activePhase2Workers.get(queueKey) || 0) + 1);
    if (phase === 3) activePhase3Workers.set(queueKey, (activePhase3Workers.get(queueKey) || 0) + 1);

    runWorker(queueKey, job);
  }
}

/**
 * Run a single worker for a job.
 */
async function runWorker(queueKey, job) {
  const orgId = job.organization_id;
  activeJobIds.add(job.id);
  try {
    // Fetch Dentally integration details from `integrations` table
    const { data: integration, error } = await supabaseAdmin
      .from('integrations')
      .select('id, encrypted_pat, encrypted_pat_iv, api_endpoints, synced_site_ids')
      .eq('id', job.integration_id)
      .single();

    if (error || !integration) {
      // This can happen if integration_id belongs to platform_integrations (iplicit job
      // that somehow ended up in the Dentally queue — skip it gracefully).
      console.error(`[JobQueue] Dentally integration not found for job ${job.id} (integration_id: ${job.integration_id})`);
      const logger = require('../services/sync/logger');
      await logger.markFailed(job.id, 'Integration not found (Dentally)');
      return;
    }

    const result = await processSyncJob(job, integration, cancelTokens);

    const isRateLimited = result && typeof result === 'object' && result.status === 'rate_limited';

    if (isRateLimited) {
      // Rate limit exhausted for THIS integration: pause only this account's lane until
      // the API limit resets. Other accounts on the same org keep running (Dentally's
      // rate-limit bucket is per-account).
      // Dentally resets limits every hour (e.g. 1:30 PM, 2:30 PM).
      const resetAt = result.rateLimitResetAt || 0;
      const now = Date.now();

      let pauseMs;
      if (resetAt > now) {
        // Wait until the API's reset timestamp + 5s buffer
        pauseMs = (resetAt - now) + 5000;
      } else {
        // No reset time from headers — wait until the next hour boundary + 5s buffer
        const msIntoHour = now % 3600000;
        pauseMs = (3600000 - msIntoHour) + 5000;
      }

      const resumeTime = new Date(now + pauseMs).toLocaleTimeString();
      console.log(`[JobQueue] Rate limit exhausted for integration ${job.integration_id?.slice(0, 8)} (org ${orgId}). Pausing ${Math.round(pauseMs / 1000)}s — will resume at ~${resumeTime}`);

      await sleep(pauseMs);

      // Check if job was cancelled during the pause
      if (cancelTokens.get(job.id)) {
        console.log(`[JobQueue] Job ${job.id} was cancelled during rate limit pause, skipping re-enqueue`);
      } else {
        const { data: updatedJob } = await supabaseAdmin
          .from('sync_jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob && updatedJob.status !== 'cancelled') {
          enqueueJob(updatedJob);
        }
      }
    } else if (result === 'retry') {
      // Normal error retry: re-enqueue after short delay
      await sleep(5000); // 5s delay before retry

      // Check if job was cancelled during the delay
      if (cancelTokens.get(job.id)) {
        console.log(`[JobQueue] Job ${job.id} was cancelled during retry delay, skipping re-enqueue`);
      } else {
        const { data: updatedJob } = await supabaseAdmin
          .from('sync_jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob && updatedJob.status !== 'cancelled') {
          enqueueJob(updatedJob);
        }
      }
    }
  } catch (err) {
    console.error(`[JobQueue] Worker error for job ${job.id}:`, err.message);
  } finally {
    activeJobIds.delete(job.id);
    // Decrease active worker count (use Math.max to never go below 0)
    const current = activeWorkers.get(queueKey);
    activeWorkers.set(queueKey, Math.max(0, (current != null ? current : 1) - 1));

    // Decrease phase-specific worker count
    const phase = getJobPhase(job);
    if (phase === 1) {
      const p1 = activePhase1Workers.get(queueKey);
      activePhase1Workers.set(queueKey, Math.max(0, (p1 != null ? p1 : 1) - 1));
    } else if (phase === 2) {
      const p2 = activePhase2Workers.get(queueKey);
      activePhase2Workers.set(queueKey, Math.max(0, (p2 != null ? p2 : 1) - 1));
    } else if (phase === 3) {
      const p3 = activePhase3Workers.get(queueKey);
      activePhase3Workers.set(queueKey, Math.max(0, (p3 != null ? p3 : 1) - 1));
    }

    // Process next job (may now unblock next phase)
    processQueue(queueKey);
  }
}

/**
 * Trigger a full sync for an organization.
 * Creates sync_jobs rows and enqueues them.
 * Syncs from today backward 1 year in monthly chunks (newest first).
 *
 * Skips entity+date combinations that already completed successfully.
 * Only creates new jobs for failed/cancelled/missing combinations.
 *
 * @param {string} orgId
 * @param {string|null} singleEntityAlias - If provided, only sync this entity
 * @param {string|null} userId - Optional user ID to associate with jobs
 * @param {boolean} force - If true, ignore completed jobs and re-sync everything
 * @param {Object} options - Optional overrides
 * @param {string|null} options.startDate - Override start date (YYYY-MM-DD)
 * @param {string|null} options.endDate - Override end date (YYYY-MM-DD)
 * @param {string[]|null} options.entities - Override entity list (array of aliases)
 * @param {string|null} options.integrationId - Specific integration ID (for multi-account support)
 * @returns {Promise<{ jobCount: number, skipped: number, jobs: Array }>}
 */
async function triggerSync(orgId, singleEntityAlias = null, userId = null, force = false, options = {}) {
  // Get integration(s) — by explicit ID if provided, otherwise ALL Dentally integrations for the org
  let integrations;
  if (options.integrationId) {
    const { data, error } = await supabaseAdmin
      .from('integrations')
      .select('id, encrypted_pat, encrypted_pat_iv, api_endpoints')
      .eq('id', options.integrationId)
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .single();
    if (error || !data) {
      throw new Error(`Integration ${options.integrationId} not found for this organization`);
    }
    integrations = [data];
  } else {
    const { data, error } = await supabaseAdmin
      .from('integrations')
      .select('id, encrypted_pat, encrypted_pat_iv, api_endpoints')
      .eq('organization_id', orgId)
      .ilike('integration_name', 'dentally')
      .eq('is_connected', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error || !data || data.length === 0) {
      throw new Error('No Dentally integration found for this organization');
    }
    integrations = data;
  }

  // Loop over all integrations, aggregate results
  let totalJobCount = 0, totalSkipped = 0;
  const allJobs = [];
  for (const integration of integrations) {
    const result = await triggerSyncForIntegration(orgId, integration, singleEntityAlias, userId, force, options);
    totalJobCount += result.jobCount;
    totalSkipped += result.skipped;
    allJobs.push(...result.jobs);
  }
  return { jobCount: totalJobCount, skipped: totalSkipped, jobs: allJobs };
}

/**
 * Core sync job creation logic for a single integration.
 * Called by triggerSync() once per integration.
 */
async function triggerSyncForIntegration(orgId, integration, singleEntityAlias, userId, force, options = {}) {
  // Determine date range: per-request override > global config > default 365 days
  const { startDate: overrideStartDate, endDate: overrideEndDate, entities: entityList } = options;
  let syncStartDate = null;
  let syncEndDate = null;

  // Always read sync_mode from config — it applies regardless of whether dates come
  // from a per-request override or from the global config.
  let syncMode = 'current';
  try {
    const settings = getSyncSettings();
    syncMode = settings.sync_mode || 'current';
    if (!overrideStartDate || !overrideEndDate) {
      syncStartDate = settings.sync_start_date || null;
      syncEndDate = settings.sync_end_date || null;
    }
  } catch {
    // Settings unavailable — use defaults
  }

  if (overrideStartDate && overrideEndDate) {
    // Per-request override (e.g. from Manual Sync UI)
    syncStartDate = overrideStartDate.split('T')[0];
    syncEndDate = overrideEndDate.split('T')[0];
    console.log(`[JobQueue] Using per-request date range: ${syncStartDate} to ${syncEndDate}`);
  } else {
    // Determine date range: configured or default (365 days back from today)
    if (!syncStartDate || !syncEndDate) {
      const now = new Date();
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 365);
      syncEndDate = now.toISOString().split('T')[0];
      syncStartDate = cutoff.toISOString().split('T')[0];
      console.log(`[JobQueue] Using default 365-day range: ${syncStartDate} to ${syncEndDate}`);
    } else {
      console.log(`[JobQueue] Using configured date range: ${syncStartDate} to ${syncEndDate}`);
    }
  }

  // Historical mode: appointments use start_time filter (after/before) instead of
  // updated_after/updated_before. Applies regardless of how sync was triggered.
  let ENTITIES_WITH_OVERRIDES = null;
  if (syncMode === 'historical') {
    ENTITIES_WITH_OVERRIDES = ENTITIES.map(e => {
      if (e.alias === 'appointments') {
        return { ...e, dateFilter: 'after', dateFilterEnd: 'before', sortBy: 'start_time' };
      }
      return e;
    });
    console.log(`[JobQueue] Historical mode active — appointments using after/before (start_time) filter`);
  }

  // Determine which entities to sync
  let entitiesToSync;
  const EFFECTIVE_ENTITIES = ENTITIES_WITH_OVERRIDES || ENTITIES;
  if (entityList && entityList.length > 0) {
    // Multiple specific entities (from Manual Sync UI)
    entitiesToSync = EFFECTIVE_ENTITIES.filter(e => entityList.includes(e.alias));
    if (entitiesToSync.length === 0) {
      throw new Error(`No matching entities found for: ${entityList.join(', ')}`);
    }
    console.log(`[JobQueue] Syncing ${entitiesToSync.length} selected entities: ${entitiesToSync.map(e => e.alias).join(', ')}`);
  } else if (singleEntityAlias) {
    entitiesToSync = EFFECTIVE_ENTITIES.filter(e => e.alias === singleEntityAlias);
  } else {
    entitiesToSync = EFFECTIVE_ENTITIES;
  }

  if (entitiesToSync.length === 0) {
    throw new Error(`Unknown entity: ${singleEntityAlias}`);
  }

  // Cancel existing queued/running jobs for THIS integration and clean up old jobs
  // Only do this for full sync (not when specific entities are selected)
  if (!singleEntityAlias && !(entityList && entityList.length > 0)) {
    await cancelJobsForIntegration(orgId, integration.id);

    // Keep old completed/failed jobs as sync history.
    // Only delete cancelled jobs (user-aborted, not useful to keep).
    const statusesToClean = ['cancelled'];

    const { error: cleanupError } = await supabaseAdmin
      .from('sync_jobs')
      .delete()
      .eq('organization_id', orgId)
      .eq('integration_id', integration.id)
      .in('status', statusesToClean);

    if (cleanupError) {
      console.error(`[JobQueue] Failed to clean up cancelled jobs:`, cleanupError.message);
    } else {
      console.log(`[JobQueue] Cleaned up cancelled jobs for org ${orgId}`);
    }

    // Force sync: reset last_synced_at so future incremental syncs start fresh
    if (force) {
      const { error: resetError } = await supabaseAdmin
        .from('integration_sync_entities')
        .update({ last_synced_at: null })
        .eq('integration_id', integration.id);

      if (resetError) {
        console.error(`[JobQueue] Failed to reset last_synced_at:`, resetError.message);
      } else {
        console.log(`[JobQueue] Reset last_synced_at for all entities (force sync)`);
      }
    }
  }

  // Check which entities have never been synced (last_synced_at is null)
  // Used to determine if single-date entities (e.g. patients) should fetch ALL historical data
  const neverSyncedEntities = new Set();
  {
    const { data: syncEntities } = await supabaseAdmin
      .from('integration_sync_entities')
      .select('entity_alias, last_synced_at')
      .eq('integration_id', integration.id);

    if (syncEntities) {
      for (const se of syncEntities) {
        if (!se.last_synced_at) neverSyncedEntities.add(se.entity_alias);
      }
    }
  }

  // Build set of already-active jobs (skip completed, running, and queued to prevent duplicates)
  // Key: "entity_alias" for non-date, "entity_alias|startDate|endDate" for date entities
  // Exception: when the user explicitly selected specific entities, allow those to re-sync
  // even on Resume (non-force) — they intentionally picked what to re-run.
  const activeSet = new Set();
  const explicitlySelected = entityList && entityList.length > 0 ? new Set(entityList) : null;
  if (!force) {
    const { data: existingJobs } = await supabaseAdmin
      .from('sync_jobs')
      .select('entity_alias, start_date, end_date, status')
      .eq('organization_id', orgId)
      .eq('integration_id', integration.id)
      .in('status', ['completed', 'running', 'queued'])
      .order('created_at', { ascending: false });

    if (existingJobs) {
      for (const job of existingJobs) {
        // Skip adding explicitly selected entities to the activeSet so they get re-synced
        if (explicitlySelected && explicitlySelected.has(job.entity_alias)) continue;
        const key = job.start_date
          ? `${job.entity_alias}|${job.start_date}|${job.end_date}`
          : job.entity_alias;
        activeSet.add(key);
      }
      console.log(`[JobQueue] Found ${activeSet.size} existing jobs (completed/running/queued) — will skip duplicates`);
    }
  }

  // Generate date chunks
  const startMs = new Date(syncStartDate).getTime();
  const endMs = new Date(syncEndDate).getTime();
  const daysDiff = Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24));

  // Monthly chunks for all date entities
  let chunks;
  if (daysDiff <= 62) {
    chunks = [{ startDate: syncStartDate, endDate: syncEndDate }];
    console.log(`[JobQueue] Small date range (${daysDiff} days) — using single chunk`);
  } else {
    chunks = generateReverseMonthlyChunksFromRange(syncStartDate, syncEndDate);
    console.log(`[JobQueue] Generated ${chunks.length} monthly chunks`);
  }

  // Separate entities into three categories:
  // 1. Non-date entities: no date filter at all (locations, categories, etc.)
  // 2. Single-date entities: only dateFilter, no dateFilterEnd (e.g. patients with updated_after only)
  //    → single job using sync start date, no monthly chunking
  // 3. Chunked date entities: both dateFilter and dateFilterEnd (appointments, invoices, etc.)
  //    → one job per monthly chunk
  // 'accounts' is a non-date entity but is deferred to the very end (Step 4 /
  //  Phase 4) — it's slow and a leaf entity, so it must not sit ahead of the
  //  date-entity jobs in the queue (the phase gate peeks only queue[0]).
  const accountsEntity = entitiesToSync.find(e => e.alias === 'accounts');
  const nonDateEntities = entitiesToSync.filter(e => !e.dateFilter && e.alias !== 'accounts');
  const singleDateEntities = entitiesToSync.filter(e => e.dateFilter && !e.dateFilterEnd);
  const chunkedDateEntities = entitiesToSync.filter(e => e.dateFilter && e.dateFilterEnd);

  // Build job rows in execution order:
  // 1. Non-date entities first (locations, categories, treatments, etc.) — run once
  // 2. Single-date entities (patients) — one job with sync start date only
  // 3. Then month-by-month (newest first): chunked date entities for each month
  const jobRows = [];
  let skipped = 0;

  // Step 1: Non-date entities (single job each, no date range)
  for (const entity of nonDateEntities) {
    if (activeSet.has(entity.alias)) {
      skipped++;
      continue;
    }
    jobRows.push({
      organization_id: orgId,
      integration_id: integration.id,
      user_id: userId,
      job_type: 'entity_sync',
      entity_alias: entity.alias,
      status: 'queued',
      progress_percentage: 0,
      current_page: 1,
      total_pages: null,
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      max_retries: 3,
      start_date: null,
      end_date: null,
    });
  }

  // Step 2: Single-date entities (one job each, start_date only — e.g. patients
  // updated_after). Always scope from the configured sync start (onboarding /
  // request override) through "now"; never pull unbounded historical data.
  for (const entity of singleDateEntities) {
    const isInitialSync = force || neverSyncedEntities.has(entity.alias);
    if (isInitialSync) {
      console.log(
        `[JobQueue] ${entity.alias}: initial sync — from ${syncStartDate} (updated_after)`
      );
    }

    if (activeSet.has(entity.alias)) {
      skipped++;
      continue;
    }
    jobRows.push({
      organization_id: orgId,
      integration_id: integration.id,
      user_id: userId,
      job_type: 'entity_sync',
      entity_alias: entity.alias,
      status: 'queued',
      progress_percentage: 0,
      current_page: 1,
      total_pages: null,
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      max_retries: 3,
      start_date: syncStartDate,
      end_date: null,
    });
  }

  // Step 3: Chunked date entities — one job per entity per month chunk
  for (const chunk of chunks) {
    for (const entity of chunkedDateEntities) {
      const key = `${entity.alias}|${chunk.startDate}|${chunk.endDate}`;
      if (activeSet.has(key)) {
        skipped++;
        continue;
      }
      jobRows.push({
        organization_id: orgId,
        integration_id: integration.id,
        user_id: userId,
        job_type: 'entity_sync',
        entity_alias: entity.alias,
        status: 'queued',
        progress_percentage: 0,
        current_page: 1,
        total_pages: null,
        records_processed: 0,
        records_failed: 0,
        retry_count: 0,
        max_retries: 3,
        start_date: chunk.startDate,
        end_date: chunk.endDate,
      });
    }
  }

  // Step 4: accounts LAST (Phase 4). Enqueued after every date-entity job so it
  // never blocks Phase 3 (patients/appointments/invoices/payments). It's the
  // slow one — a /v1/accounts/{id} detail call per record — and its location_id
  // is resolved from patients, which are synced by the time accounts runs.
  if (accountsEntity) {
    if (activeSet.has(accountsEntity.alias)) {
      skipped++;
    } else {
      jobRows.push({
        organization_id: orgId,
        integration_id: integration.id,
        user_id: userId,
        job_type: 'entity_sync',
        entity_alias: accountsEntity.alias,
        status: 'queued',
        progress_percentage: 0,
        current_page: 1,
        total_pages: null,
        records_processed: 0,
        records_failed: 0,
        retry_count: 0,
        max_retries: 3,
        start_date: null,
        end_date: null,
      });
    }
  }

  if (skipped > 0) {
    console.log(`[JobQueue] Skipped ${skipped} already-completed jobs for org ${orgId}`);
  }

  if (jobRows.length === 0) {
    console.log(`[JobQueue] All jobs already completed for org ${orgId}. Nothing to sync.`);
    return { jobCount: 0, skipped, jobs: [] };
  }

  // Insert all job rows
  const { data: createdJobs, error: insertError } = await supabaseAdmin
    .from('sync_jobs')
    .insert(jobRows)
    .select();

  if (insertError) {
    throw new Error(`Failed to create sync jobs: ${insertError.message}`);
  }

  console.log(`[JobQueue] Created ${createdJobs.length} sync jobs for org ${orgId} (skipped ${skipped} completed)`);

  // Enqueue in insertion order (already correct: non-date first, then month-by-month)
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

  // Also update DB directly in case it's not currently running
  const { error } = await supabaseAdmin
    .from('sync_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['queued', 'running']);

  if (error) {
    console.error(`[JobQueue] Failed to cancel job ${jobId}:`, error.message);
  }

  // Remove from in-memory queues (search across all per-integration lanes)
  for (const [, queue] of orgQueues) {
    const idx = queue.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      break;
    }
  }

  return !error;
}

/**
 * Cancel active Dentally jobs for a specific integration only.
 * Used by triggerSyncForIntegration so that syncing one account doesn't cancel another's jobs.
 */
async function cancelJobsForIntegration(orgId, integrationId) {
  const queueKey = makeQueueKey(orgId, integrationId);

  const { data: jobs } = await supabaseAdmin
    .from('sync_jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('integration_id', integrationId)
    .in('status', ['queued', 'running']);

  if (jobs && jobs.length > 0) {
    const jobIds = jobs.map(j => j.id);
    for (const id of jobIds) {
      cancelTokens.set(id, true);
    }

    await supabaseAdmin
      .from('sync_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .in('id', jobIds);

    // Remove cancelled jobs from this integration's in-memory lane only
    const existingQueue = orgQueues.get(queueKey) || [];
    const cancelledIds = new Set(jobIds);
    orgQueues.set(queueKey, existingQueue.filter(j => !cancelledIds.has(j.id)));

    console.log(`[JobQueue] Cancelled ${jobIds.length} jobs for integration ${integrationId.slice(0, 8)}`);
  }
}

/**
 * Cancel all active Dentally jobs for an organization (across ALL integrations).
 * Inner-joins integrations to exclude Iplicit jobs (which use platform_integrations).
 */
async function cancelAllJobs(orgId) {
  // Cancel in DB — only Dentally jobs (across ALL Dentally integrations for this org)
  const { data: allIntegrations } = await supabaseAdmin
    .from('integrations')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('integration_name', 'dentally')
    .is('deleted_at', null);

  const clearOrgLanes = () => {
    // Reset every per-integration lane that belongs to this org
    const prefix = `${orgId}:`;
    for (const key of orgQueues.keys()) {
      if (key.startsWith(prefix)) {
        orgQueues.set(key, []);
        activeWorkers.set(key, 0);
        activePhase1Workers.set(key, 0);
        activePhase2Workers.set(key, 0);
        activePhase3Workers.set(key, 0);
      }
    }
  };

  if (!allIntegrations || allIntegrations.length === 0) {
    clearOrgLanes();
    return;
  }

  const integrationIds = allIntegrations.map(i => i.id);

  const { data: jobs } = await supabaseAdmin
    .from('sync_jobs')
    .select('id')
    .eq('organization_id', orgId)
    .in('integration_id', integrationIds)
    .in('status', ['queued', 'running']);

  if (jobs && jobs.length > 0) {
    const jobIds = jobs.map(j => j.id);
    for (const id of jobIds) {
      cancelTokens.set(id, true);
    }

    // Cancel only the Dentally jobs we found (not Iplicit jobs)
    await supabaseAdmin
      .from('sync_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .in('id', jobIds);
  }

  clearOrgLanes();
}

/**
 * Get queue stats for monitoring.
 */
function getQueueStats() {
  // Aggregate per-integration lanes back up to the org level so route handlers
  // that read `stats[orgId]` keep working. Per-integration breakdown is exposed
  // under `perIntegration` for callers that need it.
  const stats = {};
  for (const [queueKey, queue] of orgQueues) {
    const [orgId, integrationId] = queueKey.split(':');
    if (!stats[orgId]) {
      stats[orgId] = { queued: 0, active: 0, perIntegration: {} };
    }
    const queued = queue.length;
    const active = activeWorkers.get(queueKey) || 0;
    stats[orgId].queued += queued;
    stats[orgId].active += active;
    stats[orgId].perIntegration[integrationId] = { queued, active };
  }
  return stats;
}

/**
 * Resume processing existing queued jobs for an organization.
 * Does NOT cancel or create new jobs — only enqueues existing queued DB rows
 * into the in-memory queue so the workers pick them up.
 * Only resumes Dentally jobs (inner-joins integrations to exclude Iplicit jobs).
 */
async function resumeQueuedJobs(orgId) {
  // Find ALL Dentally integrations for this org
  const { data: allIntegrations } = await supabaseAdmin
    .from('integrations')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('integration_name', 'dentally')
    .is('deleted_at', null);

  if (!allIntegrations || allIntegrations.length === 0) {
    console.log(`[JobQueue] No Dentally integration for org ${orgId}, nothing to resume`);
    return { resumed: 0 };
  }

  const integrationIds = allIntegrations.map(i => i.id);

  const { data: queuedJobs, error } = await supabaseAdmin
    .from('sync_jobs')
    .select('*')
    .eq('organization_id', orgId)
    .in('integration_id', integrationIds)
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`[JobQueue] Failed to fetch queued jobs for org ${orgId}:`, error.message);
    return { resumed: 0 };
  }

  if (!queuedJobs || queuedJobs.length === 0) {
    console.log(`[JobQueue] No queued jobs to resume for org ${orgId}`);
    return { resumed: 0 };
  }

  // Only enqueue jobs that are not already in any in-memory lane for this org
  const prefix = `${orgId}:`;
  const existingIds = new Set();
  for (const [key, queue] of orgQueues) {
    if (key.startsWith(prefix)) {
      for (const j of queue) existingIds.add(j.id);
    }
  }

  let resumed = 0;
  for (const job of queuedJobs) {
    if (!existingIds.has(job.id)) {
      enqueueJob(job);
      resumed++;
    }
  }

  console.log(`[JobQueue] Resumed ${resumed} queued jobs for org ${orgId} (${queuedJobs.length - resumed} already in queue)`);
  return { resumed };
}

/**
 * Watchdog: fail sync_jobs rows that look active in the DB but are NOT held
 * by this process and have not written any progress for SYNC_STALE_JOB_MINUTES.
 *
 * Why: sync_jobs.updated_at is bumped by a DB trigger on every write, so a
 * healthy job refreshes it constantly. Rows go permanently stale when the
 * backend crashed/restarted mid-run under a different process, or when DB
 * writes started failing (e.g. a revoked service key) so the engine could not
 * even mark its own jobs failed. Those rows otherwise block auto-sync forever
 * ("jobs already queued/running — will retry next tick", every tick).
 *
 * Jobs held by THIS process (queued in a phase gate, or a worker sleeping
 * through a Dentally rate-limit pause) are always skipped — they are alive by
 * definition, however old their last write is.
 */
const STALE_JOB_MINUTES = Number(process.env.SYNC_STALE_JOB_MINUTES) || 90;

async function sweepStaleJobs(integrationIds) {
  const cutoff = new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from('sync_jobs')
    .select('id, entity_alias, organization_id, status, updated_at')
    .in('status', ['queued', 'running'])
    .lt('updated_at', cutoff);
  if (Array.isArray(integrationIds) && integrationIds.length > 0) {
    query = query.in('integration_id', integrationIds);
  }
  const { data: staleRows, error } = await query;
  if (error) {
    console.error('[JobQueue] Stale-job sweep read failed:', error.message);
    return { swept: 0 };
  }
  if (!staleRows || staleRows.length === 0) return { swept: 0 };

  // Everything tracked in this process is alive, not stale.
  const heldIds = new Set(activeJobIds);
  for (const queue of orgQueues.values()) {
    for (const job of queue) heldIds.add(job.id);
  }

  const logger = require('../services/sync/logger');
  let swept = 0;
  for (const row of staleRows) {
    if (heldIds.has(row.id)) continue;
    await logger.markFailed(
      row.id,
      `Marked stale by watchdog: ${row.status} with no progress since ${row.updated_at} ` +
      `(limit ${STALE_JOB_MINUTES} min) and not held by the running sync engine. ` +
      `Safe to re-run — all sync writes are upserts.`,
    );
    console.warn(`[JobQueue] Watchdog failed stale job ${row.id} (${row.entity_alias}, org ${String(row.organization_id).slice(0, 8)}) — last progress ${row.updated_at}`);
    swept++;
  }
  if (swept > 0) console.log(`[JobQueue] Watchdog swept ${swept} stale job(s) — queue unblocked`);
  return { swept };
}

/**
 * Graceful shutdown.
 */
function shutdown() {
  isShuttingDown = true;
  console.log('[JobQueue] Shutting down...');
}

module.exports = {
  initialize,
  triggerSync,
  resumeQueuedJobs,
  cancelJob,
  cancelAllJobs,
  cancelJobsForIntegration,
  getQueueStats,
  sweepStaleJobs,
  shutdown,
};
