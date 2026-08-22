-- Create integration_sync_entities table
-- Replaces data_sync_json JSONB column with proper relational table
-- Makes it easy to add new entities by just inserting records

CREATE TABLE IF NOT EXISTS public.integration_sync_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key to integration
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,

  -- Entity information
  entity_alias VARCHAR(50) NOT NULL, -- e.g., 'practitioners', 'appointments', 'treatments'
  entity_label VARCHAR(100) NOT NULL, -- e.g., 'Practitioners', 'Appointments'
  entity_description TEXT, -- Human-readable description

  -- Sync settings
  is_sync BOOLEAN DEFAULT FALSE, -- Whether this entity is enabled for sync
  is_available BOOLEAN DEFAULT FALSE, -- Whether this entity is implemented/available

  -- Sync tracking
  last_synced_at TIMESTAMPTZ, -- Last successful sync timestamp for incremental sync

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique entity per integration
  UNIQUE(integration_id, entity_alias)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_integration_sync_entities_integration_id
  ON public.integration_sync_entities(integration_id);

CREATE INDEX IF NOT EXISTS idx_integration_sync_entities_entity_alias
  ON public.integration_sync_entities(entity_alias);

CREATE INDEX IF NOT EXISTS idx_integration_sync_entities_is_sync
  ON public.integration_sync_entities(is_sync)
  WHERE is_sync = TRUE;

CREATE INDEX IF NOT EXISTS idx_integration_sync_entities_last_synced
  ON public.integration_sync_entities(last_synced_at)
  WHERE last_synced_at IS NOT NULL;

-- Add comments
COMMENT ON TABLE public.integration_sync_entities IS 'Tracks sync entities for each integration - replaces data_sync_json JSONB column';
COMMENT ON COLUMN public.integration_sync_entities.entity_alias IS 'Unique identifier for the entity (e.g., practitioners, appointments)';
COMMENT ON COLUMN public.integration_sync_entities.is_sync IS 'Whether this entity is enabled for automatic sync';
COMMENT ON COLUMN public.integration_sync_entities.is_available IS 'Whether this entity is implemented and available';
COMMENT ON COLUMN public.integration_sync_entities.last_synced_at IS 'Timestamp of last successful sync for incremental sync';

-- Enable Row Level Security (RLS)
ALTER TABLE public.integration_sync_entities ENABLE ROW LEVEL SECURITY;

-- Create RLS policy - users can only see entities for their organization's integrations
CREATE POLICY integration_sync_entities_organization_isolation
  ON public.integration_sync_entities
  FOR ALL
  USING (
    integration_id IN (
      SELECT id FROM public.integrations
      WHERE organization_id IN (
        SELECT id FROM public.organizations
        WHERE created_by = auth.uid()
      )
    )
  );

-- Create trigger function to update updated_at
CREATE OR REPLACE FUNCTION update_integration_sync_entities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER integration_sync_entities_updated_at_trigger
  BEFORE UPDATE ON public.integration_sync_entities
  FOR EACH ROW
  EXECUTE FUNCTION update_integration_sync_entities_updated_at();

-- Migrate existing data from integrations.data_sync_json to new table
-- This will preserve all existing sync settings
INSERT INTO public.integration_sync_entities (
  integration_id,
  entity_alias,
  entity_label,
  entity_description,
  is_sync,
  is_available,
  last_synced_at,
  created_at
)
SELECT
  i.id as integration_id,
  (elem->>'alias')::VARCHAR(50) as entity_alias,
  (elem->>'label')::VARCHAR(100) as entity_label,
  (elem->>'description')::TEXT as entity_description,
  CASE WHEN (elem->>'is_sync')::INTEGER = 1 THEN TRUE ELSE FALSE END as is_sync,
  CASE WHEN (elem->>'isAvailable')::TEXT = 'true' THEN TRUE ELSE FALSE END as is_available,
  CASE
    WHEN elem->>'last_synced_at' IS NOT NULL AND elem->>'last_synced_at' != 'null'
    THEN (elem->>'last_synced_at')::TIMESTAMPTZ
    ELSE NULL
  END as last_synced_at,
  i.created_at as created_at
FROM
  public.integrations i,
  jsonb_array_elements(i.data_sync_json) as elem
WHERE
  i.data_sync_json IS NOT NULL
  AND jsonb_array_length(i.data_sync_json) > 0
  AND elem->>'alias' IS NOT NULL
ON CONFLICT (integration_id, entity_alias) DO NOTHING;

-- Add comment about migration
COMMENT ON TABLE public.integration_sync_entities IS 'Tracks sync entities for each integration - replaces data_sync_json JSONB column. Data migrated from existing integrations.data_sync_json.';
