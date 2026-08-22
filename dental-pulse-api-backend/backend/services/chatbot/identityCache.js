const { supabaseAdmin } = require('../../config/supabase');

// Resolve user_id → { email, fullName } with a short in-memory cache.
// Used to stamp identity on rows whose FK to auth.users may later
// become NULL (ai_token_usage_logs, chat_sessions).
const IDENTITY_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function getIdentity(userId) {
  if (!userId) return { email: null, fullName: null };
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < IDENTITY_TTL_MS) {
    return { email: cached.email, fullName: cached.fullName };
  }
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('email, full_name')
    .eq('user_id', userId)
    .maybeSingle();
  const entry = {
    email: data?.email || null,
    fullName: data?.full_name || null,
    fetchedAt: Date.now(),
  };
  cache.set(userId, entry);
  return { email: entry.email, fullName: entry.fullName };
}

module.exports = { getIdentity };
