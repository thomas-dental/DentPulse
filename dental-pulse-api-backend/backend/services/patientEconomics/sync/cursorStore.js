const { supabaseAdmin } = require('../../../config/supabase');

const RESOURCE_PATIENTS = 'patients';
const RESOURCE_ACCOUNTS = 'accounts';
const RESOURCE_RECALLS = 'recalls';
const RESOURCE_APPOINTMENTS = 'appointments';
const RESOURCE_TREATMENT_APPOINTMENTS = 'treatment_appointments';
const RESOURCE_TREATMENT_PLANS = 'treatment_plans';
const RESOURCE_TREATMENT_ITEMS = 'treatment_items';
const RESOURCE_ACQUISITION_SOURCES = 'acquisition_sources';
const RESOURCE_INVOICES = 'invoices';
const RESOURCE_PAYMENTS = 'payments';

/** Resources the PE scheduler may resume today (membership still pending). */
const SCHEDULED_RESOURCE_TYPES = [
  RESOURCE_ACQUISITION_SOURCES,
  RESOURCE_PATIENTS,
  RESOURCE_ACCOUNTS,
  RESOURCE_RECALLS,
  RESOURCE_APPOINTMENTS,
  RESOURCE_TREATMENT_APPOINTMENTS,
  RESOURCE_TREATMENT_PLANS,
  RESOURCE_TREATMENT_ITEMS,
  RESOURCE_INVOICES,
  RESOURCE_PAYMENTS,
];

const PAGE_BASED_RESOURCES = new Set(SCHEDULED_RESOURCE_TYPES);

/**
 * Parse page cursor — plain page ("4") or JSON with page + optional window/meta.
 * @returns {{
 *   page: number,
 *   syncRunId: string|null,
 *   chunkStart: string|null,
 *   chunkEnd: string|null,
 *   kickoffMode: 'incremental'|'full'|null,
 *   lastIncrementalCompletedAt: string|null,
 *   lastFullCompletedAt: string|null,
 * }}
 */
function emptyCursorParse(page = 1) {
  return {
    page,
    syncRunId: null,
    chunkStart: null,
    chunkEnd: null,
    kickoffMode: null,
    lastIncrementalCompletedAt: null,
    lastFullCompletedAt: null,
  };
}

function parsePageCursor(cursorStr) {
  if (!cursorStr) return emptyCursorParse(1);

  try {
    const parsed = JSON.parse(cursorStr);
    if (parsed && Number.isFinite(parsed.page) && parsed.page >= 1) {
      const mode = parsed.kickoffMode;
      return {
        page: parsed.page,
        syncRunId: typeof parsed.syncRunId === 'string' ? parsed.syncRunId : null,
        chunkStart: typeof parsed.chunkStart === 'string' ? parsed.chunkStart : null,
        chunkEnd: typeof parsed.chunkEnd === 'string' ? parsed.chunkEnd : null,
        kickoffMode: mode === 'incremental' || mode === 'full' ? mode : null,
        lastIncrementalCompletedAt:
          typeof parsed.lastIncrementalCompletedAt === 'string'
            ? parsed.lastIncrementalCompletedAt
            : null,
        lastFullCompletedAt:
          typeof parsed.lastFullCompletedAt === 'string'
            ? parsed.lastFullCompletedAt
            : null,
      };
    }
  } catch {
    // fall through to plain page number
  }

  const page = parseInt(cursorStr, 10);
  return emptyCursorParse(Number.isFinite(page) && page >= 1 ? page : 1);
}

/**
 * @param {number} page
 * @param {string|null} syncRunId
 * @param {{ chunkStart?: string, chunkEnd?: string }|null} [dateWindow]
 * @param {{
 *   kickoffMode?: string|null,
 *   lastIncrementalCompletedAt?: string|null,
 *   lastFullCompletedAt?: string|null,
 * }} [meta]
 */
function serializePageCursor(page, syncRunId, dateWindow = null, meta = null) {
  const payload = { page };
  if (syncRunId) payload.syncRunId = syncRunId;
  if (dateWindow?.chunkStart) payload.chunkStart = dateWindow.chunkStart;
  if (dateWindow?.chunkEnd) payload.chunkEnd = dateWindow.chunkEnd;
  if (meta?.kickoffMode === 'incremental' || meta?.kickoffMode === 'full') {
    payload.kickoffMode = meta.kickoffMode;
  }
  if (meta?.lastIncrementalCompletedAt) {
    payload.lastIncrementalCompletedAt = meta.lastIncrementalCompletedAt;
  }
  if (meta?.lastFullCompletedAt) {
    payload.lastFullCompletedAt = meta.lastFullCompletedAt;
  }
  return JSON.stringify(payload);
}

