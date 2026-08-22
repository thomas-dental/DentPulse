const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// JWKS URL for DentPulse Auth server — used to verify admin panel JWT tokens.
const ADMIN_PANEL_JWKS_URL = process.env.AUTH_JWKS_URL;
if (!ADMIN_PANEL_JWKS_URL) {
  console.warn("WARNING: AUTH_JWKS_URL is not set in .env — admin panel token verification will fail.");
}

const jwks = jwksClient({ jwksUri: ADMIN_PANEL_JWKS_URL, cache: true, rateLimit: true });

function getSigningKey(header) {
  return new Promise((resolve, reject) => {
    jwks.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

async function verifyToken(token) {
  const decodedHeader = jwt.decode(token, { complete: true });
  if (!decodedHeader) throw new Error('Malformed token');

  const pubKey = await getSigningKey(decodedHeader.header);
  return jwt.verify(token, pubKey, { algorithms: ['RS256'] });
}

async function requireBearerToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ status: false, response: 'No token provided', data: [] });
  }
  try {
    const payload = await verifyToken(token);
    req.user = { id: payload.sub, email: payload.email };
    req.accessToken = token;
    next();
  } catch (err) {
    console.error('[AdminPanel] Token verification failed:', err.message);
    return res.status(401).json({ status: false, response: 'Invalid or expired token: ' + err.message, data: [] });
  }
}

const PERMISSIONS_FILE = path.join(__dirname, '..', 'data', 'user-permissions.json');
const DEFAULT_PERMISSIONS = { dentpulse: true, dentledger: false, dentscale: false };
const ALLOWED_PERMISSION_KEYS = Object.keys(DEFAULT_PERMISSIONS);

function readPermissionsStore() {
  try {
    if (!fs.existsSync(PERMISSIONS_FILE)) return {};
    const raw = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('[AdminPanel] Failed to read permissions store:', err.message);
    return {};
  }
}

