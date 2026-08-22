-- Add Xero integration fields to accounts_payable_invoice table
-- These fields are used to track invoices synced from or linked to Xero

DO $$ 
BEGIN
    -- Add xero_invoice_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'accounts_payable_invoice' 
        AND column_name = 'xero_invoice_id'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice 
        ADD COLUMN xero_invoice_id VARCHAR(255);
        
        RAISE NOTICE 'Added xero_invoice_id column to accounts_payable_invoice table';
    END IF;

    -- Add xero_account_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'accounts_payable_invoice' 
        AND column_name = 'xero_account_id'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice 
        ADD COLUMN xero_account_id VARCHAR(255);
        
        RAISE NOTICE 'Added xero_account_id column to accounts_payable_invoice table';
    END IF;

    -- Add xero_status column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'accounts_payable_invoice' 
        AND column_name = 'xero_status'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice 
        ADD COLUMN xero_status VARCHAR(50);
        
        RAISE NOTICE 'Added xero_status column to accounts_payable_invoice table';
    END IF;

    -- Add is_from_xero column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'accounts_payable_invoice' 
        AND column_name = 'is_from_xero'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice 
        ADD COLUMN is_from_xero BOOLEAN DEFAULT false;
        
        RAISE NOTICE 'Added is_from_xero column to accounts_payable_invoice table';
    END IF;
END $$;

-- Create indexes for Xero fields for better query performance
CREATE INDEX IF NOT EXISTS idx_ap_invoice_xero_invoice_id ON public.accounts_payable_invoice(xero_invoice_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_xero_account_id ON public.accounts_payable_invoice(xero_account_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_is_from_xero ON public.accounts_payable_invoice(is_from_xero);

-- Add comments for documentation
COMMENT ON COLUMN public.accounts_payable_invoice.xero_invoice_id IS 'Xero invoice ID if this invoice is synced from or linked to Xero';
COMMENT ON COLUMN public.accounts_payable_invoice.xero_account_id IS 'Xero account ID associated with this invoice';
COMMENT ON COLUMN public.accounts_payable_invoice.xero_status IS 'Status of the invoice in Xero (e.g., DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED)';
COMMENT ON COLUMN public.accounts_payable_invoice.is_from_xero IS 'Boolean flag indicating if this invoice was imported from Xero';
