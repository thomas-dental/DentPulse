/**
 * Onboarding route for Dentally integration.
 *
 * POST /api/onboard/dentally
 *   Body: { api_key, api_endpoint?, start_date?, end_date? }
 *   start_date/end_date (YYYY-MM-DD) scope the initial sync window for
 *   date-chunked entities (appointments, invoices, treatment plans, treatment
 *   plan items, NHS claims, payments). Reference data (locations, treatments,
 *   practitioners, etc.) and patients always sync in full regardless, since
 *   patients are looked up by date-scoped entities. Omit both to fall back to
 *   the default 365-day window (see triggerSyncForIntegration).
 *
 * Does everything the frontend onboarding used to do:
 *   1. Validate the API key (GET /v1/user)
 *   2. Fetch all Dentally sites (GET /v1/sites)
 *   3. Sort sites by start_date, pick the oldest site's name for the org
 *   4. Create ONE organization
 *   5. Create user_role (owner)
 *   6. Create N locations (one per site, oldest = is_primary)
 *   7. Create ONE integration record with the API key
 *   8. Initialize sync entities for the integration
 *   9. Trigger sync on the single organization
 *
 * Returns: { success, defaultOrgId, organizations: [singleOrg], jobCount }
 */

const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const syncAuthMiddleware = require('../middleware/syncAuth');
const authMiddleware = require('../middleware/auth');
const { triggerSync, iplicit: iplicitQueue } = require('../queue');
const { createSession: createIplicitSession } = require('../api/iplicit/client');

const router = express.Router();

// Default sync entities (mirrors frontend dentallyConfig.ts)
const DEFAULT_SYNC_ENTITIES = [
  { alias: 'locations',              label: 'Locations',              description: 'Sync practice sites/locations from Dentally',     is_sync: true, is_available: true },
  { alias: 'treatment_category',     label: 'Treatment Categories',   description: 'Sync treatment categories from Dentally',         is_sync: true, is_available: true },
  { alias: 'payment_plans',          label: 'Payment Plans',          description: 'Sync payment plans from Dentally',                is_sync: true, is_available: true },
  { alias: 'appointment_cancellation_reasons', label: 'Cancellation Reasons', description: 'Sync appointment cancellation reasons from Dentally', is_sync: true, is_available: true },
  { alias: 'treatments',             label: 'Treatments',             description: 'Sync treatment codes from Dentally',              is_sync: true, is_available: true },
  { alias: 'practitioners',          label: 'Practitioners',          description: 'Sync dentists, hygienists, and therapists',       is_sync: true, is_available: true },
  { alias: 'patients',               label: 'Patients',               description: 'Sync patient records from Dentally',              is_sync: true, is_available: true },
  { alias: 'treatment_plans',        label: 'Treatment Plans',        description: 'Sync treatment plans from Dentally',              is_sync: true, is_available: true },
  { alias: 'treatment_plan_items',   label: 'Treatment Plan Items',   description: 'Sync treatment plan items from Dentally',         is_sync: true, is_available: true },
  { alias: 'treatment_appointments', label: 'Treatment Appointments', description: 'Sync treatment appointments from Dentally',       is_sync: true, is_available: true },
  { alias: 'appointments',           label: 'Appointments',           description: 'Sync appointment records from Dentally',          is_sync: true, is_available: true },
  { alias: 'invoices',               label: 'Invoices',               description: 'Sync invoices and billing data from Dentally',    is_sync: true, is_available: true },
  { alias: 'nhs_claims',             label: 'NHS Claims',             description: 'Sync NHS claim records from Dentally',            is_sync: true, is_available: true },
  { alias: 'payments',               label: 'Payments',               description: 'Sync payment transactions from Dentally',         is_sync: false, is_available: false },
  { alias: 'accounts',               label: 'Accounts',               description: 'Sync chart of accounts from Dentally',            is_sync: false, is_available: false },
  { alias: 'users',                  label: 'Users',                  description: 'Sync staff and user accounts from Dentally',      is_sync: false, is_available: false },
];

