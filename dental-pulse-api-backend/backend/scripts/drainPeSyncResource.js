/**
 * Drain a PE sync resource until complete or max chunks.
 *
 * Usage:
 *   node backend/scripts/drainPeSyncResource.js <practice_id> <resource>
 *
 * Resources: invoices, payments, patients, accounts, appointments,
 *   treatment_plans, treatment_items, treatment_appointments, recalls,
 *   acquisition_sources, practitioners
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { getSyncFn } = require('../services/patientEconomics/sync/resourceRegistry');

const practiceId = process.argv[2];
const resource = process.argv[3];
const maxChunks = Number(process.argv[4] || 100);

if (!practiceId || !resource) {
  console.error('Usage: node drainPeSyncResource.js <practice_id> <resource> [maxChunks]');
  process.exit(1);
}

const syncFn = getSyncFn(resource);
if (!syncFn) {
  console.error(`Unknown resource: ${resource}`);
  process.exit(1);
}

async function main() {
  let chunks = 0;
  let processed = 0;

  for (let i = 0; i < maxChunks; i += 1) {
    const result = await syncFn(practiceId);
    chunks += 1;
    processed += result.processed || 0;
    console.log(
      `[PE drain] ${resource} chunk ${chunks}:`,
      JSON.stringify({
        success: result.success,
        complete: result.complete,
        hasMore: result.hasMore,
        page: result.page,
        chunkStart: result.chunkStart,
        chunkEnd: result.chunkEnd,
        processed: result.processed,
        cursorStatus: result.cursorStatus,
        errorCode: result.errorCode,
      }),
    );

    if (!result.success && result.errorCode !== 'RATE_LIMIT_RETRY') {
      throw new Error(result.error || result.errorCode || 'sync failed');
    }
    if (result.complete || !result.hasMore) {
      console.log(JSON.stringify({ success: true, resource, chunks, processed, complete: true }, null, 2));
      return;
    }
  }

  console.log(
    JSON.stringify(
      { success: true, resource, chunks, processed, complete: false, reason: 'max_chunks' },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
