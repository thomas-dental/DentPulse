-- Add last_synced_at to each entity in data_sync_json
-- This enables incremental sync by tracking when each entity was last synced

-- Update existing integrations to add last_synced_at field to each entity
UPDATE public.integrations
SET data_sync_json = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'last_synced_at' IS NULL
      THEN elem || jsonb_build_object('last_synced_at', NULL)
      ELSE elem
    END
  )
  FROM jsonb_array_elements(data_sync_json) AS elem
)
WHERE integration_name = 'Dentally'
  AND data_sync_json IS NOT NULL
  AND jsonb_array_length(data_sync_json) > 0;

-- Add comment
COMMENT ON COLUMN public.integrations.data_sync_json IS 'Array of sync entities with settings (is_sync, isAvailable, last_synced_at)';
