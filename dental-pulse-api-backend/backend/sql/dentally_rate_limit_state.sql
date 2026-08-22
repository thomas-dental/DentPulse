-- ============================================================
-- Dentally rate-limit state: replaces backend/config/dentallyRateLimitState.json.
--
-- Dentally rate-limits PER connected account, so the cooldown is keyed by
-- integration_id. The existing client holds one process-wide cooldown; that
-- global value maps to the integration_id IS NULL row, which lets the table
-- serve today's global behaviour and per-account throttling later without a
-- schema change.
--
-- Why move off the file: the file is per-process and per-host. Two API
-- instances could not see each other's cooldown, and a redeploy wiped it —
-- so a fresh process would immediately re-hit an account that was still
-- being throttled.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dentally_rate_limit_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES public.integrations(id) ON DELETE CASCADE, -- NULL = process-wide/global
  cooldown_until TIMESTAMPTZ,
  remaining INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- One row per connected account, plus one global row.
CREATE UNIQUE INDEX IF NOT EXISTS dentally_rate_limit_state_unique_idx
  ON public.dentally_rate_limit_state
  (COALESCE(integration_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Lets a worker cheaply find any account still in cooldown.
CREATE INDEX IF NOT EXISTS dentally_rate_limit_state_cooldown_idx
  ON public.dentally_rate_limit_state (cooldown_until)
  WHERE cooldown_until IS NOT NULL;

-- Written only by the sync workers via the service-role key.
ALTER TABLE public.dentally_rate_limit_state ENABLE ROW LEVEL SECURITY;
