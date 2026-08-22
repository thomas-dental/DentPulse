-- ============================================
-- Iplicit Sales Receipts Table
-- ============================================

CREATE TABLE IF NOT EXISTS public.iplicit_sales_receipts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ownership
    organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL,
    user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Identifiers
    receipt_id              UUID,               -- ReceiptId / DocId
    doc_id                  UUID,               -- DocId
    doc_no                  VARCHAR(100),        -- REC000003
    doc_type_id             UUID,               -- DocTypeId

    -- Customer
    customer_id             UUID,               -- CustomerId

    -- Legal Entity / Period
    legal_entity_id         UUID,               -- LegalEntityId
    financial_year_id       UUID,               -- FinancialYearId
    period_id               UUID,               -- PeriodId

    -- Bank
    bank_account_id         UUID,               -- BankAccountId
    bank_amount             NUMERIC(15, 5),     -- BankAmount
    bank_currency           VARCHAR(10),        -- BankCurrency

    -- Financial
    currency                VARCHAR(10),        -- Currency
    base_currency           VARCHAR(10),        -- BaseCurrency

    -- Document details
    description             TEXT,               -- Description
    attribute_id            UUID,               -- AttributeId
    status                  INTEGER,            -- Status (e.g. 160)

    -- Dates
    receipt_date            DATE,               -- ReceiptDate

    -- Sync tracking
    sync_status             VARCHAR(50) DEFAULT 'synced',
    last_synced_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Audit
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_iplicit_sales_receipt UNIQUE (organization_id, platform_integration_id, receipt_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_receipts_org          ON public.iplicit_sales_receipts(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_receipts_integration   ON public.iplicit_sales_receipts(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_receipts_customer_id   ON public.iplicit_sales_receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_receipts_receipt_date  ON public.iplicit_sales_receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_receipts_legal_entity  ON public.iplicit_sales_receipts(legal_entity_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_iplicit_sales_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_iplicit_sales_receipts_updated_at ON public.iplicit_sales_receipts;
CREATE TRIGGER update_iplicit_sales_receipts_updated_at
    BEFORE UPDATE ON public.iplicit_sales_receipts
    FOR EACH ROW EXECUTE FUNCTION update_iplicit_sales_receipts_updated_at();

-- RLS
ALTER TABLE public.iplicit_sales_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view iplicit sales receipts in their org" ON public.iplicit_sales_receipts;
CREATE POLICY "Users can view iplicit sales receipts in their org"
ON public.iplicit_sales_receipts FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert iplicit sales receipts in their org" ON public.iplicit_sales_receipts;
CREATE POLICY "Users can insert iplicit sales receipts in their org"
ON public.iplicit_sales_receipts FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update iplicit sales receipts in their org" ON public.iplicit_sales_receipts;
CREATE POLICY "Users can update iplicit sales receipts in their org"
ON public.iplicit_sales_receipts FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete iplicit sales receipts in their org" ON public.iplicit_sales_receipts;
CREATE POLICY "Users can delete iplicit sales receipts in their org"
ON public.iplicit_sales_receipts FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));
