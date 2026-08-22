-- ============================================
-- Iplicit Purchase Invoice Payments Table
-- Links purchase invoices to their payments (allocation records)
-- ============================================

CREATE TABLE IF NOT EXISTS public.iplicit_purchase_invoice_payments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ownership
    organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL,
    user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Purchase Invoice (PIN) side
    pin_id                  UUID,               -- PinId
    pin_doc_no              VARCHAR(100),        -- PinDocNo (PIN0000050)
    pin_doc_date            DATE,               -- PinDocDate
    pin_period_id           UUID,               -- PinPeriodId
    pin_attribute_id        UUID,               -- PinAttributeId
    doc_class               VARCHAR(100),        -- DocClass (PurchaseInvoice)
    doc_type_id             UUID,               -- DocTypeId

    -- Payment (PAY) side
    pay_id                  UUID,               -- PayId
    pay_doc_no              VARCHAR(100),        -- PayDocNo (PAY000007)
    pay_doc_date            DATE,               -- PayDocDate
    pay_period_id           UUID,               -- PayPeriodId
    pay_attribute_id        UUID,               -- PayAttributeId
    pay_doc_class           VARCHAR(100),        -- PayDocClass (Payment)

    -- Supplier / Contact
    contact_account_id      UUID,               -- ContactAccountId
    bank_account_id         UUID,               -- BankAccountId

    -- Legal Entity / Project
    legal_entity_id         UUID,               -- LegalEntityId
    project_id              UUID,               -- ProjectId (nullable)

    -- Payment terms / method
    payment_method_id       UUID,               -- PaymentMethodId (nullable)
    payment_terms_id        UUID,               -- PaymentTermsId

    -- Financial
    currency                VARCHAR(10),        -- Currency
    base_currency           VARCHAR(10),        -- BaseCurrency
    currency_rate           NUMERIC(15, 10),    -- CurrencyRate

    gross_amount            NUMERIC(15, 5),     -- GrossAmount
    gross_currency_amount   NUMERIC(15, 5),     -- GrossCurrencyAmount
    net_amount              NUMERIC(15, 5),     -- NetAmount
    net_currency_amount     NUMERIC(15, 5),     -- NetCurrencyAmount
    tax_amount              NUMERIC(15, 5),     -- TaxAmount
    tax_currency_amount     NUMERIC(15, 5),     -- TaxCurrencyAmount

    -- Allocation
    alloc_amount            NUMERIC(15, 5),     -- AllocAmount
    alloc_currency          VARCHAR(10),        -- AllocCurrency
    alloc_currency_amount   NUMERIC(15, 5),     -- AllocCurrencyAmount

    -- Other
    description             TEXT,               -- Description
    status                  INTEGER,            -- Status (e.g. 160)

    -- Sync tracking
    sync_status             VARCHAR(50) DEFAULT 'synced',
    last_synced_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Audit
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_iplicit_purchase_invoice_payment UNIQUE (organization_id, platform_integration_id, pin_id, pay_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_org             ON public.iplicit_purchase_invoice_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_integration     ON public.iplicit_purchase_invoice_payments(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_pin_id          ON public.iplicit_purchase_invoice_payments(pin_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_pay_id          ON public.iplicit_purchase_invoice_payments(pay_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_contact         ON public.iplicit_purchase_invoice_payments(contact_account_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_pay_doc_date    ON public.iplicit_purchase_invoice_payments(pay_doc_date);
CREATE INDEX IF NOT EXISTS idx_iplicit_pip_legal_entity    ON public.iplicit_purchase_invoice_payments(legal_entity_id);

-- Updated at trigger
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

-- RLS
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
