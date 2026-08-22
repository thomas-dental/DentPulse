const { supabaseAdmin } = require('../../config/supabase');
const aiKeyContext = require('./aiKeyContext');

const DEFAULT_INTENT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_FORMAT_MODEL = 'claude-sonnet-4-6';

class ChatbotError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Model overrides remain org-level CONFIG (not secrets) — safe to keep in
// ai_org_settings. Only the API KEY moved fully to user_ai_keys.
async function getOrgModels(organizationId) {
  if (!organizationId) return {};
  const { data } = await supabaseAdmin
    .from('ai_org_settings')
    .select('intent_model, format_model')
    .eq('organization_id', organizationId)
    .maybeSingle();
  return data || {};
}

/**
 * The tenant OWNER's enabled Anthropic key, from user_ai_keys.
 *
 * This is the ONLY key source for background/cron AI now — there is no longer a
 * fallback to process.env.ANTHROPIC_API_KEY or to ai_org_settings.claude_api_key.
 * Owner = organizations.user_id (else created_by). Returns null when the owner
 * has no key or it is switched off.
 */
async function getOwnerKey(organizationId) {
  if (!organizationId) return null;
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('user_id, created_by')
    .eq('id', organizationId)
    .maybeSingle();
  const ownerId = org?.user_id || org?.created_by;
  if (!ownerId) return null;

  const { data } = await supabaseAdmin
    .from('user_ai_keys')
    .select('*')
    .eq('user_id', ownerId)
    .maybeSingle();
  const key = (data?.claude_api_key || '').trim();
  if (!key || data.enabled === false) return null;
  return key;
}

/**
 * Resolve the Anthropic key + models for a request.
 *
 * Interactive requests: requireUserAiKey has already pinned the requesting
 * user's (or their tenant owner's) key into the async context — use ONLY that.
 * Background/cron requests (no user context): use the org owner's key.
 *
 * There is no .env or org-level-secret fallback anymore: user_ai_keys is the
 * single source of truth for the key.
 */
async function getOrgApiKey(organizationId) {
  const models = await getOrgModels(organizationId);
  const resolved = {
    intentModel: models.intent_model || DEFAULT_INTENT_MODEL,
    formatModel: models.format_model || DEFAULT_FORMAT_MODEL,
  };

  // ── Interactive request ──
  const store = aiKeyContext.getStore();
  if (store?.apiKey) {
    return { apiKey: store.apiKey, ...resolved };
  }

  // ── Background / cron (no user context) ──
  const ownerKey = await getOwnerKey(organizationId);
  if (!ownerKey) {
    throw new ChatbotError(
      'NO_API_KEY',
      'No AI key available for this organisation. A SuperAdmin must assign an enabled Anthropic key to the organisation owner.'
    );
  }
  return { apiKey: ownerKey, ...resolved };
}

module.exports = { getOrgApiKey, getOwnerKey, ChatbotError };
