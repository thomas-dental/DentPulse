-- Create iplicit_coa_account_groups table
-- Source: POST https://api.iplicit.com/api/Enquiry/run/dfce4c69-7ffe-8959-acec-019c7adf88db/list?top=1000
--
-- Sample API record:
-- {
--   "AccountType": "BS",        -- Balance Sheet or Profit & Loss
--   "Code": "INS",
--   "Description": "Investment in Subsidiaries",
--   "HasAttachments": false,
--   "HasNotes": false,
--   "Id": "e5c3410e-ba3a-4d46-ab0a-02e7656b2241",
--   "IsActive": true,
--   "LastModified": "2023-10-23T15:10:59.987",
--   "LastModifiedBy": "weavingb",
--   "LegacyRef": null,
--   "OrderIndex": 65,
--   "ParentCoaGroupId": "9e046ffc-6c42-4cd4-b430-df892d1b6bfa"
-- }

CREATE TABLE IF NOT EXISTS public.iplicit_coa_account_groups (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,

  -- Iplicit identifiers (from API)
  account_group_id        VARCHAR(500) NOT NULL,   -- Api: Id
  parent_coa_group_id     VARCHAR(500),            -- Api: ParentCoaGroupId (self-referencing external id)

  -- Account group details
  account_type            VARCHAR(10),             -- Api: AccountType ("BS" = Balance Sheet, "PL" = Profit & Loss)
  code                    VARCHAR(100),            -- Api: Code
  description             VARCHAR(500),            -- Api: Description
  is_active               BOOLEAN DEFAULT true,    -- Api: IsActive
  order_index             INTEGER,                 -- Api: OrderIndex
  legacy_ref              VARCHAR(255),            -- Api: LegacyRef

  -- Flags
  has_attachments         BOOLEAN DEFAULT false,   -- Api: HasAttachments
  has_notes               BOOLEAN DEFAULT false,   -- Api: HasNotes

  -- Audit from Iplicit
  api_last_modified       TIMESTAMPTZ,             -- Api: LastModified
  api_last_modified_by    VARCHAR(255),            -- Api: LastModifiedBy

  -- Timestamps
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one group per org+integration+group_id
  CONSTRAINT iplicit_coa_account_groups_unique
    UNIQUE (organization_id, platform_integration_id, account_group_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_coa_groups_org_id
  ON public.iplicit_coa_account_groups(organization_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_groups_integration_id
  ON public.iplicit_coa_account_groups(platform_integration_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_groups_account_group_id
  ON public.iplicit_coa_account_groups(account_group_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_groups_account_type
  ON public.iplicit_coa_account_groups(account_type);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_groups_is_active
  ON public.iplicit_coa_account_groups(is_active);

CREATE INDEX IF NOT EXISTS idx_iplicit_coa_groups_parent
  ON public.iplicit_coa_account_groups(parent_coa_group_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_iplicit_coa_account_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER iplicit_coa_account_groups_updated_at_trigger
  BEFORE UPDATE ON public.iplicit_coa_account_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_iplicit_coa_account_groups_updated_at();

-- Enable RLS
ALTER TABLE public.iplicit_coa_account_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY iplicit_coa_account_groups_org_isolation
  ON public.iplicit_coa_account_groups
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.iplicit_coa_account_groups IS
  'Iplicit Chart of Account Groups synced via Enquiry API (dfce4c69-7ffe-8959-acec-019c7adf88db)';
