-- Add missing columns to platform_integration_invoice_line_items table
-- These columns are needed for invoice line items from Dentally API

DO $$
BEGIN
    -- Add description column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'description'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD COLUMN description TEXT NULL;
        RAISE NOTICE 'Added column description to platform_integration_invoice_line_items';
    END IF;

    -- Add quantity column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'quantity'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD COLUMN quantity INTEGER DEFAULT 1;
        RAISE NOTICE 'Added column quantity to platform_integration_invoice_line_items';
    END IF;

    -- Add gross column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'gross'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD COLUMN gross DECIMAL(10, 2) DEFAULT 0;
        RAISE NOTICE 'Added column gross to platform_integration_invoice_line_items';
    END IF;

    -- Add discount column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'discount'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD COLUMN discount DECIMAL(10, 2) DEFAULT 0;
        RAISE NOTICE 'Added column discount to platform_integration_invoice_line_items';
    END IF;

    -- Add net column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'net'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD COLUMN net DECIMAL(10, 2) DEFAULT 0;
        RAISE NOTICE 'Added column net to platform_integration_invoice_line_items';
    END IF;

    -- Add tax column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'tax'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD COLUMN tax DECIMAL(10, 2) DEFAULT 0;
        RAISE NOTICE 'Added column tax to platform_integration_invoice_line_items';
    END IF;

END $$;

-- Add comments
COMMENT ON COLUMN public.platform_integration_invoice_line_items.description IS 'Line item description from Dentally API';
COMMENT ON COLUMN public.platform_integration_invoice_line_items.quantity IS 'Quantity of the item';
COMMENT ON COLUMN public.platform_integration_invoice_line_items.gross IS 'Gross amount before discount';
COMMENT ON COLUMN public.platform_integration_invoice_line_items.discount IS 'Discount amount applied';
COMMENT ON COLUMN public.platform_integration_invoice_line_items.net IS 'Net amount after discount';
COMMENT ON COLUMN public.platform_integration_invoice_line_items.tax IS 'Tax amount';
