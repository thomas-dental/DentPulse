/**
 * Shared exponential backoff for Dentally rate limits within a PE sync chunk.
 * Used around fetch + enrich calls so 429/403 rate-limit responses retry
 * before the chunk is abandoned for a later invocation.
 */

const { sleep } = require('../../../utils/helpers');
const { classifyDentallyFetchError } = require('./dentallyErrors');

const DEFAULT_MAX_RETRIES = Number(process.env.PE_SYNC_RATE_LIMIT_MAX_RETRIES || 5);
const BASE_DELAY_MS = Number(process.env.PE_SYNC_RATE_LIMIT_BASE_MS || 2000);
const MAX_DELAY_MS = Number(process.env.PE_SYNC_RATE_LIMIT_CAP_MS || 60000);

function isRateLimitError(err) {
  return classifyDentallyFetchError(err).kind === 'rate_limit';
}

function computeBackoffDelayMs(attempt) {
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(exponential, MAX_DELAY_MS);
}

/**
 * Run fn(), retrying on Dentally rate-limit errors with exponential backoff.
 * @throws last error when retries are exhausted or error is not rate-limit
 */
async function withRateLimitBackoff(label, fn, options = {}) {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err) || attempt >= maxRetries) {
        throw err;
      }

      const delayMs = computeBackoffDelayMs(attempt);
      console.log(
        `[PE sync] ${label}: rate limit — backing off ${Math.round(delayMs / 1000)}s ` +
        `(retry ${attempt + 1}/${maxRetries})`
      );
      await sleep(delayMs);
      attempt += 1;
    }
  }

  throw lastError || new Error('Rate limit backoff exhausted');
}

module.exports = {
  withRateLimitBackoff,
  isRateLimitError,
  computeBackoffDelayMs,
  DEFAULT_MAX_RETRIES,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
};
