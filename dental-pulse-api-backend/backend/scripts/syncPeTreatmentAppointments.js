/**
 * Run one Patient Economics treatment_appointments sync chunk (bypasses HTTP).
 *
 * Usage:
 *   node backend/scripts/syncPeTreatmentAppointments.js <practice_id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { syncTreatmentAppointments } = require('../services/patientEconomics/sync/syncTreatmentAppointments');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node syncPeTreatmentAppointments.js <practice_id>');
  process.exit(1);
}

async function main() {
  try {
    console.log(`[PE sync] treatment_appointments chunk for practice ${practiceId}...`);
    const result = await syncTreatmentAppointments(practiceId);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success && result.errorCode !== 'RATE_LIMIT_RETRY') process.exit(1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
