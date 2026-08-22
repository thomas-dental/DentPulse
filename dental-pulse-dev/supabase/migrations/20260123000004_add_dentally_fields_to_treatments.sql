-- Add Dentally-specific fields to treatments table
-- These fields store data synced from Dentally API

ALTER TABLE public.treatments
  -- External ID from Dentally API (integer ID from Dentally system)
  ADD COLUMN IF NOT EXISTS external_id integer,
  
  -- Dentally API specific fields
  ADD COLUMN IF NOT EXISTS insurance_classification text,
  ADD COLUMN IF NOT EXISTS nhs_treatment_cat varchar(50), -- NHS treatment category code (e.g., "2924", "2925")
  ADD COLUMN IF NOT EXISTS nomenclature text, -- Official nomenclature from Dentally
  ADD COLUMN IF NOT EXISTS owner varchar(50), -- Owner type (e.g., "practice")
  ADD COLUMN IF NOT EXISTS patient_description text, -- Patient-facing description
  ADD COLUMN IF NOT EXISTS patient_nomenclature text, -- Patient-facing nomenclature
  ADD COLUMN IF NOT EXISTS region varchar(50), -- Region type (e.g., "patient")
  ADD COLUMN IF NOT EXISTS uda_band varchar(50); -- UDA band information

-- Add comments for new fields
COMMENT ON COLUMN public.treatments.external_id IS 'External ID from Dentally API (used for syncing and matching records)';
COMMENT ON COLUMN public.treatments.insurance_classification IS 'Insurance classification from Dentally API';
COMMENT ON COLUMN public.treatments.nhs_treatment_cat IS 'NHS treatment category code from Dentally API (e.g., "2924", "2925")';
COMMENT ON COLUMN public.treatments.nomenclature IS 'Official nomenclature from Dentally API';
COMMENT ON COLUMN public.treatments.owner IS 'Owner type from Dentally API (e.g., "practice")';
COMMENT ON COLUMN public.treatments.patient_description IS 'Patient-facing description from Dentally API';
COMMENT ON COLUMN public.treatments.patient_nomenclature IS 'Patient-facing nomenclature from Dentally API';
COMMENT ON COLUMN public.treatments.region IS 'Region type from Dentally API (e.g., "patient")';
COMMENT ON COLUMN public.treatments.uda_band IS 'UDA band information from Dentally API';

-- Create index on external_id for faster lookups during sync operations
CREATE INDEX IF NOT EXISTS idx_treatments_external_id ON public.treatments(external_id) WHERE external_id IS NOT NULL;

-- Create index on nhs_treatment_cat for NHS-specific queries
CREATE INDEX IF NOT EXISTS idx_treatments_nhs_treatment_cat ON public.treatments(nhs_treatment_cat) WHERE nhs_treatment_cat IS NOT NULL;

-- Create unique constraint on external_id per organization to prevent duplicates
-- This ensures we don't sync the same Dentally treatment twice for an organization
-- Note: Using UNIQUE CONSTRAINT (not index) for Supabase upsert to work properly
DO $$
BEGIN
    -- Drop the index if it exists (we'll create a constraint instead)
    DROP INDEX IF EXISTS idx_treatments_org_external_id_unique;
    
    -- Create unique constraint (required for upsert ON CONFLICT to work)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'treatments_org_external_id_unique'
        AND conrelid = 'public.treatments'::regclass
    ) THEN
        ALTER TABLE public.treatments
        ADD CONSTRAINT treatments_org_external_id_unique 
        UNIQUE (organization_id, external_id);
    END IF;
END $$;

-- Create index for faster lookups (separate from constraint)
CREATE INDEX IF NOT EXISTS idx_treatments_org_external_id ON public.treatments(organization_id, external_id) 
WHERE external_id IS NOT NULL AND deleted_at IS NULL;
