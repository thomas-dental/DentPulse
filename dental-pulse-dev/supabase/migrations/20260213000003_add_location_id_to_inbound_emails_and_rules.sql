-- ============================================================================
-- ADD LOCATION_ID TO INBOUND_EMAILS AND INVOICE RULES TABLES
-- Links emails and rules to practice locations
-- ============================================================================

-- Add location_id to inbound_emails table
ALTER TABLE inbound_emails
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES practice_locations(id) ON DELETE SET NULL;

-- Create index for location_id
CREATE INDEX IF NOT EXISTS idx_inbound_emails_location_id ON inbound_emails(location_id);

-- Add comment
COMMENT ON COLUMN inbound_emails.location_id IS
'Practice location associated with this email, set from rules or manually';

-- ============================================================================
-- ADD LOCATION_ID TO INVOICE RULES TABLE
-- So rules can specify which location to assign
-- ============================================================================

-- Add location_id to accounts_payable_invoice_rules_mapping table
ALTER TABLE accounts_payable_invoice_rules_mapping
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES practice_locations(id) ON DELETE SET NULL;

-- Create index for location_id
CREATE INDEX IF NOT EXISTS idx_ap_invoice_rules_mapping_location_id ON accounts_payable_invoice_rules_mapping(location_id);

-- Add comment
COMMENT ON COLUMN accounts_payable_invoice_rules_mapping.location_id IS
'Practice location to assign to invoices matching this rule';
