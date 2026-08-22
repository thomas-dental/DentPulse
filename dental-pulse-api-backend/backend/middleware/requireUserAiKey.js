const { supabaseAdmin } = require('../config/supabase');
const aiKeyContext = require('../services/chatbot/aiKeyContext');

/**
 * Per-user / per-tenant AI gate for INTERACTIVE endpoints. Must run AFTER an
 * auth middleware that sets req.user (e.g. syncAuth).
 *
 * The key a request is billed to is resolved in this order:
 *   1. The requesting user's OWN enabled key (user_ai_keys)            → their key
 *   2. Otherwise the ENABLED key of their tenant's OWNER               → owner's key
 *      (organizations.user_id / created_by of the org the request is in)
 *   3. Neither → 403, the request never reaches the AI handler.
 *
 * So an owner can switch AI on once and every member of the tenant can use it,
 * billed to the owner's key. A member with their OWN key still uses their own.
 * A member who has been explicitly DISABLED is blocked even when the owner is
 * enabled (an explicit per-member off wins over the tenant key).
 *
 * Background / cron AI (Monday briefing, forecast cron) does NOT use this — it
 * has no user and keeps the org/.env key.
 */

// The organisation this request acts in: an explicit body value wins (the cash
// forecast sends organizationId), otherwise the user's current organisation.
async function resolveOrgId(req, userId) {
  const bodyOrg = req.body && req.body.organizationId;
  if (bodyOrg) return bodyOrg;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('current_organization_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.current_organization_id || null;
}

// The owner (tenant key-holder) of an organisation: user_id, else created_by.
async function resolveOwnerId(organizationId) {
  if (!organizationId) return null;
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('user_id, created_by')
    .eq('id', organizationId)
    .maybeSingle();
  return data?.user_id || data?.created_by || null;
}

// Read a user's AI key row and classify it:
//   { apiKey }      → present and enabled (usable)
//   { disabled }    → present but switched off
//   null            → no key stored
// select('*') so a not-yet-migrated `enabled` column reads as undefined and is
// treated as enabled.
async function readKey(forUserId) {
  if (!forUserId) return null;
  const { data, error } = await supabaseAdmin
    .from('user_ai_keys')
    .select('*')
    .eq('user_id', forUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const key = (data.claude_api_key || '').trim();
  if (!key) return null;
  if (data.enabled === false) return { disabled: true };
  return { apiKey: key };
}

module.exports = async function requireUserAiKey(req, res, next) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'No authenticated user' });
  }

  try {
    // 1. The user's own key.
    const own = await readKey(userId);
    if (own?.apiKey) {
      return aiKeyContext.runWithUser({ userId, apiKey: own.apiKey }, next);
    }
    // Own key present but explicitly switched off → block. An explicit per-user
    // disable wins over any tenant-wide owner key.
    if (own?.disabled) {
      return res.status(403).json({
        code: 'USER_AI_DISABLED',
        error: 'AI features are turned off for your account. Ask your administrator to re-enable them.',
      });
    }

    // 2. Fall back to the tenant owner's enabled key (unless the user IS the
    //    owner — then step 1 already covered them and they simply have no key).
    const orgId = await resolveOrgId(req, userId);
    const ownerId = await resolveOwnerId(orgId);
    if (ownerId && ownerId !== userId) {
      const owner = await readKey(ownerId);
      if (owner?.apiKey) {
        // Member rides on the owner's key. userId stays the MEMBER so usage is
        // attributed to whoever actually ran it; the billed key is the owner's.
        return aiKeyContext.runWithUser(
          { userId, apiKey: owner.apiKey, ownerId, viaOwner: true },
          next
        );
      }
    }

    // 3. Nothing usable — no personal key and no enabled tenant owner key.
    return res.status(403).json({
      code: 'NO_USER_AI_KEY',
      error: 'AI features are not enabled for your account. Ask your administrator to add your API key or enable AI for your organisation.',
    });
  } catch (err) {
    console.error('[requireUserAiKey] gate check failed:', err.message);
    return res.status(500).json({ error: 'Failed to verify AI access' });
  }
};
