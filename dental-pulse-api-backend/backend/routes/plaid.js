const express = require('express');
const router = express.Router();
const syncAuthMiddleware = require('../middleware/syncAuth');
const { supabaseAdmin } = require('../config/supabase');
const plaid = require('../api/plaid/PlaidClient');
const plaidConfig = require('../api/plaid/config');
const { score: nameScore } = require('../api/plaid/nameMatcher');

// ─── helpers ──────────────────────────────────────────────────────────────────

async function allPeopleVerified(verificationId) {
  const { data } = await supabaseAdmin
    .from('plaid_beneficial_owners')
    .select('status')
    .eq('organization_verification_id', verificationId);
  if (!data || data.length === 0) return false;
  return data.every(p => p.status === 'verified');
}

function err500(res, label, error) {
  console.error(`[Plaid] ${label}:`, error.message || error);
  res.status(500).json({ success: false, error: error.message || 'Internal error' });
}

// ─── Onboarding: GET state ────────────────────────────────────────────────────

router.get('/onboarding/state', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.query;
    if (!orgId) return res.status(400).json({ success: false, error: 'orgId required' });

    const { data: verification, error } = await supabaseAdmin
      .from('plaid_organization_verifications')
      .select(
        'id, organization_id, legal_name, companies_house_number, trading_name, address, industry,' +
        ' kyb_status, kyb_verified_at, bank_status, bank_institution_name, bank_account_mask,' +
        ' bank_holder_name, bank_match_score, overall_status, completed_at, created_at'
      )
      .eq('organization_id', orgId)
      .single();

    if (error && error.code === 'PGRST116') {
      return res.json({ success: true, verification: null });
    }
    if (error) throw error;

    const { data: people } = await supabaseAdmin
      .from('plaid_beneficial_owners')
      .select('id, first_name, last_name, role, ownership_percent, status, idv_completed_at')
      .eq('organization_verification_id', verification.id)
      .order('created_at', { ascending: true });

    res.json({ success: true, verification: { ...verification, people: people || [] } });
  } catch (e) { err500(res, 'onboarding/state', e); }
});

// ─── Onboarding: Step 1 — Business ───────────────────────────────────────────

router.post('/onboarding/business', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, legalName, companiesHouseNumber, tradingName, address, industry } = req.body;
    if (!orgId || !legalName) {
      return res.status(400).json({ success: false, error: 'orgId and legalName are required' });
    }

    // KYB heuristic (sandbox): Companies House number ≥6 chars → verified
    // With PLAID_IDV_TEMPLATE_ID set, you could call plaid.createIdvSession() here
    let kybStatus = 'verified';
    if (plaidConfig.idvTemplate) {
      try {
        const idv = await plaid.createIdvSession({ client_user_id: orgId, legal_name: legalName });
        const s = idv.status;
        kybStatus = (s === 'success' || s === 'active') ? 'verified' : 'review';
      } catch (idvErr) {
        console.warn('[Plaid] IDV session failed, falling back to CH heuristic:', idvErr.message);
        kybStatus = companiesHouseNumber && companiesHouseNumber.length >= 6 ? 'verified' : 'review';
      }
    } else {
      // Sandbox without template — always verified to allow flow progression
      kybStatus = 'verified';
    }

    const now = new Date().toISOString();
    const { data: verification, error } = await supabaseAdmin
      .from('plaid_organization_verifications')
      .upsert({
        organization_id: orgId,
        user_id: req.user.id,
        legal_name: legalName,
        companies_house_number: companiesHouseNumber || null,
        trading_name: tradingName || null,
        address: address || null,
        industry: industry || 'Dental practice',
        kyb_status: kybStatus,
        kyb_verified_at: ['verified', 'review'].includes(kybStatus) ? now : null,
        updated_at: now,
      }, { onConflict: 'organization_id' })
      .select('id')
      .single();

    if (error) throw error;

    const message = kybStatus === 'verified' ? 'Business verified successfully' : 'Business submitted — manual review may be required';
    res.json({ success: true, kybStatus, message, verificationId: verification.id });
  } catch (e) { err500(res, 'onboarding/business', e); }
});

