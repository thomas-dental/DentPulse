/**
 * Short TTL in-memory cache for PE read rollups (avoids duplicate work when
 * multiple tabs load the same endpoint simultaneously).
 */

const DEFAULT_TTL_MS = 90_000;
const store = new Map();

function cacheKey(endpoint, practiceId, extra = '') {
  return `${endpoint}:${practiceId}:${extra}`;
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * @param {string} endpoint
 * @param {string} practiceId
 * @param {() => Promise<T>} loader
 * @param {{ extra?: string; ttlMs?: number }} [options]
 * @returns {Promise<T>}
 */
async function withPeReadCache(endpoint, practiceId, loader, options = {}) {
  const key = cacheKey(endpoint, practiceId, options.extra ?? '');
  const cached = get(key);
  if (cached != null) return cached;
  const value = await loader();
  set(key, value, options.ttlMs ?? DEFAULT_TTL_MS);
  return value;
}

module.exports = {
  withPeReadCache,
  cacheKey,
};
