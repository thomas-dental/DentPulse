-- ============================================
-- Add Dentally account UUID column to dentally_patients_accounts.
--
-- The /v1/accounts endpoint returns both a numeric `id` (already stored
-- as da_id) and a `uuid`. The UUID is what Dentally uses in app URLs:
--   https://app.dentally.co/patients/{patient_uuid}/account/{account_uuid}
-- so we need it to deep-link from DentPulse rows into Dentally's account
-- page (e.g. from the ProviderActivity Price column).
--
-- Safe to re-run. Existing rows get NULL until the next accounts sync
-- repopulates them via the transformer.
-- ============================================

ALTER TABLE public.dentally_patients_accounts
  ADD COLUMN IF NOT EXISTS da_uuid UUID;

CREATE INDEX IF NOT EXISTS idx_dentally_patients_accounts_da_uuid
  ON public.dentally_patients_accounts(da_uuid);

COMMENT ON COLUMN public.dentally_patients_accounts.da_uuid IS
  'Dentally account UUID (from /v1/accounts.uuid). Used to build deep-link URLs into Dentally''s account page.';
