-- ============================================================================
-- Patient Economics: sync retry + scheduling support
--
-- - sync_cursors: distinct `retryable` status + backoff metadata
-- - dentally_credentials: auth failure / needs reconnection flag
-- - sync_skipped_records: reviewable per-record data/validation skips
-- ============================================================================

-- ---------------------------------------------------------------------------
-- sync_cursors: retryable status + retry metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.sync_cursors
  DROP CONSTRAINT IF EXISTS sync_cursors_status_check;

ALTER TABLE public.sync_cursors
  ADD CONSTRAINT sync_cursors_status_check
  CHECK (status IN ('in_progress', 'complete', 'failed', 'retryable'));

ALTER TABLE public.sync_cursors
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT;

CREATE INDEX IF NOT EXISTS idx_sync_cursors_scheduler
  ON public.sync_cursors(status, next_retry_at, updated_at);

COMMENT ON COLUMN public.sync_cursors.status IS
  'in_progress: actively syncing / more chunks remain; retryable: transient failure, scheduler will resume after next_retry_at; complete: done; failed: terminal (auth or retries exhausted) — no auto-retry.';
COMMENT ON COLUMN public.sync_cursors.retry_count IS
  'Consecutive transient/unknown failure attempts for this resource. Reset on successful chunk.';
COMMENT ON COLUMN public.sync_cursors.next_retry_at IS
  'Earliest time the scheduler may resume a retryable cursor.';
COMMENT ON COLUMN public.sync_cursors.last_error IS
  'Last error message (no secrets).';
COMMENT ON COLUMN public.sync_cursors.last_error_code IS
  'Machine code: TRANSIENT_RETRY, PAT_EXPIRED_OR_INVALID, SYNC_ERROR, etc.';

-- ---------------------------------------------------------------------------
-- dentally_credentials: needs reconnection after auth failure
-- ---------------------------------------------------------------------------
ALTER TABLE public.dentally_credentials
  ADD COLUMN IF NOT EXISTS needs_reconnection BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_error_message TEXT,
  ADD COLUMN IF NOT EXISTS auth_failed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.dentally_credentials.needs_reconnection IS
  'True when Dentally rejected the PAT (401/403). Scheduler skips this practice until a new PAT is saved and validated.';
COMMENT ON COLUMN public.dentally_credentials.auth_error_message IS
  'Last auth failure message (no token). Cleared when PAT is re-validated.';
COMMENT ON COLUMN public.dentally_credentials.auth_failed_at IS
  'When needs_reconnection was last set.';

CREATE INDEX IF NOT EXISTS idx_dentally_credentials_needs_reconnection
  ON public.dentally_credentials(practice_id)
  WHERE needs_reconnection = true;

-- ---------------------------------------------------------------------------
-- sync_skipped_records: reviewable data/validation skips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_skipped_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sync_run_id UUID REFERENCES public.sync_runs(id) ON DELETE SET NULL,
  resource_type TEXT NOT NULL,
  entity_alias TEXT NOT NULL,
  external_id TEXT,
  reason TEXT NOT NULL,
  error_message TEXT,
  record_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_skipped_records_practice_created
  ON public.sync_skipped_records(practice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_skipped_records_sync_run
  ON public.sync_skipped_records(sync_run_id)
  WHERE sync_run_id IS NOT NULL;

COMMENT ON TABLE public.sync_skipped_records IS
  'Patient Economics: records skipped during sync (transform/validation/upsert). Reviewable; does not fail the chunk.';

ALTER TABLE public.sync_skipped_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sync skipped records for their practice"
  ON public.sync_skipped_records;
CREATE POLICY "Users can view sync skipped records for their practice"
  ON public.sync_skipped_records
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  );

REVOKE ALL ON TABLE public.sync_skipped_records FROM anon, authenticated;
GRANT SELECT ON TABLE public.sync_skipped_records TO authenticated;
GRANT ALL ON TABLE public.sync_skipped_records TO service_role;
