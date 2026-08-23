/**
 * Validate a Dentally PAT via GET /v1/user.
 * Never log the PAT or include it in error messages.
 */

const VALIDATE_TIMEOUT_MS = Number(process.env.DENTALLY_VALIDATE_TIMEOUT_MS || 15000);

function getDentallyBaseUrl() {
  return (process.env.DENTALLY_API_BASE_URL || 'https://api.dentally.co').replace(/\/$/, '');
}

async function isRateLimitResponse(response) {
  if (response.status !== 403) return false;
  try {
    const text = await response.clone().text();
    return text.includes('Rate limit') || text.includes('rate_limit');
  } catch {
    return false;
  }
}

/**
 * @param {string} pat — decrypted PAT (in-memory only)
 * @returns {Promise<
 *   { status: 'valid' }
 *   | { status: 'auth_error', message: string }
 *   | { status: 'unreachable', message: string }
 * >}
 */
async function validatePatWithDentally(pat) {
  const url = `${getDentallyBaseUrl()}/v1/user`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DentPulse/1.0',
      },
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    });

    if (response.ok) {
      return { status: 'valid' };
    }

    if (response.status === 401) {
      return {
        status: 'auth_error',
        message: 'Token saved, but Dentally rejected it. Check the PAT and try again.',
      };
    }

    if (response.status === 403) {
      if (await isRateLimitResponse(response)) {
        return {
          status: 'unreachable',
          message: 'Token saved, but Dentally rate-limited validation. Try again in a minute.',
        };
      }
      return {
        status: 'auth_error',
        message: 'Token saved, but Dentally rejected it. Check the PAT and try again.',
      };
    }

    if (response.status >= 500) {
      return {
        status: 'unreachable',
        message: 'Token saved, but Dentally\'s API is unavailable right now. Try again later.',
      };
    }

    return {
      status: 'auth_error',
      message: 'Token saved, but Dentally could not validate this token.',
    };
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    console.error(
      '[EconomicsEngine] Dentally validation failed:',
      isTimeout ? 'request timed out' : (err?.message || 'network error'),
    );
    return {
      status: 'unreachable',
      message: isTimeout
        ? 'Token saved, but Dentally timed out. Try validating again later.'
        : 'Token saved, but Dentally\'s API could not be reached. Try again later.',
    };
  }
}

module.exports = { validatePatWithDentally, getDentallyBaseUrl };
