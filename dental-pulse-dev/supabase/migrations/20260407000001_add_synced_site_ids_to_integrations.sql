-- Add synced_site_ids to integrations table
-- Stores array of Dentally site UUIDs that the user selected to sync
-- NULL or empty means sync ALL sites (backward compatible)
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS synced_site_ids JSONB DEFAULT NULL;

COMMENT ON COLUMN integrations.synced_site_ids IS 'Array of Dentally site UUIDs to sync. NULL = sync all sites.';
