/**
 * Backfill missing PE event_ledger rows from already-synced tables.
 *
 * Usage:
 *   node backend/scripts/backfillPeEventLedger.js <practice_id>
 *   node backend/scripts/backfillPeEventLedger.js <practice_id> --entities=treatment_plans,invoices
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const {
  backfillPracticeEventLedger,
  BACKFILL_SPECS,
} = require('../services/patientEconomics/sync/eventLedgerBackfill');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node backfillPeEventLedger.js <practice_id> [--entities=alias1,alias2]');
  console.error(`Entities: ${BACKFILL_SPECS.map((s) => s.alias).join(', ')}`);
  process.exit(1);
}

const entitiesArg = process.argv.find((a) => a.startsWith('--entities='));
const entities = entitiesArg
  ? entitiesArg.slice('--entities='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : undefined;

async function main() {
  console.log(`[PE ledger backfill] practice ${practiceId}`);
  if (entities?.length) {
    console.log(`[PE ledger backfill] entities: ${entities.join(', ')}`);
  }

  const result = await backfillPracticeEventLedger(practiceId, {
    entities,
    onProgress: (p) => console.log('[PE ledger backfill] progress:', JSON.stringify(p)),
  });

  console.log(JSON.stringify({ success: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
