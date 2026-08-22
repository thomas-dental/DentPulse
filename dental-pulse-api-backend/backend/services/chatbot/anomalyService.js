const { supabaseAdmin } = require('../../config/supabase');

/**
 * Z-score anomaly detection on rolling 12-week metric windows.
 * Scans revenue, profit, patients weekly.
 * Thresholds: low (z>1.5), medium (z>2.0), high (z>2.5).
 */

const METRICS_TO_SCAN = [
  { name: 'revenue', rpc: 'chart_get_production_metrics', valKey: 'production_amount' },
  { name: 'profit', rpc: 'chart_get_profit_metrics', valKey: 'periodic_profit' },
];

function getSeverity(zScore) {
  const abs = Math.abs(zScore);
  if (abs >= 2.5) return 'high';
  if (abs >= 2.0) return 'medium';
  if (abs >= 1.5) return 'low';
  return null;
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function scanAnomalies(organizationId) {
  const now = new Date();
  const alerts = [];

  for (const metric of METRICS_TO_SCAN) {
    // Fetch 12 weeks of weekly data
    const weeklyValues = [];
    for (let w = 0; w < 12; w++) {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - (w * 7));
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);

      const { data } = await supabaseAdmin.rpc(metric.rpc, {
        p_start_date: formatDate(weekStart),
        p_end_date: formatDate(weekEnd),
        p_organization_id: organizationId,
        p_provider_type: null,
        p_location_id: null,
      });

      const total = (data || []).reduce((s, p) => s + parseFloat(p[metric.valKey] || 0), 0);
      weeklyValues.push({ weekStart: formatDate(weekStart), value: total });
    }

    // Need at least 4 weeks for meaningful stats
    if (weeklyValues.length < 4) continue;

    // Baseline = weeks 1-11 (excluding current week 0)
    const baseline = weeklyValues.slice(1);
    const mean = baseline.reduce((s, w) => s + w.value, 0) / baseline.length;
    const stdev = Math.sqrt(baseline.reduce((s, w) => s + Math.pow(w.value - mean, 2), 0) / baseline.length);

    if (stdev === 0) continue; // No variance

    // Check current week (index 0)
    const current = weeklyValues[0];
    const zScore = (current.value - mean) / stdev;
    const severity = getSeverity(zScore);

    if (severity) {
      const direction = zScore >= 0 ? 'up' : 'down';
      const arrow = direction === 'up' ? '↑' : '↓';
      const pctFromMean = (((current.value - mean) / Math.abs(mean)) * 100).toFixed(1);

      alerts.push({
        metric: metric.name,
        severity,
        week_start_date: current.weekStart,
        observed_value: Math.round(current.value * 100) / 100,
        baseline_mean: Math.round(mean * 100) / 100,
        baseline_stdev: Math.round(stdev * 100) / 100,
        z_score: Math.round(zScore * 10000) / 10000,
        direction,
        description: `${metric.name.charAt(0).toUpperCase() + metric.name.slice(1)} is ${arrow} ${Math.abs(pctFromMean)}% from the 12-week average (z-score: ${Math.abs(zScore).toFixed(2)})`,
      });
    }
  }

  return alerts;
}

async function saveAnomalies(organizationId, alerts) {
  const saved = [];
  for (const alert of alerts) {
    const { data, error } = await supabaseAdmin
      .from('chat_anomaly_alerts')
      .upsert({
        organization_id: organizationId,
        ...alert,
      }, { onConflict: 'organization_id,metric,week_start_date,direction' })
      .select()
      .single();

    if (!error && data) saved.push(data);
  }
  return saved;
}

async function getAlerts(organizationId) {
  const { data } = await supabaseAdmin
    .from('chat_anomaly_alerts')
    .select('*')
    .eq('organization_id', organizationId)
    .is('user_action', null)
    .order('created_at', { ascending: false })
    .limit(20);

  return data || [];
}

async function actionAlert(alertId, action) {
  const { data, error } = await supabaseAdmin
    .from('chat_anomaly_alerts')
    .update({ user_action: action, actioned_at: new Date().toISOString() })
    .eq('id', alertId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = { scanAnomalies, saveAnomalies, getAlerts, actionAlert };
