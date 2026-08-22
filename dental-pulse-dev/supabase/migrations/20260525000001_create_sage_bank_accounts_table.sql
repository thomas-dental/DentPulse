-- ============================================================
-- sage_bank_accounts
-- Source: GET https://api.accounting.sage.com/v3.1/bank_accounts?attributes=all
-- Sage Business Cloud Accounting (UK) — bank account records.
-- Full list synced on each run; upsert by (organization_id, platform_integration_id, sage_bank_account_id).
--
-- Pattern: mirrors sage_suppliers. Bank accounts are referenced by
-- sage_bank_transactions.bank_account_id (FK).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sage_bank_accounts (
  -- Primary key
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id         UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id                         UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Sage identifiers
  sage_bank_account_id            VARCHAR(500) NOT NULL,   -- Sage: id (UUID-style hex)
  displayed_as                    VARCHAR(500) NOT NULL,   -- Sage: displayed_as (e.g. "Current Account")

  -- Bank account details
  account_name                    VARCHAR(500),            -- Sage: account_name
  account_number                  VARCHAR(50),             -- Sage: account_number
  sort_code                       VARCHAR(20),             -- Sage: sort_code (UK)
  iban                            VARCHAR(50),             -- Sage: iban (international)
  bic_swift                       VARCHAR(20),             -- Sage: bic_swift
  bank_name                       VARCHAR(255),            -- Sage: bank_name

  -- Classification
  bank_account_type_id            VARCHAR(100),            -- Sage: bank_account_type.id (e.g. "current_assets")
  bank_account_type_label         VARCHAR(255),            -- Sage: bank_account_type.displayed_as
  ledger_account_id               VARCHAR(500),            -- Sage: ledger_account.id (FK to platform_integration_chart_of_accounts.coa_account_id)

  -- Balance
  opening_balance                 NUMERIC(15, 2),          -- Sage: opening_balance
  current_balance                 NUMERIC(15, 2),          -- Sage: current_balance

  -- Currency
  currency_id                     VARCHAR(10),             -- Sage: currency.id (e.g. "GBP")

  -- Flags
  is_default                      BOOLEAN DEFAULT FALSE,   -- Sage: is_default
  is_visible                      BOOLEAN DEFAULT TRUE,    -- Sage: is_visible
  is_active                       BOOLEAN DEFAULT TRUE,    -- Derived: !deleted

  -- Bank feed
  active_bank_feed                BOOLEAN DEFAULT FALSE,   -- Sage: active_bank_feed
  bank_feed_imported_from         VARCHAR(50),             -- Sage: bank_feed_imported_from

  -- Raw payload
  raw_data                        JSONB,

  -- Sync tracking
  source_created_at               TIMESTAMPTZ,             -- Sage: created_at
  source_updated_at               TIMESTAMPTZ,             -- Sage: updated_at
  last_synced_at                  TIMESTAMPTZ DEFAULT NOW(),

  -- Audit
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT sage_bank_accounts_unique
    UNIQUE (organization_id, platform_integration_id, sage_bank_account_id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sage_bank_accounts_org_id
  ON public.sage_bank_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_accounts_integration_id
  ON public.sage_bank_accounts(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_accounts_sage_id
  ON public.sage_bank_accounts(sage_bank_account_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_accounts_org_integration
  ON public.sage_bank_accounts(organization_id, platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_accounts_ledger_account_id
  ON public.sage_bank_accounts(ledger_account_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_accounts_is_active
  ON public.sage_bank_accounts(is_active);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.sage_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sage bank accounts in their org" ON public.sage_bank_accounts;
CREATE POLICY "Users can view sage bank accounts in their org"
ON public.sage_bank_accounts FOR SELECT
USING ( public.user_in_org(auth.uid(), organization_id) );

DROP POLICY IF EXISTS "Users can insert sage bank accounts in their org" ON public.sage_bank_accounts;
CREATE POLICY "Users can insert sage bank accounts in their org"
ON public.sage_bank_accounts FOR INSERT
WITH CHECK ( public.user_in_org(auth.uid(), organization_id) );

DROP POLICY IF EXISTS "Users can update sage bank accounts in their org" ON public.sage_bank_accounts;
CREATE POLICY "Users can update sage bank accounts in their org"
ON public.sage_bank_accounts FOR UPDATE
USING      ( public.user_in_org(auth.uid(), organization_id) )
WITH CHECK ( public.user_in_org(auth.uid(), organization_id) );

DROP POLICY IF EXISTS "Users can delete sage bank accounts in their org" ON public.sage_bank_accounts;
CREATE POLICY "Users can delete sage bank accounts in their org"
ON public.sage_bank_accounts FOR DELETE
USING ( public.user_in_org(auth.uid(), organization_id) );

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_sage_bank_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_bank_accounts_updated_at ON public.sage_bank_accounts;
CREATE TRIGGER update_sage_bank_accounts_updated_at
    BEFORE UPDATE ON public.sage_bank_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_sage_bank_accounts_updated_at();

COMMENT ON TABLE public.sage_bank_accounts IS 'Sage Business Cloud Accounting bank accounts (current/savings/credit-card), synced from /bank_accounts API.';
