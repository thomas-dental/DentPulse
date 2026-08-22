-- ============================================================
-- iplicit_suppliers
-- Source: POST https://api.iplicit.com/api/Enquiry/run/8c7f1fc7-7d82-4bd2-aac3-cc435d486164
-- No date filter — full list of suppliers synced on each run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.iplicit_suppliers (
  -- Primary key
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id     UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id                     UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Identifiers
  contact_account_id          VARCHAR(500) NOT NULL,   -- Api: ContactAccountId (unique supplier ID)
  contact_group_id            VARCHAR(500),            -- Api: ContactGroupId
  contact_group               VARCHAR(255),            -- Api: Contact group
  contact_code                VARCHAR(100),            -- Api: Contact code
  contact_classification_id   VARCHAR(500),            -- Api: ContactClassificationId
  contact_classification      VARCHAR(255),            -- Api: Contact classification

  -- Company details
  company                     VARCHAR(500),            -- Api: Company
  company_no                  VARCHAR(100),            -- Api: Company No
  legacy_ref                  VARCHAR(255),            -- Api: Legacy Ref
  is_active                   BOOLEAN DEFAULT TRUE,    -- Api: IsActive

  -- Payment
  payment_method              VARCHAR(255),            -- Api: Payment method
  payment_method_id           VARCHAR(500),            -- Api: PaymentMethodId
  payment_term                VARCHAR(255),            -- Api: Payment term
  payment_term_id             VARCHAR(500),            -- Api: PaymentTermId

  -- Timestamps
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),

  -- Unique: one supplier per org + integration
  CONSTRAINT iplicit_suppliers_unique
    UNIQUE (organization_id, platform_integration_id, contact_account_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_suppliers_org_id
  ON public.iplicit_suppliers(organization_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_suppliers_integration_id
  ON public.iplicit_suppliers(platform_integration_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_suppliers_contact_account_id
  ON public.iplicit_suppliers(contact_account_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_suppliers_contact_group_id
  ON public.iplicit_suppliers(contact_group_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_suppliers_is_active
  ON public.iplicit_suppliers(is_active);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_iplicit_suppliers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER iplicit_suppliers_updated_at_trigger
  BEFORE UPDATE ON public.iplicit_suppliers
  FOR EACH ROW
  EXECUTE FUNCTION update_iplicit_suppliers_updated_at();

-- Enable RLS
ALTER TABLE public.iplicit_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY iplicit_suppliers_org_isolation
  ON public.iplicit_suppliers
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.iplicit_suppliers IS
  'Iplicit Suppliers synced via Enquiry API (8c7f1fc7-7d82-4bd2-aac3-cc435d486164). No date filter — full list.';
