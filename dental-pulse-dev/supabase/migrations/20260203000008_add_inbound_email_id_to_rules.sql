-- ============================================================================
-- ADD INBOUND_EMAIL_ID TO ACCOUNTS_PAYABLE_INVOICE_RULES_MAPPING TABLE
-- Links rules to specific inbound emails from organization_inbound_emails
-- ============================================================================

-- Add inbound_email_id column with foreign key reference
ALTER TABLE accounts_payable_invoice_rules_mapping
ADD COLUMN IF NOT EXISTS inbound_email_id UUID REFERENCES organization_inbound_emails(id) ON DELETE SET NULL;

-- Create index for inbound_email_id
CREATE INDEX IF NOT EXISTS idx_ap_invoice_rules_mapping_inbound_email_id
ON accounts_payable_invoice_rules_mapping(inbound_email_id);

-- Add comment
COMMENT ON COLUMN accounts_payable_invoice_rules_mapping.inbound_email_id IS 'Reference to organization_inbound_emails table - the inbound email address for this rule';
