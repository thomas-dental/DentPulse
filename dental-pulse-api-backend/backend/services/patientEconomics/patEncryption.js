/**
 * Patient Economics — Dentally PAT encrypt/decrypt (AES-256-GCM).
 *
 * TOKEN_ENCRYPTION_KEY (process.env):
 *   - Must decode to exactly 32 bytes (256-bit).
 *   - Accepted encodings: base64 (typically 44 chars) or hex (64 chars).
 *   - Generate e.g.: openssl rand -base64 32   OR   openssl rand -hex 32
 *
 * Storage mapping (dentally_credentials):
 *   - encrypted_pat     ← base64(ciphertext || authTag)  [authTag is 16 bytes, appended]
 *   - encrypted_pat_iv  ← base64(12-byte IV)
 *
 * decryptPAT output is for INTERNAL use only — never put it in an HTTP response.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function resolveKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw || !String(raw).trim()) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  }
  const trimmed = String(raw).trim();
  let key;
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_LENGTH * 2) {
    key = Buffer.from(trimmed, 'hex');
  } else {
    key = Buffer.from(trimmed, 'base64');
  }
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}). Use base64 or hex.`
    );
  }
  return key;
}

/**
 * @param {string} plaintext
 * @returns {{ ciphertext: string, iv: string }} base64 strings for DB columns
 */
function encryptPAT(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptPAT requires a non-empty plaintext string');
  }
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, authTag]).toString('base64');
  return { ciphertext, iv: iv.toString('base64') };
}

/**
 * @param {string} ciphertext base64(ciphertext || authTag)
 * @param {string} iv base64 IV
 * @returns {string} plaintext PAT — INTERNAL USE ONLY
 */
function decryptPAT(ciphertext, iv) {
  if (typeof ciphertext !== 'string' || !ciphertext) {
    throw new Error('decryptPAT requires ciphertext');
  }
  if (typeof iv !== 'string' || !iv) {
    throw new Error('decryptPAT requires iv');
  }
  const key = resolveKey();
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length <= AUTH_TAG_LENGTH) {
    throw new Error('Invalid ciphertext payload');
  }
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const data = buf.subarray(0, buf.length - AUTH_TAG_LENGTH);
  const ivBuf = Buffer.from(iv, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, ivBuf);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encryptPAT, decryptPAT };
