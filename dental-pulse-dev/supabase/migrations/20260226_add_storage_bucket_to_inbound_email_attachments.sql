-- ============================================================================
-- Add storage_bucket column to inbound_email_attachments
-- Tracks where the attachment is stored: 'backend-storage' or Supabase bucket name
-- ============================================================================

-- Add storage_bucket column
ALTER TABLE inbound_email_attachments
ADD COLUMN IF NOT EXISTS storage_bucket VARCHAR(100) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN inbound_email_attachments.storage_bucket IS 'Storage location: backend-storage for local server, or Supabase bucket name';

-- Create index for storage_bucket
CREATE INDEX IF NOT EXISTS idx_inbound_email_attachments_storage_bucket
ON inbound_email_attachments(storage_bucket);
