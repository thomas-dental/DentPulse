const { supabaseAdmin } = require('../../../config/supabase');

const RESOURCE_PATIENTS = 'patients';

/**
 * Parse patients cursor — supports legacy plain page ("4") or JSON { page, syncRunId }.
 * @returns {{ page: number, syncRunId: string|null }}
 */
function parsePatientsCursor(cursorStr) {
  if (!cursorStr) return { page: 1, syncRunId: null };

  try {
    const parsed = JSON.parse(cursorStr);
    if (parsed && Number.isFinite(parsed.page) && parsed.page >= 1) {
      return {
        page: parsed.page,
        syncRunId: typeof parsed.syncRunId === 'string' ? parsed.syncRunId : null,
      };
    }
  } catch {
    // fall through to plain page number
  }

  const page = parseInt(cursorStr, 10);
  return { page: Number.isFinite(page) && page >= 1 ? page : 1, syncRunId: null };
}

function serializePatientsCursor(page, syncRunId) {
  const payload = { page };
  if (syncRunId) payload.syncRunId = syncRunId;
  return JSON.stringify(payload);
}

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

  const initialCursor =
    resourceType === RESOURCE_PATIENTS ? serializePatientsCursor(1, null) : '1';

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
  parsePatientsCursor,
  serializePatientsCursor,
  getOrCreateCursor,
  updateCursor,
};
