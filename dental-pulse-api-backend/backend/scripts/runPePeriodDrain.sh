#!/usr/bin/env bash
# Sequential PE period drain. Order: payments → invoices → appointments →
# treatment_* → nhs_claims; accounts last (full catalog burns Dentally rate limit).
# nhs_claims uses Dentally job-queue (not PE cursors).
set -u
cd /home/cesar/mywork/dentalPulse/dentpulse-dentally-integration/dental-pulse-api-backend
PRACTICE=ab68878c-88eb-4383-8961-8b6b7dcfbd10
PERIOD_START="${PERIOD_START:-2026-07-01}"
PERIOD_END="${PERIOD_END:-2026-08-31}"
LOG=backend/scripts/.pe-period-drain.log
exec >>"$LOG" 2>&1
echo "[drain] started $(date -Is) pid=$$ window=${PERIOD_START}→${PERIOD_END}"

# Period-scoped PE resources first
for resource in payments invoices appointments treatment_appointments treatment_plans treatment_items; do
  echo "[drain] === starting $resource $(date -Is) ==="
  node backend/scripts/drainPeSyncResource.js "$PRACTICE" "$resource" 2000 || echo "[drain] $resource exited $?"
  echo "[drain] === done $resource $(date -Is) ==="
  sleep 2
done

# nhs_claims — Dentally job queue (date-windowed), before accounts
echo "[drain] === starting nhs_claims $(date -Is) ${PERIOD_START}→${PERIOD_END} ==="
node -e "
require('dotenv').config({ path: '.env' });
const { triggerSync } = require('./backend/queue');
triggerSync(process.argv[1], 'nhs_claims', null, true, {
  startDate: process.argv[2],
  endDate: process.argv[3],
}).then((r) => {
  console.log('[drain] nhs_claims jobs:', r.jobCount, 'skipped:', r.skipped);
}).catch((e) => {
  console.error('[drain] nhs_claims failed:', e.message);
  process.exitCode = 1;
});
" "$PRACTICE" "$PERIOD_START" "$PERIOD_END" || echo "[drain] nhs_claims exited $?"
echo "[drain] === done nhs_claims $(date -Is) ==="

# accounts last — full catalog burns Dentally rate limit
echo "[drain] === starting accounts $(date -Is) ==="
node backend/scripts/drainPeSyncResource.js "$PRACTICE" accounts 2000 || echo "[drain] accounts exited $?"
echo "[drain] === done accounts $(date -Is) ==="

node -e "
require('dotenv').config({ path: '.env' });
const { getSyncStatusByPractice } = require('./backend/services/patientEconomics/sync/cursorStore');
getSyncStatusByPractice(process.argv[1]).then(s => {
  console.log('[drain] FINAL STATUS');
  for (const r of s) console.log(r.resourceType.padEnd(24), r.status.padEnd(12), 'page='+(r.page??''));
}).catch(e => { console.error(e); process.exit(1); });
" "$PRACTICE"

echo "[drain] finished $(date -Is)"
