/**
 * Smoke-test PE schedule kickoff (does not wait for resume chunks).
 *
 * Usage:
 *   node backend/scripts/testPeScheduleKickoff.js [practice_id]
 *
 * With practice_id: kickoff incremental for that practice, print status.
 * Without: run incremental tick for all encrypted-PAT practices (cap env).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const {
  kickoffIncremental,
  runIncrementalKickoffTick,
} = require('../services/patientEconomics/sync/peScheduleKickoff');
const { getSyncStatusByPractice } = require('../services/patientEconomics/sync/cursorStore');

const practiceId = process.argv[2] || null;

async function main() {
  if (practiceId) {
    console.log(`[test] kickoffIncremental ${practiceId}`);
    const result = await kickoffIncremental(practiceId);
    console.log(JSON.stringify(result, null, 2));
    const status = await getSyncStatusByPractice(practiceId);
    console.log(
      'cursors:',
      status.map((r) => `${r.resourceType}=${r.status}`).join(', ')
    );
    return;
  }

  console.log('[test] runIncrementalKickoffTick (all candidates)');
  const tick = await runIncrementalKickoffTick();
  console.log(
    JSON.stringify(
      {
        practices: tick.practices,
        kicked: tick.kicked,
        skipped: tick.skipped,
        results: tick.results.map((r) => ({
          practiceId: r.practiceId,
          action: r.action,
          reason: r.reason,
        })),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
