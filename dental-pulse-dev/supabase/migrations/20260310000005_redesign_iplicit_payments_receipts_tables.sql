-- ============================================
-- Redesign iplicit_purchase_invoice_payments and iplicit_sales_receipts
-- to match actual REST API response from /api/Payment and /api/Receipt
-- Both endpoints return the same flat camelCase structure.
-- ============================================

-- ── Purchase Invoice Payments ──────────────────────────────────────────────

DROP TABLE IF EXISTS public.iplicit_purchase_invoice_payments CASCADE;

CREATE TABLE public.iplicit_purchase_invoice_payments (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ownership
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id     UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL,
    user_id                     UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Iplicit document identity
    payment_id                  UUID,               -- id (from API)
    doc_class                   VARCHAR(100),        -- "Payment"
    doc_type_id                 UUID,
    doc_no                      VARCHAR(100),        -- PAY000135
    doc_serie_id                UUID,
    doc_date                    DATE,

    -- Contact / Entity
    contact_account_id          UUID,
    contact_account_description VARCHAR(255),
    legal_entity_id             UUID,
    period_id                   UUID,

    -- Amounts (base currency)
    net_amount                  NUMERIC(15, 5),
    tax_amount                  NUMERIC(15, 5),
    gross_amount                NUMERIC(15, 5),

    -- Currency
    base_currency               VARCHAR(10),
    currency                    VARCHAR(10),
    currency_rate               NUMERIC(15, 10),

    -- Amounts (transaction currency)
    net_currency_amount         NUMERIC(15, 5),
    tax_currency_amount         NUMERIC(15, 5),
    gross_currency_amount       NUMERIC(15, 5),

    -- Tax
    tax_authority_id            UUID,
    tax_date                    DATE,
    is_deferred_tax             BOOLEAN DEFAULT FALSE,

    -- Outstanding
    outstanding_amount          NUMERIC(15, 5),
    outstanding_currency_amount NUMERIC(15, 5),

    -- Bank
    payment_method_id           UUID,
    bank_account_id             UUID,
    bank_currency               VARCHAR(10),
    bank_currency_amount        NUMERIC(15, 5),
    bank_currency_rate          NUMERIC(15, 10),

    -- Account
    account_id                  UUID,

    -- Status
    status                      INTEGER,            -- e.g. 160

    -- Transaction info
    is_net_entry                BOOLEAN DEFAULT FALSE,
    trans_time                  TIMESTAMP WITH TIME ZONE,
    trans_date                  DATE,
    trans_no                    INTEGER,

    -- Description
    description                 TEXT,

    -- Audit (from API)
    created_date                TIMESTAMP WITH TIME ZONE,
    created_by                  VARCHAR(100),
    last_modified               TIMESTAMP WITH TIME ZONE,
    last_modified_by            VARCHAR(100),
    has_notes                   BOOLEAN DEFAULT FALSE,
    has_attachments             BOOLEAN DEFAULT FALSE,
    stock_date                  TIMESTAMP WITH TIME ZONE,

    -- Sync tracking
    sync_status                 VARCHAR(50) DEFAULT 'synced',
    last_synced_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Row audit
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_iplicit_purchase_invoice_payment UNIQUE (organization_id, platform_integration_id, payment_id)
);

CREATE INDEX IF NOT EXISTS idx_iplicit_pip_org            ON public.iplicit_purchase_invoice_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_integration    ON public.iplicit_purchase_invoice_payments(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_payment_id     ON public.iplicit_purchase_invoice_payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_contact        ON public.iplicit_purchase_invoice_payments(contact_account_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_doc_date       ON public.iplicit_purchase_invoice_payments(doc_date);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_legal_entity   ON public.iplicit_purchase_invoice_payments(legal_entity_id);

CREATE OR REPLACE FUNCTION update_iplicit_purchase_invoice_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_iplicit_purchase_invoice_payments_updated_at ON public.iplicit_purchase_invoice_payments;
CREATE TRIGGER update_iplicit_purchase_invoice_payments_updated_at
    BEFORE UPDATE ON public.iplicit_purchase_invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_iplicit_purchase_invoice_payments_updated_at();

ALTER TABLE public.iplicit_purchase_invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view iplicit purchase invoice payments in their org" ON public.iplicit_purchase_invoice_payments;
CREATE POLICY "Users can view iplicit purchase invoice payments in their org"
ON public.iplicit_purchase_invoice_payments FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert iplicit purchase invoice payments in their org" ON public.iplicit_purchase_invoice_payments;
CREATE POLICY "Users can insert iplicit purchase invoice payments in their org"
ON public.iplicit_purchase_invoice_payments FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update iplicit purchase invoice payments in their org" ON public.iplicit_purchase_invoice_payments;
CREATE POLICY "Users can update iplicit purchase invoice payments in their org"
ON public.iplicit_purchase_invoice_payments FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete iplicit purchase invoice payments in their org" ON public.iplicit_purchase_invoice_payments;
CREATE POLICY "Users can delete iplicit purchase invoice payments in their org"
ON public.iplicit_purchase_invoice_payments FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));


