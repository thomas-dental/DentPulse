-- ============================================
-- Iplicit Receipt Allocations
-- Fetched via GET /api/Receipt/{id} → allocations[]
-- receipt_id = Iplicit API id (same value as iplicit_sales_receipts.receipt_id)
-- ============================================

CREATE TABLE public.iplicit_receipt_allocations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ownership
    organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL,
    user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Parent receipt: Iplicit API id from /api/Receipt (= iplicit_sales_receipts.receipt_id)
    receipt_id              UUID NOT NULL,

    -- Allocation fields from allocations[]
    allocation_id           UUID NOT NULL,          -- allocations[].id
    doc_id                  UUID,                   -- allocations[].docId
    doc_no                  VARCHAR(100),            -- allocations[].docNo  e.g. "SIN000096"
    alloc_amount_currency   NUMERIC(15, 5),         -- allocAmountCurrency
    alloc_amount_base       NUMERIC(15, 5),         -- allocAmountBase
    alloc_currency_rate     NUMERIC(15, 10),        -- allocCurrencyRate

    -- Sync tracking
    sync_status             VARCHAR(50) DEFAULT 'synced',
    last_synced_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_iplicit_receipt_allocation
        UNIQUE (organization_id, platform_integration_id, allocation_id)
);

CREATE INDEX IF NOT EXISTS idx_iplicit_ra_org         ON public.iplicit_receipt_allocations(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_ra_integration ON public.iplicit_receipt_allocations(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_ra_receipt_id  ON public.iplicit_receipt_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_ra_doc_id      ON public.iplicit_receipt_allocations(doc_id);

CREATE OR REPLACE FUNCTION update_iplicit_receipt_allocations_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iplicit_receipt_allocations_updated_at ON public.iplicit_receipt_allocations;
CREATE TRIGGER trg_iplicit_receipt_allocations_updated_at
    BEFORE UPDATE ON public.iplicit_receipt_allocations
    FOR EACH ROW EXECUTE FUNCTION update_iplicit_receipt_allocations_updated_at();

ALTER TABLE public.iplicit_receipt_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view iplicit receipt allocations in their org" ON public.iplicit_receipt_allocations;
CREATE POLICY "Users can view iplicit receipt allocations in their org"
ON public.iplicit_receipt_allocations FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert iplicit receipt allocations in their org" ON public.iplicit_receipt_allocations;
CREATE POLICY "Users can insert iplicit receipt allocations in their org"
ON public.iplicit_receipt_allocations FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update iplicit receipt allocations in their org" ON public.iplicit_receipt_allocations;
CREATE POLICY "Users can update iplicit receipt allocations in their org"
ON public.iplicit_receipt_allocations FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete iplicit receipt allocations in their org" ON public.iplicit_receipt_allocations;
CREATE POLICY "Users can delete iplicit receipt allocations in their org"
ON public.iplicit_receipt_allocations FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));


-- ============================================
-- Iplicit Payment Allocations
-- Fetched via GET /api/Payment/{id} → allocations[]
-- payment_id = Iplicit API id (same value as iplicit_payments.payment_id)
-- ============================================

CREATE TABLE public.iplicit_payment_allocations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ownership
    organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL,
    user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Parent payment: Iplicit API id from /api/Payment (= iplicit_payments.payment_id)
    payment_id              UUID NOT NULL,

    -- Allocation fields from allocations[]
    allocation_id           UUID NOT NULL,          -- allocations[].id
    doc_id                  UUID,                   -- allocations[].docId
    doc_no                  VARCHAR(100),            -- allocations[].docNo  e.g. "PIN0000265"
    alloc_amount_currency   NUMERIC(15, 5),         -- allocAmountCurrency
    alloc_amount_base       NUMERIC(15, 5),         -- allocAmountBase
    alloc_currency_rate     NUMERIC(15, 10),        -- allocCurrencyRate

    -- Sync tracking
    sync_status             VARCHAR(50) DEFAULT 'synced',
    last_synced_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_iplicit_payment_allocation
        UNIQUE (organization_id, platform_integration_id, allocation_id)
);

CREATE INDEX IF NOT EXISTS idx_iplicit_pa_org         ON public.iplicit_payment_allocations(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pa_integration ON public.iplicit_payment_allocations(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pa_payment_id  ON public.iplicit_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_pa_doc_id      ON public.iplicit_payment_allocations(doc_id);

CREATE OR REPLACE FUNCTION update_iplicit_payment_allocations_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iplicit_payment_allocations_updated_at ON public.iplicit_payment_allocations;
CREATE TRIGGER trg_iplicit_payment_allocations_updated_at
    BEFORE UPDATE ON public.iplicit_payment_allocations
    FOR EACH ROW EXECUTE FUNCTION update_iplicit_payment_allocations_updated_at();

ALTER TABLE public.iplicit_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view iplicit payment allocations in their org" ON public.iplicit_payment_allocations;
CREATE POLICY "Users can view iplicit payment allocations in their org"
ON public.iplicit_payment_allocations FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert iplicit payment allocations in their org" ON public.iplicit_payment_allocations;
CREATE POLICY "Users can insert iplicit payment allocations in their org"
ON public.iplicit_payment_allocations FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update iplicit payment allocations in their org" ON public.iplicit_payment_allocations;
CREATE POLICY "Users can update iplicit payment allocations in their org"
ON public.iplicit_payment_allocations FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete iplicit payment allocations in their org" ON public.iplicit_payment_allocations;
CREATE POLICY "Users can delete iplicit payment allocations in their org"
ON public.iplicit_payment_allocations FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));
