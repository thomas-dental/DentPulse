-- Add nhs_claims sync entity to existing Dentally integrations
-- This ensures NHS Claims appears in the Settings page sync options

INSERT INTO public.integration_sync_entities (
  integration_id,
  entity_alias,
  entity_label,
  entity_description,
  is_sync,
  is_available,
  last_synced_at,
  created_at,
  updated_at
)
SELECT
  i.id as integration_id,
  'nhs_claims' as entity_alias,
  'NHS Claims' as entity_label,
  'Sync NHS claims from Dentally' as entity_description,
  TRUE as is_sync,
  TRUE as is_available,
  NULL as last_synced_at,
  NOW() as created_at,
  NOW() as updated_at
FROM
  public.integrations i
WHERE
  i.integration_name = 'Dentally'
  AND i.is_connected = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM public.integration_sync_entities ise
    WHERE ise.integration_id = i.id
      AND ise.entity_alias = 'nhs_claims'
  )
ON CONFLICT (integration_id, entity_alias) DO NOTHING;
