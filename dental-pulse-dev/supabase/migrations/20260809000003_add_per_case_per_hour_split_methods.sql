-- Add "Per Case" and "Per Hour" as Associate Split Configuration methods,
-- alongside the existing Flat Percentage / Sliding Scale. Each gets its own
-- flat rate column. UI-only for now -- not wired into the profit-metrics RPC
-- (chart_get_profit_metrics), which keeps using lab_split_percentage for any
-- method other than 'sliding-scale', same as it already does today.

-- The original CHECK constraint was added anonymously (Postgres auto-named
-- it), so look up its actual name rather than guessing.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.providers'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%split_source_method%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.providers DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.providers
  ADD CONSTRAINT providers_split_source_method_check
  CHECK (split_source_method IN ('flat-percentage', 'sliding-scale', 'per-case', 'per-hour'));

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS associate_split_per_case_rate numeric,
  ADD COLUMN IF NOT EXISTS associate_split_per_hour_rate numeric;

COMMENT ON COLUMN public.providers.associate_split_per_case_rate IS 'Flat rate paid per case when split_source_method = per-case';
COMMENT ON COLUMN public.providers.associate_split_per_hour_rate IS 'Flat rate paid per hour when split_source_method = per-hour';
