const { supabaseAdmin } = require('../../../config/supabase');

const RESOURCE_PATIENTS = 'patients';
const RESOURCE_ACCOUNTS = 'accounts';
const RESOURCE_RECALLS = 'recalls';
const RESOURCE_APPOINTMENTS = 'appointments';
const RESOURCE_TREATMENT_APPOINTMENTS = 'treatment_appointments';

const PAGE_BASED_RESOURCES = new Set([
  RESOURCE_PATIENTS,
  RESOURCE_ACCOUNTS,
  RESOURCE_RECALLS,
  RESOURCE_APPOINTMENTS,
  RESOURCE_TREATMENT_APPOINTMENTS,
]);

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

/**
 * Load or create the standing checkpoint for a practice resource.
 */
async function getOrCreateCursor(practiceId, resourceType) {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('sync_cursors')
    .select('id, practice_id, resource_type, cursor, status, updated_at')
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
    .select('id, practice_id, resource_type, cursor, status, updated_at')
    .single();

  if (insertError) {
    throw new Error(`Failed to create sync cursor: ${insertError.message}`);
  }

  return inserted;
}

async function updateCursor(practiceId, resourceType, { cursor, status }) {
  const payload = { updated_at: new Date().toISOString() };
  if (cursor != null) payload.cursor = cursor;
  if (status != null) payload.status = status;

  const { error } = await supabaseAdmin
    .from('sync_cursors')
    .update(payload)
    .eq('practice_id', practiceId)
    .eq('resource_type', resourceType);

  if (error) {
    throw new Error(`Failed to update sync cursor: ${error.message}`);
  }
}

module.exports = {
  RESOURCE_PATIENTS,
  RESOURCE_ACCOUNTS,
  RESOURCE_RECALLS,
  RESOURCE_APPOINTMENTS,
  RESOURCE_TREATMENT_APPOINTMENTS,
  parsePageCursor,
  serializePageCursor,
  parsePatientsCursor,
  serializePatientsCursor,
  monthBounds,
  dayAfter,
  todayUtc,
  getOrCreateCursor,
  updateCursor,
};
