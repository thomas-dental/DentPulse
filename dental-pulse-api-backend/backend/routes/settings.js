const express = require('express');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/auth');
const syncAuthMiddleware = require('../middleware/syncAuth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const { getSyncSettings, saveSyncSettings } = require('../services/sync/settingsStore');
const AI_PRICING_SETTINGS_PATH = path.join(__dirname, '..', 'config', 'aiPricingSettings.json');

// Sync settings live in public.sync_settings (global row). There is no file
// fallback — see services/sync/settingsStore.js.
function readSyncSettings() {
  return getSyncSettings();
}

// Async now that the DB is the source of truth — every caller must await.
async function writeSyncSettings(settings, updatedBy = null) {
  return saveSyncSettings(settings, updatedBy);
}

const AI_PRICING_DEFAULTS = {
  system_prompt: '',
  model_name: 'claude-haiku-4-5-20251001',
  // 1500 is plenty for the slim LLM fallback (only fields with no peer
  // / area data go to Claude). Keeps total tokens per click under ~2K.
  max_tokens: 1500,
  regenerate_after_seconds: 86400,
  // Off by default — each scraped clinic page is 5-50K input tokens and
  // can blow through tier-1 rate limits in a single click. Admin can opt in.
  web_search_enabled: false,
  web_search_tool_version: 'web_search_20250305',
};

function readAIPricingSettingsFile() {
  try {
    const raw = fs.readFileSync(AI_PRICING_SETTINGS_PATH, 'utf-8');
    return { ...AI_PRICING_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...AI_PRICING_DEFAULTS };
  }
}

function writeAIPricingSettingsFile(settings) {
  fs.writeFileSync(
    AI_PRICING_SETTINGS_PATH,
    JSON.stringify(settings, null, 2) + '\n',
    'utf-8',
  );
}

// Reads the system-default AI pricing settings from Supabase
// (organization_id IS NULL row). Falls back to the local file on any
// failure so the route stays resilient even if Supabase is briefly
// unreachable.
async function readSystemDefaultAIPricingSettings() {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_pricing_settings')
      .select('*')
      .is('organization_id', null)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      return {
        ...AI_PRICING_DEFAULTS,
        system_prompt: data.system_prompt ?? '',
        model_name: data.model_name,
        max_tokens: data.max_tokens,
        regenerate_after_seconds: data.regenerate_after_seconds,
        web_search_enabled: data.web_search_enabled,
        web_search_tool_version: data.web_search_tool_version,
        updated_at: data.updated_at,
        updated_by: data.updated_by,
      };
    }
  } catch (err) {
    console.warn('[Settings] Supabase read of system default AI settings failed, falling back to file:', err.message);
  }
  return readAIPricingSettingsFile();
}

// Upserts the system-default AI pricing settings into Supabase
// (organization_id IS NULL row). Also mirrors to the local file so the
// JSON config keeps a usable backup.
async function writeSystemDefaultAIPricingSettings(settings, userId) {
  // First, mirror to the file (cheap, always works)
  writeAIPricingSettingsFile(settings);

  // Try to upsert into Supabase. If a NULL-org row already exists, update
  // it; otherwise insert a new one.
  try {
    const { data: existing } = await supabaseAdmin
      .from('ai_pricing_settings')
      .select('id')
      .is('organization_id', null)
      .maybeSingle();

    const row = {
      organization_id: null,
      system_prompt: settings.system_prompt ?? '',
      model_name: settings.model_name,
      max_tokens: settings.max_tokens,
      regenerate_after_seconds: settings.regenerate_after_seconds,
      web_search_enabled: settings.web_search_enabled,
      web_search_tool_version: settings.web_search_tool_version,
      updated_by: userId ?? null,
    };

    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from('ai_pricing_settings')
        .update(row)
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin
        .from('ai_pricing_settings')
        .insert({ ...row, created_by: userId ?? null });
      if (error) throw error;
    }
  } catch (err) {
    console.error('[Settings] Supabase write of system default AI settings failed:', err.message);
    // Don't throw — file write succeeded, route shouldn't 500
  }
}

