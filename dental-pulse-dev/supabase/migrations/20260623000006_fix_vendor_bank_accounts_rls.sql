-- Fix vendor_bank_accounts RLS: use user_roles instead of profiles
DROP POLICY IF EXISTS "org_members_select_vendor_bank_accounts" ON vendor_bank_accounts;
DROP POLICY IF EXISTS "org_members_insert_vendor_bank_accounts" ON vendor_bank_accounts;
DROP POLICY IF EXISTS "org_members_update_vendor_bank_accounts" ON vendor_bank_accounts;
DROP POLICY IF EXISTS "org_members_delete_vendor_bank_accounts" ON vendor_bank_accounts;

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
