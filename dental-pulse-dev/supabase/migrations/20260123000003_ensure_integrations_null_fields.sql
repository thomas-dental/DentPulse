-- Ensure secret_key_id_available and api_key are explicitly null for new integrations
-- This migration ensures no unexpected default values are set

-- Check if there are any integrations with unexpected values and update them
UPDATE public.integrations 
SET secret_key_id_available = NULL 
WHERE secret_key_id_available IS NOT NULL 
  AND secret_key_id_available != '';

-- Ensure no default value is set on secret_key_id_available
ALTER TABLE public.integrations 
  ALTER COLUMN secret_key_id_available DROP DEFAULT;

-- Ensure no default value is set on api_key (if it exists)
ALTER TABLE public.integrations 
  ALTER COLUMN api_key DROP DEFAULT;
