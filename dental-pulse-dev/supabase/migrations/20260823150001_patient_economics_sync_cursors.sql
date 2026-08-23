-- ============================================================================
-- Patient Economics Engine — resumable sync cursors
--
-- Why a new table (not an extension of sync_jobs / integration_sync_entities):
--   • sync_jobs tracks mutable per-JOB working state keyed by integration_id
--     (integrations.api_key lane). PE sync uses dentally_credentials (encrypted
--     PAT per practice_id) — a different identity and queue ownership model.
--   • integration_sync_entities stores last_synced_at watermarks per
--     integration × entity, not page-level resume cursors per practice.
--   • finance_sync_runs.cursor_json is scoped to canonical finance sources.
--   • sync_runs (PE Day 1) is run-level audit only — one row per invocation,
--     not a standing checkpoint per resource.
--
-- sync_cursors holds exactly one row per (practice_id, resource_type). The
-- backend upserts cursor + status after each successfully processed chunk.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '1',
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'complete', 'failed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sync_cursors_practice_resource_unique UNIQUE (practice_id, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_sync_cursors_practice_id
  ON public.sync_cursors(practice_id);

CREATE INDEX IF NOT EXISTS idx_sync_cursors_practice_status
  ON public.sync_cursors(practice_id, status);

COMMENT ON TABLE public.sync_cursors IS
  'Patient Economics: per-practice, per-resource sync checkpoint. One row per resource; upserted as chunks complete.';
COMMENT ON COLUMN public.sync_cursors.practice_id IS
  'FK to public.organizations (tenant / practice). Same key as dentally_credentials.practice_id.';
COMMENT ON COLUMN public.sync_cursors.resource_type IS
  'Dentally resource being synced, e.g. patients, accounts, recalls. Lowercase slug.';
COMMENT ON COLUMN public.sync_cursors.cursor IS
  'Opaque checkpoint for the next chunk. Default "1" (first page). JSON allowed for date-chunked resources — see sync/README.md.';
COMMENT ON COLUMN public.sync_cursors.status IS
  'in_progress: more chunks remain; complete: resource fully synced; failed: last chunk errored (cursor = last good position).';

DROP TRIGGER IF EXISTS set_sync_cursors_updated_at ON public.sync_cursors;
CREATE TRIGGER set_sync_cursors_updated_at
  BEFORE UPDATE ON public.sync_cursors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Mirror sync_runs: org members may read; writes via service role only.
ALTER TABLE public.sync_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sync cursors for their practice" ON public.sync_cursors;
CREATE POLICY "Users can view sync cursors for their practice"
  ON public.sync_cursors
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  );

REVOKE ALL ON TABLE public.sync_cursors FROM anon, authenticated;
GRANT SELECT ON TABLE public.sync_cursors TO authenticated;
GRANT ALL ON TABLE public.sync_cursors TO service_role;
