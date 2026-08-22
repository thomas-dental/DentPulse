-- ============================================================
-- chat_sessions — preserve history after user deletion
--
-- The original FK on user_id is ON DELETE CASCADE, which wipes
-- every chat session (and via its own cascade, every message)
-- the moment the auth user is removed. That destroys history
-- the superadmin panel needs.
--
-- Switch the FK to ON DELETE SET NULL so the rows survive, and
-- stamp user_email + user_full_name at insert time so identity
-- is preserved even when the FK points nowhere.
-- ============================================================

BEGIN;

-- Make user_id nullable + swap CASCADE for SET NULL.
ALTER TABLE public.chat_sessions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_user_id_fkey;

ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Stamped identity columns.
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS user_email      TEXT,
  ADD COLUMN IF NOT EXISTS user_full_name  TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_email
  ON public.chat_sessions (user_email)
  WHERE user_email IS NOT NULL;

COMMIT;
