/**
 * Xero sync routes.
 * Base path: /api/xero-sync
 */

const express          = require('express');
const { supabaseAdmin } = require('../config/supabase');
const syncAuthMiddleware = require('../middleware/syncAuth');
const authMiddleware    = require('../middleware/auth');
const xeroQueue         = require('../queue/xero/jobQueue');

const router = express.Router();

// ── User-facing endpoints (JWT auth) ──────────────────────────────────────────

// POST /api/xero-sync/trigger/:orgId  — full sync
router.post('/trigger/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId    = req.user?.id || null;
    const force     = req.query.force === 'true';
    const { connectionId } = req.body || {};

    const result = await xeroQueue.triggerSync(orgId, null, userId, force, connectionId);
    return res.json({
      success:  true,
      message:  result.jobCount > 0
        ? `Created ${result.jobCount} Xero sync jobs (skipped ${result.skipped} already active)`
        : 'All Xero jobs already active. Nothing to sync.',
      jobCount: result.jobCount,
      skipped:  result.skipped,
      jobs:     result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[XeroSyncRoute] Trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/xero-sync/trigger/:orgId/:entityAlias  — single entity
router.post('/trigger/:orgId/:entityAlias', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, entityAlias } = req.params;
    const userId = req.user?.id || null;
    const force  = req.query.force === 'true';
    const { connectionId } = req.body || {};

    const result = await xeroQueue.triggerSync(orgId, entityAlias, userId, force, connectionId);
    return res.json({
      success:  true,
      message:  result.jobCount > 0
        ? `Created ${result.jobCount} Xero sync jobs for ${entityAlias}`
        : `${entityAlias} already active. Nothing to sync.`,
      jobCount: result.jobCount,
      skipped:  result.skipped,
      jobs:     result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[XeroSyncRoute] Trigger entity error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/xero-sync/resume/:orgId — resume existing queued jobs without creating new ones
router.post('/resume/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const result = await xeroQueue.resumeQueuedJobs(orgId);
    return res.json({ success: true, resumed: result.resumed });
  } catch (err) {
    console.error('[XeroSyncRoute] Resume error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/xero-sync/job/:jobId — single job status
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

// GET /api/xero-sync/status/:orgId
router.get('/status/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;

    const { data: connection } = await supabaseAdmin
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('platform_name', 'xero')
      .maybeSingle();

    let query = supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (connection?.id) query = query.eq('integration_id', connection.id);

    const { data: jobs, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const stats = xeroQueue.getQueueStats();
    return res.json({ jobs: jobs || [], queueStats: stats[orgId] || { queued: 0, active: 0 } });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch Xero sync status' });
  }
});

// POST /api/xero-sync/cancel/:jobId
router.post('/cancel/:jobId', syncAuthMiddleware, async (req, res) => {
  try {
    await xeroQueue.cancelJob(req.params.jobId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel job' });
  }
});

// POST /api/xero-sync/cancel-all/:orgId
router.post('/cancel-all/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    await xeroQueue.cancelAllJobs(req.params.orgId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel Xero jobs' });
  }
});

// ── Dev endpoint (service-key auth) ──────────────────────────────────────────

// POST /api/xero-sync/dev-trigger/:orgId — mirror of Iplicit dev-trigger.
// Body: { connectionId?, entity? }. Validates X-Service-Key header against
// SUPABASE_SERVICE_ROLE_KEY.
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

    const result = await xeroQueue.triggerSync(orgId, entityAlias, null, force, connectionId);
    return res.json({
      success:  true,
      message:  `Created ${result.jobCount} Xero sync jobs (skipped ${result.skipped})`,
      jobCount: result.jobCount,
      skipped:  result.skipped,
      jobs:     result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[XeroSyncRoute] Dev trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── SuperAdmin endpoints ──────────────────────────────────────────────────────

// POST /api/xero-sync/admin/trigger/:orgId
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
    const userId = orgOwner?.user_id || null;

    const result = await xeroQueue.triggerSync(orgId, null, userId, force);
    return res.json({
      success:  true,
      message:  result.jobCount > 0
        ? `Created ${result.jobCount} Xero sync jobs`
        : 'All Xero jobs already active.',
      jobCount: result.jobCount,
      skipped:  result.skipped,
    });
  } catch (err) {
    console.error('[XeroSyncRoute] Admin trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/xero-sync/admin/stop/:orgId
router.post('/admin/stop/:orgId', authMiddleware, async (req, res) => {
  try {
    await xeroQueue.cancelAllJobs(req.params.orgId);
    return res.json({ success: true, message: 'All Xero sync jobs stopped' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to stop Xero jobs' });
  }
});

// GET /api/xero-sync/admin/status/:orgId
router.get('/admin/status/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;

    const { data: connection } = await supabaseAdmin
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('platform_name', 'xero')
      .maybeSingle();

    let query = supabaseAdmin
      .from('sync_jobs')
      .select('id, entity_alias, status, records_processed, records_failed, progress_percentage, current_page, total_pages, created_at, completed_at, error_message')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (connection?.id) query = query.eq('integration_id', connection.id);

    const { data: jobs, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const queueStats = xeroQueue.getQueueStats();
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
    return res.status(500).json({ error: 'Failed to fetch Xero sync status' });
  }
});

// ── P&L report read endpoints ─────────────────────────────────────────────────

// GET /api/xero-sync/profit-loss/:orgId
// Query params (all optional):
//   from=YYYY-MM-DD   filter by from_date >=
//   to=YYYY-MM-DD     filter by to_date   <=
//   section=...       filter by section name (exact match)
//   groupBy=month     (default) — one row per (section, account, month)
//   groupBy=section   — aggregate per section across the date range
//   groupBy=account   — aggregate per account across the date range
router.get('/profit-loss/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { from, to, section, groupBy = 'month' } = req.query;

    // Resolve the active Xero tenant for this org
    const { data: tenant } = await supabaseAdmin
      .from('platform_integration_organizations')
      .select('id, platform_integration_id')
      .eq('organization_id', orgId)
      .eq('platform_name', 'xero')
      .eq('status', 'active')
      .maybeSingle();

    // Fetch P&L rows
    let plQuery = supabaseAdmin
      .from('xero_profit_loss')
      .select('id, from_date, to_date, period_year, period_month, section, xero_account_id, amount')
      .eq('organization_id', orgId)
      .order('to_date',  { ascending: true })
      .order('section',  { ascending: true });

    if (tenant?.id) plQuery = plQuery.eq('xero_tenant_id', tenant.id);
    if (from)       plQuery = plQuery.gte('from_date', from);
    if (to)         plQuery = plQuery.lte('to_date', to);
    if (section)    plQuery = plQuery.eq('section', section);

    const { data: rows, error } = await plQuery;
    if (error) return res.status(500).json({ error: error.message });

    // Resolve account details from xero_chart_of_accounts in one batch query
    const accountIds = [...new Set((rows || []).map(r => r.xero_account_id).filter(Boolean))];
    const coaMap = {};
    if (accountIds.length > 0) {
      let coaQuery = supabaseAdmin
        .from('xero_chart_of_accounts')
        .select('xero_account_id, account_code, account_name, account_type, classification')
        .eq('organization_id', orgId)
        .in('xero_account_id', accountIds);
      if (tenant?.platform_integration_id) {
        coaQuery = coaQuery.eq('platform_integration_id', tenant.platform_integration_id);
      }
      const { data: coaRows } = await coaQuery;
      (coaRows || []).forEach(c => { coaMap[c.xero_account_id] = c; });
    }

    const flat = (rows || []).map(r => {
      const coa = coaMap[r.xero_account_id] || {};
      return {
        id:              r.id,
        from_date:       r.from_date,
        to_date:         r.to_date,
        period_year:     r.period_year,
        period_month:    r.period_month,
        section:         r.section,
        xero_account_id: r.xero_account_id,
        account_code:    coa.account_code    || null,
        account_name:    coa.account_name    || null,
        account_type:    coa.account_type    || null,
        classification:  coa.classification  || null,
        amount:          r.amount,
      };
    });

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
        const key = r.xero_account_id;
        if (!byAccount[key]) {
          byAccount[key] = {
            xero_account_id: r.xero_account_id,
            account_code:    r.account_code,
            account_name:    r.account_name,
            account_type:    r.account_type,
            section:         r.section,
            total:           0,
          };
        }
        byAccount[key].total += Number(r.amount);
      }
      return res.json({ groupBy: 'account', data: Object.values(byAccount).sort((a, b) => b.total - a.total) });
    }

    // Default: groupBy=month — return flat rows
    return res.json({ groupBy: 'month', total: flat.reduce((s, r) => s + Number(r.amount), 0), data: flat });
  } catch (err) {
    console.error('[XeroSyncRoute] P&L read error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/xero-sync/profit-loss/:orgId/trigger
// Trigger a P&L report sync for the org. Optional body: { from, to }
router.post('/profit-loss/:orgId/trigger', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId }  = req.params;
    const userId     = req.user?.id || null;
    const force      = req.query.force === 'true';
    const { connectionId, from, to } = req.body || {};

    const result = await xeroQueue.triggerSync(
      orgId,
      'xero_profit_loss',
      userId,
      force,
      connectionId,
    );

    return res.json({
      success:  true,
      message:  result.jobCount > 0
        ? `Created ${result.jobCount} P&L sync job(s)`
        : 'P&L sync already active.',
      jobCount: result.jobCount,
      jobs:     result.jobs.map(j => ({ id: j.id, entity_alias: j.entity_alias })),
    });
  } catch (err) {
    console.error('[XeroSyncRoute] P&L trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
