-- ============================================================================
-- Add Inbound Email Fields to Organizations Table
-- ============================================================================

-- Add inbound_email_address column
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS inbound_email_address VARCHAR(255) DEFAULT NULL;

-- Add inbound_provider_id column (stores provider/domain ID from inbound service)
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS inbound_provider_id VARCHAR(255) DEFAULT NULL;

-- Add inbound_meta column (stores additional metadata as JSON)
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS inbound_meta JSONB DEFAULT NULL;

-- Add inbound_created column (0 = not created, 1 = created)
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS inbound_created SMALLINT DEFAULT 0;

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Index for inbound_email_address for lookups
CREATE INDEX IF NOT EXISTS idx_organizations_inbound_email_address
ON organizations(inbound_email_address);

-- Index for inbound_provider_id
CREATE INDEX IF NOT EXISTS idx_organizations_inbound_provider_id
ON organizations(inbound_provider_id);

-- Index for inbound_created status
CREATE INDEX IF NOT EXISTS idx_organizations_inbound_created
ON organizations(inbound_created);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN organizations.inbound_email_address IS 'Dedicated inbound email address for receiving invoices';
COMMENT ON COLUMN organizations.inbound_provider_id IS 'Provider/Domain ID from inbound email service (e.g., Inbound.dev)';
COMMENT ON COLUMN organizations.inbound_meta IS 'Additional metadata from inbound service as JSON';
COMMENT ON COLUMN organizations.inbound_created IS 'Whether inbound email has been set up (0=no, 1=yes)';