// ─── Onboarding: Step 2 — People (add) ───────────────────────────────────────

router.post('/onboarding/people', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, verificationId, firstName, lastName, role, ownershipPercent } = req.body;
    if (!orgId || !verificationId || !firstName || !lastName) {
      return res.status(400).json({ success: false, error: 'orgId, verificationId, firstName, lastName required' });
    }

    const { data: person, error } = await supabaseAdmin
      .from('plaid_beneficial_owners')
      .insert({
        organization_verification_id: verificationId,
        organization_id: orgId,
        first_name: firstName,
        last_name: lastName,
        role: role || 'control_person',
        ownership_percent: ownershipPercent || 100,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, person });
  } catch (e) { err500(res, 'onboarding/people POST', e); }
});

// ─── Onboarding: Step 2 — People (remove) ────────────────────────────────────

router.delete('/onboarding/people/:id', syncAuthMiddleware, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('plaid_beneficial_owners')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { err500(res, 'onboarding/people DELETE', e); }
});

// ─── Onboarding: Step 2 — IDV link token ─────────────────────────────────────

router.post('/onboarding/people/:id/idv-token', syncAuthMiddleware, async (req, res) => {
  try {
    const { data: person, error } = await supabaseAdmin
      .from('plaid_beneficial_owners')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;

    await supabaseAdmin
      .from('plaid_beneficial_owners')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    // Sandbox simulation mode (no IDV template or PLAID_SANDBOX_SIMULATE=true)
    if (!plaidConfig.idvTemplate || plaidConfig.sandboxSimulate) {
      return res.json({ success: true, sandboxMode: true });
    }

    const linkResult = await plaid.createLinkTokenForIdv(
      person.organization_id,
      person.plaid_idv_id || undefined
    );
    res.json({ success: true, linkToken: linkResult.link_token });
  } catch (e) { err500(res, 'onboarding/people idv-token', e); }
});

// ─── Onboarding: Step 2 — IDV result ─────────────────────────────────────────

router.post('/onboarding/people/:id/idv-result', syncAuthMiddleware, async (req, res) => {
  try {
    const { idvId } = req.body;

    let status = 'verified';
    if (!plaidConfig.idvTemplate || plaidConfig.sandboxSimulate) {
      // Sandbox simulation: 90 % pass, 10 % fail
      status = Math.random() < 0.9 ? 'verified' : 'failed';
    } else if (idvId) {
      const result = await plaid.getIdvResult(idvId);
      const s = result.status;
      if (s === 'success') status = 'verified';
      else if (s === 'failed') status = 'failed';
      else status = 'manual_review';
    }

    await supabaseAdmin
      .from('plaid_beneficial_owners')
      .update({
        status,
        plaid_idv_id: idvId || null,
        idv_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    res.json({ success: true, status });
  } catch (e) { err500(res, 'onboarding/people idv-result', e); }
});

// ─── Onboarding: Step 3 — Bank link token ────────────────────────────────────

router.post('/onboarding/bank/link-token', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.body;
    if (!orgId) return res.status(400).json({ success: false, error: 'orgId required' });

    const linkResult = await plaid.createLinkTokenForBank(orgId);

    await supabaseAdmin
      .from('plaid_organization_verifications')
      .update({ bank_status: 'linking', updated_at: new Date().toISOString() })
      .eq('organization_id', orgId);

    res.json({ success: true, linkToken: linkResult.link_token });
  } catch (e) { err500(res, 'onboarding/bank/link-token', e); }
});

// ─── Onboarding: Step 3 — Bank connect (exchange + name match) ───────────────

