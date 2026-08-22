-- ============================================================
-- sage_suppliers
-- Source: GET https://api.accounting.sage.com/v3.1/contacts?attributes=all
-- Sage Business Cloud Accounting (UK) — supplier (VENDOR) records.
-- Full list synced on each run; upsert by (organization_id, platform_integration_id, sage_contact_id).
--
-- Pattern: mirrors iplicit_suppliers — Sage-specific because shape differs
-- from iplicit/xero. Shared tables (invoices, COA, line items) are used for
-- the entities that fit a unified schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sage_suppliers (
  -- Primary key
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id         UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id                         UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Sage identifiers
  sage_contact_id                 VARCHAR(500) NOT NULL,   -- Sage: id (UUID-style hex, e.g. "c4793618157341699cd05be4daf199a0")
  reference                       VARCHAR(255),            -- Sage: reference (free-form reference code)
  displayed_as                    VARCHAR(500) NOT NULL,   -- Sage: displayed_as (label used in UI, e.g. "Dental Lab Co Ltd")

  -- Name parts
  name                            VARCHAR(500),            -- Sage: name (formal name)
  contact_name                    VARCHAR(255),            -- Sage: main_contact_name or contact_persons[0].name

  -- Contact details
  email                           VARCHAR(255),            -- Sage: main_contact_person.email
  telephone                       VARCHAR(50),             -- Sage: main_contact_person.telephone
  mobile                          VARCHAR(50),             -- Sage: main_contact_person.mobile
  fax                             VARCHAR(50),             -- Sage: fax
  website                         VARCHAR(500),            -- Sage: website

  -- Address (primary / registered)
  address_line_1                  VARCHAR(500),            -- Sage: main_address.address_line_1
  address_line_2                  VARCHAR(500),            -- Sage: main_address.address_line_2
  city                            VARCHAR(255),            -- Sage: main_address.city
  region                          VARCHAR(255),            -- Sage: main_address.region (county/state)
  postal_code                     VARCHAR(50),             -- Sage: main_address.postal_code
  country_id                      VARCHAR(100),            -- Sage: main_address.country (e.g. "GB")

  -- Classification
  contact_types                   TEXT,                    -- Sage: contact_types[].id joined CSV (e.g. "VENDOR" or "VENDOR,CUSTOMER")
  is_vendor                       BOOLEAN DEFAULT TRUE,    -- Derived: contact_types contains VENDOR
  is_customer                     BOOLEAN DEFAULT FALSE,   -- Derived: contact_types contains CUSTOMER
  is_active                       BOOLEAN DEFAULT TRUE,    -- Sage: !deleted (Sage uses soft-delete via "deleted_on")

  -- Tax / VAT
  tax_number                      VARCHAR(100),            -- Sage: tax_number (VAT registration)
  tax_calculation                 VARCHAR(50),             -- Sage: tax_calculation (e.g. "standard", "exempt")

  -- Defaults
  default_sales_ledger_account_id    VARCHAR(500),         -- Sage: default_sales_ledger_account.id (FK to platform_integration_chart_of_accounts.coa_account_id)
  default_purchase_ledger_account_id VARCHAR(500),         -- Sage: default_purchase_ledger_account.id
  credit_limit                    NUMERIC(15, 2),          -- Sage: credit_limit
  credit_days                     INTEGER,                 -- Sage: credit_days
  currency_id                     VARCHAR(10),             -- Sage: currency.id (e.g. "GBP")

  -- Notes
  notes                           TEXT,                    -- Sage: notes

  -- Raw payload (full Sage contact JSON — safety net for fields not yet mapped)
  raw_data                        JSONB,

  -- Sync tracking
  source_created_at               TIMESTAMPTZ,             -- Sage: created_at (when supplier was created in Sage)
  source_updated_at               TIMESTAMPTZ,             -- Sage: updated_at (Sage's last-modified)
  last_synced_at                  TIMESTAMPTZ DEFAULT NOW(),

  -- Audit
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW(),

  -- Unique: one supplier per (org, integration, Sage ID)
  CONSTRAINT sage_suppliers_unique
    UNIQUE (organization_id, platform_integration_id, sage_contact_id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sage_suppliers_org_id
  ON public.sage_suppliers(organization_id);

CREATE INDEX IF NOT EXISTS idx_sage_suppliers_integration_id
  ON public.sage_suppliers(platform_integration_id);

CREATE INDEX IF NOT EXISTS idx_sage_suppliers_sage_contact_id
  ON public.sage_suppliers(sage_contact_id);

CREATE INDEX IF NOT EXISTS idx_sage_suppliers_user_id
  ON public.sage_suppliers(user_id);

CREATE INDEX IF NOT EXISTS idx_sage_suppliers_is_active
  ON public.sage_suppliers(is_active);

CREATE INDEX IF NOT EXISTS idx_sage_suppliers_is_vendor
  ON public.sage_suppliers(is_vendor);

CREATE INDEX IF NOT EXISTS idx_sage_suppliers_displayed_as
  ON public.sage_suppliers(displayed_as);

CREATE INDEX IF NOT EXISTS idx_sage_suppliers_email
  ON public.sage_suppliers(email);

CREATE INDEX IF NOT EXISTS idx_sage_suppliers_org_integration
  ON public.sage_suppliers(organization_id, platform_integration_id);

CREATE INDEX IF NOT EXISTS idx_sage_suppliers_last_synced_at
  ON public.sage_suppliers(last_synced_at);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.sage_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sage suppliers in their org" ON public.sage_suppliers;
CREATE POLICY "Users can view sage suppliers in their org"
ON public.sage_suppliers FOR SELECT
USING ( public.user_in_org(auth.uid(), organization_id) );

DROP POLICY IF EXISTS "Users can insert sage suppliers in their org" ON public.sage_suppliers;
CREATE POLICY "Users can insert sage suppliers in their org"
ON public.sage_suppliers FOR INSERT
WITH CHECK ( public.user_in_org(auth.uid(), organization_id) );

DROP POLICY IF EXISTS "Users can update sage suppliers in their org" ON public.sage_suppliers;
CREATE POLICY "Users can update sage suppliers in their org"
ON public.sage_suppliers FOR UPDATE
USING      ( public.user_in_org(auth.uid(), organization_id) )
WITH CHECK ( public.user_in_org(auth.uid(), organization_id) );

DROP POLICY IF EXISTS "Users can delete sage suppliers in their org" ON public.sage_suppliers;
CREATE POLICY "Users can delete sage suppliers in their org"
ON public.sage_suppliers FOR DELETE
USING ( public.user_in_org(auth.uid(), organization_id) );

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_sage_suppliers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_suppliers_updated_at ON public.sage_suppliers;
CREATE TRIGGER update_sage_suppliers_updated_at
    BEFORE UPDATE ON public.sage_suppliers
    FOR EACH ROW
    EXECUTE FUNCTION update_sage_suppliers_updated_at();

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE public.sage_suppliers IS 'Sage Business Cloud Accounting supplier (VENDOR contact) records, synced from Sage /contacts API.';
COMMENT ON COLUMN public.sage_suppliers.sage_contact_id IS 'Sage contact ID (32-char hex UUID, returned as "id" field from /contacts).';
COMMENT ON COLUMN public.sage_suppliers.displayed_as IS 'Sage UI label for this contact — Sage falls back to name/company if missing.';
COMMENT ON COLUMN public.sage_suppliers.contact_types IS 'Comma-separated list of Sage contact_type_ids (e.g. "VENDOR" or "VENDOR,CUSTOMER").';
COMMENT ON COLUMN public.sage_suppliers.raw_data IS 'Full Sage contact JSON — safety net for fields not yet mapped to columns.';
