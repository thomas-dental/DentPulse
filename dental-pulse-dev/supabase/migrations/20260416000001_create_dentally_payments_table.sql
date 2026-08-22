-- ============================================
-- Dentally Payments Table
-- Stores payment transactions synced from Dentally /v1/payments API
-- ============================================

CREATE TABLE IF NOT EXISTS public.dentally_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core fields
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    integration_id UUID REFERENCES public.integrations(id) ON DELETE SET NULL,

    -- Dentally payment fields
    dp_id BIGINT NOT NULL,                          -- Dentally payment id
    dp_account_id BIGINT,                           -- Dentally account_id
    dp_amount NUMERIC(15, 2),                       -- Payment amount
    dp_amount_unexplained NUMERIC(15, 2),           -- Unexplained amount
    dp_dated_on DATE,                               -- Payment date
    dp_deleted BOOLEAN DEFAULT FALSE,               -- Soft-deleted in Dentally
    dp_fully_explained BOOLEAN DEFAULT FALSE,       -- All amount allocated to invoices
    dp_method VARCHAR(100),                         -- Payment method (Debit Card, Credit Card, Cash, etc.)
    dp_patient_id BIGINT,                           -- Dentally patient_id
    dp_payment_plan_id BIGINT,                      -- Dentally payment_plan_id
    dp_practitioner_id BIGINT,                      -- Dentally practitioner_id
    dp_reference VARCHAR(255),                      -- Payment reference
    dp_site_id VARCHAR(255),                        -- Dentally site UUID
    dp_status VARCHAR(50),                          -- Payment status (paid, etc.)
    dp_transaction_number VARCHAR(255),             -- External transaction number
    dp_user_id BIGINT,                              -- Dentally user who recorded payment

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,

    -- Constraints
    CONSTRAINT unique_dentally_payment UNIQUE (organization_id, dp_id)
);

-- ============================================
-- Dentally Payment Explanations Table
-- Stores how payments are allocated to invoices
-- ============================================

CREATE TABLE IF NOT EXISTS public.dentally_payment_explanations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    payment_id UUID NOT NULL REFERENCES public.dentally_payments(id) ON DELETE CASCADE,

    -- Dentally explanation fields
    dpe_id BIGINT NOT NULL,                         -- Dentally explanation id
    dpe_amount NUMERIC(15, 2),                      -- Allocated amount
    dpe_comments TEXT,                              -- Comments
    dpe_invoice_id BIGINT,                          -- Dentally invoice_id
    dpe_invoice_reference VARCHAR(255),             -- Invoice reference
    dpe_payment_id BIGINT,                          -- Dentally payment_id (denormalized)
    dpe_payment_reference VARCHAR(255),             -- Payment reference
    dpe_user_id BIGINT,                             -- User who created explanation

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,

    -- Constraints
    CONSTRAINT unique_dentally_payment_explanation UNIQUE (organization_id, dpe_id)
);

-- ============================================
-- INDEXES
-- ============================================

-- dentally_payments indexes
CREATE INDEX IF NOT EXISTS idx_dentally_payments_org_id ON public.dentally_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_location_id ON public.dentally_payments(location_id);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_dp_id ON public.dentally_payments(dp_id);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_dp_patient_id ON public.dentally_payments(dp_patient_id);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_dp_dated_on ON public.dentally_payments(dp_dated_on);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_dp_method ON public.dentally_payments(dp_method);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_dp_status ON public.dentally_payments(dp_status);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_dp_practitioner_id ON public.dentally_payments(dp_practitioner_id);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_dp_payment_plan_id ON public.dentally_payments(dp_payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_org_dated ON public.dentally_payments(organization_id, dp_dated_on);
CREATE INDEX IF NOT EXISTS idx_dentally_payments_deleted_at ON public.dentally_payments(deleted_at) WHERE deleted_at IS NULL;

-- dentally_payment_explanations indexes
CREATE INDEX IF NOT EXISTS idx_dpe_org_id ON public.dentally_payment_explanations(organization_id);
CREATE INDEX IF NOT EXISTS idx_dpe_payment_id ON public.dentally_payment_explanations(payment_id);
CREATE INDEX IF NOT EXISTS idx_dpe_invoice_id ON public.dentally_payment_explanations(dpe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_dpe_deleted_at ON public.dentally_payment_explanations(deleted_at) WHERE deleted_at IS NULL;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.dentally_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view dentally payments in their org" ON public.dentally_payments;
CREATE POLICY "Users can view dentally payments in their org"
ON public.dentally_payments FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert dentally payments in their org" ON public.dentally_payments;
CREATE POLICY "Users can insert dentally payments in their org"
ON public.dentally_payments FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update dentally payments in their org" ON public.dentally_payments;
CREATE POLICY "Users can update dentally payments in their org"
ON public.dentally_payments FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete dentally payments in their org" ON public.dentally_payments;
CREATE POLICY "Users can delete dentally payments in their org"
ON public.dentally_payments FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

ALTER TABLE public.dentally_payment_explanations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view payment explanations in their org" ON public.dentally_payment_explanations;
CREATE POLICY "Users can view payment explanations in their org"
ON public.dentally_payment_explanations FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert payment explanations in their org" ON public.dentally_payment_explanations;
CREATE POLICY "Users can insert payment explanations in their org"
ON public.dentally_payment_explanations FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update payment explanations in their org" ON public.dentally_payment_explanations;
CREATE POLICY "Users can update payment explanations in their org"
ON public.dentally_payment_explanations FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete payment explanations in their org" ON public.dentally_payment_explanations;
CREATE POLICY "Users can delete payment explanations in their org"
ON public.dentally_payment_explanations FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- ============================================
-- SERVICE ROLE POLICIES (for backend sync)
-- ============================================

DROP POLICY IF EXISTS "Service role full access to dentally_payments" ON public.dentally_payments;
CREATE POLICY "Service role full access to dentally_payments"
ON public.dentally_payments FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to dentally_payment_explanations" ON public.dentally_payment_explanations;
CREATE POLICY "Service role full access to dentally_payment_explanations"
ON public.dentally_payment_explanations FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_dentally_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_dentally_payments_updated_at ON public.dentally_payments;
CREATE TRIGGER update_dentally_payments_updated_at
    BEFORE UPDATE ON public.dentally_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_dentally_payments_updated_at();

CREATE OR REPLACE FUNCTION update_dentally_payment_explanations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_dentally_payment_explanations_updated_at ON public.dentally_payment_explanations;
CREATE TRIGGER update_dentally_payment_explanations_updated_at
    BEFORE UPDATE ON public.dentally_payment_explanations
    FOR EACH ROW
    EXECUTE FUNCTION update_dentally_payment_explanations_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE public.dentally_payments IS 'Payment transactions synced from Dentally /v1/payments API';
COMMENT ON TABLE public.dentally_payment_explanations IS 'Payment allocation details — how each payment maps to invoices';
COMMENT ON COLUMN public.dentally_payments.dp_method IS 'Payment method: Debit Card, Credit Card, Cash, Cheque, BACS, etc.';
COMMENT ON COLUMN public.dentally_payments.dp_fully_explained IS 'True when the full payment amount is allocated to invoices';
