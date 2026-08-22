-- Migration: Add unique constraint to prevent duplicate integrations
-- This ensures each organization can only have ONE integration of each type

-- First, remove any existing duplicates before adding the constraint
-- Keep the most recent integration for each (organization_id, integration_name) pair
WITH ranked_integrations AS (
  SELECT
    id,
    organization_id,
    integration_name,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, integration_name
      ORDER BY created_at DESC, id DESC
    ) as rn
  FROM integrations
  WHERE deleted_at IS NULL
)
UPDATE integrations
SET deleted_at = NOW()
WHERE id IN (
  SELECT id
  FROM ranked_integrations
  WHERE rn > 1
)
AND deleted_at IS NULL;

-- Add unique constraint to prevent future duplicates
-- This constraint ensures each organization can only have ONE active integration per integration_name
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_org_name_unique
ON public.integrations(organization_id, integration_name)
WHERE deleted_at IS NULL;

-- Add comment to document the constraint
COMMENT ON INDEX idx_integrations_org_name_unique IS
'Ensures each organization can only have one active integration per integration_name. Deleted integrations (deleted_at IS NOT NULL) are excluded from this constraint.';
