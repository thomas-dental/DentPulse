const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/users
router.get('/', authMiddleware, async (req, res) => {
  try {
    // 0. Fetch superadmin user IDs to exclude them from the list
    const { data: superadmins } = await supabaseAdmin
      .from('superadmins')
      .select('id');

    const superadminIds = new Set((superadmins || []).map((s) => s.id));

    // 1. Fetch all profiles (service role bypasses RLS), excluding superadmins
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, full_name, email, avatar_url, current_organization_id, created_at')
      .order('created_at', { ascending: false });

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    // Filter out superadmin accounts so they never appear in the user list
    const filteredProfiles = profiles.filter((p) => !superadminIds.has(p.user_id));

    // 2. Fetch all user_roles
    const { data: userRoles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, organization_id, role');

    if (rolesError) {
      return res.status(500).json({ error: rolesError.message });
    }

    // 3. Fetch organization names
    const orgIds = [...new Set(
      filteredProfiles.filter((p) => p.current_organization_id).map((p) => p.current_organization_id)
    )];

    let orgMap = {};
    if (orgIds.length > 0) {
      const { data: orgs, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('id, name')
        .in('id', orgIds);

      if (!orgError && orgs) {
        for (const org of orgs) {
          orgMap[org.id] = org.name;
        }
      }
    }

    // 4. Build role lookup
    const roleMap = {};
    for (const ur of userRoles) {
      if (!roleMap[ur.user_id]) {
        roleMap[ur.user_id] = ur.role;
      }
    }

    // 4b. AI access per user (drives the "AI Access" column). The key itself is
    // never sent to the browser — only whether one exists and whether it's on.
    // select('*') keeps this working even before the `enabled` column is added.
    const { data: aiKeys } = await supabaseAdmin
      .from('user_ai_keys')
      .select('*');
    const aiKeyByUser = new Map((aiKeys || []).map((k) => [k.user_id, k]));

    // 5. Merge data
    const result = filteredProfiles.map((p) => {
      const aiRow = aiKeyByUser.get(p.user_id);
      return {
        id: p.id,
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        role: roleMap[p.user_id] || 'member',
        organization_name: orgMap[p.current_organization_id] || null,
        current_organization_id: p.current_organization_id,
        created_at: p.created_at,
        has_ai_key: !!aiRow,
        ai_enabled: aiRow ? aiRow.enabled !== false : false,
        // Masked so the modal can SHOW that a key is stored (never the real key).
        key_preview: aiRow ? keyPreview(aiRow.claude_api_key) : null,
      };
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Masked preview of a key for display — never the full secret. Keeps the
// recognisable prefix + last 4, everything else replaced with dots. The dots
// let the UI detect an unchanged (still-masked) value on save.
function keyPreview(key) {
  const k = String(key || '');
  if (k.length <= 16) return '••••••••';
  return k.slice(0, 12) + '••••••••••••' + k.slice(-4);
}

// Validate a key with a tiny live call to Anthropic. Returns { ok, error }.
// Only an explicit auth rejection (401/403) blocks the save; transient network
// or other errors don't, so a working key is never rejected over a blip.
async function validateAnthropicKey(apiKey) {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 4,
        messages: [{ role: 'user', content: 'Say OK.' }],
      }),
    });
    if (resp.ok) return { ok: true };
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, error: 'Anthropic rejected this API key. Check it and try again.' };
    }
    // 400/429/5xx etc. — the key authenticated (or we can't tell); allow the save.
    return { ok: true };
  } catch {
    // Network error reaching Anthropic — don't block the save on it.
    return { ok: true };
  }
}

// Resolve a profile row id → its auth user_id (the user_ai_keys key).
async function resolveUserId(profileId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('user_id')
    .eq('id', profileId)
    .maybeSingle();
  return data?.user_id || null;
}

