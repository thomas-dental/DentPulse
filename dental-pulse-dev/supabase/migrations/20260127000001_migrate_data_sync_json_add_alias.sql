-- Migration: Add alias field to data_sync_json in integrations table
-- This updates existing Dentally integration records to include the alias field

-- Update Dentally integrations data_sync_json to add alias field
UPDATE integrations
SET data_sync_json = (
  SELECT jsonb_agg(
    CASE
      -- Map "Providers" or similar to practitioners
      WHEN lower(elem->>'label') LIKE '%provider%' OR lower(elem->>'label') LIKE '%practitioner%' THEN
        jsonb_set(elem, '{alias}', '"practitioners"')

      -- Map "Treatment Category Record" to treatment_category
      WHEN lower(elem->>'label') LIKE '%treatment category%' OR lower(elem->>'label') LIKE '%categor%' THEN
        jsonb_set(elem, '{alias}', '"treatment_category"')

      -- Map "Treatment Records" or "Treatments" to treatments (set is_sync to 0 - disabled by default due to large data)
      WHEN lower(elem->>'label') LIKE '%treatment%' AND NOT (lower(elem->>'label') LIKE '%category%') THEN
        jsonb_set(
          jsonb_set(elem, '{alias}', '"treatments"'),
          '{is_sync}', '0'
        )

      -- Map "Locations" or "Sites" to locations
      WHEN lower(elem->>'label') LIKE '%location%' OR lower(elem->>'label') LIKE '%site%' THEN
        jsonb_set(elem, '{alias}', '"locations"')

      -- Map "Patients" to patients
      WHEN lower(elem->>'label') LIKE '%patient%' THEN
        jsonb_set(elem, '{alias}', '"patients"')

      -- Map "Appointment" to appointments (set is_sync to 0 - disabled by default, manual sync only)
      WHEN lower(elem->>'label') LIKE '%appointment%' THEN
        jsonb_set(
          jsonb_set(elem, '{alias}', '"appointments"'),
          '{is_sync}', '0'
        )

      -- Map "NHS Claims" to nhs_claims
      WHEN lower(elem->>'label') LIKE '%nhs%' OR lower(elem->>'label') LIKE '%claim%' THEN
        jsonb_set(elem, '{alias}', '"nhs_claims"')

      -- Map "Stock Management" to stock
      WHEN lower(elem->>'label') LIKE '%stock%' OR lower(elem->>'label') LIKE '%inventor%' THEN
        jsonb_set(elem, '{alias}', '"stock"')

      -- Map "Clinical Notes" to clinical_notes
      WHEN lower(elem->>'label') LIKE '%clinical%' OR lower(elem->>'label') LIKE '%note%' THEN
        jsonb_set(elem, '{alias}', '"clinical_notes"')

      -- Default: keep as-is (already has alias or unknown)
      ELSE elem
    END
  )
  FROM jsonb_array_elements(data_sync_json) AS elem
)
WHERE integration_name = 'Dentally'
  AND data_sync_json IS NOT NULL
  AND data_sync_json != '[]'::jsonb;

-- Verify the migration
-- SELECT
--   id,
--   organization_id,
--   data_sync_json
-- FROM integrations
-- WHERE integration_name = 'Dentally';
