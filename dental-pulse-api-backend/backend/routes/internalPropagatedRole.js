/**
 * Inbound endpoint called by Central Auth when a role created on another
 * platform should also exist on DentPulse Enterprise.
 *
 * Auth: X-API-Key (PASSWORD_SYNC_SECRET) — server-to-server only.
 * Loop-breaker: this endpoint writes directly to Supabase and does NOT
 * fire outbound CA sync.
 *
 * Routes:
 *   POST   /api/internal/propagated-role
 *   PUT    /api/internal/propagated-role
 *   DELETE /api/internal/propagated-role
 */
const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

function checkApiKey(req, res) {
  const provided = req.header('X-API-Key');
  const expected = process.env.PASSWORD_SYNC_SECRET;
  if (!expected) {
    res.status(500).json({ success: false, error: 'Server misconfigured' });
    return false;
  }
  if (!provided || provided !== expected) {
    res.status(401).json({ success: false, error: 'Invalid or missing X-API-Key' });
    return false;
  }
  return true;
}

// POST /api/internal/propagated-role
router.post('/', async (req, res) => {
  if (!checkApiKey(req, res)) return;

  const { ca_role_id, name, description, color, is_system, tenant_platform_id, admin_email } = req.body;
  if (!ca_role_id || !name) {
    return res.status(400).json({ success: false, error: 'ca_role_id and name are required' });
  }

  try {
    // Resolve organization_id — for DentPulse, tenant_platform_id IS organization_id (UUID)
    let organizationId = tenant_platform_id || null;
    if (!organizationId && admin_email) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('current_organization_id')
        .eq('email', admin_email)
        .maybeSingle();
      organizationId = profile?.current_organization_id || null;
    }
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'Could not resolve organization' });
    }

    // Idempotency: same ca_role_id already linked?
    const { data: existing } = await supabaseAdmin
      .from('custom_roles')
      .select('id')
      .eq('ca_role_id', ca_role_id)
      .maybeSingle();
    if (existing) {
      return res.json({
        success: true,
        data: { source_role_id: existing.id, action: 'noop_existing_ca_role_id' },
      });
    }

    // Merge case: a role with the same name + org exists → link it
    const { data: merged } = await supabaseAdmin
      .from('custom_roles')
      .select('id, ca_role_id')
      .eq('organization_id', organizationId)
      .ilike('name', name)
      .maybeSingle();
    if (merged) {
      await supabaseAdmin.from('custom_roles').update({ ca_role_id }).eq('id', merged.id);
      console.log('[propagated-role] Linked existing role', { local_role_id: merged.id, ca_role_id });
      return res.json({
        success: true,
        data: { source_role_id: merged.id, action: 'merged' },
      });
    }

    // Fresh create — 0 permissions, owned by the admin's org
    const { data: created, error: insertErr } = await supabaseAdmin
      .from('custom_roles')
      .insert({
        organization_id: organizationId,
        name,
        description: description || null,
        color: color || null,
        is_system: !!is_system,
        ca_role_id,
      })
      .select('id')
      .single();
    if (insertErr) throw insertErr;

    console.log('[propagated-role] Created local role from CA', { local_role_id: created.id, ca_role_id, organizationId });
    return res.json({
      success: true,
      data: { source_role_id: created.id, action: 'created' },
    });
  } catch (err) {
    console.error('[propagated-role] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/internal/propagated-role
router.put('/', async (req, res) => {
  if (!checkApiKey(req, res)) return;
  const { ca_role_id, name, description } = req.body;
  if (!ca_role_id) return res.status(400).json({ success: false, error: 'ca_role_id required' });

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;

  const { data, error } = await supabaseAdmin
    .from('custom_roles')
    .update(updates)
    .eq('ca_role_id', ca_role_id)
    .select('id')
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data)  return res.status(404).json({ success: false, error: 'Role not found locally' });

  return res.json({ success: true, data: { source_role_id: data.id, action: 'updated' } });
});

// DELETE /api/internal/propagated-role
router.delete('/', async (req, res) => {
  if (!checkApiKey(req, res)) return;
  const { ca_role_id } = req.body;
  if (!ca_role_id) return res.status(400).json({ success: false, error: 'ca_role_id required' });

  const { data: found } = await supabaseAdmin
    .from('custom_roles')
    .select('id')
    .eq('ca_role_id', ca_role_id)
    .maybeSingle();
  if (!found) return res.json({ success: true, data: { action: 'noop_not_found' } });

  const { error } = await supabaseAdmin.from('custom_roles').delete().eq('id', found.id);
  if (error) return res.status(500).json({ success: false, error: error.message });

  console.log('[propagated-role] Deleted local role', { local_role_id: found.id, ca_role_id });
  return res.json({ success: true, data: { action: 'deleted' } });
});

module.exports = router;
