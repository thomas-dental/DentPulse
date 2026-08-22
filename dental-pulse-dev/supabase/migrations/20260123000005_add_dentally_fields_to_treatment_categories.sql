-- Add Dentally-specific fields to treatment_categories table
-- These fields store data synced from Dentally API

ALTER TABLE public.treatment_categories
  -- External ID from Dentally API (integer ID from Dentally system)
  ADD COLUMN IF NOT EXISTS external_id integer;

-- Add comment for new field
COMMENT ON COLUMN public.treatment_categories.external_id IS 'External ID from Dentally API (used for syncing and matching records)';

-- Create index on external_id for faster lookups during sync operations
CREATE INDEX IF NOT EXISTS idx_treatment_categories_external_id ON public.treatment_categories(external_id) WHERE external_id IS NOT NULL;

-- Create unique constraint on external_id per organization to prevent duplicates
-- This ensures we don't sync the same Dentally treatment category twice for an organization
-- Note: Using UNIQUE CONSTRAINT (not index) for Supabase upsert to work properly
DO $$
BEGIN
    -- Drop the index if it exists (we'll create a constraint instead)
    DROP INDEX IF EXISTS idx_treatment_categories_org_external_id_unique;
    
    -- Create unique constraint (required for upsert ON CONFLICT to work)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'treatment_categories_org_external_id_unique'
        AND conrelid = 'public.treatment_categories'::regclass
    ) THEN
        ALTER TABLE public.treatment_categories
        ADD CONSTRAINT treatment_categories_org_external_id_unique 
        UNIQUE (organization_id, external_id);
    END IF;
END $$;

-- Create index for faster lookups (separate from constraint)
CREATE INDEX IF NOT EXISTS idx_treatment_categories_org_external_id ON public.treatment_categories(organization_id, external_id) 
WHERE external_id IS NOT NULL AND deleted_at IS NULL;
