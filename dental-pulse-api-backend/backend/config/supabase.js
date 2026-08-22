const { createClient } = require('@supabase/supabase-js');

// Anon client for auth operations (login, getUser)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

// Service role client for data queries (bypasses RLS).
// Accepts either env name: SUPABASE_SERVICE_ROLE_KEY (legacy name) or
// SUPABASE_SECRET_KEY (Supabase's new "secret key" naming) — a rotation that
// only sets one of them must not silently start the engine without DB access.
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
);

module.exports = supabase;
module.exports.supabaseAdmin = supabaseAdmin;
