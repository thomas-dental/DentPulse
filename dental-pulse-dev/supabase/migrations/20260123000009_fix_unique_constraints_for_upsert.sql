-- Fix unique constraints for treatments and treatment_categories tables
-- Convert UNIQUE INDEX to UNIQUE CONSTRAINT for Supabase upsert to work properly

-- ============================================
-- TREATMENTS TABLE
-- ============================================

-- Step 1: Drop the unique index if it exists
DROP INDEX IF EXISTS idx_treatments_org_external_id_unique;

-- Step 2: Create proper UNIQUE CONSTRAINT for treatments
DO $$
BEGIN
    -- Check if constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'treatments_org_external_id_unique'
        AND conrelid = 'public.treatments'::regclass
    ) THEN
        -- Create unique constraint (required for upsert ON CONFLICT to work)
        ALTER TABLE public.treatments
        ADD CONSTRAINT treatments_org_external_id_unique 
        UNIQUE (organization_id, external_id);
        
        RAISE NOTICE 'Created unique constraint treatments_org_external_id_unique';
    END IF;
END $$;

-- Step 3: Keep the index for faster lookups (separate from constraint)
CREATE INDEX IF NOT EXISTS idx_treatments_org_external_id ON public.treatments(organization_id, external_id) 
WHERE external_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================
-- TREATMENT_CATEGORIES TABLE
-- ============================================

-- Step 1: Drop the unique index if it exists
DROP INDEX IF EXISTS idx_treatment_categories_org_external_id_unique;

-- Step 2: Create proper UNIQUE CONSTRAINT for treatment_categories
DO $$
BEGIN
    -- Check if constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'treatment_categories_org_external_id_unique'
        AND conrelid = 'public.treatment_categories'::regclass
    ) THEN
        -- Create unique constraint (required for upsert ON CONFLICT to work)
        ALTER TABLE public.treatment_categories
        ADD CONSTRAINT treatment_categories_org_external_id_unique 
        UNIQUE (organization_id, external_id);
        
        RAISE NOTICE 'Created unique constraint treatment_categories_org_external_id_unique';
    END IF;
END $$;

-- Step 3: Keep the index for faster lookups (separate from constraint)
CREATE INDEX IF NOT EXISTS idx_treatment_categories_org_external_id ON public.treatment_categories(organization_id, external_id) 
WHERE external_id IS NOT NULL AND deleted_at IS NULL;