// PUT /api/users/:id/ai-key — assign/replace a user's Anthropic key (enables AI for them)
router.put('/:id/ai-key', authMiddleware, async (req, res) => {
  try {
    const { api_key } = req.body || {};
    const key = typeof api_key === 'string' ? api_key.trim() : '';

    if (!key) {
      return res.status(400).json({ error: 'api_key is required' });
    }
    if (!/^sk-ant-/.test(key)) {
      return res.status(400).json({ error: 'That does not look like an Anthropic API key — it should start with "sk-ant-".' });
    }

    const userId = await resolveUserId(req.params.id);
    if (!userId) {
      return res.status(404).json({ error: 'User not found' });
    }

    const check = await validateAnthropicKey(key);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    const { error } = await supabaseAdmin
      .from('user_ai_keys')
      .upsert({
        user_id: userId,
        claude_api_key: key,
        updated_by: req.user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Setting a key turns AI on for the user. Best-effort so it still works if
    // the `enabled` column has not been added yet (new rows default to true).
    await supabaseAdmin
      .from('user_ai_keys')
      .update({ enabled: true })
      .eq('user_id', userId)
      .then(() => {}, () => {});

    return res.json({ success: true, has_ai_key: true, ai_enabled: true, key_preview: keyPreview(key) });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save API key' });
  }
});

// PATCH /api/users/:id/ai-key/enabled — turn AI on/off WITHOUT touching the key
router.patch('/:id/ai-key/enabled', authMiddleware, async (req, res) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }

    const userId = await resolveUserId(req.params.id);
    if (!userId) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Can only toggle a user who actually has a key stored.
    const { data: existing } = await supabaseAdmin
      .from('user_ai_keys')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!existing) {
      return res.status(400).json({ error: 'Add an API key for this user before enabling AI.' });
    }

    const { error } = await supabaseAdmin
      .from('user_ai_keys')
      .update({ enabled, updated_by: req.user.id, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      // The enable/disable toggle needs the `enabled` column. If it hasn't been
      // added yet, say so plainly instead of leaking a raw Postgres error.
      if (/column .*enabled.* does not exist/i.test(error.message)) {
        return res.status(409).json({
          error: 'Enable/disable needs a one-time database update. Run backend/sql/user_ai_keys.sql (it adds the "enabled" column) and try again.',
        });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, has_ai_key: true, ai_enabled: enabled });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update AI access' });
  }
});

// DELETE /api/users/:id/ai-key — revoke a user's AI access
router.delete('/:id/ai-key', authMiddleware, async (req, res) => {
  try {
    const userId = await resolveUserId(req.params.id);
    if (!userId) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { error } = await supabaseAdmin
      .from('user_ai_keys')
      .delete()
      .eq('user_id', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, has_ai_key: false });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove API key' });
  }
});

// Synced-data tables in deletion order (child tables first to avoid FK violations)
const SYNCED_TABLES = [
  { table: 'platform_integration_invoice_line_items', label: 'Invoice line items' },
  { table: 'platform_integration_invoices', label: 'Invoices' },
  { table: 'treatment_plan_items', label: 'Treatment plan items' },
  { table: 'treatment_appointments', label: 'Treatment appointments' },
  { table: 'treatment_plans', label: 'Treatment plans' },
  { table: 'appointments', label: 'Appointments' },
  { table: 'patients', label: 'Patients' },
  { table: 'providers', label: 'Providers' },
  { table: 'treatments', label: 'Treatments' },
  { table: 'payment_plans', label: 'Payment plans' },
  { table: 'treatment_categories', label: 'Treatment categories' },
  { table: 'practice_locations', label: 'Practice locations' },
];

