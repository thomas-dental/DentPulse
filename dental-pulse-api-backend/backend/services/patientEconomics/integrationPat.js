/**
 * Encrypt/decrypt Dentally PAT on public.integrations.
 * Runtime never persists or reads plaintext PAT in api_key.
 */

const { encryptPAT, decryptPAT } = require('./patEncryption');

function buildPatHint(pat) {
  const trimmed = pat.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

function hasEncryptedPat(integration) {
  return !!(integration?.encrypted_pat && integration?.encrypted_pat_iv);
}

/**
 * @param {string} plaintextPat
 * @returns {{ encrypted_pat: string, encrypted_pat_iv: string, pat_hint: string, api_key: null, validated_at: null, needs_reconnection: false, auth_error_message: null, auth_failed_at: null }}
 */
function encryptPatForStorage(plaintextPat) {
  const trimmed = plaintextPat.trim();
  const { ciphertext, iv } = encryptPAT(trimmed);
  return {
    encrypted_pat: ciphertext,
    encrypted_pat_iv: iv,
    pat_hint: buildPatHint(trimmed),
    api_key: null,
    validated_at: null,
    needs_reconnection: false,
    auth_error_message: null,
    auth_failed_at: null,
  };
}

/**
 * @param {object} integration — row with encrypted_pat / encrypted_pat_iv
 * @returns {string} decrypted PAT for Dentally API calls
 */
function decryptIntegrationPat(integration) {
  if (!hasEncryptedPat(integration)) {
    const err = new Error('No encrypted Dentally PAT on this integration');
    err.code = 'NO_ENCRYPTED_PAT';
    throw err;
  }
  return decryptPAT(integration.encrypted_pat, integration.encrypted_pat_iv);
}

function descriptionFromDentallyUser(userData, fallbackLabel) {
  const email =
    (typeof userData?.user?.email === 'string' && userData.user.email.trim()) ||
    (typeof userData?.email === 'string' && userData.email.trim()) ||
    null;
  if (email) return email.slice(0, 120);
  const label = typeof fallbackLabel === 'string' ? fallbackLabel.trim() : '';
  if (label) return label.slice(0, 120);
  return 'Cloud-based dental practice management software';
}

module.exports = {
  buildPatHint,
  hasEncryptedPat,
  encryptPatForStorage,
  decryptIntegrationPat,
  descriptionFromDentallyUser,
};
