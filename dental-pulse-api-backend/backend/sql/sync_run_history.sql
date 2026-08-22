-- ============================================================
-- Sync run history: an append-only record of how each sync run finished.
--
-- Distinct from sync_jobs. sync_jobs is MUTABLE working state — rows are
-- updated in place as a job progresses and are cleaned up / re-queued, so
-- it cannot answer "how has this org's sync behaved over the last month".
-- One row is appended here per terminal outcome (completed / failed /
-- cancelled) and is never updated.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sync_run_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Deliberately NOT a foreign key: history must outlive the sync_jobs row,
  -- which gets deleted by the queue cleanup routines.
  job_id UUID,

  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id UUID,
  entity_alias TEXT,

  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'cancelled')),
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  current_page INTEGER,
  total_pages INTEGER,
  error_message TEXT,

  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Generated so it can never drift from the timestamps it is derived from.
  duration_seconds NUMERIC GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (finished_at - started_at))
  ) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Recent runs for this org" — the main reporting query.
CREATE INDEX IF NOT EXISTS sync_run_history_org_finished_idx
  ON public.sync_run_history (organization_id, finished_at DESC);

-- Surfacing failures across all orgs.
CREATE INDEX IF NOT EXISTS sync_run_history_status_idx
  ON public.sync_run_history (status, finished_at DESC);

CREATE INDEX IF NOT EXISTS sync_run_history_job_idx
  ON public.sync_run_history (job_id);

-- Written by the sync workers via the service-role key.
ALTER TABLE public.sync_run_history ENABLE ROW LEVEL SECURITY;
