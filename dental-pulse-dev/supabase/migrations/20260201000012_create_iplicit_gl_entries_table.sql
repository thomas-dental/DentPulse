-- Create iplicit_gl_entries table for General Ledger data from Documents/Payments/Receipts
CREATE TABLE IF NOT EXISTS public.iplicit_gl_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    
    -- iplicit Identifiers
    external_id VARCHAR(500) NOT NULL, -- Document/Payment/Receipt ID from iplicit
    source_type VARCHAR(100) NOT NULL, -- 'Document', 'Payment', 'Receipt'
    source_ref VARCHAR(500), -- Document number, Payment reference, etc.
    
    -- Document Details (if source_type = Document)
    doc_class VARCHAR(100), -- Journal, Payment, Receipt, SalesInvoice, PurchaseInvoice, etc.
    doc_date DATE,
    
    -- GL Account Details
    account_code VARCHAR(100),
    account_name VARCHAR(500),
    
    -- Entry Details
    entry_date DATE,
    description TEXT,
    narrative TEXT,
    
    -- Financial Details (NUMERIC to match other tables)
    debit_amount NUMERIC(10, 2) DEFAULT 0,
    credit_amount NUMERIC(10, 2) DEFAULT 0,
    net_amount NUMERIC(10, 2) DEFAULT 0, -- debit - credit
    currency_code VARCHAR(10) DEFAULT 'GBP',
    
    -- Line-level details (for multi-line documents)
    line_number INTEGER,
    line_description TEXT,
    
    -- Counterparty (if applicable)
    counterparty_name VARCHAR(500),
    counterparty_ref VARCHAR(500),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT iplicit_gl_entries_unique_per_conn UNIQUE (connection_id, external_id, line_number)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_gl_entries_organization_id ON public.iplicit_gl_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_gl_entries_connection_id ON public.iplicit_gl_entries(connection_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_gl_entries_external_id ON public.iplicit_gl_entries(external_id);
CREATE INDEX IF NOT EXISTS idx_iplicit_gl_entries_source_type ON public.iplicit_gl_entries(source_type);
CREATE INDEX IF NOT EXISTS idx_iplicit_gl_entries_doc_class ON public.iplicit_gl_entries(doc_class);
CREATE INDEX IF NOT EXISTS idx_iplicit_gl_entries_account_code ON public.iplicit_gl_entries(account_code);
CREATE INDEX IF NOT EXISTS idx_iplicit_gl_entries_entry_date ON public.iplicit_gl_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_iplicit_gl_entries_doc_date ON public.iplicit_gl_entries(doc_date);

-- Enable RLS
ALTER TABLE public.iplicit_gl_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view iplicit GL entries in their org" ON public.iplicit_gl_entries;
CREATE POLICY "Users can view iplicit GL entries in their org"
ON public.iplicit_gl_entries FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert iplicit GL entries in their org" ON public.iplicit_gl_entries;
CREATE POLICY "Users can insert iplicit GL entries in their org"
ON public.iplicit_gl_entries FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update iplicit GL entries in their org" ON public.iplicit_gl_entries;
CREATE POLICY "Users can update iplicit GL entries in their org"
ON public.iplicit_gl_entries FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete iplicit GL entries in their org" ON public.iplicit_gl_entries;
CREATE POLICY "Users can delete iplicit GL entries in their org"
ON public.iplicit_gl_entries FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Update trigger
CREATE OR REPLACE FUNCTION update_iplicit_gl_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_iplicit_gl_entries_updated_at ON public.iplicit_gl_entries;
CREATE TRIGGER update_iplicit_gl_entries_updated_at
    BEFORE UPDATE ON public.iplicit_gl_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_iplicit_gl_entries_updated_at();

COMMENT ON TABLE public.iplicit_gl_entries IS 'General Ledger entries synced from iplicit API (Documents, Payments, Receipts)';
COMMENT ON COLUMN public.iplicit_gl_entries.source_type IS 'Source: Document, Payment, or Receipt';
COMMENT ON COLUMN public.iplicit_gl_entries.doc_class IS 'Document class: Journal, Payment, Receipt, SalesInvoice, PurchaseInvoice, etc.';
COMMENT ON COLUMN public.iplicit_gl_entries.net_amount IS 'Calculated: debit_amount - credit_amount';
