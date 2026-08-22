-- Create platform_payments table
CREATE TABLE IF NOT EXISTS public.platform_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    
    -- Platform Identifiers
    payment_id VARCHAR(500),
    invoice_id VARCHAR(500), -- Platform invoice/credit note/overpayment ID (string)
    
    -- Optional link to our accounts_payable_invoice when transaction_type = InvoicePayment
    accounts_payable_invoice_id UUID REFERENCES public.accounts_payable_invoice(id) ON DELETE SET NULL,
    
    -- Payment Details (NUMERIC to match current DB)
    payment_date DATE,
    amount NUMERIC(10, 2),
    reference VARCHAR(500),
    currency_rate NUMERIC(10, 4),
    
    -- Transaction Type (InvoicePayment, CreditNotePayment, OverPayment, etc.)
    transaction_type VARCHAR(100) NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_payments_unique_per_org UNIQUE (organization_id, platform_integration_organization_id, payment_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_payments_organization_id ON public.platform_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_platform_integration_id ON public.platform_payments(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_platform_integration_org_id ON public.platform_payments(platform_integration_organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_payment_id ON public.platform_payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_invoice_id ON public.platform_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_accounts_payable_invoice_id ON public.platform_payments(accounts_payable_invoice_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_transaction_type ON public.platform_payments(transaction_type);
CREATE INDEX IF NOT EXISTS idx_platform_payments_payment_date ON public.platform_payments(payment_date);

-- Enable RLS
ALTER TABLE public.platform_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view platform payments in their org" ON public.platform_payments;
CREATE POLICY "Users can view platform payments in their org"
ON public.platform_payments FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert platform payments in their org" ON public.platform_payments;
CREATE POLICY "Users can insert platform payments in their org"
ON public.platform_payments FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update platform payments in their org" ON public.platform_payments;
CREATE POLICY "Users can update platform payments in their org"
ON public.platform_payments FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete platform payments in their org" ON public.platform_payments;
CREATE POLICY "Users can delete platform payments in their org"
ON public.platform_payments FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Update trigger
CREATE OR REPLACE FUNCTION update_platform_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_payments_updated_at ON public.platform_payments;
CREATE TRIGGER update_platform_payments_updated_at
    BEFORE UPDATE ON public.platform_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_payments_updated_at();
