-- Add dentally_site_id column to organizations table
-- This stores the primary Dentally site ID associated with the organization

-- Add column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'organizations'
    AND column_name = 'dentally_site_id'
  ) THEN
    ALTER TABLE public.organizations
    ADD COLUMN dentally_site_id VARCHAR(255) DEFAULT NULL;

    COMMENT ON COLUMN public.organizations.dentally_site_id IS 'Primary Dentally site ID (UUID from Dentally API)';
  END IF;
END $$;

-- Update existing organization with the current site ID
UPDATE public.organizations
SET dentally_site_id = 'b7d729b4-81c5-466d-aad2-4e9fd6dba50e'
WHERE dentally_site_id IS NULL
AND id IN (SELECT id FROM public.organizations LIMIT 1);
