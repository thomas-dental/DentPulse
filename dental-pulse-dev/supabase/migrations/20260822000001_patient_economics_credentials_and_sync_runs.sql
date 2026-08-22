-- ============================================================================
-- Patient Economics Engine (milestone 1) — credentials + sync run tracking
--
-- practice_id references public.organizations (DentPulse tenant / "practice").
-- Edge Functions use the service role to read/write these tables; client
-- access is intentionally locked down (credentials) or read-scoped (sync_runs).
--
-- LATER MILESTONE — Event Ledger:
--   Attach event_ledger (or equivalent) here with practice_id FK to
--   public.organizations(id), linking sync provenance to sync_runs.id.
--
-- LATER MILESTONE — Contribution / provenance tables:
--   Attach contribution and provenance tables here (practice_id FK,
--   optional sync_run_id / event references). Do not create them in this
--   migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- dentally_credentials
-- Encrypted Dentally PAT storage. Readable/writable only via service role
-- (Edge Functions). RLS enabled with ZERO policies for anon/authenticated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dentally_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  encrypted_pat TEXT NOT NULL,
  encrypted_pat_iv TEXT NOT NULL,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dentally_credentials_practice_id_unique UNIQUE (practice_id)
);

CREATE INDEX IF NOT EXISTS idx_dentally_credentials_practice_id
  ON public.dentally_credentials(practice_id);

COMMENT ON TABLE public.dentally_credentials IS
  'Patient Economics: encrypted Dentally PATs. Deny-all RLS for anon/authenticated; Edge Functions use service role only.';
COMMENT ON COLUMN public.dentally_credentials.practice_id IS
  'FK to public.organizations (tenant / practice).';

ALTER TABLE public.dentally_credentials ENABLE ROW LEVEL SECURITY;
-- No CREATE POLICY for anon or authenticated → all client roles denied.
-- service_role bypasses RLS.

REVOKE ALL ON TABLE public.dentally_credentials FROM anon, authenticated;
GRANT ALL ON TABLE public.dentally_credentials TO service_role;

DROP TRIGGER IF EXISTS set_dentally_credentials_updated_at ON public.dentally_credentials;
CREATE TRIGGER set_dentally_credentials_updated_at
  BEFORE UPDATE ON public.dentally_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- sync_runs
-- Sync job history for Patient Economics. Authenticated org members may
-- SELECT rows for practices they belong to (user_in_org / user_roles).
-- Writes remain service-role only (Edge Functions).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_practice_id
  ON public.sync_runs(practice_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_practice_started_at
  ON public.sync_runs(practice_id, started_at DESC);

COMMENT ON TABLE public.sync_runs IS
  'Patient Economics: sync run status history. Org members can SELECT; writes via service role.';
COMMENT ON COLUMN public.sync_runs.practice_id IS
  'FK to public.organizations (tenant / practice).';

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sync runs for their practice" ON public.sync_runs;
CREATE POLICY "Users can view sync runs for their practice"
  ON public.sync_runs
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  );

REVOKE ALL ON TABLE public.sync_runs FROM anon;
GRANT SELECT ON TABLE public.sync_runs TO authenticated;
GRANT ALL ON TABLE public.sync_runs TO service_role;

-- LATER MILESTONE placeholders (comments only — no DDL):
--   Event Ledger tables → practice_id → organizations; sync_run_id → sync_runs
--   Contribution / provenance tables → practice_id → organizations; event refs
