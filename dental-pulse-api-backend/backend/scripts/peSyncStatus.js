/**
 * Print PE sync cursor status for a practice.
 *
 * Usage:
 *   node backend/scripts/peSyncStatus.js <practice_id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { getSyncStatusByPractice } = require('../services/patientEconomics/sync/cursorStore');
const {
  getPracticePatValidity,
} = require('../services/patientEconomics/sync/credentialsStatus');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node peSyncStatus.js <practice_id>');
  process.exit(1);
}

async function main() {
  const pat = await getPracticePatValidity(practiceId);
  console.log(
    `PAT: ok=${pat.ok}` +
      (pat.ok ? '' : ` reason=${pat.reason}`) +
      (pat.row?.validated_at ? ` validated_at=${pat.row.validated_at}` : '')
  );

  const rows = await getSyncStatusByPractice(practiceId);
  if (rows.length === 0) {
    console.log('No sync_cursors rows for scheduled resources.');
    return;
  }

  console.log(
    'resource_type'.padEnd(24) +
      'status'.padEnd(14) +
      'updated_at'.padEnd(26) +
      'last_error'
  );
  for (const r of rows) {
    console.log(
      String(r.resourceType).padEnd(24) +
        String(r.status || '').padEnd(14) +
        String(r.updatedAt || '').padEnd(26) +
        String(r.lastError || r.lastErrorCode || '')
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
