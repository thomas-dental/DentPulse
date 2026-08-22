-- ============================================
-- Stronger backfill for dentally_patients_accounts.location_id.
--
-- The earlier resolver / backfills only filled location_id when an account's
-- patient row existed AND had a non-null location_id. Real data leaves
-- accounts NULL in three other situations:
--   (a) Patient row hasn't been synced yet
--   (b) Patient row exists but its own location_id is NULL
--   (c) Account record has no patient_id
--
-- This migration adds a single-location-integration fallback: when an
-- integration is connected to exactly ONE practice_location, every account
-- in that integration must belong to it (a single-site Dentally account
-- can't legitimately route anywhere else). This handles all three cases
-- for the most common setup. Multi-site integrations still need a real
-- patient → location chain.
--
-- Order matters:
--   Step 1: patient-based lookup (integration-scoped, accurate)
--   Step 2: single-location fallback for whatever's still NULL
--
-- Safe to re-run. Idempotent (won't overwrite a value with itself).
-- ============================================

-- Step 1: integration-scoped patient lookup
UPDATE public.dentally_patients_accounts AS a
SET location_id = p.location_id,
    updated_at = NOW()
FROM public.patients AS p
WHERE a.location_id IS NULL
  AND a.deleted_at IS NULL
  AND a.da_patient_id IS NOT NULL
  AND a.integration_id IS NOT NULL
  AND p.pt_id = a.da_patient_id
  AND p.organization_id = a.organization_id
  AND p.integration_id = a.integration_id
  AND p.deleted_at IS NULL
  AND p.location_id IS NOT NULL;

-- Step 2: single-location-integration fallback. For each integration that
-- has exactly one active practice_location, set location_id on every
-- still-null account belonging to that integration.
-- (array_agg(id))[1] instead of MIN(id) because Postgres has no MIN() for
-- uuid; the HAVING COUNT(*) = 1 guarantees a single element either way.
WITH single_loc_integrations AS (
  SELECT integration_id, (array_agg(id))[1] AS location_id
  FROM public.practice_locations
  WHERE integration_id IS NOT NULL
    AND deleted_at IS NULL
  GROUP BY integration_id
  HAVING COUNT(*) = 1
)
UPDATE public.dentally_patients_accounts AS a
SET location_id = sli.location_id,
    updated_at = NOW()
FROM single_loc_integrations AS sli
WHERE a.location_id IS NULL
  AND a.deleted_at IS NULL
  AND a.integration_id = sli.integration_id;
