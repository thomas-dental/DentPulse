-- ============================================================
-- ai_token_usage_logs — stamp user identity at log time
--
-- The existing FK on user_id is ON DELETE SET NULL. When an auth
-- user is removed, every log row loses attribution and the admin
-- usage page can no longer group those rows under a person.
--
-- Adding user_email + user_full_name lets us preserve identity
-- for every future row. Old rows remain NULL — those are still
-- "orphaned" and continue to appear in the orphan banner.
-- ============================================================

BEGIN;

ALTER TABLE public.ai_token_usage_logs
  ADD COLUMN IF NOT EXISTS user_email      TEXT,
  ADD COLUMN IF NOT EXISTS user_full_name  TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_token_usage_email
  ON public.ai_token_usage_logs (user_email)
  WHERE user_email IS NOT NULL;

COMMIT;
