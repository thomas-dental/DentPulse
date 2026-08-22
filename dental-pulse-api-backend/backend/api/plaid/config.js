module.exports = {
  env:                process.env.PLAID_ENV || 'sandbox',
  clientId:           process.env.PLAID_CLIENT_ID || '',
  secret:             process.env.PLAID_SECRET || '',
  idvTemplate:        process.env.PLAID_IDV_TEMPLATE_ID || '',
  webhookUrl:         process.env.PLAID_WEBHOOK_URL || '',
  webhookSecret:      process.env.PLAID_WEBHOOK_SECRET || '',
  countryCodes:       (process.env.PLAID_COUNTRY_CODES || 'GB').split(',').map(c => c.trim()),
  nameMatchThreshold: parseInt(process.env.PLAID_NAME_MATCH_THRESHOLD || '80', 10),
  sandboxSimulate:    process.env.PLAID_SANDBOX_SIMULATE === 'true',
  clientName:         'DentPulse',
};
// To go live: set PLAID_ENV=production and PLAID_SECRET=<production secret>
// No code changes needed.
