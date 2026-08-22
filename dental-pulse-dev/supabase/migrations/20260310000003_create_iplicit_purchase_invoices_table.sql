-- ============================================
-- Iplicit Purchase Invoices Table
-- ============================================

CREATE TABLE IF NOT EXISTS public.iplicit_purchase_invoices (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ownership
    organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL,
    user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Document identifiers
    doc_id                  UUID,               -- DocId
    doc_no                  VARCHAR(100),        -- PIN0000050
    doc_type_id             UUID,               -- DocTypeId
    gl_id                   UUID,               -- GlId
    line_no                 INTEGER,            -- LineNo (line-level key)

    -- Invoice reference
    invoice_no              VARCHAR(100),        -- InvoiceNo
    invoice_date            DATE,               -- InvoiceDate

    -- Supplier
    supplier_id             UUID,               -- SupplierId
    their_ref               VARCHAR(255),        -- TheirRef (nullable)

    -- Account / COA
    account_id              UUID,               -- AccountId
    coa_group_id            UUID,               -- CoaGroupId
    tax_code_id             UUID,               -- TaxCodeId
    product_id              UUID,               -- ProductId (nullable)

    -- Legal Entity / Period
    legal_entity_id         UUID,               -- LegalEntityId
    financial_year_id       UUID,               -- FinancialYearId
    period_id               UUID,               -- PeriodId
    period_date_from        DATE,               -- PeriodDateFrom

    -- Financial
    currency                VARCHAR(10),        -- Currency
    base_currency           VARCHAR(10),        -- BaseCurrency
    amount                  NUMERIC(15, 5),     -- Amount
    currency_amount         NUMERIC(15, 5),     -- CurrencyAmount

    -- Cost allocation
    cost_centre             VARCHAR(255),        -- CostCentre (nullable)
    department              VARCHAR(255),        -- Department (nullable)
    attribute_id            UUID,               -- AttributeId

    -- Description
    description             TEXT,               -- Description

    -- Sync tracking
    sync_status             VARCHAR(50) DEFAULT 'synced',
    last_synced_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Audit
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_iplicit_purchase_invoice UNIQUE (organization_id, platform_integration_id, doc_id, line_no)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_purchase_invoices_org          ON public.iplicit_purchase_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_purchase_invoices_integration   ON public.iplicit_purchase_invoices(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_purchase_invoices_supplier_id   ON public.iplicit_purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_purchase_invoices_invoice_date  ON public.iplicit_purchase_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_iplicit_purchase_invoices_legal_entity  ON public.iplicit_purchase_invoices(legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_purchase_invoices_doc_no        ON public.iplicit_purchase_invoices(doc_no);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_iplicit_purchase_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_iplicit_purchase_invoices_updated_at ON public.iplicit_purchase_invoices;
CREATE TRIGGER update_iplicit_purchase_invoices_updated_at
    BEFORE UPDATE ON public.iplicit_purchase_invoices
    FOR EACH ROW EXECUTE FUNCTION update_iplicit_purchase_invoices_updated_at();

-- RLS
ALTER TABLE public.iplicit_purchase_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view iplicit purchase invoices in their org" ON public.iplicit_purchase_invoices;
CREATE POLICY "Users can view iplicit purchase invoices in their org"
ON public.iplicit_purchase_invoices FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert iplicit purchase invoices in their org" ON public.iplicit_purchase_invoices;
CREATE POLICY "Users can insert iplicit purchase invoices in their org"
ON public.iplicit_purchase_invoices FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update iplicit purchase invoices in their org" ON public.iplicit_purchase_invoices;
CREATE POLICY "Users can update iplicit purchase invoices in their org"
ON public.iplicit_purchase_invoices FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete iplicit purchase invoices in their org" ON public.iplicit_purchase_invoices;
CREATE POLICY "Users can delete iplicit purchase invoices in their org"
ON public.iplicit_purchase_invoices FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));
