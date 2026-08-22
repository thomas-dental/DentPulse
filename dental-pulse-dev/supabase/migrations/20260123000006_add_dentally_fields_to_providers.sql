-- Add Dentally-specific fields to providers table
-- These fields store essential data synced from Dentally API

ALTER TABLE public.providers
  -- External ID from Dentally API (integer ID from Dentally system) - ESSENTIAL for syncing
  ADD COLUMN IF NOT EXISTS external_id integer,
  
  -- Essential Dentally API fields
  ADD COLUMN IF NOT EXISTS gdc_number varchar(50), -- GDC registration number
  ADD COLUMN IF NOT EXISTS nhs_number varchar(50), -- NHS number
  ADD COLUMN IF NOT EXISTS uda_target numeric(10, 2), -- UDA target (NHS)
  ADD COLUMN IF NOT EXISTS uoa_target numeric(10, 2); -- UOA target (NHS)

-- Add comments for new fields
COMMENT ON COLUMN public.providers.external_id IS 'External ID from Dentally API (used for syncing and matching records)';
COMMENT ON COLUMN public.providers.gdc_number IS 'GDC registration number from Dentally API';
COMMENT ON COLUMN public.providers.nhs_number IS 'NHS number from Dentally API';
COMMENT ON COLUMN public.providers.uda_target IS 'UDA target from Dentally API (NHS)';
COMMENT ON COLUMN public.providers.uoa_target IS 'UOA target from Dentally API (NHS)';

-- Create index on external_id for faster lookups during sync operations
CREATE INDEX IF NOT EXISTS idx_providers_external_id ON public.providers(external_id) WHERE external_id IS NOT NULL;

-- Create index on gdc_number for GDC number lookups
CREATE INDEX IF NOT EXISTS idx_providers_gdc_number ON public.providers(gdc_number) WHERE gdc_number IS NOT NULL;

-- Create unique constraint on external_id per organization to prevent duplicates
-- This ensures we don't sync the same Dentally practitioner twice for an organization
-- Note: Using UNIQUE CONSTRAINT (not index) for Supabase upsert to work properly
DO $$
BEGIN
    -- Drop the index if it exists (we'll create a constraint instead)
    DROP INDEX IF EXISTS idx_providers_org_external_id_unique;
    
    -- Create unique constraint (required for upsert ON CONFLICT to work)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'providers_org_external_id_unique'
        AND conrelid = 'public.providers'::regclass
    ) THEN
        ALTER TABLE public.providers
        ADD CONSTRAINT providers_org_external_id_unique 
        UNIQUE (organization_id, external_id);
    END IF;
END $$;

-- Create index for faster lookups (separate from constraint)
CREATE INDEX IF NOT EXISTS idx_providers_org_external_id ON public.providers(organization_id, external_id) 
WHERE external_id IS NOT NULL;