router.post('/onboarding/bank/connect', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, publicToken, metadata } = req.body;
    if (!orgId || !publicToken) {
      return res.status(400).json({ success: false, error: 'orgId and publicToken required' });
    }

    // Exchange public token
    const exchangeResult = await plaid.exchangePublicToken(publicToken);
    const accessToken = exchangeResult.access_token;
    const itemId      = exchangeResult.item_id;

    const institutionId   = metadata?.institution?.institution_id || null;
    let institutionName   = metadata?.institution?.name || null;
    let institutionLogo   = null;
    let institutionColor  = null;
    let holderName        = null;
    let accountMask       = null;

    // Get identity for name matching
    try {
      const identityResult = await plaid.getIdentity(accessToken);
      const firstAccount = identityResult.accounts?.[0];
      if (firstAccount) {
        accountMask = firstAccount.mask;
        holderName  = firstAccount.owners?.[0]?.names?.[0] || null;
      }
    } catch (idErr) {
      console.warn('[Plaid] identity fetch failed:', idErr.message);
      accountMask = metadata?.accounts?.[0]?.mask || null;
    }

    // Get institution logo/color
    if (institutionId) {
      try {
        const instResult = await plaid.getInstitution(institutionId, plaidConfig.countryCodes);
        institutionName  = institutionName || instResult.institution?.name;
        institutionLogo  = instResult.institution?.logo;
        institutionColor = instResult.institution?.primary_color;
      } catch {}
    }

    // Load verification for name matching
    const { data: verification } = await supabaseAdmin
      .from('plaid_organization_verifications')
      .select('id, legal_name, trading_name, kyb_status')
      .eq('organization_id', orgId)
      .single();

    // Name match
    let matchScore = 0;
    if (holderName && verification?.legal_name) {
      matchScore = nameScore(verification.legal_name, holderName, verification.trading_name);
    } else if (plaidConfig.env === 'sandbox') {
      matchScore = 100; // sandbox: no identity data → treat as matched
    }

    const bankStatus = matchScore >= plaidConfig.nameMatchThreshold ? 'matched' : 'mismatch';

    // Compute overall_status
    const kybDone    = ['verified', 'review'].includes(verification?.kyb_status);
    const peopleDone = verification ? await allPeopleVerified(verification.id) : false;
    let overallStatus = 'incomplete';
    if (kybDone && peopleDone && bankStatus === 'matched') overallStatus = 'complete';
    else if (bankStatus === 'mismatch' || verification?.kyb_status === 'review') overallStatus = 'manual_review';

    const now = new Date().toISOString();

    // Persist to plaid_organization_verifications
    await supabaseAdmin
      .from('plaid_organization_verifications')
      .update({
        bank_status:           bankStatus,
        bank_access_token:     accessToken,
        bank_item_id:          itemId,
        bank_institution_name: institutionName,
        bank_account_mask:     accountMask,
        bank_holder_name:      holderName,
        bank_match_score:      matchScore,
        overall_status:        overallStatus,
        completed_at:          overallStatus === 'complete' ? now : null,
        updated_at:            now,
      })
      .eq('organization_id', orgId);

    // Also create a plaid_connections entry so this bank appears in the connections list
    const { data: existingConn } = await supabaseAdmin
      .from('plaid_connections')
      .select('id')
      .eq('item_id', itemId)
      .maybeSingle();

    if (!existingConn) {
      let accounts = [];
      try {
        const accResult = await plaid.getAccounts(accessToken);
        accounts = accResult.accounts || [];
      } catch (accErr) {
        console.warn('[Plaid] getAccounts failed during onboarding bank connect:', accErr.message);
      }

      const { data: newConn } = await supabaseAdmin
        .from('plaid_connections')
        .insert({
          organization_id:  orgId,
          user_id:          req.user.id,
          item_id:          itemId,
          access_token:     accessToken,
          institution_id:   institutionId,
          institution_name: institutionName,
          institution_logo: institutionLogo,
          institution_color: institutionColor,
          status:           'active',
        })
        .select('id')
        .single();

      if (newConn && accounts.length > 0) {
        await supabaseAdmin.from('plaid_accounts').insert(
          accounts.map(acc => ({
            connection_id:       newConn.id,
            organization_id:     orgId,
            plaid_account_id:    acc.account_id,
            name:                acc.name,
            official_name:       acc.official_name,
            mask:                acc.mask,
            type:                acc.type,
            subtype:             acc.subtype,
            current_balance:     acc.balances?.current,
            available_balance:   acc.balances?.available,
            currency_code:       acc.balances?.iso_currency_code || 'GBP',
            balances_updated_at: now,
          }))
        );
      }
    }

    res.json({ success: true, bankStatus, matchScore, overallStatus, institutionName, accountMask });
  } catch (e) { err500(res, 'onboarding/bank/connect', e); }
});

