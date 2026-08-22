-- Add unique constraints to treatment_plan_items and treatment_appointments tables
-- This ensures we don't have duplicate records from the same organization and API ID

-- Add unique constraint for treatment_plan_items (only if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'treatment_plan_items_org_tpi_id_key'
  ) THEN
    ALTER TABLE public.treatment_plan_items
    ADD CONSTRAINT treatment_plan_items_org_tpi_id_key
      UNIQUE (organization_id, tpi_id);
  END IF;
END $$;

-- Add unique constraint for treatment_appointments (only if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'treatment_appointments_org_ta_id_key'
  ) THEN
    ALTER TABLE public.treatment_appointments
    ADD CONSTRAINT treatment_appointments_org_ta_id_key
      UNIQUE (organization_id, ta_id);
  END IF;
END $$;

-- Add comments
COMMENT ON CONSTRAINT treatment_plan_items_org_tpi_id_key ON public.treatment_plan_items IS 'Ensures unique treatment plan items per organization and API ID';
COMMENT ON CONSTRAINT treatment_appointments_org_ta_id_key ON public.treatment_appointments IS 'Ensures unique treatment appointments per organization and API ID';
