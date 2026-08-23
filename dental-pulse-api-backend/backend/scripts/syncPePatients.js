/**
 * Run one Patient Economics patients sync chunk for a practice (bypasses HTTP).
 *
 * Usage:
 *   node backend/scripts/syncPePatients.js <practice_id>
 *
 * Call repeatedly while the result shows hasMore: true.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { syncPatients } = require('../services/patientEconomics/sync/syncPatients');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node syncPePatients.js <practice_id>');
  process.exit(1);
}

async function main() {
  try {
    console.log(`[PE sync] patients chunk for practice ${practiceId}...`);
    const result = await syncPatients(practiceId);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
