const { supabaseAdmin } = require('../../config/supabase');

/**
 * Persists the full request AND response of every Claude API call — on success
 * OR failure — to the `ai_request_logs` table. This is the app-side equivalent
 * of an OpenAI-style request log: Anthropic does NOT expose prompt/response
 * bodies (only token metadata), so if we want to see "what we sent / what Claude
 * returned" we must record it ourselves.
 *
 * Unlike `tokenTracker.logTokenUsage` (which only writes on a successful
 * response and whose insert error is swallowed), this logger:
 *   - runs on both the success and error paths (failures are recorded too),
 *   - stores the Anthropic `request_id` so a row can be correlated with the
 *     entry on the Anthropic Console → Logs page,
 *   - is fire-and-forget and fully self-contained: a logging failure must NEVER
 *     break the AI feature, so every error is caught and only console.error'd.
 *
 * NOTE: request/response payloads can contain practice data / PII. They are
 * stored as jsonb. Adjust retention/redaction to your data-privacy policy.
 */

// Guard row size — a very large prompt or response shouldn't bloat a row or
// exceed Postgres limits. Full content is kept up to the cap, then replaced with
// a truncation marker that still records the original size for auditing.
const MAX_CHARS = 200000; // ~200 KB per payload field

function capPayload(value) {
  if (value == null) return null;
  let str;
  try {
    str = JSON.stringify(value);
  } catch {
    return { _unserializable: true };
  }
  if (str == null) return null;
  if (str.length <= MAX_CHARS) return value;
  return { _truncated: true, _original_length: str.length, preview: str.slice(0, MAX_CHARS) };
}

// Build the stored request shape from the raw Anthropic params (never includes
// the API key — that lives on the client, not in `params`).
function shapeRequest(params) {
  if (!params) return null;
  return capPayload({
    model: params.model,
    max_tokens: params.max_tokens,
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    tool_choice: params.tool_choice,
    output_config: params.output_config,
  });
}

async function logAiRequest(row) {
  try {
    const { error } = await supabaseAdmin.from('ai_request_logs').insert({
      request_id: row.requestId || null,
      organization_id: row.organizationId || null,
      user_id: row.userId || null,
      feature: row.feature || null,
      model: row.model || null,
      status: row.status, // 'success' | 'error'
      http_status: row.httpStatus ?? null,
      error_type: row.errorType || null,
      error_message: row.errorMessage || null,
      request_payload: shapeRequest(row.requestParams),
      response_payload: capPayload(row.responsePayload),
      input_tokens: row.inputTokens ?? null,
      output_tokens: row.outputTokens ?? null,
      latency_ms: row.latencyMs ?? null,
    });
    if (error) {
      console.error('[AI-REQUEST-LOG] insert failed:', error.message);
    }
  } catch (err) {
    console.error('[AI-REQUEST-LOG] unexpected error:', err?.message);
  }
}

module.exports = { logAiRequest };
