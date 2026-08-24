const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');
const syncAuthMiddleware = require('../middleware/syncAuth');
const { triggerSync } = require('../queue');
const { fetchDentallyPage, extractRecords } = require('../api/dentally/client');
const {
  encryptPatForStorage,
  decryptIntegrationPat,
  hasEncryptedPat,
  buildPatHint,
} = require('../services/patientEconomics/integrationPat');
const { validatePatWithDentally } = require('../services/patientEconomics/validatePat');

const router = express.Router();

// Masked preview of a key for display — never the full secret. Mirrors
// routes/users.js's keyPreview so both surfaces show identical masking.
function keyPreview(key) {
  const k = String(key || '');
  if (k.length <= 16) return '••••••••';
  return k.slice(0, 12) + '••••••••••••' + k.slice(-4);
}

// Resolving a Dentally account's practice name means hitting /v1/sites with its
// key. That's a live API call per account, so cache the result per key for a
// while to avoid re-fetching on every org-detail page load (and to stay clear
// of the per-account rate limit).
const dentallyNameCache = new Map(); // integrationId -> { name, ts }
const DENTALLY_NAME_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Mirrors the CHECK constraint on organizations.plan_tier in dental-pulse-dev's
// 20260817000001_organization_plan_tier.sql migration.
const VALID_PLAN_TIERS = ['basic', 'essential', 'growth', 'accelerate'];

/**
 * Resolve a friendly practice name for a Dentally account from its sites.
 * Returns null on any failure so callers can fall back to the key prefix.
 */
async function resolveDentallyAccountName(integrationId, apiKey, apiEndpoint) {
  if (!apiKey || !apiEndpoint) return null;

  const cached = dentallyNameCache.get(integrationId);
  if (cached && Date.now() - cached.ts < DENTALLY_NAME_TTL_MS) {
    return cached.name;
  }

  try {
    const json = await fetchDentallyPage(apiKey, apiEndpoint, 'locations', 1);
    const { records } = extractRecords(json, 'locations');
    const names = (records || [])
      .map((s) => s.name || s.nickname)
      .filter(Boolean);
    let name = null;
    if (names.length === 1) name = names[0];
    else if (names.length > 1) name = `${names[0]} +${names.length - 1} more`;

    dentallyNameCache.set(integrationId, { name, ts: Date.now() });
    return name;
  } catch (err) {
    console.error(`[Organizations] Failed to resolve Dentally account name: ${err.message}`);
    dentallyNameCache.set(integrationId, { name: null, ts: Date.now() });
    return null;
  }
}

