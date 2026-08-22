-- Add tpi_treatment_id column to treatment_plan_items table
-- This column stores the Dentally treatment_id (matches treatments.external_id)
-- This allows direct linking of treatment plan items to treatments

DO $$
BEGIN
    -- Add tpi_treatment_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'treatment_plan_items'
        AND column_name = 'tpi_treatment_id'
    ) THEN
        ALTER TABLE public.treatment_plan_items
        ADD COLUMN tpi_treatment_id BIGINT NULL;

        RAISE NOTICE 'Added column tpi_treatment_id to treatment_plan_items';
        
        -- Add comment
        COMMENT ON COLUMN public.treatment_plan_items.tpi_treatment_id 
        IS 'Treatment ID from Dentally API (matches treatments.external_id). This directly links treatment plan items to treatments.';
        
        -- Create index for better query performance
        CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_treatment_id
        ON public.treatment_plan_items(organization_id, tpi_treatment_id)
        WHERE tpi_treatment_id IS NOT NULL;
        
        RAISE NOTICE 'Created index idx_treatment_plan_items_tpi_treatment_id';
        
        -- Create composite index for common queries (treatment plan items by treatment)
        CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_by_treatment
        ON public.treatment_plan_items(organization_id, tpi_treatment_id, tpi_completed)
        WHERE deleted_at IS NULL AND tpi_treatment_id IS NOT NULL;
        
        RAISE NOTICE 'Created composite index idx_treatment_plan_items_by_treatment';
    ELSE
        RAISE NOTICE 'Column tpi_treatment_id already exists in treatment_plan_items';
    END IF;
END $$;
