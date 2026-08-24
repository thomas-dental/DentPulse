/**
 * Resolve Dentally integration row for a practice (organization_id).
 * Prefer a row that already has encrypted_pat; else the first active Dentally row.
 */

const { supabaseAdmin } = require('../../config/supabase');

const DENTALLY_NAME = 'Dentally';

/**
 * @param {string} practiceId — organizations.id
 * @param {{ requireEncrypted?: boolean }} [opts]
 * @returns {Promise<object|null>}
 */
async function findDentallyIntegration(practiceId, opts = {}) {
  const { data, error } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('organization_id', practiceId)
    .ilike('integration_name', DENTALLY_NAME)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load Dentally integration: ${error.message}`);
  }

  const rows = data || [];
  if (rows.length === 0) return null;

  const withEncrypted = rows.find((r) => r.encrypted_pat && r.encrypted_pat_iv);
  if (opts.requireEncrypted) {
    return withEncrypted || null;
  }
  return withEncrypted || rows[0];
}

/**
 * Credential exists for UI/API when encrypted_pat is present.
 */
async function findEncryptedDentallyCredential(practiceId) {
  return findDentallyIntegration(practiceId, { requireEncrypted: true });
}

module.exports = {
  DENTALLY_NAME,
  findDentallyIntegration,
  findEncryptedDentallyCredential,
};
