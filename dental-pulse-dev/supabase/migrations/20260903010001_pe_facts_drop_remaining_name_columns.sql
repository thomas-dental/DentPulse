-- Drop remaining denormalized name columns from PE fact tables.
-- Keep IDs only: practice_id, patient_id, location_id.
-- Resolve display names at API read from organizations / patients / practice_locations.

ALTER TABLE public.pe_invoice_contribution_facts
  DROP COLUMN IF EXISTS patient_name,
  DROP COLUMN IF EXISTS location_name,
  DROP COLUMN IF EXISTS organization_name;

ALTER TABLE public.pe_patient_contribution_facts
  DROP COLUMN IF EXISTS patient_name,
  DROP COLUMN IF EXISTS organization_name;

ALTER TABLE public.pe_practice_contribution_facts
  DROP COLUMN IF EXISTS organization_name;
