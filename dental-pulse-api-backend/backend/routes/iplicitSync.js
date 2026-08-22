/**
 * Iplicit sync routes — mirrors the Dentally sync routes pattern.
 *
 * Base path: /api/iplicit-sync
 */

const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const syncAuthMiddleware = require('../middleware/syncAuth');
const authMiddleware = require('../middleware/auth');
const iplicitQueue = require('../queue/iplicit/jobQueue');
const { fetchAndSyncSupplier } = require('../services/iplicit/supplierService');

const router = express.Router();

// ── User-facing endpoints (JWT auth) ──────────────────────────────────────────

// POST /api/iplicit-sync/trigger/:orgId
// Trigger full Iplicit sync for an organization
// Query: ?force=true to re-sync completed jobs
router.post('/trigger/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user?.id || null;
    const force = req.query.force === 'true';
    const { connectionId } = req.body || {};

    const result = await iplicitQueue.triggerSync(orgId, null, userId, force, connectionId);

    return res.json({
      success: true,
      message: result.jobCount > 0
        ? `Created ${result.jobCount} Iplicit sync jobs (skipped ${result.skipped} completed)`
        : 'All Iplicit jobs already completed. Nothing to sync.',
      jobCount: result.jobCount,
      skipped: result.skipped,
      jobs: result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[IplicitSyncRoute] Trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/iplicit-sync/trigger/:orgId/:entityAlias
// Trigger single-entity sync
router.post('/trigger/:orgId/:entityAlias', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, entityAlias } = req.params;
    const userId = req.user?.id || null;
    const force = req.query.force === 'true';
    const { connectionId } = req.body || {};

    const result = await iplicitQueue.triggerSync(orgId, entityAlias, userId, force, connectionId);

    return res.json({
      success: true,
      message: result.jobCount > 0
        ? `Created ${result.jobCount} Iplicit sync jobs for ${entityAlias} (skipped ${result.skipped} completed)`
        : `All ${entityAlias} jobs already completed. Nothing to sync.`,
      jobCount: result.jobCount,
      skipped: result.skipped,
      jobs: result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[IplicitSyncRoute] Trigger entity error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/iplicit-sync/resume/:orgId
// Resume existing queued jobs without creating new ones
router.post('/resume/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const result = await iplicitQueue.resumeQueuedJobs(orgId);
    return res.json({ success: true, resumed: result.resumed });
  } catch (err) {
    console.error('[IplicitSyncRoute] Resume error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/iplicit-sync/status/:orgId
// Get all Iplicit sync jobs for an organization
router.get('/status/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;

    // Look up all iplicit connection ids so we can filter jobs
    const { data: iplicitConnections } = await supabaseAdmin
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('platform_name', 'iplicit');

    const iplicitIds = (iplicitConnections || []).map(c => c.id);

    let query = supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (iplicitIds.length > 0) {
      query = query.in('integration_id', iplicitIds);
    }

    const { data: jobs, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const stats = iplicitQueue.getQueueStats();

    return res.json({
      jobs: jobs || [],
      queueStats: stats[orgId] || { queued: 0, active: 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch Iplicit sync status' });
  }
});

// GET /api/iplicit-sync/job/:jobId
// Get single job status
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

// POST /api/iplicit-sync/cancel/:jobId
// Cancel a single job
router.post('/cancel/:jobId', syncAuthMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    await iplicitQueue.cancelJob(jobId);
    return res.json({ success: true, message: 'Job cancelled' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel job' });
  }
});

// POST /api/iplicit-sync/cancel-all/:orgId
// Cancel all active Iplicit jobs for an organization
router.post('/cancel-all/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    await iplicitQueue.cancelAllJobs(orgId);
    return res.json({ success: true, message: 'All Iplicit jobs cancelled' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel Iplicit jobs' });
  }
});

// POST /api/iplicit-sync/supplier/:orgId
// Fetch a single supplier from Iplicit by ContactAccountId and upsert into DB.
// Body: { supplierId: "SUP-001" }
// Used by the invoice push mechanism to ensure a supplier exists locally
// before pushing an invoice that references them.
router.post('/supplier/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { supplierId, connectionId } = req.body;

    if (!supplierId) {
      return res.status(400).json({ error: 'supplierId is required in request body' });
    }

    const supplier = await fetchAndSyncSupplier(orgId, supplierId, connectionId || null);

    return res.json({ success: true, supplier });
  } catch (err) {
    console.error('[IplicitSyncRoute] Supplier fetch error:', err.message);
    const status = err.message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: err.message });
  }
});

// ── Dev endpoint (service-key auth) ──────────────────────────────────────────

// POST /api/iplicit-sync/dev-trigger/:orgId
// Dev-only trigger — no user auth, validates service role key
router.post('/dev-trigger/:orgId', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'];
    if (serviceKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(401).json({ error: 'Invalid service key' });
    }

    const { orgId } = req.params;
    const entityAlias = req.query.entity || null;
    const force = req.query.force === 'true';

    const result = await iplicitQueue.triggerSync(orgId, entityAlias, null, force);

    return res.json({
      success: true,
      message: `Created ${result.jobCount} Iplicit sync jobs (skipped ${result.skipped} completed)`,
      jobCount: result.jobCount,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error('[IplicitSyncRoute] Dev trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Superadmin endpoints ──────────────────────────────────────────────────────

// POST /api/iplicit-sync/admin/trigger/:orgId
router.post('/admin/trigger/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const force = req.query.force === 'true';

    // Use the org's owner UUID (not the admin's) so synced data is attributed to the right user
    const { data: orgOwner } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('role', 'owner')
      .maybeSingle();
    const userId = orgOwner?.user_id || null;

    const result = await iplicitQueue.triggerSync(orgId, null, userId, force);

    return res.json({
      success: true,
      message: result.jobCount > 0
        ? `Created ${result.jobCount} Iplicit sync jobs (skipped ${result.skipped} completed)`
        : 'All Iplicit jobs already completed. Nothing to sync.',
      jobCount: result.jobCount,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error('[IplicitSyncRoute] Admin trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/iplicit-sync/admin/stop/:orgId
router.post('/admin/stop/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    await iplicitQueue.cancelAllJobs(orgId);
    return res.json({ success: true, message: 'All Iplicit sync jobs stopped' });
  } catch (err) {
    console.error('[IplicitSyncRoute] Admin stop error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/iplicit-sync/admin/status/:orgId
router.get('/admin/status/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;

    const { data: iplicitConns } = await supabaseAdmin
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('platform_name', 'iplicit');

    const iplicitIds = (iplicitConns || []).map(c => c.id);

    let query = supabaseAdmin
      .from('sync_jobs')
      .select('id, entity_alias, status, records_processed, records_failed, progress_percentage, current_page, total_pages, created_at, completed_at, error_message')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (iplicitIds.length > 0) {
      query = query.in('integration_id', iplicitIds);
    }

    const { data: jobs, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const queueStats = iplicitQueue.getQueueStats();
    const orgStats = queueStats[orgId] || { queued: 0, active: 0 };

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
    return res.status(500).json({ error: 'Failed to fetch Iplicit sync status' });
  }
});

module.exports = router;