// GET /api/settings/sync-date-range
router.get('/sync-date-range', authMiddleware, async (req, res) => {
  try {
    const settings = readSyncSettings();
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read sync settings' });
  }
});

// PUT /api/settings/sync-date-range
router.put('/sync-date-range', authMiddleware, async (req, res) => {
  try {
    const { sync_start_date, sync_end_date, sync_mode } = req.body;

    // Validate date format if provided
    if (sync_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(sync_start_date)) {
      return res.status(400).json({ error: 'sync_start_date must be YYYY-MM-DD format' });
    }
    if (sync_end_date && !/^\d{4}-\d{2}-\d{2}$/.test(sync_end_date)) {
      return res.status(400).json({ error: 'sync_end_date must be YYYY-MM-DD format' });
    }
    if (sync_start_date && sync_end_date && sync_start_date > sync_end_date) {
      return res.status(400).json({ error: 'sync_start_date must be before sync_end_date' });
    }
    if (sync_mode && !['current', 'historical'].includes(sync_mode)) {
      return res.status(400).json({ error: 'sync_mode must be "current" or "historical"' });
    }

    const settings = readSyncSettings();
    settings.sync_start_date = sync_start_date || null;
    settings.sync_end_date = sync_end_date || null;
    settings.sync_mode = sync_mode || 'current';
    await writeSyncSettings(settings, req.user?.id || null);

    console.log(`[Settings] Sync date range updated: ${sync_start_date || 'none'} to ${sync_end_date || 'none'}, mode: ${settings.sync_mode}`);
    return res.json({ success: true, ...settings });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save sync settings' });
  }
});

// ── AI Insights generation schedule ──────────────────────────────────────────
// Controls WHEN the main app's per-page "AI Insights" cards regenerate:
//   mode 'session'  — every new browser session (legacy behaviour, default)
//   mode 'daily'    — once per calendar day (first visit of the day generates)
//   mode 'weekly'   — regenerates on the selected weekday (0=Sun … 6=Sat)
//   mode 'monthly'  — regenerates on the selected date of the month (1–28)
// Stored in the sync_settings global JSON blob under `ai_insights` — no DDL.
const AI_INSIGHTS_DEFAULTS = { mode: 'session', weekday: 1, month_day: 1 };
const AI_INSIGHTS_MODES = ['session', 'daily', 'weekly', 'monthly'];

function readAiInsightsSettings() {
  const s = readSyncSettings();
  const stored = s.ai_insights || {};
  return {
    mode: AI_INSIGHTS_MODES.includes(stored.mode) ? stored.mode : AI_INSIGHTS_DEFAULTS.mode,
    weekday: Number.isInteger(stored.weekday) && stored.weekday >= 0 && stored.weekday <= 6
      ? stored.weekday : AI_INSIGHTS_DEFAULTS.weekday,
    month_day: Number.isInteger(stored.month_day) && stored.month_day >= 1 && stored.month_day <= 28
      ? stored.month_day : AI_INSIGHTS_DEFAULTS.month_day,
  };
}

// SuperAdmin panel read
router.get('/ai-insights', authMiddleware, async (req, res) => {
  try {
    return res.json(readAiInsightsSettings());
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read AI insights settings' });
  }
});

