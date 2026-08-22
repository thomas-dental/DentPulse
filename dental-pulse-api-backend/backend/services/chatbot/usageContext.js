const { AsyncLocalStorage } = require('async_hooks');

/**
 * Per-request LLM usage accumulator. v2Handler wraps a turn in run(); every
 * claudeClient call (via tokenTracker) adds its token/cost into the active
 * store, so at the end of the turn we can surface a single "39.3s · 104,930
 * tokens · $0.04 · 6 tools" line under the answer (like the reference UI).
 *
 * No-ops safely when there's no active store (e.g. background jobs), so it
 * can't break a non-chat code path.
 */
const als = new AsyncLocalStorage();

function run(fn) {
  return als.run({ inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 }, fn);
}

function add({ inputTokens = 0, outputTokens = 0, costUsd = 0 } = {}) {
  const s = als.getStore();
  if (!s) return;
  s.inputTokens += inputTokens || 0;
  s.outputTokens += outputTokens || 0;
  s.costUsd += costUsd || 0;
  s.calls += 1;
}

function get() {
  return als.getStore() || null;
}

module.exports = { run, add, get };
