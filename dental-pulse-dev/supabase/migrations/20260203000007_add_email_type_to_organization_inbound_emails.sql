-- ============================================================================
-- ADD EMAIL_TYPE COLUMN TO ORGANIZATION_INBOUND_EMAILS TABLE
-- Allows multiple inbound emails per organization (cost and sales)
-- ============================================================================

-- Add email_type column if it doesn't exist
ALTER TABLE organization_inbound_emails
ADD COLUMN IF NOT EXISTS email_type VARCHAR(50) NOT NULL DEFAULT 'cost';

-- Update existing records to have email_type = 'cost' (they are cost emails by default)
UPDATE organization_inbound_emails
SET email_type = 'cost'
WHERE email_type IS NULL OR email_type = '';

-- Create index for email_type
CREATE INDEX IF NOT EXISTS idx_org_inbound_emails_email_type
ON organization_inbound_emails(email_type);

-- Drop the old unique constraint if it exists (organization_id only)
DROP INDEX IF EXISTS idx_org_inbound_emails_org_unique;

-- Create unique constraint on organization_id + email_type (one email per type per organization)
DROP INDEX IF EXISTS idx_org_inbound_emails_org_type_unique;
CREATE UNIQUE INDEX idx_org_inbound_emails_org_type_unique
ON organization_inbound_emails(organization_id, email_type);

-- Add comment
COMMENT ON COLUMN organization_inbound_emails.email_type IS 'Type of email: cost (for invoices/expenses) or sales (for income)';