// ─── Onboarding: disconnect verification bank ────────────────────────────────

router.delete('/onboarding/bank', syncAuthMiddleware, async (req, res) => {
  try {
    const orgId = req.query.orgId || req.body?.orgId;
    if (!orgId) return res.status(400).json({ success: false, error: 'orgId required' });

    const { data: verif, error: verifErr } = await supabaseAdmin
      .from('plaid_organization_verifications')
      .select('bank_access_token, bank_item_id')
      .eq('organization_id', orgId)
      .single();
    if (verifErr) throw verifErr;

    // Revoke with Plaid if token exists
    if (verif?.bank_access_token) {
      try {
        await plaid.removeItem(verif.bank_access_token);
      } catch (revokeErr) {
        console.warn('[Plaid] removeItem failed (resetting locally anyway):', revokeErr.message);
      }
    }

    // Reset bank fields on the verification record
    const now = new Date().toISOString();
    await supabaseAdmin
      .from('plaid_organization_verifications')
      .update({
        bank_status:           'pending',
        bank_access_token:     null,
        bank_item_id:          null,
        bank_institution_name: null,
        bank_account_mask:     null,
        bank_holder_name:      null,
        bank_match_score:      null,
        overall_status:        'incomplete',
        completed_at:          null,
        updated_at:            now,
      })
      .eq('organization_id', orgId);

    // Also mark the corresponding plaid_connections entry as disconnected
    if (verif?.bank_item_id) {
      await supabaseAdmin
        .from('plaid_connections')
        .update({ status: 'disconnected', updated_at: now })
        .eq('item_id', verif.bank_item_id)
        .eq('organization_id', orgId);
    }

    res.json({ success: true });
  } catch (e) { err500(res, 'onboarding/bank DELETE', e); }
});

// ─── Connections: link token (post-onboarding, add another bank) ──────────────

router.post('/link-token', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.body;
    if (!orgId) return res.status(400).json({ success: false, error: 'orgId required' });
    const result = await plaid.createLinkTokenForBank(orgId);
    res.json({ success: true, linkToken: result.link_token });
  } catch (e) { err500(res, 'link-token', e); }
});

// ─── Connections: exchange token (post-onboarding) ────────────────────────────

router.post('/exchange-token', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, publicToken, metadata } = req.body;
    if (!orgId || !publicToken) {
      return res.status(400).json({ success: false, error: 'orgId and publicToken required' });
    }

    const exchangeResult = await plaid.exchangePublicToken(publicToken);
    const accessToken    = exchangeResult.access_token;
    const itemId         = exchangeResult.item_id;
    const institutionId  = metadata?.institution?.institution_id || null;
    let institutionName  = metadata?.institution?.name || null;
    let institutionLogo  = null;
    let institutionColor = null;
    const now = new Date().toISOString();

    if (institutionId) {
      try {
        const instResult = await plaid.getInstitution(institutionId, plaidConfig.countryCodes);
        institutionName  = institutionName || instResult.institution?.name;
        institutionLogo  = instResult.institution?.logo;
        institutionColor = instResult.institution?.primary_color;
      } catch {}
    }

    const accResult  = await plaid.getAccounts(accessToken);
    const accounts   = accResult.accounts || [];

    const { data: connection, error: connErr } = await supabaseAdmin
      .from('plaid_connections')
      .insert({
        organization_id:   orgId,
        user_id:           req.user.id,
        item_id:           itemId,
        access_token:      accessToken,
        institution_id:    institutionId,
        institution_name:  institutionName,
        institution_logo:  institutionLogo,
        institution_color: institutionColor,
        status:            'active',
      })
      .select()
      .single();
    if (connErr) throw connErr;

    if (accounts.length > 0) {
      await supabaseAdmin.from('plaid_accounts').insert(
        accounts.map(acc => ({
          connection_id:       connection.id,
          organization_id:     orgId,
          plaid_account_id:    acc.account_id,
          name:                acc.name,
          official_name:       acc.official_name,
          mask:                acc.mask,
          type:                acc.type,
          subtype:             acc.subtype,
          current_balance:     acc.balances?.current,
          available_balance:   acc.balances?.available,
          currency_code:       acc.balances?.iso_currency_code || 'GBP',
          balances_updated_at: now,
        }))
      );
    }

    res.json({ success: true, connectionId: connection.id, accounts });
  } catch (e) { err500(res, 'exchange-token', e); }
});

