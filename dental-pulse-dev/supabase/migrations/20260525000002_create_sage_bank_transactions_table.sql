-- ============================================================
-- sage_bank_transactions
-- Source: GET https://api.accounting.sage.com/v3.1/bank_transactions?attributes=all
-- Sage Business Cloud Accounting (UK) — bank transactions (money in/out).
-- Upsert by (organization_id, platform_integration_id, sage_bank_transaction_id).
-- FK to sage_bank_accounts via bank_account_id (Sage GUID, NOT a Supabase UUID).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sage_bank_transactions (
  -- Primary key
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id         UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id                         UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Sage identifiers
  sage_bank_transaction_id        VARCHAR(500) NOT NULL,   -- Sage: id
  displayed_as                    VARCHAR(500),            -- Sage: displayed_as

  -- Bank account link (Sage ID, joins to sage_bank_accounts.sage_bank_account_id)
  bank_account_id                 VARCHAR(500),            -- Sage: bank_account.id
  bank_account_name               VARCHAR(500),            -- Sage: bank_account.displayed_as

  -- Transaction details
  transaction_type_id             VARCHAR(100),            -- Sage: transaction_type.id (e.g. "money_in", "money_out", "purchase_payment")
  transaction_type_label          VARCHAR(255),            -- Sage: transaction_type.displayed_as
  transaction_date                DATE,                    -- Sage: date

  -- Contact link (optional — Sage GUID matching sage_suppliers.sage_contact_id)
  contact_id                      VARCHAR(500),            -- Sage: contact.id
  contact_name                    VARCHAR(500),            -- Sage: contact.displayed_as

  -- Reference / description
  reference                       VARCHAR(255),            -- Sage: reference
  description                     TEXT,                    -- Sage: description

  -- Amounts
  total_amount                    NUMERIC(15, 2),          -- Sage: total_amount
  net_amount                      NUMERIC(15, 2),          -- Sage: net_amount
  tax_amount                      NUMERIC(15, 2),          -- Sage: tax_amount

  -- Status + currency
  status_id                       VARCHAR(100),            -- Sage: status.id
  status_label                    VARCHAR(255),            -- Sage: status.displayed_as
  currency_id                     VARCHAR(10),             -- Sage: currency.id (e.g. "GBP")
  exchange_rate                   NUMERIC(15, 6),          -- Sage: exchange_rate

  -- Reconciliation
  is_reconciled                   BOOLEAN DEFAULT FALSE,   -- Sage: is_reconciled (when present)

  -- Raw payload
  raw_data                        JSONB,

  -- Sync tracking
  source_created_at               TIMESTAMPTZ,             -- Sage: created_at
  source_updated_at               TIMESTAMPTZ,             -- Sage: updated_at
  last_synced_at                  TIMESTAMPTZ DEFAULT NOW(),

  -- Audit
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT sage_bank_transactions_unique
    UNIQUE (organization_id, platform_integration_id, sage_bank_transaction_id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sage_bank_txn_org_id
  ON public.sage_bank_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_txn_integration_id
  ON public.sage_bank_transactions(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_txn_sage_id
  ON public.sage_bank_transactions(sage_bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_txn_org_integration
  ON public.sage_bank_transactions(organization_id, platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_txn_bank_account
  ON public.sage_bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_txn_contact
  ON public.sage_bank_transactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_sage_bank_txn_date
  ON public.sage_bank_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_sage_bank_txn_type
  ON public.sage_bank_transactions(transaction_type_id);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.sage_bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sage bank txns in their org" ON public.sage_bank_transactions;
CREATE POLICY "Users can view sage bank txns in their org"
ON public.sage_bank_transactions FOR SELECT
USING ( public.user_in_org(auth.uid(), organization_id) );

DROP POLICY IF EXISTS "Users can insert sage bank txns in their org" ON public.sage_bank_transactions;
CREATE POLICY "Users can insert sage bank txns in their org"
ON public.sage_bank_transactions FOR INSERT
WITH CHECK ( public.user_in_org(auth.uid(), organization_id) );

DROP POLICY IF EXISTS "Users can update sage bank txns in their org" ON public.sage_bank_transactions;
CREATE POLICY "Users can update sage bank txns in their org"
ON public.sage_bank_transactions FOR UPDATE
USING      ( public.user_in_org(auth.uid(), organization_id) )
WITH CHECK ( public.user_in_org(auth.uid(), organization_id) );

DROP POLICY IF EXISTS "Users can delete sage bank txns in their org" ON public.sage_bank_transactions;
CREATE POLICY "Users can delete sage bank txns in their org"
ON public.sage_bank_transactions FOR DELETE
USING ( public.user_in_org(auth.uid(), organization_id) );

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_sage_bank_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sage_bank_transactions_updated_at ON public.sage_bank_transactions;
CREATE TRIGGER update_sage_bank_transactions_updated_at
    BEFORE UPDATE ON public.sage_bank_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_sage_bank_transactions_updated_at();

COMMENT ON TABLE public.sage_bank_transactions IS 'Sage Business Cloud Accounting bank transactions (money in/out, payments, transfers), synced from /bank_transactions API.';
