const { supabaseAdmin } = require('../../../config/supabase');
const { decryptPAT } = require('../patEncryption');
const { getDentallyBaseUrl } = require('../validatePat');
const {
  fetchDentallyPage,
  extractRecords,
  PER_PAGE,
} = require('../../../api/dentally/client');
const { invalidateMapCaches } = require('../../sync/upsert');
const { classifyDentallyFetchError } = require('./dentallyErrors');
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
const {
  getMaxRetries,
  computeNextRetryAt,
  clearRetryFields,
} = require('./retryPolicy');
const {
  markCredentialsNeedReconnection,
} = require('./credentialsStatus');
const { upsertPeEntityPage } = require('./upsertPePage');

async function loadPracticePat(practiceId) {
  const { data: row, error } = await supabaseAdmin
    .from('dentally_credentials')
    .select('encrypted_pat, encrypted_pat_iv, needs_reconnection')
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
  if (row.needs_reconnection === true) {
    const err = new Error(
      'Dentally PAT needs reconnection — re-enter the PAT in Settings before syncing.'
    );
    err.code = 'NEEDS_RECONNECTION';
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

async function markSyncFailed(practiceId, resourceType, syncRunId, errorMessage, errorCode) {
  await updateCursor(practiceId, resourceType, {
    status: 'failed',
    next_retry_at: null,
    last_error: errorMessage,
    last_error_code: errorCode || 'SYNC_ERROR',
  });
  if (syncRunId) {
    await completeSyncRun(syncRunId, 'failed', errorMessage);
  }
}

/**
 * Transient / unknown failure — mark retryable with backoff, or terminal failed if capped.
 * @returns {Promise<{ status: 'retryable'|'failed', retryCount: number, nextRetryAt: string|null }>}
 */
async function markSyncRetryable(
  practiceId,
  resourceType,
  syncRunId,
  page,
  dateWindow,
  errorMessage,
  errorCode,
  currentRetryCount = 0
) {
  const nextCount = (currentRetryCount || 0) + 1;
  const maxRetries = getMaxRetries();

  if (nextCount > maxRetries) {
    await markSyncFailed(
      practiceId,
      resourceType,
      syncRunId,
      `${errorMessage} (gave up after ${maxRetries} retries)`,
      errorCode || 'SYNC_ERROR'
    );
    return { status: 'failed', retryCount: nextCount, nextRetryAt: null };
  }

  const nextRetryAt = computeNextRetryAt(nextCount);
  await updateCursor(practiceId, resourceType, {
    cursor: serializePageCursor(page, syncRunId, dateWindow),
    status: 'retryable',
    retry_count: nextCount,
    next_retry_at: nextRetryAt,
    last_error: errorMessage,
    last_error_code: errorCode || 'TRANSIENT_RETRY',
  });

  if (syncRunId) {
    await noteSyncRunRetry(
      syncRunId,
      `${errorMessage} (retry ${nextCount}/${maxRetries}, next at ${nextRetryAt})`
    );
  }

  return { status: 'retryable', retryCount: nextCount, nextRetryAt };
}

async function handleSyncError(
  err,
  practiceId,
  resourceType,
  syncRunId,
  page,
  dateWindow,
  currentRetryCount = 0
) {
  const classified = classifyDentallyFetchError(err);
  const errorMessage = classified.message;
  const errorCode = classified.code;

  if (classified.kind === 'pat_auth') {
    await markCredentialsNeedReconnection(practiceId, errorMessage);
    await markSyncFailed(practiceId, resourceType, syncRunId, errorMessage, errorCode);
    return {
      success: false,
      complete: false,
      hasMore: false,
      page,
      processed: 0,
      failed: 0,
      skipped: 0,
      syncRunId,
      cursorStatus: 'failed',
      resourceType,
      error: errorMessage,
      errorCode,
      autoRetry: false,
    };
  }

  // transient + unknown → capped auto-retry
  const marked = await markSyncRetryable(
    practiceId,
    resourceType,
    syncRunId,
    page,
    dateWindow,
    errorMessage,
    errorCode,
    currentRetryCount
  );

  return {
    success: false,
    complete: false,
    hasMore: marked.status === 'retryable',
    page,
    processed: 0,
    failed: 0,
    skipped: 0,
    syncRunId,
    cursorStatus: marked.status,
    resourceType,
    chunkStart: dateWindow?.chunkStart || null,
    chunkEnd: dateWindow?.chunkEnd || null,
    error: errorMessage,
    errorCode,
    autoRetry: marked.status === 'retryable',
    retryCount: marked.retryCount,
    nextRetryAt: marked.nextRetryAt,
  };
}

/**
 * Process one Dentally list-resource chunk (1 API page).
 *
 * All PE resource syncs (patients, accounts, recalls, appointments, …) go through
 * this helper so retry / auth / skip handling stays shared.
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
  const currentRetryCount = cursorRow.retry_count || 0;

  if (cursorRow.status === 'complete') {
    const parsed = parsePageCursor(cursorRow.cursor);
    return {
      success: true,
      complete: true,
      hasMore: false,
      page: parsed.page,
      processed: 0,
      failed: 0,
      skipped: 0,
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

  // Manual re-invoke or scheduler claim: leave auth-failed alone until PAT works;
  // once PAT loads, flip retryable/failed → in_progress (failed gets a fresh retry budget).
  if (cursorRow.status === 'retryable') {
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
    if (err.code === 'NO_CREDENTIAL' || err.code === 'NEEDS_RECONNECTION') {
      await markSyncFailed(practiceId, resourceType, syncRunId, err.message, err.code);
      return {
        success: false,
        complete: false,
        hasMore: false,
        page,
        processed: 0,
        failed: 0,
        skipped: 0,
        syncRunId,
        cursorStatus: 'failed',
        resourceType,
        error: err.message,
        errorCode: err.code,
        autoRetry: false,
      };
    }
    throw err;
  }

  // PAT is usable — clear terminal failed so a human retry can proceed
  let effectiveRetryCount = currentRetryCount;
  if (cursorRow.status === 'failed') {
    effectiveRetryCount = 0;
    await updateCursor(practiceId, resourceType, {
      status: 'in_progress',
      ...clearRetryFields(),
    });
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
    return handleSyncError(
      err,
      practiceId,
      resourceType,
      syncRunId,
      page,
      dateWindow,
      effectiveRetryCount
    );
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
      return handleSyncError(
        err,
        practiceId,
        resourceType,
        syncRunId,
        page,
        dateWindow,
        effectiveRetryCount
      );
    }
  }

  pat = null;

  const upsertResult = await upsertPeEntityPage({
    entityAlias,
    practiceId,
    userId,
    rawRecords: records,
    syncRunId,
    resourceType,
  });

  if (entityAlias === 'acquisition_sources' || entityAlias === 'appointment_cancellation_reasons') {
    invalidateMapCaches(practiceId);
  }

  const pageCount = totalPages ?? (records.length < PER_PAGE ? page : page + 1);
  const isLastPage =
    records.length === 0 ||
    (totalPages != null ? page >= totalPages : records.length < PER_PAGE);

  const successCursorFields = {
    ...clearRetryFields(),
  };

  if (isLastPage && dateWindow) {
    const nextStart = dayAfter(dateWindow.chunkEnd);
    const endCap = todayUtc();
    if (nextStart > endCap) {
      await updateCursor(practiceId, resourceType, {
        cursor: serializePageCursor(page, syncRunId, dateWindow),
        status: 'complete',
        ...successCursorFields,
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
        skipped: upsertResult.skipped,
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
      ...successCursorFields,
    });
    return {
      success: true,
      complete: false,
      hasMore: true,
      page,
      nextPage: 1,
      processed: upsertResult.processed,
      failed: upsertResult.failed,
      skipped: upsertResult.skipped,
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
      ...successCursorFields,
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
      skipped: upsertResult.skipped,
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
    ...successCursorFields,
  });

  return {
    success: true,
    complete: false,
    hasMore: true,
    page,
    nextPage,
    processed: upsertResult.processed,
    failed: upsertResult.failed,
    skipped: upsertResult.skipped,
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
  markSyncRetryable,
  handleSyncError,
  syncResourceChunk,
};