// ─── Connections: list ────────────────────────────────────────────────────────

router.get('/connections', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId } = req.query;
    if (!orgId) return res.status(400).json({ success: false, error: 'orgId required' });

    const { data: connections, error } = await supabaseAdmin
      .from('plaid_connections')
      .select('*, accounts:plaid_accounts(*)')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ success: true, connections: connections || [] });
  } catch (e) { err500(res, 'connections GET', e); }
});

// ─── Connections: disconnect ──────────────────────────────────────────────────

router.delete('/connections/:id', syncAuthMiddleware, async (req, res) => {
  try {
    const { data: connection, error } = await supabaseAdmin
      .from('plaid_connections')
      .select('access_token')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;

    try {
      await plaid.removeItem(connection.access_token);
    } catch (revokeErr) {
      // Still disconnect locally even if Plaid revocation fails
      console.warn('[Plaid] removeItem failed (disconnecting locally anyway):', revokeErr.message);
    }

    await supabaseAdmin
      .from('plaid_connections')
      .update({ status: 'disconnected', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    res.json({ success: true });
  } catch (e) { err500(res, 'connections DELETE', e); }
});

// ─── Connections: refresh balances ───────────────────────────────────────────

router.post('/connections/:id/refresh', syncAuthMiddleware, async (req, res) => {
  try {
    const { data: connection, error } = await supabaseAdmin
      .from('plaid_connections')
      .select('access_token')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;

    const balancesResult = await plaid.getBalances(connection.access_token);
    const accounts       = balancesResult.accounts || [];
    const now            = new Date().toISOString();

    for (const acc of accounts) {
      await supabaseAdmin
        .from('plaid_accounts')
        .update({
          current_balance:     acc.balances?.current,
          available_balance:   acc.balances?.available,
          balances_updated_at: now,
        })
        .eq('connection_id', req.params.id)
        .eq('plaid_account_id', acc.account_id);
    }

    res.json({ success: true, accountCount: accounts.length });
  } catch (e) { err500(res, 'connections/refresh', e); }
});

// ─── Connections: transactions (statements page) ──────────────────────────────

router.get('/connections/:id/transactions', syncAuthMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate required (YYYY-MM-DD)' });
    }

    const { data: connection, error } = await supabaseAdmin
      .from('plaid_connections')
      .select('access_token, institution_name, institution_logo')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;

    const { data: accounts } = await supabaseAdmin
      .from('plaid_accounts')
      .select('*')
      .eq('connection_id', req.params.id);

    const txResult     = await plaid.getTransactions(connection.access_token, startDate, endDate, 500, 0);
    const transactions = txResult.transactions || [];

    // Plaid convention: positive amount = money OUT (debit), negative = money IN (credit)
    let totalIn = 0, totalOut = 0;
    for (const tx of transactions) {
      if (tx.amount < 0) totalIn  += Math.abs(tx.amount);
      else               totalOut += tx.amount;
    }

    res.json({
      success:         true,
      institutionName: connection.institution_name,
      institutionLogo: connection.institution_logo,
      accounts:        accounts || [],
      transactions,
      totalIn:          Math.round(totalIn  * 100) / 100,
      totalOut:         Math.round(totalOut * 100) / 100,
      netFlow:          Math.round((totalIn - totalOut) * 100) / 100,
      transactionCount: transactions.length,
      dateRange:        { start: startDate, end: endDate },
    });
  } catch (e) { err500(res, 'connections/transactions', e); }
});

