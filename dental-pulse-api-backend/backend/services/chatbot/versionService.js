const { supabaseAdmin } = require('../../config/supabase');

let cachedConfig = null;
let cachedAt = 0;
const CACHE_TTL = 60_000;

async function getActiveConfig() {
  const now = Date.now();
  if (cachedConfig && (now - cachedAt) < CACHE_TTL) {
    return cachedConfig;
  }

  const { data, error } = await supabaseAdmin
    .from('chatbot_version_config')
    .select('*')
    .single();

  if (error) {
    console.error('[CHATBOT-VERSION] Failed to load config:', error.message);
    // Return safe default if DB not ready
    return {
      active_version: 'v1',
      v1_enabled: true,
      v2_enabled: false,
      v1_model: 'google/gemini-2.5-flash',
      v2_intent_model: 'claude-haiku-4-5-20251001',
      v2_format_model: 'claude-sonnet-4-6',
      v2_local_classifier_enabled: true,
      feature_at_mentions: false,
      feature_inline_charts: false,
      feature_pdf_reports: false,
      feature_email_reports: false,
      feature_briefing: false,
      feature_anomaly_alerts: false,
      feature_recommendations: false,
      feature_monitors: false,
      feature_forecasting: false,
      feature_ai_dashboard: false,
    };
  }

  cachedConfig = data;
  cachedAt = now;
  return data;
}

function invalidateCache() {
  cachedConfig = null;
  cachedAt = 0;
}

module.exports = { getActiveConfig, invalidateCache };