-- ── Sales Receipts ─────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.iplicit_sales_receipts CASCADE;

CREATE TABLE public.iplicit_sales_receipts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ownership
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id     UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL,
    user_id                     UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Iplicit document identity
    receipt_id                  UUID,               -- id (from API)
    doc_class                   VARCHAR(100),        -- "Receipt"
    doc_type_id                 UUID,
    doc_no                      VARCHAR(100),        -- REC000077
    doc_serie_id                UUID,
    doc_date                    DATE,

    -- Contact / Entity
    contact_account_id          UUID,
    contact_account_description VARCHAR(255),
    legal_entity_id             UUID,
    period_id                   UUID,

    -- Amounts (base currency)
    net_amount                  NUMERIC(15, 5),
    tax_amount                  NUMERIC(15, 5),
    gross_amount                NUMERIC(15, 5),

    -- Currency
    base_currency               VARCHAR(10),
    currency                    VARCHAR(10),
    currency_rate               NUMERIC(15, 10),

    -- Amounts (transaction currency)
    net_currency_amount         NUMERIC(15, 5),
    tax_currency_amount         NUMERIC(15, 5),
    gross_currency_amount       NUMERIC(15, 5),

    -- Tax
    tax_authority_id            UUID,
    tax_date                    DATE,
    is_deferred_tax             BOOLEAN DEFAULT FALSE,

    -- Outstanding
    outstanding_amount          NUMERIC(15, 5),
    outstanding_currency_amount NUMERIC(15, 5),

    -- Bank
    payment_method_id           UUID,
    bank_account_id             UUID,
    bank_currency               VARCHAR(10),
    bank_currency_amount        NUMERIC(15, 5),
    bank_currency_rate          NUMERIC(15, 10),

    -- Account
    account_id                  UUID,

    -- Status
    status                      INTEGER,            -- e.g. 160

    -- Transaction info
    is_net_entry                BOOLEAN DEFAULT FALSE,
    trans_time                  TIMESTAMP WITH TIME ZONE,
    trans_date                  DATE,
    trans_no                    INTEGER,

    -- Description
    description                 TEXT,

    -- Audit (from API)
    created_date                TIMESTAMP WITH TIME ZONE,
    created_by                  VARCHAR(100),
    last_modified               TIMESTAMP WITH TIME ZONE,
    last_modified_by            VARCHAR(100),
    has_notes                   BOOLEAN DEFAULT FALSE,
    has_attachments             BOOLEAN DEFAULT FALSE,
    stock_date                  TIMESTAMP WITH TIME ZONE,

    -- Sync tracking
    sync_status                 VARCHAR(50) DEFAULT 'synced',
    last_synced_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Row audit
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_iplicit_sales_receipt UNIQUE (organization_id, platform_integration_id, receipt_id)
);

CREATE INDEX IF NOT EXISTS idx_iplicit_sr_org           ON public.iplicit_sales_receipts(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sr_integration   ON public.iplicit_sales_receipts(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sr_receipt_id    ON public.iplicit_sales_receipts(receipt_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sr_contact       ON public.iplicit_sales_receipts(contact_account_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_sr_doc_date      ON public.iplicit_sales_receipts(doc_date);
CREATE INDEX IF NOT EXISTS idx_iplicit_sr_legal_entity  ON public.iplicit_sales_receipts(legal_entity_id);

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
