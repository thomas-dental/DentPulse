/**
 * Sage Business Cloud Accounting OAuth routes.
 * Base path: /api/sage
 *
 * Phase 1 — OAuth handshake only. No data sync yet.
 *
 *   GET /connect?org_id=<uuid>      Redirect user to Sage authorize page
 *   GET /callback?code=&state=      Exchange code, save tokens, show result
 *   GET /status?org_id=<uuid>       Check connection status
 */

const express = require('express');
const crypto  = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const syncAuthMiddleware = require('../middleware/syncAuth');
const sageClient = require('../api/sage/client');
const { syncAllSuppliers }            = require('../services/sage/supplierService');
const { syncAllCoaAccounts }          = require('../services/sage/coaService');
const { syncAllPurchaseInvoices }     = require('../services/sage/invoiceService');
const { syncAllContactPersons }       = require('../services/sage/contactPersonService');
const { syncAllBankAccounts }         = require('../services/sage/bankAccountService');
const { syncAllBankTransactions }     = require('../services/sage/bankTransactionService');
const { syncAllTaxRates }             = require('../services/sage/taxRateService');
const { syncAllPurchaseCreditNotes }  = require('../services/sage/creditNoteService');
const { syncAllJournals }             = require('../services/sage/journalService');
const { syncAllPaymentMethods }       = require('../services/sage/paymentMethodService');
const { syncAllProducts }             = require('../services/sage/productService');
const { syncAllOtherPayments }        = require('../services/sage/otherPaymentService');
const { syncAllOtherReceipts }        = require('../services/sage/otherReceiptService');
const { syncAllBankTransfers }        = require('../services/sage/bankTransferService');
const { syncAllAttachments }          = require('../services/sage/attachmentService');
const { runSageToCanonical }          = require('../services/normalizers/sageToCanonical');

const router = express.Router();

// In-memory state store for CSRF protection.
// Keyed by `state`, value: { organizationId, userId, createdAt }.
// 10-minute TTL — entries are pruned lazily on access.
const STATE_TTL_MS = 10 * 60 * 1000;
const oauthStates = new Map();

function pruneExpiredStates() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [k, v] of oauthStates.entries()) {
    if (v.createdAt < cutoff) oauthStates.delete(k);
  }
}

function isUuid(v) {
  return typeof v === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Validate redirect_to is a safe URL — allows localhost dev origins and anything
// in CORS_ALLOWED_ORIGINS. Prevents open-redirect attacks.
function isAllowedRedirect(url) {
  if (typeof url !== 'string' || !url) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  const allowed = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);
  return allowed.includes(origin);
}

