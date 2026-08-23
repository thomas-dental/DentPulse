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
  parsePageCursor,
  serializePageCursor,
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

async function markSyncFailed(practiceId, resourceType, syncRunId, errorMessage) {
  await updateCursor(practiceId, resourceType, { status: 'failed' });
  if (syncRunId) {
    await completeSyncRun(syncRunId, 'failed', errorMessage);
  }
}

/**
 * Process one Dentally list-resource chunk (1 API page).
 *
 * @param {string} practiceId
 * @param {{
 *   resourceType: string,
 *   entityAlias: string,
 *   entityConfigOverride?: object|null,
 *   enrichRecords?: (records: object[], pat: string, apiEndpoint: string) => Promise<object[]>,
 * }} options
 */
async function syncResourceChunk(practiceId, options) {
  const { resourceType, entityAlias, entityConfigOverride = null, enrichRecords = null } = options;

  const cursorRow = await getOrCreateCursor(practiceId, resourceType);

  if (cursorRow.status === 'complete') {
    const parsed = parsePageCursor(cursorRow.cursor);
    return {
      success: true,
      complete: true,
      hasMore: false,
      page: parsed.page,
      processed: 0,
      failed: 0,
      syncRunId: parsed.syncRunId,
      cursorStatus: 'complete',
      resourceType,
    };
  }

  let { page, syncRunId } = parsePageCursor(cursorRow.cursor);

  if (cursorRow.status === 'failed') {
    await updateCursor(practiceId, resourceType, { status: 'in_progress' });
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
        resourceType,
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
      entityAlias,
      page,
      null,
      null,
      entityConfigOverride || undefined
    );
  } catch (err) {
    pat = null;
    const classified = classifyDentallyFetchError(err);
    const errorMessage = classified.message;

    if (classified.kind === 'pat_auth' || classified.kind === 'rate_limit') {
      await markSyncFailed(practiceId, resourceType, syncRunId, errorMessage);
      return {
        success: false,
        complete: false,
        hasMore: false,
        page,
        processed: 0,
        failed: 0,
        syncRunId,
        cursorStatus: 'failed',
        resourceType,
        error: errorMessage,
        errorCode: classified.kind === 'pat_auth' ? 'PAT_EXPIRED_OR_INVALID' : 'RATE_LIMIT',
      };
    }

    await markSyncFailed(practiceId, resourceType, syncRunId, errorMessage);
    return {
      success: false,
      complete: false,
      hasMore: false,
      page,
      processed: 0,
      failed: 0,
      syncRunId,
      cursorStatus: 'failed',
      resourceType,
      error: errorMessage,
      errorCode: 'SYNC_ERROR',
    };
  }

  let { records, totalPages } = extractRecords(responseData, entityAlias);

  if (enrichRecords && records.length > 0) {
    try {
      records = await enrichRecords(records, pat, apiEndpoint);
    } catch (err) {
      pat = null;
      const classified = classifyDentallyFetchError(err);
      const errorMessage = classified.message;
      await markSyncFailed(practiceId, resourceType, syncRunId, errorMessage);
      return {
        success: false,
        complete: false,
        hasMore: false,
        page,
        processed: 0,
        failed: 0,
        syncRunId,
        cursorStatus: 'failed',
        resourceType,
        error: errorMessage,
        errorCode: classified.kind === 'pat_auth'
          ? 'PAT_EXPIRED_OR_INVALID'
          : classified.kind === 'rate_limit'
            ? 'RATE_LIMIT'
            : 'SYNC_ERROR',
      };
    }
  }

  pat = null;

  const upsertResult = await upsertEntityData(
    entityAlias,
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
    await updateCursor(practiceId, resourceType, {
      cursor: serializePageCursor(page, syncRunId),
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
      resourceType,
      totalPages: pageCount,
    };
  }

  const nextPage = page + 1;
  await updateCursor(practiceId, resourceType, {
    cursor: serializePageCursor(nextPage, syncRunId),
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
    resourceType,
    totalPages,
  };
}

module.exports = {
  loadPracticePat,
  resolveUserIdForPractice,
  markSyncFailed,
  syncResourceChunk,
};
