-- ============================================================================
-- ADD LOCATION_ID TO ORGANIZATION INBOUND EMAILS
-- Supports location-specific inbound email addresses
-- ============================================================================

-- Add location_id column
ALTER TABLE organization_inbound_emails
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES practice_locations(id) ON DELETE CASCADE;

-- ============================================================================
-- UPDATE UNIQUE CONSTRAINT
-- ============================================================================

-- Drop old unique constraint (organization_id, email_type)
DROP INDEX IF EXISTS idx_org_inbound_emails_org_type_unique;

-- Create new unique constraint (organization_id, email_type, location_id)
-- Using COALESCE to handle NULL location_id for org-level emails
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_inbound_emails_org_type_location_unique
ON organization_inbound_emails(organization_id, email_type, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================================================
-- ADD INDEX FOR LOCATION_ID
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_org_inbound_emails_location_id
ON organization_inbound_emails(location_id)
WHERE location_id IS NOT NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN organization_inbound_emails.location_id IS 'Optional location this inbound email belongs to (NULL for org-level emails)';
