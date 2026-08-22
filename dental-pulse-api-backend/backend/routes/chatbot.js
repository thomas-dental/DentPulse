const express = require('express');
const router = express.Router();
const syncAuthMiddleware = require('../middleware/syncAuth');
const requireUserAiKey = require('../middleware/requireUserAiKey');
const { supabaseAdmin } = require('../config/supabase');
const versionService = require('../services/chatbot/versionService');
const v1Handler = require('../services/chatbot/v1Handler');
const v2Handler = require('../services/chatbot/v2Handler');
const sessionService = require('../services/chatbot/sessionService');
const briefingService = require('../services/chatbot/briefingService');
const anomalyService = require('../services/chatbot/anomalyService');
const recommendationService = require('../services/chatbot/recommendationService');

// ── GET /api/chatbot/config ──
// Returns active version + enabled features (any authenticated user)
router.get('/config', syncAuthMiddleware, async (req, res) => {
  try {
    const config = await versionService.getActiveConfig();
    res.json({
      active_version: config.active_version,
      feature_at_mentions: config.feature_at_mentions,
      feature_inline_charts: config.feature_inline_charts,
      feature_pdf_reports: config.feature_pdf_reports,
      feature_email_reports: config.feature_email_reports,
      feature_briefing: config.feature_briefing,
      feature_anomaly_alerts: config.feature_anomaly_alerts,
      feature_recommendations: config.feature_recommendations,
      feature_monitors: config.feature_monitors,
      feature_forecasting: config.feature_forecasting,
      feature_ai_dashboard: config.feature_ai_dashboard ?? false,
    });
  } catch (err) {
    console.error('[CHATBOT] Config error:', err.message);
    res.status(500).json({ error: 'Failed to load chatbot config' });
  }
});

// ── POST /api/chatbot/message ──
// Main chat endpoint — routes to V1 or V2 handler based on active version.
// requireUserAiKey gates the whole endpoint on the user having their own
// Anthropic key, and pins that key for the request's AI calls.
router.post('/message', syncAuthMiddleware, requireUserAiKey, async (req, res) => {
  const { message, images } = req.body;
  const hasImages = Array.isArray(images) && images.length > 0;

  if ((!message || typeof message !== 'string' || message.trim().length === 0) && !hasImages) {
    return res.status(400).json({ error: 'Message or image is required' });
  }

  try {
    const config = await versionService.getActiveConfig();

    if (config.active_version === 'v1' && config.v1_enabled) {
      return await v1Handler.handleMessage(req, res, config);
    }

    if (config.active_version === 'v2' && config.v2_enabled) {
      return await v2Handler.handleMessage(req, res, config);
    }

    res.status(503).json({ error: 'No chatbot version is currently active' });
  } catch (err) {
    console.error('[CHATBOT] Message error:', err?.message, err?.stack?.split('\n').slice(0, 5).join('\n'));
    if (!res.headersSent) {
      res.status(500).json({
        error: err?.message || 'Failed to process message',
        where: 'routes/chatbot.js outer catch',
      });
    }
  }
});

