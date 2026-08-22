/**
 * QuickBooks sync routes.
 * Base path: /api/quickbooks-sync
 * Mirrors routes/xeroSync.js.
 */

const express            = require('express');
const { supabaseAdmin }  = require('../config/supabase');
const syncAuthMiddleware = require('../middleware/syncAuth');
const authMiddleware     = require('../middleware/auth');
const qbQueue            = require('../queue/quickbooks/jobQueue');

const router = express.Router();

// ── User-facing endpoints (JWT auth) ──────────────────────────────────────────

// POST /api/quickbooks-sync/trigger/:orgId  — full sync
router.post('/trigger/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId    = req.user?.id || null;
    const force     = req.query.force === 'true';
    const { connectionId } = req.body || {};

    const result = await qbQueue.triggerSync(orgId, null, userId, force, connectionId);
    return res.json({
      success:  true,
      message:  result.jobCount > 0
        ? `Created ${result.jobCount} QuickBooks sync jobs (skipped ${result.skipped} already active)`
        : 'All QuickBooks jobs already active. Nothing to sync.',
      jobCount: result.jobCount,
      skipped:  result.skipped,
      jobs:     result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[QuickBooksSyncRoute] Trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/quickbooks-sync/trigger/:orgId/:entityAlias  — single entity
router.post('/trigger/:orgId/:entityAlias', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, entityAlias } = req.params;
    const userId = req.user?.id || null;
    const force  = req.query.force === 'true';
    const { connectionId } = req.body || {};

    const result = await qbQueue.triggerSync(orgId, entityAlias, userId, force, connectionId);
    return res.json({
      success:  true,
      message:  result.jobCount > 0
        ? `Created ${result.jobCount} QuickBooks sync jobs for ${entityAlias}`
        : `${entityAlias} already active. Nothing to sync.`,
      jobCount: result.jobCount,
      skipped:  result.skipped,
      jobs:     result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[QuickBooksSyncRoute] Trigger entity error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/quickbooks-sync/resume/:orgId
router.post('/resume/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const result = await qbQueue.resumeQueuedJobs(req.params.orgId);
    return res.json({ success: true, resumed: result.resumed });
  } catch (err) {
    console.error('[QuickBooksSyncRoute] Resume error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/quickbooks-sync/job/:jobId
router.get('/job/:jobId', syncAuthMiddleware, async (req, res) => {
  try {
    const { data: job, error } = await supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .eq('id', req.params.jobId)
      .single();
    if (error || !job) return res.status(404).json({ error: 'Job not found' });
    return res.json(job);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// GET /api/quickbooks-sync/status/:orgId
router.get('/status/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;

    const { data: connections } = await supabaseAdmin
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('platform_name', 'quickbooks');

    let query = supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);

    const connIds = (connections || []).map(c => c.id);
    if (connIds.length > 0) query = query.in('integration_id', connIds);

    const { data: jobs, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const stats = qbQueue.getQueueStats();
    return res.json({ jobs: jobs || [], queueStats: stats[orgId] || { queued: 0, active: 0 } });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch QuickBooks sync status' });
  }
});

// POST /api/quickbooks-sync/cancel/:jobId
router.post('/cancel/:jobId', syncAuthMiddleware, async (req, res) => {
  try {
    await qbQueue.cancelJob(req.params.jobId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel job' });
  }
});

// POST /api/quickbooks-sync/cancel-all/:orgId
router.post('/cancel-all/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    await qbQueue.cancelAllJobs(req.params.orgId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel QuickBooks jobs' });
  }
});

// ── Dev endpoint (service-key auth) ──────────────────────────────────────────

// POST /api/quickbooks-sync/dev-trigger/:orgId
router.post('/dev-trigger/:orgId', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'];
    if (serviceKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(401).json({ error: 'Invalid service key' });
    }
    const { orgId } = req.params;
    const entityAlias = req.query.entity || null;
    const force       = req.query.force === 'true';
    const { connectionId } = req.body || {};

    const result = await qbQueue.triggerSync(orgId, entityAlias, null, force, connectionId);
    return res.json({
      success:  true,
      message:  `Created ${result.jobCount} QuickBooks sync jobs (skipped ${result.skipped})`,
      jobCount: result.jobCount,
      skipped:  result.skipped,
      jobs:     result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[QuickBooksSyncRoute] Dev trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── SuperAdmin endpoints ──────────────────────────────────────────────────────

router.post('/admin/trigger/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const force     = req.query.force === 'true';

    const { data: orgOwner } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('role', 'owner')
      .maybeSingle();

    const result = await qbQueue.triggerSync(orgId, null, orgOwner?.user_id || null, force);
    return res.json({
      success:  true,
      message:  result.jobCount > 0
        ? `Created ${result.jobCount} QuickBooks sync jobs`
        : 'All QuickBooks jobs already active.',
      jobCount: result.jobCount,
      skipped:  result.skipped,
    });
  } catch (err) {
    console.error('[QuickBooksSyncRoute] Admin trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/stop/:orgId', authMiddleware, async (req, res) => {
  try {
    await qbQueue.cancelAllJobs(req.params.orgId);
    return res.json({ success: true, message: 'All QuickBooks sync jobs stopped' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to stop QuickBooks jobs' });
  }
});

router.get('/admin/status/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;

    const { data: connections } = await supabaseAdmin
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('platform_name', 'quickbooks');

    let query = supabaseAdmin
      .from('sync_jobs')
      .select('id, entity_alias, status, records_processed, records_failed, progress_percentage, current_page, total_pages, created_at, completed_at, error_message')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);

    const connIds = (connections || []).map(c => c.id);
    if (connIds.length > 0) query = query.in('integration_id', connIds);

    const { data: jobs, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const queueStats = qbQueue.getQueueStats();
    const orgStats   = queueStats[orgId] || { queued: 0, active: 0 };
    const summary = {
      total:        jobs?.length || 0,
      running:      jobs?.filter(j => j.status === 'running').length   || 0,
      queued:       jobs?.filter(j => j.status === 'queued').length    || 0,
      completed:    jobs?.filter(j => j.status === 'completed').length || 0,
      failed:       jobs?.filter(j => j.status === 'failed').length    || 0,
      cancelled:    jobs?.filter(j => j.status === 'cancelled').length || 0,
      totalRecords: jobs?.reduce((s, j) => s + (j.records_processed || 0), 0) || 0,
    };

    return res.json({
      summary,
      queueStats: orgStats,
      isSyncing:  summary.running > 0 || summary.queued > 0,
      jobs:       jobs || [],
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch QuickBooks sync status' });
  }
});

// ── P&L read endpoint ─────────────────────────────────────────────────────────

// GET /api/quickbooks-sync/profit-loss/:orgId  (?from&to&section&groupBy)
router.get('/profit-loss/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { from, to, section, groupBy = 'month' } = req.query;

    let plQuery = supabaseAdmin
      .from('quickbooks_profit_loss')
      .select('id, from_date, to_date, period_year, period_month, section, qb_account_id, account_name, amount')
      .eq('organization_id', orgId)
      .order('to_date', { ascending: true })
      .order('section', { ascending: true });

    if (from)    plQuery = plQuery.gte('from_date', from);
    if (to)      plQuery = plQuery.lte('to_date', to);
    if (section) plQuery = plQuery.eq('section', section);

    const { data: rows, error } = await plQuery;
    if (error) return res.status(500).json({ error: error.message });

    const flat = rows || [];

    if (groupBy === 'section') {
      const bySection = {};
      for (const r of flat) {
        const key = r.section || 'Other';
        bySection[key] = (bySection[key] || 0) + Number(r.amount);
      }
      return res.json({ groupBy: 'section', data: bySection });
    }
    if (groupBy === 'account') {
      const byAccount = {};
      for (const r of flat) {
        if (!byAccount[r.qb_account_id]) {
          byAccount[r.qb_account_id] = {
            qb_account_id: r.qb_account_id,
            account_name:  r.account_name,
            section:       r.section,
            total:         0,
          };
        }
        byAccount[r.qb_account_id].total += Number(r.amount);
      }
      return res.json({ groupBy: 'account', data: Object.values(byAccount).sort((a, b) => b.total - a.total) });
    }

    return res.json({ groupBy: 'month', total: flat.reduce((s, r) => s + Number(r.amount), 0), data: flat });
  } catch (err) {
    console.error('[QuickBooksSyncRoute] P&L read error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/quickbooks-sync/profit-loss/:orgId/trigger
router.post('/profit-loss/:orgId/trigger', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId    = req.user?.id || null;
    const force     = req.query.force === 'true';
    const { connectionId } = req.body || {};

    const result = await qbQueue.triggerSync(orgId, 'quickbooks_profit_loss', userId, force, connectionId);
    return res.json({
      success:  true,
      message:  result.jobCount > 0 ? `Created ${result.jobCount} P&L sync job(s)` : 'P&L sync already active.',
      jobCount: result.jobCount,
      jobs:     result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[QuickBooksSyncRoute] P&L trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
