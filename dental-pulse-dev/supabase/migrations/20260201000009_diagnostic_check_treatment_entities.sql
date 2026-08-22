-- Diagnostic query to check if treatment_plan_items and treatment_appointments are properly set up
-- Run this to verify the entities exist and are configured correctly

-- Check 1: See all entities for Dentally integrations
SELECT 
  i.integration_name,
  i.is_connected,
  ise.entity_alias,
  ise.entity_label,
  ise.is_sync,
  ise.is_available,
  ise.last_synced_at
FROM 
  public.integrations i
  LEFT JOIN public.integration_sync_entities ise ON ise.integration_id = i.id
WHERE 
  i.integration_name = 'Dentally'
ORDER BY 
  i.id, ise.entity_alias;

-- Check 2: Count entities per integration
SELECT 
  i.id as integration_id,
  i.integration_name,
  COUNT(ise.id) as total_entities,
  COUNT(CASE WHEN ise.is_sync = TRUE THEN 1 END) as enabled_entities,
  COUNT(CASE WHEN ise.is_available = TRUE THEN 1 END) as available_entities,
  COUNT(CASE WHEN ise.entity_alias = 'treatment_plan_items' THEN 1 END) as has_treatment_plan_items,
  COUNT(CASE WHEN ise.entity_alias = 'treatment_appointments' THEN 1 END) as has_treatment_appointments
FROM 
  public.integrations i
  LEFT JOIN public.integration_sync_entities ise ON ise.integration_id = i.id
WHERE 
  i.integration_name = 'Dentally'
GROUP BY 
  i.id, i.integration_name;

-- Check 3: Verify specific entities exist and are enabled
SELECT 
  ise.*
FROM 
  public.integration_sync_entities ise
  INNER JOIN public.integrations i ON i.id = ise.integration_id
WHERE 
  i.integration_name = 'Dentally'
  AND ise.entity_alias IN ('treatment_plan_items', 'treatment_appointments');
