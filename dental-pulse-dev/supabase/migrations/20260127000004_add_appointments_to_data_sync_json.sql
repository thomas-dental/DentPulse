-- Migration: Add appointments entity to data_sync_json in existing Dentally integrations
-- This ensures all Dentally integrations have the appointments sync option available

-- Update existing Dentally integrations to add appointments entity if not present
UPDATE integrations
SET data_sync_json = (
  SELECT CASE
    -- Check if appointments entity already exists
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(data_sync_json) AS elem
      WHERE lower(elem->>'alias') = 'appointments'
         OR lower(elem->>'label') LIKE '%appointment%'
    ) THEN
      -- Appointments already exists, just ensure is_sync is set to 0
      (
        SELECT jsonb_agg(
          CASE
            WHEN lower(elem->>'alias') = 'appointments' OR lower(elem->>'label') LIKE '%appointment%' THEN
              jsonb_set(elem, '{is_sync}', '0')
            ELSE elem
          END
        )
        FROM jsonb_array_elements(data_sync_json) AS elem
      )
    ELSE
      -- Appointments doesn't exist, add it
      data_sync_json || jsonb_build_array(
        jsonb_build_object(
          'alias', 'appointments',
          'label', 'Appointments',
          'description', 'Sync appointment records from Dentally',
          'is_sync', 0
        )
      )
  END
)
WHERE integration_name = 'Dentally'
  AND data_sync_json IS NOT NULL
  AND data_sync_json != '[]'::jsonb;

-- Verify the migration
-- SELECT
--   id,
--   organization_id,
--   integration_name,
--   data_sync_json
-- FROM integrations
-- WHERE integration_name = 'Dentally';
