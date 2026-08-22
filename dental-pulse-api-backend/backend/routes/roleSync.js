/**
 * POST/DELETE /api/role-sync/*
 *
 * Thin proxy: DentPulse frontend → this backend → Central Auth /api/role-sync/*.
 * Keeps PASSWORD_SYNC_SECRET out of the browser bundle (same pattern as
 * password-broadcast and register-broadcast).
 *
 * Auth: caller must present a valid Supabase JWT. Authorization on what they
 * can change is enforced by Supabase RLS on the source-of-truth writes
 * (custom_roles + role_permissions + user_roles are owner-only). This proxy
 * does NOT re-check ownership — RLS already gated the write before we get here.
 * The nightly reconciliation cron is the safety net for any drift.
 */
const express = require('express');
const syncAuthMiddleware = require('../middleware/syncAuth');

const router = express.Router();

const PLATFORM = 'dentalpulse';

function caBaseUrl() {
  const url = process.env.CENTRAL_AUTH_BASE_URL;
  if (!url) return null;
  return url.replace(/\/+$/, '');
}

function caApiKey() {
  return process.env.PASSWORD_SYNC_SECRET;
}

async function forwardToCa(method, pathSuffix, body) {
  const baseUrl = caBaseUrl();
  if (!baseUrl) {
    return { status: true, skipped: true, reason: 'CENTRAL_AUTH_BASE_URL not set' };
  }
  const apiKey = caApiKey();
  if (!apiKey) {
    return { status: true, skipped: true, reason: 'PASSWORD_SYNC_SECRET not set' };
  }

  try {
    const res = await fetch(`${baseUrl}/role-sync/${pathSuffix}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`[role-sync] CA rejected ${method} ${pathSuffix}: ${res.status} ${JSON.stringify(data)}`);
      return { status: true, skipped: true, reason: `CA returned ${res.status}`, ca_response: data };
    }
    return { status: true, ca_response: data };
  } catch (err) {
    console.error(`[role-sync] network error on ${method} ${pathSuffix}:`, err.message);
    return { status: true, skipped: true, reason: `network: ${err.message}` };
  }
}

/**
 * @swagger
 * /api/role-sync/role:
 *   post:
 *     summary: Sync a custom role (create or update) to Central Auth
 *     description: Forwards to Central Auth /api/role-sync/role. Fire-and-forget — never blocks the user's action.
 *     tags: [Role Sync]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenant_platform_id, source_role_id, name]
 *             properties:
 *               tenant_platform_id: { type: string, description: "organization_id (Supabase)" }
 *               source_role_id: { type: string, description: "custom_roles.id (Supabase)" }
 *               name: { type: string }
 *               description: { type: string }
 *               color: { type: string }
 *               is_system: { type: boolean }
 */
router.post('/role', syncAuthMiddleware, async (req, res) => {
  const { tenant_platform_id, source_role_id, name, description, color, is_system, ca_role_id } = req.body;
  if (!source_role_id || !name) {
    return res.status(400).json({ status: false, response: 'source_role_id and name are required' });
  }
  const payload = {
    platform: PLATFORM,
    tenant_platform_id,
    source_role_id,
    name,
    description,
    color,
    is_system,
    created_by_email: req.user?.email,
  };
  // Pass through ca_role_id if the caller already knows it (edit / propagated copy)
  if (ca_role_id) payload.ca_role_id = ca_role_id;

  const result = await forwardToCa('POST', 'role', payload);

  // Persist CA's logical id back to Supabase so future syncs include it
  const returnedCaRoleId = result?.ca_response?.data?.ca_role_id;
  if (returnedCaRoleId && source_role_id) {
    try {
      const { supabaseAdmin } = require('../config/supabase');
      await supabaseAdmin
        .from('custom_roles')
        .update({ ca_role_id: returnedCaRoleId })
        .eq('id', source_role_id)
        .is('ca_role_id', null);
    } catch (err) {
      console.warn('[role-sync] failed to persist ca_role_id to Supabase:', err.message);
    }
  }

  return res.json(result);
});

/**
 * @swagger
 * /api/role-sync/role:
 *   delete:
 *     summary: Soft-delete a role in Central Auth
 *     tags: [Role Sync]
 *     security: [{ bearerAuth: [] }]
 */
router.delete('/role', syncAuthMiddleware, async (req, res) => {
  const { source_role_id } = req.body;
  if (!source_role_id) {
    return res.status(400).json({ status: false, response: 'source_role_id is required' });
  }
  const result = await forwardToCa('DELETE', 'role', {
    platform: PLATFORM,
    source_role_id,
  });
  return res.json(result);
});

/**
 * @swagger
 * /api/role-sync/permissions:
 *   post:
 *     summary: Bulk upsert permissions for a role
 *     tags: [Role Sync]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [source_role_id, items]
 *             properties:
 *               source_role_id: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [permission_name, granted]
 *                   properties:
 *                     permission_name: { type: string, example: "treatments:setup_treatments_tab:export" }
 *                     granted: { type: boolean }
 */
router.post('/permissions', syncAuthMiddleware, async (req, res) => {
  const { source_role_id, items } = req.body;
  if (!source_role_id || !Array.isArray(items)) {
    return res.status(400).json({ status: false, response: 'source_role_id and items array are required' });
  }
  const result = await forwardToCa('POST', 'permissions', {
    platform: PLATFORM,
    source_role_id,
    items,
  });
  return res.json(result);
});

/**
 * @swagger
 * /api/role-sync/assign:
 *   post:
 *     summary: Assign a role to a user for a tenant
 *     tags: [Role Sync]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/assign', syncAuthMiddleware, async (req, res) => {
  const { tenant_platform_id, user_email, source_role_id } = req.body;
  if (!user_email || !source_role_id) {
    return res.status(400).json({ status: false, response: 'user_email and source_role_id are required' });
  }
  const result = await forwardToCa('POST', 'assign', {
    platform: PLATFORM,
    tenant_platform_id,
    user_email,
    source_role_id,
  });
  return res.json(result);
});

/**
 * @swagger
 * /api/role-sync/assign:
 *   delete:
 *     summary: Unassign a role from a user
 *     tags: [Role Sync]
 *     security: [{ bearerAuth: [] }]
 */
router.delete('/assign', syncAuthMiddleware, async (req, res) => {
  const { tenant_platform_id, user_email, source_role_id } = req.body;
  if (!user_email || !source_role_id) {
    return res.status(400).json({ status: false, response: 'user_email and source_role_id are required' });
  }
  const result = await forwardToCa('DELETE', 'assign', {
    platform: PLATFORM,
    tenant_platform_id,
    user_email,
    source_role_id,
  });
  return res.json(result);
});

module.exports = router;
