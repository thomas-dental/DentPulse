-- Create platform_bank_transactions table
CREATE TABLE IF NOT EXISTS public.platform_bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    
    -- Xero Identifiers
    bank_transaction_id VARCHAR(500),
    bank_account_id VARCHAR(500),
    bank_account_name VARCHAR(500),
    
    -- Transaction Details
    type VARCHAR(100),
    is_reconciled BOOLEAN DEFAULT false,
    has_attachments BOOLEAN DEFAULT false,
    contact_id VARCHAR(500),
    contact_name VARCHAR(500),
    transaction_date DATE,
    status VARCHAR(100),
    line_amount_types VARCHAR(50),
    
    -- Financial Details (NUMERIC to match accounts_payable_invoice)
    sub_total NUMERIC(10, 2) DEFAULT 0,
    total_tax NUMERIC(10, 2) DEFAULT 0,
    total NUMERIC(10, 2) DEFAULT 0,
    currency_code VARCHAR(10),
    
    -- Timestamps
    updated_date_utc TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_bank_transactions_unique_per_org UNIQUE (organization_id, platform_integration_organization_id, bank_transaction_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_bank_transactions_organization_id ON public.platform_bank_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_bank_transactions_platform_integration_id ON public.platform_bank_transactions(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_bank_transactions_platform_integration_org_id ON public.platform_bank_transactions(platform_integration_organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_bank_transactions_bank_transaction_id ON public.platform_bank_transactions(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_platform_bank_transactions_bank_account_id ON public.platform_bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_platform_bank_transactions_transaction_date ON public.platform_bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_platform_bank_transactions_updated_date_utc ON public.platform_bank_transactions(updated_date_utc);

-- Enable RLS
ALTER TABLE public.platform_bank_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view platform bank transactions in their org" ON public.platform_bank_transactions;
CREATE POLICY "Users can view platform bank transactions in their org"
ON public.platform_bank_transactions FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert platform bank transactions in their org" ON public.platform_bank_transactions;
CREATE POLICY "Users can insert platform bank transactions in their org"
ON public.platform_bank_transactions FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update platform bank transactions in their org" ON public.platform_bank_transactions;
CREATE POLICY "Users can update platform bank transactions in their org"
ON public.platform_bank_transactions FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete platform bank transactions in their org" ON public.platform_bank_transactions;
CREATE POLICY "Users can delete platform bank transactions in their org"
ON public.platform_bank_transactions FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Update trigger
CREATE OR REPLACE FUNCTION update_platform_bank_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_bank_transactions_updated_at ON public.platform_bank_transactions;
CREATE TRIGGER update_platform_bank_transactions_updated_at
    BEFORE UPDATE ON public.platform_bank_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_bank_transactions_updated_at();
