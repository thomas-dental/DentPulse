-- vendor_bank_accounts: stores saved bank details for vendors/suppliers
CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  vendor_name TEXT,
  account_name TEXT NOT NULL,
  account_number TEXT,
  sort_code TEXT,
  bank_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_bank_accounts_org
  ON vendor_bank_accounts(organization_id);

CREATE INDEX IF NOT EXISTS idx_vendor_bank_accounts_vendor
  ON vendor_bank_accounts(organization_id, vendor_name);

ALTER TABLE vendor_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select_vendor_bank_accounts"
  ON vendor_bank_accounts FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org_members_insert_vendor_bank_accounts"
  ON vendor_bank_accounts FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org_members_update_vendor_bank_accounts"
  ON vendor_bank_accounts FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org_members_delete_vendor_bank_accounts"
  ON vendor_bank_accounts FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );
