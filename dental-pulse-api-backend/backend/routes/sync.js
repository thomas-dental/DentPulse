const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const syncAuthMiddleware = require('../middleware/syncAuth');
const authMiddleware = require('../middleware/auth');
const { triggerSync, resumeQueuedJobs, cancelJob, cancelAllJobs, cancelJobsForIntegration, getQueueStats } = require('../queue');
const { triggerProgressiveSync } = require('../services/autoSyncCron');

const router = express.Router();

// POST /api/sync/trigger/:orgId - Trigger full sync for an organization
// Query params: ?force=true to ignore completed jobs and re-sync everything
// Body (optional): { start_date, end_date, entities: ['patients', 'appointments'] }
router.post('/trigger/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user?.id || null;
    const force = req.query.force === 'true';
    const { start_date, end_date, entities, integration_id } = req.body || {};
    const options = {};
    if (start_date && end_date) {
      options.startDate = start_date;
      options.endDate = end_date;
    }
    if (entities && Array.isArray(entities) && entities.length > 0) {
      options.entities = entities;
    }
    if (integration_id) {
      options.integrationId = integration_id;
    }
    const result = await triggerSync(orgId, null, userId, force, options);
    return res.json({
      success: true,
      message: result.jobCount > 0
        ? `Created ${result.jobCount} sync jobs (skipped ${result.skipped} completed)`
        : 'All jobs already completed. Nothing to sync.',
      jobCount: result.jobCount,
      skipped: result.skipped,
      jobs: result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias, start_date: j.start_date, end_date: j.end_date })),
    });
  } catch (err) {
    console.error('[SyncRoute] Trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/trigger/:orgId/:entityAlias - Trigger single entity sync
// Body (optional): { start_date, end_date }
router.post('/trigger/:orgId/:entityAlias', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, entityAlias } = req.params;
    const userId = req.user?.id || null;
    const force = req.query.force === 'true';
    const { start_date, end_date, integration_id } = req.body || {};
    const options = {};
    if (start_date && end_date) {
      options.startDate = start_date;
      options.endDate = end_date;
    }
    if (integration_id) {
      options.integrationId = integration_id;
    }
    const result = await triggerSync(orgId, entityAlias, userId, force, options);
    return res.json({
      success: true,
      message: result.jobCount > 0
        ? `Created ${result.jobCount} sync jobs for ${entityAlias} (skipped ${result.skipped} completed)`
        : `All ${entityAlias} jobs already completed. Nothing to sync.`,
      jobCount: result.jobCount,
      skipped: result.skipped,
      jobs: result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias, start_date: j.start_date, end_date: j.end_date })),
    });
  } catch (err) {
    console.error('[SyncRoute] Trigger entity error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/resume/:orgId - Resume processing existing queued jobs (no cancellation, no new jobs)
router.post('/resume/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const result = await resumeQueuedJobs(orgId);
    return res.json({ success: true, resumed: result.resumed });
  } catch (err) {
    console.error('[SyncRoute] Resume error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/sync/status/:orgId - Get all sync jobs for an organization
router.get('/status/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { data: jobs, error } = await supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const stats = getQueueStats();

    return res.json({
      jobs: jobs || [],
      queueStats: stats[orgId] || { queued: 0, active: 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

/**
 * GET /api/sync/active/:orgId
 * Active sync jobs only (queued | running) — for UI status polling.
 * Frontend should poll this instead of querying sync_jobs via Supabase REST.
 */
router.get('/active/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { data: jobs, error } = await supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .eq('organization_id', orgId)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const list = jobs || [];
    return res.json({
      success: true,
      jobs: list,
      isAnySyncRunning: list.some((j) => j.status === 'running'),
      hasQueuedJobs: list.some((j) => j.status === 'queued'),
    });
  } catch (err) {
    console.error('[SyncRoute] Active jobs error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch active sync jobs' });
  }
});

// GET /api/sync/job/:jobId - Get single job status
router.get('/job/:jobId', syncAuthMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { data: job, error } = await supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.json(job);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// POST /api/sync/cancel/:jobId - Cancel a single job
router.post('/cancel/:jobId', syncAuthMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    const success = await cancelJob(jobId);
    return res.json({ success, message: success ? 'Job cancelled' : 'Failed to cancel job' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel job' });
  }
});

// POST /api/sync/dev-trigger/:orgId - Dev-only trigger (no user auth, validates service role key)
// Query params: ?entity=patients&force=true
router.post('/dev-trigger/:orgId', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'];
    if (serviceKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(401).json({ error: 'Invalid service key' });
    }
    const { orgId } = req.params;
    const entityAlias = req.query.entity || null;
    const force = req.query.force === 'true';
    // Look up the org owner so synced records get a proper user_id
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('user_id')
      .eq('id', orgId)
      .single();
    const userId = org?.user_id || null;
    const result = await triggerSync(orgId, entityAlias, userId, force);
    return res.json({
      success: true,
      message: `Created ${result.jobCount} sync jobs (skipped ${result.skipped} completed)`,
      jobCount: result.jobCount,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error('[SyncRoute] Dev trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/dev-stop/:orgId - Dev-only stop all sync (service key auth)
router.post('/dev-stop/:orgId', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'];
    if (serviceKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(401).json({ error: 'Invalid service key' });
    }
    const { orgId } = req.params;
    await cancelAllJobs(orgId);
    return res.json({ success: true, message: 'All sync jobs cancelled for org' });
  } catch (err) {
    console.error('[SyncRoute] Dev stop error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/cancel-all/:orgId - Cancel all active jobs for an organization
router.post('/cancel-all/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    await cancelAllJobs(orgId);
    return res.json({ success: true, message: 'All active jobs cancelled' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel jobs' });
  }
});

// ── Superadmin endpoints (requires superadmin auth) ──

// POST /api/sync/admin/stop/:orgId - Stop sync for an organization.
// Body (optional): { integration_id } — stop ONLY that Dentally account's lane,
// leaving other accounts (running in parallel) untouched. Omit to stop all.
router.post('/admin/stop/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { integration_id } = req.body || {};
    if (integration_id) {
      await cancelJobsForIntegration(orgId, integration_id);
      return res.json({ success: true, message: 'Sync jobs stopped for this account' });
    }
    await cancelAllJobs(orgId);
    return res.json({ success: true, message: 'All sync jobs stopped' });
  } catch (err) {
    console.error('[SyncRoute] Admin stop error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/admin/trigger/:orgId - Trigger full sync for an organization
// Query params: ?force=true to ignore completed jobs and re-sync everything
// Body (optional): { start_date, end_date, entities: ['patients', 'appointments'] }
router.post('/admin/trigger/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const force = req.query.force === 'true';
    const { start_date, end_date, entities, integration_id } = req.body || {};
    const options = {};
    if (start_date && end_date) {
      options.startDate = start_date;
      options.endDate = end_date;
    }
    if (entities && Array.isArray(entities) && entities.length > 0) {
      options.entities = entities;
    }
    if (integration_id) {
      options.integrationId = integration_id;
    }
    // Look up the org owner so synced records get a proper user_id
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('user_id')
      .eq('id', orgId)
      .single();
    const userId = org?.user_id || null;
    const result = await triggerSync(orgId, null, userId, force, options);
    return res.json({
      success: true,
      message: result.jobCount > 0
        ? `Created ${result.jobCount} sync jobs (skipped ${result.skipped} completed)`
        : 'All jobs already completed. Nothing to sync.',
      jobCount: result.jobCount,
      skipped: result.skipped,
      jobs: result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias, start_date: j.start_date, end_date: j.end_date })),
    });
  } catch (err) {
    console.error('[SyncRoute] Admin trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/sync/admin/status/:orgId - Get sync status for an organization.
// Query (optional): ?integration_id=... — scope status to a single Dentally
// account so the SuperAdmin panel can monitor (and start/stop) each connected
// account independently while they sync in parallel. Omit for the org total.
router.get('/admin/status/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { integration_id } = req.query;

    // Get recent jobs (optionally scoped to one integration / Dentally account)
    let jobsQuery = supabaseAdmin
      .from('sync_jobs')
      .select('id, entity_alias, status, records_processed, records_failed, progress_percentage, current_page, total_pages, created_at, completed_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (integration_id) jobsQuery = jobsQuery.eq('integration_id', integration_id);
    const { data: jobs, error } = await jobsQuery;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const queueStats = getQueueStats();
    const orgEntry = queueStats[orgId] || { queued: 0, active: 0, perIntegration: {} };
    const orgStats = integration_id
      ? (orgEntry.perIntegration?.[integration_id] || { queued: 0, active: 0 })
      : orgEntry;

    // Summarize
    const summary = {
      total: jobs?.length || 0,
      running: jobs?.filter(j => j.status === 'running').length || 0,
      queued: jobs?.filter(j => j.status === 'queued').length || 0,
      completed: jobs?.filter(j => j.status === 'completed').length || 0,
      failed: jobs?.filter(j => j.status === 'failed').length || 0,
      cancelled: jobs?.filter(j => j.status === 'cancelled').length || 0,
      totalRecords: jobs?.reduce((sum, j) => sum + (j.records_processed || 0), 0) || 0,
    };

    return res.json({
      summary,
      queueStats: orgStats,
      isSyncing: summary.running > 0 || summary.queued > 0,
      jobs: jobs || [],
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

// ── Auto-sync (after clinic close) ──

// GET /api/sync/auto-sync/history - Recent auto-sync runs.
// Query (optional): ?orgId=... to scope to one organization, ?limit=N (max 200).
router.get('/auto-sync/history', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.query;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    let query = supabaseAdmin
      .from('auto_sync_runs')
      .select('*')
      .order('triggered_at', { ascending: false })
      .limit(limit);
    if (orgId) query = query.eq('organization_id', orgId);
    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json({ runs: data || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch auto-sync history' });
  }
});

// POST /api/sync/progressive/:orgId - On-demand last-updated incremental sync
// (same window + entity list as the nightly 00:00 UK auto-sync). Body optional:
// { integration_id } to scope to one Dentally connection.
router.post('/progressive/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user?.id || null;
    const { integration_id } = req.body || {};
    const result = await triggerProgressiveSync(orgId, userId, integration_id || null);
    return res.json({
      success: true,
      message: result.jobCount > 0
        ? `Created ${result.jobCount} progressive sync jobs (window ${result.windowStart} → ${result.windowEnd})`
        : 'Nothing to sync for this progressive window.',
      jobCount: result.jobCount,
      skipped: result.skipped,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      lookbackDays: result.lookbackDays,
      jobs: result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias, start_date: j.start_date, end_date: j.end_date })),
    });
  } catch (err) {
    console.error('[SyncRoute] Progressive sync error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/auto-sync/check - Run the auto-sync evaluation immediately
// (same logic as the 15-minute cron tick: close-time gating and the
// once-per-day claim still apply). Returns the per-org decisions so an admin
// can see exactly why each org did or didn't trigger.
router.post('/auto-sync/check', authMiddleware, async (req, res) => {
  try {
    const { runAutoSyncCheck } = require('../services/autoSyncCron');
    const result = await runAutoSyncCheck('manual-check');
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[SyncRoute] Auto-sync check error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
