-- ============================================================
-- Auto-sync runs: one row per organization per day, written by the
-- after-close auto-sync cron (services/autoSyncCron.js).
--
-- The row doubles as a CLAIM: the cron inserts it (status 'triggered')
-- BEFORE creating sync jobs, and the unique (organization_id, run_date)
-- index guarantees the nightly sync fires at most once per org per day —
-- even across server restarts or overlapping cron ticks. On failure the
-- row is marked 'failed' (kept for history) and the next 15-minute tick
-- atomically reclaims it (UPDATE ... WHERE status = 'failed') to retry.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.auto_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The clinic-local calendar day this run belongs to (Europe/London by
  -- default), NOT the UTC day — the once-per-day guarantee must follow the
  -- clinic's clock.
  run_date DATE NOT NULL,

  -- What the cron decided for this run (for debugging "why did it fire then").
  close_time TEXT,                 -- latest close across open locations, e.g. '17:30'
  window_start DATE,               -- incremental sync window passed to triggerSync
  window_end DATE,

  status TEXT NOT NULL DEFAULT 'triggered' CHECK (status IN ('triggered', 'completed', 'failed')),
  job_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,

  triggered_by TEXT NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual-check'
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The claim: at most one auto-sync per org per clinic-local day.
CREATE UNIQUE INDEX IF NOT EXISTS auto_sync_runs_org_date_idx
  ON public.auto_sync_runs (organization_id, run_date);

-- "Recent runs for this org" — the admin history query.
CREATE INDEX IF NOT EXISTS auto_sync_runs_org_triggered_idx
  ON public.auto_sync_runs (organization_id, triggered_at DESC);

-- Written by the cron via the service-role key (bypasses RLS). RLS enabled
-- with no policies so anon / authenticated clients are denied by default.
ALTER TABLE public.auto_sync_runs ENABLE ROW LEVEL SECURITY;