function appendQuery(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

// ── GET /api/sage/connect ─────────────────────────────────────────────────────
// Initiates OAuth — redirects user to Sage authorize page.
router.get('/connect', async (req, res) => {
  try {
    const orgId  = req.query.org_id;
    const userId = req.query.user_id || null;
    // Reconnect intent: existing platform_integrations.id to update on callback
    // (omitted for a brand-new connection — Xero/QB multi-connection parity).
    const integrationId = req.query.integration_id || null;
    const rawRedirect = req.query.redirect_to;
    const redirectTo  = (rawRedirect && isAllowedRedirect(rawRedirect)) ? String(rawRedirect) : null;

    if (!orgId || !isUuid(orgId)) {
      return res.status(400).json({ error: 'org_id (UUID) query parameter is required' });
    }

    // Verify the organization exists
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .maybeSingle();
    if (orgErr) {
      return res.status(500).json({ error: `DB lookup failed: ${orgErr.message}` });
    }
    if (!org) {
      return res.status(404).json({ error: `Organization not found: ${orgId}` });
    }

    pruneExpiredStates();
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, {
      organizationId: orgId,
      userId,
      integrationId,
      redirectTo,
      createdAt:      Date.now(),
    });

    const authUrl = sageClient.buildAuthUrl(state);
    console.log(`[SageRoute] Initiating OAuth for org ${orgId} (${org.name})${redirectTo ? ` — will return to ${redirectTo}` : ''}`);
    return res.redirect(302, authUrl);
  } catch (err) {
    console.error('[SageRoute] /connect error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sage/callback ────────────────────────────────────────────────────
// Sage redirects here with ?code=...&state=... after user grants access.
router.get('/callback', async (req, res) => {
  // State entry holds the original redirect_to from /connect — read up front so
  // error paths can also redirect when possible.
  let stateEntry = null;
  try {
    const { code, state, error: sageError, error_description } = req.query;

    if (state) {
      pruneExpiredStates();
      stateEntry = oauthStates.get(state) || null;
    }

    // Helper: send error to frontend if redirect_to known, else HTML fallback.
    const sendError = (statusCode, title, message) => {
      if (stateEntry?.redirectTo) {
        const url = appendQuery(stateEntry.redirectTo, {
          sage_connected: 'false',
          sage_error:     message.substring(0, 300),
        });
        return res.redirect(302, url);
      }
      return res.status(statusCode).send(renderResultHtml({ ok: false, title, message }));
    };

    if (sageError) {
      console.warn('[SageRoute] OAuth denied/error:', sageError, error_description);
      const msg = `${sageError}: ${error_description || 'no description'}`;
      // State entry already consumed if found — but only after token success do we delete it
      return sendError(400, 'Sage authorization denied', msg);
    }

    if (!code || !state) {
      return sendError(400, 'Missing OAuth parameters', 'Sage did not return both code and state. Try again.');
    }

    if (!stateEntry) {
      return sendError(400, 'Invalid or expired state', 'CSRF state token did not match. Restart the flow from /api/sage/connect.');
    }
    oauthStates.delete(state);

    const { organizationId, userId, redirectTo } = stateEntry;
    let integrationId = stateEntry.integrationId || null;

    // Exchange code for tokens
    const tokens = await sageClient.exchangeCodeForTokens(code);
    console.log(`[SageRoute] Token exchange succeeded for org ${organizationId}`);

    // Dedup (Xero parity): if this is a FRESH connect (no reconnect target) but
    // the authorized login already owns a business that's saved under another
    // Sage integration for this org, reuse that row instead of creating a
    // duplicate connection for the same login.
    if (!integrationId) {
      try {
        const businesses = await sageClient.fetchBusinessesWithTokens(tokens);
        const businessIds = (businesses || []).map(b => String(b.id)).filter(Boolean);
        if (businessIds.length) {
          const { data: dupRows } = await supabaseAdmin
            .from('platform_integration_organizations')
            .select('platform_integration_id')
            .eq('organization_id', organizationId)
            .eq('platform_name', 'sage')
            .in('platform_org_id', businessIds)
            .limit(1);
          if (dupRows && dupRows.length) {
            integrationId = dupRows[0].platform_integration_id;
            console.log(`[SageRoute] Dedup: same Sage login already connected — reusing integration ${integrationId}`);
          }
        }
      } catch (dupErr) {
        console.warn('[SageRoute] Dedup check skipped:', dupErr.message);
      }
    }

    // Persist — reconnect/dedup updates the matched row; else inserts a new one.
    const integration = await sageClient.saveTokens(organizationId, userId, tokens, integrationId);
    console.log(`[SageRoute] Saved integration row ${integration.id}${integrationId ? ' (updated existing)' : ' (new connection)'}`);

    // Fetch + save Sage tenant (business) into platform_integration_organizations
    // so it appears in the Practice Location Mapping UI. Non-fatal if it fails —
    // OAuth itself is already successful at this point.
    try {
      const tenantResult = await sageClient.saveSageTenant(integration);
      if (!tenantResult.ok) {
        console.warn(`[SageRoute] saveSageTenant did not succeed: ${tenantResult.reason}`);
      }
    } catch (tenantErr) {
      console.error('[SageRoute] saveSageTenant threw:', tenantErr.message);
    }

    // If frontend requested a return URL, redirect there with success flag.
    if (redirectTo) {
      const url = appendQuery(redirectTo, {
        sage_connected:   'true',
        integration_id:   integration.id,
        token_expires_at: integration.token_expires_at,
      });
      return res.redirect(302, url);
    }

    return res.send(renderResultHtml({
      ok:      true,
      title:   'Sage connected successfully',
      message: `Organization ${organizationId} is now connected to Sage Business Cloud Accounting.`,
      details: {
        integration_id:   integration.id,
        token_expires_at: integration.token_expires_at,
        is_connected:     integration.is_connected,
      },
    }));
  } catch (err) {
    console.error('[SageRoute] /callback error:', err.message);
    if (stateEntry?.redirectTo) {
      const url = appendQuery(stateEntry.redirectTo, {
        sage_connected: 'false',
        sage_error:     String(err.message || 'callback failed').substring(0, 300),
      });
      return res.redirect(302, url);
    }
    return res.status(500).send(renderResultHtml({
      ok:      false,
      title:   'Sage callback failed',
      message: err.message,
    }));
  }
});

// ── POST /api/sage/disconnect ─────────────────────────────────────────────────
// Marks the Sage integration as disconnected for the given org and clears tokens.
router.post('/disconnect', syncAuthMiddleware, async (req, res) => {
  try {
    const orgId = (req.body && req.body.org_id) || req.query.org_id;
    // Multi-connection: target a specific connection. If omitted, disconnect all
    // Sage connections for the org (back-compat with the single-connection era).
    const integrationId = (req.body && req.body.integration_id) || req.query.integration_id || null;
    if (!orgId || !isUuid(orgId)) {
      return res.status(400).json({ error: 'org_id (UUID) is required in body or query' });
    }

    let lookupQuery = supabaseAdmin
      .from('platform_integrations')
      .select('id, is_connected')
      .eq('organization_id', orgId)
      .eq('platform_name', 'sage');
    if (integrationId) lookupQuery = lookupQuery.eq('id', integrationId);

    const { data: existingRows, error: lookupError } = await lookupQuery;
    if (lookupError) {
      return res.status(500).json({ error: `DB lookup failed: ${lookupError.message}` });
    }
    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ error: 'No Sage integration found for this organization' });
    }

    const targetIds = existingRows.map(r => r.id);
    const { error: updateError } = await supabaseAdmin
      .from('platform_integrations')
      .update({
        access_token:     null,
        refresh_token:    null,
        token_expires_at: null,
        is_connected:     false,
        updated_at:       new Date().toISOString(),
      })
      .in('id', targetIds);

    if (updateError) {
      return res.status(500).json({ error: `Failed to disconnect: ${updateError.message}` });
    }

    console.log(`[SageRoute] Disconnected Sage for org ${orgId} (${targetIds.length} connection(s))`);
    return res.json({ success: true, integration_ids: targetIds });
  } catch (err) {
    console.error('[SageRoute] /disconnect error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sage/status ──────────────────────────────────────────────────────
// Returns the connection status for a given org.
router.get('/status', syncAuthMiddleware, async (req, res) => {
  try {
    const orgId = req.query.org_id;
    if (!orgId || !isUuid(orgId)) {
      return res.status(400).json({ error: 'org_id (UUID) query parameter is required' });
    }

    // Multi-connection: an org may have several Sage rows — fetch them all
    // (maybeSingle would throw once a second connection exists).
    const { data: rows, error } = await supabaseAdmin
      .from('platform_integrations')
      .select('id, organization_id, user_id, platform_name, access_token, refresh_token, is_connected, token_expires_at, last_synced_at, created_at, updated_at')
      .eq('organization_id', orgId)
      .eq('platform_name', 'sage')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!rows || rows.length === 0) {
      return res.json({ connected: false, integration: null, integrations: [] });
    }

    // Auto-backfill: for each CONNECTED row missing its business/tenant rows in
    // platform_integration_organizations, fetch + save them now. Recovers
    // connections that completed OAuth before saveSageTenant was wired.
    for (const row of rows.filter(r => r.is_connected)) {
      try {
        const { data: existingTenant, error: tenantLookupErr } = await supabaseAdmin
          .from('platform_integration_organizations')
          .select('id')
          .eq('platform_integration_id', row.id)
          .eq('platform_name', 'sage')
          .limit(1);

        if (!tenantLookupErr && (!existingTenant || existingTenant.length === 0)) {
          console.log(`[SageRoute] /status: backfilling missing Sage tenant for integration ${row.id}`);
          const integrationWithUser = { ...row, user_id: row.user_id || req.user?.id || null };
          const result = await sageClient.saveSageTenant(integrationWithUser);
          if (!result.ok) {
            console.warn(`[SageRoute] /status: tenant backfill skipped — ${result.reason}`);
          }
        }
      } catch (backfillErr) {
        console.error('[SageRoute] /status: tenant backfill threw:', backfillErr.message);
      }
    }

    const toPublic = (r) => ({
      id:               r.id,
      platform_name:    r.platform_name,
      is_connected:     r.is_connected,
      token_expires_at: r.token_expires_at,
      last_synced_at:   r.last_synced_at,
      created_at:       r.created_at,
      updated_at:       r.updated_at,
    });
    const connectedRows = rows.filter(r => r.is_connected);

    return res.json({
      // `connected` + `integration` kept for back-compat (first connected row).
      connected:    connectedRows.length > 0,
      integration:  toPublic(connectedRows[0] || rows[0]),
      // Full list for multi-connection UIs.
      integrations: rows.map(toPublic),
    });
  } catch (err) {
    console.error('[SageRoute] /status error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sage/test/:orgId/:entity ─────────────────────────────────────────
// DEV-ONLY Phase A: Raw API exploration. Calls Sage API and returns the JSON
// untouched. No DB writes, no normalization. Use to verify OAuth + token refresh
// + response structure before building the real sync pipeline.
//
// Supported entities:
//   suppliers → /contacts (all contacts; tenant has only suppliers in test data)
//   invoices  → /purchase_invoices
//   ledger    → /ledger_accounts  (chart of accounts)
const TEST_ENTITY_PATHS = {
  suppliers:         '/contacts',
  invoices:          '/purchase_invoices',
  ledger:            '/ledger_accounts',
  'contact-persons': '/contact_persons',
  'bank-accounts':   '/bank_accounts',
  'bank-transactions': '/contact_payments',
  'tax-rates':       '/tax_rates',
  'credit-notes':    '/purchase_credit_notes',
  journals:          '/journals',
  'payment-methods': '/payment_methods',
  products:          '/products',
  services:          '/services',
  'other-payments':  '/other_payments',
  'other-receipts':  '/other_receipts',
  'bank-transfers':  '/bank_transfers',
  attachments:       '/attachments',
};

router.get('/test/:orgId/:entity', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, entity } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }
    const path = TEST_ENTITY_PATHS[entity];
    if (!path) {
      return res.status(400).json({
        error: `Unknown entity '${entity}'. Try one of: ${Object.keys(TEST_ENTITY_PATHS).join(', ')}`,
      });
    }

    // Multi-connection safe: pick the requested connection or the first connected.
    const testConnId = req.query.integration_id || null;
    let testIntQuery = supabaseAdmin
      .from('platform_integrations')
      .select('id, access_token, refresh_token, token_expires_at, is_connected')
      .eq('organization_id', orgId)
      .eq('platform_name', 'sage')
      .order('is_connected', { ascending: false });
    if (testConnId) testIntQuery = testIntQuery.eq('id', testConnId);
    const { data: testRows, error: lookupErr } = await testIntQuery.limit(1);
    const integration = testRows?.[0];

    if (lookupErr) return res.status(500).json({ error: `DB lookup failed: ${lookupErr.message}` });
    if (!integration) return res.status(404).json({ error: 'No Sage integration row for this org' });
    if (!integration.is_connected) return res.status(400).json({ error: 'Sage is not connected — reconnect first' });

    // Forward all query params except orgId/entity to the Sage API.
    const sageQuery = { items_per_page: '200', ...req.query };
    delete sageQuery.orgId;
    delete sageQuery.entity;
    const sageData = await sageClient.sageGet(integration, path, sageQuery);

    return res.json({
      ok: true,
      org_id: orgId,
      integration_id: integration.id,
      entity,
      sage_path: path,
      sage_response: sageData,
    });
  } catch (err) {
    console.error(`[SageRoute] /test/${req.params.entity} error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/suppliers ──────────────────────────────────
// DEV-ONLY Phase B Step 1: Trigger a synchronous suppliers sync.
// Fetches all VENDOR contacts from Sage and upserts into sage_suppliers.
// Returns counts when done. No queue, no async — for fast iteration only.
router.post('/dev-sync/:orgId/suppliers', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }

    console.log(`[SageRoute] DEV sync suppliers requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllSuppliers(orgId, null, connectionId);

    return res.json({
      ok: true,
      org_id: orgId,
      ...result,
    });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/suppliers error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/coa ────────────────────────────────────────
// DEV-ONLY Phase B Step 2: Trigger a synchronous COA (chart of accounts) sync.
// Fetches all Sage ledger_accounts and upserts into the dedicated
// sage_chart_of_accounts table.
router.post('/dev-sync/:orgId/coa', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }

    console.log(`[SageRoute] DEV sync COA requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllCoaAccounts(orgId, null, connectionId);

    return res.json({
      ok: true,
      org_id: orgId,
      ...result,
    });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/coa error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/invoices ───────────────────────────────────
// DEV-ONLY Phase B Step 3: Trigger a synchronous purchase invoices sync.
// Fetches Sage purchase_invoices (with line_items inline) and upserts into:
//   - sage_invoices             (header, dedicated)
//   - sage_invoice_line_items   (lines,  dedicated — fully replaced)
router.post('/dev-sync/:orgId/invoices', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }

    console.log(`[SageRoute] DEV sync invoices requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllPurchaseInvoices(orgId, null, connectionId);

    return res.json({
      ok: true,
      org_id: orgId,
      ...result,
    });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/invoices error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/contact-persons ────────────────────────────
// Enrichment sync: fetches /contact_persons and updates sage_suppliers rows
// with telephone/mobile/fax/contact_name (fields currently NULL because the
// /contacts endpoint alone doesn't include them).
router.post('/dev-sync/:orgId/contact-persons', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }

    console.log(`[SageRoute] DEV sync contact-persons requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllContactPersons(orgId, null, connectionId);

    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/contact-persons error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/bank-accounts ──────────────────────────────
// Fetches /bank_accounts and upserts into sage_bank_accounts.
router.post('/dev-sync/:orgId/bank-accounts', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }

    console.log(`[SageRoute] DEV sync bank-accounts requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllBankAccounts(orgId, null, connectionId);

    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/bank-accounts error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/bank-transactions ──────────────────────────
// Fetches /bank_transactions and upserts into sage_bank_transactions.
router.post('/dev-sync/:orgId/bank-transactions', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }

    console.log(`[SageRoute] DEV sync bank-transactions requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllBankTransactions(orgId, null, connectionId);

    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/bank-transactions error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/tax-rates ──────────────────────────────────
// Fetches /tax_rates and upserts into sage_tax_rates (UK VAT lookup).
router.post('/dev-sync/:orgId/tax-rates', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }

    console.log(`[SageRoute] DEV sync tax-rates requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllTaxRates(orgId, null, connectionId);

    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/tax-rates error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/credit-notes ───────────────────────────────
// Fetches /purchase_credit_notes (with lines) and upserts into:
//   - sage_credit_notes             (header)
//   - sage_credit_note_line_items   (lines — fully replaced per credit note)
router.post('/dev-sync/:orgId/credit-notes', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }

    console.log(`[SageRoute] DEV sync credit-notes requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllPurchaseCreditNotes(orgId, null, connectionId);

    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/credit-notes error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/journals ───────────────────────────────────
// Fetches /journals (with DR/CR lines) and upserts into:
//   - sage_journals       (header)
//   - sage_journal_lines  (lines — fully replaced per journal)
router.post('/dev-sync/:orgId/journals', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId path param must be a UUID' });
    }

    console.log(`[SageRoute] DEV sync journals requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllJournals(orgId, null, connectionId);

    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/journals error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/payment-methods ────────────────────────────
router.post('/dev-sync/:orgId/payment-methods', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) return res.status(400).json({ error: 'orgId path param must be a UUID' });
    console.log(`[SageRoute] DEV sync payment-methods requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllPaymentMethods(orgId, null, connectionId);
    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/payment-methods error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/products ───────────────────────────────────
// Syncs BOTH /products and /services into the same sage_products table.
router.post('/dev-sync/:orgId/products', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) return res.status(400).json({ error: 'orgId path param must be a UUID' });
    console.log(`[SageRoute] DEV sync products+services requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllProducts(orgId, null, connectionId);
    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/products error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/other-payments ─────────────────────────────
router.post('/dev-sync/:orgId/other-payments', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) return res.status(400).json({ error: 'orgId path param must be a UUID' });
    console.log(`[SageRoute] DEV sync other-payments requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllOtherPayments(orgId, null, connectionId);
    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/other-payments error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/other-receipts ─────────────────────────────
router.post('/dev-sync/:orgId/other-receipts', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) return res.status(400).json({ error: 'orgId path param must be a UUID' });
    console.log(`[SageRoute] DEV sync other-receipts requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllOtherReceipts(orgId, null, connectionId);
    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/other-receipts error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/bank-transfers ─────────────────────────────
router.post('/dev-sync/:orgId/bank-transfers', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) return res.status(400).json({ error: 'orgId path param must be a UUID' });
    console.log(`[SageRoute] DEV sync bank-transfers requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllBankTransfers(orgId, null, connectionId);
    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/bank-transfers error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/attachments ────────────────────────────────
router.post('/dev-sync/:orgId/attachments', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) return res.status(400).json({ error: 'orgId path param must be a UUID' });
    console.log(`[SageRoute] DEV sync attachments requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await syncAllAttachments(orgId, null, connectionId);
    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/attachments error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sage/dev-sync/:orgId/canonical ──────────────────────────────────
// Runs the Sage → canonical ETL:
//   sage_chart_of_accounts      → finance_accounts
//   sage_invoices + line_items  → finance_journal_entries + finance_journal_lines
//
// Called automatically by the frontend at the end of the Sync Now chain. After this,
// Sage data is visible to pages using useChartOfAccounts(...,true), EBITDA / Cost
// Impact reports, and other canonical-table consumers (same as Xero).
router.post('/dev-sync/:orgId/canonical', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isUuid(orgId)) return res.status(400).json({ error: 'orgId path param must be a UUID' });
    console.log(`[SageRoute] DEV canonical ETL requested for org ${orgId}`);
    const connectionId = req.query.integration_id || (req.body && req.body.integration_id) || null;
    const result = await runSageToCanonical(orgId, connectionId);
    return res.json({ ok: true, org_id: orgId, ...result });
  } catch (err) {
    console.error('[SageRoute] /dev-sync/canonical error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── helpers ───────────────────────────────────────────────────────────────────

function renderResultHtml({ ok, title, message, details }) {
  const safe = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const color = ok ? '#16a34a' : '#dc2626';
  const icon  = ok ? '&#10003;' : '&#10007;';

  const detailsBlock = details
    ? `<pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:13px;overflow:auto">${safe(JSON.stringify(details, null, 2))}</pre>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${safe(title)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;color:#111827}
  .icon{font-size:48px;color:${color};text-align:center;margin-bottom:8px}
  h1{font-size:22px;margin:8px 0 4px;text-align:center}
  p{color:#4b5563;text-align:center}
  .card{border:1px solid #e5e7eb;border-radius:10px;padding:24px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)}
</style></head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${safe(title)}</h1>
    <p>${safe(message)}</p>
    ${detailsBlock}
  </div>
</body></html>`;
}

module.exports = router;
