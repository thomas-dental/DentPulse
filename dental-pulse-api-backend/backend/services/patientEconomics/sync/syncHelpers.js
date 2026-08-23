const { supabaseAdmin } = require('../../../config/supabase');
const { decryptPAT } = require('../patEncryption');
const { getDentallyBaseUrl } = require('../validatePat');
const {
  fetchDentallyPage,
  extractRecords,
  PER_PAGE,
} = require('../../../api/dentally/client');
const { upsertEntityData } = require('../../sync/upsert');
const {
  classifyDentallyFetchError,
  RATE_LIMIT_RETRY_MESSAGE,
} = require('./dentallyErrors');
const { withRateLimitBackoff } = require('./rateLimitBackoff');
const {
  parsePageCursor,
  serializePageCursor,
  getOrCreateCursor,
  updateCursor,
  monthBounds,
  dayAfter,
  todayUtc,
} = require('./cursorStore');
const { createSyncRun, completeSyncRun, noteSyncRunRetry } = require('./syncRunStore');

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
 * Rate limit exhausted within chunk — keep cursor at current page/window, stay in_progress.
 */
async function markSyncRateLimitRetry(practiceId, resourceType, syncRunId, page, syncRunIdValue, dateWindow) {
  await updateCursor(practiceId, resourceType, {
    cursor: serializePageCursor(page, syncRunIdValue, dateWindow),
    status: 'in_progress',
  });
  if (syncRunId) {
    await noteSyncRunRetry(syncRunId, RATE_LIMIT_RETRY_MESSAGE);
  }
}

function buildRateLimitRetryResult({ page, syncRunId, resourceType, dateWindow }) {
  return {
    success: false,
    complete: false,
    hasMore: true,
    page,
    processed: 0,
    failed: 0,
    syncRunId,
    cursorStatus: 'in_progress',
    resourceType,
    chunkStart: dateWindow?.chunkStart || null,
    chunkEnd: dateWindow?.chunkEnd || null,
    error: RATE_LIMIT_RETRY_MESSAGE,
    errorCode: 'RATE_LIMIT_RETRY',
  };
}

async function handleSyncError(err, practiceId, resourceType, syncRunId, page, dateWindow) {
  const classified = classifyDentallyFetchError(err);
  const errorMessage = classified.message;

  if (classified.kind === 'rate_limit') {
    await markSyncRateLimitRetry(practiceId, resourceType, syncRunId, page, syncRunId, dateWindow);
    return buildRateLimitRetryResult({ page, syncRunId, resourceType, dateWindow });
  }

  if (classified.kind === 'pat_auth') {
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
      errorCode: 'PAT_EXPIRED_OR_INVALID',
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

/**
 * Process one Dentally list-resource chunk (1 API page).
 *
 * @param {string} practiceId
 * @param {{
 *   resourceType: string,
 *   entityAlias: string,
 *   entityConfigOverride?: object|null,
 *   enrichRecords?: (records: object[], pat: string, apiEndpoint: string) => Promise<object[]>,
 *   dateChunking?: { rangeStart: string }|null,
 * }} options
 */
async function syncResourceChunk(practiceId, options) {
  const {
    resourceType,
    entityAlias,
    entityConfigOverride = null,
    enrichRecords = null,
    dateChunking = null,
  } = options;

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
      chunkStart: parsed.chunkStart,
      chunkEnd: parsed.chunkEnd,
    };
  }

  let { page, syncRunId, chunkStart, chunkEnd } = parsePageCursor(cursorRow.cursor);

  let dateWindow = null;
  if (dateChunking) {
    if (!chunkStart || !chunkEnd) {
      dateWindow = monthBounds(dateChunking.rangeStart);
      chunkStart = dateWindow.chunkStart;
      chunkEnd = dateWindow.chunkEnd;
    } else {
      dateWindow = { chunkStart, chunkEnd };
    }
  }

  if (cursorRow.status === 'failed') {
    await updateCursor(practiceId, resourceType, { status: 'in_progress' });
  }

  if (!syncRunId) {
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
  const fetchStart = dateWindow ? dateWindow.chunkStart : null;
  const fetchEnd = dateWindow ? dateWindow.chunkEnd : null;

  let responseData;
  try {
    responseData = await withRateLimitBackoff(
      `${resourceType}:fetch page ${page}`,
      () => fetchDentallyPage(
        pat,
        apiEndpoint,
        entityAlias,
        page,
        fetchStart,
        fetchEnd,
        entityConfigOverride || undefined
      )
    );
  } catch (err) {
    pat = null;
    return handleSyncError(err, practiceId, resourceType, syncRunId, page, dateWindow);
  }

  let { records, totalPages } = extractRecords(responseData, entityAlias);

  if (enrichRecords && records.length > 0) {
    try {
      records = await withRateLimitBackoff(
        `${resourceType}:enrich page ${page}`,
        () => enrichRecords(records, pat, apiEndpoint)
      );
    } catch (err) {
      pat = null;
      return handleSyncError(err, practiceId, resourceType, syncRunId, page, dateWindow);
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

  if (isLastPage && dateWindow) {
    const nextStart = dayAfter(dateWindow.chunkEnd);
    const endCap = todayUtc();
    if (nextStart > endCap) {
      await updateCursor(practiceId, resourceType, {
        cursor: serializePageCursor(page, syncRunId, dateWindow),
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
        chunkStart: dateWindow.chunkStart,
        chunkEnd: dateWindow.chunkEnd,
        totalPages: pageCount,
      };
    }

    const nextWindow = monthBounds(nextStart);
    await updateCursor(practiceId, resourceType, {
      cursor: serializePageCursor(1, syncRunId, nextWindow),
      status: 'in_progress',
    });
    return {
      success: true,
      complete: false,
      hasMore: true,
      page,
      nextPage: 1,
      processed: upsertResult.processed,
      failed: upsertResult.failed,
      syncRunId,
      cursorStatus: 'in_progress',
      resourceType,
      chunkStart: dateWindow.chunkStart,
      chunkEnd: dateWindow.chunkEnd,
      nextChunkStart: nextWindow.chunkStart,
      nextChunkEnd: nextWindow.chunkEnd,
      totalPages: pageCount,
    };
  }

  if (isLastPage) {
    await updateCursor(practiceId, resourceType, {
      cursor: serializePageCursor(page, syncRunId, dateWindow),
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
    cursor: serializePageCursor(nextPage, syncRunId, dateWindow),
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
    chunkStart: dateWindow?.chunkStart || null,
    chunkEnd: dateWindow?.chunkEnd || null,
    totalPages,
  };
}

module.exports = {
  loadPracticePat,
  resolveUserIdForPractice,
  markSyncFailed,
  markSyncRateLimitRetry,
  syncResourceChunk,
};
