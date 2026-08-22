-- Update integrations table to make api_endpoints and api_key nullable
-- Remove NOT NULL constraints and CHECK constraints

ALTER TABLE public.integrations 
  ALTER COLUMN api_endpoints DROP NOT NULL,
  ALTER COLUMN api_key DROP NOT NULL;

-- Drop the check constraints
ALTER TABLE public.integrations 
  DROP CONSTRAINT IF EXISTS integrations_api_endpoints_not_empty,
  DROP CONSTRAINT IF EXISTS integrations_api_key_not_empty;
