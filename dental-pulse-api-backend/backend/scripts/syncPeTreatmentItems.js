/**
 * Run one Patient Economics treatment_items sync chunk for a practice (bypasses HTTP).
 *
 * Usage:
 *   node backend/scripts/syncPeTreatmentItems.js <practice_id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { syncTreatmentItems } = require('../services/patientEconomics/sync/syncTreatmentItems');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node syncPeTreatmentItems.js <practice_id>');
  process.exit(1);
}

async function main() {
  try {
    console.log(`[PE sync] treatment_items chunk for practice ${practiceId}...`);
    const result = await syncTreatmentItems(practiceId);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success && result.errorCode !== 'RATE_LIMIT_RETRY') process.exit(1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
