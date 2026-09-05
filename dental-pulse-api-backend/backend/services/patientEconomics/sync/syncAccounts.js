/**
 * Patient Economics — sync one chunk of Dentally billing accounts into
 * public.dentally_patients_accounts.
 *
 * Fetches all accounts (no state=debit filter used by the main integration sync).
 * Enriches list rows with uuid via per-account detail calls, matching main sync.
 */

const { fetchAccountDetailsBatch } = require('../../../api/dentally/client');
const { RESOURCE_ACCOUNTS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');

async function syncAccounts(practiceId) {
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_ACCOUNTS,
    entityAlias: 'accounts',
    // Main Dentally sync filters to debit-only; PE needs the full account set.
    entityConfigOverride: { extraParams: {} },
    enrichRecords: (records, pat, apiEndpoint) =>
      fetchAccountDetailsBatch(pat, apiEndpoint, records),
  });
}

module.exports = { syncAccounts };
