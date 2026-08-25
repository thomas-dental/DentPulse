/**
 * Run one Patient Economics payments sync chunk for a practice.
 *
 * Usage:
 *   node backend/scripts/syncPePayments.js <practice_id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { syncPayments } = require('../services/patientEconomics/sync/syncPayments');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node syncPePayments.js <practice_id>');
  process.exit(1);
}

async function main() {
  try {
    console.log(`[PE sync] payments chunk for practice ${practiceId}...`);
    const result = await syncPayments(practiceId);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success && result.errorCode !== 'RATE_LIMIT_RETRY') process.exit(1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
