-- Create accounts_payable_invoice table
CREATE TABLE IF NOT EXISTS public.accounts_payable_invoice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Vendor/Customer Information
    vendor_name VARCHAR(255),
    customer_name VARCHAR(255),
    
    -- Invoice Details
    invoice_number VARCHAR(100),
    invoice_date DATE,
    due_date DATE,
    
    -- Financial Information
    currency VARCHAR(10) DEFAULT 'GBP',
    subtotal NUMERIC(10, 2),
    tax NUMERIC(10, 2),
    total_amount NUMERIC(10, 2),
    amount_due NUMERIC(10, 2),
    amount NUMERIC(10, 2),
    total_no_vat NUMERIC(10, 2),
    total_gbp NUMERIC(10, 2),
    
    -- Account Information
    account VARCHAR(255),
    account_number VARCHAR(100),
    
    -- Order Information
    purchase_order VARCHAR(100),
    order_number VARCHAR(100),
    
    -- Patient Information
    patient VARCHAR(255),
    
    -- Delivery Information
    date_delivered DATE,
    payment_due_by DATE,
    
    -- Brand Information
    brand_id VARCHAR(100),
    
    -- Billing Information
    billed_to TEXT,
    charged NUMERIC(10, 2),
    customer_reference VARCHAR(255),
    
    -- Address Information
    supply_address TEXT,
    supply_point_id VARCHAR(100),
    
    -- Balance Information
    previous_balance NUMERIC(10, 2),
    payments_received NUMERIC(10, 2),
    balance_brought_forward NUMERIC(10, 2),
    account_balance NUMERIC(10, 2),
    
    -- VAT Information
    vat_no VARCHAR(50),
    
    -- File Information
    pdf_path TEXT,
    
    -- Raw Data (for processing and debugging)
    raw_json JSONB,
    raw_text TEXT,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending_review' CHECK (status IN (
        'pending_review',
        'pending_approval',
        'approved',
        'paid',
        'exception',
        'rejected',
        'processing'
    )),
    
    -- Confidence score for AI extraction (0-100)
    confidence_score INTEGER,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ap_invoice_organization_id ON public.accounts_payable_invoice(organization_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_user_id ON public.accounts_payable_invoice(user_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_status ON public.accounts_payable_invoice(status);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_invoice_number ON public.accounts_payable_invoice(invoice_number);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_vendor_name ON public.accounts_payable_invoice(vendor_name);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_invoice_date ON public.accounts_payable_invoice(invoice_date);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_due_date ON public.accounts_payable_invoice(due_date);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_created_at ON public.accounts_payable_invoice(created_at);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_org_status ON public.accounts_payable_invoice(organization_id, status);

-- Enable RLS
ALTER TABLE public.accounts_payable_invoice ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view invoices in their organization
DROP POLICY IF EXISTS "Users can view accounts payable invoices in their org" ON public.accounts_payable_invoice;
CREATE POLICY "Users can view accounts payable invoices in their org"
ON public.accounts_payable_invoice FOR SELECT
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can insert invoices in their organization
DROP POLICY IF EXISTS "Users can insert accounts payable invoices in their org" ON public.accounts_payable_invoice;
CREATE POLICY "Users can insert accounts payable invoices in their org"
ON public.accounts_payable_invoice FOR INSERT
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can update invoices in their organization
DROP POLICY IF EXISTS "Users can update accounts payable invoices in their org" ON public.accounts_payable_invoice;
CREATE POLICY "Users can update accounts payable invoices in their org"
ON public.accounts_payable_invoice FOR UPDATE
USING (
    public.user_in_org(auth.uid(), organization_id)
)
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can delete invoices in their organization
DROP POLICY IF EXISTS "Users can delete accounts payable invoices in their org" ON public.accounts_payable_invoice;
CREATE POLICY "Users can delete accounts payable invoices in their org"
ON public.accounts_payable_invoice FOR DELETE
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_accounts_payable_invoice_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_accounts_payable_invoice_updated_at ON public.accounts_payable_invoice;
CREATE TRIGGER update_accounts_payable_invoice_updated_at
    BEFORE UPDATE ON public.accounts_payable_invoice
    FOR EACH ROW
    EXECUTE FUNCTION update_accounts_payable_invoice_updated_at();

-- Add comments for documentation
COMMENT ON TABLE public.accounts_payable_invoice IS 'Stores supplier invoices uploaded and processed through the Accounts Payable module';
COMMENT ON COLUMN public.accounts_payable_invoice.status IS 'Invoice processing status: pending_review, pending_approval, approved, paid, exception, rejected, processing';
COMMENT ON COLUMN public.accounts_payable_invoice.confidence_score IS 'AI extraction confidence score (0-100)';
COMMENT ON COLUMN public.accounts_payable_invoice.pdf_path IS 'Path/URL to the uploaded PDF file in storage';
COMMENT ON COLUMN public.accounts_payable_invoice.raw_json IS 'Raw extracted JSON data from invoice processing';
COMMENT ON COLUMN public.accounts_payable_invoice.raw_text IS 'Raw extracted text from invoice processing';
