const { supabaseAdmin } = require('../../config/supabase');

/**
 * Deterministic rule-based recommendation engine.
 * Rules check for: provider revenue regression, chair underutilisation,
 * lab cost spike, patient volume drop.
 * Per-rule cooldown to avoid spamming.
 */

const RULES = [
  {
    type: 'provider_regression',
    title: 'Provider Revenue Decline',
    check: async (orgId) => {
      // Check if any provider's production dropped >20% vs previous month
      const now = new Date();
      const thisStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const thisEnd = now.toISOString().split('T')[0];
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

      const [curr, prev] = await Promise.all([
        supabaseAdmin.rpc('chart_get_production_metrics', {
          p_start_date: thisStart, p_end_date: thisEnd,
          p_organization_id: orgId, p_provider_type: null, p_location_id: null,
        }),
        supabaseAdmin.rpc('chart_get_production_metrics', {
          p_start_date: prevStart, p_end_date: prevEnd,
          p_organization_id: orgId, p_provider_type: null, p_location_id: null,
        }),
      ]);

      const prevMap = {};
      for (const p of (prev.data || [])) {
        prevMap[p.provider_name] = parseFloat(p.production_amount || 0);
      }

      const declining = (curr.data || []).filter(p => {
        const currVal = parseFloat(p.production_amount || 0);
        const prevVal = prevMap[p.provider_name] || 0;
        return prevVal > 0 && currVal < prevVal * 0.8; // >20% drop
      }).map(p => p.provider_name);

      if (declining.length === 0) return null;

      return {
        body: `${declining.slice(0, 3).join(', ')}${declining.length > 3 ? ` and ${declining.length - 3} more` : ''} showed >20% revenue decline vs last month.`,
        suggestedAction: `Review scheduling and patient flow for ${declining[0]}.`,
      };
    },
  },
  {
    type: 'chair_underutilisation',
    title: 'Low Chair Utilisation',
    check: async (orgId) => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).toISOString().split('T')[0];
      const to = now.toISOString().split('T')[0];

      const { data } = await supabaseAdmin.rpc('get_chair_metrics', {
        _organization_id: orgId,
        _start_date: from, _end_date: to,
        _prev_start_date: from, _prev_end_date: to,
      });

      const underused = (data || []).filter(c => {
        const util = parseFloat(c.utilisation_pct || 0);
        return util > 0 && util < 50;
      }).map(c => `${c.location_name} (${parseFloat(c.utilisation_pct).toFixed(0)}%)`);

      if (underused.length === 0) return null;

      return {
        body: `Chair utilisation below 50% at: ${underused.join(', ')}.`,
        suggestedAction: 'Consider adjusting scheduling or marketing to fill empty slots.',
      };
    },
  },
  {
    type: 'patient_volume_drop',
    title: 'Patient Volume Declining',
    check: async (orgId) => {
      const now = new Date();
      const thisFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString().split('T')[0];
      const thisTo = now.toISOString().split('T')[0];
      const prevFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14).toISOString().split('T')[0];
      const prevTo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 8).toISOString().split('T')[0];

      const [curr, prev] = await Promise.all([
        supabaseAdmin.rpc('get_total_distinct_patients', {
          p_organization_id: orgId, p_start_date: thisFrom, p_end_date: thisTo,
          p_provider_type: null, p_location_id: null,
        }),
        supabaseAdmin.rpc('get_total_distinct_patients', {
          p_organization_id: orgId, p_start_date: prevFrom, p_end_date: prevTo,
          p_provider_type: null, p_location_id: null,
        }),
      ]);

      const currCount = Array.isArray(curr.data) ? (curr.data[0]?.count || 0) : (curr.data || 0);
      const prevCount = Array.isArray(prev.data) ? (prev.data[0]?.count || 0) : (prev.data || 0);

      if (prevCount === 0 || currCount >= prevCount * 0.8) return null;

      const drop = ((1 - currCount / prevCount) * 100).toFixed(0);
      return {
        body: `Patient volume dropped ${drop}% this week (${currCount} vs ${prevCount} last week).`,
        suggestedAction: 'Check appointment cancellations and recall list.',
      };
    },
  },
];

// Cooldown: don't fire same rule within 7 days
const COOLDOWN_DAYS = 7;

async function generateRecommendations(organizationId) {
  const results = [];

  for (const rule of RULES) {
    // Check cooldown
    const { data: existing } = await supabaseAdmin
      .from('chat_smart_recommendations')
      .select('id, created_at')
      .eq('organization_id', organizationId)
      .eq('recommendation_type', rule.type)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      const lastCreated = new Date(existing[0].created_at);
      const daysSince = (Date.now() - lastCreated.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < COOLDOWN_DAYS) continue;
    }

    try {
      const result = await rule.check(organizationId);
      if (result) {
        // Save to DB
        const { data, error } = await supabaseAdmin
          .from('chat_smart_recommendations')
          .insert({
            organization_id: organizationId,
            recommendation_type: rule.type,
            title: rule.title,
            body: result.body,
            suggested_action: result.suggestedAction,
          })
          .select()
          .single();

        if (!error && data) results.push(data);
      }
    } catch (err) {
      console.error(`[CHATBOT-RECOMMEND] Rule ${rule.type} failed:`, err.message);
    }
  }

  return results;
}

async function getRecommendations(organizationId) {
  const { data } = await supabaseAdmin
    .from('chat_smart_recommendations')
    .select('*')
    .eq('organization_id', organizationId)
    .is('user_action', null)
    .or('snooze_until.is.null,snooze_until.lt.' + new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  return data || [];
}

async function actionRecommendation(recId, action) {
  const updates = { user_action: action, actioned_at: new Date().toISOString() };

  if (action === 'snoozed') {
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + 7);
    updates.snooze_until = snoozeUntil.toISOString();
    updates.user_action = null; // Reset so it shows again after snooze
    updates.actioned_at = null;
  }

  const { data, error } = await supabaseAdmin
    .from('chat_smart_recommendations')
    .update(updates)
    .eq('id', recId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = { generateRecommendations, getRecommendations, actionRecommendation };
