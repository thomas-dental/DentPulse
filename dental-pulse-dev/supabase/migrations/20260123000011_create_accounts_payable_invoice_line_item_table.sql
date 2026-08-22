-- Create accounts_payable_invoice_line_item table
CREATE TABLE IF NOT EXISTS public.accounts_payable_invoice_line_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Key
    accounts_payable_invoice_id UUID NOT NULL REFERENCES public.accounts_payable_invoice(id) ON DELETE CASCADE,
    
    -- Line Item Details
    description TEXT,
    quantity NUMERIC(10, 2),
    unit_price NUMERIC(10, 2),
    line_total NUMERIC(10, 2),
    
    -- Additional Item Information
    item VARCHAR(255),
    location VARCHAR(255),
    
    -- Raw JSON data for the entire line item (for debugging and future processing)
    raw_item_json JSONB,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ap_invoice_line_item_invoice_id ON public.accounts_payable_invoice_line_item(accounts_payable_invoice_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_line_item_item ON public.accounts_payable_invoice_line_item(item);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_line_item_location ON public.accounts_payable_invoice_line_item(location);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_line_item_created_at ON public.accounts_payable_invoice_line_item(created_at);

-- Enable RLS
ALTER TABLE public.accounts_payable_invoice_line_item ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view line items for invoices in their organization
DROP POLICY IF EXISTS "Users can view invoice line items in their org" ON public.accounts_payable_invoice_line_item;
CREATE POLICY "Users can view invoice line items in their org"
ON public.accounts_payable_invoice_line_item FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.accounts_payable_invoice api
        WHERE api.id = accounts_payable_invoice_line_item.accounts_payable_invoice_id
        AND public.user_in_org(auth.uid(), api.organization_id)
    )
);

-- Users can insert line items for invoices in their organization
DROP POLICY IF EXISTS "Users can insert invoice line items in their org" ON public.accounts_payable_invoice_line_item;
CREATE POLICY "Users can insert invoice line items in their org"
ON public.accounts_payable_invoice_line_item FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.accounts_payable_invoice api
        WHERE api.id = accounts_payable_invoice_line_item.accounts_payable_invoice_id
        AND public.user_in_org(auth.uid(), api.organization_id)
    )
);

-- Users can update line items for invoices in their organization
DROP POLICY IF EXISTS "Users can update invoice line items in their org" ON public.accounts_payable_invoice_line_item;
CREATE POLICY "Users can update invoice line items in their org"
ON public.accounts_payable_invoice_line_item FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.accounts_payable_invoice api
        WHERE api.id = accounts_payable_invoice_line_item.accounts_payable_invoice_id
        AND public.user_in_org(auth.uid(), api.organization_id)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.accounts_payable_invoice api
        WHERE api.id = accounts_payable_invoice_line_item.accounts_payable_invoice_id
        AND public.user_in_org(auth.uid(), api.organization_id)
    )
);

-- Users can delete line items for invoices in their organization
DROP POLICY IF EXISTS "Users can delete invoice line items in their org" ON public.accounts_payable_invoice_line_item;
CREATE POLICY "Users can delete invoice line items in their org"
ON public.accounts_payable_invoice_line_item FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM public.accounts_payable_invoice api
        WHERE api.id = accounts_payable_invoice_line_item.accounts_payable_invoice_id
        AND public.user_in_org(auth.uid(), api.organization_id)
    )
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_accounts_payable_invoice_line_item_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_accounts_payable_invoice_line_item_updated_at ON public.accounts_payable_invoice_line_item;
CREATE TRIGGER update_accounts_payable_invoice_line_item_updated_at
    BEFORE UPDATE ON public.accounts_payable_invoice_line_item
    FOR EACH ROW
    EXECUTE FUNCTION update_accounts_payable_invoice_line_item_updated_at();

-- Add comments for documentation
COMMENT ON TABLE public.accounts_payable_invoice_line_item IS 'Stores individual line items for accounts payable invoices';
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.accounts_payable_invoice_id IS 'Foreign key reference to the parent invoice';
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.raw_item_json IS 'Raw JSON data for the entire line item (for debugging and future processing)';
