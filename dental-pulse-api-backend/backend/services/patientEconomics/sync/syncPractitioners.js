/**
 * Patient Economics — sync one chunk of Dentally practitioners into public.providers.
 *
 * Non-date entity (small list). Uses the same cursor/backoff pattern as other PE
 * syncs so partial failures resume instead of silently skipping clinicians.
 */

const { RESOURCE_PRACTITIONERS } = require('./cursorStore');
const { syncResourceChunk } = require('./syncHelpers');

async function syncPractitioners(practiceId) {
  return syncResourceChunk(practiceId, {
    resourceType: RESOURCE_PRACTITIONERS,
    entityAlias: 'practitioners',
  });
}

module.exports = { syncPractitioners };
