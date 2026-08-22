-- ============================================================
-- Dedicated Sage Business Cloud Accounting data tables.
-- ============================================================
--
-- Mirrors the xero_* / iplicit_* / quickbooks_* dedicated-table model:
-- Sage data stops sharing tables with Dentally / QuickBooks / Iplicit
-- and lands in its own sage_* tables so downstream code can branch
-- cleanly per platform.
--
-- What this migration does:
--   1. CREATES sage_chart_of_accounts, sage_invoices, sage_invoice_line_items
--      with full RLS policies + indexes + updated_at triggers.
--   2. DOES NOT copy existing rows from platform_integration_* — that is
--      handled by a separate data-migration step (Sub-step 2 of the
--      Sage Roadmap PART A.5).
--   3. DOES NOT delete the old shared-table rows — cleanup is the last
--      step after backend service code is verified writing to the new
--      tables (Sub-step 5).
--
-- Tenancy model:
--   * organization_id           -> organizations.id (multi-tenant scope)
--   * platform_integration_id   -> platform_integrations.id (per-org Sage app)
--   * user_id                   -> auth.users.id (who triggered the sync)
--
-- Pattern references:
--   * supabase/migrations/20260423000002_xero_dedicated_tables.sql
--   * supabase/migrations/20260519000001_quickbooks_dedicated_tables.sql
--   * supabase/migrations/20260521000001_create_sage_suppliers_table.sql
--   * supabase/migrations/20260525000001_create_sage_bank_accounts_table.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. sage_chart_of_accounts  (Sage Ledger Accounts)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Sage identifiers
  sage_account_id VARCHAR(500) NOT NULL,        -- Sage ledger_account.id (GUID)
  account_code    VARCHAR(100),                  -- 4-digit padded nominal_code (e.g. "0030", "5000")
  account_name    VARCHAR(500) NOT NULL,         -- record.name / display_name / displayed_as
  account_type    VARCHAR(100) NOT NULL,         -- ledger_account_type.id (e.g. FIXED_ASSETS, DIRECT_COSTS)
  account_sub_type VARCHAR(255),                 -- ledger_account_classification.id
  classification  VARCHAR(100),                  -- ledger_account_group.id (ASSET/LIABILITY/INCOME/EXPENSE/CAPITAL)
  description     TEXT,                          -- display_name
  tax_type        VARCHAR(255),                  -- tax_rate.displayed_as or tax_rate.id
  bank_account_type VARCHAR(100),                -- non-null only when bank_attached=true
  reporting_code  VARCHAR(255),                  -- same as account_code (for symmetry with Xero)
  reporting_name  VARCHAR(500),                  -- displayed_as or display_formatted
  is_active       BOOLEAN DEFAULT TRUE,          -- ui_visible AND included_in_chart

  raw_data JSONB,                                -- Full Sage payload for re-processing

  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT sage_chart_of_accounts_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_account_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_coa_organization_id         ON public.sage_chart_of_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_coa_platform_integration_id ON public.sage_chart_of_accounts(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_sage_coa_sage_account_id         ON public.sage_chart_of_accounts(sage_account_id);
CREATE INDEX IF NOT EXISTS idx_sage_coa_account_code            ON public.sage_chart_of_accounts(account_code);
CREATE INDEX IF NOT EXISTS idx_sage_coa_account_type            ON public.sage_chart_of_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_sage_coa_classification          ON public.sage_chart_of_accounts(classification);
CREATE INDEX IF NOT EXISTS idx_sage_coa_is_active               ON public.sage_chart_of_accounts(is_active);

ALTER TABLE public.sage_chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_coa_select" ON public.sage_chart_of_accounts;
CREATE POLICY "sage_coa_select" ON public.sage_chart_of_accounts FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_coa_insert" ON public.sage_chart_of_accounts;
CREATE POLICY "sage_coa_insert" ON public.sage_chart_of_accounts FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_coa_update" ON public.sage_chart_of_accounts;
CREATE POLICY "sage_coa_update" ON public.sage_chart_of_accounts FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_coa_delete" ON public.sage_chart_of_accounts;
CREATE POLICY "sage_coa_delete" ON public.sage_chart_of_accounts FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_chart_of_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_chart_of_accounts_updated_at ON public.sage_chart_of_accounts;
CREATE TRIGGER update_sage_chart_of_accounts_updated_at
  BEFORE UPDATE ON public.sage_chart_of_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_sage_chart_of_accounts_updated_at();

COMMENT ON TABLE public.sage_chart_of_accounts IS 'Sage Business Cloud Accounting ledger accounts (chart of accounts). Source: /ledger_accounts?attributes=all';

-- ─────────────────────────────────────────────────────────────
-- 2. sage_invoices  (Purchase Invoices / Bills)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Sage identifiers
  sage_invoice_id VARCHAR(500) NOT NULL,         -- Sage purchase_invoice.id (GUID)

  -- Invoice header
  invoice_number VARCHAR(100),                    -- vendor_reference or reference
  invoice_type   VARCHAR(50)  DEFAULT 'ACCPAY',   -- ACCPAY (purchase) | ACCREC (sales — future)
  reference      VARCHAR(255),

  -- Dates
  invoice_date DATE,
  due_date     DATE,
  paid_date    DATE,
  sent_at      TIMESTAMP WITH TIME ZONE,

  -- Status
  status  VARCHAR(50) DEFAULT 'draft',            -- paid / unpaid / partial / voided / overdue / draft
  is_paid BOOLEAN DEFAULT FALSE,

  -- Financials
  currency      VARCHAR(10) DEFAULT 'GBP',
  currency_rate NUMERIC(15, 10) DEFAULT 1.0,

  subtotal           NUMERIC(15, 2),              -- net_amount
  tax_amount         NUMERIC(15, 2),
  total_amount       NUMERIC(15, 2),
  amount_paid        NUMERIC(15, 2) DEFAULT 0,    -- total_paid
  amount_due         NUMERIC(15, 2),              -- outstanding_amount
  amount_outstanding NUMERIC(15, 2),

  -- Contact / supplier
  contact_id    VARCHAR(500),                     -- Sage contact GUID (links to sage_suppliers.sage_contact_id)
  contact_name  VARCHAR(500),
  contact_email VARCHAR(500),

  -- Additional fields
  payment_terms VARCHAR(255),
  private_note  TEXT,                             -- record.notes
  footnote      TEXT,

  -- Tax details
  line_amount_types VARCHAR(50),                  -- Reserved for future
  tax_type          VARCHAR(50),

  -- URLs
  invoice_url       TEXT,                         -- record.links[rel=alternate]
  branding_theme_id VARCHAR(255),                 -- Reserved

  -- Raw payload + meta
  raw_data    JSONB,
  meta_data   JSONB,
  custom_fields JSONB,

  -- Sync tracking
  sync_status    VARCHAR(50) DEFAULT 'synced',    -- synced / pending / error
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sync_error     TEXT,

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMP WITH TIME ZONE,            -- Soft delete

  CONSTRAINT sage_invoices_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_invoices_organization_id         ON public.sage_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_platform_integration_id ON public.sage_invoices(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_location_id             ON public.sage_invoices(location_id);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_sage_invoice_id         ON public.sage_invoices(sage_invoice_id);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_invoice_number          ON public.sage_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_invoice_type            ON public.sage_invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_status                  ON public.sage_invoices(status);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_is_paid                 ON public.sage_invoices(is_paid);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_invoice_date            ON public.sage_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_due_date                ON public.sage_invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_contact_id              ON public.sage_invoices(contact_id);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_contact_name            ON public.sage_invoices(contact_name);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_deleted_at              ON public.sage_invoices(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.sage_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_invoices_select" ON public.sage_invoices;
CREATE POLICY "sage_invoices_select" ON public.sage_invoices FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_invoices_insert" ON public.sage_invoices;
CREATE POLICY "sage_invoices_insert" ON public.sage_invoices FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_invoices_update" ON public.sage_invoices;
CREATE POLICY "sage_invoices_update" ON public.sage_invoices FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_invoices_delete" ON public.sage_invoices;
CREATE POLICY "sage_invoices_delete" ON public.sage_invoices FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_invoices_updated_at ON public.sage_invoices;
CREATE TRIGGER update_sage_invoices_updated_at
  BEFORE UPDATE ON public.sage_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_sage_invoices_updated_at();

COMMENT ON TABLE  public.sage_invoices                 IS 'Sage Business Cloud Accounting invoices. Currently purchase invoices (ACCPAY) only — sales invoices skipped because dental uses Dentally for patient billing. Source: /purchase_invoices?attributes=all';
COMMENT ON COLUMN public.sage_invoices.invoice_type   IS 'ACCPAY (purchase/payable) | ACCREC (sales/receivable — reserved for future)';
COMMENT ON COLUMN public.sage_invoices.sage_invoice_id IS 'Sage purchase_invoice.id (GUID). Upsert key together with organization_id + platform_integration_id.';

-- ─────────────────────────────────────────────────────────────
-- 3. sage_invoice_line_items
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id      UUID NOT NULL REFERENCES public.sage_invoices(id) ON DELETE CASCADE,

  -- Sage identifiers
  sage_line_item_id VARCHAR(500),                 -- Sage invoice_line.id (GUID)
  line_number       INTEGER,                      -- 1-based position

  -- Description / item
  description TEXT,
  item_code   VARCHAR(100),
  item_name   VARCHAR(500),                       -- product.displayed_as or service.displayed_as

  -- Quantity + amounts
  quantity        NUMERIC(15, 4),
  unit_amount     NUMERIC(15, 4),                 -- unit_price
  line_amount     NUMERIC(15, 2),                 -- net_amount
  tax_amount      NUMERIC(15, 2),
  discount_amount NUMERIC(15, 2),
  discount_rate   NUMERIC(10, 4),

  -- Tax + account
  tax_type     VARCHAR(255),                      -- tax_rate.id
  tax_rate     NUMERIC(10, 4),                    -- Reserved (Sage doesn't expose % directly)
  account_id   VARCHAR(500),                      -- ledger_account.id
  account_code VARCHAR(100),                      -- 4-digit extracted from displayed_as
  account_name VARCHAR(500),                      -- ledger_account.displayed_as

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_line_items_organization_id ON public.sage_invoice_line_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_line_items_invoice_id      ON public.sage_invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sage_line_items_account_id      ON public.sage_invoice_line_items(account_id);
CREATE INDEX IF NOT EXISTS idx_sage_line_items_account_code    ON public.sage_invoice_line_items(account_code);
CREATE INDEX IF NOT EXISTS idx_sage_line_items_tax_type        ON public.sage_invoice_line_items(tax_type);

ALTER TABLE public.sage_invoice_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_li_select" ON public.sage_invoice_line_items;
CREATE POLICY "sage_li_select" ON public.sage_invoice_line_items FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_li_insert" ON public.sage_invoice_line_items;
CREATE POLICY "sage_li_insert" ON public.sage_invoice_line_items FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_li_update" ON public.sage_invoice_line_items;
CREATE POLICY "sage_li_update" ON public.sage_invoice_line_items FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_li_delete" ON public.sage_invoice_line_items;
CREATE POLICY "sage_li_delete" ON public.sage_invoice_line_items FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_invoice_line_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_invoice_line_items_updated_at ON public.sage_invoice_line_items;
CREATE TRIGGER update_sage_invoice_line_items_updated_at
  BEFORE UPDATE ON public.sage_invoice_line_items
  FOR EACH ROW
  EXECUTE FUNCTION update_sage_invoice_line_items_updated_at();

COMMENT ON TABLE public.sage_invoice_line_items IS 'Line items for Sage invoices. Re-synced via DELETE+INSERT strategy (full replace per invoice) to mirror Xero pattern.';

COMMIT;
