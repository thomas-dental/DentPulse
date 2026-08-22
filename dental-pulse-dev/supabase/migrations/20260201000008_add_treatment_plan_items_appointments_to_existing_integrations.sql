-- Add treatment_plan_items and treatment_appointments to existing Dentally integrations
-- This ensures the new entities appear in the Settings page sync options

-- Insert treatment_plan_items for all Dentally integrations
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
  'treatment_plan_items' as entity_alias,
  'Treatment Plan Items' as entity_label,
  'Sync treatment plan items from Dentally' as entity_description,
  TRUE as is_sync, -- Enabled by default (same as payment_plans)
  TRUE as is_available, -- Available/implemented
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
      AND ise.entity_alias = 'treatment_plan_items'
  )
ON CONFLICT (integration_id, entity_alias) DO NOTHING;

-- Insert treatment_appointments for all Dentally integrations
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
  'treatment_appointments' as entity_alias,
  'Treatment Appointments' as entity_label,
  'Sync treatment appointments from Dentally' as entity_description,
  TRUE as is_sync, -- Enabled by default (same as payment_plans)
  TRUE as is_available, -- Available/implemented
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
      AND ise.entity_alias = 'treatment_appointments'
  )
ON CONFLICT (integration_id, entity_alias) DO NOTHING;

-- Add comments
COMMENT ON TABLE public.integration_sync_entities IS 'Tracks sync entities for each integration. Includes treatment_plan_items and treatment_appointments.';