/**
 * Call Dentally API from the backend (no browser CORS issues).
 */
async function callDentallyApi(apiKey, apiEndpoint, path) {
  const url = `${apiEndpoint}${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DentPulse/1.0',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Dentally API ${response.status}: ${text}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }

  return response.json();
}

// POST /api/onboard/dentally
router.post('/dentally', syncAuthMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email || null;
    const { api_key, api_endpoint, start_date, end_date } = req.body;
    const baseEndpoint = api_endpoint || 'https://api.dentally.co';

    if (!api_key || !api_key.trim()) {
      return res.status(400).json({ error: 'api_key is required' });
    }

    // ── 1. Validate API key ────────────────────────────────────────────────────
    console.log('[Onboard] Validating Dentally API key...');
    let userData;
    const MAX_VALIDATE_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_VALIDATE_RETRIES; attempt++) {
      try {
        userData = await callDentallyApi(api_key, baseEndpoint, '/v1/user');
        break; // success
      } catch (err) {
        const isRateLimit = err.status === 403
          && err.body
          && (err.body.includes('Rate limit') || err.body.includes('rate_limit'));

        if (isRateLimit && attempt < MAX_VALIDATE_RETRIES - 1) {
          console.log(`[Onboard] Rate limited on /v1/user, retrying in 15s (attempt ${attempt + 1})...`);
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }

        if (err.status === 401 || (err.status === 403 && !isRateLimit)) {
          console.error(`[Onboard] API key invalid (${err.status}): ${err.body || err.message}`);
          return res.status(401).json({ error: 'Invalid Dentally API key' });
        }

        if (isRateLimit) {
          console.error('[Onboard] Rate limit persisted after retries');
          return res.status(429).json({ error: 'Dentally API rate limit — please try again in a minute' });
        }

        throw err;
      }
    }

    if (!userData?.user) {
      return res.status(401).json({ error: 'Invalid Dentally API key' });
    }
    console.log('[Onboard] API key valid');

    // ── 2. Fetch all Dentally sites ────────────────────────────────────────────
    console.log('[Onboard] Fetching sites...');
    const sitesData = await callDentallyApi(api_key, baseEndpoint, '/v1/sites');
    const sites = sitesData?.sites || [];

    if (sites.length === 0) {
      return res.status(400).json({ error: 'No Dentally sites found for this API key' });
    }
    console.log(`[Onboard] Found ${sites.length} site(s)`);

    // ── 3. Sort sites by start_date, pick oldest for org name ─────────────────
    const sortedSites = [...sites].sort((a, b) => {
      const dateA = a.start_date ? new Date(a.start_date) : new Date('9999-12-31');
      const dateB = b.start_date ? new Date(b.start_date) : new Date('9999-12-31');
      return dateA - dateB;
    });
    const oldestSite = sortedSites[0];
    const orgName = oldestSite.name || 'My Practice';
    const orgAddress = [oldestSite.address_line_1, oldestSite.address_line_2, oldestSite.town, oldestSite.county, oldestSite.postcode]
      .filter(Boolean).join(', ');

    console.log(`[Onboard] Oldest site: "${orgName}" (start_date: ${oldestSite.start_date || 'N/A'})`);

    // ── 4. Create ONE organization ─────────────────────────────────────────────
    let orgId;
    const { data: existingOrg } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingOrg) {
      orgId = existingOrg.id;
      console.log(`[Onboard] Org exists: ${existingOrg.name} (${orgId})`);
    } else {
      const { data: newOrg, error: orgErr } = await supabaseAdmin
        .from('organizations')
        .insert({
          name: orgName,
          email: oldestSite.email_address || userEmail,
          phone: oldestSite.phone_number || null,
          address: orgAddress || null,
          logo_url: oldestSite.logo_url || null,
          created_by: userId,
          user_id: userId,
        })
        .select('id, name')
        .single();

      if (orgErr) {
        console.error(`[Onboard] Failed to create org:`, orgErr.message);
        return res.status(500).json({ error: 'Failed to create organization' });
      }
      orgId = newOrg.id;
      console.log(`[Onboard] Created org: ${newOrg.name} (${orgId})`);
    }

    // ── 5. Create user_role (owner) if not exists ──────────────────────────────
    const { data: existingRole } = await supabaseAdmin
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!existingRole) {
      const { error: roleErr } = await supabaseAdmin
        .from('user_roles')
        .insert({ user_id: userId, organization_id: orgId, role: 'owner' });
      if (roleErr) console.error(`[Onboard] Failed to create role:`, roleErr.message);
      else console.log(`[Onboard] Created user_role (owner)`);
    }

    // ── 6. Create N locations (one per site, oldest = is_primary) ──────────────
    for (let i = 0; i < sortedSites.length; i++) {
      const site = sortedSites[i];
      const siteName = site.name || `Site ${i + 1}`;
      const isPrimary = i === 0; // oldest site is primary

      console.log(`[Onboard] [${i + 1}/${sortedSites.length}] Processing location: ${siteName}${isPrimary ? ' (primary)' : ''}`);

      const { data: existingLoc } = await supabaseAdmin
        .from('practice_locations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('api_record_unique_id', site.id)
        .maybeSingle();

      if (!existingLoc) {
        const { error: locErr } = await supabaseAdmin
          .from('practice_locations')
          .insert({
            organization_id: orgId,
            user_id: userId,
            location_name: siteName,
            address_line1: site.address_line_1 || null,
            address_line2: site.address_line_2 || null,
            city: site.town || null,
            state: site.county || null,
            postal_code: site.postcode || null,
            phone: site.phone_number || null,
            email: site.email_address || userEmail,
            is_primary: isPrimary,
            created_by: userId,
            api_record_unique_id: site.id,
          });
        if (locErr) console.error(`[Onboard]   Failed to create location:`, locErr.message);
        else console.log(`[Onboard]   Created location: ${siteName}`);
      } else {
        console.log(`[Onboard]   Location exists: ${siteName}`);
      }
    }

    // ── 7. Create ONE integration and set API key ──────────────────────────────
    let integrationId;
    const { data: existingInt } = await supabaseAdmin
      .from('integrations')
      .select('id')
      .eq('organization_id', orgId)
      .ilike('integration_name', 'dentally')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (existingInt) {
      integrationId = existingInt.id;
      console.log(`[Onboard] Integration exists (${integrationId})`);
    } else {
      const { data: newInt, error: intErr } = await supabaseAdmin
        .from('integrations')
        .insert({
          organization_id: orgId,
          user_id: userId,
          created_by: userId,
          integration_name: 'Dentally',
          integration_description: 'Cloud-based dental practice management software',
          is_connected: false,
          api_endpoints: baseEndpoint,
          api_key: null,
          sync_frequency: '15min',
        })
        .select('id')
        .single();

      if (intErr) {
        console.error(`[Onboard] Failed to create integration:`, intErr.message);
        return res.status(500).json({ error: 'Failed to create integration' });
      }
      integrationId = newInt.id;
      console.log(`[Onboard] Created integration (${integrationId})`);
    }

    // Set API key on the integration
    await supabaseAdmin
      .from('integrations')
      .update({
        api_key: api_key,
        api_endpoints: baseEndpoint,
        is_connected: true,
        user_id: userId,
      })
      .eq('id', integrationId);

    console.log(`[Onboard] Set API key on integration`);

    // ── 8. Initialize sync entities ────────────────────────────────────────────
    const { data: existingEntities } = await supabaseAdmin
      .from('integration_sync_entities')
      .select('id')
      .eq('integration_id', integrationId)
      .limit(1);

    if (!existingEntities || existingEntities.length === 0) {
      const entityRows = DEFAULT_SYNC_ENTITIES.map(e => ({
        integration_id: integrationId,
        entity_alias: e.alias,
        entity_label: e.label,
        entity_description: e.description,
        is_sync: e.is_sync,
        is_available: e.is_available,
        last_synced_at: null,
      }));

      const { error: entityErr } = await supabaseAdmin
        .from('integration_sync_entities')
        .insert(entityRows);

      if (entityErr) console.error(`[Onboard] Failed to create sync entities:`, entityErr.message);
      else console.log(`[Onboard] Initialized sync entities`);
    } else {
      // Add any missing entities from config (e.g. newly added entity types)
      const { data: allExisting } = await supabaseAdmin
        .from('integration_sync_entities')
        .select('entity_alias')
        .eq('integration_id', integrationId);
      const existingAliases = new Set((allExisting || []).map(e => e.entity_alias));
      const missingRows = DEFAULT_SYNC_ENTITIES
        .filter(e => !existingAliases.has(e.alias))
        .map(e => ({
          integration_id: integrationId,
          entity_alias: e.alias,
          entity_label: e.label,
          entity_description: e.description,
          is_sync: e.is_sync,
          is_available: e.is_available,
          last_synced_at: null,
        }));
      if (missingRows.length > 0) {
        const { error: missErr } = await supabaseAdmin
          .from('integration_sync_entities')
          .insert(missingRows);
        if (missErr) console.error(`[Onboard] Failed to add missing sync entities:`, missErr.message);
        else console.log(`[Onboard] Added ${missingRows.length} new sync entities:`, missingRows.map(e => e.entity_alias).join(', '));
      }
    }

    // ── 9. Trigger sync ────────────────────────────────────────────────────────
    let totalJobCount = 0;
    const enabledAliases = DEFAULT_SYNC_ENTITIES
      .filter(e => e.is_sync && e.is_available)
      .map(e => e.alias);

    const syncOptions = { entities: enabledAliases };
    if (start_date && end_date) {
      syncOptions.startDate = start_date;
      syncOptions.endDate = end_date;
      console.log(`[Onboard] Using requested sync date range: ${start_date} to ${end_date}`);
    }

    try {
      const result = await triggerSync(orgId, null, userId, false, syncOptions);
      totalJobCount = result.jobCount;
      console.log(`[Onboard] Triggered sync: ${result.jobCount} jobs`);
    } catch (err) {
      console.error(`[Onboard] Sync trigger failed (non-fatal):`, err.message);
    }

    // ── 10. Update user profile with org as default view ───────────────────────
    await supabaseAdmin
      .from('profiles')
      .update({ current_organization_id: orgId })
      .eq('id', userId);

    console.log(`[Onboard] Done. 1 org, ${sortedSites.length} locations, ${totalJobCount} sync jobs`);

    return res.json({
      success: true,
      defaultOrgId: orgId,
      organizations: [{ id: orgId, name: orgName }],
      jobCount: totalJobCount,
    });
  } catch (err) {
    console.error('[Onboard] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/onboard/dentally/add-account/:orgId
 *
 * Connect an ADDITIONAL Dentally account (a second/third practice with its own
 * API key) to an EXISTING organization. Unlike POST /dentally — which is the
 * first-time onboarding flow that reuses the org's single Dentally integration —
 * this ALWAYS creates a NEW `integrations` row. Because the sync queue lanes are
 * keyed by `orgId:integrationId`, the new account syncs IN PARALLEL with the
 * org's existing Dentally account(s); nothing extra is needed to parallelise.
 *
 * Superadmin-only (SuperAdmin Panel). Body: { api_key, api_endpoint?, label? }
 *
 * Steps:
 *   1. Verify the org exists; resolve its owner for record ownership.
 *   2. Validate the API key (GET /v1/user) — reject duplicates of an already
 *      connected key for this org.
 *   3. Fetch the account's sites and create any missing practice_locations.
 *   4. Create a NEW connected integration row.
 *   5. Seed its sync entities.
 *   6. Trigger a sync scoped to JUST this integration (its own parallel lane).
 *
 * Returns: { success, integrationId, sitesFound, locationsCreated, jobCount }
 */
router.post('/dentally/add-account/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { api_key, api_endpoint, label } = req.body || {};
    const baseEndpoint = api_endpoint || 'https://api.dentally.co';

    if (!api_key || !api_key.trim()) {
      return res.status(400).json({ error: 'api_key is required' });
    }
    const apiKey = api_key.trim();

    // ── 1. Verify org + resolve owner (synced records get a real user_id) ──────
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('id, user_id')
      .eq('id', orgId)
      .maybeSingle();
    if (orgErr || !org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    const ownerUserId = org.user_id || req.user.id;

    // ── 2. Duplicate guard: same key already connected to this org? ────────────
    const { data: existingDentally } = await supabaseAdmin
      .from('integrations')
      .select('id, api_key')
      .eq('organization_id', orgId)
      .ilike('integration_name', 'dentally')
      .is('deleted_at', null);

    if ((existingDentally || []).some(i => i.api_key === apiKey)) {
      return res.status(409).json({ error: 'This Dentally account is already connected to the organization.' });
    }

    // ── 3. Validate the API key (retry once on Dentally rate limit) ────────────
    console.log(`[Onboard] add-account: validating Dentally API key for org ${orgId}...`);
    let userData;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        userData = await callDentallyApi(apiKey, baseEndpoint, '/v1/user');
        break;
      } catch (err) {
        const isRateLimit = err.status === 403 && err.body
          && (err.body.includes('Rate limit') || err.body.includes('rate_limit'));
        if (isRateLimit && attempt === 0) {
          console.log('[Onboard] add-account: rate limited on /v1/user, retrying in 15s...');
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }
        if (err.status === 401 || (err.status === 403 && !isRateLimit)) {
          return res.status(401).json({ error: 'Invalid Dentally API key' });
        }
        if (isRateLimit) {
          return res.status(429).json({ error: 'Dentally API rate limit — please try again in a minute' });
        }
        throw err;
      }
    }
    if (!userData?.user) {
      return res.status(401).json({ error: 'Invalid Dentally API key' });
    }

    // ── 4. Fetch sites + create any missing locations ──────────────────────────
    const sitesData = await callDentallyApi(apiKey, baseEndpoint, '/v1/sites');
    const sites = sitesData?.sites || [];
    if (sites.length === 0) {
      return res.status(400).json({ error: 'No Dentally sites found for this API key' });
    }

    // Only claim "primary" if the org has none yet (don't steal it from the
    // already-connected account).
    const { data: primaryLoc } = await supabaseAdmin
      .from('practice_locations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_primary', true)
      .limit(1)
      .maybeSingle();
    let orgHasPrimary = !!primaryLoc;

    let locationsCreated = 0;
    for (const site of sites) {
      const { data: existingLoc } = await supabaseAdmin
        .from('practice_locations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('api_record_unique_id', site.id)
        .maybeSingle();
      if (existingLoc) continue;

      const makePrimary = !orgHasPrimary;
      if (makePrimary) orgHasPrimary = true;

      const { error: locErr } = await supabaseAdmin
        .from('practice_locations')
        .insert({
          organization_id: orgId,
          user_id: ownerUserId,
          location_name: site.name || `Site ${site.id}`,
          address_line1: site.address_line_1 || null,
          address_line2: site.address_line_2 || null,
          city: site.town || null,
          state: site.county || null,
          postal_code: site.postcode || null,
          phone: site.phone_number || null,
          email: site.email_address || null,
          is_primary: makePrimary,
          created_by: ownerUserId,
          api_record_unique_id: site.id,
        });
      if (locErr) console.error('[Onboard] add-account: failed to create location:', locErr.message);
      else locationsCreated++;
    }

    // ── 5. Create the NEW integration row ──────────────────────────────────────
    const { data: newInt, error: intErr } = await supabaseAdmin
      .from('integrations')
      .insert({
        organization_id: orgId,
        user_id: ownerUserId,
        created_by: ownerUserId,
        integration_name: 'Dentally',
        integration_description: (label && label.trim()) || 'Cloud-based dental practice management software',
        is_connected: true,
        api_endpoints: baseEndpoint,
        api_key: apiKey,
        sync_frequency: '15min',
      })
      .select('id')
      .single();
    if (intErr || !newInt) {
      console.error('[Onboard] add-account: failed to create integration:', intErr?.message);
      return res.status(500).json({ error: 'Failed to create integration' });
    }
    const integrationId = newInt.id;
    console.log(`[Onboard] add-account: created integration ${integrationId} for org ${orgId}`);

    // ── 6. Seed sync entities for the new integration ──────────────────────────
    const entityRows = DEFAULT_SYNC_ENTITIES.map(e => ({
      integration_id: integrationId,
      entity_alias: e.alias,
      entity_label: e.label,
      entity_description: e.description,
      is_sync: e.is_sync,
      is_available: e.is_available,
      last_synced_at: null,
    }));
    const { error: entityErr } = await supabaseAdmin
      .from('integration_sync_entities')
      .insert(entityRows);
    if (entityErr) console.error('[Onboard] add-account: failed to seed sync entities:', entityErr.message);

    // ── 7. Trigger sync for JUST this integration (parallel lane) ──────────────
    let jobCount = 0;
    const enabledAliases = DEFAULT_SYNC_ENTITIES
      .filter(e => e.is_sync && e.is_available)
      .map(e => e.alias);
    try {
      const result = await triggerSync(orgId, null, ownerUserId, false, {
        integrationId,
        entities: enabledAliases,
      });
      jobCount = result.jobCount;
      console.log(`[Onboard] add-account: triggered ${jobCount} sync jobs for integration ${integrationId}`);
    } catch (err) {
      console.error('[Onboard] add-account: sync trigger failed (non-fatal):', err.message);
    }

    return res.json({
      success: true,
      integrationId,
      sitesFound: sites.length,
      locationsCreated,
      jobCount,
    });
  } catch (err) {
    console.error('[Onboard] add-account error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/onboard/iplicit
 * Connect iplicit accounting software during onboarding.
 * Body: { organizationId, domain, username, apiKey }
 * 1. Validate credentials against iplicit API
 * 2. Upsert platform_integrations (is_connected = true)
 * 3. Trigger iplicit sync in background
 */
router.post('/iplicit', syncAuthMiddleware, async (req, res) => {
  try {
    const { organizationId, domain, username, apiKey } = req.body;
    const userId = req.user?.id || null;

    if (!organizationId || !domain || !username || !apiKey) {
      return res.status(400).json({ error: 'organizationId, domain, username and apiKey are required' });
    }

    // 1. Validate credentials
    console.log(`[Onboard/Iplicit] Validating credentials for domain: ${domain}`);
    let sessionResult;
    try {
      sessionResult = await createIplicitSession(domain, username, apiKey);
    } catch (err) {
      return res.status(400).json({ error: `Invalid iplicit credentials: ${err.message}` });
    }

    // 2. Upsert platform_integrations
    const { data: existing } = await supabaseAdmin
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform_name', 'iplicit')
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin
        .from('platform_integrations')
        .update({
          client_id: domain,
          username,
          client_secret: apiKey,
          access_token: sessionResult.sessionToken,
          token_expires_at: sessionResult.tokenDue,
          is_connected: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin
        .from('platform_integrations')
        .insert({
          organization_id: organizationId,
          user_id: userId,
          platform_name: 'iplicit',
          client_id: domain,
          username,
          client_secret: apiKey,
          access_token: sessionResult.sessionToken,
          token_expires_at: sessionResult.tokenDue,
          is_connected: true,
        });
      if (error) throw error;
    }

    // 3. Trigger sync in background (non-fatal)
    let jobCount = 0;
    try {
      const result = await iplicitQueue.triggerSync(organizationId, null, userId, false);
      jobCount = result.jobCount;
      console.log(`[Onboard/Iplicit] Triggered sync: ${jobCount} jobs`);
    } catch (err) {
      console.error('[Onboard/Iplicit] Sync trigger failed (non-fatal):', err.message);
    }

    return res.json({ success: true, jobCount });
  } catch (err) {
    console.error('[Onboard/Iplicit] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
