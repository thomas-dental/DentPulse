/**
 * Run one Patient Economics recalls sync chunk for a practice (bypasses HTTP).
 *
 * Usage:
 *   node backend/scripts/syncPeRecalls.js <practice_id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { syncRecalls } = require('../services/patientEconomics/sync/syncRecalls');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node syncPeRecalls.js <practice_id>');
  process.exit(1);
}

async function main() {
  try {
    console.log(`[PE sync] recalls chunk for practice ${practiceId}...`);
    const result = await syncRecalls(practiceId);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success && result.errorCode !== 'RATE_LIMIT_RETRY') process.exit(1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
