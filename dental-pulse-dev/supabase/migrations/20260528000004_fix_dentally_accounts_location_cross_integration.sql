-- ============================================
-- Corrective migration: rewrite dentally_patients_accounts.location_id where
-- it was populated by the cross-integration-buggy resolver/backfill.
--
-- Bug: the original resolver (in node processor.js) and the original
-- 20260528000003 backfill matched accounts to patients by (organization_id,
-- pt_id) only. Dentally pt_id collides across integrations within the same
-- org (each Dentally practice reuses the numbers), so an account belonging
-- to South Street could pick up a Megor patient's location_id and vice
-- versa. See memory: project_dentally_id_collision.
--
-- This migration rewrites location_id to the correct value derived from
-- (organization_id, integration_id, pt_id). Also nulls out location_id on
-- any account whose own integration_id is missing (we can't safely resolve
-- those — a follow-up sync will repopulate via the patched resolver).
--
-- Safe to re-run: each statement is idempotent. Only touches accounts whose
-- current location_id differs from the correctly-scoped patient lookup.
-- ============================================

-- Step 1: rewrite to the integration-scoped patient location where it differs
UPDATE public.dentally_patients_accounts AS a
SET location_id = p.location_id,
    updated_at = NOW()
FROM public.patients AS p
WHERE a.deleted_at IS NULL
  AND a.da_patient_id IS NOT NULL
  AND a.integration_id IS NOT NULL
  AND p.pt_id = a.da_patient_id
  AND p.organization_id = a.organization_id
  AND p.integration_id = a.integration_id
  AND p.deleted_at IS NULL
  AND p.location_id IS NOT NULL
  AND (a.location_id IS DISTINCT FROM p.location_id);

-- Step 2: clear location_id on accounts whose own integration_id is missing
-- and whose current location_id is therefore unverifiable. They'll be
-- repopulated on the next accounts sync (now patched to scope by integration).
UPDATE public.dentally_patients_accounts
SET location_id = NULL,
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND integration_id IS NULL
  AND location_id IS NOT NULL;
