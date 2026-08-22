-- Create iplicit_chart_of_accounts table
-- Source: POST https://api.iplicit.com/api/Enquiry/run/a5102823-724c-83c3-9111-019c676ced0f/list?top=1000
--
-- Sample API record:
-- {
--   "AccountId":    "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
--   "Code":         "4000",
--   "Name":         "Sales",
--   "Description":  "Sales revenue account",
--   "AccountType":  "PL",               -- Profit & Loss or Balance Sheet
--   "CoaGroupId":   "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",  -- links to iplicit_coa_account_groups.account_group_id
--   "IsActive":     true,
--   "ApFlag":       false,              -- Accounts Payable flag
--   "ArFlag":       true,               -- Accounts Receivable flag
--   "IsCharge":     false,
--   "IsGoods":      false,
--   "IsServices":   true,
--   "count":        42,                 -- number of transactions (informational)
--   "LastModified": "2024-01-15T10:30:00.000",
--   "LastModifiedBy": "admin"
-- }

CREATE TABLE IF NOT EXISTS public.iplicit_chart_of_accounts (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,

  -- Iplicit identifiers (from API)
  account_id              VARCHAR(500) NOT NULL,   -- Api: AccountId
  coa_group_id            VARCHAR(500),            -- Api: CoaGroupId (links to iplicit_coa_account_groups.account_group_id)

  -- Account details
  code                    VARCHAR(100),            -- Api: Code
  name                    VARCHAR(500),            -- Api: Name
  description             VARCHAR(1000),           -- Api: Description
  account_type            VARCHAR(10),             -- Api: AccountType ("BS" = Balance Sheet, "PL" = Profit & Loss)
  is_active               BOOLEAN DEFAULT true,    -- Api: IsActive

  -- Flags
  ap_flag                 BOOLEAN DEFAULT false,   -- Api: ApFlag  (Accounts Payable)
  ar_flag                 BOOLEAN DEFAULT false,   -- Api: ArFlag  (Accounts Receivable)
  is_charge               BOOLEAN DEFAULT false,   -- Api: IsCharge
  is_goods                BOOLEAN DEFAULT false,   -- Api: IsGoods
  is_services             BOOLEAN DEFAULT false,   -- Api: IsServices

  -- Informational
  transaction_count       INTEGER,                 -- Api: count

  -- Audit from Iplicit
  api_last_modified       TIMESTAMPTZ,             -- Api: LastModified
  api_last_modified_by    VARCHAR(255),            -- Api: LastModifiedBy

  -- Timestamps
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one account per org+integration+account_id
  CONSTRAINT iplicit_chart_of_accounts_unique
    UNIQUE (organization_id, platform_integration_id, account_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_coa_org_id
  ON public.iplicit_chart_of_accounts(organization_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_integration_id
  ON public.iplicit_chart_of_accounts(platform_integration_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_account_id
  ON public.iplicit_chart_of_accounts(account_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_account_type
  ON public.iplicit_chart_of_accounts(account_type);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_is_active
  ON public.iplicit_chart_of_accounts(is_active);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_coa_group_id
  ON public.iplicit_chart_of_accounts(coa_group_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_iplicit_chart_of_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER iplicit_chart_of_accounts_updated_at_trigger
  BEFORE UPDATE ON public.iplicit_chart_of_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_iplicit_chart_of_accounts_updated_at();

-- Enable RLS
ALTER TABLE public.iplicit_chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY iplicit_chart_of_accounts_org_isolation
  ON public.iplicit_chart_of_accounts
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.iplicit_chart_of_accounts IS
  'Iplicit Chart of Accounts synced via Enquiry API (a5102823-724c-83c3-9111-019c676ced0f)';
