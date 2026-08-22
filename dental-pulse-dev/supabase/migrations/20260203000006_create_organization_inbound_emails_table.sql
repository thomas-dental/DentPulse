-- ============================================================================
-- CREATE ORGANIZATION INBOUND EMAILS TABLE
-- Moves inbound email fields from organizations to separate table
-- ============================================================================

-- Create new table for organization inbound emails
CREATE TABLE IF NOT EXISTS organization_inbound_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Email type: 'cost' or 'sales'
  email_type VARCHAR(50) NOT NULL DEFAULT 'cost',

  -- Inbound email fields
  inbound_email_address VARCHAR(255) NOT NULL,
  inbound_provider_id VARCHAR(255),
  inbound_meta JSONB DEFAULT NULL,
  inbound_created SMALLINT DEFAULT 1,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Index for user_id
CREATE INDEX IF NOT EXISTS idx_org_inbound_emails_user_id
ON organization_inbound_emails(user_id);

-- Index for organization_id
CREATE INDEX IF NOT EXISTS idx_org_inbound_emails_organization_id
ON organization_inbound_emails(organization_id);

-- Index for inbound_email_address for lookups
CREATE INDEX IF NOT EXISTS idx_org_inbound_emails_email_address
ON organization_inbound_emails(inbound_email_address);

-- Index for email_type
CREATE INDEX IF NOT EXISTS idx_org_inbound_emails_email_type
ON organization_inbound_emails(email_type);

-- Unique constraint on organization_id + email_type (one email per type per organization)
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_inbound_emails_org_type_unique
ON organization_inbound_emails(organization_id, email_type);

-- ============================================================================
-- TRIGGER FOR updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_org_inbound_emails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_org_inbound_emails_updated_at ON organization_inbound_emails;
CREATE TRIGGER trigger_org_inbound_emails_updated_at
  BEFORE UPDATE ON organization_inbound_emails
  FOR EACH ROW
  EXECUTE FUNCTION update_org_inbound_emails_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE organization_inbound_emails ENABLE ROW LEVEL SECURITY;

-- Users can view inbound emails for their organization
CREATE POLICY "Users can view organization inbound emails"
ON organization_inbound_emails FOR SELECT TO authenticated
USING (true);

-- Users can insert inbound emails
CREATE POLICY "Users can insert organization inbound emails"
ON organization_inbound_emails FOR INSERT TO authenticated
WITH CHECK (true);

-- Users can update inbound emails
CREATE POLICY "Users can update organization inbound emails"
ON organization_inbound_emails FOR UPDATE TO authenticated
USING (true);

-- Service role full access
CREATE POLICY "Service role has full access to organization inbound emails"
ON organization_inbound_emails FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- ============================================================================
-- MIGRATE EXISTING DATA (if any)
-- ============================================================================

INSERT INTO organization_inbound_emails (organization_id, inbound_email_address, inbound_provider_id, inbound_meta, inbound_created)
SELECT
  id as organization_id,
  inbound_email_address,
  inbound_provider_id,
  inbound_meta,
  inbound_created
FROM organizations
WHERE inbound_email_address IS NOT NULL AND inbound_created = 1
ON CONFLICT (organization_id) DO NOTHING;

-- ============================================================================
-- DROP COLUMNS FROM ORGANIZATIONS TABLE
-- ============================================================================

ALTER TABLE organizations DROP COLUMN IF EXISTS inbound_email_address;
ALTER TABLE organizations DROP COLUMN IF EXISTS inbound_provider_id;
ALTER TABLE organizations DROP COLUMN IF EXISTS inbound_meta;
ALTER TABLE organizations DROP COLUMN IF EXISTS inbound_created;

-- Drop indexes if they exist
DROP INDEX IF EXISTS idx_organizations_inbound_email_address;
DROP INDEX IF EXISTS idx_organizations_inbound_provider_id;
DROP INDEX IF EXISTS idx_organizations_inbound_created;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE organization_inbound_emails IS 'Stores inbound email configuration for organizations';
COMMENT ON COLUMN organization_inbound_emails.user_id IS 'User who created/owns this inbound email';
COMMENT ON COLUMN organization_inbound_emails.organization_id IS 'Organization this inbound email belongs to';
COMMENT ON COLUMN organization_inbound_emails.email_type IS 'Type of email: cost (for invoices/expenses) or sales (for income)';
COMMENT ON COLUMN organization_inbound_emails.inbound_email_address IS 'Dedicated inbound email address';
COMMENT ON COLUMN organization_inbound_emails.inbound_provider_id IS 'Provider/Domain ID from inbound email service';
COMMENT ON COLUMN organization_inbound_emails.inbound_meta IS 'Additional metadata from inbound service as JSON';
COMMENT ON COLUMN organization_inbound_emails.inbound_created IS 'Whether inbound email has been set up (0=no, 1=yes)';
