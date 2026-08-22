// Plaid API client — port of dentledger PlaidClient.php
// Uses Node.js native fetch (Node 18+). No extra dependencies.

const config = require('./config');

class PlaidClient {
  constructor() {
    this.clientId = config.clientId;
    this.secret   = config.secret;
    this.baseUrl  = `https://${config.env}.plaid.com`;
  }

  async post(endpoint, data = {}) {
    const payload = { ...data, client_id: this.clientId, secret: this.secret };

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(30_000),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(body.error_message || `Plaid API error ${response.status}`);
      err.plaidError  = body;
      err.plaidStatus = response.status;
      throw err;
    }

    return body;
  }

  // ── Identity Verification (KYB proxy) ──────────────────────────────────────

  createIdvSession(userData) {
    return this.post('/identity_verification/create', {
      template_id:   config.idvTemplate,
      gave_consent:  true,
      user:          userData,
      is_shareable:  true,
    });
  }

  getIdvResult(idvId) {
    return this.post('/identity_verification/get', {
      identity_verification_id: idvId,
    });
  }

  createLinkTokenForIdv(userId, idvSessionId = null) {
    const payload = {
      user:           { client_user_id: String(userId) },
      client_name:    config.clientName,
      products:       ['identity_verification'],
      country_codes:  config.countryCodes,
      language:       'en',
      webhook:        config.webhookUrl || undefined,
      identity_verification: { template_id: config.idvTemplate },
    };
    if (idvSessionId) {
      payload.identity_verification.gave_consent = true;
      payload.identity_verification.identity_verification_id = idvSessionId;
    }
    return this.post('/link/token/create', payload);
  }

  // ── Bank linking ────────────────────────────────────────────────────────────

  createLinkTokenForBank(userId) {
    return this.post('/link/token/create', {
      user:          { client_user_id: String(userId) },
      client_name:   config.clientName,
      products:      ['auth', 'identity', 'transactions'],
      country_codes: config.countryCodes,
      language:      'en',
      webhook:       config.webhookUrl || undefined,
    });
  }

  exchangePublicToken(publicToken) {
    return this.post('/item/public_token/exchange', { public_token: publicToken });
  }

  getIdentity(accessToken) {
    return this.post('/identity/get', { access_token: accessToken });
  }

  getAccounts(accessToken) {
    return this.post('/accounts/get', { access_token: accessToken });
  }

  getBalances(accessToken) {
    return this.post('/accounts/balance/get', { access_token: accessToken });
  }

  removeItem(accessToken) {
    return this.post('/item/remove', { access_token: accessToken });
  }

  // ── Transactions ─────────────────────────────────────────────────────────────

  getTransactions(accessToken, startDate, endDate, count = 500, offset = 0) {
    return this.post('/transactions/get', {
      access_token: accessToken,
      start_date:   startDate,
      end_date:     endDate,
      options:      { count, offset },
    });
  }

  // ── Institution ──────────────────────────────────────────────────────────────

  getInstitution(institutionId, countryCodes = config.countryCodes) {
    return this.post('/institutions/get_by_id', {
      institution_id: institutionId,
      country_codes:  countryCodes,
      options:        { include_optional_metadata: true },
    });
  }

  // ── Webhook verification ─────────────────────────────────────────────────────

  getWebhookJwks(keyId) {
    return this.post('/webhook_verification_key/get', { key_id: keyId });
  }

  // ── Payment Initiation (Phase 2 — UK GBP) ───────────────────────────────────

  createPaymentRecipient(name, bacs = null, iban = null, address = null) {
    const data = { name };
    if (bacs)    data.bacs    = bacs;    // { account, sort_code }
    else if (iban) data.iban  = iban;
    if (address) data.address = address;
    return this.post('/payment_initiation/recipient/create', data);
  }

  createPayment(recipientId, reference, amount, currency = 'GBP') {
    return this.post('/payment_initiation/payment/create', {
      recipient_id: recipientId,
      reference,
      amount: { currency, value: Math.round(amount * 100) / 100 },
    });
  }

  createLinkTokenForPayment(userId, paymentId, currency = 'GBP') {
    const countryMap = { GBP: ['GB'], EUR: ['FR', 'DE', 'NL', 'IE', 'ES'] };
    return this.post('/link/token/create', {
      user:               { client_user_id: String(userId) },
      client_name:        config.clientName,
      products:           ['payment_initiation'],
      country_codes:      countryMap[currency.toUpperCase()] || ['GB'],
      language:           'en',
      payment_initiation: { payment_id: paymentId },
    });
  }

  getPayment(paymentId) {
    return this.post('/payment_initiation/payment/get', { payment_id: paymentId });
  }
}

module.exports = new PlaidClient();
