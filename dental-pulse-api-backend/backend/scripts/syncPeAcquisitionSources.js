/**
 * Run one Patient Economics acquisition_sources sync chunk for a practice.
 *
 * Usage:
 *   node backend/scripts/syncPeAcquisitionSources.js <practice_id>
 *
 * Call repeatedly while the result shows hasMore: true.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { syncAcquisitionSources } = require('../services/patientEconomics/sync/syncAcquisitionSources');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node syncPeAcquisitionSources.js <practice_id>');
  process.exit(1);
}

async function main() {
  try {
    console.log(`[PE sync] acquisition_sources chunk for practice ${practiceId}...`);
    const result = await syncAcquisitionSources(practiceId);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
