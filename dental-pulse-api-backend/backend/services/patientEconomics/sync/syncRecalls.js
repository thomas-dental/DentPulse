/**
 * Patient Economics — sync one chunk of patient recall fields into public.patients.
 *
 * Dentally has no /v1/recalls list endpoint. Recall due dates, intervals, and
 * preferred contact method live on GET /v1/patients. This sync uses a separate
 * sync_cursors track (resource_type: recalls) so recall refresh can be scheduled
 * independently from the full patients backfill.
 *
 * Window: practice onboarding start_date → today (same as patients).
 *
 * Event Ledger (via upsertPePage → eventLedgerWriter, entityAlias patients):
 *   RECALL_DUE / RECALL_OVERDUE — dentist/hygienist recall dates vs UTC today
 *   (no Dentally status field; overdue = due_date < today).
 *   PATIENT_REACTIVATED — is_active false→true (transition-only).
 */

const {
  RESOURCE_RECALLS,
  getOrCreateCursor,
  parsePageCursor,
} = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');
const { getPracticeSyncRange } = require('./practiceSyncRange');

async function syncRecalls(practiceId) {
  const { startDate } = await getPracticeSyncRange(practiceId);
  const cursorRow = await getOrCreateCursor(practiceId, RESOURCE_RECALLS);
  const { kickoffMode } = parsePageCursor(cursorRow.cursor);
  const incremental = kickoffMode === 'incremental';

  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_RECALLS,
    entityAlias: 'patients',
    entityConfigOverride: incremental
      ? {
          dateFilter: 'updated_after',
          dateFilterEnd: null,
          sortBy: 'created_at',
        }
      : {
          dateFilter: 'created_after',
          dateFilterEnd: 'created_before',
          sortBy: 'created_at',
        },
    dateChunking: {
      rangeStart: startDate,
    },
  });
}

module.exports = { syncRecalls };
