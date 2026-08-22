-- Temporarily disable sync completion notifications
-- This can be re-enabled later when sync is stable

CREATE OR REPLACE FUNCTION create_sync_completion_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Notifications temporarily disabled
  -- Will be re-enabled after sync feature is stable
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_sync_completion_notification() IS 'Sync notifications temporarily disabled. Function returns immediately without creating notifications.';