// DELETE /api/users/:id
// Deletes the user's synced records, related data, profile, and auth account
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const profileId = req.params.id;

    // 1. Fetch user profile to get user_id and organization_id
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, current_organization_id')
      .eq('id', profileId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { user_id, current_organization_id: orgId } = profile;

    // Guard: refuse to delete superadmin accounts
    const { data: isSuperadmin } = await supabaseAdmin
      .from('superadmins')
      .select('id')
      .eq('id', user_id)
      .maybeSingle();

    if (isSuperadmin) {
      return res.status(403).json({ error: 'Cannot delete a superadmin account' });
    }

    const deletionLog = [];

    // 2. Delete all synced records for the user's organization
    if (orgId) {
      for (const { table, label } of SYNCED_TABLES) {
        const { error } = await supabaseAdmin
          .from(table)
          .delete()
          .eq('organization_id', orgId);

        if (error) {
          deletionLog.push({ table, status: 'error', message: error.message });
        } else {
          deletionLog.push({ table, status: 'deleted' });
        }
      }

      // 3. Delete sync jobs for the organization
      const { error: syncJobsError } = await supabaseAdmin
        .from('sync_jobs')
        .delete()
        .eq('organization_id', orgId);

      if (syncJobsError) {
        deletionLog.push({ table: 'sync_jobs', status: 'error', message: syncJobsError.message });
      }

      // 4. Delete integration sync entities for the organization
      const { error: syncEntitiesError } = await supabaseAdmin
        .from('integration_sync_entities')
        .delete()
        .eq('organization_id', orgId);

      if (syncEntitiesError) {
        deletionLog.push({ table: 'integration_sync_entities', status: 'error', message: syncEntitiesError.message });
      }

      // 5. Delete integrations for the organization
      const { error: integrationsError } = await supabaseAdmin
        .from('integrations')
        .delete()
        .eq('organization_id', orgId);

      if (integrationsError) {
        deletionLog.push({ table: 'integrations', status: 'error', message: integrationsError.message });
      }

      // 5b. Delete iplicit data if connected
      // First get invoice IDs so we can delete line items (they link via invoice_id, not org_id)
      const { data: apInvoices } = await supabaseAdmin
        .from('accounts_payable_invoice')
        .select('id')
        .eq('organization_id', orgId);

      if (apInvoices && apInvoices.length > 0) {
        const invoiceIds = apInvoices.map(inv => inv.id);
        const { error: apLineItemsError } = await supabaseAdmin
          .from('accounts_payable_invoice_line_item')
          .delete()
          .in('invoice_id', invoiceIds);

        if (apLineItemsError) {
          deletionLog.push({ table: 'accounts_payable_invoice_line_item', status: 'error', message: apLineItemsError.message });
        } else {
          deletionLog.push({ table: 'accounts_payable_invoice_line_item', status: 'deleted' });
        }
      }

      const { error: apInvoicesError } = await supabaseAdmin
        .from('accounts_payable_invoice')
        .delete()
        .eq('organization_id', orgId);
      deletionLog.push({ table: 'accounts_payable_invoice', status: apInvoicesError ? 'error' : 'deleted', ...(apInvoicesError && { message: apInvoicesError.message }) });

      const { error: apRulesError } = await supabaseAdmin
        .from('accounts_payable_invoice_rules_mapping')
        .delete()
        .eq('organization_id', orgId);
      deletionLog.push({ table: 'accounts_payable_invoice_rules_mapping', status: apRulesError ? 'error' : 'deleted', ...(apRulesError && { message: apRulesError.message }) });

      const { error: platformOrgMapError } = await supabaseAdmin
        .from('platform_integration_organization_mapping')
        .delete()
        .eq('organization_id', orgId);
      deletionLog.push({ table: 'platform_integration_organization_mapping', status: platformOrgMapError ? 'error' : 'deleted', ...(platformOrgMapError && { message: platformOrgMapError.message }) });

      const { error: platformIntegrationsError } = await supabaseAdmin
        .from('platform_integrations')
        .delete()
        .eq('organization_id', orgId);
      deletionLog.push({ table: 'platform_integrations', status: platformIntegrationsError ? 'error' : 'deleted', ...(platformIntegrationsError && { message: platformIntegrationsError.message }) });

      // 5c. Delete iplicit_ prefixed tables
      const IPLICIT_TABLES = [
        'iplicit_account_balances',
        'iplicit_balance_sheet',
        'iplicit_bank_transactions',
        'iplicit_chart_of_accounts',
        'iplicit_coa_account_groups',
        'iplicit_gl_entries',
        'iplicit_invoices',
        'iplicit_profit_loss',
        'iplicit_sync_logs',
        'iplicit_transactions',
      ];

      for (const table of IPLICIT_TABLES) {
        const { error } = await supabaseAdmin
          .from(table)
          .delete()
          .eq('organization_id', orgId);
        deletionLog.push({ table, status: error ? 'error' : 'deleted', ...(error && { message: error.message }) });
      }
    }

    // 6. Delete user_roles + any assigned AI key for this user
    if (user_id) {
      const { error: rolesError } = await supabaseAdmin
        .from('user_roles')
        .delete()
        .eq('user_id', user_id);

      if (rolesError) {
        deletionLog.push({ table: 'user_roles', status: 'error', message: rolesError.message });
      }

      const { error: aiKeyError } = await supabaseAdmin
        .from('user_ai_keys')
        .delete()
        .eq('user_id', user_id);
      if (aiKeyError) {
        deletionLog.push({ table: 'user_ai_keys', status: 'error', message: aiKeyError.message });
      }
    }

    // 7. Delete superadmin record if exists
    if (user_id) {
      await supabaseAdmin
        .from('superadmins')
        .delete()
        .eq('id', user_id);
    }

    // 8. Delete profile
    const { error: deleteProfileError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', profileId);

    if (deleteProfileError) {
      return res.status(500).json({ error: deleteProfileError.message, deletionLog });
    }

    // 9. Delete auth user from Supabase Authentication
    if (user_id) {
      const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);

      if (authDeleteError) {
        // If the auth user doesn't exist (already removed or never existed), treat as success
        const errMsg = authDeleteError.message || JSON.stringify(authDeleteError);
        const alreadyGone = authDeleteError.status === 404 || errMsg === '{}' || errMsg === 'User not found';
        if (alreadyGone) {
          deletionLog.push({ table: 'auth.users', status: 'not_found', message: 'Auth user did not exist' });
        } else {
          deletionLog.push({ table: 'auth.users', status: 'error', message: errMsg });
          return res.status(500).json({
            error: `Profile deleted but failed to remove auth account: ${errMsg}`,
            deletionLog,
          });
        }
      } else {
        deletionLog.push({ table: 'auth.users', status: 'deleted' });
      }
    }

    // 10. Delete the organization record itself
    if (orgId) {
      const { error: orgDeleteError } = await supabaseAdmin
        .from('organizations')
        .delete()
        .eq('id', orgId);

      if (orgDeleteError) {
        deletionLog.push({ table: 'organizations', status: 'error', message: orgDeleteError.message });
      } else {
        deletionLog.push({ table: 'organizations', status: 'deleted' });
      }
    }

    return res.json({ message: 'User and all associated data deleted successfully', deletionLog });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
