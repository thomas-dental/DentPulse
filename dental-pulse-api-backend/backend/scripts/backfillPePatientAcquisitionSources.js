/**
 * Backfill patient acquisition source id/name for an already-synced practice:
 * 1) Sync all acquisition_sources pages
 * 2) Reset patients cursor to page 1
 * 3) Re-sync all patients pages (upserts fill pt_acquisition_source_*)
 *
 * Usage:
 *   node backend/scripts/backfillPePatientAcquisitionSources.js <practice_id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const {
  RESOURCE_PATIENTS,
  resetCursor,
} = require('../services/patientEconomics/sync/cursorStore');
const { syncAcquisitionSources } = require('../services/patientEconomics/sync/syncAcquisitionSources');
const { syncPatients } = require('../services/patientEconomics/sync/syncPatients');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node backfillPePatientAcquisitionSources.js <practice_id>');
  process.exit(1);
}

async function runUntilDone(label, syncFn) {
  let chunks = 0;
  let processed = 0;
  let failed = 0;

  for (;;) {
    const result = await syncFn(practiceId);
    chunks += 1;
    processed += result.processed || 0;
    failed += result.failed || 0;
    console.log(`[PE backfill] ${label} chunk ${chunks}:`, JSON.stringify(result));

    if (!result.success) {
      throw new Error(`${label} sync failed: ${result.error || result.errorCode || 'unknown'}`);
    }
    if (result.complete || !result.hasMore) break;
  }

  return { chunks, processed, failed };
}

async function main() {
  try {
    console.log(`[PE backfill] acquisition sources for ${practiceId}...`);
    const sources = await runUntilDone('acquisition_sources', syncAcquisitionSources);

    console.log(`[PE backfill] resetting patients cursor...`);
    await resetCursor(practiceId, RESOURCE_PATIENTS);

    console.log(`[PE backfill] re-syncing patients for ${practiceId}...`);
    const patients = await runUntilDone('patients', syncPatients);

    console.log(JSON.stringify({ success: true, sources, patients }, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
