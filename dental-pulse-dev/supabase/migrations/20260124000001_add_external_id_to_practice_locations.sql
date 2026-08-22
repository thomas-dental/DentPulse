-- Add external_id field to practice_locations table
-- This field stores Dentally site ID (UUID) for syncing and matching records

ALTER TABLE public.practice_locations
  -- External ID from Dentally API (UUID string from Dentally system)
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

-- Add comment for new field
COMMENT ON COLUMN public.practice_locations.external_id IS 'External ID from Dentally API (used for syncing and matching records)';

-- Create index on external_id for faster lookups during sync operations
CREATE INDEX IF NOT EXISTS idx_practice_locations_external_id ON public.practice_locations(external_id) WHERE external_id IS NOT NULL;

-- Create unique constraint on external_id per organization to prevent duplicates
-- This ensures we don't sync the same Dentally site twice for an organization
DO $$
BEGIN
    -- Drop the index if it exists (we'll create a constraint instead)
    DROP INDEX IF EXISTS idx_practice_locations_org_external_id_unique;
    
    -- Create unique constraint (required for upsert ON CONFLICT to work)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'practice_locations_org_external_id_unique'
        AND conrelid = 'public.practice_locations'::regclass
    ) THEN
        ALTER TABLE public.practice_locations
        ADD CONSTRAINT practice_locations_org_external_id_unique 
        UNIQUE (organization_id, external_id);
    END IF;
END $$;

-- Create index for faster lookups (separate from constraint)
CREATE INDEX IF NOT EXISTS idx_practice_locations_org_external_id ON public.practice_locations(organization_id, external_id) 
WHERE external_id IS NOT NULL AND deleted_at IS NULL;
