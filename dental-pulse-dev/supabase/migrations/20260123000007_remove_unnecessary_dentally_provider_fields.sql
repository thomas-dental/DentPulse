-- Remove unnecessary Dentally-specific fields from providers table
-- Keep only essential fields: external_id, gdc_number, nhs_number, uda_target, uoa_target

-- Drop unnecessary columns if they exist
ALTER TABLE public.providers
  DROP COLUMN IF EXISTS colour,
  DROP COLUMN IF EXISTS default_contract_id,
  DROP COLUMN IF EXISTS import_id,
  DROP COLUMN IF EXISTS site_id,
  DROP COLUMN IF EXISTS calendar_position,
  DROP COLUMN IF EXISTS dentally_uuid;

-- Note: external_id, gdc_number, nhs_number, uda_target, uoa_target are kept as they are essential
