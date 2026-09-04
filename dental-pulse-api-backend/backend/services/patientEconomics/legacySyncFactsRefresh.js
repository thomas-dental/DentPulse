/**
 * Refresh PE contribution facts after legacy JobQueue sync batches finish
 * (onboarding, auto-sync, manual Dentally sync).
 *
 * PE sync already refreshes per invoice page in upsertPePage.js; legacy sync
 * writes platform_integration_invoices without that hook. Debounce so one full
 * refresh runs when the last job in a batch reaches a terminal state.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { refreshPeContributionFacts } = require('./refreshPeContributionFacts');

const DEBOUNCE_MS = 5000;
const ACTIVE_STATUSES = ['queued', 'running'];

/** @type {Map<string, NodeJS.Timeout>} */
const debounceTimers = new Map();
/** @type {Map<string, Promise<void>>} */
const refreshInFlight = new Map();

function batchKey(practiceId, integrationId) {
  return `${practiceId}:${integrationId || 'none'}`;
}

async function countActiveSyncJobs(practiceId, integrationId) {
  let query = supabaseAdmin
    .from('sync_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', practiceId)
    .in('status', ACTIVE_STATUSES);

  if (integrationId) {
    query = query.eq('integration_id', integrationId);
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function runRefreshIfIdle(practiceId, integrationId) {
  const key = batchKey(practiceId, integrationId);
  if (refreshInFlight.has(key)) return;

  const active = await countActiveSyncJobs(practiceId, integrationId);
  if (active > 0) {
    console.log(
      `[Legacy sync] PE facts refresh deferred — ${active} sync job(s) still active ` +
        `for practice ${practiceId.slice(0, 8)}…`,
    );
    return;
  }

  console.log(
    `[Legacy sync] All sync jobs idle — refreshing PE contribution facts ` +
      `for practice ${practiceId.slice(0, 8)}…`,
  );

  const refreshPromise = refreshPeContributionFacts(practiceId)
    .then((result) => {
      console.log(
        `[Legacy sync] PE contribution facts refreshed: ` +
          `invoices=${result.invoiceCount} patients=${result.patientCount}`,
      );
    })
    .catch((err) => {
      console.error(
        `[Legacy sync] refreshPeContributionFacts failed for practice ${practiceId.slice(0, 8)}…: ` +
          `${err.message}`,
      );
    })
    .finally(() => {
      refreshInFlight.delete(key);
    });

  refreshInFlight.set(key, refreshPromise);
  await refreshPromise;
}

/**
 * Schedule a debounced facts refresh when this integration's JobQueue batch is idle.
 *
 * @param {{ practiceId: string, integrationId?: string|null }} opts
 */
function schedulePeFactsRefreshWhenLegacySyncBatchIdle({ practiceId, integrationId }) {
  if (!practiceId) return;

  const key = batchKey(practiceId, integrationId);
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      runRefreshIfIdle(practiceId, integrationId).catch((err) => {
        console.error(`[Legacy sync] PE facts refresh check failed: ${err.message}`);
      });
    }, DEBOUNCE_MS),
  );
}

module.exports = {
  schedulePeFactsRefreshWhenLegacySyncBatchIdle,
  countActiveSyncJobs,
};
