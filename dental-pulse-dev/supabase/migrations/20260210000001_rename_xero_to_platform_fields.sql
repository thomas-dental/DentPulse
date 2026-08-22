-- Rename Xero-specific fields to platform-agnostic names
-- This makes the schema work with any accounting platform (Xero, iplicit, QuickBooks, etc.)

-- ============================================
-- 1. ACCOUNTS_PAYABLE_INVOICE TABLE CHANGES
-- ============================================

-- Rename xero_invoice_id to platform_invoice_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'xero_invoice_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'platform_invoice_id'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        RENAME COLUMN xero_invoice_id TO platform_invoice_id;
        RAISE NOTICE 'Renamed xero_invoice_id to platform_invoice_id';
    END IF;
END $$;

-- Rename xero_status to platform_status
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'xero_status'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'platform_status'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        RENAME COLUMN xero_status TO platform_status;
        RAISE NOTICE 'Renamed xero_status to platform_status';
    END IF;
END $$;

-- Rename is_from_xero to is_from_platform
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'is_from_xero'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'is_from_platform'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        RENAME COLUMN is_from_xero TO is_from_platform;
        RAISE NOTICE 'Renamed is_from_xero to is_from_platform';
    END IF;
END $$;

-- Drop xero_account_id column (will be moved to line items as platform_account_id)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'xero_account_id'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        DROP COLUMN xero_account_id;
        RAISE NOTICE 'Dropped xero_account_id column from accounts_payable_invoice';
    END IF;
END $$;

-- Add platform_name column to track which platform this invoice is linked to
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'platform_name'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        ADD COLUMN platform_name VARCHAR(50);
        RAISE NOTICE 'Added platform_name column to accounts_payable_invoice';
    END IF;
END $$;

-- ============================================
-- 2. ACCOUNTS_PAYABLE_INVOICE_LINE_ITEM TABLE CHANGES
-- ============================================

-- Add platform_account_id to line items table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice_line_item'
        AND column_name = 'platform_account_id'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice_line_item
        ADD COLUMN platform_account_id UUID REFERENCES public.platform_integration_chart_of_accounts(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added platform_account_id column to accounts_payable_invoice_line_item';
    END IF;
END $$;

-- ============================================
-- 3. UPDATE INDEXES
-- ============================================

-- Drop old indexes
DROP INDEX IF EXISTS idx_ap_invoice_xero_invoice_id;
DROP INDEX IF EXISTS idx_ap_invoice_xero_account_id;
DROP INDEX IF EXISTS idx_ap_invoice_is_from_xero;

-- Create new indexes
CREATE INDEX IF NOT EXISTS idx_ap_invoice_platform_invoice_id ON public.accounts_payable_invoice(platform_invoice_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_platform_status ON public.accounts_payable_invoice(platform_status);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_platform_name ON public.accounts_payable_invoice(platform_name);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_is_from_platform ON public.accounts_payable_invoice(is_from_platform);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_line_item_platform_account_id ON public.accounts_payable_invoice_line_item(platform_account_id);

-- ============================================
-- 4. UPDATE COMMENTS
-- ============================================

COMMENT ON COLUMN public.accounts_payable_invoice.platform_invoice_id IS 'Invoice ID from the accounting platform (Xero, iplicit, QuickBooks, etc.)';
COMMENT ON COLUMN public.accounts_payable_invoice.platform_status IS 'Status of the invoice in the accounting platform (e.g., DRAFT, SUBMITTED, AUTHORISED, PAID)';
COMMENT ON COLUMN public.accounts_payable_invoice.platform_name IS 'Name of the accounting platform (xero, iplicit, quickbooks)';
COMMENT ON COLUMN public.accounts_payable_invoice.is_from_platform IS 'Boolean flag indicating if this invoice was imported from an accounting platform';
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.platform_account_id IS 'Reference to the chart of accounts entry for this line item';
