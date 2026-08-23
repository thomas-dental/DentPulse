/**
 * Patient Economics — sync one chunk of Dentally patients into public.patients.
 *
 * Reuses the existing patients table and upsert/transform pipeline from the
 * main Dentally integration (no duplicate table). Chunk size: 1 API page.
 */

const { supabaseAdmin } = require('../../../config/supabase');
const { decryptPAT } = require('../patEncryption');
const { getDentallyBaseUrl } = require('../validatePat');
const {
  fetchDentallyPage,
  extractRecords,
  PER_PAGE,
} = require('../../../api/dentally/client');
const { upsertEntityData } = require('../../sync/upsert');
const { classifyDentallyFetchError } = require('./dentallyErrors');
const {
  RESOURCE_PATIENTS,
  parsePatientsCursor,
  serializePatientsCursor,
  getOrCreateCursor,
  updateCursor,
} = require('./cursorStore');
const { createSyncRun, completeSyncRun } = require('./syncRunStore');

async function loadPracticePat(practiceId) {
  const { data: row, error } = await supabaseAdmin
    .from('dentally_credentials')
    .select('encrypted_pat, encrypted_pat_iv')
    .eq('practice_id', practiceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load PAT: ${error.message}`);
  }
  if (!row) {
    const err = new Error('No Dentally PAT saved for this practice');
    err.code = 'NO_CREDENTIAL';
    throw err;
  }

  return decryptPAT(row.encrypted_pat, row.encrypted_pat_iv);
}

async function resolveUserIdForPractice(practiceId) {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('user_id')
    .eq('id', practiceId)
    .maybeSingle();

  return org?.user_id || null;
}

async function markSyncFailed(practiceId, syncRunId, errorMessage) {
  await updateCursor(practiceId, RESOURCE_PATIENTS, { status: 'failed' });
  if (syncRunId) {
    await completeSyncRun(syncRunId, 'failed', errorMessage);
  }
}

/**
 * Process one patients chunk for a practice.
 *
 * @param {string} practiceId — organizations.id
 * @returns {Promise<{
 *   success: boolean,
 *   complete: boolean,
 *   hasMore: boolean,
 *   page: number,
 *   processed: number,
 *   failed: number,
 *   syncRunId: string|null,
 *   cursorStatus: string,
 *   error?: string,
 *   errorCode?: string,
 * }>}
 */
async function syncPatients(practiceId) {
  const cursorRow = await getOrCreateCursor(practiceId, RESOURCE_PATIENTS);

  if (cursorRow.status === 'complete') {
    return {
      success: true,
      complete: true,
      hasMore: false,
      page: parsePatientsCursor(cursorRow.cursor).page,
      processed: 0,
      failed: 0,
      syncRunId: parsePatientsCursor(cursorRow.cursor).syncRunId,
      cursorStatus: 'complete',
    };
  }

  let { page, syncRunId } = parsePatientsCursor(cursorRow.cursor);

  if (cursorRow.status === 'failed') {
    await updateCursor(practiceId, RESOURCE_PATIENTS, { status: 'in_progress' });
  }

  if (page === 1 && !syncRunId) {
    const run = await createSyncRun(practiceId);
    syncRunId = run.id;
  }

  let pat;
  try {
    pat = await loadPracticePat(practiceId);
  } catch (err) {
    if (err.code === 'NO_CREDENTIAL') {
      return {
        success: false,
        complete: false,
        hasMore: false,
        page,
        processed: 0,
        failed: 0,
        syncRunId,
        cursorStatus: cursorRow.status,
        error: err.message,
        errorCode: 'NO_CREDENTIAL',
      };
    }
    throw err;
  }

  const userId = await resolveUserIdForPractice(practiceId);
  const apiEndpoint = getDentallyBaseUrl();

  let responseData;
  try {
    responseData = await fetchDentallyPage(
      pat,
      apiEndpoint,
      'patients',
      page,
      null,
      null
    );
  } catch (err) {
    pat = null;
    const classified = classifyDentallyFetchError(err);
    const errorMessage = classified.message;

    if (classified.kind === 'pat_auth' || classified.kind === 'rate_limit') {
      await markSyncFailed(practiceId, syncRunId, errorMessage);
      return {
        success: false,
        complete: false,
        hasMore: false,
        page,
        processed: 0,
        failed: 0,
        syncRunId,
        cursorStatus: 'failed',
        error: errorMessage,
        errorCode: classified.kind === 'pat_auth' ? 'PAT_EXPIRED_OR_INVALID' : 'RATE_LIMIT',
      };
    }

    await markSyncFailed(practiceId, syncRunId, errorMessage);
    return {
      success: false,
      complete: false,
      hasMore: false,
      page,
      processed: 0,
      failed: 0,
      syncRunId,
      cursorStatus: 'failed',
      error: errorMessage,
      errorCode: 'SYNC_ERROR',
    };
  } finally {
    pat = null;
  }

  const { records, totalPages } = extractRecords(responseData, 'patients');
  const upsertResult = await upsertEntityData(
    'patients',
    practiceId,
    userId,
    records,
    {},
    null,
    null
  );

  const pageCount = totalPages ?? (records.length < PER_PAGE ? page : page + 1);
  const isLastPage =
    records.length === 0 ||
    (totalPages != null ? page >= totalPages : records.length < PER_PAGE);

  if (isLastPage) {
    await updateCursor(practiceId, RESOURCE_PATIENTS, {
      cursor: serializePatientsCursor(page, syncRunId),
      status: 'complete',
    });
    if (syncRunId) {
      await completeSyncRun(syncRunId, 'completed');
    }

    return {
      success: true,
      complete: true,
      hasMore: false,
      page,
      processed: upsertResult.processed,
      failed: upsertResult.failed,
      syncRunId,
      cursorStatus: 'complete',
      totalPages: pageCount,
    };
  }

  const nextPage = page + 1;
  await updateCursor(practiceId, RESOURCE_PATIENTS, {
    cursor: serializePatientsCursor(nextPage, syncRunId),
    status: 'in_progress',
  });

  return {
    success: true,
    complete: false,
    hasMore: true,
    page,
    nextPage,
    processed: upsertResult.processed,
    failed: upsertResult.failed,
    syncRunId,
    cursorStatus: 'in_progress',
    totalPages,
  };
}

module.exports = { syncPatients };
