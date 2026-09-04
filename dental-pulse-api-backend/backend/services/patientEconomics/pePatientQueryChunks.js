/**
 * Chunk large patient_id IN lists to avoid PostgREST 414 URI Too Large.
 */

const PATIENT_CHUNK = 100;

async function forEachPatientChunk(patientIds, fn, chunkSize = PATIENT_CHUNK) {
  for (let i = 0; i < patientIds.length; i += chunkSize) {
    await fn(patientIds.slice(i, i + chunkSize));
  }
}

/**
 * Run a Supabase query per patient chunk and merge row arrays.
 * @param {string[]} patientIds
 * @param {(chunk: string[]) => Promise<{ data: unknown[] | null; error: unknown }>} buildQuery
 * @param {number} [chunkSize]
 */
async function queryInPatientChunks(patientIds, buildQuery, chunkSize = PATIENT_CHUNK) {
  const rows = [];
  await forEachPatientChunk(patientIds, async (chunk) => {
    const { data, error } = await buildQuery(chunk);
    if (error) throw error;
    rows.push(...(data ?? []));
  }, chunkSize);
  return rows;
}

/**
 * Run a count query per patient chunk and sum totals.
 * @param {string[]} patientIds
 * @param {(chunk: string[]) => Promise<{ count: number | null; error: unknown }>} buildQuery
 * @param {number} [chunkSize]
 */
async function sumCountInPatientChunks(patientIds, buildQuery, chunkSize = PATIENT_CHUNK) {
  let total = 0;
  await forEachPatientChunk(patientIds, async (chunk) => {
    const { count, error } = await buildQuery(chunk);
    if (error) throw error;
    total += count ?? 0;
  }, chunkSize);
  return total;
}

module.exports = {
  PATIENT_CHUNK,
  forEachPatientChunk,
  queryInPatientChunks,
  sumCountInPatientChunks,
};