// ─── Webhook (no auth — Plaid calls this directly) ────────────────────────────

router.post('/webhook', async (req, res) => {
  try {
    const { webhook_type, webhook_code, item_id, error: plaidErr } = req.body;
    console.log(`[Plaid Webhook] ${webhook_type}/${webhook_code} item=${item_id}`);

    if (webhook_type === 'ITEM' && webhook_code === 'ERROR') {
      await supabaseAdmin
        .from('plaid_connections')
        .update({
          status:     'error',
          error_code: plaidErr?.error_code || 'UNKNOWN',
          updated_at: new Date().toISOString(),
        })
        .eq('item_id', item_id);
    }

    if (webhook_type === 'ITEM' && webhook_code === 'PENDING_EXPIRATION') {
      await supabaseAdmin
        .from('plaid_connections')
        .update({ error_code: 'PENDING_EXPIRATION', updated_at: new Date().toISOString() })
        .eq('item_id', item_id);
    }

    res.json({ received: true });
  } catch (e) {
    console.error('[Plaid Webhook] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Invoice Payment Initiation ───────────────────────────────────────────────
// POST /api/plaid/invoice-pay
// Creates a Plaid Payment Initiation for a vendor invoice.
// Returns a link_token so the frontend can open Plaid Link for bank consent.

router.post('/invoice-pay', syncAuthMiddleware, async (req, res) => {
  try {
    const { orgId, vendorBankId, vendorBankName, vendorSortCode, vendorAccountNumber, amount, reference } = req.body;

    if (!orgId || !amount) {
      return res.status(400).json({ success: false, error: 'orgId and amount are required' });
    }

    let name           = vendorBankName;
    let sortCode       = vendorSortCode;
    let accountNumber  = vendorAccountNumber;
    let recipientId    = null;

    // If a saved vendor bank ID was provided, fetch its details from DB
    if (vendorBankId) {
      const { data: vb } = await supabaseAdmin
        .from('vendor_bank_accounts')
        .select('account_name, sort_code, account_number, plaid_recipient_id')
        .eq('id', vendorBankId)
        .single();
      if (vb) {
        name          = vb.account_name;
        sortCode      = vb.sort_code;
        accountNumber = vb.account_number;
        recipientId   = vb.plaid_recipient_id ?? null;
      }
    }

    // Create Plaid recipient if not cached
    if (!recipientId) {
      if (!name) {
        return res.status(400).json({ success: false, error: 'Vendor bank account holder name is required' });
      }

      const bacs = sortCode && accountNumber
        ? { account: accountNumber, sort_code: sortCode.replace(/[^0-9]/g, '') }
        : null;

      const recipientResp = await plaid.createPaymentRecipient(name, bacs);
      recipientId = recipientResp.recipient_id;

      // Cache recipient on the saved bank for future payments
      if (vendorBankId && recipientId) {
        await supabaseAdmin
          .from('vendor_bank_accounts')
          .update({ plaid_recipient_id: recipientId })
          .eq('id', vendorBankId);
      }
    }

    // Sanitise reference to 18 chars max (Plaid limit)
    const payRef = (reference || `Payment ${amount}`)
      .replace(/[^A-Za-z0-9 ]/g, '')
      .substring(0, 18)
      .trim();

    // Create the payment
    const paymentResp = await plaid.createPayment(recipientId, payRef, parseFloat(amount), 'GBP');
    const plaidPaymentId = paymentResp.payment_id;

    // Create link token so the frontend can open Plaid Link for bank consent
    const linkResp = await plaid.createLinkTokenForPayment(orgId, plaidPaymentId, 'GBP');

    console.log('[Plaid] Invoice payment created:', { plaidPaymentId, orgId, amount });

    res.json({ success: true, plaidPaymentId, linkToken: linkResp.link_token });
  } catch (e) {
    console.error('[Plaid] invoice-pay error:', e.message, e.plaidError);
    res.status(500).json({ success: false, error: e.message || 'Payment initiation failed' });
  }
});

module.exports = router;
