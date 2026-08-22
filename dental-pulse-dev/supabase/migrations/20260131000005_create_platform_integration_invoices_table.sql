-- ============================================
-- Platform Invoices Table
-- Unified table for invoices from Dentally, Xero, and QuickBooks
-- ============================================

CREATE TABLE IF NOT EXISTS public.platform_integration_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ==========================================
    -- COMMON FIELDS (Required for all platforms)
    -- ==========================================
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    platform_type VARCHAR(50) NOT NULL,

    -- ==========================================
    -- PLATFORM-SPECIFIC IDs
    -- ==========================================
    platform_invoice_id VARCHAR(255) NOT NULL,  -- ID from the source platform
    dentally_id BIGINT,                          -- Dentally invoice ID (numeric)
    xero_invoice_id UUID,                        -- Xero InvoiceID (UUID)
    quickbooks_id VARCHAR(100),                  -- QuickBooks Id (string)

    -- ==========================================
    -- INVOICE HEADER FIELDS (Unified)
    -- ==========================================
    invoice_number VARCHAR(100),                 -- INV-0016, 37353, INV-1024
    invoice_type VARCHAR(50),                    -- ACCREC (receivable), ACCPAY (payable), SALES, PURCHASE
    reference VARCHAR(255),                      -- External reference

    -- Dates
    invoice_date DATE,                           -- dated_on, Date, TxnDate
    due_date DATE,                               -- due_on, DueDate, DueDate
    paid_date DATE,                              -- paid_on, FullyPaidOnDate
    sent_at TIMESTAMP WITH TIME ZONE,            -- sent_at

    -- Status
    status VARCHAR(50) DEFAULT 'draft',          -- draft, sent, authorised, paid, voided, deleted
    is_paid BOOLEAN DEFAULT FALSE,               -- paid flag

    -- ==========================================
    -- FINANCIAL FIELDS
    -- ==========================================
    currency VARCHAR(10) DEFAULT 'GBP',          -- GBP, USD, EUR
    currency_rate NUMERIC(15, 10) DEFAULT 1.0,   -- Exchange rate

    -- Amounts (stored in minor currency units or as decimal)
    subtotal NUMERIC(15, 2),                     -- Amount before tax
    tax_amount NUMERIC(15, 2),                   -- Total tax
    total_amount NUMERIC(15, 2),                 -- Total including tax
    amount_paid NUMERIC(15, 2) DEFAULT 0,        -- Amount already paid
    amount_due NUMERIC(15, 2),                   -- Outstanding amount
    amount_outstanding NUMERIC(15, 2),           -- Dentally: amount_outstanding

    -- NHS specific (Dentally)
    nhs_amount NUMERIC(15, 2),                   -- NHS portion

    -- ==========================================
    -- CONTACT/CUSTOMER FIELDS
    -- ==========================================
    contact_id VARCHAR(255),                     -- Platform contact/customer ID
    contact_name VARCHAR(255),                   -- Contact/Customer name
    contact_email VARCHAR(255),                  -- Email address

    -- Dentally specific
    patient_id BIGINT,                           -- Dentally patient_id
    account_id BIGINT,                           -- Dentally account_id
    practitioner_id BIGINT,                      -- Dentally user_id (practitioner)
    site_id VARCHAR(255),                        -- Dentally site_id

    -- QuickBooks specific
    customer_ref_id VARCHAR(100),                -- QuickBooks CustomerRef.value
    customer_ref_name VARCHAR(255),              -- QuickBooks CustomerRef.name

    -- ==========================================
    -- ADDITIONAL FIELDS
    -- ==========================================
    payment_terms VARCHAR(255),                  -- Payment terms text
    private_note TEXT,                           -- Internal notes
    footnote TEXT,                               -- Invoice footnote

    -- Tax details
    line_amount_types VARCHAR(50),               -- Xero: Exclusive, Inclusive, NoTax
    tax_type VARCHAR(50),                        -- Tax type code

    -- URLs and external references
    invoice_url TEXT,                            -- Link to invoice in source system
    branding_theme_id VARCHAR(255),              -- Xero branding theme

    -- Online payment settings (QuickBooks)
    allow_online_payment BOOLEAN DEFAULT FALSE,
    allow_online_credit_card BOOLEAN DEFAULT FALSE,
    allow_online_ach BOOLEAN DEFAULT FALSE,

    -- ==========================================
    -- RAW DATA STORAGE
    -- ==========================================
    raw_data JSONB,                              -- Complete raw response from platform
    meta_data JSONB,                             -- Additional metadata
    custom_fields JSONB,                         -- QuickBooks custom fields, etc.

    -- ==========================================
    -- SYNC TRACKING
    -- ==========================================
    sync_status VARCHAR(50) DEFAULT 'synced',    -- synced, pending, error
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sync_error TEXT,

    -- ==========================================
    -- AUDIT FIELDS
    -- ==========================================
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,         -- Soft delete

    -- ==========================================
    -- CONSTRAINTS
    -- ==========================================
    CONSTRAINT unique_platform_invoice UNIQUE (organization_id, platform_type, platform_invoice_id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_platform_invoices_organization_id ON public.platform_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_location_id ON public.platform_invoices(location_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_user_id ON public.platform_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_platform_type ON public.platform_invoices(platform_type);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_platform_invoice_id ON public.platform_invoices(platform_invoice_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_invoice_number ON public.platform_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status ON public.platform_invoices(status);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_is_paid ON public.platform_invoices(is_paid);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_invoice_date ON public.platform_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_due_date ON public.platform_invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_contact_name ON public.platform_invoices(contact_name);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_patient_id ON public.platform_invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_created_at ON public.platform_invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_org_platform ON public.platform_invoices(organization_id, platform_type);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_org_status ON public.platform_invoices(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_deleted_at ON public.platform_invoices(deleted_at) WHERE deleted_at IS NULL;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;

-- Users can view invoices in their organization
DROP POLICY IF EXISTS "Users can view platform invoices in their org" ON public.platform_invoices;
CREATE POLICY "Users can view platform invoices in their org"
ON public.platform_invoices FOR SELECT
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can insert invoices in their organization
DROP POLICY IF EXISTS "Users can insert platform invoices in their org" ON public.platform_invoices;
CREATE POLICY "Users can insert platform invoices in their org"
ON public.platform_invoices FOR INSERT
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can update invoices in their organization
DROP POLICY IF EXISTS "Users can update platform invoices in their org" ON public.platform_invoices;
CREATE POLICY "Users can update platform invoices in their org"
ON public.platform_invoices FOR UPDATE
USING (
    public.user_in_org(auth.uid(), organization_id)
)
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can delete invoices in their organization
DROP POLICY IF EXISTS "Users can delete platform invoices in their org" ON public.platform_invoices;
CREATE POLICY "Users can delete platform invoices in their org"
ON public.platform_invoices FOR DELETE
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_platform_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_invoices_updated_at ON public.platform_invoices;
CREATE TRIGGER update_platform_invoices_updated_at
    BEFORE UPDATE ON public.platform_invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_invoices_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE public.platform_invoices IS 'Unified invoice table storing data from Dentally, Xero, and QuickBooks';
COMMENT ON COLUMN public.platform_invoices.platform_type IS 'Source platform: Dentally, Xero, QuickBooks';
COMMENT ON COLUMN public.platform_invoices.platform_invoice_id IS 'Original invoice ID from the source platform';
COMMENT ON COLUMN public.platform_invoices.invoice_type IS 'ACCREC (receivable/sales), ACCPAY (payable/purchase)';
COMMENT ON COLUMN public.platform_invoices.raw_data IS 'Complete raw JSON response from the source platform API';
