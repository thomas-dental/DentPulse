-- Create iplicit_bank_transactions table
CREATE TABLE IF NOT EXISTS public.iplicit_bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    
    -- iplicit Identifiers
    external_id VARCHAR(500) NOT NULL, -- BankTransaction ID from iplicit
    bank_account_ref VARCHAR(500), -- Bank account reference/code
    bank_account_name VARCHAR(500),
    
    -- Transaction Details
    transaction_date DATE,
    reference VARCHAR(500),
    type VARCHAR(100), -- payment/receipt
    description TEXT,
    narrative TEXT,
    
    -- Financial Details (NUMERIC to match other tables)
    amount NUMERIC(10, 2) DEFAULT 0,
    currency_code VARCHAR(10) DEFAULT 'GBP',
    
    -- Counterparty details
    counterparty_name VARCHAR(500),
    counterparty_ref VARCHAR(500),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT iplicit_bank_transactions_unique_per_conn UNIQUE (connection_id, external_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_bank_transactions_organization_id ON public.iplicit_bank_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_bank_transactions_connection_id ON public.iplicit_bank_transactions(connection_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_bank_transactions_external_id ON public.iplicit_bank_transactions(external_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_bank_transactions_bank_account_ref ON public.iplicit_bank_transactions(bank_account_ref);
CREATE INDEX IF NOT EXISTS idx_iplicit_bank_transactions_transaction_date ON public.iplicit_bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_iplicit_bank_transactions_type ON public.iplicit_bank_transactions(type);

-- Enable RLS
ALTER TABLE public.iplicit_bank_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view iplicit bank transactions in their org" ON public.iplicit_bank_transactions;
CREATE POLICY "Users can view iplicit bank transactions in their org"
ON public.iplicit_bank_transactions FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert iplicit bank transactions in their org" ON public.iplicit_bank_transactions;
CREATE POLICY "Users can insert iplicit bank transactions in their org"
ON public.iplicit_bank_transactions FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update iplicit bank transactions in their org" ON public.iplicit_bank_transactions;
CREATE POLICY "Users can update iplicit bank transactions in their org"
ON public.iplicit_bank_transactions FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete iplicit bank transactions in their org" ON public.iplicit_bank_transactions;
CREATE POLICY "Users can delete iplicit bank transactions in their org"
ON public.iplicit_bank_transactions FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Update trigger
CREATE OR REPLACE FUNCTION update_iplicit_bank_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_iplicit_bank_transactions_updated_at ON public.iplicit_bank_transactions;
CREATE TRIGGER update_iplicit_bank_transactions_updated_at
    BEFORE UPDATE ON public.iplicit_bank_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_iplicit_bank_transactions_updated_at();

COMMENT ON TABLE public.iplicit_bank_transactions IS 'Bank transactions synced from iplicit API (/api/BankTransaction). Source for Transactions to Review (cashflow statement report) when org uses iplicit.';
COMMENT ON COLUMN public.iplicit_bank_transactions.external_id IS 'iplicit BankTransaction ID';
COMMENT ON COLUMN public.iplicit_bank_transactions.type IS 'Transaction type: payment or receipt';
