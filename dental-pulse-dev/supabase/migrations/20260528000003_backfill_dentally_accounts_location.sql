-- ============================================
-- Idempotent backfill: populate location_id on dentally_patients_accounts
-- rows that are missing one, by looking up the account's patient.
--
-- The node sync resolver (resolveAccountLocationsFromPatients) sets
-- location_id at sync time, but accounts synced before patients (or
-- accounts whose patient_id doesn't yet exist in the patients table)
-- can land with a NULL location_id. This migration patches them.
--
-- CRITICAL: scope EVERY join by integration_id, not just organization_id.
-- Dentally pt_id is unique per integration, NOT per org — when an org has
-- multiple Dentally practices, the same pt_id exists in each integration's
-- patient set, each pointing to its own location. Matching by org alone
-- would cross-bleed locations between practices.
--
-- Safe to re-run: only touches rows where location_id IS NULL, and only
-- when a non-null patients.location_id is available within the same
-- (organization_id, integration_id) bucket.
-- ============================================

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
