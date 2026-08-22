const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');
const syncAuthMiddleware = require('../middleware/syncAuth');
const { logTokenUsage } = require('../services/chatbot/tokenTracker');

const router = express.Router();

// POST /api/ai-usage/log
// Usage report from client-side AI features (AI Insights, priority tips,
// buyer questions). Those features call Anthropic from the browser / edge
// function, so their spend never passes the chatbot's tokenTracker — they
// report it here after each generation instead. Regular user auth (NOT the
// superadmin-only middleware of the read routes below): any signed-in user
// may report their own usage. Identity and organization are resolved
// server-side from the token — never trusted from the client payload.
router.post('/log', syncAuthMiddleware, async (req, res) => {
  try {
    const { feature, model, input_tokens, output_tokens, latency_ms } = req.body || {};
    if (!feature || !model) {
      return res.status(400).json({ error: 'feature and model are required' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('current_organization_id')
      .eq('user_id', req.user.id)
      .maybeSingle();

    await logTokenUsage({
      organizationId: profile?.current_organization_id || null,
      userId: req.user.id,
      feature: String(feature).slice(0, 80),
      model: String(model).slice(0, 80),
      inputTokens: Math.max(0, parseInt(input_tokens, 10) || 0),
      outputTokens: Math.max(0, parseInt(output_tokens, 10) || 0),
      latencyMs: Math.max(0, parseInt(latency_ms, 10) || 0),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[ai-usage log] failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

function rangeStartIso(range) {
  if (range === 'all') return null;
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// GET /api/ai-usage
// Returns AI token usage rolled up per user, across all organizations.
// Query params:
//   range = '7d' | '30d' | '90d' | 'all'  (default '30d')
//   org_id = optional organization filter
//   include_deleted = '1' to include logs whose user was removed from auth
router.get('/', authMiddleware, async (req, res) => {
  try {
    const range = String(req.query.range || '30d');
    const orgFilter = req.query.org_id ? String(req.query.org_id) : null;
    const includeDeleted = String(req.query.include_deleted || '') === '1';

    const sinceIso = rangeStartIso(range);

    // Pull logs (service role bypasses RLS so we see every org).
    let logQuery = supabaseAdmin
      .from('ai_token_usage_logs')
      .select('id, organization_id, user_id, user_email, user_full_name, feature, model, input_tokens, output_tokens, estimated_cost, latency_ms, created_at')
      .order('created_at', { ascending: false })
      .limit(50000);
    if (sinceIso) logQuery = logQuery.gte('created_at', sinceIso);
    if (orgFilter) logQuery = logQuery.eq('organization_id', orgFilter);

    // Run the three queries in parallel:
    //   1) Logs in the period (may be empty)
    //   2) ALL profiles (so every real user appears in the list, even with
    //      zero AI usage — surfaces the user roster, not just the spenders)
    //   3) Superadmin user_ids so we can filter them out of the list
    const [logsRes, profilesRes, superadminsRes] = await Promise.all([
      logQuery,
      supabaseAdmin.from('profiles').select('user_id, email, full_name, current_organization_id, created_at'),
      supabaseAdmin.from('superadmins').select('id'),
    ]);

    const logs = logsRes.data;
    if (logsRes.error) return res.status(500).json({ error: logsRes.error.message });

    const superadminIds = new Set((superadminsRes.data || []).map((s) => s.id));
    const allProfiles = (profilesRes.data || []).filter((p) => !superadminIds.has(p.user_id));

    // Organizations referenced by logs + by every profile's current org.
    const orgIds = [...new Set([
      ...((logs || []).map((l) => l.organization_id).filter(Boolean)),
      ...(allProfiles.map((p) => p.current_organization_id).filter(Boolean)),
    ])];

    const orgsRes = orgIds.length > 0
      ? await supabaseAdmin.from('organizations').select('id, name, user_id, created_by').in('id', orgIds)
      : { data: [] };

    const profileByUser = new Map();
    allProfiles.forEach((p) => profileByUser.set(p.user_id, p));
    // Also index by lowercased email so an orphan row that kept a stamped email
    // but lost its user_id can be re-linked to the LIVE account instead of
    // rendering as a phantom "deleted" user.
    const profileByEmail = new Map();
    allProfiles.forEach((p) => { if (p.email) profileByEmail.set(String(p.email).toLowerCase(), p); });
    const orgById = new Map();
    const orgOwnerId = new Map();
    (orgsRes.data || []).forEach((o) => {
      orgById.set(o.id, o.name);
      orgOwnerId.set(o.id, o.user_id || o.created_by || null);
    });

    // Aggregate per user. A row is "orphaned" only when BOTH user_id and the
    // stamped user_email are missing — older rows logged before identity
    // stamping was added. Rows where the auth user is gone but the stamped
    // email survives are grouped by that email and marked as deleted so
    // their attribution stays visible.
    const perUser = new Map();
    let totalRequests = 0;
    let totalTokens = 0;
    let totalCost = 0;
    const orphaned = { requests: 0, tokens: 0, cost: 0 };

    // Seed perUser with every profile so users who have not yet hit the
    // chatbot still appear in the list (zeroed totals). Apply the optional
    // org filter here too.
    for (const p of allProfiles) {
      if (orgFilter && p.current_organization_id !== orgFilter) continue;
      const key = `${p.user_id}::${p.current_organization_id || ''}`;
      perUser.set(key, {
        user_id: p.user_id,
        organization_id: p.current_organization_id || null,
        organization_name: orgById.get(p.current_organization_id) || '—',
        full_name: p.full_name || 'Unnamed user',
        email: p.email || '—',
        deleted: false,
        unattributed: false,
        via_owner: false,
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cost: 0,
        last_used: null,
        by_model: {},
        by_feature: {},
      });
    }

    for (const log of logs || []) {
      // Skip superadmin testing traffic — it shouldn't pollute the per-org
      // dashboard (still surfaces in the Anthropic Admin API panel, which
      // reflects true billable usage).
      if (log.user_id && superadminIds.has(log.user_id)) continue;

      const tokens = (log.input_tokens || 0) + (log.output_tokens || 0);
      const cost = Number(log.estimated_cost) || 0;
      totalRequests += 1;
      totalTokens += tokens;
      totalCost += cost;

      // Resolve the row to a LIVE profile: by user_id, else re-link by stamped
      // email. effectiveUserId is null only when the row can't be tied to any
      // current account.
      const emailKey = log.user_email ? String(log.user_email).toLowerCase() : null;
      let linkedProfile = log.user_id
        ? profileByUser.get(log.user_id)
        : (emailKey ? profileByEmail.get(emailKey) : null);
      let effectiveUserId = log.user_id || linkedProfile?.user_id || null;
      let viaOwner = false;

      // Still unresolved but the org is known: attribute to the org's OWNER —
      // the tenant AI-key holder whose key this usage was billed to. This is why
      // an active org's older (unstamped) usage lands on the owner's account
      // instead of a phantom "unattributed" bucket.
      if (!effectiveUserId && log.organization_id) {
        const ownerId = orgOwnerId.get(log.organization_id);
        const ownerProfile = ownerId ? profileByUser.get(ownerId) : null;
        if (ownerProfile) {
          linkedProfile = ownerProfile;
          effectiveUserId = ownerId;
          viaOwner = true;
        }
      }

      // Identity states, so an active account is never mislabelled:
      //   active       → resolvable to a live profile (own id, email, or org owner)
      //   deleted      → had a stamped email but no live profile remains
      //   unattributed → no identity AND no resolvable org owner
      const isActive = !!effectiveUserId;
      const isDeleted = !isActive && !!log.user_email;
      const isUnattributed = !isActive && !log.user_email;

      if (isUnattributed) {
        orphaned.requests += 1;
        orphaned.tokens += tokens;
        orphaned.cost += cost;
        if (!includeDeleted) continue;
      }

      // Group by resolved user when present, otherwise by stamped email, else a
      // single unattributed bucket per org. Org is part of the key so the same
      // person appears once per org they used.
      const identityKey = effectiveUserId || (emailKey ? `email:${emailKey}` : '__unattributed__');
      const key = `${identityKey}::${log.organization_id || ''}`;
      let agg = perUser.get(key);
      if (!agg) {
        agg = {
          user_id: effectiveUserId,
          organization_id: log.organization_id,
          organization_name: orgById.get(log.organization_id) || '—',
          full_name: linkedProfile?.full_name
            || (isActive ? (log.user_full_name || 'Unknown user')
              : isDeleted ? 'Deleted account'
                : 'Unattributed usage'),
          email: linkedProfile?.email || log.user_email || '—',
          deleted: isDeleted,
          unattributed: isUnattributed,
          via_owner: viaOwner,
          requests: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          cost: 0,
          last_used: null,
          by_model: {},
          by_feature: {},
        };
        perUser.set(key, agg);
      }
      agg.requests += 1;
      agg.input_tokens += log.input_tokens || 0;
      agg.output_tokens += log.output_tokens || 0;
      agg.total_tokens += tokens;
      agg.cost += cost;
      if (!agg.last_used || log.created_at > agg.last_used) agg.last_used = log.created_at;

      const m = (agg.by_model[log.model] ||= { requests: 0, tokens: 0, cost: 0 });
      m.requests += 1; m.tokens += tokens; m.cost += cost;
      const f = (agg.by_feature[log.feature] ||= { requests: 0, tokens: 0, cost: 0 });
      f.requests += 1; f.tokens += tokens; f.cost += cost;
    }

    // Spenders first (by cost desc), then zero-usage users alphabetically by
    // email so the roster portion of the list reads consistently.
    const rows = Array.from(perUser.values()).sort((a, b) => {
      if (b.cost !== a.cost) return b.cost - a.cost;
      return String(a.email).localeCompare(String(b.email));
    });

    return res.json({
      range,
      org_filter: orgFilter,
      include_deleted: includeDeleted,
      totals: {
        requests: totalRequests,
        tokens: totalTokens,
        cost: totalCost,
        active_users: rows.filter((r) => !r.deleted && r.requests > 0).length,
      },
      orphaned,
      rows,
    });
  } catch (err) {
    console.error('[ai-usage] failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-usage/orphans/claim
// Reassign all orphan log rows (user_id IS NULL) in one organization to a
// real user. Used when an account was effectively re-created (e.g. email
// change that internally drops + re-inserts the auth.users row) and the
// superadmin wants to merge the old usage onto the new identity.
//
// Optional `override_email`: when supplied, the user's profiles.email is
// updated first AND the reassigned log rows are stamped with that email.
// auth.users.email is left alone (cannot be changed without re-creating
// the user). This is purely a display/attribution override.
router.post('/orphans/claim', authMiddleware, async (req, res) => {
  try {
    const { organization_id, user_id, override_email } = req.body || {};
    if (!organization_id || !user_id) {
      return res.status(400).json({ error: 'organization_id and user_id are required' });
    }

    // Verify the target user exists.
    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('user_id, email, full_name')
      .eq('user_id', user_id)
      .maybeSingle();
    if (pErr) return res.status(500).json({ error: pErr.message });
    if (!profile) return res.status(404).json({ error: 'Target user profile not found' });

    let effectiveEmail = profile.email;

    if (override_email && override_email !== profile.email) {
      // Basic shape check — not a strict RFC validator, just enough to
      // catch obvious typos before we write it to the DB.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(override_email)) {
        return res.status(400).json({ error: 'override_email is not a valid email' });
      }
      const { error: upErr } = await supabaseAdmin
        .from('profiles')
        .update({ email: override_email })
        .eq('user_id', user_id);
      if (upErr) return res.status(500).json({ error: `Profile email update failed: ${upErr.message}` });
      effectiveEmail = override_email;

      // Backfill any previously-stamped log rows for this user so the
      // table renders consistently with the new email.
      await supabaseAdmin
        .from('ai_token_usage_logs')
        .update({ user_email: effectiveEmail })
        .eq('user_id', user_id);
    }

    // Reassign orphans + stamp the (possibly overridden) email/name so
    // future deletions don't orphan the rows again.
    const { data, error } = await supabaseAdmin
      .from('ai_token_usage_logs')
      .update({
        user_id: profile.user_id,
        user_email: effectiveEmail,
        user_full_name: profile.full_name,
      })
      .is('user_id', null)
      .eq('organization_id', organization_id)
      .select('id');

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      claimed: data?.length || 0,
      organization_id,
      user_id: profile.user_id,
      email: effectiveEmail,
      email_updated: override_email && override_email !== profile.email,
    });
  } catch (err) {
    console.error('[ai-usage claim] failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-usage/:userId
// Returns the detailed usage history for one user.
// Query params:
//   range = '7d' | '30d' | '90d' | 'all'  (default '30d')
//   org_id = optional organization filter
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.params.userId);
    const range = String(req.query.range || '30d');
    const orgFilter = req.query.org_id ? String(req.query.org_id) : null;
    const sinceIso = rangeStartIso(range);

    let q = supabaseAdmin
      .from('ai_token_usage_logs')
      .select('id, organization_id, user_id, user_email, user_full_name, feature, model, input_tokens, output_tokens, estimated_cost, latency_ms, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20000);
    if (sinceIso) q = q.gte('created_at', sinceIso);
    if (orgFilter) q = q.eq('organization_id', orgFilter);

    const { data: logs, error: logErr } = await q;
    if (logErr) return res.status(500).json({ error: logErr.message });

    // Profile + org name. Fall back to the stamped email/name from the logs
    // when the live profile is gone (account was deleted).
    const { data: profileRow } = await supabaseAdmin
      .from('profiles')
      .select('user_id, email, full_name, avatar_url, created_at')
      .eq('user_id', userId)
      .maybeSingle();
    const stamped = (logs || [])[0] || {};

    const orgIds = [...new Set((logs || []).map((l) => l.organization_id).filter(Boolean))];
    let orgById = new Map();
    if (orgIds.length > 0) {
      const { data: orgs } = await supabaseAdmin
        .from('organizations')
        .select('id, name')
        .in('id', orgIds);
      (orgs || []).forEach((o) => orgById.set(o.id, o.name));
    }

    let totalRequests = 0;
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let totalLatencyMs = 0;
    let firstUsed = null;
    let lastUsed = null;

    const byDay = new Map();          // 'YYYY-MM-DD' → { requests, tokens, cost }
    const byModel = new Map();        // model → { requests, tokens, cost }
    const byFeature = new Map();      // feature → { requests, tokens, cost }
    const byOrg = new Map();          // org_id → { name, requests, tokens, cost }

    for (const log of logs || []) {
      const tokens = (log.input_tokens || 0) + (log.output_tokens || 0);
      const cost = Number(log.estimated_cost) || 0;
      totalRequests += 1;
      totalTokens += tokens;
      totalInputTokens += log.input_tokens || 0;
      totalOutputTokens += log.output_tokens || 0;
      totalCost += cost;
      totalLatencyMs += log.latency_ms || 0;
      if (!firstUsed || log.created_at < firstUsed) firstUsed = log.created_at;
      if (!lastUsed || log.created_at > lastUsed) lastUsed = log.created_at;

      const day = (log.created_at || '').slice(0, 10);
      const dEntry = byDay.get(day) || { day, requests: 0, tokens: 0, cost: 0 };
      dEntry.requests += 1; dEntry.tokens += tokens; dEntry.cost += cost;
      byDay.set(day, dEntry);

      const mEntry = byModel.get(log.model) || { name: log.model, requests: 0, tokens: 0, cost: 0 };
      mEntry.requests += 1; mEntry.tokens += tokens; mEntry.cost += cost;
      byModel.set(log.model, mEntry);

      const fEntry = byFeature.get(log.feature) || { name: log.feature, requests: 0, tokens: 0, cost: 0 };
      fEntry.requests += 1; fEntry.tokens += tokens; fEntry.cost += cost;
      byFeature.set(log.feature, fEntry);

      if (log.organization_id) {
        const oEntry = byOrg.get(log.organization_id) || {
          id: log.organization_id,
          name: orgById.get(log.organization_id) || '—',
          requests: 0, tokens: 0, cost: 0,
        };
        oEntry.requests += 1; oEntry.tokens += tokens; oEntry.cost += cost;
        byOrg.set(log.organization_id, oEntry);
      }
    }

    // Recent request log — cap at 100 most recent (logs are already sorted desc).
    const recent = (logs || []).slice(0, 100).map((l) => ({
      id: l.id,
      created_at: l.created_at,
      organization_id: l.organization_id,
      organization_name: orgById.get(l.organization_id) || '—',
      feature: l.feature,
      model: l.model,
      input_tokens: l.input_tokens,
      output_tokens: l.output_tokens,
      total_tokens: (l.input_tokens || 0) + (l.output_tokens || 0),
      cost: Number(l.estimated_cost) || 0,
      latency_ms: l.latency_ms,
    }));

    return res.json({
      user: {
        user_id: userId,
        full_name: profileRow?.full_name || stamped.user_full_name || 'Unknown user',
        email: profileRow?.email || stamped.user_email || '—',
        avatar_url: profileRow?.avatar_url || null,
        joined_at: profileRow?.created_at || null,
        deleted: !profileRow,
      },
      range,
      totals: {
        requests: totalRequests,
        tokens: totalTokens,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cost: totalCost,
        avg_latency_ms: totalRequests > 0 ? Math.round(totalLatencyMs / totalRequests) : 0,
        first_used: firstUsed,
        last_used: lastUsed,
      },
      by_day: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
      by_model: Array.from(byModel.values()).sort((a, b) => b.cost - a.cost),
      by_feature: Array.from(byFeature.values()).sort((a, b) => b.cost - a.cost),
      by_organization: Array.from(byOrg.values()).sort((a, b) => b.cost - a.cost),
      recent,
    });
  } catch (err) {
    console.error('[ai-usage detail] failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
