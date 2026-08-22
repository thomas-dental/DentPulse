-- ============================================================================
-- Fix NHS claims duplication
-- ----------------------------------------------------------------------------
-- Root cause: the sync stored `nc_id` via parseBigInt(record.id), but the
-- Dentally /v1/nhs_claims `id` is a UUID — so parseBigInt always returned NULL.
-- The upsert key was (organization_id, nc_id) = (org, NULL), and since NULL is
-- never equal to NULL in a unique constraint, every sync run RE-INSERTED every
-- claim instead of updating it (observed ~8x duplication; e.g. 88 rows for the
-- 11 real May-2026 claims).
--
-- Fix: key the upsert/dedupe on (organization_id, nc_sequence_number) — the NHS
-- reference number, which is populated on every row (verified 0 NULLs) and is
-- unique per claim (verified: 14,625 distinct claims across the DB, only 1
-- negligible anomaly, 0 cross-integration overlaps). Also store the claim's
-- canonical Dentally UUID in nc_uuid for reference/deep-links.
-- ============================================================================

-- 1) Canonical Dentally NHS-claim UUID (populated by the sync going forward).
ALTER TABLE public.nhs_claims ADD COLUMN IF NOT EXISTS nc_uuid TEXT;
CREATE INDEX IF NOT EXISTS idx_nhs_claims_nc_uuid ON public.nhs_claims(nc_uuid);

-- 2) De-duplicate existing rows: keep exactly one row per
--    (organization_id, nc_sequence_number), preferring a non-deleted,
--    most-recently-created row. Everything else is removed.
DELETE FROM public.nhs_claims
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY organization_id, nc_sequence_number
             ORDER BY (deleted_at IS NULL) DESC, created_at DESC NULLS LAST, id DESC
           ) AS rn
    FROM public.nhs_claims
    WHERE nc_sequence_number IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

-- 3) Replace the broken unique key (org, nc_id) with (org, nc_sequence_number)
--    so future syncs UPDATE the existing claim instead of inserting a copy.
ALTER TABLE public.nhs_claims DROP CONSTRAINT IF EXISTS nhs_claims_org_nc_id_key;
ALTER TABLE public.nhs_claims
  ADD CONSTRAINT nhs_claims_org_sequence_key UNIQUE (organization_id, nc_sequence_number);

COMMENT ON COLUMN public.nhs_claims.nc_uuid IS 'Canonical Dentally NHS-claim UUID (record.id from /v1/nhs_claims).';
COMMENT ON COLUMN public.nhs_claims.nc_sequence_number IS 'NHS reference number. Unique per claim; the (organization_id, nc_sequence_number) upsert/dedupe key. nc_id is unused (the API id is a UUID, kept in nc_uuid).';
