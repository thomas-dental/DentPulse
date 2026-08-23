/**
 * Run one Patient Economics treatment_plans sync chunk for a practice (bypasses HTTP).
 *
 * Usage:
 *   node backend/scripts/syncPeTreatmentPlans.js <practice_id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { syncTreatmentPlans } = require('../services/patientEconomics/sync/syncTreatmentPlans');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node syncPeTreatmentPlans.js <practice_id>');
  process.exit(1);
}

async function main() {
  try {
    console.log(`[PE sync] treatment_plans chunk for practice ${practiceId}...`);
    const result = await syncTreatmentPlans(practiceId);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success && result.errorCode !== 'RATE_LIMIT_RETRY') process.exit(1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
