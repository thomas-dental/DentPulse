-- ============================================================
-- Sage PART B Wave 1 — Tax Rates, Credit Notes, Journals
-- ============================================================
--
-- Adds three new dedicated tables (plus 2 child line-item tables) to
-- mirror the Xero/Iplicit entity coverage:
--   * sage_tax_rates              — UK VAT lookup (20% / 5% / 0% / exempt)
--   * sage_credit_notes           — purchase credit notes (supplier refunds)
--   * sage_credit_note_line_items — line items for credit notes
--   * sage_journals               — manual accounting entries (header)
--   * sage_journal_lines          — DR/CR lines for journals
--
-- All tables follow the same dedicated-table pattern as the COA + Invoices
-- migration (20260528000001_sage_dedicated_tables.sql). RLS via user_in_org(),
-- updated_at triggers, FK CASCADE for child tables.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. sage_tax_rates  (UK VAT lookup)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Sage identifiers
  sage_tax_rate_id VARCHAR(500) NOT NULL,        -- Sage tax_rate.id (e.g. "GB_STANDARD")
  displayed_as     VARCHAR(500),                  -- "Standard 20.00%"
  name             VARCHAR(255),                  -- "Standard"
  percentage       NUMERIC(10, 4),                -- 20.0, 5.0, 0.0
  agency           VARCHAR(100),                  -- HMRC
  tax_code         VARCHAR(50),                   -- T1 / T0 / T2
  is_visible       BOOLEAN DEFAULT TRUE,
  is_default       BOOLEAN DEFAULT FALSE,
  effective_date   DATE,

  raw_data JSONB,

  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT sage_tax_rates_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_tax_rate_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_tax_rates_organization_id         ON public.sage_tax_rates(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_tax_rates_platform_integration_id ON public.sage_tax_rates(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_sage_tax_rates_sage_tax_rate_id        ON public.sage_tax_rates(sage_tax_rate_id);
CREATE INDEX IF NOT EXISTS idx_sage_tax_rates_tax_code                ON public.sage_tax_rates(tax_code);
CREATE INDEX IF NOT EXISTS idx_sage_tax_rates_is_visible              ON public.sage_tax_rates(is_visible);

ALTER TABLE public.sage_tax_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_tax_rates_select" ON public.sage_tax_rates;
CREATE POLICY "sage_tax_rates_select" ON public.sage_tax_rates FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_tax_rates_insert" ON public.sage_tax_rates;
CREATE POLICY "sage_tax_rates_insert" ON public.sage_tax_rates FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_tax_rates_update" ON public.sage_tax_rates;
CREATE POLICY "sage_tax_rates_update" ON public.sage_tax_rates FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_tax_rates_delete" ON public.sage_tax_rates;
CREATE POLICY "sage_tax_rates_delete" ON public.sage_tax_rates FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_tax_rates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_tax_rates_updated_at ON public.sage_tax_rates;
CREATE TRIGGER update_sage_tax_rates_updated_at
  BEFORE UPDATE ON public.sage_tax_rates
  FOR EACH ROW
  EXECUTE FUNCTION update_sage_tax_rates_updated_at();

COMMENT ON TABLE public.sage_tax_rates IS 'Sage UK VAT lookup. Source: /tax_rates?attributes=all';

-- ─────────────────────────────────────────────────────────────
-- 2. sage_credit_notes  (Purchase Credit Notes — supplier refunds)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Sage identifiers
  sage_credit_note_id VARCHAR(500) NOT NULL,     -- Sage purchase_credit_note.id (GUID)

  -- Credit note header
  credit_note_number VARCHAR(100),                -- vendor_reference or reference
  credit_note_type   VARCHAR(50) DEFAULT 'ACCPAYCREDIT', -- ACCPAYCREDIT (purchase) | ACCRECCREDIT (sales — reserved)
  reference          VARCHAR(255),

  -- Dates
  credit_note_date DATE,

  -- Status
  status VARCHAR(50) DEFAULT 'draft',             -- draft / unallocated / part_allocated / fully_allocated / voided

  -- Financials
  currency      VARCHAR(10) DEFAULT 'GBP',
  currency_rate NUMERIC(15, 10) DEFAULT 1.0,

  subtotal           NUMERIC(15, 2),
  tax_amount         NUMERIC(15, 2),
  total_amount       NUMERIC(15, 2),
  total_allocated    NUMERIC(15, 2) DEFAULT 0,
  outstanding_amount NUMERIC(15, 2),

  -- Contact / supplier
  contact_id    VARCHAR(500),
  contact_name  VARCHAR(500),
  contact_email VARCHAR(500),

  -- Additional fields
  private_note TEXT,
  void_reason  TEXT,
  credit_note_url TEXT,

  -- Raw payload + meta
  raw_data    JSONB,
  meta_data   JSONB,

  -- Sync tracking
  sync_status    VARCHAR(50) DEFAULT 'synced',
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sync_error     TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT sage_credit_notes_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_credit_note_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_credit_notes_organization_id         ON public.sage_credit_notes(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_credit_notes_platform_integration_id ON public.sage_credit_notes(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_sage_credit_notes_sage_credit_note_id     ON public.sage_credit_notes(sage_credit_note_id);
CREATE INDEX IF NOT EXISTS idx_sage_credit_notes_credit_note_number      ON public.sage_credit_notes(credit_note_number);
CREATE INDEX IF NOT EXISTS idx_sage_credit_notes_status                  ON public.sage_credit_notes(status);
CREATE INDEX IF NOT EXISTS idx_sage_credit_notes_credit_note_date        ON public.sage_credit_notes(credit_note_date);
CREATE INDEX IF NOT EXISTS idx_sage_credit_notes_contact_id              ON public.sage_credit_notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_sage_credit_notes_deleted_at              ON public.sage_credit_notes(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.sage_credit_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_credit_notes_select" ON public.sage_credit_notes;
CREATE POLICY "sage_credit_notes_select" ON public.sage_credit_notes FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_credit_notes_insert" ON public.sage_credit_notes;
CREATE POLICY "sage_credit_notes_insert" ON public.sage_credit_notes FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_credit_notes_update" ON public.sage_credit_notes;
CREATE POLICY "sage_credit_notes_update" ON public.sage_credit_notes FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_credit_notes_delete" ON public.sage_credit_notes;
CREATE POLICY "sage_credit_notes_delete" ON public.sage_credit_notes FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_credit_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_credit_notes_updated_at ON public.sage_credit_notes;
CREATE TRIGGER update_sage_credit_notes_updated_at
  BEFORE UPDATE ON public.sage_credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_sage_credit_notes_updated_at();

COMMENT ON TABLE public.sage_credit_notes IS 'Sage Business Cloud purchase credit notes (supplier refunds). Source: /purchase_credit_notes?attributes=all';

-- ─────────────────────────────────────────────────────────────
-- 3. sage_credit_note_line_items
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_credit_note_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credit_note_id UUID NOT NULL REFERENCES public.sage_credit_notes(id) ON DELETE CASCADE,

  sage_line_item_id VARCHAR(500),
  line_number       INTEGER,

  description TEXT,
  item_code   VARCHAR(100),
  item_name   VARCHAR(500),

  quantity        NUMERIC(15, 4),
  unit_amount     NUMERIC(15, 4),
  line_amount     NUMERIC(15, 2),
  tax_amount      NUMERIC(15, 2),
  discount_amount NUMERIC(15, 2),
  discount_rate   NUMERIC(10, 4),

  tax_type     VARCHAR(255),
  tax_rate     NUMERIC(10, 4),
  account_id   VARCHAR(500),
  account_code VARCHAR(100),
  account_name VARCHAR(500),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_cn_lines_organization_id ON public.sage_credit_note_line_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_cn_lines_credit_note_id  ON public.sage_credit_note_line_items(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_sage_cn_lines_account_id      ON public.sage_credit_note_line_items(account_id);
CREATE INDEX IF NOT EXISTS idx_sage_cn_lines_account_code    ON public.sage_credit_note_line_items(account_code);

ALTER TABLE public.sage_credit_note_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_cn_lines_select" ON public.sage_credit_note_line_items;
CREATE POLICY "sage_cn_lines_select" ON public.sage_credit_note_line_items FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_cn_lines_insert" ON public.sage_credit_note_line_items;
CREATE POLICY "sage_cn_lines_insert" ON public.sage_credit_note_line_items FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_cn_lines_update" ON public.sage_credit_note_line_items;
CREATE POLICY "sage_cn_lines_update" ON public.sage_credit_note_line_items FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_cn_lines_delete" ON public.sage_credit_note_line_items;
CREATE POLICY "sage_cn_lines_delete" ON public.sage_credit_note_line_items FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_credit_note_line_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_credit_note_line_items_updated_at ON public.sage_credit_note_line_items;
CREATE TRIGGER update_sage_credit_note_line_items_updated_at
  BEFORE UPDATE ON public.sage_credit_note_line_items
  FOR EACH ROW
  EXECUTE FUNCTION update_sage_credit_note_line_items_updated_at();

COMMENT ON TABLE public.sage_credit_note_line_items IS 'Line items for Sage credit notes. Re-synced via DELETE+INSERT (full replace per credit note).';

-- ─────────────────────────────────────────────────────────────
-- 4. sage_journals  (Manual accounting entries — header)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Sage identifiers
  sage_journal_id VARCHAR(500) NOT NULL,         -- Sage journal.id (GUID)

  reference VARCHAR(255),                         -- Journal reference number
  narrative TEXT,                                  -- Description / narrative
  journal_date DATE,

  status VARCHAR(50) DEFAULT 'posted',            -- draft / posted / reversed

  -- Totals (should always balance: total_debits = total_credits)
  total_debits  NUMERIC(15, 2),
  total_credits NUMERIC(15, 2),

  is_reverse_journal BOOLEAN DEFAULT FALSE,
  reversal_journal_id VARCHAR(500),               -- Sage ID of the journal this one reverses

  currency      VARCHAR(10) DEFAULT 'GBP',
  currency_rate NUMERIC(15, 10) DEFAULT 1.0,

  raw_data JSONB,

  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT sage_journals_unique_per_org
    UNIQUE (organization_id, platform_integration_id, sage_journal_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_journals_organization_id         ON public.sage_journals(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_journals_platform_integration_id ON public.sage_journals(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_sage_journals_sage_journal_id         ON public.sage_journals(sage_journal_id);
CREATE INDEX IF NOT EXISTS idx_sage_journals_journal_date            ON public.sage_journals(journal_date);
CREATE INDEX IF NOT EXISTS idx_sage_journals_status                  ON public.sage_journals(status);
CREATE INDEX IF NOT EXISTS idx_sage_journals_deleted_at              ON public.sage_journals(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.sage_journals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_journals_select" ON public.sage_journals;
CREATE POLICY "sage_journals_select" ON public.sage_journals FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_journals_insert" ON public.sage_journals;
CREATE POLICY "sage_journals_insert" ON public.sage_journals FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_journals_update" ON public.sage_journals;
CREATE POLICY "sage_journals_update" ON public.sage_journals FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_journals_delete" ON public.sage_journals;
CREATE POLICY "sage_journals_delete" ON public.sage_journals FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_journals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_journals_updated_at ON public.sage_journals;
CREATE TRIGGER update_sage_journals_updated_at
  BEFORE UPDATE ON public.sage_journals
  FOR EACH ROW
  EXECUTE FUNCTION update_sage_journals_updated_at();

COMMENT ON TABLE public.sage_journals IS 'Sage manual journal entries (header). Source: /journals?attributes=all';

-- ─────────────────────────────────────────────────────────────
-- 5. sage_journal_lines  (DR / CR lines)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sage_journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL REFERENCES public.sage_journals(id) ON DELETE CASCADE,

  sage_journal_line_id VARCHAR(500),
  line_number          INTEGER,

  ledger_account_id   VARCHAR(500),
  ledger_account_name VARCHAR(500),
  account_code        VARCHAR(100),

  debit  NUMERIC(15, 2) DEFAULT 0,
  credit NUMERIC(15, 2) DEFAULT 0,

  description TEXT,
  details     TEXT,

  raw_data JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_journal_lines_organization_id   ON public.sage_journal_lines(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_journal_lines_journal_id        ON public.sage_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_sage_journal_lines_ledger_account_id ON public.sage_journal_lines(ledger_account_id);
CREATE INDEX IF NOT EXISTS idx_sage_journal_lines_account_code      ON public.sage_journal_lines(account_code);

ALTER TABLE public.sage_journal_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_journal_lines_select" ON public.sage_journal_lines;
CREATE POLICY "sage_journal_lines_select" ON public.sage_journal_lines FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_journal_lines_insert" ON public.sage_journal_lines;
CREATE POLICY "sage_journal_lines_insert" ON public.sage_journal_lines FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_journal_lines_update" ON public.sage_journal_lines;
CREATE POLICY "sage_journal_lines_update" ON public.sage_journal_lines FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "sage_journal_lines_delete" ON public.sage_journal_lines;
CREATE POLICY "sage_journal_lines_delete" ON public.sage_journal_lines FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION update_sage_journal_lines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_journal_lines_updated_at ON public.sage_journal_lines;
CREATE TRIGGER update_sage_journal_lines_updated_at
  BEFORE UPDATE ON public.sage_journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_sage_journal_lines_updated_at();

COMMENT ON TABLE public.sage_journal_lines IS 'DR/CR lines for Sage journal entries. Re-synced via DELETE+INSERT (full replace per journal).';

COMMIT;