/** Preserve kickoffMode + completion stamps when advancing a cursor. */
function cursorMetaFromParsed(parsed, overrides = {}) {
  return {
    kickoffMode:
      overrides.kickoffMode !== undefined ? overrides.kickoffMode : parsed?.kickoffMode,
    lastIncrementalCompletedAt:
      overrides.lastIncrementalCompletedAt !== undefined
        ? overrides.lastIncrementalCompletedAt
        : parsed?.lastIncrementalCompletedAt,
    lastFullCompletedAt:
      overrides.lastFullCompletedAt !== undefined
        ? overrides.lastFullCompletedAt
        : parsed?.lastFullCompletedAt,
  };
}

function completionStampsForParsed(parsed) {
  const now = new Date().toISOString();
  const mode = parsed?.kickoffMode;
  return cursorMetaFromParsed(parsed, {
    lastIncrementalCompletedAt:
      mode === 'incremental' ? now : parsed?.lastIncrementalCompletedAt || null,
    lastFullCompletedAt: mode === 'full' ? now : parsed?.lastFullCompletedAt || null,
  });
}

/** First/last day of the UTC month containing yyyy-mm-dd. */
function monthBounds(yyyyMmDd) {
  const d = new Date(`${yyyyMmDd}T00:00:00.000Z`);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return {
    chunkStart: start.toISOString().slice(0, 10),
    chunkEnd: end.toISOString().slice(0, 10),
  };
}

/** Day after chunkEnd (start of next month when chunkEnd is month-end). */
function dayAfter(yyyyMmDd) {
  const d = new Date(`${yyyyMmDd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** @deprecated use parsePageCursor */
const parsePatientsCursor = parsePageCursor;
/** @deprecated use serializePageCursor */
const serializePatientsCursor = serializePageCursor;

const CURSOR_SELECT =
  'id, practice_id, resource_type, cursor, status, updated_at, retry_count, next_retry_at, last_error, last_error_code';

/**
 * Load or create the standing checkpoint for a practice resource.
 */
async function getOrCreateCursor(practiceId, resourceType) {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('sync_cursors')
    .select(CURSOR_SELECT)
    .eq('practice_id', practiceId)
    .eq('resource_type', resourceType)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to load sync cursor: ${fetchError.message}`);
  }

  if (existing) return existing;

  const initialCursor = PAGE_BASED_RESOURCES.has(resourceType)
    ? serializePageCursor(1, null)
    : '1';

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('sync_cursors')
    .insert({
      practice_id: practiceId,
      resource_type: resourceType,
      cursor: initialCursor,
      status: 'in_progress',
    })
    .select(CURSOR_SELECT)
    .single();

  if (insertError) {
    throw new Error(`Failed to create sync cursor: ${insertError.message}`);
  }

  return inserted;
}

/**
 * @param {string} practiceId
 * @param {string} resourceType
 * @param {object} fields — cursor, status, retry_count, next_retry_at, last_error, last_error_code
 */
async function updateCursor(practiceId, resourceType, fields = {}) {
  const payload = { updated_at: new Date().toISOString() };
  for (const key of [
    'cursor',
    'status',
    'retry_count',
    'next_retry_at',
    'last_error',
    'last_error_code',
  ]) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      payload[key] = fields[key];
    }
  }

  const { error } = await supabaseAdmin
    .from('sync_cursors')
    .update(payload)
    .eq('practice_id', practiceId)
    .eq('resource_type', resourceType);

  if (error) {
    throw new Error(`Failed to update sync cursor: ${error.message}`);
  }
}

/**
 * Reset a resource cursor to page 1 / in_progress so a completed sync can re-run
 * (e.g. backfill, scheduled incremental/full kickoff).
 *
 * @param {string} practiceId
 * @param {string} resourceType
 * @param {{
 *   dateWindow?: { chunkStart: string, chunkEnd: string }|null,
 *   kickoffMode?: 'incremental'|'full'|null,
 * }} [opts]
 */
