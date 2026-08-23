/**
 * Patient Economics — sync one chunk of patient recall fields into public.patients.
 *
 * Dentally has no /v1/recalls list endpoint. Recall due dates, intervals, and
 * preferred contact method live on GET /v1/patients. This sync uses a separate
 * sync_cursors track (resource_type: recalls) so recall refresh can be scheduled
 * independently from the full patients backfill.
 */

const { RESOURCE_RECALLS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');

async function syncRecalls(practiceId) {
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_RECALLS,
    entityAlias: 'patients',
  });
}

module.exports = { syncRecalls };
