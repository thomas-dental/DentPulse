const express = require('express');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { MODULE_REGISTRY, MODULE_KEYS, defaultModuleMap } = require('../config/moduleRegistry');

const router = express.Router();

const TABLE = 'organization_module_access';
const SETTINGS_PATH = path.join(__dirname, '..', 'config', 'moduleAccessSettings.json');

// Postgres error code for "relation does not exist" — lets us degrade
// gracefully (fall back to the JSON file) before the migration is applied.
const UNDEFINED_TABLE = '42P01';
const isMissingTable = (err) => err && (err.code === UNDEFINED_TABLE || /does not exist/i.test(err.message || ''));

// ---- Default-scope JSON file mirror (resilience/backup) ----
function readDefaultFile() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return { ...defaultModuleMap(), ...JSON.parse(raw) };
  } catch {
    return defaultModuleMap();
  }
}

function writeDefaultFile(map) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(map, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[ModuleAccess] Failed to mirror default settings to file:', err.message);
  }
}

// Apply the correct scope filter: NULL org = system default, else a specific org.
function scoped(query, organizationId) {
  return organizationId ? query.eq('organization_id', organizationId) : query.is('organization_id', null);
}

// Turn DB rows into a { module_key: enabled } map, seeded from a base map so
// unknown/absent modules still get a sensible default.
function rowsToMap(rows, base) {
  const map = { ...base };
  for (const row of rows || []) {
    if (MODULE_KEYS.has(row.module_key)) map[row.module_key] = !!row.enabled;
  }
  return map;
}

// Read the system-default map: Supabase first, JSON file as fallback.
async function readDefaultMap() {
  try {
    const { data, error } = await scoped(
      supabaseAdmin.from(TABLE).select('module_key, enabled'),
      null,
    );
    if (error) throw error;
    if (data && data.length > 0) return rowsToMap(data, defaultModuleMap());
    // No default rows yet — fall back to the file mirror.
    return readDefaultFile();
  } catch (err) {
    if (!isMissingTable(err)) {
      console.warn('[ModuleAccess] Supabase read of default map failed, using file:', err.message);
    }
    return readDefaultFile();
  }
}

/**
 * GET /api/module-access/modules
 * The module registry (metadata for rendering the toggle list).
 */
router.get('/modules', authMiddleware, (req, res) => {
  res.json({ modules: MODULE_REGISTRY });
});

/**
 * GET /api/module-access?organization_id=<uuid>
 * Omit organization_id for the system-default scope. For a custom org the map
 * is the default overlaid with that org's overrides (so unset modules inherit).
 */
router.get('/', authMiddleware, async (req, res) => {
  const organizationId = req.query.organization_id || null;
  try {
    const defaults = await readDefaultMap();

    if (!organizationId) {
      return res.json({ scope: 'default', organization_id: null, modules: defaults, inherited: false });
    }

    // Custom scope: start from defaults, overlay this org's rows.
    let overrides = [];
    let tableMissing = false;
    try {
      const { data, error } = await scoped(
        supabaseAdmin.from(TABLE).select('module_key, enabled'),
        organizationId,
      );
      if (error) throw error;
      overrides = data || [];
    } catch (err) {
      if (isMissingTable(err)) tableMissing = true;
      else throw err;
    }

    return res.json({
      scope: 'custom',
      organization_id: organizationId,
      modules: rowsToMap(overrides, defaults),
      inherited: overrides.length === 0,
      table_missing: tableMissing || undefined,
    });
  } catch (err) {
    console.error('[ModuleAccess] GET failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/module-access
 * Body: { organization_id: <uuid|null>, modules: { [key]: boolean } }
 * Upserts one row per module for the given scope. Default scope is also
 * mirrored to the JSON file so it survives a brief Supabase outage.
 */
router.put('/', authMiddleware, async (req, res) => {
  const { organization_id = null, modules } = req.body || {};

  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
    return res.status(400).json({ error: 'modules must be an object of { key: boolean }' });
  }

  // Keep only known modules; coerce values to booleans.
  const clean = {};
  for (const [key, val] of Object.entries(modules)) {
    if (MODULE_KEYS.has(key)) clean[key] = !!val;
  }
  if (Object.keys(clean).length === 0) {
    return res.status(400).json({ error: 'No recognised modules in payload' });
  }

  const userId = req.user?.id || null;

  try {
    // Fetch existing rows for this scope to decide insert vs update.
    const { data: existing, error: readErr } = await scoped(
      supabaseAdmin.from(TABLE).select('id, module_key'),
      organization_id,
    );
    if (readErr) throw readErr;

    const idByKey = new Map((existing || []).map((r) => [r.module_key, r.id]));

    const inserts = [];
    const updates = [];
    for (const [module_key, enabled] of Object.entries(clean)) {
      const id = idByKey.get(module_key);
      if (id) {
        updates.push({ id, enabled });
      } else {
        inserts.push({ organization_id, module_key, enabled, updated_by: userId });
      }
    }

    await Promise.all([
      ...updates.map((u) =>
        supabaseAdmin
          .from(TABLE)
          .update({ enabled: u.enabled, updated_by: userId, updated_at: new Date().toISOString() })
          .eq('id', u.id)
          .then(({ error }) => { if (error) throw error; }),
      ),
      inserts.length
        ? supabaseAdmin.from(TABLE).insert(inserts).then(({ error }) => { if (error) throw error; })
        : Promise.resolve(),
    ]);

    // Mirror the default scope to the JSON file.
    if (!organization_id) {
      writeDefaultFile({ ...readDefaultFile(), ...clean });
    }

    // Return the freshly persisted map for this scope.
    const defaults = await readDefaultMap();
    if (!organization_id) {
      return res.json({ scope: 'default', organization_id: null, modules: defaults });
    }
    const { data: rows } = await scoped(
      supabaseAdmin.from(TABLE).select('module_key, enabled'),
      organization_id,
    );
    return res.json({
      scope: 'custom',
      organization_id,
      modules: rowsToMap(rows || [], defaults),
      inherited: false,
    });
  } catch (err) {
    if (isMissingTable(err)) {
      // Default scope can still persist to the file; custom scope needs the table.
      if (!organization_id) {
        writeDefaultFile({ ...readDefaultFile(), ...clean });
        return res.json({ scope: 'default', organization_id: null, modules: readDefaultFile() });
      }
      return res.status(503).json({
        error: 'Module access table not found. Apply backend/sql/organization_module_access.sql to Supabase to enable per-organization overrides.',
      });
    }
    console.error('[ModuleAccess] PUT failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
