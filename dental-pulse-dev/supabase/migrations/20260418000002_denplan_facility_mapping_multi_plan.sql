-- Multi-plan support for Denplan facility mappings.
-- A single facility CSV can contain rows across multiple Denplan product
-- tiers (e.g. Denplan Care + Denplan Essentials for one practitioner), so
-- a mapping needs to be able to reference many payment_plans, not just one.
-- We keep the single `payment_plan_id` column for backwards compatibility
-- during the transition — reads prefer the array, writes populate both.

ALTER TABLE public.denplan_facility_mappings
  ADD COLUMN IF NOT EXISTS payment_plan_ids UUID[] DEFAULT '{}'::UUID[];

-- Backfill: seed the array from any existing single-plan mapping.
UPDATE public.denplan_facility_mappings
SET payment_plan_ids = ARRAY[payment_plan_id]::UUID[]
WHERE payment_plan_id IS NOT NULL
  AND (payment_plan_ids IS NULL OR array_length(payment_plan_ids, 1) IS NULL);

-- GIN index for "facility has plan X" lookups (cheap — mapping rows are few).
CREATE INDEX IF NOT EXISTS idx_denplan_facility_payment_plan_ids
  ON public.denplan_facility_mappings USING GIN (payment_plan_ids);

COMMENT ON COLUMN public.denplan_facility_mappings.payment_plan_ids IS
  'All payment plans this facility maps to. When multiple, the per-row override picks the plan whose name best matches the CSV fee_category.';
