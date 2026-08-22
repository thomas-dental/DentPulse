-- Create invoice_rules table for automation rules
-- This table stores rules for automatic invoice processing based on email sender

CREATE TABLE IF NOT EXISTS accounts_payable_invoice_rules_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User who created the rule
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Email address to match (sender email)
  email VARCHAR(255) NOT NULL,

  -- Inbound email address for receiving invoices
  inbound_email_address VARCHAR(255),

  -- Organization ID for integration
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Folder assignment
  folder_id UUID REFERENCES invoice_folders(id) ON DELETE SET NULL,

  -- COA assignment
  chart_of_account_id UUID,

  -- Rule status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ap_invoice_rules_mapping_user_id ON accounts_payable_invoice_rules_mapping(user_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_rules_mapping_email ON accounts_payable_invoice_rules_mapping(email);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_rules_mapping_org_id ON accounts_payable_invoice_rules_mapping(organization_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_rules_mapping_folder_id ON accounts_payable_invoice_rules_mapping(folder_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_rules_mapping_is_active ON accounts_payable_invoice_rules_mapping(is_active);

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION update_ap_invoice_rules_mapping_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS ap_invoice_rules_mapping_updated_at_trigger ON accounts_payable_invoice_rules_mapping;
CREATE TRIGGER ap_invoice_rules_mapping_updated_at_trigger
  BEFORE UPDATE ON accounts_payable_invoice_rules_mapping
  FOR EACH ROW
  EXECUTE FUNCTION update_ap_invoice_rules_mapping_updated_at();

-- Enable Row Level Security
ALTER TABLE accounts_payable_invoice_rules_mapping ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow authenticated users to view rules
CREATE POLICY "Users can view accounts_payable_invoice_rules_mapping"
ON accounts_payable_invoice_rules_mapping FOR SELECT TO authenticated
USING (true);

-- Allow authenticated users to insert rules
CREATE POLICY "Users can insert accounts_payable_invoice_rules_mapping"
ON accounts_payable_invoice_rules_mapping FOR INSERT TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update rules
CREATE POLICY "Users can update accounts_payable_invoice_rules_mapping"
ON accounts_payable_invoice_rules_mapping FOR UPDATE TO authenticated
USING (true);

-- Allow authenticated users to delete rules
CREATE POLICY "Users can delete accounts_payable_invoice_rules_mapping"
ON accounts_payable_invoice_rules_mapping FOR DELETE TO authenticated
USING (true);

-- Service role has full access
CREATE POLICY "Service role has full access to accounts_payable_invoice_rules_mapping"
ON accounts_payable_invoice_rules_mapping FOR ALL TO service_role
USING (true) WITH CHECK (true);
