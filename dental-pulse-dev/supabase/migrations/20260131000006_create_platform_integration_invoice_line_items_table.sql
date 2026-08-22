-- ============================================
-- Platform Invoice Line Items Table
-- Unified table for invoice line items from Dentally, Xero, and QuickBooks
-- ============================================

CREATE TABLE IF NOT EXISTS public.platform_integration_invoice_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ==========================================
    -- FOREIGN KEY TO PARENT INVOICE
    -- ==========================================
    invoice_id UUID NOT NULL REFERENCES public.platform_invoices(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- ==========================================
    -- PLATFORM-SPECIFIC LINE ITEM IDs
    -- ==========================================
    platform_line_id VARCHAR(255),              -- ID from source platform if available
    line_number INTEGER,                         -- Line item sequence number

    -- ==========================================
    -- ITEM DESCRIPTION
    -- ==========================================
    description TEXT,                            -- Line item description
    item_code VARCHAR(100),                      -- ItemCode (Xero), product code
    item_name VARCHAR(255),                      -- Item/Product name

    -- ==========================================
    -- QUANTITIES AND PRICING
    -- ==========================================
    quantity NUMERIC(15, 4) DEFAULT 1,           -- Quantity
    unit_amount NUMERIC(15, 4),                  -- Unit price (UnitAmount, Rate)
    unit_of_measure VARCHAR(50),                 -- Unit of measure

    -- ==========================================
    -- FINANCIAL AMOUNTS
    -- ==========================================
    line_amount NUMERIC(15, 2),                  -- LineAmount (quantity * unit_amount)
    tax_amount NUMERIC(15, 2),                   -- Tax for this line
    discount_amount NUMERIC(15, 2),              -- Discount amount
    discount_rate NUMERIC(10, 4),                -- DiscountRate (Xero)

    -- ==========================================
    -- TAX DETAILS
    -- ==========================================
    tax_type VARCHAR(50),                        -- TaxType code
    tax_rate NUMERIC(10, 4),                     -- Tax percentage

    -- ==========================================
    -- ACCOUNT MAPPING
    -- ==========================================
    account_id VARCHAR(255),                     -- AccountID (Xero)
    account_code VARCHAR(100),                   -- AccountCode (Xero)
    account_name VARCHAR(255),                   -- Account name

    -- ==========================================
    -- DENTALLY SPECIFIC FIELDS
    -- ==========================================
    treatment_id BIGINT,                         -- Dentally treatment_id
    treatment_code VARCHAR(100),                 -- Treatment code
    treatment_category VARCHAR(255),             -- Treatment category
    tooth_ref VARCHAR(50),                       -- Tooth reference
    practitioner_id BIGINT,                      -- Practitioner who performed treatment
    practitioner_name VARCHAR(255),              -- Practitioner name
    completed_at TIMESTAMP WITH TIME ZONE,       -- When treatment was completed
    nhs_band VARCHAR(50),                        -- NHS band (if applicable)
    is_nhs BOOLEAN DEFAULT FALSE,                -- NHS treatment flag

    -- ==========================================
    -- XERO SPECIFIC FIELDS
    -- ==========================================
    xero_line_item_id UUID,                      -- Xero LineItemID
    tracking JSONB,                              -- Xero tracking categories

    -- ==========================================
    -- QUICKBOOKS SPECIFIC FIELDS
    -- ==========================================
    quickbooks_line_id VARCHAR(100),             -- QuickBooks Line Id
    detail_type VARCHAR(50),                     -- SalesItemLineDetail, SubTotalLineDetail, etc.
    service_date DATE,                           -- ServiceDate
    item_ref_id VARCHAR(100),                    -- ItemRef.value
    item_ref_name VARCHAR(255),                  -- ItemRef.name
    class_ref_id VARCHAR(100),                   -- ClassRef.value (for categorization)
    class_ref_name VARCHAR(255),                 -- ClassRef.name
    tax_code_ref VARCHAR(100),                   -- TaxCodeRef.value

    -- ==========================================
    -- RAW DATA STORAGE
    -- ==========================================
    raw_data JSONB,                              -- Complete raw line item from platform

    -- ==========================================
    -- AUDIT FIELDS
    -- ==========================================
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON public.platform_invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_organization_id ON public.platform_invoice_line_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_item_code ON public.platform_invoice_line_items(item_code);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_account_code ON public.platform_invoice_line_items(account_code);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_treatment_id ON public.platform_invoice_line_items(treatment_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_practitioner_id ON public.platform_invoice_line_items(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_created_at ON public.platform_invoice_line_items(created_at);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.platform_invoice_line_items ENABLE ROW LEVEL SECURITY;

-- Users can view line items in their organization
DROP POLICY IF EXISTS "Users can view invoice line items in their org" ON public.platform_invoice_line_items;
CREATE POLICY "Users can view invoice line items in their org"
ON public.platform_invoice_line_items FOR SELECT
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can insert line items in their organization
DROP POLICY IF EXISTS "Users can insert invoice line items in their org" ON public.platform_invoice_line_items;
CREATE POLICY "Users can insert invoice line items in their org"
ON public.platform_invoice_line_items FOR INSERT
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can update line items in their organization
DROP POLICY IF EXISTS "Users can update invoice line items in their org" ON public.platform_invoice_line_items;
CREATE POLICY "Users can update invoice line items in their org"
ON public.platform_invoice_line_items FOR UPDATE
USING (
    public.user_in_org(auth.uid(), organization_id)
)
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can delete line items in their organization
DROP POLICY IF EXISTS "Users can delete invoice line items in their org" ON public.platform_invoice_line_items;
CREATE POLICY "Users can delete invoice line items in their org"
ON public.platform_invoice_line_items FOR DELETE
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_invoice_line_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_invoice_line_items_updated_at ON public.platform_invoice_line_items;
CREATE TRIGGER update_invoice_line_items_updated_at
    BEFORE UPDATE ON public.platform_invoice_line_items
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_line_items_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE public.platform_invoice_line_items IS 'Unified invoice line items table storing data from Dentally, Xero, and QuickBooks';
COMMENT ON COLUMN public.platform_invoice_line_items.invoice_id IS 'Reference to parent invoice in platform_invoices table';
COMMENT ON COLUMN public.platform_invoice_line_items.detail_type IS 'QuickBooks line type: SalesItemLineDetail, SubTotalLineDetail, DiscountLineDetail';
COMMENT ON COLUMN public.platform_invoice_line_items.raw_data IS 'Complete raw JSON line item from the source platform API';
