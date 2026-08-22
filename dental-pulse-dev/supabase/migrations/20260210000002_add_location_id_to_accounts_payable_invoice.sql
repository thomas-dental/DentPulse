-- Add location_id to accounts_payable_invoice table
-- This allows invoices to be associated with a specific practice location

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'location_id'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        ADD COLUMN location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL;

        RAISE NOTICE 'Added location_id column to accounts_payable_invoice';
    END IF;
END $$;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_ap_invoice_location_id ON public.accounts_payable_invoice(location_id);

-- Add comment for documentation
COMMENT ON COLUMN public.accounts_payable_invoice.location_id IS 'Reference to the practice location this invoice belongs to';
