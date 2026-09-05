/**
 * Patient Economics — retry / backoff helpers for sync_cursors.
 */

const MAX_RETRIES = Number(process.env.PE_SYNC_MAX_RETRIES || 5);
const BASE_DELAY_MS = Number(process.env.PE_SYNC_RETRY_BASE_MS || 30_000);
const CAP_DELAY_MS = Number(process.env.PE_SYNC_RETRY_CAP_MS || 900_000);

function getMaxRetries() {
  return Number.isFinite(MAX_RETRIES) && MAX_RETRIES >= 1 ? MAX_RETRIES : 5;
}

/**
 * Exponential backoff: base * 2^(attempt-1), capped.
 * attempt is 1-based (first failure → attempt 1).
 */
function computeNextRetryAt(retryCountAfterIncrement, now = Date.now()) {
  const attempt = Math.max(1, retryCountAfterIncrement);
  const delay = Math.min(BASE_DELAY_MS * (2 ** (attempt - 1)), CAP_DELAY_MS);
  return new Date(now + delay).toISOString();
}

function clearRetryFields() {
  return {
    retry_count: 0,
    next_retry_at: null,
    last_error: null,
    last_error_code: null,
  };
}

module.exports = {
  getMaxRetries,
  computeNextRetryAt,
  clearRetryFields,
  BASE_DELAY_MS,
  CAP_DELAY_MS,
};
