-- ============================================================================
-- RENAME organization_inbound_emails TO location_inbound_emails
-- Simple table rename - indexes, triggers, and policies continue to work
-- ============================================================================

-- Rename the table
ALTER TABLE IF EXISTS organization_inbound_emails RENAME TO location_inbound_emails;

-- Update table comment
COMMENT ON TABLE location_inbound_emails IS 'Stores inbound email configuration for locations (and organizations)';
