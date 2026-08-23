/**
 * Patient Economics — sync one chunk of Dentally patients into public.patients.
 */

const { RESOURCE_PATIENTS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');

async function syncPatients(practiceId) {
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_PATIENTS,
    entityAlias: 'patients',
  });
}

module.exports = { syncPatients };
