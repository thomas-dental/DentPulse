/**
 * Request-scoped AI key context.
 *
 * Interactive AI endpoints run their handler inside runWithUser({ userId,
 * apiKey }, next). Everything that happens during that request — however deep
 * in the call stack — can then read the pinned per-user key via getStore(),
 * without threading userId through responseFormatter / dashboardOrchestrator /
 * llmClassifier by hand. AsyncLocalStorage keeps this correct across concurrent
 * requests (unlike a module-level global) and across await boundaries.
 *
 * Background / cron work never enters this context, so getStore() returns null
 * there and getOrgApiKey() falls back to the org/.env key as before.
 */
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

module.exports = {
  /** Run `fn` (typically Express `next`) with the given store bound. */
  runWithUser(store, fn) {
    return als.run(store, fn);
  },
  /** The current request's { userId, apiKey } store, or null outside one. */
  getStore() {
    return als.getStore() || null;
  },
};
