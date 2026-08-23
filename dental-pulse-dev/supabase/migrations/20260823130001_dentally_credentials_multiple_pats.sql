-- Allow multiple Dentally PATs per practice and store a masked hint for UI display.

ALTER TABLE public.dentally_credentials
  DROP CONSTRAINT IF EXISTS dentally_credentials_practice_id_unique;

ALTER TABLE public.dentally_credentials
  ADD COLUMN IF NOT EXISTS pat_hint TEXT,
  ADD COLUMN IF NOT EXISTS label TEXT;

UPDATE public.dentally_credentials
SET pat_hint = '••••••••'
WHERE pat_hint IS NULL;

ALTER TABLE public.dentally_credentials
  ALTER COLUMN pat_hint SET DEFAULT '••••••••';

COMMENT ON COLUMN public.dentally_credentials.pat_hint IS
  'Masked PAT prefix/suffix for UI display only — never the full token.';
COMMENT ON COLUMN public.dentally_credentials.label IS
  'Optional user label to distinguish multiple PATs for the same practice.';

CREATE INDEX IF NOT EXISTS idx_dentally_credentials_practice_created_at
  ON public.dentally_credentials(practice_id, created_at DESC);
