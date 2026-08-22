-- ============================================================================
-- Add shared_at and paid_at fields to accounts_payable_invoice
-- Used for calculating "Avg Days to Pay" metric
-- ============================================================================

-- Add shared_at column - when invoice was first sent to accounting platform
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'shared_at'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        ADD COLUMN shared_at TIMESTAMP WITH TIME ZONE;

        RAISE NOTICE 'Added shared_at column to accounts_payable_invoice';
    END IF;
END $$;

-- Add paid_at column - when platform_status changed to 'PAID'
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'paid_at'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        ADD COLUMN paid_at TIMESTAMP WITH TIME ZONE;

        RAISE NOTICE 'Added paid_at column to accounts_payable_invoice';
    END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ap_invoice_shared_at ON public.accounts_payable_invoice(shared_at);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_paid_at ON public.accounts_payable_invoice(paid_at);

-- Add comments for documentation
COMMENT ON COLUMN public.accounts_payable_invoice.shared_at IS 'Timestamp when invoice was first sent/synced to accounting platform';
COMMENT ON COLUMN public.accounts_payable_invoice.paid_at IS 'Timestamp when platform_status changed to PAID';
