/**
 * Patient Economics — sync one chunk of Dentally patients into public.patients.
 *
 * Window: practice onboarding start_date → today (monthly created_after/before).
 * Incremental kickoff uses lookback window with updated_after.
 */

const {
  RESOURCE_PATIENTS,
  getOrCreateCursor,
  parsePageCursor,
} = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');
const { getPracticeSyncRange } = require('./practiceSyncRange');

async function syncPatients(practiceId) {
  const { startDate } = await getPracticeSyncRange(practiceId);
  const cursorRow = await getOrCreateCursor(practiceId, RESOURCE_PATIENTS);
  const { kickoffMode } = parsePageCursor(cursorRow.cursor);
  const incremental = kickoffMode === 'incremental';

  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_PATIENTS,
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

module.exports = { syncPatients };
