/**
 * Patient Economics — sync Dentally acquisition sources into
 * public.acquisition_sources (reference catalog for patient marketing source).
 */

const { RESOURCE_ACQUISITION_SOURCES } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');

async function syncAcquisitionSources(practiceId) {
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_ACQUISITION_SOURCES,
    entityAlias: 'acquisition_sources',
  });
}

module.exports = { syncAcquisitionSources };
