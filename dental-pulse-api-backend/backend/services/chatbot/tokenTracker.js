const { supabaseAdmin } = require('../../config/supabase');
const { getIdentity } = require('./identityCache');
const usageContext = require('./usageContext');
const aiKeyContext = require('./aiKeyContext');

const COST_TABLE = {
  'claude-haiku-4-5-20251001': { input: 0.0000008, output: 0.000004 },
  'claude-sonnet-4-6': { input: 0.000003, output: 0.000015 },
  'claude-opus-4-6': { input: 0.000015, output: 0.000075 },
};

async function logTokenUsage({ organizationId, userId, feature, model, inputTokens, outputTokens, latencyMs }) {
  const rates = COST_TABLE[model] || { input: 0.000003, output: 0.000015 };
  const estimatedCost = (inputTokens * rates.input) + (outputTokens * rates.output);

  // Accumulate into the active per-turn store (if any) so v2Handler can
  // surface a usage line. No-ops outside a chat turn.
  usageContext.add({ inputTokens, outputTokens, costUsd: estimatedCost });

  // Attribute to the actual requesting user. Some callers (intent classifier,
  // response formatter) don't thread userId, but requireUserAiKey has pinned
  // the requesting member into aiKeyContext — use that so their usage is
  // attributed to them instead of logging an orphaned (null-user) row. A member
  // riding on the tenant owner's key still stays attributed to the member.
  const store = aiKeyContext.getStore();
  const effectiveUserId = userId || store?.userId || null;

  const { email, fullName } = await getIdentity(effectiveUserId);

  const { error } = await supabaseAdmin.from('ai_token_usage_logs').insert({
    organization_id: organizationId,
    user_id: effectiveUserId,
    user_email: email,
    user_full_name: fullName,
    feature,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost: estimatedCost,
    latency_ms: latencyMs,
  });

  if (error) {
    console.error('[CHATBOT-TOKEN] Failed to log usage:', error.message);
  }
}

module.exports = { logTokenUsage };
