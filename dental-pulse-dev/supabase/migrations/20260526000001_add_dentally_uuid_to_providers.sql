-- Add nullable dentally_uuid column to providers.
--
-- Purpose:
--   Stores the Dentally practitioner UUID (DentallyPractitioner.uuid from the
--   public API). Required to deep-link into Dentally's web-app reports, which
--   use the UUID rather than the numeric external_id we currently sync.
--
-- Safety:
--   * NULLABLE, no DEFAULT — does not read or write any existing row data.
--   * No UPDATE / DELETE / data backfill statements in this migration.
--   * Idempotent (IF NOT EXISTS) — safe to run more than once.
--   * All existing provider rows simply become NULL on this column until a
--     Dentally re-sync backfills them via the updated transformer.
--
-- Historical context:
--   The same column existed previously and was dropped in
--   20260123000007_remove_unnecessary_dentally_provider_fields.sql when the
--   Dentally web-app deep-link feature wasn't needed. Re-adding it now.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS dentally_uuid uuid NULL;

COMMENT ON COLUMN public.providers.dentally_uuid IS
  'Dentally practitioner UUID (DentallyPractitioner.uuid from /v1/practitioners). Used for deep-linking into Dentally web-app reports. Populated by the backend sync transformer; NULL for rows synced before the column existed.';