// ── GET /api/chatbot/export/:token ──
// Stream a CSV or PDF of an exportable payload emitted by the chatbot
// response formatter (e.g. the full appointment list when the chat preview
// is truncated to 50 rows). Token is short-lived (10 minutes) and consumed
// in-memory, so no extra auth is needed — possession of the token is the
// access grant.
router.get('/export/:token', async (req, res) => {
  try {
    const exportCache = require('../services/chatbot/exportCache');
    const payload = exportCache.get(req.params.token);
    if (!payload) {
      return res.status(404).json({ error: 'Export link expired or invalid. Re-run the question to get a fresh link.' });
    }

    const format = String(req.query.format || 'csv').toLowerCase();
    const { filename, headers, rows, title } = payload;

    if (format === 'csv') {
      const escape = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      let body = headers.map(escape).join(',') + '\r\n';
      for (const r of rows) body += r.map(escape).join(',') + '\r\n';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(body);
    }

    if (format === 'pdf') {
      const PDFDocument = require('pdfkit');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
      doc.pipe(res);

      doc.fontSize(14).font('Helvetica-Bold').text(title || filename, { align: 'left' });
      doc.moveDown(0.5);
      doc.fontSize(8).font('Helvetica').fillColor('#555')
        .text(`Generated ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })} · ${rows.length} rows`, { align: 'left' });
      doc.fillColor('black').moveDown(0.8);

      // Simple table: equal-width columns, wrapping disabled for clarity.
      const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colW = pageW / headers.length;
      const drawRow = (cells, opts = {}) => {
        const y = doc.y;
        const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
        doc.font(font).fontSize(opts.bold ? 9 : 8);
        cells.forEach((c, i) => {
          doc.text(String(c ?? ''), doc.page.margins.left + i * colW + 2, y, { width: colW - 4, lineBreak: false, ellipsis: true });
        });
        doc.moveDown(0.9);
      };
      drawRow(headers, { bold: true });
      doc.moveTo(doc.page.margins.left, doc.y - 2).lineTo(doc.page.width - doc.page.margins.right, doc.y - 2).stroke();
      for (const r of rows) {
        if (doc.y > doc.page.height - 40) doc.addPage();
        drawRow(r);
      }
      doc.end();
      return;
    }

    return res.status(400).json({ error: 'format must be csv or pdf' });
  } catch (err) {
    console.error('[chatbot export] failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/chatbot/sessions ──
// List user's chat sessions
router.get('/sessions', syncAuthMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's org
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('current_organization_id')
      .eq('user_id', userId)
      .single();

    if (!profile?.current_organization_id) {
      return res.json([]);
    }

    const sessions = await sessionService.getUserSessions(userId, profile.current_organization_id);
    res.json(sessions);
  } catch (err) {
    console.error('[CHATBOT] Sessions error:', err.message);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// ── GET /api/chatbot/sessions/:id/messages ──
// Get messages for a session
router.get('/sessions/:id/messages', syncAuthMiddleware, async (req, res) => {
  try {
    const messages = await sessionService.getSessionMessages(req.params.id, req.user.id);
    res.json(messages);
  } catch (err) {
    console.error('[CHATBOT] Messages error:', err.message);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// ── DELETE /api/chatbot/sessions/:id ──
// Delete a session
router.delete('/sessions/:id', syncAuthMiddleware, async (req, res) => {
  try {
    await sessionService.deleteSession(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[CHATBOT] Delete session error:', err.message);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// ── GET /api/chatbot/providers/:orgId ──
// List providers for @-mention autocomplete
router.get('/providers/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('providers')
      .select('id, name, provider_role, location_id')
      .eq('organization_id', req.params.orgId)
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    // Deduplicate by name (providers can appear at multiple locations)
    const seen = new Set();
    const unique = (data || []).filter(p => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });

    res.json(unique);
  } catch (err) {
    console.error('[CHATBOT] Providers error:', err.message);
    res.status(500).json({ error: 'Failed to load providers' });
  }
});

// ── GET /api/chatbot/aliases/:orgId ──
// List user's custom @-aliases
router.get('/aliases/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_mention_aliases')
      .select('id, alias_name, bound_provider_ids, updated_at')
      .eq('organization_id', req.params.orgId)
      .eq('user_id', req.user.id)
      .order('alias_name');

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[CHATBOT] Aliases error:', err.message);
    res.status(500).json({ error: 'Failed to load aliases' });
  }
});

// ── POST /api/chatbot/aliases ──
// Create or update an alias
router.post('/aliases', syncAuthMiddleware, async (req, res) => {
  try {
    const { organization_id, alias_name, bound_provider_ids } = req.body;
    if (!alias_name || !bound_provider_ids || !Array.isArray(bound_provider_ids)) {
      return res.status(400).json({ error: 'alias_name and bound_provider_ids (array) are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('chat_mention_aliases')
      .upsert({
        organization_id,
        user_id: req.user.id,
        alias_name: alias_name.replace(/^@/, ''),
        bound_provider_ids,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,user_id,alias_name' })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[CHATBOT] Alias create error:', err.message);
    res.status(500).json({ error: 'Failed to save alias' });
  }
});

// ── DELETE /api/chatbot/aliases/:id ──
// Delete an alias
router.delete('/aliases/:id', syncAuthMiddleware, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('chat_mention_aliases')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[CHATBOT] Alias delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete alias' });
  }
});

const reportService = require('../services/chatbot/reportService');

// ── POST /api/chatbot/sessions/:id/export-pdf ──
// Export as structured CA-friendly PDF report
router.post('/sessions/:id/export-pdf', syncAuthMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's org
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('current_organization_id')
      .eq('user_id', userId)
      .single();
    const orgId = profile?.current_organization_id;
    if (!orgId) return res.status(400).json({ error: 'No organization' });

    // Get session context to determine report type and period
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('context_json')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    // Get all messages — find the best intent to export as PDF
    const messages = await sessionService.getSessionMessages(req.params.id, userId);
    const context = session?.context_json || {};

    // Priority: find the last generate_report intent, then any intent with report_type, then last intent with args
    const assistantMsgs = (messages || []).filter(m => m.role === 'assistant' && m.intent_json);
    const reportIntent = [...assistantMsgs].reverse().find(m =>
      m.intent_json?.toolName === 'generate_report'
    );
    const anyIntentWithArgs = [...assistantMsgs].reverse().find(m =>
      m.intent_json?.args?.period_from
    );
    const bestIntent = reportIntent || anyIntentWithArgs || assistantMsgs[assistantMsgs.length - 1];
    const intentJson = bestIntent?.intent_json;

    let reportType = intentJson?.args?.report_type || intentJson?.args?.metric || context.currentMetric || 'revenue';
    let periodFrom = intentJson?.args?.period_from || context.currentPeriod?.from;
    let periodTo = intentJson?.args?.period_to || context.currentPeriod?.to;
    let doctorName = intentJson?.args?.doctor_name || context.currentDoctor;

    // Default period if none found
    if (!periodFrom || !periodTo) {
      const periodHelper = require('../services/chatbot/periodHelper');
      const def = periodHelper.getDefaultPeriod();
      periodFrom = def.from;
      periodTo = def.to;
    }

    // Map metric names to report types
    if (reportType === 'profit') reportType = 'pl';
    if (reportType === 'patients') reportType = 'revenue';

    // Generate the structured PDF
    const doc = await reportService.generateReport(reportType, orgId, periodFrom, periodTo, doctorName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dentpulse-${reportType}-report.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('[CHATBOT] PDF export error:', err.message);
    res.status(500).json({ error: 'Failed to export PDF' });
  }
});

// ── POST /api/chatbot/report/email ──
// Email a report PDF to a specified address
router.post('/report/email', syncAuthMiddleware, async (req, res) => {
  try {
    const { to, subject, sessionId } = req.body;
    if (!to || !to.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    const emailService = require('../services/chatbot/emailService');

    // Generate PDF from session if sessionId provided
    let pdfBuffer = null;
    let pdfFilename = 'chat-report.pdf';

    if (sessionId) {
      const messages = await sessionService.getSessionMessages(sessionId, req.user.id);
      if (messages && messages.length > 0) {
        const PDFDocument = require('pdfkit');
        pdfBuffer = await new Promise((resolve, reject) => {
          const chunks = [];
          const doc = new PDFDocument({ size: 'A4', margin: 50 });
          doc.on('data', chunk => chunks.push(chunk));
          doc.on('end', () => resolve(Buffer.concat(chunks)));
          doc.on('error', reject);

          doc.fontSize(18).font('Helvetica-Bold').text('DentPulse AI — Chat Report', { align: 'center' });
          doc.fontSize(10).font('Helvetica').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
          doc.moveDown(1.5);

          for (const msg of messages) {
            const isUser = msg.role === 'user';
            doc.fontSize(9).font('Helvetica-Bold')
              .fillColor(isUser ? '#6c5ce7' : '#374151')
              .text(isUser ? 'You' : 'DentPulse AI');
            doc.fontSize(10).font('Helvetica')
              .fillColor('#111827')
              .text(msg.content, { width: 500 });
            doc.moveDown(0.8);
            if (doc.y > 700) doc.addPage();
          }

          doc.end();
        });
        pdfFilename = `chat-report-${sessionId.slice(0, 8)}.pdf`;
      }
    }

    await emailService.sendReportEmail({
      to,
      subject: subject || 'DentPulse AI — Chat Report',
      body: '<p>Please find the attached chat report from DentPulse AI.</p>',
      pdfBuffer,
      pdfFilename,
      userId: req.user.id,
    });

    res.json({ success: true, message: `Report sent to ${to}` });
  } catch (err) {
    console.error('[CHATBOT] Email error:', err.message);
    const status = err.message.includes('rate limit') ? 429 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── Phase 4: Briefing, Anomalies, Recommendations, Monitors ──

// GET /api/chatbot/briefing/:orgId
router.get('/briefing/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const briefing = await briefingService.generateBriefing(req.params.orgId);
    res.json(briefing);
  } catch (err) {
    console.error('[CHATBOT] Briefing error:', err.message);
    res.status(500).json({ error: 'Failed to generate briefing' });
  }
});

// GET /api/chatbot/anomalies/:orgId
router.get('/anomalies/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const alerts = await anomalyService.getAlerts(req.params.orgId);
    res.json(alerts);
  } catch (err) {
    console.error('[CHATBOT] Anomalies error:', err.message);
    res.status(500).json({ error: 'Failed to load anomaly alerts' });
  }
});

// POST /api/chatbot/anomalies/scan/:orgId — trigger anomaly scan
router.post('/anomalies/scan/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const alerts = await anomalyService.scanAnomalies(req.params.orgId);
    const saved = await anomalyService.saveAnomalies(req.params.orgId, alerts);
    res.json({ scanned: alerts.length, saved: saved.length, alerts: saved });
  } catch (err) {
    console.error('[CHATBOT] Anomaly scan error:', err.message);
    res.status(500).json({ error: 'Failed to scan anomalies' });
  }
});

// POST /api/chatbot/anomalies/:id/action
router.post('/anomalies/:id/action', syncAuthMiddleware, async (req, res) => {
  try {
    const { action } = req.body; // 'dismissed' | 'acted'
    if (!action || !['dismissed', 'acted'].includes(action)) {
      return res.status(400).json({ error: 'action must be "dismissed" or "acted"' });
    }
    const result = await anomalyService.actionAlert(req.params.id, action);
    res.json(result);
  } catch (err) {
    console.error('[CHATBOT] Anomaly action error:', err.message);
    res.status(500).json({ error: 'Failed to action anomaly' });
  }
});

// GET /api/chatbot/recommendations/:orgId
router.get('/recommendations/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const recs = await recommendationService.getRecommendations(req.params.orgId);
    res.json(recs);
  } catch (err) {
    console.error('[CHATBOT] Recommendations error:', err.message);
    res.status(500).json({ error: 'Failed to load recommendations' });
  }
});

// POST /api/chatbot/recommendations/generate/:orgId — trigger recommendation scan
router.post('/recommendations/generate/:orgId', syncAuthMiddleware, async (req, res) => {
  try {
    const recs = await recommendationService.generateRecommendations(req.params.orgId);
    res.json({ generated: recs.length, recommendations: recs });
  } catch (err) {
    console.error('[CHATBOT] Recommendation gen error:', err.message);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

// POST /api/chatbot/recommendations/:id/action
router.post('/recommendations/:id/action', syncAuthMiddleware, async (req, res) => {
  try {
    const { action } = req.body; // 'acted' | 'snoozed' | 'dismissed'
    if (!action || !['acted', 'snoozed', 'dismissed'].includes(action)) {
      return res.status(400).json({ error: 'action must be "acted", "snoozed", or "dismissed"' });
    }
    const result = await recommendationService.actionRecommendation(req.params.id, action);
    res.json(result);
  } catch (err) {
    console.error('[CHATBOT] Recommendation action error:', err.message);
    res.status(500).json({ error: 'Failed to action recommendation' });
  }
});

// GET /api/chatbot/monitors — list active monitors
router.get('/monitors', syncAuthMiddleware, async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('chat_monitor_watches')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err) {
    console.error('[CHATBOT] Monitors error:', err.message);
    res.status(500).json({ error: 'Failed to load monitors' });
  }
});

// POST /api/chatbot/monitors — create monitor
router.post('/monitors', syncAuthMiddleware, async (req, res) => {
  try {
    const { organization_id, doctor_name, provider_id } = req.body;
    if (!doctor_name) return res.status(400).json({ error: 'doctor_name is required' });

    const { data, error } = await supabaseAdmin
      .from('chat_monitor_watches')
      .upsert({
        user_id: req.user.id,
        organization_id,
        doctor_name,
        provider_id: provider_id || null,
        is_active: true,
      }, { onConflict: 'user_id,organization_id,doctor_name' })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[CHATBOT] Monitor create error:', err.message);
    res.status(500).json({ error: 'Failed to create monitor' });
  }
});

// DELETE /api/chatbot/monitors/:id — stop monitor
router.delete('/monitors/:id', syncAuthMiddleware, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('chat_monitor_watches')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[CHATBOT] Monitor delete error:', err.message);
    res.status(500).json({ error: 'Failed to stop monitor' });
  }
});

module.exports = router;