// GET /api/organizations
router.get('/', authMiddleware, async (req, res) => {
  try {
    // 1. Fetch all profiles
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, full_name, email, avatar_url, current_organization_id, created_at');

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    // 2. Get unique organization IDs from profiles
    const orgIds = [...new Set(
      profiles.filter((p) => p.current_organization_id).map((p) => p.current_organization_id)
    )];

    // 3. Fetch organization details
    let organizations = [];
    if (orgIds.length > 0) {
      const { data: orgs, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .in('id', orgIds)
        .order('created_at', { ascending: false });

      if (orgError) {
        return res.status(500).json({ error: orgError.message });
      }
      organizations = orgs || [];
    }

    // 4. Fetch user_roles
    const { data: userRoles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, organization_id, role');

    if (rolesError) {
      return res.status(500).json({ error: rolesError.message });
    }

    const roleMap = {};
    for (const ur of userRoles) {
      roleMap[`${ur.user_id}_${ur.organization_id}`] = ur.role;
    }

    // 4b. AI access per user — same fields as GET /:id, needed here so the
    // Organizations table can show/manage the owner's AI key inline (the
    // owner's key is what getOwnerKey() in apiKeyService.js resolves as the
    // organization's AI key, shared by every member of that org).
    const userIds = [...new Set(profiles.map((p) => p.user_id).filter(Boolean))];
    let aiKeyByUser = new Map();
    if (userIds.length > 0) {
      const { data: aiKeys } = await supabaseAdmin
        .from('user_ai_keys')
        .select('*')
        .in('user_id', userIds);
      aiKeyByUser = new Map((aiKeys || []).map((k) => [k.user_id, k]));
    }

    // 5. Group profiles by organization
    const usersByOrg = {};
    for (const p of profiles) {
      const orgId = p.current_organization_id;
      if (!orgId) continue;
      if (!usersByOrg[orgId]) {
        usersByOrg[orgId] = [];
      }
      const aiRow = aiKeyByUser.get(p.user_id);
      usersByOrg[orgId].push({
        id: p.id,
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        created_at: p.created_at,
        role: roleMap[`${p.user_id}_${orgId}`] || 'member',
        has_ai_key: !!aiRow,
        ai_enabled: aiRow ? aiRow.enabled !== false : false,
        key_preview: aiRow ? keyPreview(aiRow.claude_api_key) : null,
      });
    }

    const result = organizations.map((org) => ({
      ...org,
      users: usersByOrg[org.id] || [],
    }));

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// GET /api/organizations/users-with-org
// Returns the authenticated user's organization data with owners and members separated
router.get('/users-with-org', syncAuthMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Get the user's profile to find their current organization
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('current_organization_id')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const orgId = profile.current_organization_id;
    if (!orgId) {
      return res.status(404).json({ error: 'User is not associated with any organization' });
    }

    // 2. Fetch the organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // 3. Fetch all user_roles for this organization
    const { data: userRoles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, role')
      .eq('organization_id', orgId);

    if (rolesError) {
      return res.status(500).json({ error: rolesError.message });
    }

    // 4. Build role map and collect user IDs
    const roleMap = {};
    const roleUserIds = (userRoles || []).map((ur) => {
      roleMap[ur.user_id] = ur.role;
      return ur.user_id;
    });

    // 5. Fetch profiles for users linked to this org (via user_roles or current_organization_id)
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, full_name, email, avatar_url, created_at')
      .eq('current_organization_id', orgId);

    if (profilesError) {
      return res.status(500).json({ error: profilesError.message });
    }

    // Merge: include any user_roles users not already in profiles
    const profileUserIds = new Set((profiles || []).map((p) => p.user_id));
    const missingUserIds = roleUserIds.filter((uid) => !profileUserIds.has(uid));

    let allProfiles = profiles || [];
    if (missingUserIds.length > 0) {
      const { data: extraProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, user_id, full_name, email, avatar_url, created_at')
        .in('user_id', missingUserIds);
      if (extraProfiles) allProfiles = allProfiles.concat(extraProfiles);
    }

    // 6. Separate into owners and members
    const owners = [];
    const members = [];

    for (const p of allProfiles) {
      const user = {
        id: p.id,
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        created_at: p.created_at,
        role: roleMap[p.user_id] || 'member',
      };

      if (user.role === 'owner') {
        owners.push(user);
      } else {
        members.push(user);
      }
    }

    return res.json({
      organization: org,
      owners,
      members,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch users with organization' });
  }
});

// GET /api/organizations/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (orgError) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, full_name, email, avatar_url, created_at')
      .eq('current_organization_id', id);

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    const { data: userRoles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, role')
      .eq('organization_id', id);

    if (rolesError) {
      return res.status(500).json({ error: rolesError.message });
    }

    const roleMap = {};
    for (const ur of userRoles) {
      roleMap[ur.user_id] = ur.role;
    }

    // AI access per user (drives the "AI API Key" card on the org page). The
    // key itself is never sent to the browser — only whether one exists and
    // whether it's enabled. The org owner's key is what getOwnerKey() in
    // apiKeyService.js resolves as the organization's AI key.
    const userIds = (profiles || []).map((p) => p.user_id).filter(Boolean);
    let aiKeyByUser = new Map();
    if (userIds.length > 0) {
      const { data: aiKeys } = await supabaseAdmin
        .from('user_ai_keys')
        .select('*')
        .in('user_id', userIds);
      aiKeyByUser = new Map((aiKeys || []).map((k) => [k.user_id, k]));
    }

    const users = (profiles || []).map((p) => {
      const aiRow = aiKeyByUser.get(p.user_id);
      return {
        id: p.id,
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        created_at: p.created_at,
        role: roleMap[p.user_id] || 'member',
        has_ai_key: !!aiRow,
        ai_enabled: aiRow ? aiRow.enabled !== false : false,
        key_preview: aiRow ? keyPreview(aiRow.claude_api_key) : null,
      };
    });

    // Fetch integrations (Dentally)
    const { data: integrations } = await supabaseAdmin
      .from('integrations')
      .select('id, integration_name, is_connected, pat_hint, api_endpoints, sync_frequency, sync_at, created_at, encrypted_pat')
      .eq('organization_id', id)
      .is('deleted_at', null);

    const safeIntegrations = (integrations || []).map((row) => ({
      id: row.id,
      integration_name: row.integration_name,
      is_connected: row.is_connected,
      api_endpoints: row.api_endpoints,
      sync_frequency: row.sync_frequency,
      sync_at: row.sync_at,
      created_at: row.created_at,
      pat_hint: row.pat_hint || null,
      has_pat: !!row.encrypted_pat,
    }));

    // Fetch platform integrations (Xero, Iplicit, etc.)
    const { data: platformIntegrations } = await supabaseAdmin
      .from('platform_integrations')
      .select('id, platform_name, is_connected, client_id, last_synced_at, created_at')
      .eq('organization_id', id);

    // Build accounting_connections for Iplicit from platform_integrations
    // (Iplicit is stored in platform_integrations, not a separate accounting_connections table)
    const accountingConnections = (platformIntegrations || [])
      .filter(p => p.platform_name === 'iplicit')
      .map(p => ({
        id: p.id,
        platform: 'iplicit',
        status: p.is_connected ? 'connected' : 'disconnected',
        iplicit_domain: p.client_id || null,
        last_sync: p.last_synced_at || null,
        created_at: p.created_at,
      }));

    return res.json({
      ...org,
      users,
      integrations: safeIntegrations,
      platform_integrations: platformIntegrations || [],
      accounting_connections: accountingConnections,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// PUT /api/organizations/:id/plan - Update an organization's subscription plan tier.
// This is the only place plan_tier can be changed from — dental-pulse-dev's
// client-facing self-service switcher was removed; only superadmins here can do it.
router.put('/:id/plan', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { plan_tier } = req.body;

    if (!VALID_PLAN_TIERS.includes(plan_tier)) {
      return res.status(400).json({ error: `plan_tier must be one of: ${VALID_PLAN_TIERS.join(', ')}` });
    }

    const { data, error } = await supabaseAdmin
      .from('organizations')
      .update({ plan_tier })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Organization not found' });

    return res.json({ organization: data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update plan' });
  }
});

// PUT /api/organizations/:id/integration - Save/update Dentally PAT (encrypted) and auto-trigger sync
router.put('/:id/integration', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const pat = typeof req.body?.api_key === 'string' ? req.body.api_key.trim() : '';
    const api_endpoints = req.body?.api_endpoints || 'https://api.dentally.co';

    if (!pat) {
      return res.status(400).json({ error: 'api_key (Dentally PAT) is required' });
    }

    const encryptedFields = encryptPatForStorage(pat);
    const validation = await validatePatWithDentally(pat);
    const now = new Date().toISOString();

    const saveFields = {
      ...encryptedFields,
      api_endpoints,
      is_connected: validation.status === 'valid',
      updated_at: now,
    };
    if (validation.status === 'valid') {
      saveFields.validated_at = now;
      saveFields.needs_reconnection = false;
      saveFields.auth_error_message = null;
      saveFields.auth_failed_at = null;
      if (validation.dentallyEmail) {
        saveFields.integration_description = validation.dentallyEmail;
      }
    }

    const { data: existing } = await supabaseAdmin
      .from('integrations')
      .select('id')
      .eq('organization_id', id)
      .ilike('integration_name', 'dentally')
      .is('deleted_at', null)
      .maybeSingle();

    let integration;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('integrations')
        .update({
          ...saveFields,
        })
        .eq('id', existing.id)
        .select('id, integration_name, is_connected, pat_hint, api_endpoints, sync_frequency, sync_at, created_at')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      integration = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('integrations')
        .insert({
          organization_id: id,
          integration_name: 'Dentally',
          ...saveFields,
          sync_frequency: '15min',
        })
        .select('id, integration_name, is_connected, pat_hint, api_endpoints, sync_frequency, sync_at, created_at')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      integration = data;
    }

    // Auto-trigger sync in the background (don't await)
    // Look up org owner so synced records get a proper user_id
    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('user_id')
      .eq('id', id)
      .single();
    triggerSync(id, null, orgRow?.user_id || null).catch(err => {
      console.error(`[Organizations] Auto-trigger sync failed for org ${id}:`, err.message);
    });

    return res.json({
      integration,
      message: 'Integration saved. Sync triggered automatically.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save integration' });
  }
});

// GET /api/organizations/:id/dentally-accounts
// Returns each connected Dentally account with its live practice name (from
// /v1/sites) so the org-detail dropdown can label keys by name instead of just
// the opaque key prefix. Falls back to keyPrefix when the name can't be fetched.
router.get('/:id/dentally-accounts', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Match the integration name case-insensitively — rows are stored as
    // "Dentally" (and a handful as "dentally"), and the org-detail view filters
    // the same way. An exact lowercase match would miss almost every account.
    const { data: integrations, error } = await supabaseAdmin
      .from('integrations')
      .select('id, encrypted_pat, encrypted_pat_iv, pat_hint, api_endpoints')
      .eq('organization_id', id)
      .ilike('integration_name', 'dentally')
      .is('deleted_at', null);

    if (error) return res.status(500).json({ error: error.message });

    const accounts = await Promise.all(
      (integrations || []).map(async (i) => {
        let name = null;
        if (hasEncryptedPat(i)) {
          try {
            const pat = decryptIntegrationPat(i);
            name = await resolveDentallyAccountName(i.id, pat, i.api_endpoints);
          } catch {
            name = null;
          }
        }
        return {
          id: i.id,
          keyPrefix: i.pat_hint || null,
          name,
        };
      })
    );

    return res.json({ accounts });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch Dentally accounts' });
  }
});

// GET /api/organizations/:orgId/integrations/:integrationId/dentally-sites
router.get('/:orgId/integrations/:integrationId/dentally-sites', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, integrationId } = req.params;

    const { data: membership, error: membershipErr } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('user_id', req.user.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (membershipErr) {
      return res.status(500).json({ error: 'Failed to verify organization access' });
    }
    if (!membership) {
      return res.status(403).json({ error: 'Not authorized for this organization' });
    }

    const { data: row, error } = await supabaseAdmin
      .from('integrations')
      .select('id, organization_id, encrypted_pat, encrypted_pat_iv, api_endpoints')
      .eq('id', integrationId)
      .eq('organization_id', orgId)
      .ilike('integration_name', 'dentally')
      .is('deleted_at', null)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!row || !hasEncryptedPat(row)) {
      return res.status(404).json({ error: 'No encrypted Dentally PAT for this integration' });
    }

    const pat = decryptIntegrationPat(row);
    const json = await fetchDentallyPage(pat, row.api_endpoints || 'https://api.dentally.co', 'locations', 1);
    const { records } = extractRecords(json, 'locations');
    const sites = (records || [])
      .filter((s) => s.active !== false)
      .map((s) => ({
        id: String(s.id),
        name: s.name || s.nickname || `Site ${s.id}`,
      }));

    return res.json({ success: true, sites });
  } catch (err) {
    console.error('[Organizations] dentally-sites error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch Dentally sites' });
  }
});

module.exports = router;
