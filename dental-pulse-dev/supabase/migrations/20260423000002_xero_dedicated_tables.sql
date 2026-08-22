-- ============================================================
-- Separate Xero data into dedicated xero_* tables.
-- ============================================================
--
-- What this does:
--   1. CREATES new Xero-only tables (chart_of_accounts, invoices, invoice_line_items)
--      so Xero data stops sharing tables with Dentally / QuickBooks / Iplicit.
--   2. RENAMES the already-Xero-only `platform_*` tables for consistency
--      (bank_transactions, credit_notes, journals, overpayments, payments).
--   3. MIGRATES existing Xero rows from `platform_integration_*` into
--      the new `xero_*` tables.
--   4. REMOVES the copied Xero rows from the shared tables (non-Xero rows stay).
--
-- What is intentionally NOT done:
--   - Frontend queries are still pointed at `platform_integration_*` — a
--     follow-up PR will update them. Writes by the Node backend are updated
--     in Phase 2 (backend code change).
--   - `finance_data_sources` / `finance_journal_entries` / `finance_journal_lines`
--     stay as platform-agnostic canonical tables.
--   - `accounts_payable_invoice` is untouched; Xero AP dual-write stops in Phase 2,
--     meaning new Xero invoices will no longer appear in the AP inbox. Existing AP
--     rows sourced from Xero remain until manually cleaned.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. xero_chart_of_accounts
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.xero_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  xero_tenant_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  xero_account_id VARCHAR(500) NOT NULL,
  account_code VARCHAR(100),
  account_name VARCHAR(500),
  account_type VARCHAR(100),
  account_sub_type VARCHAR(100),
  classification VARCHAR(100),
  description TEXT,
  tax_type VARCHAR(100),
  bank_account_type VARCHAR(100),
  reporting_code VARCHAR(100),
  reporting_name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  updated_date_utc TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT xero_chart_of_accounts_unique_per_org
    UNIQUE (organization_id, platform_integration_id, xero_account_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_coa_organization_id           ON public.xero_chart_of_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_xero_coa_platform_integration_id   ON public.xero_chart_of_accounts(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_xero_coa_xero_tenant_id            ON public.xero_chart_of_accounts(xero_tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_coa_xero_account_id           ON public.xero_chart_of_accounts(xero_account_id);
CREATE INDEX IF NOT EXISTS idx_xero_coa_account_code              ON public.xero_chart_of_accounts(account_code);

ALTER TABLE public.xero_chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xero_coa_select" ON public.xero_chart_of_accounts;
CREATE POLICY "xero_coa_select" ON public.xero_chart_of_accounts FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_coa_insert" ON public.xero_chart_of_accounts;
CREATE POLICY "xero_coa_insert" ON public.xero_chart_of_accounts FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_coa_update" ON public.xero_chart_of_accounts;
CREATE POLICY "xero_coa_update" ON public.xero_chart_of_accounts FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_coa_delete" ON public.xero_chart_of_accounts;
CREATE POLICY "xero_coa_delete" ON public.xero_chart_of_accounts FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

-- ─────────────────────────────────────────────────────────────
-- 2. xero_invoices
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.xero_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Xero tenant GUID (string). Matches platform_integration_organizations.platform_org_id.
  -- Nullable to preserve ~55 pre-existing rows that were synced before the column
  -- was added in migration 20260307000002. Future syncs always populate it.
  xero_tenant_id TEXT,

  -- Xero identifiers
  xero_invoice_id UUID,                      -- Real Xero InvoiceID — NULL for PL_SYNTHETIC
  platform_invoice_id VARCHAR(255) NOT NULL, -- Used as upsert key (InvoiceID for real, "pl_<tenant>_<YYYY-MM>" for synthetic)
  invoice_number VARCHAR(100),
  invoice_type VARCHAR(50),                  -- ACCREC / ACCPAY / PL_SYNTHETIC
  reference VARCHAR(255),

  invoice_date DATE,
  due_date DATE,
  paid_date DATE,
  sent_at TIMESTAMP WITH TIME ZONE,

  status VARCHAR(50) DEFAULT 'draft',
  is_paid BOOLEAN DEFAULT FALSE,

  currency VARCHAR(10) DEFAULT 'GBP',
  currency_rate NUMERIC(15, 10) DEFAULT 1.0,

  subtotal NUMERIC(15, 2),
  tax_amount NUMERIC(15, 2),
  total_amount NUMERIC(15, 2),
  amount_paid NUMERIC(15, 2),
  amount_due NUMERIC(15, 2),

  contact_id VARCHAR(500),
  contact_name VARCHAR(500),
  contact_email VARCHAR(500),

  line_amount_types VARCHAR(50),
  invoice_url TEXT,
  branding_theme_id VARCHAR(500),

  sync_status VARCHAR(50) DEFAULT 'synced',
  last_synced_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT xero_invoices_unique_per_tenant
    UNIQUE (organization_id, xero_tenant_id, platform_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_invoices_organization_id      ON public.xero_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_location_id          ON public.xero_invoices(location_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_xero_tenant_id       ON public.xero_invoices(xero_tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_xero_invoice_id      ON public.xero_invoices(xero_invoice_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_invoice_number       ON public.xero_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_invoice_date         ON public.xero_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_invoice_type         ON public.xero_invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_status               ON public.xero_invoices(status);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_contact_id           ON public.xero_invoices(contact_id);

ALTER TABLE public.xero_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xero_invoices_select" ON public.xero_invoices;
CREATE POLICY "xero_invoices_select" ON public.xero_invoices FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_invoices_insert" ON public.xero_invoices;
CREATE POLICY "xero_invoices_insert" ON public.xero_invoices FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_invoices_update" ON public.xero_invoices;
CREATE POLICY "xero_invoices_update" ON public.xero_invoices FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_invoices_delete" ON public.xero_invoices;
CREATE POLICY "xero_invoices_delete" ON public.xero_invoices FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

-- ─────────────────────────────────────────────────────────────
-- 3. xero_invoice_line_items
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.xero_invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.xero_invoices(id) ON DELETE CASCADE,

  xero_line_item_id VARCHAR(500),
  platform_line_id VARCHAR(500),
  line_number INTEGER,
  description TEXT,
  item_code VARCHAR(100),
  quantity NUMERIC(15, 4),
  unit_amount NUMERIC(15, 4),
  line_amount NUMERIC(15, 2),
  tax_amount NUMERIC(15, 2),
  discount_rate NUMERIC(10, 4),
  tax_type VARCHAR(100),
  account_id VARCHAR(500),
  account_code VARCHAR(100),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT xero_invoice_line_items_unique_line
    UNIQUE (organization_id, platform_line_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_line_items_organization_id ON public.xero_invoice_line_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_xero_line_items_invoice_id      ON public.xero_invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_xero_line_items_account_id      ON public.xero_invoice_line_items(account_id);
CREATE INDEX IF NOT EXISTS idx_xero_line_items_account_code    ON public.xero_invoice_line_items(account_code);

ALTER TABLE public.xero_invoice_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xero_li_select" ON public.xero_invoice_line_items;
CREATE POLICY "xero_li_select" ON public.xero_invoice_line_items FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_li_insert" ON public.xero_invoice_line_items;
CREATE POLICY "xero_li_insert" ON public.xero_invoice_line_items FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_li_update" ON public.xero_invoice_line_items;
CREATE POLICY "xero_li_update" ON public.xero_invoice_line_items FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_li_delete" ON public.xero_invoice_line_items;
CREATE POLICY "xero_li_delete" ON public.xero_invoice_line_items FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

-- ─────────────────────────────────────────────────────────────
-- 4. Rename existing Xero-only platform_* tables → xero_*
--    Indexes and constraints auto-rename with the table.
--    Uses DO blocks so this is idempotent.
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_bank_transactions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='xero_bank_transactions')
  THEN
    ALTER TABLE public.platform_bank_transactions RENAME TO xero_bank_transactions;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_credit_notes')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='xero_credit_notes')
  THEN
    ALTER TABLE public.platform_credit_notes RENAME TO xero_credit_notes;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_credit_note_allocations')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='xero_credit_note_allocations')
  THEN
    ALTER TABLE public.platform_credit_note_allocations RENAME TO xero_credit_note_allocations;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_journals')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='xero_journals')
  THEN
    ALTER TABLE public.platform_journals RENAME TO xero_journals;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_journal_details')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='xero_journal_details')
  THEN
    ALTER TABLE public.platform_journal_details RENAME TO xero_journal_details;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_overpayments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='xero_overpayments')
  THEN
    ALTER TABLE public.platform_overpayments RENAME TO xero_overpayments;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_payments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='xero_payments')
  THEN
    ALTER TABLE public.platform_payments RENAME TO xero_payments;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. Migrate existing Xero rows from shared tables → xero_* tables
-- ─────────────────────────────────────────────────────────────

-- Chart of Accounts: resolve xero_tenant_id by joining on platform_integration_organizations
-- (platform_integration_chart_of_accounts.platform_integration_organization_id was stored as
-- the Xero GUID string, not a UUID).
INSERT INTO public.xero_chart_of_accounts (
  id, organization_id, platform_integration_id, xero_tenant_id, user_id,
  xero_account_id, account_code, account_name, account_type, account_sub_type,
  classification, description, tax_type, bank_account_type,
  reporting_code, reporting_name, is_active, updated_date_utc,
  created_at, updated_at
)
SELECT
  c.id, c.organization_id, c.platform_integration_id,
  pio.id,                                            -- tenant row UUID
  c.user_id,
  c.coa_account_id, c.coa_account_code, c.coa_account_name,
  c.coa_account_type, c.coa_account_sub_type,
  c.coa_classification, c.coa_description, c.coa_tax_type, c.coa_bank_account_type,
  c.coa_reporting_code, c.coa_reporting_name, c.coa_is_active,
  c.coa_updated_date_utc,
  c.created_at, c.updated_at
FROM public.platform_integration_chart_of_accounts c
LEFT JOIN public.platform_integration_organizations pio
  ON pio.organization_id = c.organization_id
 AND pio.platform_name = 'xero'
 AND (pio.id::TEXT = c.platform_integration_organization_id
      OR pio.platform_org_id = c.platform_integration_organization_id)
WHERE c.platform_name = 'xero'
ON CONFLICT (organization_id, platform_integration_id, xero_account_id) DO NOTHING;

-- Invoices
INSERT INTO public.xero_invoices (
  id, organization_id, location_id, user_id,
  xero_tenant_id,
  xero_invoice_id, platform_invoice_id, invoice_number, invoice_type, reference,
  invoice_date, due_date, paid_date, sent_at,
  status, is_paid,
  currency, currency_rate,
  subtotal, tax_amount, total_amount, amount_paid, amount_due,
  contact_id, contact_name, contact_email,
  line_amount_types, invoice_url, branding_theme_id,
  sync_status, last_synced_at, deleted_at,
  created_at, updated_at
)
SELECT
  i.id, i.organization_id, i.location_id, i.user_id,
  i.platform_integration_organization_id,
  i.xero_invoice_id, i.platform_invoice_id, i.invoice_number, i.invoice_type, i.reference,
  i.invoice_date, i.due_date, i.paid_date, i.sent_at,
  i.status, i.is_paid,
  i.currency, i.currency_rate,
  i.subtotal, i.tax_amount, i.total_amount, i.amount_paid, i.amount_due,
  i.contact_id, i.contact_name, i.contact_email,
  i.line_amount_types, i.invoice_url, i.branding_theme_id,
  i.sync_status, i.last_synced_at, i.deleted_at,
  i.created_at, i.updated_at
FROM public.platform_integration_invoices i
WHERE i.platform_type = 'xero'
ON CONFLICT (organization_id, xero_tenant_id, platform_invoice_id) DO NOTHING;

-- Line items — FK references xero_invoices by invoice id, which we preserved above.
INSERT INTO public.xero_invoice_line_items (
  id, organization_id, invoice_id,
  xero_line_item_id, platform_line_id, line_number,
  description, item_code, quantity, unit_amount, line_amount, tax_amount,
  discount_rate, tax_type, account_id, account_code,
  created_at, updated_at
)
SELECT
  li.id, li.organization_id, li.invoice_id,
  li.xero_line_item_id, li.platform_line_id, li.line_number,
  li.description, li.item_code, li.quantity, li.unit_amount, li.line_amount, li.tax_amount,
  li.discount_rate, li.tax_type, li.account_id, li.account_code,
  li.created_at, li.updated_at
FROM public.platform_integration_invoice_line_items li
JOIN public.platform_integration_invoices pi ON pi.id = li.invoice_id
WHERE pi.platform_type = 'xero'
ON CONFLICT (organization_id, platform_line_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 6. Remove migrated Xero rows from shared tables
--    (Dentally / QuickBooks / Iplicit rows are untouched.)
-- ─────────────────────────────────────────────────────────────

DELETE FROM public.platform_integration_invoice_line_items li
  USING public.platform_integration_invoices pi
  WHERE li.invoice_id = pi.id AND pi.platform_type = 'xero';

DELETE FROM public.platform_integration_invoices
  WHERE platform_type = 'xero';

DELETE FROM public.platform_integration_chart_of_accounts
  WHERE platform_name = 'xero';

-- ─────────────────────────────────────────────────────────────
-- 7. Update table comments for discoverability
-- ─────────────────────────────────────────────────────────────

COMMENT ON TABLE public.xero_chart_of_accounts     IS 'Xero Chart of Accounts. Separated from platform_integration_chart_of_accounts on 2026-04-23.';
COMMENT ON TABLE public.xero_invoices              IS 'Xero invoices (ACCREC + ACCPAY + PL_SYNTHETIC). Separated from platform_integration_invoices on 2026-04-23.';
COMMENT ON TABLE public.xero_invoice_line_items    IS 'Xero invoice line items. Separated from platform_integration_invoice_line_items on 2026-04-23.';
COMMENT ON TABLE public.xero_bank_transactions     IS 'Xero bank transactions. Renamed from platform_bank_transactions on 2026-04-23.';
COMMENT ON TABLE public.xero_credit_notes          IS 'Xero credit notes. Renamed from platform_credit_notes on 2026-04-23.';
COMMENT ON TABLE public.xero_credit_note_allocations IS 'Xero credit note allocations. Renamed from platform_credit_note_allocations on 2026-04-23.';
COMMENT ON TABLE public.xero_journals              IS 'Xero journals. Renamed from platform_journals on 2026-04-23.';
COMMENT ON TABLE public.xero_journal_details       IS 'Xero journal details. Renamed from platform_journal_details on 2026-04-23.';
COMMENT ON TABLE public.xero_overpayments          IS 'Xero overpayments. Renamed from platform_overpayments on 2026-04-23.';
COMMENT ON TABLE public.xero_payments              IS 'Xero payments. Renamed from platform_payments on 2026-04-23.';

COMMIT;
