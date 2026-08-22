-- Alter treatment_goal_targets.period_date from DATE to VARCHAR
-- Store period as 'M-YYYY' format (e.g., '1-2026' for January 2026) or 'YYYY' for year

-- Drop the unique index that uses period_date (must drop before altering column)
DROP INDEX IF EXISTS idx_treatment_goal_targets_unique;

-- First, add a temporary column to store the converted values
ALTER TABLE public.treatment_goal_targets 
  ADD COLUMN period_date_temp VARCHAR(20);

-- Convert existing data to the new format and store in temp column
-- For month: convert DATE to 'M-YYYY' format
-- For year: convert DATE to 'YYYY' format
UPDATE public.treatment_goal_targets
SET period_date_temp = CASE 
  WHEN period_type = 'month' THEN 
    EXTRACT(MONTH FROM period_date)::TEXT || '-' || EXTRACT(YEAR FROM period_date)::TEXT
  WHEN period_type = 'year' THEN 
    EXTRACT(YEAR FROM period_date)::TEXT
  ELSE period_date::TEXT
END;

-- Drop the old period_date column
ALTER TABLE public.treatment_goal_targets 
  DROP COLUMN period_date;

-- Rename the temp column to period_date
ALTER TABLE public.treatment_goal_targets 
  RENAME COLUMN period_date_temp TO period_date;

-- Make period_date NOT NULL (if it was NOT NULL before)
ALTER TABLE public.treatment_goal_targets 
  ALTER COLUMN period_date SET NOT NULL;

-- Remove duplicate records before creating unique index
-- Keep the most recent record (based on updated_at, then created_at) for each unique combination
DELETE FROM public.treatment_goal_targets
WHERE id IN (
  SELECT id
  FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (
        PARTITION BY 
          organization_id, 
          category_name, 
          period_type, 
          period_date, 
          COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::UUID), 
          COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::UUID)
        ORDER BY updated_at DESC, created_at DESC
      ) as rn
    FROM public.treatment_goal_targets
  ) t
  WHERE rn > 1
);

-- Recreate the unique index with the new VARCHAR type
CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_goal_targets_unique
  ON public.treatment_goal_targets(
    organization_id, 
    category_name, 
    period_type, 
    period_date, 
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::UUID), 
    COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::UUID)
  );

-- Update the comment
COMMENT ON COLUMN public.treatment_goal_targets.period_date IS 'Period identifier: "M-YYYY" format for months (e.g., "1-2026") or "YYYY" format for years';