function writePermissionsStore(store) {
  const dir = path.dirname(PERMISSIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * @swagger
 * /api/admin-panel/users:
 *   get:
 *     summary: List all non-superadmin users
 *     description: Returns all DentPulse users (excluding superadmins) in a DentLedger/DentScale-compatible shape with profile, organization, clinic, and platform permissions data.
 *     tags: [Admin Panel]
 *     security:
 *       - centralAuthJwt: []
 *     responses:
 *       200:
 *         description: Users fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       last_name:
 *                         type: string
 *                         nullable: true
 *                       email:
 *                         type: string
 *                       phone:
 *                         type: string
 *                         nullable: true
 *                       company_name:
 *                         type: string
 *                         nullable: true
 *                       country:
 *                         type: string
 *                         nullable: true
 *                       postal_code:
 *                         type: string
 *                         nullable: true
 *                       role:
 *                         type: string
 *                       permissions:
 *                         type: object
 *                         properties:
 *                           dentpulse:
 *                             type: boolean
 *                           dentledger:
 *                             type: boolean
 *                           dentscale:
 *                             type: boolean
 *       401:
 *         description: Invalid or missing token
 *       500:
 *         description: Server error
 */
router.get('/users', requireBearerToken, async (req, res) => {
  try {
    // 1. Exclude superadmins
    const { data: superadmins } = await supabaseAdmin.from('superadmins').select('id');
    const superadminIds = new Set((superadmins || []).map((s) => s.id));

    // 2. Profiles
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, full_name, email, avatar_url, current_organization_id, created_at')
      .order('created_at', { ascending: false });
    if (profileError) {
      return res.status(500).json({ status: false, response: profileError.message, data: [] });
    }
    const filteredProfiles = profiles.filter((p) => !superadminIds.has(p.user_id));

    // 3. Roles
    const { data: userRoles } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, organization_id, role');
    const roleMap = {};
    for (const ur of userRoles || []) {
      if (!roleMap[ur.user_id]) roleMap[ur.user_id] = ur.role;
    }

    // 4. Organizations
    const orgIds = [...new Set(filteredProfiles.map((p) => p.current_organization_id).filter(Boolean))];
    const orgMap = {};
    if (orgIds.length) {
      const { data: orgs } = await supabaseAdmin.from('organizations').select('id, name').in('id', orgIds);
      for (const o of orgs || []) orgMap[o.id] = o.name;
    }

    // 5. Clinics (practice_locations) per organization
    const clinicMap = {};
    if (orgIds.length) {
      const { data: clinics } = await supabaseAdmin
        .from('practice_locations')
        .select('organization_id, phone, postal_code, is_primary')
        .in('organization_id', orgIds);
      for (const c of clinics || []) {
        if (!clinicMap[c.organization_id]) clinicMap[c.organization_id] = [];
        clinicMap[c.organization_id].push(c);
      }
    }

    // 6. Build DentLedger/DentScale-compatible shape
    const permissionsStore = readPermissionsStore();

    const data = filteredProfiles.map((p) => {
      const parts = (p.full_name || '').trim().split(/\s+/).filter(Boolean);
      const name = parts.shift() || (p.email ? p.email.split('@')[0] : null);
      const last_name = parts.length ? parts.join(' ') : null;
      const orgClinics = clinicMap[p.current_organization_id] || [];
      const primary = orgClinics.find((c) => c.is_primary) || orgClinics[0] || {};

      return {
        id: p.user_id,
        name,
        last_name,
        email: p.email || null,
        phone: primary.phone || null,
        company_name: orgMap[p.current_organization_id] || null,
        country: null,
        postal_code: primary.postal_code || null,
        role: roleMap[p.user_id] || 'member',
        permissions: { ...DEFAULT_PERMISSIONS, ...((permissionsStore[p.user_id] || {}).permissions || {}) },
      };
    });

    return res.json({
      status: true,
      response: 'Users fetched successfully',
      data,
    });
  } catch (err) {
    console.error('[AdminPanel] Failed to fetch users:', err.message);
    return res.status(500).json({ status: false, response: err.message || 'Failed to fetch users', data: [] });
  }
});

/**
 * @swagger
 * /api/admin-panel/users-with-org:
 *   get:
 *     summary: List organizations with their owners and members
 *     description: Returns all organizations with users grouped by role (owners vs members). Each user includes profile data and platform permissions.
 *     tags: [Admin Panel]
 *     security:
 *       - centralAuthJwt: []
 *     responses:
 *       200:
 *         description: Organizations with users fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       organization:
 *                         type: object
 *                       owners:
 *                         type: array
 *                         items:
 *                           type: object
 *                       members:
 *                         type: array
 *                         items:
 *                           type: object
 *       401:
 *         description: Invalid or missing token
 *       500:
 *         description: Server error
 */
router.get('/users-with-org', requireBearerToken, async (req, res) => {
  try {
    // 1. Fetch all profiles
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, full_name, email, avatar_url, current_organization_id, created_at');

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    // 2. Get unique organization IDs
    const orgIds = [...new Set(
      profiles.filter((p) => p.current_organization_id).map((p) => p.current_organization_id)
    )];

    // 3. Fetch organizations
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
    for (const ur of userRoles || []) {
      roleMap[`${ur.user_id}_${ur.organization_id}`] = ur.role;
    }

    // 5. Read permissions store
    const permissionsStore = readPermissionsStore();

    // 6. Group profiles by organization, split into owners and members
    const usersByOrg = {};
    for (const p of profiles) {
      const orgId = p.current_organization_id;
      if (!orgId) continue;
      if (!usersByOrg[orgId]) {
        usersByOrg[orgId] = { owners: [], members: [] };
      }
      const role = roleMap[`${p.user_id}_${orgId}`] || 'member';
      const user = {
        id: p.user_id,
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        created_at: p.created_at,
        role,
        permissions: { ...DEFAULT_PERMISSIONS, ...((permissionsStore[p.user_id] || {}).permissions || {}) },
      };

      if (role === 'owner') {
        usersByOrg[orgId].owners.push(user);
      } else {
        usersByOrg[orgId].members.push(user);
      }
    }

    const result = organizations.map((org) => ({
      organization: org,
      owners: usersByOrg[org.id]?.owners || [],
      members: usersByOrg[org.id]?.members || [],
    }));

    return res.json({
      status: true,
      response: 'Organizations with users fetched successfully',
      data: result,
    });
  } catch (err) {
    console.error('[AdminPanel] Failed to fetch users-with-org:', err.message);
    return res.status(500).json({ error: 'Failed to fetch organizations with users' });
  }
});

/**
 * @swagger
 * /api/admin-panel/users/{userId}/permissions:
 *   patch:
 *     summary: Update user platform permissions
 *     description: Updates a user's cross-platform permissions (dentpulse, dentledger, dentscale). Accepts either a full permissions object or a single key/value toggle.
 *     tags: [Admin Panel]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The Supabase user ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   clinic:
 *                     type: string
 *                   permissions:
 *                     type: object
 *                     properties:
 *                       dentpulse:
 *                         type: boolean
 *                       dentledger:
 *                         type: boolean
 *                       dentscale:
 *                         type: boolean
 *               - type: object
 *                 properties:
 *                   key:
 *                     type: string
 *                     enum: [dentpulse, dentledger, dentscale]
 *                   value:
 *                     type: boolean
 *     responses:
 *       200:
 *         description: Permissions updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 name:
 *                   type: string
 *                   nullable: true
 *                 email:
 *                   type: string
 *                   nullable: true
 *                 clinic:
 *                   type: string
 *                   nullable: true
 *                 permissions:
 *                   type: object
 *                   properties:
 *                     dentpulse:
 *                       type: boolean
 *                     dentledger:
 *                       type: boolean
 *                     dentscale:
 *                       type: boolean
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request body or unknown permission key
 *       500:
 *         description: Server error
 */
router.patch('/users/:userId/permissions', (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const store = readPermissionsStore();
    const existing = store[userId] || {};
    const current = { ...DEFAULT_PERMISSIONS, ...(existing.permissions || {}) };

    let updates = {};
    if (req.body && typeof req.body.permissions === 'object' && req.body.permissions) {
      updates = req.body.permissions;
    } else if (req.body && typeof req.body.key === 'string') {
      updates = { [req.body.key]: !!req.body.value };
    } else {
      return res.status(400).json({ error: 'Provide { permissions } or { key, value }' });
    }

    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_PERMISSION_KEYS.includes(key)) {
        return res.status(400).json({ error: `Unknown permission key: ${key}` });
      }
      current[key] = !!value;
    }

    const record = {
      user_id: userId,
      name: req.body.name ?? existing.name ?? null,
      email: req.body.email ?? existing.email ?? null,
      clinic: req.body.clinic ?? existing.clinic ?? null,
      permissions: current,
      updated_at: new Date().toISOString(),
    };

    store[userId] = record;
    writePermissionsStore(store);

    console.log(`[AdminPanel] Permissions updated:`, record);
    return res.json(record);
  } catch (err) {
    console.error('[AdminPanel] Failed to update permissions:', err.message);
    return res.status(500).json({ error: 'Failed to update permissions' });
  }
});

module.exports = router;
