-- ============================================================
-- Sage PART B Wave 2 — Medium Priority Entities
-- ============================================================
--
-- Adds six more dedicated tables to broaden Sage coverage:
--   * sage_payment_methods    — BACS / cheque / card / transfer lookup
--   * sage_products           — products + services (price list / catalog)
--   * sage_other_payments     — bank-side payments not tied to a contact
--                                (bank charges, transfers out, fees)
--   * sage_other_receipts     — bank-side receipts not tied to a contact
--                                (interest, transfers in)
--   * sage_bank_transfers     — transfers between bank accounts
--   * sage_attachments        — file attachments (PDFs, images) on invoices etc.
--                                bridges to the Invoice OCR pipeline
--
-- Pattern: same as Wave 1 — RLS via user_in_org(), indexes, updated_at triggers.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. sage_payment_methods  (BACS / cheque / card / transfer lookup)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  sage_payment_method_id VARCHAR(500) NOT NULL,
  displayed_as           VARCHAR(500),
  name                   VARCHAR(255),
  payment_method_type    VARCHAR(100),               -- type.id e.g. "OTHER", "CARD", "DIRECT_DEBIT"
  is_visible             BOOLEAN DEFAULT TRUE,

  raw_data JSONB,

  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT sage_payment_methods_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_payment_method_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_payment_methods_organization_id ON public.sage_payment_methods(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_payment_methods_sage_id         ON public.sage_payment_methods(sage_payment_method_id);
CREATE INDEX IF NOT EXISTS idx_sage_payment_methods_is_visible      ON public.sage_payment_methods(is_visible);

ALTER TABLE public.sage_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_payment_methods_select" ON public.sage_payment_methods;
CREATE POLICY "sage_payment_methods_select" ON public.sage_payment_methods FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_payment_methods_insert" ON public.sage_payment_methods;
CREATE POLICY "sage_payment_methods_insert" ON public.sage_payment_methods FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_payment_methods_update" ON public.sage_payment_methods;
CREATE POLICY "sage_payment_methods_update" ON public.sage_payment_methods FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_payment_methods_delete" ON public.sage_payment_methods;
CREATE POLICY "sage_payment_methods_delete" ON public.sage_payment_methods FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_payment_methods_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_payment_methods_updated_at ON public.sage_payment_methods;
CREATE TRIGGER update_sage_payment_methods_updated_at
  BEFORE UPDATE ON public.sage_payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_sage_payment_methods_updated_at();

COMMENT ON TABLE public.sage_payment_methods IS 'Sage payment method lookup (BACS / cheque / card / direct debit). Source: /payment_methods?attributes=all';

-- ─────────────────────────────────────────────────────────────
-- 2. sage_products  (products + services / catalog)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  sage_product_id VARCHAR(500) NOT NULL,
  displayed_as    VARCHAR(500),
  item_code       VARCHAR(100),
  description     TEXT,
  notes           TEXT,

  -- Sage distinguishes products vs services via endpoint; we store both here
  product_type VARCHAR(50) DEFAULT 'product',          -- 'product' | 'service'

  sales_price        NUMERIC(15, 4),
  purchase_price     NUMERIC(15, 4),
  cost_price         NUMERIC(15, 4),

  sales_ledger_account_id     VARCHAR(500),
  sales_ledger_account_name   VARCHAR(500),
  purchase_ledger_account_id  VARCHAR(500),
  purchase_ledger_account_name VARCHAR(500),

  sales_tax_rate_id    VARCHAR(500),
  purchase_tax_rate_id VARCHAR(500),

  is_sold      BOOLEAN DEFAULT TRUE,
  is_purchased BOOLEAN DEFAULT TRUE,
  is_visible   BOOLEAN DEFAULT TRUE,
  is_active    BOOLEAN DEFAULT TRUE,

  raw_data JSONB,

  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT sage_products_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_product_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_products_organization_id ON public.sage_products(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_products_sage_id         ON public.sage_products(sage_product_id);
CREATE INDEX IF NOT EXISTS idx_sage_products_item_code       ON public.sage_products(item_code);
CREATE INDEX IF NOT EXISTS idx_sage_products_product_type    ON public.sage_products(product_type);
CREATE INDEX IF NOT EXISTS idx_sage_products_is_visible      ON public.sage_products(is_visible);

ALTER TABLE public.sage_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_products_select" ON public.sage_products;
CREATE POLICY "sage_products_select" ON public.sage_products FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_products_insert" ON public.sage_products;
CREATE POLICY "sage_products_insert" ON public.sage_products FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_products_update" ON public.sage_products;
CREATE POLICY "sage_products_update" ON public.sage_products FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_products_delete" ON public.sage_products;
CREATE POLICY "sage_products_delete" ON public.sage_products FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_products_updated_at ON public.sage_products;
CREATE TRIGGER update_sage_products_updated_at
  BEFORE UPDATE ON public.sage_products
  FOR EACH ROW EXECUTE FUNCTION update_sage_products_updated_at();

COMMENT ON TABLE public.sage_products IS 'Sage product/service catalog. Sources: /products?attributes=all and /services?attributes=all (product_type distinguishes them).';

-- ─────────────────────────────────────────────────────────────
-- 3. sage_other_payments  (bank-side payments NOT tied to a contact)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_other_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  sage_other_payment_id VARCHAR(500) NOT NULL,
  displayed_as          VARCHAR(500),

  bank_account_id   VARCHAR(500),
  bank_account_name VARCHAR(500),

  transaction_type_id    VARCHAR(100),
  transaction_type_label VARCHAR(255),
  transaction_date       DATE,

  reference   VARCHAR(255),
  description TEXT,

  -- Financials
  total_amount NUMERIC(15, 2),
  net_amount   NUMERIC(15, 2),
  tax_amount   NUMERIC(15, 2),

  tax_rate_id    VARCHAR(500),
  tax_rate_label VARCHAR(500),

  ledger_account_id   VARCHAR(500),
  ledger_account_name VARCHAR(500),

  currency_id   VARCHAR(10),
  exchange_rate NUMERIC(15, 10),

  payment_method_id VARCHAR(500),

  raw_data JSONB,

  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT sage_other_payments_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_other_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_other_payments_organization_id ON public.sage_other_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_other_payments_sage_id         ON public.sage_other_payments(sage_other_payment_id);
CREATE INDEX IF NOT EXISTS idx_sage_other_payments_bank_account_id ON public.sage_other_payments(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_sage_other_payments_transaction_date ON public.sage_other_payments(transaction_date);

ALTER TABLE public.sage_other_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_other_payments_select" ON public.sage_other_payments;
CREATE POLICY "sage_other_payments_select" ON public.sage_other_payments FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_other_payments_insert" ON public.sage_other_payments;
CREATE POLICY "sage_other_payments_insert" ON public.sage_other_payments FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_other_payments_update" ON public.sage_other_payments;
CREATE POLICY "sage_other_payments_update" ON public.sage_other_payments FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_other_payments_delete" ON public.sage_other_payments;
CREATE POLICY "sage_other_payments_delete" ON public.sage_other_payments FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_other_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_other_payments_updated_at ON public.sage_other_payments;
CREATE TRIGGER update_sage_other_payments_updated_at
  BEFORE UPDATE ON public.sage_other_payments
  FOR EACH ROW EXECUTE FUNCTION update_sage_other_payments_updated_at();

COMMENT ON TABLE public.sage_other_payments IS 'Sage bank-side payments not tied to a contact (bank charges, fees, etc.). Source: /other_payments?attributes=all';

-- ─────────────────────────────────────────────────────────────
-- 4. sage_other_receipts  (bank-side receipts NOT from a contact)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_other_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  sage_other_receipt_id VARCHAR(500) NOT NULL,
  displayed_as          VARCHAR(500),

  bank_account_id   VARCHAR(500),
  bank_account_name VARCHAR(500),

  transaction_type_id    VARCHAR(100),
  transaction_type_label VARCHAR(255),
  transaction_date       DATE,

  reference   VARCHAR(255),
  description TEXT,

  total_amount NUMERIC(15, 2),
  net_amount   NUMERIC(15, 2),
  tax_amount   NUMERIC(15, 2),

  tax_rate_id    VARCHAR(500),
  tax_rate_label VARCHAR(500),

  ledger_account_id   VARCHAR(500),
  ledger_account_name VARCHAR(500),

  currency_id   VARCHAR(10),
  exchange_rate NUMERIC(15, 10),

  payment_method_id VARCHAR(500),

  raw_data JSONB,

  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT sage_other_receipts_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_other_receipt_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_other_receipts_organization_id ON public.sage_other_receipts(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_other_receipts_sage_id         ON public.sage_other_receipts(sage_other_receipt_id);
CREATE INDEX IF NOT EXISTS idx_sage_other_receipts_bank_account_id ON public.sage_other_receipts(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_sage_other_receipts_transaction_date ON public.sage_other_receipts(transaction_date);

ALTER TABLE public.sage_other_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_other_receipts_select" ON public.sage_other_receipts;
CREATE POLICY "sage_other_receipts_select" ON public.sage_other_receipts FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_other_receipts_insert" ON public.sage_other_receipts;
CREATE POLICY "sage_other_receipts_insert" ON public.sage_other_receipts FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_other_receipts_update" ON public.sage_other_receipts;
CREATE POLICY "sage_other_receipts_update" ON public.sage_other_receipts FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_other_receipts_delete" ON public.sage_other_receipts;
CREATE POLICY "sage_other_receipts_delete" ON public.sage_other_receipts FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_other_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_other_receipts_updated_at ON public.sage_other_receipts;
CREATE TRIGGER update_sage_other_receipts_updated_at
  BEFORE UPDATE ON public.sage_other_receipts
  FOR EACH ROW EXECUTE FUNCTION update_sage_other_receipts_updated_at();

COMMENT ON TABLE public.sage_other_receipts IS 'Sage bank-side receipts not tied to a contact (interest, transfers in, etc.). Source: /other_receipts?attributes=all';

-- ─────────────────────────────────────────────────────────────
-- 5. sage_bank_transfers  (transfers between bank accounts)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_bank_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  sage_bank_transfer_id VARCHAR(500) NOT NULL,
  displayed_as          VARCHAR(500),

  from_bank_account_id   VARCHAR(500),
  from_bank_account_name VARCHAR(500),
  to_bank_account_id     VARCHAR(500),
  to_bank_account_name   VARCHAR(500),

  transfer_date DATE,
  reference     VARCHAR(255),
  description   TEXT,

  amount        NUMERIC(15, 2),
  exchange_rate NUMERIC(15, 10),
  currency_id   VARCHAR(10),

  raw_data JSONB,

  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT sage_bank_transfers_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_bank_transfer_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_bank_transfers_organization_id    ON public.sage_bank_transfers(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_transfers_sage_id            ON public.sage_bank_transfers(sage_bank_transfer_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_transfers_from_bank_account  ON public.sage_bank_transfers(from_bank_account_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_transfers_to_bank_account    ON public.sage_bank_transfers(to_bank_account_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_transfers_transfer_date      ON public.sage_bank_transfers(transfer_date);

ALTER TABLE public.sage_bank_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_bank_transfers_select" ON public.sage_bank_transfers;
CREATE POLICY "sage_bank_transfers_select" ON public.sage_bank_transfers FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_bank_transfers_insert" ON public.sage_bank_transfers;
CREATE POLICY "sage_bank_transfers_insert" ON public.sage_bank_transfers FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_bank_transfers_update" ON public.sage_bank_transfers;
CREATE POLICY "sage_bank_transfers_update" ON public.sage_bank_transfers FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_bank_transfers_delete" ON public.sage_bank_transfers;
CREATE POLICY "sage_bank_transfers_delete" ON public.sage_bank_transfers FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_bank_transfers_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_bank_transfers_updated_at ON public.sage_bank_transfers;
CREATE TRIGGER update_sage_bank_transfers_updated_at
  BEFORE UPDATE ON public.sage_bank_transfers
  FOR EACH ROW EXECUTE FUNCTION update_sage_bank_transfers_updated_at();

COMMENT ON TABLE public.sage_bank_transfers IS 'Sage transfers between bank accounts. Source: /bank_transfers?attributes=all';

-- ─────────────────────────────────────────────────────────────
-- 6. sage_attachments  (file attachments — invoice PDFs etc.)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  sage_attachment_id VARCHAR(500) NOT NULL,
  displayed_as       VARCHAR(500),

  file_name    VARCHAR(500),
  content_type VARCHAR(255),
  file_size    BIGINT,

  -- What this attachment is attached to (resolved from "attached_to" ref in Sage)
  attached_to_entity VARCHAR(100),                   -- e.g. "purchase_invoice"
  attached_to_id     VARCHAR(500),                   -- the Sage id of the parent record
  attached_to_path   VARCHAR(500),                   -- raw $path Sage gave us

  source_url   TEXT,                                  -- self link to attachment metadata
  download_url TEXT,                                  -- if Sage exposes a downloadable URL

  raw_data JSONB,

  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT sage_attachments_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_attachments_organization_id    ON public.sage_attachments(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_attachments_sage_id            ON public.sage_attachments(sage_attachment_id);
CREATE INDEX IF NOT EXISTS idx_sage_attachments_attached_to_entity ON public.sage_attachments(attached_to_entity);
CREATE INDEX IF NOT EXISTS idx_sage_attachments_attached_to_id     ON public.sage_attachments(attached_to_id);

ALTER TABLE public.sage_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_attachments_select" ON public.sage_attachments;
CREATE POLICY "sage_attachments_select" ON public.sage_attachments FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_attachments_insert" ON public.sage_attachments;
CREATE POLICY "sage_attachments_insert" ON public.sage_attachments FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_attachments_update" ON public.sage_attachments;
CREATE POLICY "sage_attachments_update" ON public.sage_attachments FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_attachments_delete" ON public.sage_attachments;
CREATE POLICY "sage_attachments_delete" ON public.sage_attachments FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_attachments_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_attachments_updated_at ON public.sage_attachments;
CREATE TRIGGER update_sage_attachments_updated_at
  BEFORE UPDATE ON public.sage_attachments
  FOR EACH ROW EXECUTE FUNCTION update_sage_attachments_updated_at();

COMMENT ON TABLE public.sage_attachments IS 'Sage file attachments (invoice PDFs, receipt images). Source: /attachments?attributes=all';

COMMIT;
