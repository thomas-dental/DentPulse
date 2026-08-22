-- ============================================
-- Iplicit Sales Invoices Table
-- ============================================

CREATE TABLE IF NOT EXISTS public.iplicit_sales_invoices (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ownership
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id     UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL,
    user_id                     UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Identifiers
    doc_no                      VARCHAR(100),
    doc_serie_id                UUID,
    trans_no                    INTEGER,
    doc_class                   VARCHAR(100),

    -- Customer
    customer_id                 UUID,
    customer_name               VARCHAR(255),

    -- Legal Entity
    legal_entity_id             UUID,
    legal_entity_code           VARCHAR(100),
    legal_entity_name           VARCHAR(255),

    -- Financial
    currency                    VARCHAR(10),
    base_currency               VARCHAR(10),
    amount                      NUMERIC(15, 5),
    currency_amount             NUMERIC(15, 5),
    outstanding_amount          NUMERIC(15, 5),
    outstanding_currency_amount NUMERIC(15, 5),
    invoice_count               INTEGER,

    -- Document details
    description                 TEXT,

    -- Dates
    invoice_date                DATE,
    last_printed                TIMESTAMP WITH TIME ZONE,   -- nullable, often null

    -- Sync tracking
    sync_status                 VARCHAR(50) DEFAULT 'synced',
    last_synced_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Audit
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_iplicit_sales_invoice UNIQUE (organization_id, platform_integration_id, doc_no)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_invoices_org         ON public.iplicit_sales_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_invoices_integration  ON public.iplicit_sales_invoices(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_invoices_customer_id  ON public.iplicit_sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_invoices_invoice_date ON public.iplicit_sales_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_iplicit_sales_invoices_legal_entity ON public.iplicit_sales_invoices(legal_entity_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_iplicit_sales_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_iplicit_sales_invoices_updated_at ON public.iplicit_sales_invoices;
CREATE TRIGGER update_iplicit_sales_invoices_updated_at
    BEFORE UPDATE ON public.iplicit_sales_invoices
    FOR EACH ROW EXECUTE FUNCTION update_iplicit_sales_invoices_updated_at();

-- RLS
ALTER TABLE public.iplicit_sales_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view iplicit sales invoices in their org" ON public.iplicit_sales_invoices;
CREATE POLICY "Users can view iplicit sales invoices in their org"
ON public.iplicit_sales_invoices FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert iplicit sales invoices in their org" ON public.iplicit_sales_invoices;
CREATE POLICY "Users can insert iplicit sales invoices in their org"
ON public.iplicit_sales_invoices FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update iplicit sales invoices in their org" ON public.iplicit_sales_invoices;
CREATE POLICY "Users can update iplicit sales invoices in their org"
ON public.iplicit_sales_invoices FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete iplicit sales invoices in their org" ON public.iplicit_sales_invoices;
CREATE POLICY "Users can delete iplicit sales invoices in their org"
ON public.iplicit_sales_invoices FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));
