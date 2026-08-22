-- ============================================================
-- Per-user Anthropic API keys.
--
-- A SuperAdmin assigns an Anthropic key to a specific user from the Users
-- table. Interactive AI features (the chatbot, on-demand cash forecast) are
-- gated on this: a user with no row here cannot use them, and a user with a
-- row has their AI calls billed to THEIR key — never the global .env key.
--
-- Kept in its own table (not a column on `profiles`) so the secret stays out
-- of the broad profile row that is selected in many places, and so it can be
-- locked down to the service role only.
--
-- Keyed by the auth user id (profiles.user_id / auth.users.id), which is what
-- both the admin panel and the chatbot's syncAuth middleware key off.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_ai_keys (
  user_id UUID PRIMARY KEY,
  claude_api_key TEXT NOT NULL,
  -- AI access can be switched off WITHOUT removing the key, so an admin can
  -- pause a user and re-enable them later without re-entering the key. The
  -- interactive gate requires (key present AND enabled = true) — it never
  -- falls back to the ENV key.
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID,                       -- superadmin who set/changed it
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For tables that already existed before `enabled` was introduced.
ALTER TABLE public.user_ai_keys
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- Only the backend (service-role key, bypasses RLS) ever reads or writes this.
-- RLS on with no policies => anon/authenticated clients are denied by default,
-- so a leaked anon key can never read stored secrets.
ALTER TABLE public.user_ai_keys ENABLE ROW LEVEL SECURITY;
