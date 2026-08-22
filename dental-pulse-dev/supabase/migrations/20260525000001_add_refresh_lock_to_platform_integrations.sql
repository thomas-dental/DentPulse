-- Adds a row-level refresh mutex to platform_integrations so concurrent callers
-- never burn the same Xero (or any OAuth) refresh_token twice. Xero rotates
-- refresh tokens on every use; the previous one is revoked instantly. Without
-- this, two simultaneous Edge Function calls (Dashboard + Cost Impact + sync
-- trigger) would each call Xero with the same refresh_token and one of them
-- would invalidate the chain — forcing the user to reconnect daily.
--
-- The lock is acquired by an atomic UPDATE ... WHERE refresh_lock_at IS NULL
-- OR refresh_lock_at < NOW() - 60s (stale-lock recovery in case a holder
-- crashed before clearing).

ALTER TABLE platform_integrations
  ADD COLUMN IF NOT EXISTS refresh_lock_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN platform_integrations.refresh_lock_at IS
  'Serialises concurrent OAuth refresh calls. Set by the caller acquiring the lock; cleared after refresh completes or after a 60s stale timeout.';