async function resetCursor(practiceId, resourceType, opts = {}) {
  const dateWindow = opts.dateWindow || null;
  const kickoffMode = opts.kickoffMode || null;

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('sync_cursors')
    .select('id, cursor')
    .eq('practice_id', practiceId)
    .eq('resource_type', resourceType)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to load sync cursor for reset: ${fetchError.message}`);
  }

  const prev = existing ? parsePageCursor(existing.cursor) : emptyCursorParse(1);
  const meta = cursorMetaFromParsed(prev, { kickoffMode: kickoffMode || prev.kickoffMode });
  const initialCursor = PAGE_BASED_RESOURCES.has(resourceType)
    ? serializePageCursor(1, null, dateWindow, meta)
    : '1';

  const clearRetry = {
    cursor: initialCursor,
    status: 'in_progress',
    retry_count: 0,
    next_retry_at: null,
    last_error: null,
    last_error_code: null,
  };

  if (existing) {
    await updateCursor(practiceId, resourceType, clearRetry);
    return;
  }

  const { error: insertError } = await supabaseAdmin
    .from('sync_cursors')
    .insert({
      practice_id: practiceId,
      resource_type: resourceType,
      ...clearRetry,
    });

  if (insertError) {
    throw new Error(`Failed to create sync cursor for reset: ${insertError.message}`);
  }
}

/**
 * True if this practice has any non-stale in_progress cursor for the given resources.
 */
async function hasActiveInProgress(practiceId, resourceTypes, staleBeforeIso) {
  const { data, error } = await supabaseAdmin
    .from('sync_cursors')
    .select('id, resource_type, updated_at')
    .eq('practice_id', practiceId)
    .eq('status', 'in_progress')
    .in('resource_type', resourceTypes)
    .gte('updated_at', staleBeforeIso)
    .limit(1);

  if (error) {
    throw new Error(`Failed to check in_progress cursors: ${error.message}`);
  }
  return (data || []).length > 0;
}

/**
 * Per-practice operational view: last cursor status per resource.
 */
async function getSyncStatusByPractice(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('sync_cursors')
    .select(
      'resource_type, status, updated_at, retry_count, next_retry_at, last_error, last_error_code, cursor'
    )
    .eq('practice_id', practiceId)
    .in('resource_type', SCHEDULED_RESOURCE_TYPES)
    .order('resource_type', { ascending: true });

  if (error) {
    throw new Error(`Failed to load sync status: ${error.message}`);
  }

  return (data || []).map((row) => {
    const parsed = parsePageCursor(row.cursor);
    return {
      resourceType: row.resource_type,
      status: row.status,
      updatedAt: row.updated_at,
      lastSuccessfulAt: row.status === 'complete' ? row.updated_at : null,
      lastIncrementalCompletedAt: parsed.lastIncrementalCompletedAt,
      lastFullCompletedAt: parsed.lastFullCompletedAt,
      kickoffMode: parsed.kickoffMode,
      page: parsed.page,
      chunkStart: parsed.chunkStart,
      chunkEnd: parsed.chunkEnd,
      retryCount: row.retry_count,
      nextRetryAt: row.next_retry_at,
      lastError: row.last_error,
      lastErrorCode: row.last_error_code,
    };
  });
}

/**
 * Find cursors the scheduler should resume.
 * - retryable with next_retry_at <= now (or null)
 * - in_progress (kickoff + crash resume). Claim in processOneCursor touches
 *   updated_at so overlapping ticks prefer older rows first.
 *
 * @param {{ staleBeforeIso: string, nowIso: string, resourceTypes: string[], limit: number }} opts
 */
async function listSchedulableCursors({ staleBeforeIso, nowIso, resourceTypes, limit }) {
  const { data: retryable, error: retryErr } = await supabaseAdmin
    .from('sync_cursors')
    .select(CURSOR_SELECT)
    .eq('status', 'retryable')
    .in('resource_type', resourceTypes)
    .or(`next_retry_at.is.null,next_retry_at.lte."${nowIso}"`)
    .order('next_retry_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (retryErr) {
    throw new Error(`Failed to list retryable cursors: ${retryErr.message}`);
  }

  const remaining = Math.max(0, limit - (retryable?.length || 0));
  let inProgress = [];
  if (remaining > 0) {
    // Prefer rows not touched recently (staleBefore), but still include fresh
    // kickoff in_progress so delta/full resets drain without waiting STALE_MS.
    const { data, error } = await supabaseAdmin
      .from('sync_cursors')
      .select(CURSOR_SELECT)
      .eq('status', 'in_progress')
      .in('resource_type', resourceTypes)
      .order('updated_at', { ascending: true })
      .limit(remaining);

    if (error) {
      throw new Error(`Failed to list in_progress cursors: ${error.message}`);
    }
    inProgress = data || [];
  }

  // Prefer truly stale rows first when mixing with fresh kickoffs
  inProgress.sort((a, b) => {
    const aStale = a.updated_at < staleBeforeIso ? 0 : 1;
    const bStale = b.updated_at < staleBeforeIso ? 0 : 1;
    if (aStale !== bStale) return aStale - bStale;
    return String(a.updated_at).localeCompare(String(b.updated_at));
  });

  return [...(retryable || []), ...inProgress];
}

module.exports = {
  RESOURCE_PATIENTS,
  RESOURCE_ACCOUNTS,
  RESOURCE_RECALLS,
  RESOURCE_APPOINTMENTS,
  RESOURCE_TREATMENT_APPOINTMENTS,
  RESOURCE_TREATMENT_PLANS,
  RESOURCE_TREATMENT_ITEMS,
  RESOURCE_ACQUISITION_SOURCES,
  RESOURCE_INVOICES,
  RESOURCE_PAYMENTS,
  SCHEDULED_RESOURCE_TYPES,
  parsePageCursor,
  serializePageCursor,
  cursorMetaFromParsed,
  completionStampsForParsed,
  parsePatientsCursor,
  serializePatientsCursor,
  monthBounds,
  dayAfter,
  todayUtc,
  getOrCreateCursor,
  updateCursor,
  resetCursor,
  hasActiveInProgress,
  getSyncStatusByPractice,
  listSchedulableCursors,
};
