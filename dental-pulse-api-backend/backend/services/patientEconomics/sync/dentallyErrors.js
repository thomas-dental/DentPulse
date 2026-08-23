/**
 * Classify Dentally API errors for Patient Economics sync.
 * Never include PAT or raw tokens in messages returned to callers.
 */

const AUTH_ERROR_MESSAGE =
  'PAT expired or invalid — Dentally rejected the token. Re-enter the PAT in Settings.';

const RATE_LIMIT_MESSAGE =
  'Dentally rate limit reached. Retry this sync chunk later.';

const RATE_LIMIT_RETRY_MESSAGE =
  'Dentally rate limit persisted after retries. Chunk paused — will resume from this page on the next invocation.';

/**
 * @param {unknown} err
 * @returns {{ kind: 'pat_auth' | 'rate_limit' | 'other', message: string, httpStatus?: number }}
 */
function classifyDentallyFetchError(err) {
  if (err && typeof err === 'object' && err.isRateLimit) {
    return { kind: 'rate_limit', message: RATE_LIMIT_MESSAGE };
  }

  const msg = err instanceof Error ? err.message : String(err);

  const apiMatch = msg.match(/Dentally API error \((\d+)\)/);
  if (apiMatch) {
    const status = Number(apiMatch[1]);
    if (status === 401) {
      return { kind: 'pat_auth', message: AUTH_ERROR_MESSAGE, httpStatus: status };
    }
    if (status === 403) {
      if (/rate limit/i.test(msg)) {
        return { kind: 'rate_limit', message: RATE_LIMIT_MESSAGE, httpStatus: status };
      }
      return { kind: 'pat_auth', message: AUTH_ERROR_MESSAGE, httpStatus: status };
    }
  }

  if (/HTTP 401/.test(msg)) {
    return { kind: 'pat_auth', message: AUTH_ERROR_MESSAGE, httpStatus: 401 };
  }
  if (/HTTP 403/.test(msg) && !/rate limit/i.test(msg)) {
    return { kind: 'pat_auth', message: AUTH_ERROR_MESSAGE, httpStatus: 403 };
  }
  if (/RATE_LIMIT_EXHAUSTED/.test(msg)) {
    return { kind: 'rate_limit', message: RATE_LIMIT_MESSAGE };
  }

  return { kind: 'other', message: msg || 'Unknown Dentally sync error' };
}

module.exports = {
  classifyDentallyFetchError,
  AUTH_ERROR_MESSAGE,
  RATE_LIMIT_MESSAGE,
  RATE_LIMIT_RETRY_MESSAGE,
};
