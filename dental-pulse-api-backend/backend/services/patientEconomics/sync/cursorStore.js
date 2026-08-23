const { supabaseAdmin } = require('../../../config/supabase');

const RESOURCE_PATIENTS = 'patients';
const RESOURCE_ACCOUNTS = 'accounts';
const RESOURCE_RECALLS = 'recalls';
const RESOURCE_APPOINTMENTS = 'appointments';
const RESOURCE_TREATMENT_APPOINTMENTS = 'treatment_appointments';
const RESOURCE_TREATMENT_PLANS = 'treatment_plans';
const RESOURCE_TREATMENT_ITEMS = 'treatment_items';
const RESOURCE_ACQUISITION_SOURCES = 'acquisition_sources';

/** Resources the PE scheduler may resume today (Day 5 adds more here). */
const SCHEDULED_RESOURCE_TYPES = [
  RESOURCE_ACQUISITION_SOURCES,
  RESOURCE_PATIENTS,
  RESOURCE_ACCOUNTS,
  RESOURCE_RECALLS,
  RESOURCE_APPOINTMENTS,
  RESOURCE_TREATMENT_APPOINTMENTS,
  RESOURCE_TREATMENT_PLANS,
  RESOURCE_TREATMENT_ITEMS,
];

const PAGE_BASED_RESOURCES = new Set(SCHEDULED_RESOURCE_TYPES);

/**
 * Parse page cursor — plain page ("4") or JSON { page, syncRunId, chunkStart?, chunkEnd? }.
 * @returns {{ page: number, syncRunId: string|null, chunkStart: string|null, chunkEnd: string|null }}
 */
function parsePageCursor(cursorStr) {
  if (!cursorStr) return { page: 1, syncRunId: null, chunkStart: null, chunkEnd: null };

  try {
    const parsed = JSON.parse(cursorStr);
    if (parsed && Number.isFinite(parsed.page) && parsed.page >= 1) {
      return {
        page: parsed.page,
        syncRunId: typeof parsed.syncRunId === 'string' ? parsed.syncRunId : null,
        chunkStart: typeof parsed.chunkStart === 'string' ? parsed.chunkStart : null,
        chunkEnd: typeof parsed.chunkEnd === 'string' ? parsed.chunkEnd : null,
      };
    }
  } catch {
    // fall through to plain page number
  }

  const page = parseInt(cursorStr, 10);
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    syncRunId: null,
    chunkStart: null,
    chunkEnd: null,
  };
}

/**
 * @param {number} page
 * @param {string|null} syncRunId
 * @param {{ chunkStart?: string, chunkEnd?: string }|null} [dateWindow]
 */
function serializePageCursor(page, syncRunId, dateWindow = null) {
  const payload = { page };
  if (syncRunId) payload.syncRunId = syncRunId;
  if (dateWindow?.chunkStart) payload.chunkStart = dateWindow.chunkStart;
  if (dateWindow?.chunkEnd) payload.chunkEnd = dateWindow.chunkEnd;
  return JSON.stringify(payload);
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
 * (e.g. backfill new patient columns after reference data lands).
 */
async function resetCursor(practiceId, resourceType) {
  const initialCursor = PAGE_BASED_RESOURCES.has(resourceType)
    ? serializePageCursor(1, null)
    : '1';

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('sync_cursors')
    .select('id')
    .eq('practice_id', practiceId)
    .eq('resource_type', resourceType)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to load sync cursor for reset: ${fetchError.message}`);
  }

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
 * Find cursors the scheduler should resume.
 * - retryable with next_retry_at <= now (or null)
 * - in_progress not touched recently (stale — crash/deploy resume)
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
  let staleInProgress = [];
  if (remaining > 0) {
    const { data, error } = await supabaseAdmin
      .from('sync_cursors')
      .select(CURSOR_SELECT)
      .eq('status', 'in_progress')
      .in('resource_type', resourceTypes)
      .lt('updated_at', staleBeforeIso)
      .order('updated_at', { ascending: true })
      .limit(remaining);

    if (error) {
      throw new Error(`Failed to list stale in_progress cursors: ${error.message}`);
    }
    staleInProgress = data || [];
  }

  return [...(retryable || []), ...staleInProgress];
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
  SCHEDULED_RESOURCE_TYPES,
  parsePageCursor,
  serializePageCursor,
  parsePatientsCursor,
  serializePatientsCursor,
  monthBounds,
  dayAfter,
  todayUtc,
  getOrCreateCursor,
  updateCursor,
  resetCursor,
  listSchedulableCursors,
};