// SuperAdmin panel write
router.put('/ai-insights', authMiddleware, async (req, res) => {
  try {
    const mode = req.body?.mode;
    const weekday = Number(req.body?.weekday);
    const monthDay = Number(req.body?.month_day);
    if (!AI_INSIGHTS_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of: ${AI_INSIGHTS_MODES.join(', ')}` });
    }
    if (mode === 'weekly' && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
      return res.status(400).json({ error: 'weekday must be 0 (Sunday) to 6 (Saturday)' });
    }
    if (mode === 'monthly' && (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 28)) {
      return res.status(400).json({ error: 'month_day must be 1 to 28' });
    }
    const settings = readSyncSettings();
    settings.ai_insights = {
      mode,
      weekday: Number.isInteger(weekday) ? weekday : AI_INSIGHTS_DEFAULTS.weekday,
      month_day: Number.isInteger(monthDay) ? monthDay : AI_INSIGHTS_DEFAULTS.month_day,
    };
    await writeSyncSettings(settings, req.user?.id || null);
    console.log(`[Settings] AI Insights schedule set: ${mode} (weekday=${settings.ai_insights.weekday}, month_day=${settings.ai_insights.month_day})`);
    return res.json({ success: true, ...settings.ai_insights });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save AI insights settings' });
  }
});

// Main-app read (Supabase user JWT, same auth as the sync trigger routes) —
// the dashboard fetches this to decide whether a cached summary is still fresh.
router.get('/ai-insights-public', syncAuthMiddleware, async (req, res) => {
  try {
    return res.json(readAiInsightsSettings());
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read AI insights settings' });
  }
});

// GET /api/settings/auto-sync — after-close nightly Dentally sync config
router.get('/auto-sync', authMiddleware, async (req, res) => {
  try {
    const { getAutoSyncSettings, DEFAULT_ENTITY_ALIASES } = require('../services/autoSyncCron');
    const settings = getAutoSyncSettings();
    return res.json({
      ...settings,
      // Resolve null (= use defaults) so the UI can show what actually runs.
      effective_entities: settings.auto_sync_entities || DEFAULT_ENTITY_ALIASES,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read auto-sync settings' });
  }
});

// PUT /api/settings/auto-sync
router.put('/auto-sync', authMiddleware, async (req, res) => {
  try {
    const {
      auto_sync_enabled,
      auto_sync_at_time,
      auto_sync_delay_minutes,
      auto_sync_default_close_time,
      auto_sync_lookback_days,
      auto_sync_entities,
      auto_sync_max_orgs_per_tick,
    } = req.body || {};

    if (auto_sync_enabled !== undefined && typeof auto_sync_enabled !== 'boolean') {
      return res.status(400).json({ error: 'auto_sync_enabled must be boolean' });
    }
    if (auto_sync_at_time !== undefined && auto_sync_at_time !== null &&
        !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(auto_sync_at_time))) {
      return res.status(400).json({ error: 'auto_sync_at_time must be HH:MM (24h) or null for after-close mode' });
    }
    if (auto_sync_delay_minutes !== undefined &&
        (typeof auto_sync_delay_minutes !== 'number' || auto_sync_delay_minutes < 0 || auto_sync_delay_minutes > 720)) {
      return res.status(400).json({ error: 'auto_sync_delay_minutes must be a number between 0 and 720' });
    }
    if (auto_sync_default_close_time !== undefined &&
        !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(auto_sync_default_close_time))) {
      return res.status(400).json({ error: 'auto_sync_default_close_time must be HH:MM (24h)' });
    }
    if (auto_sync_lookback_days !== undefined &&
        (typeof auto_sync_lookback_days !== 'number' || auto_sync_lookback_days < 1 || auto_sync_lookback_days > 62)) {
      // Cap at 62 — beyond that the queue switches to monthly chunking, which
      // is initial-sync territory, not a nightly incremental.
      return res.status(400).json({ error: 'auto_sync_lookback_days must be a number between 1 and 62' });
    }
    if (auto_sync_max_orgs_per_tick !== undefined &&
        (typeof auto_sync_max_orgs_per_tick !== 'number' || auto_sync_max_orgs_per_tick < 1 || auto_sync_max_orgs_per_tick > 500)) {
      return res.status(400).json({ error: 'auto_sync_max_orgs_per_tick must be a number between 1 and 500' });
    }
    if (auto_sync_entities !== undefined && auto_sync_entities !== null) {
      const { ENTITY_BY_ALIAS } = require('../api/dentally/config');
      if (!Array.isArray(auto_sync_entities) || auto_sync_entities.length === 0) {
        return res.status(400).json({ error: 'auto_sync_entities must be null or a non-empty array of entity aliases' });
      }
      const unknown = auto_sync_entities.filter((a) => !ENTITY_BY_ALIAS[a]);
      if (unknown.length > 0) {
        return res.status(400).json({ error: `Unknown entity aliases: ${unknown.join(', ')}` });
      }
    }

    const settings = readSyncSettings();
    if (auto_sync_enabled !== undefined) settings.auto_sync_enabled = auto_sync_enabled;
    if (auto_sync_at_time !== undefined) settings.auto_sync_at_time = auto_sync_at_time;
    if (auto_sync_delay_minutes !== undefined) settings.auto_sync_delay_minutes = auto_sync_delay_minutes;
    if (auto_sync_default_close_time !== undefined) settings.auto_sync_default_close_time = auto_sync_default_close_time;
    if (auto_sync_lookback_days !== undefined) settings.auto_sync_lookback_days = auto_sync_lookback_days;
    if (auto_sync_entities !== undefined) settings.auto_sync_entities = auto_sync_entities;
    if (auto_sync_max_orgs_per_tick !== undefined) settings.auto_sync_max_orgs_per_tick = auto_sync_max_orgs_per_tick;
    await writeSyncSettings(settings, req.user?.id || null);

    const { getAutoSyncSettings } = require('../services/autoSyncCron');
    console.log(`[Settings] Auto-sync settings updated by ${req.user?.id || 'unknown'}`);
    return res.json({ success: true, ...getAutoSyncSettings() });
  } catch (err) {
    console.error('[Settings] Auto-sync update failed:', err.message);
    return res.status(500).json({ error: 'Failed to save auto-sync settings' });
  }
});

// GET /api/settings/iplicit-sync-date-range
router.get('/iplicit-sync-date-range', authMiddleware, async (req, res) => {
  try {
    const settings = readSyncSettings();
    return res.json({
      iplicit_start_date: settings.iplicit_start_date || null,
      iplicit_end_date:   settings.iplicit_end_date   || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read Iplicit sync settings' });
  }
});

// PUT /api/settings/iplicit-sync-date-range
router.put('/iplicit-sync-date-range', authMiddleware, async (req, res) => {
  try {
    const { iplicit_start_date, iplicit_end_date } = req.body;

    if (iplicit_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(iplicit_start_date)) {
      return res.status(400).json({ error: 'iplicit_start_date must be YYYY-MM-DD format' });
    }
    if (iplicit_end_date && !/^\d{4}-\d{2}-\d{2}$/.test(iplicit_end_date)) {
      return res.status(400).json({ error: 'iplicit_end_date must be YYYY-MM-DD format' });
    }
    if (iplicit_start_date && iplicit_end_date && iplicit_start_date > iplicit_end_date) {
      return res.status(400).json({ error: 'iplicit_start_date must be before iplicit_end_date' });
    }

    const settings = readSyncSettings();
    settings.iplicit_start_date = iplicit_start_date || null;
    settings.iplicit_end_date   = iplicit_end_date   || null;
    await writeSyncSettings(settings, req.user?.id || null);

    console.log(`[Settings] Iplicit sync date range updated: ${iplicit_start_date || 'none'} to ${iplicit_end_date || 'none'}`);
    return res.json({ success: true, iplicit_start_date: settings.iplicit_start_date, iplicit_end_date: settings.iplicit_end_date });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save Iplicit sync settings' });
  }
});

// GET /api/settings/xero-sync-date-range
router.get('/xero-sync-date-range', authMiddleware, async (req, res) => {
  try {
    const settings = readSyncSettings();
    return res.json({
      xero_start_date:     settings.xero_start_date     || null,
      xero_end_date:       settings.xero_end_date       || null,
      xero_modified_since: settings.xero_modified_since || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read Xero sync settings' });
  }
});

// PUT /api/settings/xero-sync-date-range
router.put('/xero-sync-date-range', authMiddleware, async (req, res) => {
  try {
    const { xero_start_date, xero_end_date } = req.body;

    if (xero_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(xero_start_date)) {
      return res.status(400).json({ error: 'xero_start_date must be YYYY-MM-DD format' });
    }
    if (xero_end_date && !/^\d{4}-\d{2}-\d{2}$/.test(xero_end_date)) {
      return res.status(400).json({ error: 'xero_end_date must be YYYY-MM-DD format' });
    }
    if (xero_start_date && xero_end_date && xero_start_date > xero_end_date) {
      return res.status(400).json({ error: 'xero_start_date must be before xero_end_date' });
    }

    const settings = readSyncSettings();
    settings.xero_start_date = xero_start_date || null;
    settings.xero_end_date   = xero_end_date   || null;
    // Keep the IfModifiedSince cutoff aligned with the user-visible start date.
    // Xero expects an ISO-8601 timestamp here. Passing null tells the sync to
    // pull everything Xero has (full historical backfill). This is the single
    // place downstream sync code (getXeroModifiedSince) reads from, so the UI
    // doesn't need a second field — whatever the user picks as "start date"
    // drives both the P&L window and the incremental cutoff for every other
    // entity (invoices, bank txns, credit notes, overpayments, journals).
    settings.xero_modified_since = xero_start_date
      ? `${xero_start_date}T00:00:00Z`
      : null;
    await writeSyncSettings(settings, req.user?.id || null);

    console.log(`[Settings] Xero sync date range updated: ${xero_start_date || 'none'} to ${xero_end_date || 'none'}, modified_since: ${settings.xero_modified_since || 'none'}`);
    return res.json({
      success:             true,
      xero_start_date:     settings.xero_start_date,
      xero_end_date:       settings.xero_end_date,
      xero_modified_since: settings.xero_modified_since,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save Xero sync settings' });
  }
});

// GET /api/settings/quickbooks-sync-date-range
router.get('/quickbooks-sync-date-range', authMiddleware, async (req, res) => {
  try {
    const settings = readSyncSettings();
    return res.json({
      quickbooks_start_date: settings.quickbooks_start_date || null,
      quickbooks_end_date:   settings.quickbooks_end_date   || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read QuickBooks sync settings' });
  }
});

// PUT /api/settings/quickbooks-sync-date-range
router.put('/quickbooks-sync-date-range', authMiddleware, async (req, res) => {
  try {
    const { quickbooks_start_date, quickbooks_end_date } = req.body;

    if (quickbooks_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(quickbooks_start_date)) {
      return res.status(400).json({ error: 'quickbooks_start_date must be YYYY-MM-DD format' });
    }
    if (quickbooks_end_date && !/^\d{4}-\d{2}-\d{2}$/.test(quickbooks_end_date)) {
      return res.status(400).json({ error: 'quickbooks_end_date must be YYYY-MM-DD format' });
    }
    if (quickbooks_start_date && quickbooks_end_date && quickbooks_start_date > quickbooks_end_date) {
      return res.status(400).json({ error: 'quickbooks_start_date must be before quickbooks_end_date' });
    }

    const settings = readSyncSettings();
    settings.quickbooks_start_date = quickbooks_start_date || null;
    settings.quickbooks_end_date   = quickbooks_end_date   || null;
    await writeSyncSettings(settings, req.user?.id || null);

    console.log(`[Settings] QuickBooks sync date range updated: ${quickbooks_start_date || 'none'} to ${quickbooks_end_date || 'none'}`);
    return res.json({
      success:               true,
      quickbooks_start_date: settings.quickbooks_start_date,
      quickbooks_end_date:   settings.quickbooks_end_date,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save QuickBooks sync settings' });
  }
});

// ============================================================
// AI Suggested Pricing settings
//
// Controls the system prompt, model, max tokens, regenerate
// cache TTL, and web_search tool config used by the AI
// Suggested Pricing panel in the org-facing app. Stored as a
// global config file (aiPricingSettings.json) so
// superadmins can edit it once and have it apply across orgs
// that haven't customised their own settings row.
// ============================================================

// GET /api/settings/ai-pricing
router.get('/ai-pricing', authMiddleware, async (req, res) => {
  try {
    const settings = await readSystemDefaultAIPricingSettings();
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read AI pricing settings' });
  }
});

// PUT /api/settings/ai-pricing
router.put('/ai-pricing', authMiddleware, async (req, res) => {
  try {
    const {
      system_prompt,
      model_name,
      max_tokens,
      regenerate_after_seconds,
      web_search_enabled,
      web_search_tool_version,
    } = req.body || {};

    // Validation
    if (
      system_prompt !== undefined &&
      (typeof system_prompt !== 'string' || system_prompt.length > 100000)
    ) {
      return res
        .status(400)
        .json({ error: 'system_prompt must be a string ≤ 100,000 chars' });
    }
    if (
      max_tokens !== undefined &&
      (typeof max_tokens !== 'number' || max_tokens < 256 || max_tokens > 64000)
    ) {
      return res
        .status(400)
        .json({ error: 'max_tokens must be a number between 256 and 64000' });
    }
    if (
      regenerate_after_seconds !== undefined &&
      (typeof regenerate_after_seconds !== 'number' ||
        regenerate_after_seconds < 0)
    ) {
      return res
        .status(400)
        .json({ error: 'regenerate_after_seconds must be a non-negative number' });
    }
    if (
      web_search_enabled !== undefined &&
      typeof web_search_enabled !== 'boolean'
    ) {
      return res
        .status(400)
        .json({ error: 'web_search_enabled must be boolean' });
    }
    if (
      web_search_tool_version !== undefined &&
      typeof web_search_tool_version !== 'string'
    ) {
      return res
        .status(400)
        .json({ error: 'web_search_tool_version must be a string' });
    }
    if (model_name !== undefined && typeof model_name !== 'string') {
      return res.status(400).json({ error: 'model_name must be a string' });
    }

    const current = await readSystemDefaultAIPricingSettings();
    const next = {
      ...current,
      ...(system_prompt !== undefined && { system_prompt }),
      ...(model_name !== undefined && { model_name }),
      ...(max_tokens !== undefined && { max_tokens }),
      ...(regenerate_after_seconds !== undefined && {
        regenerate_after_seconds,
      }),
      ...(web_search_enabled !== undefined && { web_search_enabled }),
      ...(web_search_tool_version !== undefined && { web_search_tool_version }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    await writeSystemDefaultAIPricingSettings(next, req.user?.id);

    console.log(
      `[Settings] AI pricing settings updated by ${req.user?.id || 'unknown'} ` +
      `(model=${next.model_name}, regen=${next.regenerate_after_seconds}s, web_search=${next.web_search_enabled})`,
    );
    return res.json({ success: true, ...next });
  } catch (err) {
    console.error('[Settings] AI pricing update failed:', err);
    return res.status(500).json({ error: 'Failed to save AI pricing settings' });
  }
});

// ============================================================
// Chatbot Version Control
// ============================================================

const versionService = require('../services/chatbot/versionService');

// GET /api/settings/chatbot-version
router.get('/chatbot-version', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('chatbot_version_config')
      .select('*')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Settings] Chatbot version read failed:', err.message);
    res.status(500).json({ error: 'Failed to load chatbot config' });
  }
});

// PUT /api/settings/chatbot-version
router.put('/chatbot-version', authMiddleware, async (req, res) => {
  try {
    const { active_version } = req.body;

    // Validate version switch
    if (active_version !== undefined && !['v1', 'v2'].includes(active_version)) {
      return res.status(400).json({ error: 'active_version must be "v1" or "v2"' });
    }

    const updates = {};
    const allowedFields = [
      'active_version', 'v1_enabled', 'v2_enabled', 'v1_model',
      'v2_intent_model', 'v2_format_model', 'v2_local_classifier_enabled',
      'v2_max_tools',
      'feature_at_mentions', 'feature_inline_charts',
      'feature_pdf_reports', 'feature_email_reports',
      'feature_briefing', 'feature_anomaly_alerts',
      'feature_recommendations', 'feature_monitors',
      'feature_forecasting',
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (active_version !== undefined) {
      updates.switched_at = new Date().toISOString();
      updates.switched_by = req.user.id;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Get the singleton row ID first
    const { data: current, error: readErr } = await supabaseAdmin
      .from('chatbot_version_config')
      .select('id')
      .single();

    if (readErr || !current) throw readErr || new Error('No config row found');

    const { data, error } = await supabaseAdmin
      .from('chatbot_version_config')
      .update(updates)
      .eq('id', current.id)
      .select()
      .single();

    if (error) throw error;

    versionService.invalidateCache();
    console.log(`[Settings] Chatbot version updated to ${data.active_version} by ${req.user.email || req.user.id}`);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('[Settings] Chatbot version update failed:', err.message);
    res.status(500).json({ error: 'Failed to update chatbot config' });
  }
});

module.exports = router;
