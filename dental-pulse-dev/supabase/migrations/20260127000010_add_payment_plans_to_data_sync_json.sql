-- Migration: Add payment_plans entity to data_sync_json in existing Dentally integrations
-- This ensures all Dentally integrations have the payment_plans sync option available

-- Update existing Dentally integrations to add payment_plans entity if not present
UPDATE integrations
SET data_sync_json = (
  SELECT CASE
    -- Check if payment_plans entity already exists
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(data_sync_json) AS elem
      WHERE lower(elem->>'alias') = 'payment_plans'
         OR lower(elem->>'label') LIKE '%payment plan%'
    ) THEN
      -- Payment plans already exists, just ensure is_sync is set to 1
      (
        SELECT jsonb_agg(
          CASE
            WHEN lower(elem->>'alias') = 'payment_plans' OR lower(elem->>'label') LIKE '%payment plan%' THEN
              jsonb_set(elem, '{is_sync}', '1')
            ELSE elem
          END
        )
        FROM jsonb_array_elements(data_sync_json) AS elem
      )
    ELSE
      -- Payment plans doesn't exist, add it
      data_sync_json || jsonb_build_array(
        jsonb_build_object(
          'alias', 'payment_plans',
          'label', 'Payment Plans',
          'description', 'Sync payment plans from Dentally',
          'is_sync', 1
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
