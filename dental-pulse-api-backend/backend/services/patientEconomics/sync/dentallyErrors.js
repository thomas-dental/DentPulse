/**
 * Classify Dentally / PE sync errors into actionable categories.
 *
 * Categories (see sync/README.md):
 *   transient  — network timeout, 5xx, rate-limit exhausted → auto-retry (capped)
 *   pat_auth   — 401/403 invalid PAT → no auto-retry; needs reconnection
 *   data       — per-record transform/validation (handled at record level, not here)
 *   unknown    — everything else → limited auto-retry then terminal failed
 *
 * Never include PAT or raw tokens in messages returned to callers.
 */

const AUTH_ERROR_MESSAGE =
  'PAT expired or invalid — Dentally rejected the token. Re-enter the PAT in Settings.';

const RATE_LIMIT_MESSAGE =
  'Dentally rate limit reached. Retry this sync chunk later.';

const RATE_LIMIT_RETRY_MESSAGE =
  'Dentally rate limit persisted after retries. Chunk paused — will resume from this page on the next invocation.';

const TRANSIENT_MESSAGE =
  'Transient Dentally/network error. Sync will retry automatically.';

/**
 * @typedef {'transient' | 'pat_auth' | 'unknown'} SyncErrorKind
 * @typedef {{ kind: SyncErrorKind, message: string, httpStatus?: number, code: string }} ClassifiedSyncError
 */

/**
 * @param {unknown} err
 * @returns {ClassifiedSyncError}
 */
function classifyDentallyFetchError(err) {
  if (err && typeof err === 'object' && err.isRateLimit) {
    return {
      kind: 'transient',
      message: RATE_LIMIT_RETRY_MESSAGE,
      code: 'RATE_LIMIT_RETRY',
    };
  }

  const msg = err instanceof Error ? err.message : String(err);

  const apiMatch = msg.match(/Dentally API error \((\d+)\)/);
  if (apiMatch) {
    const status = Number(apiMatch[1]);
    if (status === 401) {
      return { kind: 'pat_auth', message: AUTH_ERROR_MESSAGE, httpStatus: status, code: 'PAT_EXPIRED_OR_INVALID' };
    }
    if (status === 403) {
      if (/rate limit/i.test(msg)) {
        return {
          kind: 'transient',
          message: RATE_LIMIT_RETRY_MESSAGE,
          httpStatus: status,
          code: 'RATE_LIMIT_RETRY',
        };
      }
      return { kind: 'pat_auth', message: AUTH_ERROR_MESSAGE, httpStatus: status, code: 'PAT_EXPIRED_OR_INVALID' };
    }
    if (status >= 500 && status <= 599) {
      return {
        kind: 'transient',
        message: TRANSIENT_MESSAGE,
        httpStatus: status,
        code: 'DENTALLY_5XX',
      };
    }
  }

  if (/HTTP 401/.test(msg)) {
    return { kind: 'pat_auth', message: AUTH_ERROR_MESSAGE, httpStatus: 401, code: 'PAT_EXPIRED_OR_INVALID' };
  }
  if (/HTTP 403/.test(msg) && !/rate limit/i.test(msg)) {
    return { kind: 'pat_auth', message: AUTH_ERROR_MESSAGE, httpStatus: 403, code: 'PAT_EXPIRED_OR_INVALID' };
  }
  if (/HTTP 5\d\d/.test(msg) || /Dentally API error \(5\d\d\)/.test(msg)) {
    return { kind: 'transient', message: TRANSIENT_MESSAGE, code: 'DENTALLY_5XX' };
  }

  if (/RATE_LIMIT_EXHAUSTED/.test(msg)) {
    return { kind: 'transient', message: RATE_LIMIT_RETRY_MESSAGE, code: 'RATE_LIMIT_RETRY' };
  }

  // Timeouts / network blips
  if (
    /timeout/i.test(msg)
    || /ETIMEDOUT/i.test(msg)
    || /ECONNRESET/i.test(msg)
    || /ECONNREFUSED/i.test(msg)
    || /ENOTFOUND/i.test(msg)
    || /socket hang up/i.test(msg)
    || /network/i.test(msg)
    || /fetch failed/i.test(msg)
    || /AbortError/i.test(msg)
  ) {
    return { kind: 'transient', message: TRANSIENT_MESSAGE, code: 'NETWORK_TRANSIENT' };
  }

  return {
    kind: 'unknown',
    message: msg || 'Unknown Dentally sync error',
    code: 'SYNC_ERROR',
  };
}

module.exports = {
  classifyDentallyFetchError,
  AUTH_ERROR_MESSAGE,
  RATE_LIMIT_MESSAGE,
  RATE_LIMIT_RETRY_MESSAGE,
  TRANSIENT_MESSAGE,
};
